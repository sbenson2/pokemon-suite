function lines(text) {
  if (typeof text !== "string") throw new TypeError("symbol text must be a string");
  return text.split(/\r?\n/);
}

export function parseRgbdsSymbols(text) {
  const result = new Map();
  for (const line of lines(text)) {
    const match = line.trim().match(/^([0-9a-f]{2}):([0-9a-f]{4})\s+(\S+)$/i);
    if (!match) continue;
    result.set(match[3], Object.freeze({
      bank: Number.parseInt(match[1], 16),
      address: Number.parseInt(match[2], 16),
    }));
  }
  return result;
}

export function parseGnuSymbols(text) {
  const result = new Map();
  for (const line of lines(text)) {
    const match = line.trim().match(
      /^([0-9a-f]{8})\s+(\S)\s+([0-9a-f]{8})\s+(\S+)$/i,
    );
    if (!match) continue;
    result.set(match[4], Object.freeze({
      address: Number.parseInt(match[1], 16),
      size: Number.parseInt(match[3], 16),
      scope: match[2],
    }));
  }
  return result;
}

export function requireSymbols(symbols, names) {
  if (!(symbols instanceof Map)) throw new TypeError("symbols must be a Map");
  if (!Array.isArray(names)) throw new TypeError("required symbol names must be an array");
  const result = {};
  for (const name of names) {
    const symbol = symbols.get(name);
    if (!symbol) throw new Error(`missing required symbol ${name}`);
    result[name] = symbol;
  }
  return Object.freeze(result);
}
