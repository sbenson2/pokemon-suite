import assert from "node:assert/strict";
import test from "node:test";
import { createCentralPlayer } from "../src/player/delegator.js";
import { validateHuntConfig } from "../src/player/hunt-config.js";
import {createEncounterSafety} from '../src/player/encounter-safety.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';

const shiny = { validity: "valid", personality: 0, otId: 0, species: 19, shiny: true, isEgg: false,
  nature: { id: 0, name: "Hardy" }, ivs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 } };
const lead = { validity: "valid", slot: 0, species: 4, personality: 99, otId: 0, level: 20,
  hp: 60, maxHp: 60, stats: { defense: 40 }, moves: [33], pp: [35] };
const mechanics = { species: { 4: { types: ["TYPE_FIRE"] }, 19: { types: ["TYPE_NORMAL"] } },
  moves: { 33: { id: 33, effect: "EFFECT_HIT", power: 35, type: "TYPE_NORMAL" } } };
function observation(frame, { mon = shiny, inBattle = true, ui = { battle: { stage: "action", cursor: 0 } },
  party = [lead], balls = [{ itemId: 4, quantity: 25 }], outcome = 0, savedGame = 3, sram = "before", extra = {} } = {}) {
  const captureId = `safety-${frame}`;
  return { frame, captureId, phase: "stable", phaseReasons: [],
    emulator: { frame, captureId, mode: inBattle ? "battle" : "overworld", inBattle, inputReady: true },
    sram: { frame, captureId, sha256: sram },
    playerMemory: { frame, captureId, map: { id: "MAP_ROUTE1" }, position: { x: 5, y: 5 },
      battleTypeFlags: 4, battleOutcome: outcome, saveAttemptStatus: 1,
      gameStats: { savedGame }, encounter: inBattle ? { kind: "wild", validity: mon ? "valid" : "unknown", pokemon: mon } : null,
      trainer: { party, partyCount: party.length, partyValidity: "valid", usablePartyCount: party.filter((p) => p.hp > 0).length,
        bag: { pokeBalls: balls }, storage: { validity: "valid", unknownSlots: 0, boxCounts: Array(14).fill(0), pokemon: [] } },
      battle: inBattle ? { player: lead, opponent: { ...shiny, level: 3, hp: 12, maxHp: 12,
        stats: { attack: 8 }, moves: [33], pp: [35], status1: 0, status2: 0, status3: 0 }, turn: 0 } : null,
      ui, ...extra } };
}
const unsafeAdvisor = { id: "battle", advise: (o) => ({ advisor: "battle", observationId: o.captureId,
  recommendation: { kind: "choose-battle-command", targetCommand: "run" }, confidence: 1,
  constraints: [], vetoes: [], evidenceRefs: ["test:unsafe-default"] }) };
const auto = () => createCentralPlayer({ huntConfig: validateHuntConfig({ observeOnly: false, onShiny: "capture" }),
  mechanics, advisors: [unsafeAdvisor] });

test('a stable overworld observation closes a prior wild identity before RNG execution',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'});
 const guard=createEncounterSafety({config,mechanics});
 const first={...shiny,shiny:false,personality:1821185836};
 const next={...first,personality:3699471272};
 assert.notEqual(guard.inspect(observation(1,{mon:first})).reason,'unreadable-encounter');
 assert.equal(guard.inspect(observation(2,{inBattle:false,ui:{}}),{}),null);
 assert.notEqual(guard.inspect(observation(3,{mon:next})).reason,'unreadable-encounter');
 assert.equal(guard.state().tracker.current.pokemon.personality,next.personality);
});

test('a verified native catch clears only its old survival pause and still requires saving',()=>{
 const options={config:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{optimizeCapture:true}};
 const guard=createEncounterSafety(options);guard.inspect(observation(1));
 const checkpoint=guard.state();checkpoint.blocked='capture-battler-survival-unknown';
 const caught={...shiny,slot:1,hp:12,maxHp:12};
 const done=observation(2,{inBattle:false,outcome:7,party:[lead,caught],ui:{}});
 const resumed=createEncounterSafety({...options,initialState:checkpoint});
 assert.equal(resumed.inspect(done).recommendation?.kind,'open-start-menu');
 assert.equal(resumed.state().capture.caught,true);
 assert.equal(resumed.state().capture.nativeSaveVerified,false,'ownership alone does not waive the native Save routine');
 for(const patch of [
  observation(2,{inBattle:false,outcome:7,party:[lead,{...caught,personality:1}],ui:{}}),
  observation(2,{inBattle:false,outcome:4,party:[lead,caught],ui:{}}),
  {...done,playerMemory:{...done.playerMemory,trainer:{...done.playerMemory.trainer,partyValidity:'unknown'}}}
 ])assert.equal(createEncounterSafety({...options,initialState:checkpoint}).inspect(patch).kind,'blocked');
 const animation=createEncounterSafety({...options,initialState:checkpoint});
 assert.equal(animation.inspect(observation(2,{inBattle:true,outcome:7,party:[lead,caught],ui:{}})).kind,'resample','finish the native catch animation before saving');
 assert.equal(animation.state().capture.save,undefined);
 assert.equal(createEncounterSafety({...options,initialState:{...checkpoint,blocked:'protected-encounter-identity-changed'}}).inspect(done).kind,'blocked');
});

test('Safari capture retires with the caught identity intact before establishing a native save baseline',()=>{
 const p=createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{safari:true,shinyPriority:true}});
 const safari={validity:'valid',balls:30,steps:200,catchFactor:2,escapeFactor:9,bait:0,rocks:0};
 p.decide(observation(1,{extra:{battleTypeFlags:132,safari}}));
 const caught={...shiny,slot:1,hp:10,maxHp:10};
 const field=(frame,ui={},extra={})=>observation(frame,{inBattle:false,party:[lead,caught],outcome:7,ui,extra:{map:{id:'MAP_SAFARI_ZONE_NORTH'},safari,...extra}});
 assert.equal(p.decide(field(2)).winner?.recommendation.kind,'open-start-menu');
 assert.equal(p.decide(field(3,{startMenu:{cursor:0,order:['retire','pokedex','pokemon','bag','player','option','exit']}})).winner?.recommendation.targetItem,'retire');
 assert.equal(p.state().encounterSafety.capture.save,undefined);
 assert.equal(p.decide(field(4,{choiceMenu:{cursor:1,maxCursor:1}})).winner?.recommendation.targetOption,'yes');
 const outside={map:{id:'MAP_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE'},safari:{validity:'valid',balls:0,steps:0}};
 assert.equal(p.decide(field(5,{},outside)).winner?.recommendation.kind,'open-start-menu');
 assert.equal(p.state().encounterSafety.capture.save.map,outside.map.id);
 assert.equal(p.decide(field(6,{startMenu:{cursor:0,order:['pokedex','pokemon','bag','player','save','option','exit']}},outside)).winner?.recommendation.targetItem,'save');
 const lost=createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{safari:true}});
 lost.decide(observation(1,{extra:{battleTypeFlags:132,safari}}));
 lost.decide(field(2));
 assert.equal(lost.decide(observation(3,{inBattle:false,outcome:7,ui:{},extra:{safari}})).reason,'protected-encounter-lost-or-unverified');
});

test('protected Safari shiny uses observed bait/ball controls, never ordinary moves or the bag',()=>{
 const p=createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{safari:true,shinyPriority:true}});
 const o=observation(1,{ui:{battle:{stage:'action',cursor:0}},extra:{battleTypeFlags:132,safari:{validity:'valid',balls:30,steps:200,catchFactor:2,escapeFactor:9,bait:0,rocks:0}}});
 assert.equal(p.decide(o).winner?.recommendation.kind,'choose-safari-command');
 assert.equal(p.decide(o).winner?.recommendation.targetIndex,1);
 const feeding=observation(2,{ui:{battle:{stage:'action',cursor:1}},extra:{battleTypeFlags:132,safari:{validity:'valid',balls:30,steps:200,catchFactor:3,escapeFactor:9,bait:4,rocks:0}}});
 assert.equal(p.decide(feeding).winner?.recommendation.targetIndex,0);
 const unknown=observation(3,{extra:{battleTypeFlags:132,safari:{validity:'unknown'}}});
 assert.equal(p.decide(unknown).reason,'safari-capture-state-unavailable');
});

test('Suite capture honors the requested ball and the inventory reserve',()=>{
 const options={huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{ballIds:[4],minBalls:100}};
 const player=createCentralPlayer(options);
 const balls=[{itemId:2,quantity:80},{itemId:4,quantity:25}];
 const d=player.decide(observation(1,{balls,ui:{bag:{stage:'list',pocket:2}}}));
 assert.equal(d.winner.recommendation.targetItemId,4);assert.equal(d.winner.recommendation.targetIndex,1);
 const empty=createCentralPlayer(options).decide(observation(1,{balls:[{itemId:2,quantity:80},{itemId:4,quantity:20}]}));
 assert.equal(empty.reason,'capture-ball-reserve-reached');
});
test('shiny priority uses available balls below the reserve and overrides the requested ball',()=>{
 const options={huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{ballIds:[4],minBalls:100,shinyPriority:true}};
 const d=createCentralPlayer(options).decide(observation(1,{balls:[{itemId:2,quantity:1}],ui:{bag:{stage:'list',pocket:2}}}));
 assert.equal(d.winner?.recommendation.targetItemId,2);
 const master=createCentralPlayer(options).decide(observation(1,{balls:[{itemId:2,quantity:2},{itemId:1,quantity:1}],ui:{bag:{stage:'list',pocket:2}}}));
 assert.equal(master.winner?.recommendation.targetItemId,1);
 assert.equal(master.winner?.recommendation.targetIndex,1);
 const empty=createCentralPlayer(options).decide(observation(1,{balls:[]}));
 assert.equal(empty.reason,'capture-balls-exhausted');
});

const captureMechanics={...mechanics,species:{...mechanics.species,45:{types:['TYPE_GRASS','TYPE_POISON'],abilities:['ABILITY_CHLOROPHYLL']}},moves:{...mechanics.moves,
 79:{id:79,power:0,type:'TYPE_GRASS',effect:'EFFECT_SLEEP',accuracy:75},
 78:{id:78,power:0,type:'TYPE_GRASS',effect:'EFFECT_PARALYZE',accuracy:75},
 15:{id:15,power:50,type:'TYPE_NORMAL',effect:'EFFECT_HIT',accuracy:95}}};
const statusMember={...lead,slot:1,species:45,level:30,moves:[79,78],pp:[15,30],stats:{attack:40,spAttack:60,defense:70}};
const optimized=()=>createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics:captureMechanics,captureRequirements:{optimizeCapture:true}});
test('optimized capture immediately uses a ball against a known self-KO move and can resume its protected pause',()=>{
 const rules={...captureMechanics,moves:{...captureMechanics.moves,174:{id:174,power:0,type:'TYPE_GHOST',effect:'EFFECT_CURSE',accuracy:0}}};
 const options={huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics:rules,captureRequirements:{optimizeCapture:true}};
 const p=createCentralPlayer(options),o=observation(1,{balls:[{itemId:2,quantity:5}]});
 o.playerMemory.battle.opponent.moves=[174];o.playerMemory.battle.opponent.pp=[10];
 assert.equal(p.decide(o).winner?.recommendation.targetCommand,'bag');
 const checkpoint=p.state();checkpoint.encounterSafety.blocked='opponent-escape-or-self-ko-risk';
 o.playerMemory.ui={bag:{stage:'list',pocket:2}};
 assert.equal(createCentralPlayer({...options,initialState:checkpoint}).decide(o).winner?.recommendation.targetItemId,2);
 o.playerMemory.battle.opponent.moves=[999];
 assert.equal(createCentralPlayer({...options,initialState:checkpoint}).decide(o).kind,'blocked');
});
test('optimized capture immediately throws the best ball when Thrash confusion threatens the target',()=>{
 const p=optimized();
 const o=observation(1,{party:[lead,statusMember],balls:[{itemId:4,quantity:10},{itemId:2,quantity:5}]});
 o.playerMemory.battle.opponent.status2=3;
 assert.equal(p.decide(o).winner?.recommendation.targetCommand,'bag');
 o.playerMemory.ui={bag:{stage:'list',pocket:2}};
 assert.equal(p.decide(o).winner?.recommendation.targetItemId,2);
 o.playerMemory.ui={party:{stage:'choose-pokemon',cursor:0}};
 assert.equal(p.decide(o).winner?.recommendation.kind,'close-menu');
});
test('an obsolete residual-risk pause resumes only the same protected wild identity',()=>{
 const options={huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics:captureMechanics,captureRequirements:{optimizeCapture:true}};
 const p=createCentralPlayer(options),o=observation(1);p.decide(o);
 const checkpoint=p.state();checkpoint.encounterSafety.blocked='residual-damage-risk';
 o.playerMemory.battle.opponent.status2=3;
 const resumed=createCentralPlayer({...options,initialState:checkpoint});
 assert.equal(resumed.decide(o).winner?.recommendation.targetCommand,'bag');
 const mismatch=observation(2,{mon:{...shiny,personality:99}});
 assert.equal(createCentralPlayer({...options,initialState:checkpoint}).decide(mismatch).kind,'blocked');
 o.playerMemory.battle.opponent={...o.playerMemory.battle.opponent,status2:0,moves:[999],pp:[1]};
 assert.equal(createCentralPlayer({...options,initialState:checkpoint}).decide(o).reason,'unknown-battle-risk');
});
test('protected capture switches to a status specialist, confirms that slot, and uses sleep before balls',()=>{
 const p=optimized();const o=observation(1,{party:[lead,statusMember]});
 assert.equal(p.decide(o).winner?.recommendation.targetCommand,'pokemon');
 const picker=observation(2,{party:[lead,statusMember],ui:{party:{stage:'choose-pokemon',cursor:0}}});
 assert.equal(p.decide(picker).winner?.recommendation.targetPartySlot,1);
 const confirm=observation(3,{party:[lead,statusMember],ui:{party:{stage:'selection-menu',selectedPartySlot:1,cursor:1},choiceMenu:{cursor:0}}});
 assert.equal(p.decide(confirm).winner?.recommendation.targetIndex,0);
 const active=observation(4,{party:[lead,statusMember]});active.playerMemory.battle.player=statusMember;active.playerMemory.battle.playerPartySlot=1;
 assert.equal(p.decide(active).winner?.recommendation.targetCommand,'fight');
 active.playerMemory.ui={battle:{stage:'move',cursor:0}};
 assert.equal(p.decide(active).winner?.recommendation.targetMoveId,79);
 active.playerMemory.battle.opponent.status1=2;
 assert.equal(p.decide(active).winner?.recommendation.kind,'close-menu');
 active.playerMemory.ui={battle:{stage:'action',cursor:0}};
 assert.equal(p.decide(active).winner?.recommendation.targetCommand,'bag');
});
test('protected capture uses paralysis when sleep has no PP, and never weakens through a possible critical KO',()=>{
 const p=optimized();const o=observation(1,{party:[statusMember]});
 o.playerMemory.battle.player={...statusMember,slot:0,pp:[0,30]};
 o.playerMemory.ui={battle:{stage:'move',cursor:0}};
 assert.equal(p.decide(o).winner?.recommendation.targetMoveId,78);
 o.playerMemory.battle.player={...lead,level:70,moves:[15],pp:[30],stats:{attack:200,defense:70}};
 o.playerMemory.battle.opponent.stats={...o.playerMemory.battle.opponent.stats,defense:10};
 o.playerMemory.trainer.party=[o.playerMemory.battle.player];
 assert.equal(optimized().decide(o).winner?.recommendation.kind,'close-menu');
});
test('protected capture weakens a sleeping target only while a critical hit is survivable',()=>{
 const o=observation(1,{ui:{battle:{stage:'move',cursor:0}}});
 o.playerMemory.battle.player={...lead,moves:[15],pp:[30],stats:{attack:40,spAttack:40,defense:70}};
 o.playerMemory.trainer.party=[o.playerMemory.battle.player];
 o.playerMemory.battle.opponent={...o.playerMemory.battle.opponent,hp:100,maxHp:100,status1:2,stats:{attack:8,defense:40,spDefense:40}};
 const p=optimized();
 assert.equal(p.decide(o).winner?.recommendation.targetMoveId,15);
 assert.ok(p.decide(o).winner.recommendation.maximumCriticalDamage<100);
 o.playerMemory.battle.opponent.hp=20;
 assert.equal(p.decide(o).winner?.recommendation.kind,'close-menu');
});

test("the central safety guard preempts normal fleeing and survives checkpoint restoration", () => {
  const player = createCentralPlayer({ advisors: [unsafeAdvisor] });
  const decision = player.decide(observation(1));
  assert.equal(decision.kind, "blocked");
  assert.equal(decision.reason, "protected-encounter-pause");
  assert.deepEqual(decision.action.buttons, []);
  const restored = createCentralPlayer({ advisors: [unsafeAdvisor], initialState: player.state() });
  assert.equal(restored.decide(observation(2, { mon: null })).kind, "blocked");
});

test("only explicit reviewed resume can turn a shiny pause into capture, and identity must still match", () => {
  const config = validateHuntConfig({ observeOnly: false });
  const paused = createCentralPlayer({ huntConfig: config, mechanics });
  paused.decide(observation(1));
  const resumed = createCentralPlayer({ huntConfig: config, mechanics, initialState: paused.state(), resumeProtectedCapture: true });
  assert.equal(resumed.decide(observation(2)).winner?.recommendation.targetCommand, "bag");
  const stale = createCentralPlayer({ huntConfig: config, mechanics, initialState: paused.state(), resumeProtectedCapture: true });
  assert.equal(stale.decide(observation(2, { mon: { ...shiny, personality: 8, shiny: false } })).reason, "protected-resume-context-mismatch");
  assert.throws(() => createCentralPlayer({ huntConfig: config, mechanics, resumeProtectedCapture: true }), /paused protected encounter/);
});

test("temporarily unreadable enemy data permits no attack or flee, then resolves normally", () => {
  const player = createCentralPlayer({ advisors: [unsafeAdvisor] });
  assert.deepEqual(player.decide(observation(1, { mon: null })).action.buttons, []);
  const ordinary = player.decide(observation(2, { mon: { ...shiny, personality: 8, shiny: false } }));
  assert.equal(ordinary.winner.recommendation.targetCommand, "run");
});

test("recap playback cannot create a hunt encounter or trigger capture of a historical shiny", () => {
  const player = auto();
  const result = player.decide(observation(1, { extra: { questLog: { playback: true } } }));
  assert.equal(result.kind, "resample");
  assert.equal(player.state().encounterSafety.tracker.totalEncounters, 0);
  assert.equal(player.state().encounterSafety.capture, null);
});

test("the catching tutorial owns its controls without triggering wild encounter safety or hunt budgets", () => {
  for (const huntConfig of [null, validateHuntConfig({ observeOnly: false })]) {
    const player = createCentralPlayer({ huntConfig, advisors: [unsafeAdvisor] });
    for (const [frame, mon] of [[1, shiny], [2, null], [700, { ...shiny, species: 13, personality: 91, shiny: false }]]) {
      const demo = observation(frame, { mon });
      demo.playerMemory.encounter.kind = "tutorial";
      demo.playerMemory.battleTypeFlags = 516;
      const result = player.decide(demo);
      assert.equal(result.kind, "resample");
      assert.deepEqual(result.action.buttons, []);
      assert.equal(player.state().encounterSafety.capture, null);
    }
    assert.equal(player.state().encounterSafety.tracker.totalEncounters, 0);
    player.decide(observation(701, { inBattle: false, ui: {} }));
    assert.equal(player.decide(observation(702)).reason, "protected-encounter-pause");
  }
});

test("tutorial recognition cannot clear an existing protected encounter stop", () => {
  const player = createCentralPlayer({ advisors: [unsafeAdvisor] });
  player.decide(observation(1));
  const demo = observation(2);
  demo.playerMemory.encounter.kind = "tutorial";
  demo.playerMemory.battleTypeFlags = 516;
  assert.equal(player.decide(demo).reason, "protected-encounter-pause");
});

test("protected capture owns every bag step and never confirms a stale medicine selection", () => {
  const player = auto();
  assert.equal(player.decide(observation(1)).winner.recommendation.targetCommand, "bag");
  assert.equal(player.decide(observation(2, { ui: { bag: { stage: "list", pocket: 0, index: 0 } } })).winner.recommendation.targetPocket, 2);
  assert.equal(player.decide(observation(3, { ui: { bag: { stage: "list", pocket: 2, index: 0 } } })).winner.recommendation.targetItemId, 4);
  assert.deepEqual(player.decide(observation(4, { ui: { bag: { stage: "context", pocket: 2, selectedItemId: 13, contextCursor: 0 } } })).action.buttons, ["b"]);
  assert.equal(player.decide(observation(5, { ui: { bag: { stage: "context", pocket: 2, selectedItemId: 4, contextCursor: 0 } } })).winner.recommendation.targetAction, "use");
});

test("protected capture cancels an existing switch workflow before it can send another teammate", () => {
  const player = createCentralPlayer({ advisors: [{ ...unsafeAdvisor, advise: (o) => ({ ...unsafeAdvisor.advise(o),
    recommendation: { kind: "choose-battle-command", targetCommand: "pokemon", targetPartySlot: 1, targetSpecies: 7 } }) }] });
  const party = [lead, { ...lead, slot: 1, species: 7 }];
  player.decide(observation(1, { mon: { ...shiny, personality: 8, shiny: false }, party }));
  assert.ok(player.state().workflow);
  // A newly available record identifies the shiny before the old party intent runs.
  const decision = player.decide(observation(2, { party, ui: { party: { stage: "choose-pokemon", slot: 0 } } }));
  assert.equal(decision.kind, "blocked");
  assert.equal(player.state().workflow, null);
});

test("protected capture pauses for no balls, unknown/full storage, fainting, hazards, and unsupported battles", () => {
  const cases = [
    { balls: [] },
    { extra: { trainer: { party: [], partyValidity: "unknown", bag: { pokeBalls: [] } } } },
    { party: [ { ...lead, hp: 0 } ] },
    { extra: { battleTypeFlags: 4 | 128 } },
    { extra: { battle: { player: lead, opponent: { ...shiny, moves: [999], pp: [10] }, turn: 0 } } },
    { party: Array.from({ length: 6 }, (_, slot) => ({ ...lead, slot })),
      extra: { trainer: { party: Array.from({ length: 6 }, (_, slot) => ({ ...lead, slot })), partyValidity: "valid",
        bag: { pokeBalls: [{ itemId: 4, quantity: 25 }] }, storage: { validity: "valid", boxCounts: Array(14).fill(30), pokemon: [] } } } },
  ];
  for (const options of cases) {
    const decision = auto().decide(observation(1, options));
    assert.equal(decision.kind, "blocked");
    assert.deepEqual(decision.action.buttons, []);
  }
});

test("capture completion requires the exact caught record and an observed native save, not a checkpoint", () => {
  const player = auto();
  player.decide(observation(1));
  const party = [lead, { ...shiny, slot: 1, hp: 12, maxHp: 12 }];
  assert.equal(player.decide(observation(2, { outcome: 7, party, ui: { pokedexRegistration: { stage: "registered-entry" } } })).winner.recommendation.kind, "acknowledge-cartridge-prompt");
  const field = { inBattle: false, outcome: 7, party, ui: {} };
  assert.equal(player.decide(observation(3, field)).winner.recommendation.kind, "open-start-menu");
  const saveMenu = player.decide(observation(4, { ...field, ui: { startMenu: { order: ["pokemon", "save"], cursor: 0 } } }));
  assert.equal(saveMenu.winner.recommendation.targetItem, "save");
  assert.deepEqual(saveMenu.action.buttons, ["down"], "resolve the observed Save index for the shared mapper");
  assert.equal(player.decide(observation(5, { ...field, ui: { saveDialog: { stage: "confirm-save", cursor: 1 } } })).winner.recommendation.targetOption, "yes");
  assert.equal(player.decide(observation(6, { ...field, savedGame: 4, sram: "after",
    ui: { saveDialog: { stage: "success" } } })).winner.recommendation.kind, "acknowledge-cartridge-prompt");
  const finished = player.decide(observation(7, { ...field, savedGame: 4, sram: "after" }));
  assert.equal(finished.reason, "protected-capture-saved");
  assert.equal(player.state().encounterSafety.capture.nativeSaveVerified, true);
});

test('a requested nickname owns the capture prompt and naming input',()=>{
 const player=createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{nickname:'LARVITARXX'}});
 player.decide(observation(1));
 const prompt=observation(2,{outcome:0,ui:{choiceMenu:{options:['yes','no'],cursor:0}}});prompt.playerMemory.battle.scriptName='capture-nickname-prompt';
 assert.equal(player.decide(prompt).winner?.recommendation.targetOption,'yes');
 const naming=observation(3,{outcome:0,ui:{naming:{subject:'pokemon',template:2,state:2,inputReady:true,page:1,cursor:{x:0,y:0},text:'LARVITARX'}}});
 assert.equal(player.decide(naming).winner?.recommendation.targetText,'LARVITARXX');
});
test("FireRed registers the Pokédex and asks for a nickname before setting its caught outcome", () => {
  const player = auto(); player.decide(observation(1));
  const registration = player.decide(observation(2, { outcome: 0, ui: { pokedexRegistration: { stage: "registered-entry" } } }));
  assert.equal(registration.winner?.recommendation.kind, "acknowledge-cartridge-prompt");
  const nickname = observation(3, { outcome: 0, ui: { choiceMenu: { options: ["yes", "no"], cursor: 0 } } });
  nickname.playerMemory.battle.scriptName = "capture-nickname-prompt";
  assert.equal(player.decide(nickname).winner?.recommendation.targetOption, "no");
  assert.equal(player.state().encounterSafety.capture.caught, false);
  const field = observation(4, { inBattle: false, outcome: 7, ui: {}, party: [lead, { ...shiny, slot: 1 }] });
  assert.equal(player.decide(field).winner?.recommendation.kind, "open-start-menu");
});

test("a native-save error or disappeared protected Pokémon stops without claiming capture success", () => {
  const lost = auto(); lost.decide(observation(1));
  assert.equal(lost.decide(observation(2, { inBattle: false, ui: {} })).reason, "protected-encounter-lost-or-unverified");
  const failed = auto(); failed.decide(observation(1));
  const options = { inBattle: false, outcome: 7, party: [lead, { ...shiny, slot: 1 }], ui: {} };
  failed.decide(observation(2, options));
  const result = failed.decide(observation(3, { ...options, ui: { saveDialog: { stage: "error" } } }));
  assert.equal(result.reason, "native-save-failed");
});

test('a saved capture checkpoint can recover an obsolete success callback only at verified save initialization',()=>{
 const p=auto();p.decide(observation(1));
 const opts={inBattle:false,outcome:7,party:[lead,{...shiny,slot:1}],ui:{}};
 p.decide(observation(2,opts));
 assert.equal(p.decide(observation(3,{...opts,ui:{saveDialog:{stage:'success'}}})).reason,'native-save-postconditions-failed');
 const restored=createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,initialState:p.state()});
 const init=observation(4,{...opts,ui:{saveDialog:{stage:'initializing'}}});init.phase='transition';
 assert.equal(restored.decide(init).kind,'resample');
 const missing=observation(4,{...opts,party:[lead],ui:{saveDialog:{stage:'initializing'}}});missing.phase='transition';
 assert.equal(createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,initialState:p.state()}).decide(missing).kind,'blocked');
 const done=restored.decide(observation(5,{...opts,savedGame:4,sram:'after'}));
 assert.equal(done.reason,'protected-capture-saved');
});

test("capture save handling acknowledges the observer's field-dialog stages before opening Start", () => {
  const player = auto(); player.decide(observation(1));
  const field = { inBattle: false, outcome: 7, party: [lead, { ...shiny, slot: 1 }],
    ui: { fieldDialog: { stage: "awaiting-close" } } };
  assert.equal(player.decide(observation(2, field)).winner.recommendation.kind, "acknowledge-cartridge-prompt");
});

test("hunt budgeting observes battle frames even when the encounter guard supplies the action", () => {
  const frames = [];
  const player = createCentralPlayer({ huntConfig: validateHuntConfig({ observeOnly: false }), mechanics,
    campaignPlanner: { safetyCheck: (o) => { frames.push(o.frame); return null; }, state: () => ({}) } });
  player.decide(observation(1, { mon: { ...shiny, personality: 8, shiny: false } }));
  player.decide(observation(20, { mon: { ...shiny, personality: 8, shiny: false } }));
  assert.deepEqual(frames, [1, 20]);
});

test('a successful final escape drains its native message instead of stopping at the attempt limit',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'}),ordinary={...shiny,shiny:false,personality:123};
 const p=createEncounterSafety({config,mechanics}),o=observation(1,{mon:ordinary});o.playerMemory.battle.runAttempts=3;
 assert.equal(p.inspect(o).reason,'hunt-escape-budget');
 const state=p.state(),restored=createEncounterSafety({config,mechanics,initialState:state});
 o.playerMemory.battleOutcome=4;o.playerMemory.ui.battle.stage='message';
 assert.equal(restored.inspect(o).recommendation.kind,'acknowledge-cartridge-prompt');
 assert.equal(restored.state().blocked,null);
 const unsafe=createEncounterSafety({config,mechanics,initialState:state});o.playerMemory.battleOutcome=0;
 assert.equal(unsafe.inspect(o).reason,'hunt-escape-budget');
 const fresh=createEncounterSafety({config,mechanics});o.playerMemory.battleOutcome=4;
 assert.equal(fresh.inspect(o).recommendation.kind,'acknowledge-cartridge-prompt');
});

test('a larger postgame escape budget resumes only the same known ordinary non-target',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'}),ordinary={...shiny,shiny:false,personality:123};
 const p=createEncounterSafety({config,mechanics}),o=observation(1,{mon:ordinary});o.playerMemory.battle.runAttempts=3;p.inspect(o);
 const longer=validateHuntConfig({observeOnly:false,onShiny:'capture',limits:{maxEscapeAttempts:9}});
 const resumed=createEncounterSafety({config:longer,mechanics,initialState:p.state()});
 assert.equal(resumed.inspect(o).recommendation.targetCommand,'run');
 const changed=createEncounterSafety({config:longer,mechanics,initialState:p.state()});o.playerMemory.encounter.pokemon={...ordinary,personality:999};
 assert.equal(changed.inspect(o).reason,'hunt-escape-budget');
});

test("ordinary hunting leaves non-targets but stops after failed escapes or its encounter budget", () => {
  const config = validateHuntConfig({ observeOnly: false, limits: { maxEncounters: 1 } });
  const player = createCentralPlayer({ huntConfig: config, mechanics });
  const options = { mon: { ...shiny, personality: 8, shiny: false } };
  assert.equal(player.decide(observation(1, options)).winner.recommendation.targetCommand, "run");
  assert.equal(player.decide(observation(2, { inBattle: false, ui: {} })).reason, "hunt-encounter-budget");
  const failed = createCentralPlayer({ huntConfig: config, mechanics });
  assert.equal(failed.decide(observation(1, { ...options, extra: { battle: { player: lead, opponent: {}, runAttempts: 3 } } })).reason,
    "hunt-escape-budget");
});
test('postgame delegates a trapped ordinary non-target to battle control while retaining shiny and target protection',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'}),requirements={fightTrappedNonTargets:true};
 const o=observation(1,{mon:{...shiny,shiny:false,personality:8}});o.playerMemory.battle.opponent.ability=71;
 const guard=createEncounterSafety({config,mechanics,captureRequirements:requirements});
 assert.equal(guard.inspect(o),null);
 const blocked=createEncounterSafety({config,mechanics});assert.equal(blocked.inspect(o).reason,'hunt-escape-blocked');
 const resumed=createEncounterSafety({config,mechanics,captureRequirements:requirements,initialState:blocked.state()});assert.equal(resumed.inspect(o),null);
 const found=observation(2);found.playerMemory.battle.opponent.ability=71;
 assert.notEqual(createEncounterSafety({config,mechanics,captureRequirements:requirements}).inspect(found),null);
 const target=validateHuntConfig({observeOnly:false,onTarget:'capture',targets:[{required:{species:[19]}}]});
 assert.notEqual(createEncounterSafety({config:target,mechanics,captureRequirements:requirements}).inspect(o),null);
});

test('an optimized protected capture heals the exact active Pokémon before throwing more balls',()=>{
 const p=createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{optimizeCapture:true}});
 const injured={...lead,hp:5};
 const o=observation(1,{party:[injured]});o.playerMemory.battle.player=injured;o.playerMemory.trainer.bag.items=[{itemId:20,quantity:1}];
 const next=()=>{o.frame++;o.captureId='healing-'+o.frame;for(const key of ['emulator','sram','playerMemory'])Object.assign(o[key],{frame:o.frame,captureId:o.captureId});return p.decide(o);};
 let d=next();assert.equal(d.winner?.recommendation.targetCommand,'bag');
 o.playerMemory.ui={bag:{stage:'list',pocket:2}};d=next();assert.equal(d.winner?.recommendation.targetPocket,0);
 o.playerMemory.ui={bag:{stage:'list',pocket:0}};d=next();assert.equal(d.winner?.recommendation.targetItemId,20);
 o.playerMemory.ui={bag:{stage:'context',pocket:0,selectedItemId:20}};d=next();assert.equal(d.winner?.recommendation.targetAction,'use');
 o.playerMemory.ui={party:{stage:'choose-pokemon',itemId:20}};d=next();assert.equal(d.winner?.recommendation.targetPartySlot,0);
 o.playerMemory.battle.player={...injured,hp:60};o.playerMemory.trainer.party=[{...injured,hp:60}];o.playerMemory.ui={bag:{stage:'list',pocket:2}};
 d=next();assert.equal(d.winner?.recommendation.targetItemId,4);
});

test('protected capture switches to a verified surviving reserve when healing cannot restore its safety margin',()=>{
 const p=createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{optimizeCapture:true}});
 const injured={...lead,hp:1,maxHp:2},reserve={...lead,slot:1,personality:100};const o=observation(1,{party:[injured,reserve]});o.playerMemory.battle.player=injured;o.playerMemory.battle.playerPartySlot=0;
 let d=p.decide(o);assert.equal(d.winner?.recommendation.targetCommand,'pokemon');assert.equal(d.winner?.recommendation.targetPartySlot,1);
 o.playerMemory.ui={party:{stage:'choose-pokemon'}};d=p.decide(o);assert.equal(d.winner?.recommendation.targetPartySlot,1);
 o.playerMemory.ui={party:{stage:'selection-menu',selectedPartySlot:1}};d=p.decide(o);assert.equal(d.winner?.recommendation.targetIndex,0);
});

test('capture medicine follows the active identity when the native party menu temporarily reorders slots',()=>{
 const p=createCentralPlayer({huntConfig:validateHuntConfig({observeOnly:false,onShiny:'capture'}),mechanics,captureRequirements:{optimizeCapture:true}});
 const injured={...lead,hp:5},other={...lead,slot:1,species:19,personality:100};
 const o=observation(1,{party:[injured,other],ui:{party:{stage:'choose-pokemon',itemId:20}}});
 o.playerMemory.battle.player=injured;o.playerMemory.battle.playerPartySlot=1;o.playerMemory.trainer.bag.items=[{itemId:20,quantity:1}];
 const d=p.decide(o);assert.equal(d.winner?.recommendation.targetSpecies,4);assert.equal(d.winner?.recommendation.targetPartySlot,0);
});

test('a fainted lead in a known ordinary encounter delegates its native replacement prompt and resumes that saved pause',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'});
 const o=observation(1,{mon:{...shiny,shiny:false,personality:8},ui:{choiceMenu:{cursor:0,maxCursor:1}}});
 o.playerMemory.battle.player={...lead,hp:0};
 const guard=createEncounterSafety({config,mechanics});assert.equal(guard.inspect(o),null);
 const checkpoint=guard.state();checkpoint.blocked='unexpected-hunt-battle-menu';
 const resumed=createEncounterSafety({config,mechanics,initialState:checkpoint});assert.equal(resumed.inspect(o),null);
 const mismatch=structuredClone(o);mismatch.playerMemory.encounter.pokemon.personality=9;
 assert.equal(createEncounterSafety({config,mechanics,initialState:checkpoint}).inspect(mismatch).kind,'blocked');
});
test('explicit evolution training can fight ordinary non-targets while every shiny stays protected',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'}),requirements={fightTrainingNonTargets:true};
 const ordinary=observation(1,{mon:{...shiny,shiny:false,personality:8}});
 const p=createEncounterSafety({config,mechanics,captureRequirements:requirements});assert.equal(p.inspect(ordinary),null);
 const found=p.inspect(observation(2));assert.notEqual(found,null);assert.ok(p.state().capture);
});

test('ending evolution training delegates the completed battle to the native evolution and move-learning policies',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'}),requirements={fightTrainingNonTargets:true};
 const ordinary={...shiny,shiny:false,personality:8};
 const guard=createEncounterSafety({config,mechanics,captureRequirements:requirements});
 assert.equal(guard.inspect(observation(1,{mon:ordinary})),null);
 requirements.fightTrainingNonTargets=false; // The evolved identity now needs saving.
 for(const ui of [{evolution:{stage:'complete-message',evolvedPartySlot:0}},
  {moveLearning:{stage:'replace-explanation',partySlot:0,moveId:33}}]){
  const o=observation(2,{mon:{...ordinary,hp:0},outcome:1,ui});
  o.emulator.mode='evolution';
  assert.equal(guard.inspect(o),null);
  const player=createCentralPlayer({huntConfig:config,mechanics,advisors:createPolicyAdvisors({mechanics})});
  const d=player.decide(o);
  assert.equal(d.winner?.recommendation.kind,'acknowledge-cartridge-prompt');
  assert.deepEqual(d.action.buttons,['a']);
 }
});

test('a saved unexpected-menu pause resumes only the same ordinary completed battle in the evolution scene',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'});
 const o=observation(2,{mon:{...shiny,shiny:false,personality:8,hp:0},outcome:1,
  ui:{evolution:{stage:'complete-message',evolvedPartySlot:0}}});
 o.emulator.mode='evolution';
 const guard=createEncounterSafety({config,mechanics});guard.inspect(o);
 const checkpoint=guard.state();checkpoint.blocked='unexpected-hunt-battle-menu';
 const resumed=createEncounterSafety({config,mechanics,initialState:checkpoint});
 assert.equal(resumed.inspect(o),null);
 assert.equal(resumed.state().blocked,null);
 for(const change of [
  x=>{x.emulator.mode='battle';},x=>{x.playerMemory.battleOutcome=0;},
  x=>{x.playerMemory.encounter.pokemon.personality=9;},
  x=>{x.playerMemory.encounter.pokemon.shiny=true;},
  x=>{x.playerMemory.encounter.validity='unknown';},
 ]){
  const mismatch=structuredClone(o);change(mismatch);
  assert.equal(createEncounterSafety({config,mechanics,initialState:checkpoint}).inspect(mismatch).kind,'blocked');
 }
 const requested=validateHuntConfig({observeOnly:false,onShiny:'capture',onTarget:'capture',targets:[{required:{species:[19]}}]});
 assert.equal(createEncounterSafety({config:requested,mechanics,initialState:checkpoint}).inspect(o).kind,'blocked');
 assert.equal(createEncounterSafety({config,mechanics,initialState:{...checkpoint,blocked:'protected-encounter-identity-changed'}}).inspect(o).kind,'blocked');
 const protectedGuard=createEncounterSafety({config,mechanics});protectedGuard.inspect(observation(1));
 const protectedCheckpoint=protectedGuard.state();protectedCheckpoint.blocked='unexpected-hunt-battle-menu';
 assert.equal(createEncounterSafety({config,mechanics,initialState:protectedCheckpoint}).inspect(o).kind,'blocked');
});

test('a won ordinary battle delegates move learning and level-up pages even while the native battle flag remains set',()=>{
 const config=validateHuntConfig({observeOnly:false,onShiny:'capture'});
 const ordinary={...shiny,shiny:false,personality:8,hp:0};
 for(const ui of [
  {moveLearning:{stage:'forget-move',partySlot:0,moveId:33,cursor:0,selected:'move-1'}},
  {moveLearning:{stage:'confirm-stop-learning',partySlot:0,moveId:33,cursor:0,selected:'yes'}},
  {moveLearning:{stage:'learned-move-message',partySlot:0,moveId:33}},
  {levelUp:{stage:'stats-page-one',partySlot:0}},
 ]){
  const o=observation(2,{mon:ordinary,outcome:1,ui});
  const guard=createEncounterSafety({config,mechanics});
  assert.equal(guard.inspect(o),null,'a recognized post-victory modal belongs to the native learning policy');
  const checkpoint=guard.state();checkpoint.blocked='unexpected-hunt-battle-menu';
  const resumed=createEncounterSafety({config,mechanics,initialState:checkpoint});
  assert.equal(resumed.inspect(o),null,'the same won ordinary encounter can release its obsolete pause');
  assert.equal(resumed.state().blocked,null);
  for(const patch of [
   x=>{x.playerMemory.battleOutcome=0;},
   x=>{x.playerMemory.encounter.pokemon.personality=9;},
   x=>{x.playerMemory.encounter.pokemon.shiny=true;},
   x=>{x.playerMemory.encounter.validity='unknown';},
   x=>{x.playerMemory.ui={};},
  ]){
   const different=structuredClone(o);patch(different);
   assert.equal(createEncounterSafety({config,mechanics,initialState:checkpoint}).inspect(different).kind,'blocked');
  }
  const requested=validateHuntConfig({observeOnly:false,onShiny:'capture',onTarget:'capture',targets:[{required:{species:[19]}}]});
  assert.equal(createEncounterSafety({config:requested,mechanics,initialState:checkpoint}).inspect(o).kind,'blocked');
  const protectedGuard=createEncounterSafety({config,mechanics});protectedGuard.inspect(observation(1));
  assert.equal(createEncounterSafety({config,mechanics,initialState:{...protectedGuard.state(),blocked:'unexpected-hunt-battle-menu'}}).inspect(o).kind,'blocked');
 }
});

test('story campaigns can capture incidental shinies without overriding ordinary battle policy',()=>{
 const options={mechanics,captureRequirements:{automaticShinies:true,optimizeCapture:true,shinyPriority:true}};
 const guard=createEncounterSafety(options);
 const decision=guard.inspect(observation(1));
 assert.notEqual(decision.kind,'blocked');
 assert.equal(guard.state().capture.pokemon.shiny,true);
 const ordinary=createEncounterSafety(options);
 assert.equal(ordinary.inspect(observation(2,{mon:{...shiny,shiny:false}})),null);
});
