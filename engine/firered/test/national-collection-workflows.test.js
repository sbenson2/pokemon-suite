import test from 'node:test';
import assert from 'node:assert/strict';
import * as agendaModule from '../src/suite/postgame-agenda.js';
const {PostgameAgenda,resolvePostgameObjective,postgameChecklist,collectionContext}=agendaModule;
import {nationalCollectionFinishedReason} from '../src/suite/national-dex-agenda.js';

// The live main save was marked exhausted on engine 125 for its exact
// collection. Build 126 adds collection workflows (the cross-island Fire Stone
// purchase, Ruin Valley's Sun Stone, a teammate's King's Rock) without changing
// that collection, so the old record kept the entry idle after the update.
const mon=(species,personality,more={})=>({species,personality,otId:456,validity:'valid',shiny:false,isEgg:false,level:20,experience:8000,heldItem:0,friendship:70,hp:40,maxHp:40,status1:0,
 moves:[33,19],pp:[35,15],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
const args={world:{data:{maps:[],wildEncounters:[]}},mechanics:{data:{species:[16].map(id=>({id,name:'SPECIES_'+id,growthRate:'GROWTH_MEDIUM_FAST'}))}}};
function observation(){
 const o={captureId:'workflows',frame:100,phase:'stable',phaseReasons:[],sram:{sha256:'saved'},emulator:{mode:'overworld',inputReady:true,inBattle:false},
  playerMemory:{map:{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F'},position:{x:9,y:4},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{}},
   gameStats:{savedGame:10},saveAttemptStatus:1,trainer:{partyValidity:'valid',party:[mon(16,1,{slot:0})],usablePartyCount:1,money:100000,bag:{pokeBalls:[{itemId:4,quantity:99}]},
    pokedex:{ownedSpecies:[16,17,18]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0),unknownSlots:0}}}};
 for(const part of [o.sram,o.emulator,o.playerMemory])Object.assign(part,{captureId:o.captureId,frame:o.frame});
 return o;
}
const agendaWith=exhausted=>new PostgameAgenda({schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:null,entries:[],workflows:{dex:{exhausted}},failures:{}});

test('an exhausted record from an older engine is evaluated again once',()=>{
 const o=observation();
 const old={id:'national-collection',context:collectionContext(o),reason:'old engine',summary:null,at:'2026-10-01T06:08:55.000Z',frame:1};
 const agenda=agendaWith(old);
 const entry=postgameChecklist(o,agenda.state.workflows).find(e=>e.id==='national-collection');
 assert.notEqual(entry.exhausted,true,'the 125 record does not keep the entry idle');
 assert.notEqual(entry.executable,false);
 const r=resolvePostgameObjective('national-collection',o,args.world,agenda.state.workflows,{mechanics:args.mechanics});
 agenda.exhaust('national-collection',o,r.target,3000);
 assert.equal(agenda.state.workflows.dex.exhausted.workflows,agendaModule.COLLECTION_WORKFLOWS);
 assert.ok(Number.isInteger(agendaModule.COLLECTION_WORKFLOWS));
 const again=postgameChecklist(o,agenda.state.workflows).find(e=>e.id==='national-collection');
 assert.equal(again.exhausted,true,'the re-evaluated collection is idle again');assert.equal(again.executable,false);
});

test('with the FireRed partner ready, an unexecuted round trip is not reported as waiting for the partner',()=>{
 const summary={total:386,owned:385,local:1,dependency:0,external:0,categories:{'other-games':0,'another-firered-save':0,'partner-borrow':0,'spent-here':0},
  fireRed:{total:189,owned:188,reachable:1,planned:0,partner:1,complete:false}};
 const rows=[{speciesId:186,name:'politoed',status:'local',category:'firered-partner'}];
 assert.match(nationalCollectionFinishedReason(summary,rows),/waits for the FireRed partner game to be ready for its trade round trip: politoed/);
 const ready=nationalCollectionFinishedReason(summary,rows,{fireRedPartnerReady:true});
 assert.doesNotMatch(ready,/waits for the FireRed partner/);
 assert.match(ready,/need a workflow the bot does not have yet: politoed/);
});
