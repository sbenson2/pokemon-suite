// Training-locality policy, not a cartridge rule: staying near a boss may trade
// at most half the reward per opponent compared with another reachable, safe
// option. This prevents a low-level table from vetoing every useful XP source.
// Trainer and wild catalog rewards both omit the common /7 experience factor;
// apply FireRed's 1.5 trainer bonus and divide trainer totals by party size.
// Full-cycle ranking follows this conservative locality eligibility filter.
import {scoreBattleMoves} from './battle-model.js';
import {campaignMemberIdentity} from './campaign-tasks.js';
import {isProgressObservation} from './progress-observation.js';

const FPS=59.7275;
// A trip is paid once per training job, not once per battle. The bound keeps
// distance as a tie-breaker between similarly productive tables.
const TRIP_AMORTIZATION_LIMIT=40;
const normalized=new WeakMap();
function tables(document) {
  const data=document?.data??document??{};
  if(normalized.has(data))return normalized.get(data);
  const entries=key=>Object.values(data[key]??{}).filter(Boolean);
  const value={...data,species:Object.fromEntries(entries('species').map(s=>[s.id,s])),
    moves:Object.fromEntries(entries('moves').map(s=>[s.id,s])),
    speciesNames:new Map(entries('species').map(s=>[s.name,s])),
    trainers:Object.fromEntries(entries('trainers').map(s=>[s.id,s]))};
  normalized.set(data,value);return value;
}

// These are planning priors, not measured timings or a promise of winning.
// The actual move policy still owns health, status, PP and emergency switches.
export function estimateTrainingCycle(candidate,{member,escort=null,party=[member],mechanics,samples={},experienceNeeded=null}={}) {
  const data=tables(mechanics),wild=Boolean(candidate.encounter);
  const trainerIds=candidate.vsSeekerBatch?.trainerIds??[candidate.trainer?.id];
  const opponents=candidate.opponents??(wild?candidate.encounter.mons:trainerIds.flatMap(id=>data.trainers[id]?.party??[]));
  let method=candidate.trainingMethod??'direct',turns=0,weight=0,known=true;
  const attackTurns=(actor,mon)=>{
    const species=typeof mon.species==='string'?data.speciesNames.get(mon.species):data.species[mon.species];
    const level=Number(mon.level??mon.lvl??(Number(mon.min_level)+Number(mon.max_level))/2);
    if(!species||!Number.isFinite(species.baseHP)||!actor?.stats||!Number.isFinite(level))return null;
    const stat=(base,hp=false)=>Math.floor((2*base+31)*level/100)+(hp?level+10:5);
    const opponent={species:species.id,level,hp:stat(species.baseHP,true),maxHp:stat(species.baseHP,true),status1:0,
      stats:{defense:stat(species.baseDefense),spDefense:stat(species.baseSpDefense)}};
    const best=scoreBattleMoves({mechanics:data,player:actor,opponent})[0];
    if(!(best?.score>0))return Infinity;
    const damage=best.score*(2*actor.level/5+2)/50;
    return Math.max(1,Math.ceil(opponent.hp/Math.max(1,damage)));
  };
  for(const mon of opponents??[]) {
    const w=Number(mon.weight??1);weight+=w;
    let count=attackTurns(method==='direct'?member:escort,mon);
    if(count===Infinity&&method==='direct'&&escort){method='switch';count=attackTurns(escort,mon);}
    if(count===Infinity)return {viable:false,xpPerGameMinute:0,method};
    if(count===null){known=false;count=3;}
    turns+=w*count;
  }
  if(!weight){known=false;weight=wild?1:Number(candidate.vsSeekerBatch?.partySize??candidate.trainer?.partySize??1);turns=3*weight;}
  if(wild)turns/=weight;
  const opponentsPerCycle=wild?1:weight;
  const expShare=party.filter(p=>p?.hp>0&&p.heldItem===182).length;
  const participationShare=method==='direct'?1:0.5;
  const xpShare=(expShare?participationShare/2:participationShare)+(member?.heldItem===182?0.5/expShare:0);
  const baseReward=Number(wild?candidate.encounter.expectedExperienceYield:candidate.vsSeekerBatch?.expectedExperience??candidate.trainer?.expectedExperience);
  const response=candidate.trainer?.rematch?0.5:1;
  const traineeExperience=Math.max(0,baseReward/7*(wild?1:1.5)*xpShare*response*(member?.heldItem===197?1.5:1));
  const transitions=Number(candidate.metrics?.transitions??0),steps=Number(candidate.metrics?.localSteps??0);
  const tripSeconds=transitions*18+steps*0.25;
  const battlesNeeded=Number(experienceNeeded)>0&&traineeExperience>0?Math.min(TRIP_AMORTIZATION_LIMIT,Math.ceil(Number(experienceNeeded)/traineeExperience)):1;
  const travelSeconds=tripSeconds/battlesNeeded;
  const battleSeconds=(wild?12:14*(candidate.vsSeekerBatch?.responderCount??1))+turns*5+opponentsPerCycle*3+
    (method==='direct'?0:opponentsPerCycle*7);
  const searchSeconds=wild?Math.max(3,180/Math.max(1,candidate.encounter.rate)):0;
  const rechargeSeconds=candidate.trainer?.rematch?25+8:0;
  const ppBudget=Math.max(1,(member?.pp??[]).reduce((a,b)=>a+b,0));
  const healSeconds=(30+Math.min(6,Number(candidate.healerTransitions??2))*36)*Math.min(1,turns/Math.max(8,ppBudget));
  const seconds=travelSeconds+(battleSeconds*response)+searchSeconds+rechargeSeconds+healSeconds;
  const profile=[campaignMemberIdentity(member),member?.species,Math.floor(Number(member?.level)/5),member?.moves,member?.heldItem,method];
  const source=wild?['wild',candidate.encounter.map]:['trainer',candidate.trainer?.target?.map,trainerIds];
  const key=JSON.stringify([source,profile]);
  const sample=samples[key];
  const priorRate=seconds>0?traineeExperience*60/seconds:0;
  // Do not present emulated time as wall time: paused frames add no duration.
  // At a chosen speed, projected wall-time rate is this rate times that speed.
  const measured=sample?.frames>0&&sample.battles>=2?sample.experience/(sample.frames/FPS)*60:null;
  const timed=Object.values(samples).filter(s=>s.activeMs>0);
  const activeMs=timed.reduce((sum,s)=>sum+s.activeMs,0);
  const speed=activeMs>0?timed.reduce((sum,s)=>sum+s.frames,0)/FPS/(activeMs/1000):null;
  const measuredWall=sample?.activeMs>0&&sample.battles>=2?sample.experience/(sample.activeMs/60000):null;
  const confidence=measured===null?0:Math.min(0.8,sample.battles/10);
  return {key,viable:Number.isFinite(priorRate)&&priorRate>0,method,traineeExperience,seconds,travelSeconds,tripSeconds,battlesNeeded,
    xpPerGameMinute:priorRate*(1-confidence)+(measured??0)*confidence,
    xpPerMinute:speed===null?null:priorRate*speed*(1-confidence)+(measuredWall??priorRate*speed)*confidence,
    measuredXpPerMinute:measuredWall,
    basis:measured===null?'estimated':'measured-and-estimated',measuredXpPerGameMinute:measured,
    battles:sample?.battles??0,matchupKnown:known,components:{battleSeconds,searchSeconds,rechargeSeconds,healSeconds},
    units:'trainee-xp-per-emulated-minute'};
}

export function createTrainingMeasurements(initialState=null) {
  if(initialState&&initialState.schema!=='master-red/training-measurements/v1')throw new TypeError('Invalid training measurements');
  let active=structuredClone(initialState?.active??null);
  const samples=structuredClone(initialState?.samples??{});
  const member=(o,id)=>(o.playerMemory?.trainer?.party??[]).find(p=>campaignMemberIdentity(p)===id);
  const readable=o=>isProgressObservation(o)&&o.playerMemory.trainer?.partyValidity==='valid';
  const field=o=>o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean);
  return {
    commit(objective,o) {
      if(!readable(o))return;
      const p=(o.playerMemory.trainer.party??[]).find(p=>p.slot===objective?.trainingPartySlot&&p.species===objective?.trainingSpecies);
      const identity=campaignMemberIdentity(p),key=objective?.trainingRate?.key;
      if(!identity||!key){if(field(o)&&(!objective||objective.trainingMode==='passive'))active=null;return;}
      if(active?.key===key&&active.identity===identity)return;
      if(!field(o))return;
      active={key,identity,frame:o.frame,activeMs:o.trainingActiveMs??null,experience:p.experience,sawBattle:false};
    },
    observe(o) {
      if(!active||!readable(o))return;
      const p=member(o,active.identity);
      if(!p||!Number.isFinite(p.experience))return;
      if(o.frame<active.frame||p.experience<active.experience){active=null;return;}
      if(o.emulator.inBattle||o.emulator.mode==='battle')active.sawBattle=true;
      if(!active.sawBattle||!field(o)||o.frame<=active.frame)return;
      const sample=samples[active.key]??{experience:0,frames:0,battles:0};
      sample.experience+=p.experience-active.experience;sample.frames+=o.frame-active.frame;sample.battles++;
      if(Number.isFinite(active.activeMs)&&Number.isFinite(o.trainingActiveMs)&&o.trainingActiveMs>=active.activeMs)
        sample.activeMs=(sample.activeMs??0)+o.trainingActiveMs-active.activeMs;
      samples[active.key]=sample;
      // Bound persistent history. Recent profiles are more relevant than old levels.
      if(Object.keys(samples).length>128)delete samples[Object.keys(samples)[0]];
      active={...active,frame:o.frame,activeMs:o.trainingActiveMs??null,experience:p.experience,sawBattle:false};
    },
    samples:()=>structuredClone(samples),
    clear:()=>{active=null;},
    state:()=>active||Object.keys(samples).length?{schema:'master-red/training-measurements/v1',active:structuredClone(active),samples:structuredClone(samples)}:null,
  };
}
export function productiveTrainingOptions({ encounters, trainers }) {
  const safe = [...encounters.filter(({ riskTier }) => riskTier <= 1), ...trainers];
  if (safe.length === 0) return { encounters, trainers };
  const reward = (candidate) => candidate.encounter
    ? candidate.encounter.expectedExperienceYield
    : Number(candidate.trainer.expectedExperience) * 1.5 / Math.max(1, Number(candidate.trainer.partySize ?? 1));
  const completeRewards = safe.every((candidate) => Number.isFinite(reward(candidate)) && reward(candidate) > 0);
  const score = completeRewards ? reward : (candidate) => candidate.encounter
    ? Number(candidate.encounter.expectedWildLevel ?? candidate.encounter.maximumWildLevel)
    : (Number(candidate.trainer.minimumLevel ?? candidate.trainer.maximumLevel) + Number(candidate.trainer.maximumLevel)) / 2;
  const reachable = safe.filter(({ metrics }) => Number.isFinite(metrics?.transitions));
  const minimum = Math.max(0, ...reachable.map(score).filter(Number.isFinite)) / 2;
  if (!(minimum > 0)) return { encounters, trainers };
  const productive = (candidate) => score(candidate) >= minimum;
  return {
    encounters: encounters.filter((candidate) => candidate.riskTier <= 1 && productive(candidate)),
    trainers: trainers.filter(productive),
  };
}
