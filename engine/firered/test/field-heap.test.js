import assert from 'node:assert/strict';
import test from 'node:test';
import {readFieldHeap} from '../src/evidence/field-heap.js';

test('field heap inspection respects the read bridge limit and reports usable contiguous memory', () => {
  const bytes = new Uint8Array(0x1c000), v = new DataView(bytes.buffer);
  const start = 0x02000000, second = 16+80000;
  v.setUint16(0, 1, true); v.setUint16(2, 0xa3a3, true); v.setUint32(4, 80000, true);
  v.setUint32(8, start, true); v.setUint32(12, start+second, true);
  v.setUint16(second+2, 0xa3a3, true); v.setUint32(second+4, bytes.length-second-16, true);
  v.setUint32(second+8, start, true); v.setUint32(second+12, start, true);
  const word = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const session = { readMemory(address, length) {
    assert.ok(length <= 65536, 'the pinned bridge limits each memory read to 64 KiB');
    if (address === 0x03000000) return word(start);
    if (address === 0x03000004) return word(bytes.length);
    return bytes.slice(address-start, address-start+length);
  } };
  const symbols = {sHeapStart: {address: 0x03000000}, sHeapSize: {address: 0x03000004}};
  const before = bytes.slice();
  assert.deepEqual(readFieldHeap(session, symbols), {validity: 'valid', freeBytes: 34656, largestFreeBlock: 34656});
  assert.deepEqual(bytes, before, 'inspection cannot change cartridge memory');
  v.setUint32(second+12, start+second, true);
  assert.equal(readFieldHeap(session, symbols), null, 'malformed allocator links are not usable save evidence');
});
