// FRLG malloc.c: circular, address-ordered blocks with 16-byte headers.
// Read only. A save allocates the 0x19a0-byte Quest Log plus menu windows.
export function readFieldHeap(session, symbols, blocks = new Map()) {
  if (!symbols.sHeapStart || !symbols.sHeapSize) return null;
  const word = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const startBytes = session.readMemory(symbols.sHeapStart.address, 4);
  const sizeBytes = session.readMemory(symbols.sHeapSize.address, 4);
  const start = word(startBytes), size = word(sizeBytes);
  if (start < 0x02000000 || size < 16 || start+size > 0x02040000) return null;
  const heap = new Uint8Array(size), headers = [];
  for (let offset = 0; offset < size; offset += 65536)
    heap.set(session.readMemory(start+offset, Math.min(65536, size-offset)), offset);
  let offset = 0, previous = start, freeBytes = 0, largestFreeBlock = 0;
  while (offset+16 <= size) {
    const v = new DataView(heap.buffer, heap.byteOffset+offset, 16);
    const flag = v.getUint16(0, true), length = v.getUint32(4, true), next = v.getUint32(12, true);
    if (flag > 1 || v.getUint16(2, true) !== 0xa3a3 || v.getUint32(8, true) !== previous ||
        offset+16+length > size) return null;
    headers.push(...heap.subarray(offset, offset+16));
    if (!flag) { freeBytes += length; largestFreeBlock = Math.max(largestFreeBlock, length); }
    if (next === start) {
      if (offset+16+length !== size) return null;
      blocks.set('FieldHeap.headers', new Uint8Array(headers));
      return {validity: 'valid', freeBytes, largestFreeBlock};
    }
    if (next !== start+offset+16+length || next <= start+offset) return null;
    previous = start+offset; offset = next-start;
  }
  return null;
}
