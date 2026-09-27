import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
import {observePostgameProgress} from '../src/suite/postgame-watchdog.js';
import {QmmSupplyTask} from '../src/suite/qmm-supply.js';
import {BreedingTask} from '../src/suite/native-breeding.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// FireRed rolls for a pending Egg once per 256 daycare steps, only while no Egg
// is held (pokefirered src/daycare.c TryProduceOrHatchEgg); a different-species
// pair from one trainer succeeds 20% of the time (PARENTS_LOW_COMPATIBILITY).
// Live hatch 113 (2026-09-26) needed 19 rolls, about 4,860 steps: the owner
// walked the whole time, yet the five-minute watchdog saw no evidence change
// after 13 failed rolls and its 120-second boundary blocked the dirty breeding
// acquisition. The rolls are credited, but only 64 of them (0.8^64 ≈ 6e-7).
const CREDIT=64,OWNER='postgame-egg-sticker-hatch-113-39882228',CENTER='MAP_FOUR_ISLAND_POKEMON_CENTER_1F';
const mon=(species,personality,more={})=>({validity:'valid',species,personality,otId:10,isEgg:false,shiny:false,level:50,hp:100,maxHp:100,
 heldItem:0,friendship:255,experience:125000,moves:[33],pp:[35],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
const facts=(id,name,groups)=>({id,name:'SPECIES_'+name,eggGroups:groups.map(g=>'EGG_GROUP_'+g),genderRatio:{call:'PERCENT_FEMALE',args:[50]}});
const mechanics={data:{species:[facts(19,'RATTATA',['FIELD']),facts(232,'DONPHAN',['FIELD']),facts(149,'DRAGONITE',['WATER_1','DRAGON'])],moves:[{id:33,pp:35,power:40,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}]}};
const floor=(id,width,height)=>({id,properties:{},objectEvents:[],warpEvents:[],coordEvents:[],connections:[],
 layout:{id,width,height,cells:Array.from({length:width*height},(_,i)=>({x:i%width,y:Math.floor(i/width),collision:0,elevation:3,behaviorName:'MB_NORMAL'}))}});
const world={data:{wildEncounters:[],maps:[floor(CENTER,21,3),
 {...floor('MAP_FOUR_ISLAND',4,4),objectEvents:[{x:1,y:1,elevation:3,script:'FourIsland_EventScript_DaycareMan'}]},
 {...floor('MAP_FOUR_ISLAND_POKEMON_DAY_CARE',4,4),objectEvents:[{x:1,y:1,elevation:3,script:'FourIsland_PokemonDayCare_EventScript_DaycareWoman'}]}]}};
const story={data:{scripts:[]}};
// Rattata (female: personality & 255 < 127) and Donphan (male) from one trainer.
const parents=[mon(19,1),mon(232,200)],lead=mon(149,3,{slot:0,level:100,moves:[19]});
function setup(){
 const o={captureId:'egg-wait',frame:100,phase:'stable',phaseReasons:[],sram:{sha256:'a'.repeat(64)},
  emulator:{mode:'overworld',inBattle:false,inputReady:true},
  playerMemory:{map:{id:CENTER},position:{x:0,y:1},ui:{},saveAttemptStatus:1,
   storyState:{flagIds:{2092:true,2112:true,2116:true,614:false},variableIds:{0x404a:1}},gameStats:{savedGame:10,eggsHatched:113},
   trainer:{partyValidity:'valid',party:[lead],usablePartyCount:1,money:970799,bag:{items:[],pokeBalls:[]},pokedex:{ownedSpecies:[19,149,232]},
    storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)}},
   postgameEvidence:{acquisition:{prompt:null,daycare:{validity:'valid',parents:parents.map((p,slot)=>({...p,slot,steps:0})),pendingEgg:false,offspringPersonality:0,menuCursor:null}}}}};
 for(const part of [o.sram,o.emulator,o.playerMemory])Object.assign(part,{frame:o.frame,captureId:o.captureId});
 const state={schema:'pokemon-suite/postgame/v1',status:'running',agenda:{enabled:true,active:'egg-sticker',failures:{}},
  preparation:{kind:'postgame',phase:'complete'},
  // The retained live checkpoint shape: both parents deposited, no Egg yet.
  acquisition:{schema:'pokemon-suite/native-acquisition/v1',kind:'breeding',requestId:OWNER,speciesId:19,
   parents,itemId:null,phase:'waiting-for-egg',feesPaid:0,parentsReturned:[],initial:[lead,...parents].map(encounterFingerprint),
   originalParty:[encounterFingerprint(lead)],dirty:true,deposited:true}};
 return {o,state};
}
const daycare=o=>o.playerMemory.postgameEvidence.acquisition.daycare;
const rolls=o=>Math.floor((daycare(o).parents.find(p=>p.slot===1).steps+1)/256);
const open=(state,clock,options={})=>createPostgameController({world,story,mechanics,state,clock:()=>clock.now,...options});
// Live pace: 16 daycare steps per 1.37 s decision (4,360 steps in 372 s, 193.5 fps).
function walk(c,o,clock,{decisions,steps=16,until=()=>false}){
 const made=[];
 for(let i=0;i<decisions;i++){
  o.frame+=265;o.captureId='egg-wait:'+o.frame;for(const part of [o.sram,o.emulator,o.playerMemory])Object.assign(part,{frame:o.frame,captureId:o.captureId});
  o.playerMemory.position={x:o.frame%2?0:20,y:1};
  for(const p of daycare(o).parents)p.steps+=steps;
  clock.now+=1370;const d=c.decide(o);made.push(d);if(until(d))break;
 }
 return made;
}

test('a long native Egg wait is progress for its owned breeding task, not a stalled transaction',()=>{
 const {o,state}=setup(),clock={now:1000};
 let c=open(state,clock);
 // The unfixed watchdog opened its boundary here: five active minutes, 13 failed rolls.
 const early=walk(c,o,clock,{decisions:220});
 assert.equal(rolls(o),13);
 assert.equal(c.state().watchdog.boundary,undefined,'advancing native Egg rolls are progress of the owned wait');
 // An owner restart (update handoff) keeps crediting the same wait.
 c=open(JSON.parse(JSON.stringify(c.state())),clock);
 const late=walk(c,o,clock,{decisions:94});
 const blocked=[...early,...late].find(d=>d.kind==='blocked');
 assert.equal(blocked,undefined,blocked?.reason);
 assert.equal(rolls(o),19,'the live Egg came on roll 19');
 assert.equal(c.state().watchdog.boundary,undefined,'no progress-timeout boundary may start while daycare rolls advance');
 assert.equal(c.state().acquisition.phase,'waiting-for-egg');
 // The Egg appears: the same owner continues to the Day Care Man.
 o.playerMemory.storyState.flagIds[614]=true;Object.assign(daycare(o),{pendingEgg:true,offspringPersonality:0x5a5a});
 clock.now+=1370;c.decide(o);
 assert.equal(c.state().acquisition.phase,'receiving-egg');
 assert.deepEqual(c.state().objective.target,{kind:'object',map:'MAP_FOUR_ISLAND',index:0});
});

test('an Egg that never comes still stops once the bounded roll credit is spent, with its reason',()=>{
 const {o,state}=setup(),clock={now:1000},c=open(state,clock);
 let opened=null;
 const decisions=walk(c,o,clock,{decisions:6000,until:d=>{if(opened==null&&c.state().watchdog.boundary)opened=rolls(o);return d.kind==='blocked';}});
 const blocked=decisions.at(-1);
 assert.equal(blocked.kind,'blocked','a walk that never produces an Egg must still stop');
 assert.ok(opened>CREDIT,`the progress timeout waits for all ${CREDIT} credited rolls (it opened after ${opened})`);
 const count=Number(blocked.reason.match(/The Day Care produced no Egg in (\d+) rolls/)?.[1]);
 assert.ok(count>CREDIT,blocked.reason);
 assert.match(blocked.reason,/120-second active deadline/);
 assert.match(c.state().watchdog.reason,/^Progress timeout: finish the owned transaction/,'the protected transaction keeps its timeout reason');
 assert.match(c.state().watchdog.reason,/The Day Care produced no Egg/);
 // Bounded: the credited rolls, then five active minutes and the 120-second boundary.
 assert.ok(decisions.length*1.37<=CREDIT*256*1.37/16+300+120+5,`stopped after ${decisions.length} decisions`);
 assert.equal(c.state().acquisition.requestId,OWNER);
 assert.equal(c.state().acquisition.dirty,true,'the deposited parents stay owned for review');
});

test('a breeding owner that stops walking still times out after five active minutes and keeps its transaction',()=>{
 const {o,state}=setup(),clock={now:1000},c=open(state,clock);
 walk(c,o,clock,{decisions:40});
 walk(c,o,clock,{decisions:230,steps:0});
 const w=c.state().watchdog;
 assert.ok(w.boundary,'daycare rolls that never advance are not progress');
 assert.doesNotMatch(w.reason,/Day Care produced no Egg/,'a stalled walk is not an exhausted Egg wait');
 assert.equal(c.state().acquisition.requestId,OWNER,'the dirty acquisition is retained');
});

test('once the Egg is pending, walking is no longer credited as the Egg wait',()=>{
 const {o,state}=setup(),clock={now:1000},c=open(state,clock);
 walk(c,o,clock,{decisions:44});
 o.playerMemory.storyState.flagIds[614]=true;Object.assign(daycare(o),{pendingEgg:true,offspringPersonality:0x5a5a});
 const decisions=walk(c,o,clock,{decisions:320});
 assert.equal(c.state().acquisition.phase,'receiving-egg');
 assert.ok(c.state().watchdog.boundary||decisions.some(d=>d.kind==='blocked'),'steps toward a pending Egg are not rolls');
});

test('only rolls the cartridge makes are credited: a held Egg personality stops the rolls',()=>{
 const {o,state}=setup(),clock={now:1000},c=open(state,clock);
 // daycare.c rolls only while offspringPersonality is 0, whatever the flag reads.
 daycare(o).offspringPersonality=0x2a2a;
 walk(c,o,clock,{decisions:230});
 assert.equal(c.state().acquisition.phase,'waiting-for-egg');
 assert.ok(c.state().watchdog.boundary,'steps without native rolls are not progress');
});

test('the credit also needs the pending-Egg flag to read clear, whatever the held Egg personality',()=>{
 const {o,state}=setup(),task=new BreedingTask({requestId:OWNER,speciesId:19,parents,world,mechanics,state:state.acquisition});
 for(const p of daycare(o).parents)p.steps=3071;
 assert.deepEqual(task.progressEvidence(o),['daycare-egg-rolls',12]);
 for(const pendingEgg of [true,null]){daycare(o).pendingEgg=pendingEgg;assert.equal(task.progressEvidence(o),null,'pending Egg flag '+pendingEgg);}
});

test('rolls after the Egg is received are not credited while the parents wait in the Day Care',()=>{
 // RemoveEggFromDayCare zeroes offspringPersonality (daycare.c), so the cartridge
 // keeps rolling while the owner walks back to withdraw the deposited parents.
 const {o,state}=setup(),clock={now:1000},egg=mon(19,77,{isEgg:true,slot:1,level:5,experience:0,friendship:15,moves:[33]});
 o.playerMemory.trainer.party=[lead,egg];
 Object.assign(state.acquisition,{phase:'returning-parents',egg:encounterFingerprint(egg)});
 const c=open(state,clock);
 walk(c,o,clock,{decisions:230});
 assert.equal(c.state().acquisition.phase,'returning-parents');
 assert.ok(rolls(o)>=14,'the cartridge kept rolling');
 assert.ok(c.state().watchdog.boundary,'rolls outside the Egg wait are not progress of the owned task');
});

test('daycare rolls are credited only to the breeding owner, not to a Mail supply that owns the watchdog',()=>{
 const {o,state}=setup(),clock={now:1000};
 state.qmm={...new QmmSupplyTask({requestId:'mail-supply',world,story,mechanics}).state,dirty:true};
 // The dirty supply owns the watchdog and waits for input; the parents keep gaining steps.
 o.emulator.inputReady=false;
 const c=open(state,clock,{qmmSupply:{enabled:true}});
 walk(c,o,clock,{decisions:230});
 const w=c.state().watchdog;
 assert.match(w.owner,/^mail-supply:/);
 assert.ok(rolls(o)>=14);
 assert.ok(w.boundary,'another owner gets no credit for the breeding task’s native rolls');
});

test('the watchdog itself reads no daycare steps for any owner',()=>{
 const {o}=setup(),state={};let now=0;
 // Another owner walking while Pokémon stay in the daycare gets no credit.
 for(let i=0;i<=62;i++){for(const p of daycare(o).parents)p.steps+=256;observePostgameProgress(state,o,'fame-checker',now);now+=5000;}
 assert.ok(state.idleMs>=300000);
});
