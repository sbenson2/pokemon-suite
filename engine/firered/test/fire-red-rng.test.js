import assert from "node:assert/strict";
import test from "node:test";

test("the stock-core replay's IV interruption is an explicit conditional variant", async () => {
  const { predictLandGeneration } = await import("../src/rng/fire-red-rng.js");
  const slots = Array.from({ length: 12 }, () => ({ species: 16, minLevel: 3, maxLevel: 3 }));
  const input = { state: 2676765209, otId: 0, slots };
  const ordinary = predictLandGeneration(input);
  const interrupted = predictLandGeneration({ ...input, ivGap: "between-ivs" });
  assert.equal(interrupted.pokemon.personality, 2565724235);
  assert.deepEqual(interrupted.pokemon.ivs, { hp: 4, attack: 18, defense: 21, speed: 20, spAttack: 20, spDefense: 8 });
  assert.equal(interrupted.calls, ordinary.calls + 1);
  assert.notDeepEqual(ordinary.pokemon.ivs, interrupted.pokemon.ivs);
  assert.equal(interrupted.ivGap, "between-ivs");
  const { searchLandCandidates } = await import("../src/rng/fire-red-rng.js");
  const found = await searchLandCandidates({ ...input, maxAdvances: 1, ivGaps: ["none", "between-ivs"],
    matches: (p) => p.personality === interrupted.pokemon.personality && p.ivs.speed === 20 });
  assert.equal(found.status, "candidate");
  assert.equal(found.candidate.ivGap, "between-ivs");
});
import { nextMainRng, nextWildRng, predictLandGeneration, searchLandCandidates } from "../src/rng/fire-red-rng.js";

const slots = Array.from({ length: 12 }, (_, slot) => ({ species: 16 + slot, minLevel: 2, maxLevel: 5 }));
test("FireRed RNG arithmetic agrees with unsigned reference vectors and an independent BigInt oracle", () => {
  let state = 0;
  for (const expected of [24691, 3917380458, 1383151765, 833674724, 2386711175, 3805062638, 2948958921, 1742452232]) {
    state = nextMainRng(state); assert.equal(state, expected);
  }
  assert.equal(nextWildRng(0xffffffff), 3191464396);
  for (const value of [0, 1, 0x7fffffff, 0x80000000, 0xdeadbeef, 0xffffffff]) {
    assert.equal(nextMainRng(value), Number((BigInt(value) * 1103515245n + 24691n) & 0xffffffffn));
  }
  for (const value of [-1, 1.2, 0x100000000, NaN, null, "1"]) assert.throws(() => nextMainRng(value));
});

test("land generation consumes a level draw even for fixed levels, then nature rejection and both IV draws", () => {
  const predicted = predictLandGeneration({ state: 0, otId: 0, slots });
  assert.equal(predicted.validity, "conditional");
  assert.equal(predicted.slot, 0);
  assert.equal(predicted.pokemon.species, 16);
  assert.equal(predicted.pokemon.level, 4);
  assert.equal(predicted.pokemon.nature.id, 5);
  assert.equal(predicted.pokemon.personality, 4231227355);
  assert.deepEqual(predicted.pokemon.ivs, { hp: 12, attack: 25, defense: 27, speed: 30, spAttack: 2, spDefense: 31 });
  assert.equal(predicted.calls, 11);
  assert.equal(predicted.nextState, 4234071101);
  assert.equal(predictLandGeneration({ state: 0, otId: 0, slots: slots.map((slot) => ({ ...slot, minLevel: 3, maxLevel: 3 })) }).pokemon.personality,
    4231227355);
});

test("unsupported generation and capped rejection loops return unknown rather than a plausible result", () => {
  assert.equal(predictLandGeneration({ state: 0, otId: 0, slots, maxNatureAttempts: 1 }).validity, "unknown");
  assert.equal(predictLandGeneration({ state: 0, otId: 0,
    slots: slots.map((slot) => ({ ...slot, species: 201 })) }).validity, "unknown");
  assert.throws(() => predictLandGeneration({ state: 0, otId: 0, slots: [] }));
});

test("candidate searches are bounded, cancellable, and yield without touching an input controller", async () => {
  const controller = new AbortController();
  let yields = 0;
  const found = await searchLandCandidates({ state: 0, otId: 0, slots, maxAdvances: 100, batchSize: 2,
    signal: controller.signal, matches: () => false, yieldTask: async () => { yields++; controller.abort(); } });
  assert.equal(found.status, "cancelled");
  assert.equal(found.searched, 2);
  assert.equal(yields, 1);
  const exhausted = await searchLandCandidates({ state: 0, otId: 0, slots, maxAdvances: 3, matches: () => false });
  assert.equal(exhausted.status, "exhausted");
  assert.equal(exhausted.searched, 3);
  await assert.rejects(searchLandCandidates({ state: 0, otId: 0, slots, maxAdvances: Infinity }), /budget/);
});
test('candidate search filters unreachable timing advances before choosing a target',async()=>{
 const found=await searchLandCandidates({state:0,otId:0,slots,maxAdvances:3,matches:(p,timing)=>timing?.advances===1});
 assert.equal(found.status,'candidate');assert.equal(found.advances,1);
});
