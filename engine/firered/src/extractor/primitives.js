function tokenizeExpression(expression) {
  const tokens = [];
  const pattern = /\s*(?:(0[xX][0-9a-fA-F]+|\d+)(?:[uUlL]+)?|([A-Za-z_]\w*)|(<<|>>|[()+\-*/%|&^~]))/gy;
  let offset = 0;

  while (offset < expression.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match || match.index !== offset) {
      throw new SyntaxError(`unsupported C expression near ${expression.slice(offset)}`);
    }
    tokens.push(match[1] ? { type: "number", value: match[1] } : match[2] ? { type: "identifier", value: match[2] } : { type: "operator", value: match[3] });
    offset = pattern.lastIndex;
  }

  return tokens;
}

function evaluateExpression(expression, values) {
  const tokens = tokenizeExpression(expression);
  let cursor = 0;

  function take(value) {
    if (tokens[cursor]?.value !== value) return false;
    cursor += 1;
    return true;
  }

  function primary() {
    const token = tokens[cursor];
    if (!token) throw new SyntaxError("unexpected end of C expression");
    if (take("(")) {
      const value = bitwiseOr();
      if (!take(")")) throw new SyntaxError("missing closing parenthesis");
      return value;
    }
    cursor += 1;
    if (token.type === "number") return Number.parseInt(token.value, 0);
    if (token.type === "identifier" && values.has(token.value)) {
      return values.get(token.value);
    }
    throw new ReferenceError(`unresolved C identifier ${token.value}`);
  }

  function unary() {
    if (take("+")) return unary();
    if (take("-")) return -unary();
    if (take("~")) return ~unary();
    return primary();
  }

  function multiplicative() {
    let value = unary();
    for (;;) {
      if (take("*")) value *= unary();
      else if (take("/")) value = Math.trunc(value / unary());
      else if (take("%")) value %= unary();
      else return value;
    }
  }

  function additive() {
    let value = multiplicative();
    for (;;) {
      if (take("+")) value += multiplicative();
      else if (take("-")) value -= multiplicative();
      else return value;
    }
  }

  function shift() {
    let value = additive();
    for (;;) {
      if (take("<<")) value <<= additive();
      else if (take(">>")) value >>= additive();
      else return value;
    }
  }

  function bitwiseAnd() {
    let value = shift();
    while (take("&")) value &= shift();
    return value;
  }

  function bitwiseXor() {
    let value = bitwiseAnd();
    while (take("^")) value ^= bitwiseAnd();
    return value;
  }

  function bitwiseOr() {
    let value = bitwiseXor();
    while (take("|")) value |= bitwiseXor();
    return value;
  }

  const value = bitwiseOr();
  if (cursor !== tokens.length) {
    throw new SyntaxError(`unconsumed C expression token ${tokens[cursor].value}`);
  }
  return value;
}

function stripCComments(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");
}

export function parseNumericDefines(text, initialValues = {}) {
  const logicalLines = stripCComments(text).replaceAll(/\\\r?\n/g, " ").split(/\r?\n/);
  const expressions = new Map();

  for (const line of logicalLines) {
    const match = line.match(/^\s*#define\s+([A-Za-z_]\w*)\s+(.+?)\s*$/);
    if (!match) continue;
    expressions.set(match[1], match[2]);
  }

  const values = new Map(
    initialValues instanceof Map
      ? initialValues
      : Object.entries(initialValues).map(([name, value]) => [
          name,
          typeof value === "object" && value !== null ? value.value : value,
        ]),
  );
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;
    for (const [name, expression] of expressions) {
      if (values.has(name)) continue;
      try {
        values.set(name, evaluateExpression(expression, values));
        madeProgress = true;
      } catch {
        // Another pass can resolve aliases after their dependencies are known.
      }
    }
  }

  return Object.fromEntries(
    [...expressions]
      .filter(([name]) => values.has(name))
      .map(([name, expression]) => [name, { expression, value: values.get(name) }]),
  );
}

export function decodeMapGrid(bytes, width, height) {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new TypeError("map grid width and height must be positive integers");
  }
  const buffer = Buffer.from(bytes);
  const expectedBytes = width * height * 2;
  if (buffer.byteLength !== expectedBytes) {
    throw new RangeError(
      `map grid byte length ${buffer.byteLength} does not match ${expectedBytes}`,
    );
  }

  const cells = [];
  for (let offset = 0; offset < buffer.byteLength; offset += 2) {
    const word = buffer.readUInt16LE(offset);
    cells.push({
      metatileId: word & 0x03ff,
      collision: (word & 0x0c00) >>> 10,
      elevation: (word & 0xf000) >>> 12,
    });
  }

  return { width, height, cells };
}

export function decodeMetatileAttributes(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength % 4 !== 0) {
    throw new RangeError("metatile attribute byte length must be a multiple of 4");
  }

  const attributes = [];
  for (let offset = 0; offset < buffer.byteLength; offset += 4) {
    const raw = buffer.readUInt32LE(offset);
    attributes.push({
      raw,
      behavior: raw & 0x000001ff,
      terrain: (raw & 0x00003e00) >>> 9,
      attribute2: (raw & 0x0003c000) >>> 14,
      attribute3: (raw & 0x00fc0000) >>> 18,
      encounterType: (raw & 0x07000000) >>> 24,
      attribute5: (raw & 0x18000000) >>> 27,
      layerType: (raw & 0x60000000) >>> 29,
      attribute7: (raw & 0x80000000) >>> 31,
    });
  }
  return attributes;
}

function findClosingBrace(text, openingIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openingIndex; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return index;
  }
  throw new SyntaxError("unclosed designated initializer");
}

function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  let curly = 0;
  let round = 0;
  let square = 0;
  let quote = null;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") curly += 1;
    else if (character === "}") curly -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "," && curly === 0 && round === 0 && square === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseCValue(source) {
  const value = source.trim();
  if (value.startsWith("{") && value.endsWith("}")) {
    return splitTopLevel(value.slice(1, -1)).map(parseCValue);
  }
  if (/^-?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)$/.test(value)) {
    return Number(value);
  }
  const translatedString = value.match(/^_\("((?:\\.|[^"\\])*)"\)$/s);
  if (translatedString) return JSON.parse(`"${translatedString[1]}"`);
  if (/^[A-Za-z_]\w*$/.test(value)) return value;

  const call = value.match(/^([A-Za-z_]\w*)\((.*)\)$/s);
  if (call) {
    return {
      call: call[1],
      args: splitTopLevel(call[2]).map(parseCValue),
    };
  }
  return value.replaceAll(/\s+/g, " ");
}

function parseInitializerBody(body) {
  const fields = {};
  for (const part of splitTopLevel(body.replaceAll(/^\s*#.*$/gm, ""))) {
    const match = part.match(/^\.([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
    if (match) fields[match[1]] = parseCValue(match[2]);
  }
  if (Object.keys(fields).length === 0) {
    const value = body.trim();
    return value ? { value: parseCValue(value) } : {};
  }
  return fields;
}

export function parseDesignatedInitializers(text, keyPrefix = "") {
  const source = stripCComments(text);
  const pattern = /\[\s*([A-Za-z_]\w*)\s*\]\s*=\s*/g;
  const entries = {};
  let match;

  while ((match = pattern.exec(source))) {
    const key = match[1];
    if (!key.startsWith(keyPrefix)) continue;
    const valueStart = pattern.lastIndex;
    if (source[valueStart] === "{") {
      const closingIndex = findClosingBrace(source, valueStart);
      pattern.lastIndex = closingIndex + 1;
      entries[key] = parseInitializerBody(
        source.slice(valueStart + 1, closingIndex),
      );
      continue;
    }

    const remainder = source.slice(valueStart);
    const [value] = splitTopLevel(remainder);
    if (value) {
      entries[key] = { value: parseCValue(value.replace(/\s*};?\s*$/, "")) };
      pattern.lastIndex = valueStart + value.length;
    }
  }
  return entries;
}

export function parseNamedInitializerArrays(text, keyPrefix = "") {
  const source = stripCComments(text);
  const pattern = /(?:static\s+)?const\s+struct\s+\w+\s+([A-Za-z_]\w*)\s*\[\s*\]\s*=\s*\{/g;
  const arrays = {};
  let match;

  while ((match = pattern.exec(source))) {
    const name = match[1];
    const openingIndex = pattern.lastIndex - 1;
    const closingIndex = findClosingBrace(source, openingIndex);
    pattern.lastIndex = closingIndex + 1;
    if (!name.startsWith(keyPrefix)) continue;
    arrays[name] = splitTopLevel(
      source.slice(openingIndex + 1, closingIndex),
    ).map((entry) => {
      const trimmed = entry.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        return parseInitializerBody(trimmed.slice(1, -1));
      }
      return { value: parseCValue(trimmed) };
    });
  }
  return arrays;
}
