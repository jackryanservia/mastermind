import {
  Bool,
  isReady,
  method,
  Mina,
  Party,
  PrivateKey,
  Proof,
  shutdown,
  SmartContract,
  State,
  state,
} from 'snarkyjs';

import {
  Pegs,
  Mastermind,
  MastermindHelper,
  MastermindState,
} from './Mastermind-recursive.js';
import { tic, toc } from './tictoc.js';

await isReady;

tic('compiling');
await Mastermind.compile();
toc();

let solution = new Pegs([1, 2, 3, 6]);

// initialize (== create the first proof)
tic('prove (init)');
let initialState = MastermindHelper.init(solution);
let initialProof = await Mastermind.init(initialState, solution); // <-- no class instantiation, just calling a function to create proof
toc();

console.log('Proof state initialized!');

// to make a guess, a user would fetch the initial proof from a server, and then run this:

tic('prove (guess)');
let guess = new Pegs([6, 2, 1, 3]);
let userState = MastermindHelper.publishGuess(guess, initialProof);
let userProof = await Mastermind.publishGess(userState, guess, initialProof);
toc();

console.log('Guess Valid!');

// user would now post the userProof to the server, and wait for it to publish a hint in form of another proof

tic('prove (hint)');
let serverState = MastermindHelper.publishHint(solution, userProof);
let serverProof = await Mastermind.publishHint(
  serverState,
  solution,
  userProof
);
toc();

console.log('Red: ' + serverProof.publicInput.redPegs.toString());
console.log('White: ' + serverProof.publicInput.whitePegs.toString());

// back to the user, who makes another guess:

tic('prove (guess)');
guess = new Pegs([1, 2, 3, 6]);
userState = MastermindHelper.publishGuess(guess, serverProof);
userProof = await Mastermind.publishGess(userState, guess, serverProof);
toc();

console.log('Guess Valid!');

// server published another hint:

tic('prove (hint)');
serverState = MastermindHelper.publishHint(solution, userProof);
let finalProof = await Mastermind.publishHint(serverState, solution, userProof);
toc();

console.log('Red: ' + finalProof.publicInput.redPegs.toString());
console.log('White: ' + finalProof.publicInput.whitePegs.toString());

console.log('Got final proof!');

// the serverProof that we have now has a publicInput with redPegs === 4, which means the game is won
// if you verify it, you *know* that someone ran the methods above to produce this winning state

// so.. what can we do with a proof like this?
// we can verify it in a SmartContract!!

// class that describes the rolled up proof
class MastermindProof extends Proof<MastermindState> {
  static publicInputType = MastermindState;
  static tag = () => Mastermind;
}

class MastermindRollup extends SmartContract {
  @state(Bool) someoneWon = State<Bool>();

  @method publishCompletedGame(
    proof: MastermindProof // <-- we're passing in a proof!
  ) {
    // verify the proof
    proof.verify();

    // check that there are 4 red pegs
    proof.publicInput.redPegs.assertEquals(4);

    // declare that someone won this game!
    this.someoneWon.set(Bool(true));
  }
}

// cool, now that we have this smart contract, let's deploy it & execute it's only method with our rollup proof as input

let zkAppPrivateKey = PrivateKey.random();
let zkAppAddress = zkAppPrivateKey.toPublicKey();
let zkapp = new MastermindRollup(zkAppAddress);

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
const publisherAccount = Local.testAccounts[0].privateKey;

// deploy
tic('compile & deploy rollup');
await MastermindRollup.compile(zkAppAddress);
let tx = await Mina.transaction(publisherAccount, () => {
  Party.fundNewAccount(publisherAccount);
  zkapp.deploy({ zkappKey: zkAppPrivateKey });
});
await tx.send().wait();
toc();

// prove that we have a proof that shows that we won
tic('prove (rollup)');
tx = await Mina.transaction(publisherAccount, () => {
  // call out method with final proof from the ZkProgram as argument
  zkapp.publishCompletedGame(finalProof);
});
await tx.prove();
await tx.send().wait();
toc();

console.log('Did someone win?', zkapp.someoneWon.get().toBoolean());

// this was only a single transaction, which proves the same thing as the many transactions in the non-recursive example!

shutdown();
