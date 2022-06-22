import {
  Field,
  SmartContract,
  method,
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
  State,
  state,
  Bool,
  UInt32,
} from 'snarkyjs';

export { Mastermind, Pegs };

await isReady;

class Pegs extends CircuitValue {
  @arrayProp(Field, 4) pegs: [Field, Field, Field, Field];

  constructor(pegs: [Field, Field, Field, Field]) {
    super();
    this.pegs = pegs;
  }

  static from(pegs: number[]) {
    if (pegs.length !== 4) throw Error('must use 4 pegs');
    let [v0, v1, v2, v3] = pegs;
    return new Pegs([Field(v0), Field(v1), Field(v2), Field(v3)]);
  }

  toString() {
    return JSON.stringify(this.pegs.map(String));
  }
}

class Mastermind extends SmartContract {
  @state(Field) solutionCommitment = State<Field>();
  @state(Field) blackPegs = State<Field>(); // number of black pegs in last hint, 0,...,4; game is won if == 4
  @state(Field) whitePegs = State<Field>(); // number of white pegs in last hint, 0,...,4
  @state(Field) lastGuess = State<Field>(); // uses base6 encoding, or -1 if there was no guess yet
  @state(UInt32) numberOfMoves = State<UInt32>();
  // do we also want @state player: PublicKey (to be able to demonstrate that *you* won), and/or @state isWon: Bool?

  @method init(solution: Pegs, zkappKey: PrivateKey, zkappSecret: Field) {
    // only the zkapp owner can call this
    this.self.publicKey.assertEquals(zkappKey.toPublicKey());
    // assert that there is no solution commitment yet, so this can only be called once
    this.solutionCommitment.assertEquals(Field.zero);

    // create a hiding commitment to the solution
    let commitment = Poseidon.hash([...solution.pegs, zkappSecret]);
    this.solutionCommitment.set(commitment);
    // comments:
    // --> we hash the zkappSecret together with the solution, so that the solution can't be found by guessing & hashing
    //     (hiding commitment)
    // --> connection between zkappKey and zkappSecret doesn't need to be constrained.
    //     we only need *some* secret that the zkapp owner can reproduce later

    // initializing other state. technically, you don't have to do the zero ones
    this.blackPegs.set(Field.zero);
    this.whitePegs.set(Field.zero);
    this.lastGuess.set(Field.minusOne);
    this.numberOfMoves.set(UInt32.zero);
  }

  @method makeGuess() {
    // TODO subset of validateHint
    /**
     * check that numberOfMoves % 2 === 0
     * numberOfMoves++
     * set last guess, TBD: encode in circuit? check that each peg is in 1,...,6? add .check() to Peg?
     */
  }

  @method giveHint() {
    // TODO subset of validateHint
    /**
     * check that numberOfMoves % 2 === 1
     * numberOfMoves++
     * unhash solution -- needs private key passed in
     * read lastGuess, compute black & white pegs in circuit
     * set black & white pegs
     *
     * this method produces a "won" state as a side-effect, if blackPegs === 4
     * could also set isWon based on that, and prevent further guesses if isWon = true
     */
  }

  @method validateHint(
    guessInstance: Pegs,
    solutionInstance: Pegs,
    claimedBlackPegs: Field,
    claimedWhitePegs: Field
    // solutionHash: Field  Return hash of solution
  ) {
    let guess = guessInstance.pegs;
    let solution = solutionInstance.pegs;

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
        let isNotBlackPeg = guess[i].equals(Field.zero).not(); // This works, right? Any value is greater than zero? It's impossible to overflow?
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

let withProofs = true; // TODO: make this a config option of LocalBlockchain

let zkAppPrivateKey = PrivateKey.random();
let zkAppAddress = zkAppPrivateKey.toPublicKey();
let zkapp = new Mastermind(zkAppAddress);

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
const publisherAccount = Local.testAccounts[0].privateKey;
console.log('Local Blockchain Online!');

if (withProofs) {
  console.log('compiling...');
  await Mastermind.compile(zkAppAddress);
}

let solution = Pegs.from([1, 2, 3, 6]);
let tx = await Mina.transaction(publisherAccount, () => {
  Party.fundNewAccount(publisherAccount);
  zkapp.deploy({ zkappKey: zkAppPrivateKey });
  if (!withProofs) {
    zkapp.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }
});
tx.send().wait();
console.log('Contract Deployed!');

// trick: convert zkapp PrivateKey to a Field, to get a secret that can be hashed without adding O(255) constraints
let scalarBits = zkAppPrivateKey.s.toFields();
let zkappSecret = Field.ofBits(scalarBits.map(Bool.Unsafe.ofField));
// TODO: investigate why this didn't work in a Circuit.witness block inside the method

tx = await Mina.transaction(publisherAccount, () => {
  zkapp.init(solution, zkAppPrivateKey, zkappSecret);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

let guess = Pegs.from([6, 3, 2, 1]);
let blackPegs = Field.zero;
let whitePegs = new Field(4);
tx = await Mina.transaction(publisherAccount, () => {
  let zkapp = new Mastermind(zkAppAddress);
  zkapp.validateHint(guess, solution, blackPegs, whitePegs);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

console.log('Guess Valid!');

shutdown();
