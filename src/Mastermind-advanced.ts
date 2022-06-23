import {
  Field,
  SmartContract,
  method,
  CircuitValue,
  arrayProp,
  Poseidon,
  Circuit,
  PrivateKey,
  isReady,
  State,
  state,
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

  // check: make assertions on *every* variable that is created
  // example: Bool.check asserts that Bool is 0 or 1 --> x*(x-1) === 0
  // will be called under the hood when passing variables to methods, and when creating them with Circuit.witness
  static check({ pegs }: Pegs) {
    for (let x of pegs) {
      // check that x is between 1,...,6

      // naive method:
      // x.assertGte(Field.one);
      // x.assertLte(Field(6));
      // --> bad because `Gte`, `Lte` need boolean unpacking
      // --> O(255) generic PLONK gates
      // --> will get more efficient soon-ish, when snarkyjs gets an efficient "range check gate" using plookup

      // less naive: check that (x-1)*...*(x-6) === 0
      x.sub(1)
        .mul(x.sub(2))
        .mul(x.sub(3))
        .mul(x.sub(4))
        .mul(x.sub(5))
        .mul(x.sub(6))
        .assertEquals(0);
      // --> ~6-12 generic gates
      // --> O(n) where n=6

      // remark: optimal method needs only 3 generic gates
      // --> represent peg as one of w^1, ..., w^6 where w is 6th root of unity
      // --> check that x^6 === 1
      // --> x^6 can be computed with 3 multiplications, (x^2 * x)^2
      // --> O(log(n)) where n=6

      // remark 2: you might not need defensive checks for certain properties
      // --> think carefully about what you want to prove, in what method
    }
  }

  toString() {
    return JSON.stringify(this.pegs.map(String));
  }
}

class Mastermind extends SmartContract {
  @state(Field) solutionCommitment = State<Field>();
  @state(Field) blackPegs = State<Field>(); // number of black pegs in last hint, 0,...,4; game is won if == 4
  @state(Field) whitePegs = State<Field>(); // number of white pegs in last hint, 0,...,4
  @state(Pegs) lastGuess = State<Pegs>();
  @state(UInt32) turnNumber = State<UInt32>();
  // do we also want @state player: PublicKey (to be able to demonstrate that *you* won), and/or @state isWon: Bool?
  // in that case, need base6 encoding for the lastGuess, or -1 if there was no guess yet

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
    this.lastGuess.set(Pegs.from([0, 0, 0, 0]));
    this.turnNumber.set(UInt32.zero);
  }

  @method publishGuess(guess: Pegs) {
    let turnNumber = this.turnNumber.get(); // Grab turnNumber from Mina network
    this.turnNumber.assertEquals(turnNumber); // add "precondition", so that turnNumber can't be set to anything else than what's currently on the ledger
    // TODO: this throws
    // turnNumber.mod(2);
    // turnNumber.mod(2).assertEquals(UInt32.zero); // Check that it is the guesser's turn

    // remark: UInt32 is not very efficient, does range check on every operation
    // but will be just ~1 constraint soon with plookup range check
    this.turnNumber.set(turnNumber.add(UInt32.one)); // Increment turn number
    this.lastGuess.set(guess); // Set lastGuess to new guess
  }

  @method publishHint(solutionInstance: Pegs, zkappSecret: Field) {
    let turnNumber = this.turnNumber.get(); // Grab turnNumber from Mina network
    // There is no need to check that it's the code generators turn because
    // their behavior is entirely determined by the last guess.
    // If code generator calls publishHint five times in a row nothing will
    // change after the first time.
    this.turnNumber.set(turnNumber.add(UInt32.one)); // Increment turn number

    let guess = [...this.lastGuess.get().pegs];
    let solution = [...solutionInstance.pegs];

    let redPegs = Field.zero;
    let whitePegs = Field.zero;

    // Check that solution instance matches the one the code generator
    // committed to when they deployed the contract.
    let commitment = this.solutionCommitment.get();
    commitment.assertEquals(
      Poseidon.hash([...solutionInstance.pegs, zkappSecret])
    );

    // There is no need to check that values are between 1 and 6 (for the 6
    // different colored pegs). They are checked when the solution is set
    // (it can not be changed), and when the guess is published.

    // Count red pegs
    for (let i = 0; i < 4; i++) {
      let isCorrectPeg = guess[i].equals(solution[i]);
      // Increment redPegs if player guessed the correct peg in the i place
      redPegs = Circuit.if(isCorrectPeg, redPegs.add(Field.one), redPegs);
      // Set values in guess[i] and solution[i] to zero (remove pegs) if they match so that we can ignore them when calculating white pegs.
      guess[i] = Circuit.if(isCorrectPeg, Field.zero, guess[i]);
      solution[i] = Circuit.if(isCorrectPeg, Field.zero, solution[i]);
    }

    // Count white pegs
    // Step through every solution peg for every guessed peg
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        // Check if the pegs are the same color
        let isCorrectColor = guess[i].equals(solution[j]);
        // Check that the peg exists (we might have removed it when calculating // red pegs)
        let isNotRedPeg = guess[i].equals(Field.zero).not(); // TODO -- use not equals
        // If the pegs in these locations exist and they are the same color
        // then we should add a white peg
        let isWhitePeg = isCorrectColor.and(isNotRedPeg);
        whitePegs = Circuit.if(isWhitePeg, whitePegs.add(Field.one), whitePegs);
        // Set the values in guess[i] and solution[i] to zero (remove pegs) so that they wont be counted again
        guess[i] = Circuit.if(isWhitePeg, Field.zero, guess[i]);
        solution[j] = Circuit.if(isWhitePeg, Field.zero, solution[j]);
      }
    }

    // Update on-chain red and white peg counts
    this.blackPegs.set(redPegs);
    this.whitePegs.set(whitePegs);
  }
}
