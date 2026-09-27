import assert from "node:assert/strict";
import test from "node:test";
import { productiveTrainingOptions } from "../src/player/training-quality.js";
import * as quality from "../src/player/training-quality.js";
import {campaignTaskFixture} from '../test-support/campaign-task-fixture.js';
import {selectTrainingObjective} from '../src/player/campaign.js';

const wild = (reward, level, riskTier = 0) => ({ metrics: { transitions: 1 }, riskTier,
  encounter: { expectedExperienceYield: reward, expectedWildLevel: level, maximumWildLevel: level } });
const trainer = (reward, level, partySize = 1) => ({ metrics: { transitions: 3 }, riskTier: 0,
  trainer: { expectedExperience: reward, minimumLevel: level, maximumLevel: level, partySize } });

test("training quality compares reward per opponent and includes FireRed's trainer bonus", () => {
  const strongWild = wild(6000, 40);
  const goodTrainer = trainer(12000, 30, 6); // 3000 per opponent, at the locality floor.
  const trivialTrainer = trainer(12000, 5, 12); // Total party XP must not inflate quality.
  const selected = productiveTrainingOptions({ encounters: [wild(200, 3), strongWild], trainers: [goodTrainer, trivialTrainer] });
  assert.deepEqual(selected.encounters, [strongWild]);
  assert.deepEqual(selected.trainers, [goodTrainer]);
});

test("training quality cannot let an unsafe high-yield table erase all safe options", () => {
  const safe = wild(200, 3);
  const unsafe = wild(20000, 60, 2);
  assert.deepEqual(productiveTrainingOptions({ encounters: [safe, unsafe], trainers: [] }).encounters, [safe]);
  assert.deepEqual(productiveTrainingOptions({ encounters: [unsafe], trainers: [] }).encounters, [unsafe]);
});

test("partial trainer metadata uses the known level without reviving a trivial local table", () => {
  const remote = trainer(undefined, 30);
  delete remote.trainer.minimumLevel;
  const goodWild = wild(null, 40);
  const selected = productiveTrainingOptions({ encounters: [wild(null, 3), goodWild], trainers: [remote] });
  assert.deepEqual(selected.encounters, [goodWild]);
  assert.deepEqual(selected.trainers, [remote]);
});

const member = {slot:0,species:1,personality:12,otId:34,level:25,experience:10000,hp:70,maxHp:70,
  stats:{attack:50,spAttack:50},moves:[1],pp:[30],heldItem:0};
const mechanics = {species:[{id:1,name:'SPECIES_TEST',baseHP:40,baseDefense:40,baseSpDefense:40,types:['TYPE_NORMAL'],expYield:100}],
  moves:[{id:1,name:'MOVE_POUND',power:40,accuracy:100,type:'TYPE_NORMAL',effect:'EFFECT_HIT',pp:35}],typeChart:[]};
const candidate = (size=1,method='direct') => ({riskTier:0,trainingMethod:method,metrics:{transitions:0,localSteps:0},healerTransitions:0,
  trainer:{id:1,target:{map:'MAP_A'},partySize:size,maximumLevel:20,expectedExperience:2000*size},
  opponents:Array.from({length:size},()=>({species:1,level:20,weight:1}))});

test('training compares useful trainee XP, switching, and the full cycle rather than raw party totals', () => {
  assert.equal(typeof quality.estimateTrainingCycle,'function');
  const direct=quality.estimateTrainingCycle(candidate(),{member,mechanics});
  const switched=quality.estimateTrainingCycle(candidate(1,'switch'),{member,escort:{...member,slot:1},mechanics});
  assert.ok(direct.traineeExperience>switched.traineeExperience);
  assert.ok(direct.xpPerGameMinute>switched.xpPerGameMinute);
  const remote=quality.estimateTrainingCycle({...candidate(),metrics:{transitions:8,localSteps:100}},{member,mechanics});
  assert.ok(remote.xpPerGameMinute<direct.xpPerGameMinute);
  const rematch=quality.estimateTrainingCycle({...candidate(),trainer:{...candidate().trainer,rematch:true,vsSeekerAction:'recharge'}},{member,mechanics});
  assert.ok(rematch.seconds>direct.seconds);
});

test('a Normal opponent is not recommended as direct training for an all-Ghost moveset', () => {
  assert.equal(typeof quality.estimateTrainingCycle,'function');
  const ghost={...mechanics,moves:[{...mechanics.moves[0],type:'TYPE_GHOST'}],typeChart:[{attackingType:'TYPE_GHOST',defendingType:'TYPE_NORMAL',multiplier:0}]};
  const result=quality.estimateTrainingCycle(candidate(),{member,mechanics:ghost});
  assert.equal(result.viable,false);
});

test('throughput readback follows identity across party slots and includes travel and recovery frames', () => {
  assert.equal(typeof quality.createTrainingMeasurements,'function');
  const observed=(frame,experience,mode='overworld',slot=0)=>({frame,trainingActiveMs:frame*10,phase:'stable',emulator:{mode,inBattle:mode==='battle'},
    playerMemory:{map:{id:'MAP_A'},ui:{},trainer:{partyValidity:'valid',party:[{...member,experience,slot}]}}});
  let meter=quality.createTrainingMeasurements();
  const objective={id:'training',forObjective:'badge',trainingPartySlot:0,trainingSpecies:1,trainingRate:{key:'route-a'}};
  meter.commit(objective,observed(0,10000));
  meter.observe(observed(1800,10000,'battle'));
  meter=quality.createTrainingMeasurements(meter.state());
  meter.observe(observed(3600,10120,'overworld',2));
  assert.equal(meter.samples()['route-a'].experience,120);
  assert.equal(meter.samples()['route-a'].frames,3600);
  meter.observe(observed(3600,10120,'overworld',2));
  assert.equal(meter.samples()['route-a'].battles,1);
  meter.observe(observed(4800,10120,'battle',2));
  meter.observe(observed(7200,10120,'overworld',2)); // No XP still consumes the cycle.
  assert.equal(meter.samples()['route-a'].frames,7200);
  assert.equal(meter.samples()['route-a'].battles,2);
  assert.equal(meter.samples()['route-a'].activeMs,72000,'the existing campaign active clock excludes operator pauses');
  meter.commit({...objective,trainingRate:undefined,trainingMode:'passive'},observed(7300,10120,'overworld',2));
  meter.observe(observed(8000,10120,'battle',2));
  meter.observe(observed(9000,10180,'overworld',2));
  assert.equal(meter.samples()['route-a'].experience,120,'unrelated story battles do not become samples for the old training route');
});

test('campaign can choose a productive wild table over a slow low-reward trainer',()=>{
  const f=campaignTaskFixture({training:true});
  Object.assign(f.mechanics.species[0],{baseHP:10,baseDefense:25,baseSpDefense:45,types:['TYPE_GROUND']});
  f.world.maps[0].layout.cells.forEach(c=>{c.encounterType=1;c.behaviorName='MB_TALL_GRASS';});
  f.world.wildEncounters=[{map:f.route.id,land_mons:{encounter_rate:30,mons:Array.from({length:12},()=>({species:'SPECIES_DIGLETT',min_level:30,max_level:30}))}}];
  const trainer={id:41,flagId:1321,minimumLevel:2,maximumLevel:2,partySize:6,expectedExperience:972,target:{kind:'object',map:f.route.id,index:0}};
  const o=f.observation(100,{responses:false});o.playerMemory.storyState.flagIds[1321]=false;
  o.playerMemory.trainer.party[0].stats={attack:80,spAttack:80};
  const selected=selectTrainingObjective({world:f.world,story:f.story,mechanics:f.mechanics,observation:o,objective:f.objective,trainerCatalog:[trainer]});
  assert.equal(selected.target.kind,'encounter-zone');
  assert.equal(selected.trainingRate.units,'trainee-xp-per-emulated-minute');
});
test('an unusable moveset cannot erase an unfinished training requirement',()=>{
  const f=campaignTaskFixture({training:true});
  Object.assign(f.mechanics.species[0],{baseHP:10,baseDefense:25,baseSpDefense:45,types:['TYPE_NORMAL']});
  f.mechanics.moves[0].type='TYPE_GHOST';f.mechanics.typeChart=[{attackingType:'TYPE_GHOST',defendingType:'TYPE_NORMAL',multiplier:0}];
  f.route.layout.cells.forEach(c=>{c.encounterType=1;c.behaviorName='MB_TALL_GRASS';});
  f.world.wildEncounters=[{map:f.route.id,land_mons:{encounter_rate:30,mons:Array.from({length:12},()=>({species:'SPECIES_DIGLETT',min_level:14,max_level:14}))}}];
  const o=f.observation(100,{responses:false});o.playerMemory.trainer.party[0].stats={attack:80,spAttack:80};
  const selected=selectTrainingObjective({world:f.world,mechanics:f.mechanics,observation:o,objective:f.objective});
  assert.equal(selected?.minimumTeamAnchorLevel,36);
  assert.equal(selected?.trainingMethod,'guarded');
});
