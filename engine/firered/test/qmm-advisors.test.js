import assert from 'node:assert/strict';
import test from 'node:test';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// Advisor rules the Mail supply relies on: Mail holders cannot be stored, a
// task can reserve deposit boxes (Box 3 slot 1 stays empty), and a task can
// require a level-up move such as Recycle.
const center={id:'MAP_CELADON_CITY_POKEMON_CENTER_1F',connections:[],warpEvents:[],objectEvents:[],coordEvents:[],
 layout:{width:5,height:5,cells:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),collision:0,elevation:3,behaviorName:i===8?'MB_PC':'MB_NORMAL',encounterType:0}))}};
const world={maps:[center]};
let pid=1;
const mon=(species,slot,{heldItem=0,box}={})=>({validity:'valid',species,slot,...(box!==undefined?{box}:{}),level:30,hp:60,maxHp:60,moves:[33],heldItem,personality:pid++,otId:7,ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1}});
function storage(party,stored,ui){
 return {phase:'stable',frame:1,captureId:'qmm-storage',emulator:{mode:'storage',inputReady:true},
  playerMemory:{map:{id:center.id},position:{x:3,y:2},trainer:{party,partyCount:party.length,usablePartyCount:party.length,
   storage:{pokemon:stored,boxCounts:[30,30,17,0,0,0,0,0,0,0,0,0,0,0]}},ui:{storage:ui}}};
}
const advise=(o,objective)=>createPolicyAdvisors({world,teamPlan:{starterFamily:[],acquisitions:[],utilityAcquisitions:[]},campaignPlanner:{select:()=>objective}})
 .flatMap(a=>a.advise(o)??[]).find(p=>p.advisor==='quest')?.recommendation;

test('a Pokémon holding Mail is never chosen for deposit',()=>{
 const party=[mon(22,0),mon(122,1,{heldItem:132}),mon(149,2),mon(47,3),mon(83,4),mon(143,5)];
 const wanted={...mon(73,0,{box:2}),slot:0};
 const objective={id:'roster',target:{kind:'party-roster',map:center.id,requiredFingerprints:[encounterFingerprint(wanted),...[0,2,3,4].map(i=>encounterFingerprint(party[i]))],maximumPartySize:6}};
 const r=advise(storage(party,[wanted],{stage:'storage-main',boxOption:'deposit',cursorArea:'party',cursorPosition:0,currentBox:0}),objective);
 assert.equal(r.kind,'choose-storage-party-member');
 assert.equal(r.targetSpecies,143,'the Mail holder (Mr. Mime) stays in the party');
});

test('a task can keep deposits out of Box 3 so its first slot stays empty',()=>{
 const party=[mon(22,0),mon(149,1),mon(47,2),mon(83,3),mon(143,4),mon(73,5)];
 const objective={id:'deposit',target:{kind:'party-roster',map:center.id,requiredFingerprints:party.slice(0,5).map(encounterFingerprint),maximumPartySize:5,avoidDepositBoxes:[2]}};
 const r=advise(storage(party,[],{stage:'deposit-box',boxOption:'deposit',depositBox:0}),objective);
 assert.deepEqual([r.kind,r.targetBox],['choose-storage-box',3],'boxes 1–2 are full and Box 3 is reserved');
 const plain=advise(storage(party,[],{stage:'deposit-box',boxOption:'deposit',depositBox:0}),{...objective,target:{...objective.target,avoidDepositBoxes:undefined}});
 assert.equal(plain.targetBox,2,'without the reservation the first box with room is used');
});

const moves={3:{id:3,power:15,type:'TYPE_NORMAL',accuracy:85,effect:'EFFECT_MULTI_HIT'},33:{id:33,power:35,type:'TYPE_NORMAL',accuracy:95},112:{id:112,power:0,type:'TYPE_PSYCHIC',accuracy:0,effect:'EFFECT_DEFENSE_UP_2'},
 93:{id:93,power:50,type:'TYPE_PSYCHIC',accuracy:100},115:{id:115,power:0,type:'TYPE_PSYCHIC',accuracy:0,effect:'EFFECT_REFLECT'},
 96:{id:96,power:0,type:'TYPE_PSYCHIC',accuracy:0,effect:'EFFECT_ATTACK_UP'},278:{id:278,power:0,type:'TYPE_NORMAL',accuracy:100,effect:'EFFECT_RECYCLE'}};
function learning(stage,objective,{moveId=278,known=[112,93,115,96]}={}){
 const o={captureId:'learn',frame:5,phase:'stable',emulator:{mode:'overworld',inputReady:true},
  playerMemory:{map:{id:'MAP_ROUTE23'},trainer:{partyCount:1,usablePartyCount:1,party:[{slot:0,species:122,level:33,hp:60,maxHp:60,moves:known,pp:known.map(()=>20)}]},
   ui:{moveLearning:{stage,partySlot:0,moveId,cursor:0}}}};
 return createPolicyAdvisors({mechanics:{moves,species:{122:{id:122,types:['TYPE_PSYCHIC','TYPE_PSYCHIC']}}},campaignPlanner:{select:()=>objective,selectTraining:()=>null}})
  .find(a=>a.id==='quest').advise(o)?.recommendation;
}

test('a required level-up move is learned, keeping the task’s other moves',()=>{
 const objective={id:'train-recycle',target:{kind:'map',map:'MAP_ROUTE23'},learnMoveIds:[278],keepMoveIds:[115,112]};
 assert.equal(learning('confirm-replace',objective).targetOption,'yes');
 const forget=learning('forget-move',objective);
 assert.equal(forget.kind,'choose-move-to-forget');
 assert.ok([1,3].includes(forget.targetMoveSlot),'Confusion or Meditate is replaced, never Barrier or Reflect');
 assert.equal(learning('confirm-replace',{id:'plain',target:{kind:'map',map:'MAP_ROUTE23'}}).targetOption,'no','ordinary training still declines Recycle');
});

test('an ordinary level-up move never replaces a move the task keeps',()=>{
 // Native Recycle training (level 15): DoubleSlap replaced Barrier before keepMoveIds applied here.
 const objective={id:'train-recycle',target:{kind:'map',map:'MAP_ROUTE11'},learnMoveIds:[278],keepMoveIds:[115,112]};
 const known=[112,93,164,96];
 const plain=learning('forget-move',{id:'plain',target:{kind:'map',map:'MAP_ROUTE11'}},{moveId:3,known});
 assert.deepEqual([plain.kind,known[plain.targetMoveSlot]],['choose-move-to-forget',112],'without keepMoveIds the weakest move, Barrier, is forgotten');
 const kept=learning('forget-move',objective,{moveId:3,known});
 assert.equal(kept.kind,'choose-move-to-forget');
 assert.notEqual(known[kept.targetMoveSlot],112,'Barrier stays');assert.equal(known[kept.targetMoveSlot],96,'the weakest unkept move (Meditate) goes instead');
 const replace=learning('confirm-replace',objective,{moveId:3,known:[112,115,112,115]});
 assert.equal(replace.targetOption,'no','with only kept moves the new move is declined');
});
