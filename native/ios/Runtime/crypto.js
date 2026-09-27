import {sha256} from '@noble/hashes/sha2.js';
import {sha1} from '@noble/hashes/legacy.js';
import {Buffer} from 'buffer';

export function createHash(algorithm){
 const implementation={sha256,sha1}[algorithm];
 if(!implementation)throw new Error(`Unsupported Suite digest: ${algorithm}`);
 const hash=implementation.create();
 return {update(value){hash.update(typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value));return this;},
  digest(encoding){const result=Buffer.from(hash.digest());return encoding?result.toString(encoding):result;}};
}
export function randomBytes(count){
 if(!Number.isSafeInteger(count)||count<0||count>65536)throw new RangeError('Invalid random byte count.');
 return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(count)));
}
export function randomUUID(){return globalThis.crypto.randomUUID();}
