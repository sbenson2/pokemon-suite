import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';

const lead={validity:'valid',slot:0,species:4,personality:99,otId:7,level:50,hp:100,maxHp:100,status1:0,
 stats:{attack:70,defense:70,spAttack:70,spDefense:70,speed:70},moves:[33],pp:[35]};
const target={...lead,slot:0,species:105,personality:321,level:44,hp:111,maxHp:111,shiny:false,isEgg:false,
 nature:{id:21,name:'Gentle'},ivs:{hp:10,attack:6,defense:0,speed:15,spAttack:5,spDefense:13}};
const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{
 species:[{id:4,constant:'SPECIES_CHARMANDER',name:'Charmander',types:['TYPE_FIRE']},{id:105,constant:'SPECIES_MAROWAK',name:'Marowak',types:['TYPE_GROUND']}],
 moves:[{id:33,pp:35,power:35,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}]}}};
const shop={kind:'shop',cost:1800,objective:{id:'stock-postgame-supplies',taskKind:'recovery',
 target:{kind:'purchase-items',map:'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F',objectIndex:0,
 items:[{itemId:2,quantity:4,unitPrice:1200,stockIndex:0},{itemId:23,quantity:1,unitPrice:600,stockIndex:5}]}}};
function observe({shiny=false,balls=3}={}){
 const o={captureId:'maintenance-capture',frame:100,phase:'stable',phaseReasons:[],sram:{sha256:'before'},
 emulator:{mode:'battle',inBattle:true,inputReady:true},playerMemory:{map:{id:'MAP_VICTORY_ROAD_3F'},position:{x:28,y:3},
 storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{}},gameStats:{savedGame:10},
 battleTypeFlags:4,battleOutcome:0,encounter:{kind:'wild',validity:'valid',pokemon:{...target,shiny}},
 battle:{player:lead,opponent:{...target,shiny},turn:0,runAttempts:0},ui:{battle:{stage:'action',cursor:0}},
 trainer:{party:[lead],partyCount:1,partyValidity:'valid',usablePartyCount:1,money:100000,pokedex:{ownedSpecies:[4]},
 bag:{pokeBalls:balls?[{itemId:2,quantity:balls}]:[],items:[]},storage:{validity:'valid',unknownSlots:0,boxCounts:Array(14).fill(0),pokemon:[]}}}};
 for(const part of [o.emulator,o.sram,o.playerMemory])Object.assign(part,{captureId:o.captureId,frame:o.frame});
 return o;
}
const initial=care=>({schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,failures:{}},preparation:{phase:'complete'},
 objective:shop.objective,fieldCare:care,watchdog:{owner:'postgame-maintenance',lastAt:1000,idleMs:0,seen:[]}});
const open=state=>createPostgameController({...args,state,clock:()=>1000});

for(const care of [{active:shop},{active:{kind:'center'},suspendedShopping:shop}]){
 test(`an owned ${care.suspendedShopping?'suspended':'active'} supply basket defers new ordinary captures across restart`,()=>{
  let c=open(initial(structuredClone(care)));
  for(let i=0;i<2;i++){
   const decision=c.decide(observe());
   assert.equal(c.state().player.encounterSafety.capture,null);
   assert.equal(decision.winner?.recommendation?.targetCommand,'run');
   assert.deepEqual(c.state().fieldCare,care);
   c=open(JSON.parse(JSON.stringify(c.state())));
  }
 });
}
test('a supply trip still protects shiny encounters',()=>{
 const c=open(initial({active:structuredClone(shop)}));c.decide(observe({shiny:true}));
 assert.equal(c.state().player.encounterSafety.capture?.pokemon.shiny,true);
});
test('ordinary collection becomes eligible again after the retained basket completes',()=>{
 const c=open(initial({active:structuredClone(shop)}));
 c.decide(observe());
 const field=observe({balls:4});field.emulator={...field.emulator,mode:'overworld',inBattle:false};
 Object.assign(field.playerMemory,{encounter:null,battle:null,ui:{}});
 field.playerMemory.trainer.bag.items=[{itemId:23,quantity:1}];
 c.decide(field);
 assert.equal(c.state().fieldCare.active,null);
 c.decide(observe({balls:4}));
 assert.equal(c.state().player.encounterSafety.capture?.pokemon.species,105);
});
test('an outstanding collection prerequisite still captures during a supply basket',()=>{
 for(const care of [{active:structuredClone(shop)},{active:{kind:'center'},suspendedShopping:structuredClone(shop)}]){
  const state=initial(structuredClone(care));state.preparation={kind:'postgame',phase:'prerequisites'};
  const c=open(state);c.decide(observe());
  assert.equal(c.state().player.encounterSafety.capture?.pokemon.species,105);
 }
});
test('starting supplies cannot discard an existing ordinary capture or bypass its empty-ball stop',()=>{
 const original=open(initial({}));original.decide(observe({balls:0}));
 const state=original.state(),fingerprint=state.player.encounterSafety.capture?.fingerprint;
 assert.ok(fingerprint);state.fieldCare={active:structuredClone(shop)};
 const resumed=open(JSON.parse(JSON.stringify(state))),decision=resumed.decide(observe({balls:0}));
 assert.equal(decision.reason,'capture-ball-reserve-reached');
 assert.equal(resumed.state().player.encounterSafety.capture.fingerprint,fingerprint);
});
