import test from 'node:test';
import assert from 'node:assert/strict';
import {SnorlaxMission, supportsSnorlax} from '../src/suite/snorlax-mission.js';
const request={game:'firered',speciesId:143,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,ball:{id:'any',requirement:'required'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,limits:{maxEncounters:3,maxMinutes:600,minBalls:100,maxSpend:50000},afterCompletion:'prepare-trade'};
const observation=()=>({frame:10,phase:'stable',sram:{sha256:'a'},emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{map:{id:'MAP_PALLET_TOWN'},position:{x:1,y:1},storyState:{flagIds:{84:false,128:true,573:true}},trainer:{money:118328,bag:{pokeBalls:[{itemId:4,quantity:11},{itemId:2,quantity:7},{itemId:3,quantity:4}]},partyValidity:'valid',party:[{hp:100,maxHp:100}]},ui:{},gameStats:{savedGame:1}}});
test('Snorlax timing reaches an attainable seed when its native prompt advances RNG twice per frame',()=>{
 const m=new SnorlaxMission({id:'hunt',request});
 for(const stride of [1,2,4,8]){
  let remaining=128*stride,steps=0;
  while(remaining>0&&steps++<256){
   remaining-=(m.generationWaitFrames?.(remaining)??Math.min(remaining,600))*stride;
   assert.ok(remaining>=0,'Skipped the attainable confirmation seed');
  }
  assert.equal(remaining,0);
 }
});
test('honors the current save, required location and spending reserve',()=>{
 const m=new SnorlaxMission({id:'hunt',request});const o=observation();m.initialize(o);
 assert.equal(m.state.route.map,'MAP_ROUTE12');assert.ok(m.state.preparation.cost<=50000);
 assert.ok(m.state.preparation.totalBalls>100);
 assert.equal(m.inspect(o).objective.target.map,'MAP_VIRIDIAN_CITY_MART');
 const gone=observation();gone.playerMemory.storyState.flagIds[84]=true;
 assert.throws(()=>new SnorlaxMission({id:'h',request}).initialize(gone),/already gone/);
 assert.throws(()=>new SnorlaxMission({id:'h',request:{...request,locationId:'10:309:21:'}}).initialize(o),/already gone/);
 assert.equal(supportsSnorlax({...request,moves:[156]}).supported,false);
});
test('never resets a shiny, unreadable encounter, or battle outside its anchor',()=>{
 const m=new SnorlaxMission({id:'hunt',request});const o=observation();m.initialize(o);m.state.phase='hunting';m.state.anchor={statePath:'anchor'};
 o.playerMemory.map.id='MAP_ROUTE12';o.emulator.inBattle=true;o.emulator.mode='battle';
 o.playerMemory.encounter={kind:'wild',validity:'unknown'};
 assert.equal(m.inspect(o).kind,'wait');
 o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:{validity:'valid',species:143,personality:1,otId:2,shiny:true,level:30,ivs:{}}};
 assert.equal(m.inspect(o).kind,'protect');assert.equal(m.state.encounters,1);
 m.inspect(o);assert.equal(m.state.encounters,1);
 const other=new SnorlaxMission({id:'other',request});other.initialize(observation());other.state.phase='hunting';other.state.anchor={statePath:'anchor'};
 o.playerMemory.encounter.pokemon.shiny=false;
 assert.equal(other.inspect(o).kind,'reset');
 o.playerMemory.map.id='MAP_ROUTE1';assert.notEqual(other.inspect(o).kind,'reset');
});
test('resume retains encounter and elapsed limits and stops before a new attempt',()=>{
 const m=new SnorlaxMission({id:'hunt',request});m.initialize(observation());m.state.encounters=3;m.state.anchor={statePath:'anchor'};m.state.phase='hunting';
 const restored=new SnorlaxMission({id:'hunt',request,state:m.state});
 assert.match(restored.inspect(observation()).reason,/encounter limit/);
});
test('shiny-required captures despite conflicting traits and expired search budgets',()=>{
 const strict={...request,natures:['adamant'],gender:'female',abilityId:47,minIvs:{attack:31},ball:{id:'poke-ball',requirement:'required'}};
 const m=new SnorlaxMission({id:'hunt',request:strict}),o=observation();m.initialize(o);
 m.state.phase='hunting';m.state.anchor={statePath:'anchor'};m.state.elapsedMs=600*60000;m.state.encounters=3;
 o.playerMemory.map.id='MAP_ROUTE12';o.emulator.inBattle=true;
 o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:{validity:'valid',species:143,isEgg:false,personality:200,otId:2,shiny:true,nature:{name:'Hardy'},abilityNum:0,ivs:{attack:0}}};
 assert.equal(m.inspect(o).kind,'protect');
 assert.equal(m.state.phase,'capturing');
 assert.equal(m.captureRequirements().shinyPriority,true);
 const restored=new SnorlaxMission({id:'hunt',request:strict,state:m.state});
 assert.equal(restored.inspect(o).kind,'protect');
 const ordinary=new SnorlaxMission({id:'ordinary',request:{...strict,shiny:'any'}});ordinary.initialize(observation());
 assert.equal(ordinary.matches(o.playerMemory.encounter.pokemon),false);
});
test('an ordinary Snorlax request honors its Hidden Power type',()=>{
 const wanted=new SnorlaxMission({id:'hp',request:{...request,shiny:'any',hiddenPower:{type:'fire'}}});
 const snorlax=ivs=>({validity:'valid',species:143,isEgg:false,personality:200,otId:2,shiny:false,nature:{name:'Hardy'},abilityNum:0,ivs});
 assert.equal(wanted.matches(snorlax({hp:31,attack:30,defense:31,speed:30,spAttack:30,spDefense:31})),true);
 assert.equal(wanted.matches(snorlax({hp:31,attack:31,defense:31,speed:31,spAttack:31,spDefense:31})),false);
});
test('closes the completed shop before selecting another shop’s stock',()=>{
 const m=new SnorlaxMission({id:'hunt',request}),o=observation();m.initialize(o);
 const goal=m.state.preparation.purchases.find(p=>p.itemId===4);
 o.playerMemory.trainer.bag.pokeBalls.find(b=>b.itemId===4).quantity=goal.quantity;
 o.playerMemory.map.id='MAP_VIRIDIAN_CITY_MART';o.playerMemory.ui.mart={stage:'purchase-result'};
 assert.equal(m.inspect(o).objective.target.items[0].itemId,4);
 o.playerMemory.ui.mart=null;
 assert.equal(m.inspect(o).objective.target.items[0].itemId,2);
});
