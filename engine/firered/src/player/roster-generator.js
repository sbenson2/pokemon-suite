import { createHash } from "node:crypto";

export function normalizeTeamSeed(seed) {
  if (Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff) return seed;
  if (typeof seed === "string" && /^hex:[0-9a-f]{64}$/i.test(seed)) return seed.toLowerCase();
  throw new TypeError("team seed must be a uint32 or hex: followed by 64 hexadecimal digits");
}

// Each family gets one ticket; branches are drawn only after choosing families.
// Rejection is reserved for structural acquisition conflicts, never team strength.
export function drawRandomFamilies({ candidates, seed, scope, slots = 5, accept = () => true }) {
  const normalized = normalizeTeamSeed(seed);
  const grouped = new Map();
  for (const candidate of [...candidates].sort((a,b) => a.id.localeCompare(b.id))) {
    const key = candidate.familyKey ?? candidate.id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(candidate);
  }
  const families = [...grouped.values()];
  if (families.length < slots) throw new Error("not enough eligible families for the requested team");
  let counter = 0;
  const below = limit => {
    const n = BigInt(limit), ceiling = (1n << 256n) - (1n << 256n) % n;
    for (;;) {
      const value = BigInt(`0x${createHash("sha256").update(`random-families:v1:${scope}:${normalized}:${counter++}`).digest("hex")}`);
      if (value < ceiling) return Number(value % n);
    }
  };
  for (let attempt = 0; attempt < 10000; attempt++) {
    const pool = [...families], selected = [];
    for (let slot = 0; slot < slots; slot++) {
      const [family] = pool.splice(below(pool.length), 1);
      selected.push(family[below(family.length)]);
    }
    if (accept(selected)) return selected;
  }
  throw new Error("no compatible random acquisition combination found in the selected pool");
}

function choose(n, k) {
  let value = 1n;
  for (let i = 1; i <= k; i++) value = value * BigInt(n - i + 1) / BigInt(i);
  return value;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

// No recipe list and no enumeration of the whole combinatorial space. A seed
// determines a traversal of combination ranks; a coprime stride visits every
// rank at most once, so rejection never silently falls back to a canned team.
// The adapter owns game rules. Counts/ranks use BigInt, not 32-bit arithmetic.
export function createRosterGenerator({ gameId, candidates, slots = 5, acceptTeam = () => true }) {
  if (typeof gameId !== "string" || !gameId || !Array.isArray(candidates) ||
      !Number.isInteger(slots) || slots < 1 || candidates.length < slots || typeof acceptTeam !== "function") {
    throw new TypeError("invalid game roster generator inputs");
  }
  if (candidates.some(x => typeof x?.id !== "string" || !x.id) || new Set(candidates.map(x => x.id)).size !== candidates.length) {
    throw new TypeError("roster candidates must have unique stable ids");
  }
  const ordered = [...candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const total = choose(ordered.length, slots);
  const counts = new Map();
  const combinations = (n, k) => {
    const key = `${n}:${k}`;
    if (!counts.has(key)) counts.set(key, choose(n, k));
    return counts.get(key);
  };
  const unrank = rank => {
    const members = [];
    for (let start = 0, remaining = slots; remaining; remaining--) {
      for (let index = start; index <= ordered.length - remaining; index++) {
        const block = combinations(ordered.length - index - 1, remaining - 1);
        if (rank < block) { members.push(ordered[index]); start = index + 1; break; }
        rank -= block;
      }
    }
    return members;
  };
  return Object.freeze({ gameId, candidateCount: ordered.length, rawCombinationCount: String(total),
    select(seed) {
      const normalized = normalizeTeamSeed(seed);
      const hash = label => BigInt(`0x${createHash("sha256").update(`pokemon-roster:v2:${gameId}:${normalized}:${label}`).digest("hex")}`);
      let rank = hash("rank") % total;
      let stride = hash("stride") % total || 1n;
      while (gcd(stride, total) !== 1n) stride++;
      for (let tried = 0n; tried < total; tried++, rank = (rank + stride) % total) {
        const members = unrank(rank);
        if (new Set(members.map(x => x.familyKey ?? x.id)).size !== slots) continue;
        const exclusive = members.flatMap(x => x.exclusiveKeys ?? []);
        if (new Set(exclusive).size !== exclusive.length) continue;
        if (acceptTeam(members) === true) return Object.freeze({ members: Object.freeze(members),
          rank: String(rank), testedCombinations: String(tried + 1n) });
      }
      throw new Error(`no viable roster for ${gameId}; all ${total} combinations rejected`);
    },
  });
}
