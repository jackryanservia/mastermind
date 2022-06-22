import {
  Permissions,
  PrivateKey,
  Mina,
  Party,
  isReady,
  shutdown,
} from 'snarkyjs';
import { Mastermind, Pegs } from './Mastermind.js';

await isReady;

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

let solution = new Pegs([1, 2, 3, 6]);
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

tx = await Mina.transaction(publisherAccount, () => {
  zkapp.init(solution);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

let guess = new Pegs([6, 2, 1, 3]);
tx = await Mina.transaction(publisherAccount, () => {
  zkapp.publishGuess(guess);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

console.log('Guess Valid!');

tx = await Mina.transaction(publisherAccount, () => {
  zkapp.publishHint(solution);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

console.log('Red: ' + zkapp.redPegs.get().toString());
console.log('White: ' + zkapp.whitePegs.get().toString());

guess = new Pegs([1, 2, 3, 6]);
tx = await Mina.transaction(publisherAccount, () => {
  zkapp.publishGuess(guess);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

console.log('Guess Valid!');

tx = await Mina.transaction(publisherAccount, () => {
  zkapp.publishHint(solution);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

console.log('Red: ' + zkapp.redPegs.get().toString());
console.log('White: ' + zkapp.whitePegs.get().toString());

shutdown();