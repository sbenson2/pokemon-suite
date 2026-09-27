import assert from 'node:assert/strict';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {LINK_QUEST_WATCH,resolveFireRedTravel} from '../engine/firered/src/suite/fire-red-link-quest.js';
import {POSTGAME_WATCH,readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';

export function replayPostgameSupplies({session,saved,inputs,fixture}) {
 const old=saved.metadata.session,request=structuredClone(old.request);
 // A new attempt on the same game, not a reset of the expired hunt's clock.
 const id='supplies-regression',open=state=>createSuiteMission({id,request,route:old.mission.route,...inputs,mechanics:inputs.battle,state});
 let mission=open(null),objective;
 const base=createCampaignPlanner({...inputs,mechanics:inputs.battle});
 const planner={...base,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],
  campaignStatus:()=>({objective:objective?.id}),state:()=>({objective})};
 const playerFor=initialState=>createCentralPlayer({campaignPlanner:planner,initialState,mechanics:inputs.battle,
  advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner})});
 let player=playerFor(null);
 const observer=createFireRedObserver({session,...inputs,runId:id,observeRng:true,
  storyWatch:{flags:[...base.storyWatch().flags,...POSTGAME_WATCH.flags,...LINK_QUEST_WATCH.flags,...(mission.storyWatch?.().flags??[]),700],
   variables:[...POSTGAME_WATCH.variables,...LINK_QUEST_WATCH.variables]}});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui).some(Boolean);
 const quantity=(o,id)=>Object.values(o.playerMemory.trainer.bag).flat().filter(i=>i.itemId===id).reduce((s,i)=>s+i.quantity,0);
 const identity=p=>[p.personality,p.otId,p.species,p.moves,p.experience];
 const before=capture(),medicine=fixture.target==='postgame-field-medicine',restarted=new Set();
 const originals=before.playerMemory.trainer.party.map(identity);let basket=null,last='';
 assert.equal(before.playerMemory.storyState.flagIds[2092],true);
 if(medicine)assert.ok(before.playerMemory.trainer.party.some(p=>p.hp>0&&p.hp/p.maxHp<=0.65));
 else assert.equal(before.playerMemory.trainer.money,103731);
 for(let i=0;i<6500;i++) {
  const after=capture(),m=after.playerMemory;
  if(i===0&&!free(after)){for(let f=0;f<120;f++)session.step([]);continue;}
  const next=mission.inspect(after);assert.equal(next.kind,'policy',next.reason);
  if(next.objective.target.kind==='purchase-items'&&!basket)basket=structuredClone(next.objective.target.items);
  objective=resolveFireRedTravel(next.objective,after,inputs.world);
  const decision=player.decide(after);assert.notEqual(decision.kind,'blocked',JSON.stringify(decision));
  const stage=medicine?(m.ui.party?.stage==='message'?'result':m.ui.party?.itemId===20?'picker':null):
    (m.ui.mart?.stage==='purchase-result'?'result':m.ui.mart?.stage==='quantity'?'quantity':null);
  if(stage&&!restarted.has(stage)){
   mission=open(JSON.parse(JSON.stringify(mission.state)));player=playerFor(JSON.parse(JSON.stringify(player.state())));restarted.add(stage);
  }
  const trace=JSON.stringify([m.map.id,m.position,next.objective.id,m.ui.mart?.stage,m.ui.party?.stage,decision.winner?.recommendation?.kind]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# supplies '+after.frame+' '+trace);last=trace;}
  const done=medicine?quantity(after,20)===quantity(before,20)-1&&m.trainer.party.every(p=>p.hp===p.maxHp):
    basket?.every(item=>quantity(after,item.itemId)>=item.quantity)&&next.objective.id==='hunt-mewtwo';
  if(done&&free(after)){
   assert.ok(restarted.has('result')&&restarted.has(medicine?'picker':'quantity'),'restart at selection and result boundaries');
   assert.deepEqual(m.trainer.party.map(identity),originals,'preserve party identity, moves and XP');
   assert.equal(after.sram.sha256,before.sram.sha256,'shopping and medicine do not overwrite the native save');
   if(medicine){assert.equal(m.trainer.money,before.playerMemory.trainer.money);assert.equal(next.objective.target.kind,'purchase-items','medicine yields back to the same hunt supplies');}
   else {
    const cost=basket.reduce((n,item)=>n+(item.quantity-quantity(before,item.itemId))*item.unitPrice,0);
    assert.equal(m.trainer.money,before.playerMemory.trainer.money-cost);assert.ok(m.trainer.money>=10000);
    assert.equal(quantity(after,20),20);assert.ok(quantity(after,19)>=5&&quantity(after,23)>=5);
    assert.equal(decision.kind,'act');assert.notEqual(decision.winner?.recommendation?.kind,'wait-for-supported-objective');
   }
   assert.deepEqual(old,saved.metadata.session,'the expired attempt remains unchanged');
   console.log('# supplies receipt '+JSON.stringify({medicine,frame:after.frame,money:m.trainer.money,items:m.trainer.bag.items,restarted:[...restarted]}));
   return {before,after};
  }
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let f=0;f<(action.holdFrames??1);f++)session.step(action.buttons??[]);
  for(let f=0;f<(action.releaseFrames??0);f++)session.step([]);
 }
 throw Error('Postgame supply transaction did not complete: '+last);
}
