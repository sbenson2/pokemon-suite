import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../src/player/campaign.js';
const mod=await import('../src/suite/static-mission.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const request={game:'firered',speciesId:150,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,ball:{id:'any',requirement:'preferred'},minIvs:{},moves:[],heldItemId:null,finalLevel:null,encounterLevel:{min:1,max:100},limits:{minBalls:10,maxSpend:999999,maxMinutes:120,maxEncounters:1000}};
const world={data:{maps:[{id:'MAP_CERULEAN_CAVE_B1F',objectEvents:[]},{id:'MAP_CERULEAN_CAVE_B1F_BAD'}]}};
const observation=()=>({phase:'stable',emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'before'},playerMemory:{map:{id:'MAP_CERULEAN_CAVE_B1F'},ui:{},storyState:{flagIds:{700:false}},gameStats:{savedGame:2},saveAttemptStatus:1,trainer:{money:10000,partyValidity:'valid',party:[{}],storage:{validity:'valid',boxCounts:Array(14).fill(0)},bag:{pokeBalls:[{itemId:2,quantity:99}]}}}});
test('Articuno observes its current puzzle after restoration without changing campaign progress signatures',()=>{
 const w={data:{maps:mod.STATIC_ENCOUNTERS.map(e=>({id:e.map,objectEvents:[{script:e.script}]}))}};
 const open=state=>new mod.StaticMission({id:'articuno',request:{...request,speciesId:144},world:w,state});
 const mission=open(),restored=open(structuredClone(mission.state));
 for(const flag of [76,77,723]){
  assert.ok(mission.storyWatch?.().flags.includes(flag),'the mission must request native puzzle evidence');
  assert.ok(restored.storyWatch?.().flags.includes(flag),'restoration retains the same observation contract');
  assert.ok(!createCampaignPlanner().storyWatch().flags.includes(flag),'unrelated campaign timeout signatures remain compatible');
  assert.ok(!new mod.StaticMission({id:'mewtwo',request,world:w}).storyWatch().flags.includes(flag));
 }
});
test('legendary hunts verify the remaining encounter and save an anchor before touching it',()=>{
 assert.equal(typeof mod.StaticMission,'function');
 const w=structuredClone(world);w.data.maps[0]={id:'MAP_CERULEAN_CAVE_B1F',objectEvents:[{script:'CeruleanCave_B1F_EventScript_Mewtwo'}]};
 const m=new mod.StaticMission({id:'mewtwo',request,world:w}),o=observation();m.initialize(o);
 assert.equal(m.state.route.speciesId,150);assert.equal(m.beforeInteraction(o,{winner:{recommendation:{kind:'interact-with-object',objective:'hunt-mewtwo'}}}),true);
 assert.equal(m.inspect(o).objective.target.kind,'save-game');
 const unavailable=observation();unavailable.playerMemory.storyState.flagIds[700]=true;
 assert.throws(()=>new mod.StaticMission({id:'other',request,world:w}).initialize(unavailable),/already|available/);
});
test('legendary resets are limited to an unmatched target and can never discard an incidental shiny',()=>{
 assert.equal(typeof mod.StaticMission,'function');
 const w=structuredClone(world);w.data.maps[0].objectEvents=[{script:'CeruleanCave_B1F_EventScript_Mewtwo'}];
 const m=new mod.StaticMission({id:'mewtwo',request,world:w}),o=observation();m.initialize(o);m.state.phase='hunting';m.state.anchor={stateSha256:'anchor'};
 o.emulator.inBattle=true;o.emulator.mode='battle';
 const pokemon={validity:'valid',species:150,personality:1,otId:2,shiny:false,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
 o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon};assert.equal(m.inspect(o).kind,'reset');
 o.playerMemory.encounter.pokemon={...pokemon,species:42,shiny:true};assert.equal(m.inspect(o).kind,'protect');
 assert.equal(m.state.protected,true);
 o.playerMemory.storyState.flagIds[700]=true;
 assert.doesNotThrow(()=>m.initialize(o),'resuming an already protected legendary must not re-test its consumed map flag');
 o.playerMemory.encounter.pokemon=pokemon;assert.notEqual(m.inspect(o).kind,'reset');
});
test('legendary birds time the initial interaction while Mewtwo times the later dialog confirmation',()=>{
 for(const e of mod.STATIC_ENCOUNTERS){
  const m=new mod.StaticMission({id:e.name,request:{...request,speciesId:e.speciesId},world:{data:{maps:[{id:e.map,objectEvents:[{script:e.script}]}]}}});
  m.state.phase='hunting';const o=observation();o.playerMemory.map.id=e.map;
  const act=kind=>({action:{buttons:['a']},winner:{recommendation:{kind}}});
  assert.equal(m.generationTrigger(o,act('interact-with-object')),e.speciesId!==150);
  o.playerMemory.ui.fieldDialog={};
  assert.equal(m.generationTrigger(o,act('acknowledge-cartridge-prompt')),e.speciesId===150);
  m.state.protected=true;assert.equal(m.generationTrigger(o,act('interact-with-object')),false);
 }
});
test('a legacy bird timing reset preserves hunt budgets and refuses to change a protected encounter',()=>{
 const e=mod.STATIC_ENCOUNTERS.find(e=>e.speciesId===144),world={data:{maps:[{id:e.map,objectEvents:[{script:e.script}]}]}};
 const m=new mod.StaticMission({id:'articuno',request:{...request,speciesId:144},world});
 Object.assign(m.state,{elapsedMs:123456,encounters:3,resets:2,anchor:{stateSha256:'before-generation'},rng:{attempts:3,anchor:{stateSha256:'already-generated'},attemptSeed:null,delay:null}});
 m.state.protected=true;assert.equal(m.prepareGenerationReset?.(),false);assert.equal(m.state.rng.anchor.stateSha256,'already-generated');
 m.state.protected=false;assert.equal(m.prepareGenerationReset(),true);
 assert.deepEqual([m.state.elapsedMs,m.state.encounters,m.state.resets],[123456,3,2]);
 assert.equal(m.state.rng.attempts,3);assert.equal(m.state.rng.calibrationStartAttempts,3);assert.equal(m.state.rng.anchor,undefined);
 assert.equal(m.state.anchor.stateSha256,'before-generation');assert.equal(m.prepareGenerationReset(),false);
});
