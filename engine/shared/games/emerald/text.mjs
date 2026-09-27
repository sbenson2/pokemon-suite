// Gen III character decoding, derived from the pinned pokeemerald charmap.
import { readAdapterFile } from '../../shared/adapter-resources.mjs';

const FALLBACK = new Map([[0x00, ' '], [0xa1, '0'], [0xbb, 'A'], [0xd5, 'a'], [0xff, '']]);

export function parseCharmap(text) {
  const table = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^'((?:\\.|[^'\\])+)'\s*=\s*([0-9A-Fa-f]{2})(?:\s|$)/);
    if (!match) continue;
    const code = Number.parseInt(match[2], 16);
    let glyph = match[1];
    if (glyph === '\\n' || glyph === '\\l' || glyph === '\\p') glyph = ' ';
    else if (glyph.startsWith('\\')) glyph = glyph.slice(1);
    if (!table.has(code)) table.set(code, glyph);
  }
  return table;
}

let cached = null;

export async function loadCharmap() {
  if (cached) return cached;
  try {
    cached = parseCharmap(await readAdapterFile('pokeemerald/charmap.txt'));
  } catch {
    cached = FALLBACK;
  }
  return cached;
}

/** Decodes a fixed-width Gen III string, stopping at the 0xFF terminator. */
export function decodeGen3Text(bytes, charmap = cached ?? FALLBACK) {
  let out = '';
  for (const byte of bytes) {
    if (byte === 0xff) break;
    if (byte === 0xfc || byte === 0xfd) { out += '?'; continue; }
    const glyph = charmap.get(byte);
    if (glyph === undefined) { out += '?'; continue; }
    if (byte === 0xbb + 26 * 0 && glyph === 'A' && charmap === FALLBACK) { out += String.fromCharCode(65 + (byte - 0xbb)); continue; }
    out += glyph;
  }
  return out.trim();
}
