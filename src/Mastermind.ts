import {
  Field,
  SmartContract,
  method,
  DeployArgs,
  Permissions,
  CircuitValue,
  arrayProp,
  Poseidon,
  Circuit,
  PrivateKey,
  PublicKey,
  Mina,
  Party,
  isReady,
} from 'snarkyjs';

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
  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }

  @method init() {}

  @method validateHint(
    guessInstance: Pegs,
    solutionInstance: Pegs,
    claimedBlackPegs: Field,
    claimedWhitePegs: Field
    // solutionHash: Field  Return hash of solution
  ) {
    let guess = guessInstance.value;
    let solution = solutionInstance.value;

    let blackPegs = Field.zero;
    let whitePegs = Field.zero;

    // Assert that all values are between 1 and 6 (for the 6 different colored pegs)
    for (let i = 0; i < 4; i++) {
      guess[i].assertGte(Field.one);
      guess[i].assertLte(new Field(6));
      solution[i].assertGte(Field.one);
      solution[i].assertLte(new Field(6));
    }

    // Count black pegs
    for (let i = 0; i < 4; i++) {
      let isCorrectPeg = guess[i].equals(solution[i]);
      // Increment blackPegs if player guessed the correct peg in the i place
      blackPegs = Circuit.if(isCorrectPeg, blackPegs.add(Field.one), blackPegs);

      // Set values in guess[i] and solution[i] to zero if they match so that we can ignore them when calculating white pegs.
      guess[i] = Circuit.if(isCorrectPeg, Field.zero, guess[i]);
      solution[i] = Circuit.if(isCorrectPeg, Field.zero, solution[i]);
    }

    // Count white pegs
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let isCorrectColor = guess[i].equals(solution[j]);
        let isNotBlackPeg = guess[i].gt(Field.zero); // This works, right? Any value is greater than zero? It's impossible to overflow?
        let isWhitePeg = isCorrectColor.and(isNotBlackPeg);
        whitePegs = Circuit.if(isWhitePeg, whitePegs.add(Field.one), whitePegs);
        guess[i] = Circuit.if(isWhitePeg, Field.zero, guess[i]);
        solution[j] = Circuit.if(isWhitePeg, Field.zero, solution[j]);
      }
    }

    // Check peg numbers
    blackPegs.assertEquals(claimedBlackPegs);
    whitePegs.assertEquals(claimedWhitePegs);
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
  account: PrivateKey
) {
  let tx = await Mina.transaction(account, () => {
    Party.fundNewAccount(account);
    zkAppInstance.deploy({ zkappKey: zkAppPrivateKey });
    zkAppInstance.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });

    zkAppInstance.init();
  });
  await tx.send().wait();
}

async function validateHint(
  guessInstance: Pegs,
  solutionInstance: Pegs,
  blackPegs: Field,
  whitePegs: Field,
  account: PrivateKey,
  zkAppAddress: PublicKey,
  zkAppPrivateKey: PrivateKey
) {
  let tx = await Mina.transaction(account, () => {
    let zkApp = new Mastermind(zkAppAddress);
    zkApp.validateHint(guessInstance, solutionInstance, blackPegs, whitePegs);
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
await deploy(zkAppInstance, zkAppPrivateKey, publisherAccount);
console.log('Contract Deployed!');
let guess = new Pegs([6, 3, 2, 1]);
let solution = new Pegs([1, 2, 3, 6]);
let blackPegs = Field.zero;
let whitePegs = new Field(4);
await validateHint(
  guess,
  solution,
  blackPegs,
  whitePegs,
  publisherAccount,
  zkAppAddress,
  zkAppPrivateKey // I'm pretty sure this should be publisherAccount (thus this function should be redefined)
);
console.log('Guess Valid!');
