import assert from "node:assert/strict";
import test from "node:test";
import * as runs from "../src/suite/campaign-run.js";
import { createFireRedRosterContext } from "../src/player/fire-red-roster.js";
import { rosterContextFixture } from "../test-support/roster-context-fixture.js";

const context = () => createFireRedRosterContext(rosterContextFixture());
const draft = delta => ({ label: "My FireRed adventure", starter: "squirtle", teamMode: "random", helpers: "allowed", seedMode: "fresh", seed: null, teamSeed: null, ...delta });

test('new runs continue into postgame by default and can explicitly wait at the League boundary',()=>{
 assert.equal(runs.validateRunSettings(draft()).afterCampaign,'postgame');
 assert.equal(runs.validateRunSettings(draft({afterCampaign:'wait'})).afterCampaign,'wait');
 assert.throws(()=>runs.validateRunSettings(draft({afterCampaign:'restart-save'})),/after|postgame|League/i);
});

test('campaign presentation distinguishes measured trainee XP from the location estimate',()=>{
  const record=runs.createCampaignRun({settings:draft(),rosterContext:context()});
  const state={player:{campaignPlanner:{commitments:{training:{target:{map:'MAP_ROUTE1'},trainingSpecies:7,
    trainingRate:{xpPerMinute:180,measuredXpPerMinute:165,basis:'measured-and-estimated'}}}}}};
  const publicRun=runs.presentCampaignRun(record,state);
  assert.equal(publicRun.training?.measuredXpPerMinute,165);
  assert.equal(publicRun.training?.estimatedXpPerMinute,180);
  state.player.campaignPlanner.commitments.training={target:{map:'MAP_ROUTE1'},trainingSpecies:7};
  state.player.campaignPlanner.trainingMeasurements={active:{key:'current'},samples:{current:{experience:120,activeMs:30000,frames:1800,battles:2}}};
  assert.equal(runs.presentCampaignRun(record,state).training?.measuredXpPerMinute,240);
});

function observation(frame, memory = {}, emulator = {}) {
  const captureId=`capture-${frame}`;
  return {captureId,frame,phase:"stable",phaseReasons:[],sram:{captureId,frame,sha256:"sram"},
    emulator:{mode:"overworld",inputReady:true,callback2:"CB2_Overworld",...emulator,captureId,frame},
    playerMemory:{sha256:"memory",map:{id:"MAP_ROUTE1"},position:{x:1,y:1},
      trainer:{usablePartyCount:1,party:[]},ui:{},...memory,captureId,frame}};
}

test("creating new runs draws fresh identities and teams with the selected starter", () => {
  const rosterContext = context();
  const first = runs.createCampaignRun({ settings: draft(), rosterContext });
  const second = runs.createCampaignRun({ settings: draft(), rosterContext });
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.teamSeed, second.teamSeed);
  assert.equal(first.runProfile.starter.species, 7);
  assert.equal(second.runProfile.starter.species, 7);
  assert.equal(first.teamPlan.rosterSelection.mode, "random");
  assert.equal(first.teamPlan.hallOfFameSpecies.length, 6);
});

test("explicit replay reproduces the roster without reusing the original save identity", () => {
  const rosterContext = context(), settings = draft({ seedMode: "replay", seed: 123, teamSeed: "hex:"+"c".repeat(64) });
  const a = runs.createCampaignRun({ settings, rosterContext });
  const b = runs.createCampaignRun({ settings, rosterContext });
  assert.notEqual(a.id,b.id);
  assert.deepEqual(a.teamPlan,b.teamPlan);
  assert.deepEqual(runs.restoreCampaignRun(JSON.parse(JSON.stringify(a)),rosterContext),a);
  const altered = structuredClone(a);altered.runProfile.starter.species=4;
  assert.throws(() => runs.restoreCampaignRun(altered,rosterContext), /commitment|starter|changed/i);
});

test("unsupported challenge controls and accidental seed reuse are rejected before launch", () => {
  assert.throws(() => runs.validateRunSettings(draft({nuzlocke:true})), /unknown|unsupported/i);
  assert.throws(() => runs.validateRunSettings(draft({seed:123})), /fresh|seed/i);
  assert.throws(() => runs.validateRunSettings(draft({starter:"mew"})), /starter/i);
  assert.throws(() => runs.validateRunSettings(draft({seedMode:"replay",seed:1,teamSeed:null})), /seed/i);
  assert.throws(() => runs.validateRunSettings(draft({label:" "})), /name|label/i);
});

test("balanced adventure retains the existing roster policy and needs no extra helpers", () => {
  const run = runs.createCampaignRun({settings:draft({teamMode:"balanced",helpers:"none"}),rosterContext:context()});
  assert.equal(run.teamPlan.rosterSelection.mode,"coherent");
  assert.equal(run.teamPlan.rosterPolicy.allowTemporaryMembers,false);
  assert.throws(() => runs.validateRunSettings(draft({teamMode:"balanced"})), /helper/i);
});

test("campaign pause emits no inputs and resume retains its chosen opening and player progress", () => {
  assert.equal(typeof runs.createCampaignController,"function");
  const fixture=rosterContextFixture(),rosterContext=createFireRedRosterContext(fixture);
  const record=runs.createCampaignRun({settings:draft({seedMode:"replay",seed:0,teamSeed:42}),rosterContext});
  const controller=runs.createCampaignController({...fixture,record});
  const o=observation(42,{ui:{newGame:{stage:"choose-gender",cursor:1}}},{mode:"boot",callback2:"CB2_NewGameScene"});
  const decision=controller.decide(o);
  assert.equal(decision.winner.recommendation.targetValue,"BOY");
  const sequence=controller.state().player.sequence;
  controller.pause("Paused by you.");
  assert.deepEqual(controller.decide(o).action.buttons,[]);
  const saved=JSON.parse(JSON.stringify(controller.state()));
  const restored=runs.createCampaignController({...fixture,record,state:saved});
  assert.equal(restored.state().player.sequence,sequence);
  restored.resume();
  assert.equal(restored.decide(observation(46,o.playerMemory,o.emulator)).winner.recommendation.targetValue,"BOY");
  assert.equal(restored.record.id,record.id);
});

test("finishing a campaign requires the saved game to return to playable postgame with the selected team", () => {
  assert.equal(typeof runs.createCampaignController,"function");
  const fixture=rosterContextFixture(),rosterContext=createFireRedRosterContext(fixture);
  const record=runs.createCampaignRun({settings:draft(),rosterContext});
  const state={status:"finishing",hallOfFame:{nativeSaveVerified:true,frame:100,party:record.teamPlan.hallOfFameSpecies},player:null};
  const controller=runs.createCampaignController({...fixture,record,state});
  assert.notEqual(controller.decide(observation(120)).kind,"campaign-complete");
  const party=record.teamPlan.hallOfFameSpecies.map((species,slot)=>({species,slot,validity:"valid",hp:100}));
  const done=controller.decide(observation(140,{trainer:{partyValidity:"valid",party},storyState:{flagIds:{2092:true}}}));
  assert.equal(done.kind,"campaign-complete");
  assert.equal(controller.state().status,"complete");
  assert.equal(controller.state().completion.playablePostgame,true);
});

test('a campaign acknowledges only a verified saved capture and retains all other player progress',()=>{
 const fixture=rosterContextFixture(),record=runs.createCampaignRun({settings:draft(),rosterContext:createFireRedRosterContext(fixture)});
 const original=runs.createCampaignController({...fixture,record});original.decide(observation(1));
 const state=structuredClone(original.state());state.player.encounterSafety={schema:'master-red/encounter-safety/v1',blocked:'protected-capture-saved',capture:{fingerprint:'verified-catch',nativeSaveVerified:true,pokemon:{shiny:true}}};
 const resumed=runs.createCampaignController({...fixture,record,state});
 assert.equal(resumed.decide(observation(2)).kind,'capture-saved');
 assert.throws(()=>resumed.acknowledgeCapture('another-catch'),/capture/i);
 const before=resumed.state().player;resumed.acknowledgeCapture('verified-catch');
 assert.equal(resumed.state().player.encounterSafety.capture,null);
 assert.equal(resumed.state().player.sequence,before.sequence);
 assert.deepEqual(resumed.state().player.campaignPlanner,before.campaignPlanner);
});
