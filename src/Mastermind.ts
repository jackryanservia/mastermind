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
  Mina,
  Party,
  isReady,
  shutdown,
} from 'snarkyjs';

export { Mastermind, Pegs };

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

class Mastermind extends SmartContract {
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

let zkAppPrivateKey = PrivateKey.random();
let zkAppAddress = zkAppPrivateKey.toPublicKey();
let zkAppInstance = new Mastermind(zkAppAddress);

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
const publisherAccount = Local.testAccounts[0].privateKey;

console.log('Local Blockchain Online!');
let tx = await Mina.transaction(publisherAccount, () => {
  Party.fundNewAccount(publisherAccount);
  zkAppInstance.deploy({ zkappKey: zkAppPrivateKey });
  zkAppInstance.setPermissions({
    ...Permissions.default(),
    editState: Permissions.proofOrSignature(),
  });
});
tx.send().wait();

console.log('Contract Deployed!');
let guess = new Pegs([6, 3, 2, 1]);
let solution = new Pegs([1, 2, 3, 6]);
let blackPegs = Field.zero;
let whitePegs = new Field(4);
tx = await Mina.transaction(publisherAccount, () => {
  let zkApp = new Mastermind(zkAppAddress);
  zkApp.validateHint(guess, solution, blackPegs, whitePegs);
  zkApp.sign(zkAppPrivateKey);
});
tx.send().wait();

console.log('Guess Valid!');

shutdown();
