import {dataOf,indexed} from '../player/mechanics-data.js';
import {battleDecisionState,scoreBattleMoves,partyMatchupPlan,directTrainingPlan,maximumCredibleIncomingDamage,battleRecoveryPlan} from '../player/battle-model.js';
import {deriveBattleLegality} from '../player/battle-legality.js';
import {evaluateMoveUse} from '../player/move-knowledge.js';
import {campaignMemberIdentity as identity} from '../player/campaign-tasks.js';
import {isMajorBattle} from '../player/major-battles.js';

const SCHEMA='pokemon-suite/campaign-diagnostics/v1',FPS=59.7275;
const valid=n=>Number.isFinite(n)&&n>=0;
const delta=(a,b)=>valid(a)&&valid(b)&&a>=b?a-b:0;
const copy=structuredClone;
const label=s=>String(s??'').replace(/^(MOVE|SPECIES|ITEM)_/,'').toLowerCase().replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const point=o=>o.playerMemory?.position&&o.playerMemory?.map?.id?{map:o.playerMemory.map.id,...o.playerMemory.position}:null;
const pointKey=p=>p&&JSON.stringify([p.map,p.x,p.y]);
const isTraining=c=>c.task?.kind==='training';
const items=m=>Object.fromEntries(Object.values(m.trainer?.bag??{}).filter(Array.isArray).flatMap(a=>a.filter(e=>e.itemId>0&&valid(e.quantity)).map(e=>[e.itemId,e.quantity])));
const counters=()=>({activeMs:0,frames:0,xp:0,traineeXp:0,battles:0,steps:0});
const outcomes={1:'won',2:'lost',3:'draw',4:'ran',5:'player-teleported',6:'opponent-fled',7:'caught'};

// Observation only. Scores are the current bot model, not an independent proof
// that an action was optimal. Unknown outcomes and partial battles stay explicit.
export function createCampaignDiagnostics({run,mechanics={},state=null}) {
 if(!run?.id||state&&(state.schema!==SCHEMA||state.runId!==run.id))throw Error('Diagnostics belong to another campaign.');
 const rules=dataOf(mechanics);
 const d=state?copy(state):{schema:SCHEMA,measurementRevision:2,runId:run.id,sequence:0,last:null,currentBattle:null,lastChoice:null,pendingMoves:{},pendingItem:null,measurementErrors:[],
  totals:{decisions:0,confirmedMoveAttempts:0,switches:0,itemsConsumed:0,faints:0,battles:0,battleTurns:0},
  moves:{},items:{},members:{},training:{byMap:{},byObjective:{}},battles:[],recent:[],reviewSignals:{},
  navigation:{routesAttempted:0,routesCompleted:0,stalls:0,divergences:0,boundaryHandoffs:0,plannedStepsCompleted:0,
   observedSteps:0,trainingSteps:0,overworldActiveMs:0,travelActiveMs:0,travelFrames:0,mapChanges:0,revisitedPositions:0,trainingRevisits:0,
   encountersDuringTravel:0,visited:[],lastPosition:null},archive:{droppedEvents:0,error:null},pendingEvents:[]};
 // Restored aggregates retain their original measurement qualification.
 d.measurementRevision??=1;
 function emit(kind,frame,details={}) {
  const event={id:`${run.id}:${++d.sequence}:${frame}`,sequence:d.sequence,frame,kind,...details};
  d.recent.push(event);if(d.recent.length>64)d.recent.shift();
  d.pendingEvents.push(event);if(d.pendingEvents.length>512){d.pendingEvents.shift();d.archive.droppedEvents++;}
  return event;
 }
 function describe(p){
  if(!p)return null;
  return {identity:identity(p)??p.identity??null,slot:p.slot,species:p.species,name:label(indexed(rules.species,p.species)?.name),
   level:p.level,hp:p.hp,maxHp:p.maxHp,status:p.status1??p.status??null,ability:p.ability??null,heldItem:p.heldItem??p.item??null};
 }
 function finishBattle(o,c,reason=null) {
  const b=d.currentBattle;if(!b)return;
  const outcome=reason??outcomes[o.playerMemory?.battleOutcome]??'unknown';
  const report={...b,endFrame:o.frame,activeMs:delta(c.supervision?.elapsedMs,b.startActiveMs),frames:delta(o.frame,b.startFrame),outcome};
  d.battles.push(report);if(d.battles.length>32)d.battles.shift();emit('battle-finished',o.frame,report);
  d.currentBattle=null;d.pendingMoves={};d.lastChoice=null;
 }
 function observe(o,c) {
  if(o?.phase!=='stable'||!valid(o.frame)||o.playerMemory?.trainer?.partyValidity!=='valid')return;
  d.suspended=false;
  const m=o.playerMemory,party=m.trainer.party??[],b=o.emulator?.inBattle?battleDecisionState(m,m.ui):null;
  const field=!b&&o.emulator?.mode==='overworld'&&!m.questLog?.playback&&c.status!=='finishing'&&!c.completion;
  const liveBattlers=(b?.battlers??[b?.player,b?.opponent]).filter(p=>p&&Number.isInteger(p.battler)&&
    p.battler<(b.battlersCount??((Number(m.battleTypeFlags)&1)?4:2))&&!(Number(b.absentBattlerFlags)&(1<<p.battler)));
  const current={frame:o.frame,activeMs:c.supervision?.elapsedMs,map:m.map?.id,position:point(o),training:isTraining(c),
   field,
   trainee:c.task?.member??null,objective:c.objective?.id??'starting',battle:b?{counter:m.gameStats?.battles,turn:b.turn,slot:b.playerPartySlot,
   slots:Object.fromEntries(liveBattlers.filter(p=>(p.battler&1)===0)
     .map(p=>[p.battler,b.battlerPartyIndexes?.[p.battler]??(p.battler===b.player?.battler?b.playerPartySlot:null)])),
   hp:Object.fromEntries(liveBattlers.filter(p=>valid(p.hp)).map(p=>[JSON.stringify([p.battler,
    (p.battler&1)===0?identity(party.find(q=>q.slot===(b.battlerPartyIndexes?.[p.battler]??b.playerPartySlot))):b.battlerPartyIndexes?.[p.battler],p.species]),{hp:p.hp,battler:p.battler,species:p.species}]))}:null,
   steps:m.gameStats?.steps,party:party.filter(p=>identity(p)).map(p=>({...describe(p),experience:p.experience,evs:p.evs??null})),items:items(m)};
  const last=d.last;
  if(last&&o.frame<last.frame){finishBattle(o,c,'observation-rebased');d.lastChoice=null;d.pendingMoves={};d.pendingItem=null;emit('observation-rebased',o.frame);}
  if(last&&o.frame>=last.frame) {
   const activeMs=delta(current.activeMs,last.activeMs),frames=delta(current.frame,last.frame),steps=delta(current.steps,last.steps);
   let targets=[];
   if(last.training){
    const byMap=d.training.byMap[last.map??'unknown']??=counters(),byObjective=d.training.byObjective[last.objective]??=counters();targets=[byMap,byObjective];
    for(const t of targets){t.activeMs+=activeMs;t.frames+=frames;t.steps+=steps;}
   }
   for(const p of current.party){
    const previous=last.party.find(q=>q.identity===p.identity);if(!previous)continue;
    const xp=delta(p.experience,previous.experience);
    const record=d.members[p.identity]??={...p,xp:0,levels:0,faints:0,evGains:{}};
    Object.assign(record,describe(p),{experience:p.experience});record.xp+=xp;record.levels+=delta(p.level,previous.level);
    for(const [stat,value] of Object.entries(p.evs??{}))record.evGains[stat]=(record.evGains[stat]??0)+delta(value,previous.evs?.[stat]);
    if(previous.hp>0&&p.hp===0){record.faints++;d.totals.faints++;emit('fainted',o.frame,{member:describe(p)});}
    if(p.heldItem!==previous.heldItem)emit('held-item-changed',o.frame,{member:describe(p),before:previous.heldItem,after:p.heldItem});
    if(xp>0){
     for(const t of targets){t.xp+=xp;if(p.identity===last.trainee)t.traineeXp+=xp;}
     if(d.currentBattle){d.currentBattle.xpRecipients??={};d.currentBattle.xpRecipients[p.identity]=(d.currentBattle.xpRecipients[p.identity]??0)+xp;}
     emit('experience',o.frame,{member:describe(p),xp,training:last.training,trainee:p.identity===last.trainee,objective:last.objective,map:last.map});
    }
   }
   if(last.field){
    d.navigation.observedSteps+=steps;
    d.navigation.overworldActiveMs+=activeMs;
    if(last.training)d.navigation.trainingSteps+=steps;
    else if(last.navigating){d.navigation.travelActiveMs+=activeMs;d.navigation.travelFrames+=frames;}
    if(b&&!last.training)d.navigation.encountersDuringTravel++;
   }
   const pending=d.pendingItem;
   if(pending&&valid(current.items[pending.itemId]??0)&&valid(pending.quantity)&&(current.items[pending.itemId]??0)<pending.quantity){
    const consumed=pending.quantity-(current.items[pending.itemId]??0);
    const item=d.items[pending.itemId]??={consumed:0};item.consumed+=consumed;d.totals.itemsConsumed+=consumed;
    emit('item-consumed',o.frame,{...pending,consumed,partyAfter:current.party.map(describe),evidence:'native-bag-decrease'});d.pendingItem=null;
   }
  }
  if(d.currentBattle&&(!b||valid(b&&current.battle.counter)&&current.battle.counter!==d.currentBattle.counter))finishBattle(o,c,b?'battle-boundary-unobserved':null);
  if(b){
   if(!d.currentBattle){
    d.currentBattle={startFrame:o.frame,startActiveMs:current.activeMs,counter:current.battle.counter,map:current.map,
     objective:current.objective,training:current.training,partial:!last||Boolean(last.battle),trainerId:b.trainerId??null,
     major:isMajorBattle(o,rules),opponent:describe(b.opponent),participants:[],switches:0,turns:0};
    d.totals.battles++;if(current.training)(d.training.byMap[current.map??'unknown']??=counters()).battles++;
    emit('battle-started',o.frame,copy(d.currentBattle));
   }
   const active=party.find(p=>p.slot===b.playerPartySlot),id=identity(active);
   if(id&&!d.currentBattle.participants.includes(id))d.currentBattle.participants.push(id);
   if(last?.battle&&current.battle.counter===last.battle.counter){
    const turns=delta(b.turn,last.battle.turn);d.totals.battleTurns+=turns;d.currentBattle.turns+=turns;
    for(const [key,hp] of Object.entries(current.battle.hp)){
     const before=last.battle.hp?.[key];
     if(before&&before.hp!==hp.hp)emit('hp-change',o.frame,{...hp,previousHp:before.hp,change:hp.hp-before.hp,turn:b.turn,cause:'not-attributed'});
    }
    for(const [battler,slot] of Object.entries(current.battle.slots)){
     const from=last.party.find(p=>p.slot===last.battle.slots?.[battler]),to=current.party.find(p=>p.slot===slot);
     if(from?.identity&&to?.identity&&from.identity!==to.identity){
      d.totals.switches++;d.currentBattle.switches++;emit('switch-observed',o.frame,{battler:Number(battler),from:describe(from),fromSlot:from.slot,to:describe(to),turn:b.turn});
     }
    }
   }
   for(const [battler,pending] of Object.entries(d.pendingMoves)){
    const live=b.battlers?.find(p=>p?.battler===Number(battler))??(b.player?.battler===Number(battler)?b.player:null);
    const owner=party.find(p=>p.slot===current.battle.slots[battler]);
    if(pending.identity===identity(owner)&&live?.moves?.[pending.moveSlot]===pending.moveId&&
       live?.moveState?.lastMove===pending.moveId&&live.pp?.[pending.moveSlot]<pending.pp){
     const move=d.moves[pending.moveId]??={attempts:0,ppSpent:0};move.attempts++;move.ppSpent+=pending.pp-live.pp[pending.moveSlot];d.totals.confirmedMoveAttempts++;
     emit('move-attempt-confirmed',o.frame,{...pending,ppAfter:live.pp[pending.moveSlot],turn:b.turn,evidence:'native-pp-and-last-move'});delete d.pendingMoves[battler];
    }
   }
  }
  if(!field&&(c.status==='finishing'||c.completion||m.questLog?.playback))d.navigation.lastPosition=null;
  if(field&&current.position&&pointKey(current.position)!==pointKey(d.navigation.lastPosition)){
   if(d.navigation.lastPosition?.map&&current.map!==d.navigation.lastPosition.map)d.navigation.mapChanges++;
   const key=JSON.stringify([current.objective,current.training,current.position]);
   if(d.navigation.visited.includes(key)){
    if(current.training)d.navigation.trainingRevisits++;else d.navigation.revisitedPositions++;
   }else {d.navigation.visited.push(key);if(d.navigation.visited.length>1024)d.navigation.visited.shift();}
   d.navigation.lastPosition=current.position;
  }
  d.last=current;
 }
 function decide(o,decision,c){
  const r=decision?.winner?.recommendation,m=o?.playerMemory;
  if(d.last?.frame===o?.frame)d.last.navigating=Boolean(decision?.action?.movementLease||r?.kind==='move-toward');
  if(c.training&&isTraining(c)){
   const key=JSON.stringify([c.task?.member,c.task?.targetLevel,c.training.id,c.training.trainingMethod,c.training.trainingRate?.key]);
   if(d.training.planKey!==key){emit('training-plan',o.frame,{task:copy(c.task),plan:copy(c.training)});d.training.planKey=key;}
   d.training.current=copy(c.training);
  }
  if(!r||o.phase!=='stable'||m?.trainer?.partyValidity!=='valid')return;
  const b=o.emulator?.inBattle?battleDecisionState(m,m.ui):null;
  const relevant=b&&['choose-battle-command','choose-battle-move','choose-party-member','choose-bag-item'].includes(r.kind)||r.kind==='choose-bag-item';
  if(!relevant)return;
  const key=JSON.stringify([d.currentBattle?.startFrame,b?.turn,b?.playerPartySlot,r,
    r.kind==='choose-bag-item'?items(m)[r.targetItemId]??0:null]);
  if(key===d.lastChoice)return;d.lastChoice=key;d.totals.decisions++;
  const actor=m.trainer.party.find(p=>p.slot===b?.playerPartySlot),opponent=b?.opponents?.find(p=>p.battler===r.targetBattler)??b?.opponent;
  if(b&&(!b.player||!opponent)){emit('decision-evidence-unavailable',o.frame,{recommendation:copy(r)});return;}
  const scores=b?scoreBattleMoves({mechanics:rules,player:b.player,opponent,weather:b.weather}):[];
  const legality=b?deriveBattleLegality({battleTypeFlags:m.battleTypeFlags,battle:b,mechanics:rules,party:m.trainer.party}):null;
  const moves=b?(b.player.moves??[]).flatMap((moveId,moveSlot)=>{
   if(!moveId)return [];
   const move=indexed(rules.moves,moveId),use=move?evaluateMoveUse({move,attacker:b.player,defender:opponent,mechanics:rules,battle:b}):{usable:false,known:false,reasons:['unknown-move']};
   const blocked=legality.moves.blocked.find(v=>v.moveSlot===moveSlot)?.reasons??[];
   const score=scores.find(s=>s.moveSlot===moveSlot);return [{moveId,moveSlot,name:label(move?.name),pp:b.player.pp?.[moveSlot],
    usable:use.usable&&blocked.length===0,known:use.known,reasons:[...new Set([...use.reasons,...blocked])],
    effectiveness:score?.effectiveness??null,expectedUtility:score?.score??null,requirements:use.requirements??[]}];
  }):[];
  const matchup=b?partyMatchupPlan({mechanics:rules,party:m.trainer.party,opponentSpecies:opponent?.species,opponentBattle:opponent,activeSpecies:b.player?.species,observation:o}):null;
  const direct=b?directTrainingPlan({mechanics:rules,member:b.player,opponent,weather:b.weather}):null;
  const chosen=r.kind==='choose-battle-move'?moves.find(v=>v.moveId===r.targetMoveId&&(!Number.isInteger(r.targetMoveSlot)||v.moveSlot===r.targetMoveSlot)):null;
  const reviewSignals=chosen&&!chosen.usable?[...chosen.reasons]:[];
  if(chosen?.effectiveness===0)reviewSignals.push('damaging-move-immune');
  if(r.kind==='choose-battle-command'&&r.targetCommand==='pokemon'&&r.objective==='improve-battle-matchup'&&isTraining(c)&&direct)reviewSignals.push('review-switch-away-from-capable-trainee');
  for(const signal of reviewSignals)d.reviewSignals[signal]=(d.reviewSignals[signal]??0)+1;
  const event=emit('decision',o.frame,{turn:b?.turn??null,map:m.map?.id,objective:c.objective?.id,task:copy(c.task??null),
   recommendation:copy(r),actor:describe(actor?{...actor,...b.player}:b?.player),opponent:describe(opponent),moves,
   bestDamageMove:scores[0]??null,matchup:matchup?{best:describe(matchup.best.member),bestScore:matchup.best.score,activeScore:matchup.active?.score??null,coverageUpgrade:matchup.coverageUpgrade}:null,
   directTraining:direct,maximumIncomingDamage:b?maximumCredibleIncomingDamage({mechanics:rules,attacker:opponent,defender:b.player}):null,
   recovery:b?battleRecoveryPlan(m,b,rules):null,legality,reviewSignals,
   advisor:decision.winner.advisor,reason:decision.reason??null,constraints:copy(decision.winner.constraints??[]),evidenceRefs:copy(decision.winner.evidenceRefs??[])});
  if(chosen)d.pendingMoves[b.player.battler??0]={choice:event.id,identity:identity(actor),moveId:chosen.moveId,moveSlot:chosen.moveSlot,pp:chosen.pp};
  if(r.kind==='choose-bag-item'&&r.targetItemId>0)d.pendingItem={choice:event.id,itemId:r.targetItemId,quantity:items(m)[r.targetItemId]??0,
   targetPartySlot:r.targetPartySlot??null,battle:Boolean(b),partyBefore:m.trainer.party.map(describe)};
 }
 function execution({observation:o,decision,execution:e}){
  const lease=decision?.action?.movementLease;if(!lease||!e)return;
  const n=d.navigation;n.routesAttempted++;
  const result=e.movementLease??e.interrupted??'unconfirmed';
  if(['target-reached','destination-reached','position-changed'].includes(result))n.routesCompleted++;
  if(result==='stalled')n.stalls++;
  if(['route-diverged','diverged'].includes(result))n.divergences++;
  if(['mode-changed','cartridge-boundary-changed'].includes(result))n.boundaryHandoffs++;
  let at=lease.origin,plannedSteps=0;
  for(const segment of lease.segments??[{target:lease.target}]){const to=segment.target;if(at&&to&&at.map===to.map&&[at.x,at.y,to.x,to.y].every(Number.isFinite))plannedSteps+=Math.abs(at.x-to.x)+Math.abs(at.y-to.y);at=to;}
  if(['target-reached','destination-reached'].includes(result))n.plannedStepsCompleted+=plannedSteps;
  emit('route-execution',e.endFrame??o.frame,{startFrame:e.startFrame,result,plannedSteps,frames:delta(e.endFrame,e.startFrame),origin:lease.origin,target:lease.target,
   objective:decision?.winner?.recommendation?.objective??null,kind:lease.kind,interrupted:e.interrupted??null});
 }
 function summary(){
  const {last,lastChoice,pendingMoves,pendingItem,pendingEvents,...result}=copy(d);delete result.navigation.visited;delete result.navigation.lastPosition;
  result.archive.pendingEvents=pendingEvents.length;
  for(const group of [result.training.byMap,result.training.byObjective])for(const t of Object.values(group)){
   t.traineeXpPerMinute=t.activeMs>0?t.traineeXp*60000/t.activeMs:null;t.traineeXpPerGameMinute=t.frames>0?t.traineeXp*FPS*60/t.frames:null;
   t.traineeShare=t.xp>0?t.traineeXp/t.xp:null;
  }
  delete result.training.planKey;
  result.navigation.routeCompletionRate=result.navigation.routesAttempted?result.navigation.routesCompleted/result.navigation.routesAttempted:null;
  return result;
 }
 return {observe,decide,execution,summary,state:()=>copy(d),pendingEvents:()=>copy(d.pendingEvents),
  suspend(o,c){
   if(!d.suspended){finishBattle(o,c,'interrupted-by-control-change');emit('automation-paused',o.frame,{reason:c.reason??c.status});}
   d.last=null;d.pendingMoves={};d.pendingItem=null;d.lastChoice=null;d.suspended=true;
  },
  ackEvents(sequence){d.pendingEvents=d.pendingEvents.filter(e=>e.sequence>sequence);d.archive.error=null;},
  archiveError(error){d.archive.error=String(error);},
  measurementError(error){d.measurementErrors.push(String(error));if(d.measurementErrors.length>16)d.measurementErrors.shift();}};
}
