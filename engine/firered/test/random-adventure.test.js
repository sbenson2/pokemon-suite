import assert from "node:assert/strict";
import test from "node:test";
import { createFireRedRosterContext } from "../src/player/fire-red-roster.js";
import { createRosterPlanForRun, rosterCheckpoint } from "../src/player/roster-selection.js";
import { createMasterCampaign, isHmUtilityCarrier } from "../src/player/campaign.js";
import { rosterContextFixture } from "../test-support/roster-context-fixture.js";

function lateTeamContext() {
  const fixture = rosterContextFixture();
  for (const p of Object.values(fixture.facts.species)) p.fieldCapabilities = [];
  fixture.facts.species[16].fieldCapabilities = ["cut", "fly", "strength"];
  fixture.facts.species[19].fieldCapabilities = ["surf", "strength"];
  return createFireRedRosterContext(fixture);
}
const lateIds = [48, 102, 111, 113, 115].map(id => `native-${id}`);

test("random adventure retains a drawn late team without forcing HM carriers into its six", () => {
  const context = lateTeamContext();
  assert.equal(typeof context.createRandomTeamPlan, "function", "random selection must be independent of balanced rejection");
  const plan = context.createRandomTeamPlan(7, 123, 42, lateIds);
  assert.deepEqual([...plan.hallOfFameSpecies].sort((a,b) => a-b), [9,48,102,111,113,115]);
  assert.equal(context.evaluate(plan).viable, false, "this intentionally fails the old balanced policy");
  assert.ok(plan.utilityAcquisitions.length > 0);
  assert.ok(plan.temporaryAcquisitions.length > 0, "a late team has a declared early combat helper");
  for (const helper of [...plan.utilityAcquisitions, ...plan.temporaryAcquisitions]) {
    assert.ok(!plan.permanentFamilies.some(f => f.some(id => helper.family.includes(id))));
  }
  const campaign = createMasterCampaign(plan);
  const ids = campaign.objectives.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const helper of [...plan.utilityAcquisitions, ...plan.temporaryAcquisitions]) {
    assert.ok(campaign.objectives.some(o => o.acquisitionId === helper.id), `missing helper acquisition ${helper.id}`);
  }
  const beforeSurf = campaign.objectives.find(o => o.id === "assemble-permanent-roster");
  assert.ok(beforeSurf.target.requiredFamilies.some(f => f.includes(19)), "assembly retains the Surf helper");
  assert.ok(beforeSurf.target.requiredFamilies.length <= 6);
  const league = campaign.objectives.find(o => o.id === "assemble-league-roster");
  assert.deepEqual(league.target.requiredFamilies, plan.permanentFamilies, "helpers retire before the League");
});

test("strict random six reports missing field capabilities instead of changing the drawn team", () => {
  const context = lateTeamContext();
  assert.equal(typeof context.createRandomTeamPlan, "function");
  assert.throws(() => context.createRandomTeamPlan(7, 123, 42, lateIds, { helpers: "none" }), /helper|field move/i);
});

test("random draw samples families once even when one family has many branches", () => {
  const fixture = rosterContextFixture();
  const context = createFireRedRosterContext(fixture);
  assert.equal(typeof context.createRandomTeamPlan, "function");
  let pikachu = 0, rattata = 0;
  const lineups = new Set();
  for (let seed = 0; seed < 600; seed++) {
    const plan = context.createRandomTeamPlan(1, 123, seed);
    pikachu += Number(plan.acquisitions.some(a => a.family.includes(25)));
    rattata += Number(plan.acquisitions.some(a => a.family.includes(19)));
    lineups.add([...plan.hallOfFameSpecies].sort((a,b) => a-b).join(","));
    assert.equal(new Set(plan.acquisitions.map(a => a.familyKey)).size, 5);
  }
  assert.ok(pikachu > 40 && rattata > 40);
  assert.ok(pikachu / rattata > 0.65 && pikachu / rattata < 1.45, `branch family ${pikachu}, single choice ${rattata}`);
  assert.ok(lineups.size > 550);
});

test("random roster checkpoints reconstruct the same six and reject seed or mode changes", () => {
  const context = createFireRedRosterContext(rosterContextFixture());
  const options = { rosterMode: "random", teamSeed: 678, rosterContext: context };
  const plan = createRosterPlanForRun(4, 123, null, options);
  const checkpoint = rosterCheckpoint(plan);
  const resumed = createRosterPlanForRun(4, 123, checkpoint, { rosterContext: context });
  assert.deepEqual(resumed, plan);
  assert.throws(() => createRosterPlanForRun(4, 123, checkpoint, { ...options, teamSeed: 679 }), /seed cannot change/);
  assert.throws(() => createRosterPlanForRun(4, 123, checkpoint, { ...options, rosterMode: "coherent" }), /mode cannot change/);
});

test("a permanent combatant stays eligible when its assigned moves include multiple HMs", () => {
  const member = { species: 9, moves: [57,70,55,33] };
  assert.equal(isHmUtilityCarrier(member, { permanentFamilies: [[7,8,9]], utilityAcquisitions: [] }), false);
  assert.equal(isHmUtilityCarrier(member, { permanentFamilies: [[1,2,3]], utilityAcquisitions: [{family:[7,8,9]}] }), true);
});

test('a gifted field helper stays temporary throughout its party and acquisition objectives',()=>{
 const fixture=rosterContextFixture();
 for(const p of Object.values(fixture.facts.species))p.fieldCapabilities=[];
 fixture.facts.species[16].fieldCapabilities=['cut','fly','strength'];
 fixture.facts.species[131].fieldCapabilities=['surf','strength'];
 fixture.world.maps.push({id:'MAP_SILPH_CO_7F',objectEvents:[]});
 const plan=createFireRedRosterContext(fixture).createRandomTeamPlan(7,123,42,lateIds,{helpers:'field-only'});
 assert.ok(plan.utilityAcquisitions.some(a=>a.id==='helper-lapras'));
 const objectives=createMasterCampaign(plan).objectives;
 for(const id of ['prepare-lapras-party-space','ensure-lapras-party','gift-lapras']){
  const objective=objectives.find(o=>o.id===id);
  assert.equal(objective.acquisitionId,'helper-lapras');
  assert.equal(objective.permanentRoster,false);
 }
});
