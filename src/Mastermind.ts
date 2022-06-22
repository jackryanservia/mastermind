import {
  Field,
  SmartContract,
  method,
  DeployArgs,
  Permissions,
  state,
  State,
  CircuitValue,
  arrayProp,
  Poseidon,
  Circuit,
  PrivateKey,
  PublicKey,
  Mina,
  Party,
  isReady,
  UInt32,
} from 'snarkyjs';

// Zoom to 54-33 lines

await isReady;

class Pegs extends CircuitValue {
  @arrayProp(Field, 4) value: Field[];

  constructor(value: number[]) {
    super();
    this.value = value.map((value) => Field(value));
  }

  hash() {
    return Poseidon.hash(this.value);
  }
}

export class Mastermind extends SmartContract {
  @state(Pegs) lastGuess = State<Pegs>();
  @state(Field) solutionHash = State<Field>();
  @state(UInt32) redPegs = State<UInt32>();
  @state(UInt32) whitePegs = State<UInt32>();
  @state(UInt32) turnNumber = State<UInt32>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }

  @method init(solution: Pegs) {
    this.solutionHash.set(solution.hash());
    this.lastGuess.set(new Pegs([0, 0, 0, 0]));
    this.redPegs.set(UInt32.zero);
    this.whitePegs.set(UInt32.zero);
    this.turnNumber.set(UInt32.zero);
  }

  @method publishGuess(guess: Pegs) {
    let turnNumber = this.turnNumber.get(); // Grab turnNumber from Mina network
    turnNumber.mod(2).assertEquals(UInt32.zero); // Check that it is the guesser's turn
    this.turnNumber.set(turnNumber.add(UInt32.one)); // Increment turn number

    // Check that all values are between 1 and 6
    for (let i = 0; i < 4; i++) {
      guess.value[i].assertGte(Field.one);
      guess.value[i].assertLte(new Field(6));
    }

    this.lastGuess.set(guess); // Set lastGuess to new guess
  }

  @method publishHint(solutionInstance: Pegs) {
    // There is no need to check that it is the code generators turn because their behavior is deterministic
    let guess = this.lastGuess.get().value;
    let solution = solutionInstance.value;

    let redPegs = UInt32.zero;
    let whitePegs = UInt32.zero;

    // Assert that all values are between 1 and 6 (for the 6 different colored pegs)
    for (let i = 0; i < 4; i++) {
      guess[i].assertGte(Field.one);
      guess[i].assertLte(new Field(6));
      solution[i].assertGte(Field.one);
      solution[i].assertLte(new Field(6));
    }

    // Count red pegs
    for (let i = 0; i < 4; i++) {
      let isCorrectPeg = guess[i].equals(solution[i]);
      // Increment redPegs if player guessed the correct peg in the i place
      redPegs = Circuit.if(isCorrectPeg, redPegs.add(UInt32.one), redPegs);
      // Set values in guess[i] and solution[i] to zero if they match so that we can ignore them when calculating white pegs.
      guess[i] = Circuit.if(isCorrectPeg, Field.zero, guess[i]);
      solution[i] = Circuit.if(isCorrectPeg, Field.zero, solution[i]);
    }

    // Count white pegs
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let isCorrectColor = guess[i].equals(solution[j]);
        let isNotRedPeg = guess[i].gt(Field.zero); // This works, right? Any value is greater than zero? It's impossible to overflow?
        let isWhitePeg = isCorrectColor.and(isNotRedPeg);
        whitePegs = Circuit.if(
          isWhitePeg,
          whitePegs.add(UInt32.one),
          whitePegs
        );
        guess[i] = Circuit.if(isWhitePeg, Field.zero, guess[i]);
        solution[j] = Circuit.if(isWhitePeg, Field.zero, solution[j]);
      }
    }

    // Check that solution instance is the one that code generator committed to when they deployed the contract
    let solutionHash = this.solutionHash.get();
    solutionInstance.hash().assertEquals(solutionHash); // Is this constrained

    // Set red and white pegs
    this.redPegs.set(redPegs);
    this.whitePegs.set(whitePegs);
  }
}

// Run

function createLocalBlockchain(): PrivateKey {
  let Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);

  const account = Local.testAccounts[0].privateKey;
  return account;
}

async function deploy(
  zkAppInstance: Mastermind,
  zkAppPrivateKey: PrivateKey,
  account: PrivateKey,
  code: Pegs
) {
  let tx = await Mina.transaction(account, () => {
    Party.fundNewAccount(account);
    zkAppInstance.deploy({ zkappKey: zkAppPrivateKey });
    zkAppInstance.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });

    zkAppInstance.init(code);
  });
  await tx.send().wait();
}

async function publishGuess(
  account: PrivateKey,
  zkAppAddress: PublicKey,
  zkAppPrivateKey: PrivateKey,
  guess: Pegs
) {
  let tx = await Mina.transaction(account, () => {
    let zkApp = new Mastermind(zkAppAddress);
    zkApp.publishGuess(guess);
    zkApp.sign(zkAppPrivateKey);
  });
  try {
    await tx.send().wait();
    return true;
  } catch (err) {
    return false;
  }
}

async function publishHint(
  account: PrivateKey,
  zkAppAddress: PublicKey,
  zkAppPrivateKey: PrivateKey,
  solutionInstance: Pegs
) {
  let tx = await Mina.transaction(account, () => {
    let zkApp = new Mastermind(zkAppAddress);
    zkApp.publishHint(solutionInstance);
    zkApp.sign(zkAppPrivateKey);
  });
  try {
    await tx.send().wait();
    return true;
  } catch (err) {
    return false;
  }
}

let zkAppPrivateKey = PrivateKey.random();
let zkAppAddress = zkAppPrivateKey.toPublicKey();
let zkAppInstance = new Mastermind(zkAppAddress);

let publisherAccount = createLocalBlockchain();
console.log('Local Blockchain Online!');

await deploy(
  zkAppInstance,
  zkAppPrivateKey,
  publisherAccount,
  new Pegs([1, 2, 3, 4])
);
console.log('Contract Deployed!');

console.log(zkAppInstance.turnNumber.get().toString());

let guess = new Pegs([1, 2, 3, 5]);
await publishGuess(publisherAccount, zkAppAddress, publisherAccount, guess);
console.log('Guess Published!');

console.log(zkAppInstance.turnNumber.get().toString()); // Why is this not incrementing? I don't know I go to bed now.

let solution = new Pegs([1, 2, 3, 4]);
await publishHint(
  publisherAccount,
  zkAppAddress,
  publisherAccount, // I'm pretty sure this should be publisherAccount (thus this function should be redefined)
  solution
);
console.log('Hint Published');
