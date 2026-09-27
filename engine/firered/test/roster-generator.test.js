import assert from "node:assert/strict";
import test from "node:test";
import * as generator from "../src/player/roster-generator.js";

const candidates = count => Array.from({ length: count }, (_, id) => ({ id: `member-${id}`, familyKey: `family-${id}` }));

test("generation has no recipe ceiling and samples the supplied game's candidates", () => {
  assert.equal(typeof generator.createRosterGenerator, "function");
  const roster = generator.createRosterGenerator({ gameId: "fixture-game", candidates: candidates(52), slots: 5 });
  assert.equal(roster.rawCombinationCount, "2598960");
  const selected = new Set(), members = new Set();
  for (let seed = 0; seed < 512; seed++) {
    const first = roster.select(seed);
    assert.deepEqual(first, roster.select(seed));
    assert.equal(first.members.length, 5);
    assert.equal(new Set(first.members.map(x => x.id)).size, 5);
    selected.add(first.members.map(x => x.id).sort().join());
    first.members.forEach(x => members.add(x.id));
  }
  assert.ok(selected.size > 450, `${selected.size} distinct teams`);
  assert.equal(members.size, 52, "no handpicked favorites or fixed support slots");
});

test("the game supplies coherence rules, and an empty viable space fails explicitly", () => {
  assert.equal(typeof generator.createRosterGenerator, "function");
  const roster = generator.createRosterGenerator({ gameId: "another-game", candidates: candidates(4), slots: 2,
    acceptTeam: team => team.some(x => x.id === "member-3") });
  const reached = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const selected = roster.select(seed);
    assert.ok(selected.members.some(x => x.id === "member-3"));
    reached.add(selected.members.map(x => x.id).sort().join());
  }
  assert.deepEqual([...reached].sort(), ["member-0,member-3", "member-1,member-3", "member-2,member-3"]);
  assert.throws(() => generator.createRosterGenerator({ gameId: "empty", candidates: candidates(3), slots: 2,
    acceptTeam: () => false }).select(1), /no viable/i);
});

test("mutually exclusive evolution paths or gifts cannot occupy two slots", () => {
  assert.equal(typeof generator.createRosterGenerator, "function");
  const roster = generator.createRosterGenerator({ gameId: "branching-game", slots: 2,
    candidates: [{ id: "a", familyKey: "shared" }, { id: "b", familyKey: "shared" }, { id: "c", familyKey: "other" }] });
  for (let seed = 0; seed < 20; seed++) assert.ok(roster.select(seed).members.some(x => x.id === "c"));
});

test("large reproducible seed tokens and large search spaces do not truncate to uint32", () => {
  assert.equal(typeof generator.createRosterGenerator, "function");
  const roster = generator.createRosterGenerator({ gameId: "large-game", candidates: candidates(1000), slots: 5 });
  assert.equal(roster.rawCombinationCount, "8250291250200");
  const seed = `hex:${"0123456789abcdef".repeat(4)}`;
  assert.deepEqual(roster.select(seed), roster.select(seed));
  assert.notDeepEqual(roster.select(seed).members, roster.select(`hex:${"fedcba9876543210".repeat(4)}`).members);
});

test("catalog order does not silently change a seeded selection", () => {
  assert.equal(typeof generator.createRosterGenerator, "function");
  const values = candidates(20);
  const a = generator.createRosterGenerator({ gameId: "stable-game", candidates: values, slots: 5 });
  const b = generator.createRosterGenerator({ gameId: "stable-game", candidates: [...values].reverse(), slots: 5 });
  assert.deepEqual(a.select(15), b.select(15));
  assert.throws(() => generator.createRosterGenerator({ gameId: "bad", candidates: [values[0], values[0]], slots: 2 }), /unique/i);
});
