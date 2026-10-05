// LeafGreen's postgame goal (build 124): "catch all the Pokémon" is per game,
// every species catchable in LeafGreen, computed from LeafGreen's own tables by
// the same derivation as FireRed's goal (scripts/derive-leafgreen-catchable.py;
// with --version firered it reproduces the FireRed goal file exactly).
import assert from "node:assert/strict";
import test from "node:test";
import goal from "../src/suite/leafgreen-catchable.json" with { type: "json" };
import { LEAFGREEN_CATCHABLE, catchableGoal, catchableProgress } from "../src/suite/catchable-goal.js";
import { fireRedProgress } from "../src/suite/game-progress.js";

test("LeafGreen's goal comes from its own wild tables, prizes and trades", () => {
  assert.equal(goal.schema, "pokemon-suite/leafgreen-catchable/v1");
  assert.equal(goal.source.commit, "c75f352304d529f6ba92d4f74b9cf8b5c3810788");
  assert.equal(goal.total, 190);
  assert.equal(LEAFGREEN_CATCHABLE.length, 190);
  const ids = new Set(LEAFGREEN_CATCHABLE);
  // LeafGreen exclusives and their evolutions are in; FireRed's are not.
  for (const id of [27, 37, 69, 79, 120, 126, 127, 183, 199, 215, 226, 240, 298]) assert.ok(ids.has(id), `#${id} is catchable in LeafGreen`);
  for (const id of [23, 43, 54, 58, 90, 123, 125, 182, 212, 227, 239]) assert.ok(!ids.has(id), `#${id} is FireRed-only`);
  // LeafGreen's Game Corner prizes and in-game trades (their LEAFGREEN branches).
  assert.match(goal.source.sources.prize, /LEAFGREEN/);
  assert.deepEqual(goal.species.find(s => s.id === 127).via, ["breeding", "prize", "wild-land"]);
  assert.ok(goal.species.find(s => s.id === 33).via.includes("trade"), "Nidorino is LeafGreen's Route 11 trade");
  // Events and other games are outside the goal.
  for (const id of [151, 249, 250, 251, 385, 386]) assert.ok(!ids.has(id));
  assert.equal(goal.species.filter(s => s.onePerSave).length, 10);
});

test("LeafGreen progress reads the Pokédex's National Dex owned flags against its goal", () => {
  // build 126: FireRed's goal is the collection work's firered-catchable.json.
  assert.equal(catchableGoal("firered").total, 189);
  assert.equal(catchableProgress("firered", [1, 4, 151]).text, "2 of 189 catchable in FireRed");
  assert.equal(catchableGoal("leafgreen").total, 190);
  const progress = catchableProgress("leafgreen", [1, 2, 27, 23, 151, 298]);
  assert.deepEqual({ ...progress, missing: progress.missing.length },
    { game: "leafgreen", title: "LeafGreen", total: 190, owned: 4, missing: 186, text: "4 of 190 catchable in LeafGreen" });
  assert.equal(catchableProgress("leafgreen", null), null, "an unreadable Pokédex reports nothing");
  assert.throws(() => catchableProgress("emerald", []), /LeafGreen/);
});

test("the owner's game progress carries the LeafGreen goal; FireRed's progress is unchanged", () => {
  const o = { phase: "stable", frame: 7, playerMemory: { storyState: { flagIds: {} }, trainer: { pokedex: { ownedSpecies: [1, 16] } } } };
  const fr = fireRedProgress(o);
  assert.equal(fr.catchable, undefined);
  assert.equal(fr.game, "firered");
  const lg = fireRedProgress(o, "leafgreen");
  assert.equal(lg.game, "leafgreen");
  assert.equal(lg.catchable.text, "2 of 190 catchable in LeafGreen");
  assert.deepEqual({ ...lg, game: "firered", catchable: undefined }, { ...fr, catchable: undefined });
  // Like ownedSpecies beside it, the goal does not blink out during a map transition.
  const moving = fireRedProgress({ ...o, phase: "transition" }, "leafgreen");
  assert.equal(moving.ownedSpecies, 2);
  assert.equal(moving.catchable.text, "2 of 190 catchable in LeafGreen");
  assert.equal(fireRedProgress({ phase: "stable", frame: 1, playerMemory: {} }, "leafgreen").catchable, null);
});
