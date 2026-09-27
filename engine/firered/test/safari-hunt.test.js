import test from 'node:test';
import assert from 'node:assert/strict';
import {SafariMission,readSafariStatus,chooseSafariCapture} from '../src/suite/safari-mission.js';

const request={game:'firered',speciesId:113,quantity:1,shiny:'required',locationId:'any',natures:[],gender:'any',abilityId:null,minIvs:{},moves:[],heldItemId:null,finalLevel:null,ball:{id:'any',requirement:'preferred'},encounterLevel:{min:1,max:100},limits:{maxEncounters:10000,maxMinutes:600,minBalls:0,maxSpend:10000},afterCompletion:'stop-save'};
const mon={validity:'valid',species:113,personality:123,otId:234,shiny:false,isEgg:false};
const observation=()=>({frame:100,phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F'},trainer:{partyValidity:'valid',party:[{hp:20}],money:24712,storage:{validity:'valid',boxCounts:Array(14).fill(0)}},ui:{},safari:{validity:'valid',balls:0,steps:0}}});
test('Safari entry finishes its fade before freezing the game for RNG planning',()=>{
 const m=new SafariMission({id:'safari',request}),o=observation();m.initialize(o);
 o.playerMemory.trainer.party[0].moves=[230];o.playerMemory.map.id='MAP_SAFARI_ZONE_NORTH';
 o.playerMemory.safari={validity:'valid',balls:30,steps:600};o.phase='transition';
 assert.equal(m.inspect(o).kind,'wait');
 o.phase='stable';assert.equal(m.inspect(o).kind,'rng');
});
test('Safari Chansey uses the north land table and current game, not the Snorlax reset setup',()=>{
 const m=new SafariMission({id:'safari',request}),o=observation();m.initialize(o);
 o.playerMemory.trainer.party[0].moves=[230];
 const d=m.inspect(o);assert.equal(d.objective.target.map,'MAP_SAFARI_ZONE_NORTH');
 assert.equal(d.objective.safari,true);assert.equal(m.state.method,'safari-land');
 assert.equal(m.captureRequirements().safari,true);
 assert.equal(m.capturePolicy().targets[0].required.shiny,true);
 assert.throws(()=>new SafariMission({id:'bad',request:{...request,speciesId:150}}),/Safari/);
});
test('Safari prepares a Sweet Scent user through normal capture and storage before entering',()=>{
 const m=new SafariMission({id:'safari',request}),o=observation();m.initialize(o);
 o.playerMemory.trainer.party=Array.from({length:6},(_,slot)=>({slot,species:slot+1,moves:[33]}));
 let d=m.inspect(o);assert.equal(d.objective.target.kind,'party-roster');assert.equal(d.objective.target.maximumPartySize,5);
 o.playerMemory.trainer.party.pop();d=m.inspect(o);assert.equal(d.objective.target.map,'MAP_ROUTE24');assert.deepEqual(d.objective.captureSpecies,[43]);
 o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:{...mon,species:43,moves:[71,230]}};
 d=m.inspect(o);assert.equal(d.kind,'protect');assert.equal(m.state.utilityCapture,true);
 assert.deepEqual(m.capturePolicy().targets[0].required.species,[43]);assert.equal(m.capturePolicy().targets[0].required.shiny,undefined);
 assert.ok(m.captureRequirements().ballIds.includes(4));assert.equal(m.captureRequirements().safari,false);
});
test('Safari preparation retires from the current visit before traveling for Sweet Scent',()=>{
 const m=new SafariMission({id:'safari',request}),o=observation();m.initialize(o);
 o.playerMemory.map.id='MAP_SAFARI_ZONE_NORTH';o.playerMemory.safari={validity:'valid',balls:30,steps:200};
 o.playerMemory.ui.startMenu={cursor:0,order:['retire','pokedex','pokemon','bag','player','option','exit']};
 assert.equal(m.inspect(o).recommendation.targetItem,'retire');
});
test('prepared Safari hunt hands control to RNG timing instead of walking for random encounters',()=>{
 const m=new SafariMission({id:'safari',request}),o=observation();m.initialize(o);
 o.playerMemory.trainer.party[0].moves=[230];o.playerMemory.map.id='MAP_SAFARI_ZONE_NORTH';
 assert.equal(m.inspect(o).kind,'rng');
});
test('any shiny preempts all Safari target filters and budgets before the first action',()=>{
 const m=new SafariMission({id:'safari',request}),o=observation();m.initialize(o);
 m.state.elapsedMs=600*60000;o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:{...mon,species:102,shiny:true}};
 assert.equal(m.inspect(o).kind,'protect');assert.equal(m.state.protected,true);
 assert.equal(m.state.encounters,1);
 assert.equal(m.inspect(o).kind,'capture');
});
test('ordinary encounters are counted once, escaped normally, and never reset to a Snorlax anchor',()=>{
 const m=new SafariMission({id:'safari',request}),o=observation();m.initialize(o);o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:mon};
 o.playerMemory.battleTypeFlags=132;o.playerMemory.ui.battle={stage:'action',cursor:0};
 assert.equal(m.inspect(o).recommendation.targetIndex,3);assert.equal(m.inspect(o).recommendation.targetAction,'run');assert.equal(m.state.encounters,1);
 o.emulator.inBattle=false;o.playerMemory.encounter=null;m.inspect(o);
 o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:mon};m.inspect(o);assert.equal(m.state.encounters,2);
});
test('Safari bait improves Chansey catch factor and renews protection before more balls',()=>{
 assert.equal(chooseSafariCapture({validity:'valid',balls:30,catchFactor:2,escapeFactor:9,bait:0,rocks:0}).action,'bait');
 assert.equal(chooseSafariCapture({validity:'valid',balls:29,catchFactor:3,escapeFactor:9,bait:4,rocks:0}).action,'ball');
 assert.equal(chooseSafariCapture({validity:'valid',balls:0,catchFactor:3,escapeFactor:9,bait:4,rocks:0}),null);
 assert.equal(chooseSafariCapture({validity:'unknown'}),null);
});
test('native Safari inventory and counters are read from the actual game, not ordinary bag items',()=>{
 const symbols={gNumSafariBalls:{address:100},gSafariZoneStepCounter:{address:102},gBattleStruct:{address:104}};
 const memory=new Map([[100,Uint8Array.of(29)],[102,Uint8Array.of(200,0)],[104,Uint8Array.of(0,16,0,2)],[0x02001079,Uint8Array.of(0,4,9,3)]]);
 const session={readMemory(a,n){assert.equal(memory.get(a)?.length,n);return memory.get(a);}};
 assert.deepEqual(readSafariStatus(session,{data:{symbols}},132),{validity:'valid',balls:29,steps:200,rocks:0,bait:4,escapeFactor:9,catchFactor:3});
});
test('freed battle structures after fleeing do not hide remaining Safari balls and steps',()=>{
 const symbols={gNumSafariBalls:{address:100},gSafariZoneStepCounter:{address:102},gBattleStruct:{address:104}};
 const memory=new Map([[100,Uint8Array.of(30)],[102,Uint8Array.of(180,0)],[104,new Uint8Array(4)]]);
 const result=readSafariStatus({readMemory:a=>memory.get(a)},{data:{symbols}},132);
 assert.equal(result.validity,'valid');assert.equal(result.balls,30);assert.equal(result.steps,180);
 assert.equal(chooseSafariCapture(result),null);
});
