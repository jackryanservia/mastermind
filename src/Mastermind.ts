import {
  Field,
  SmartContract,
  method,
  state,
  State,
  CircuitValue,
  arrayProp,
  Poseidon,
  Circuit,
  isReady,
  UInt32,
} from 'snarkyjs';

export { Pegs };

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

export class Mastermind extends SmartContract {
  // Store the last guess so that we can generate a hint for it
  @state(Pegs) lastGuess = State<Pegs>();
  // Store a hash of the solution so that the code generator can't change the
  // code after the contract is deployed.
  @state(Field) solutionHash = State<Field>();
  // The number of red pegs for the last guess
  @state(Field) redPegs = State<Field>();
  // The number of white pegs for the last guess
  @state(Field) whitePegs = State<Field>();
  // The number of turns (will be incremented whenever a player calls
  // publishHint or publishGuess).
  @state(UInt32) turnNumber = State<UInt32>();

  @method init(solution: Pegs) {
    // Check that the solution is valid so the code generator can't create an
    // illegal game.
    for (let i = 0; i < 4; i++) {
      solution.value[i].assertGte(Field.one);
      solution.value[i].assertLte(new Field(6));
    }
    // Store a hash of the solution so the code generator can't change the code // in the middle of the game.
    this.solutionHash.set(solution.hash());
    // Set the initial guess to zeros (absent pegs)
    this.lastGuess.set(new Pegs([0, 0, 0, 0]));
    this.redPegs.set(Field.zero);
    this.whitePegs.set(Field.zero);
    this.turnNumber.set(UInt32.zero);
  }

  @method publishGuess(guess: Pegs) {
    // Grab turnNumber from the Mina network
    let turnNumber = this.turnNumber.get();
    // Check that it's the guesser's turn TODO
    // turnNumber.mod(2).assertEquals(UInt32.zero);
    // Increment the turn number
    this.turnNumber.set(turnNumber.add(UInt32.one));

    // Check that all values are between 1 and 6 (peg configuration is legal)
    for (let i = 0; i < 4; i++) {
      guess.value[i].assertGte(Field.one);
      guess.value[i].assertLte(new Field(6));
    }

    this.lastGuess.set(guess); // Set lastGuess to new guess
  }

  @method publishHint(solutionInstance: Pegs) {
    let turnNumber = this.turnNumber.get(); // Grab turnNumber from Mina network
    // There is no need to check that it's the code generators turn because
    // their behavior is entirely determined by the last guess.
    // If code generator calls publishHint five times in a row nothing will
    // change after the first time.
    this.turnNumber.set(turnNumber.add(UInt32.one)); // Increment turn number

    let guess = [...this.lastGuess.get().value];
    let solution = [...solutionInstance.value];

    let redPegs = Field.zero;
    let whitePegs = Field.zero;

    // Check that solution instance matches the one the code generator
    // committed to when they deployed the contract.
    let solutionHash = this.solutionHash.get();
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
        whitePegs = Circuit.if(isWhitePeg, whitePegs.add(Field.one), whitePegs);
        // Set the values in guess[i] and solution[i] to zero (remove pegs) so that they wont be counted again
        guess[i] = Circuit.if(isWhitePeg, Field.zero, guess[i]);
        solution[j] = Circuit.if(isWhitePeg, Field.zero, solution[j]);
      }
    }

    // Update on-chain red and white peg counts
    this.redPegs.set(redPegs);
    this.whitePegs.set(whitePegs);
  }
}
