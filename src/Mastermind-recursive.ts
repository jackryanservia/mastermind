import {
  Field,
  CircuitValue,
  arrayProp,
  Poseidon,
  Circuit,
  isReady,
  UInt32,
  ZkProgram,
  prop,
  SelfProof,
} from 'snarkyjs';

export { Pegs, Mastermind };

await isReady;

// Define a CircuitValue for our code pegs
class Pegs extends CircuitValue {
  @arrayProp(Field, 4) value: Field[];

  constructor(value: number[]) {
    super();
    this.value = value.map((value) => Field(value));
  }

  // Hash the peg configuration to create a commitment that we can store
  // on-chain which won't reveal the code.
  hash() {
    return Poseidon.hash(this.value);
  }
}

// NEW: define a CircuitValue for Mastermind state
// this has exactly the same layout as the on-chain state before
class MastermindState extends CircuitValue {
  @prop lastGuess: Pegs;
  // Store a hash of the solution so that the code generator can't change the
  // code after the contract is deployed.
  @prop solutionHash: Field;
  // The number of red pegs for the last guess
  @prop redPegs: Field;
  // The number of white pegs for the last guess
  @prop whitePegs: Field;
  // The number of turns (will be incremented whenever a player calls
  // publishHint or publishGuess).
  @prop turnNumber: UInt32;

  constructor(
    lastGuess: Pegs,
    solutionHash: Field,
    redPegs: Field,
    whitePegs: Field,
    turnNumber: UInt32
  ) {
    super();
    this.lastGuess = lastGuess;
    this.solutionHash = solutionHash;
    this.redPegs = redPegs;
    this.whitePegs = whitePegs;
    this.turnNumber = turnNumber;
  }
}

// NEW: The main object is a `ZkProgram` instead of a `SmartContract`
let Mastermind = ZkProgram({
  publicInput: MastermindState,

  methods: {
    // @method init(solution: Pegs)
    init: {
      privateInputs: [Pegs], // <-- no decorator; instead, being explicit about method arguments

      method(
        publicInput: MastermindState, // <-- first input is the public input. you can think of it like "the new state that this method produces"
        solution: Pegs // <-- all other inputs are private inputs; same inputs as before
      ) {
        // Check that the solution is valid so the code generator can't create an
        // illegal game.
        for (let i = 0; i < 4; i++) {
          solution.value[i].assertGte(Field.one);
          solution.value[i].assertLte(new Field(6));
        }
        // instead of "setting" / "getting" state, we do something more low-level:
        // check that the public input that was passed in matches what the `init()` method requires

        // this.solutionHash.set(solution.hash());
        publicInput.solutionHash.assertEquals(solution.hash());
        // this.lastGuess.set(new Pegs([0, 0, 0, 0]));
        publicInput.lastGuess.assertEquals(new Pegs([0, 0, 0, 0]));
        // this.redPegs.set(Field.zero);
        publicInput.redPegs.assertEquals(Field.zero);
        // this.whitePegs.set(Field.zero);
        publicInput.whitePegs.assertEquals(Field.zero);
        // this.turnNumber.set(UInt32.zero);
        publicInput.turnNumber.assertEquals(UInt32.zero);
      },
    },

    // @method publishGuess(guess: Pegs)
    publishGess: {
      privateInputs: [Pegs, SelfProof],

      method(
        publicInput: MastermindState, // as before
        guess: Pegs, // as before
        previousProof: SelfProof<MastermindState> // RECURSION!!!
      ) {
        previousProof.verify(); // <-- IMPORTANT LINE: this method can only run if the previous proof was valid!

        // Grab turnNumber from the PREVIOUS PROOF
        let turnNumber = previousProof.publicInput.turnNumber;
        // Check that it's the guesser's turn TODO
        // turnNumber.mod(2).assertEquals(UInt32.zero);
        // Increment the turn number
        publicInput.turnNumber.assertEquals(turnNumber.add(UInt32.one));

        // Check that all values are between 1 and 6 (peg configuration is legal)
        for (let i = 0; i < 4; i++) {
          guess.value[i].assertGte(Field.one);
          guess.value[i].assertLte(new Field(6));
        }

        publicInput.lastGuess.assertEquals(guess); // Set lastGuess to new guess
      },
    },

    // @method publishHint(solutionInstance: Pegs)
    publishHint: {
      privateInputs: [Pegs, SelfProof],

      method(
        publicInput: MastermindState,
        solutionInstance: Pegs,
        previousProof: SelfProof<MastermindState>
      ) {
        previousProof.verify();

        let turnNumber = previousProof.publicInput.turnNumber; // Grab turnNumber from previous proof
        // There is no need to check that it's the code generators turn because
        // their behavior is entirely determined by the last guess.
        // If code generator calls publishHint five times in a row nothing will
        // change after the first time.
        publicInput.turnNumber.assertEquals(turnNumber.add(UInt32.one)); // Increment turn number

        // let guess = [...this.lastGuess.get().value];
        let guess = [...previousProof.publicInput.lastGuess.value];
        let solution = [...solutionInstance.value];

        let redPegs = Field.zero;
        let whitePegs = Field.zero;

        // Check that solution instance matches the one the code generator
        // committed to when they deployed the contract.
        // let solutionHash = this.solutionHash.get();
        let solutionHash = previousProof.publicInput.solutionHash;
        solutionHash.assertEquals(solutionInstance.hash());

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
            let isNotRedPeg = guess[i].gt(Field.zero);
            // If the pegs in these locations exist and they are the same color
            // then we should add a white peg
            let isWhitePeg = isCorrectColor.and(isNotRedPeg);
            whitePegs = Circuit.if(
              isWhitePeg,
              whitePegs.add(Field.one),
              whitePegs
            );
            // Set the values in guess[i] and solution[i] to zero (remove pegs) so that they wont be counted again
            guess[i] = Circuit.if(isWhitePeg, Field.zero, guess[i]);
            solution[j] = Circuit.if(isWhitePeg, Field.zero, solution[j]);
          }
        }

        // Update red and white peg counts
        // this.redPegs.set(redPegs);
        // this.whitePegs.set(whitePegs);
        publicInput.redPegs.assertEquals(redPegs);
        publicInput.whitePegs.assertEquals(whitePegs);
      },
    },
  },
});
