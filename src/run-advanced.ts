import {
  Field,
  Permissions,
  PrivateKey,
  Mina,
  Party,
  isReady,
  shutdown,
  Bool,
} from 'snarkyjs';
import { Mastermind, Pegs } from './Mastermind-advanced.js';

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

console.log('Contract deployed and initialized!');

let guess = Pegs.from([6, 2, 1, 3]);
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
  zkapp.publishHint(solution, zkappSecret);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

console.log('Red: ' + zkapp.blackPegs.get().toString());
console.log('White: ' + zkapp.whitePegs.get().toString());

guess = Pegs.from([1, 2, 3, 6]);
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
  zkapp.publishHint(solution, zkappSecret);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send().wait();

console.log('Red: ' + zkapp.blackPegs.get().toString());
console.log('White: ' + zkapp.whitePegs.get().toString());

shutdown();
