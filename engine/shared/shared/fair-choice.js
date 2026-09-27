import { randomBytes } from "node:crypto";

const secureByte = () => randomBytes(1)[0];

export function drawUniformTicket(sides, nextByte = secureByte) {
  if (!Number.isSafeInteger(sides) || sides < 2 || sides > 256) {
    throw new TypeError("uniform ticket sides must be an integer from 2 through 256");
  }
  if (typeof nextByte !== "function") throw new TypeError("nextByte must be a function");
  const accepted = 256 - (256 % sides);
  for (;;) {
    const byte = nextByte();
    if (!Number.isSafeInteger(byte) || byte < 0 || byte > 255) {
      throw new RangeError("nextByte must return an integer from 0 through 255");
    }
    if (byte < accepted) return byte % sides;
  }
}

export function sampleOpeningTickets(nextByte = secureByte) {
  return Object.freeze({
    genderTicket: drawUniformTicket(2, nextByte),
    starterTicket: drawUniformTicket(3, nextByte),
  });
}

