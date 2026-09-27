import {createCampaignPlanner} from '../player/campaign.js';
import {createPolicyAdvisors} from '../player/advisors.js';
import {createCentralPlayer,mapRecommendation} from '../player/delegator.js';
import {qualifyRngWithCalibration} from './timing-calibration.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {evaluateRngTraits} from './target-traits.js';
import {rngMenuIntent,runTitleTiming,nativeSavePreservesPokemon} from './input-methods.js';
import {advanceMainRng,mainRngDistance,searchLandCandidates,rankRngMethods,findLandDelays,landSpeciesProbability} from './fire-red-rng.js';

const sameSource=(a,b)=>a?.stateSha256===b?.stateSha256&&a?.sramSha256===b?.sramSha256;
const frames=steps=>steps.reduce((n,s)=>n+(s.frames??0),0);
const pause=()=>new Promise(r=>setImmediate(r));
class FoundShiny extends Error{constructor(pokemon,ctx){super('Protected shiny');this.pokemon=pokemon;this.steps=structuredClone(ctx.steps);}}

export async function executeRngPlan({plan,source,observe,execute,reset,signal,onProgress=()=>{}}){
 if(plan?.schema!=='pokemon-suite/rng-input-plan/v1'||!plan.verified)throw new Error('RNG input plan is not verified');
 if(!sameSource(plan.source,source))throw new Error('RNG plan source checkpoint changed');
 if(!Array.isArray(plan.steps)||plan.steps.length>20000||frames(plan.steps)>1000000)throw new Error('RNG input plan exceeds its budget');
 for(const s of plan.steps){
  if(s.operation==='reset'){if(!plan.nativeSaveVerified||!reset)throw new Error('RNG reset requires a verified native save');continue;}
  const running=Array.isArray(s.buttons)&&s.buttons.length===2&&s.buttons.includes('b')&&s.buttons.some(b=>['up','down','left','right'].includes(b));
  if(!Number.isSafeInteger(s.frames)||s.frames<1||s.frames>600||!Array.isArray(s.buttons)||(s.buttons.length>1&&!running)||s.buttons.some(b=>!['a','b','start','select','up','down','left','right'].includes(b)))throw new Error(`Invalid RNG input: ${JSON.stringify(s)}`);
 }
 let completed=0;
 const result=o=>{
  const p=o?.playerMemory?.encounter?.pokemon;
  if(o?.playerMemory?.encounter?.validity==='valid'&&p?.validity==='valid'&&p.shiny)return {status:'protected-shiny',pokemon:p,matched:p.personality===plan.pokemon?.personality&&p.species===plan.pokemon?.species,completed};
  if(plan.shinyRequired===false&&o?.playerMemory?.encounter?.validity==='valid'&&p?.validity==='valid'&&encounterFingerprint(p)===encounterFingerprint(plan.pokemon))return {status:'protected-target',pokemon:p,matched:true,completed};
  return null;
 };
 for(const step of plan.steps){
  const o=observe(),found=result(o);if(found)return found;
  if(signal?.aborted)return {status:'cancelled',completed};
  if(step.operation==='reset'){
   if(o.emulator?.inBattle)throw new Error('RNG replay cannot reset an encounter');
   await reset();
  }else await execute({buttons:step.buttons,holdFrames:step.frames,releaseFrames:0});
  completed++;onProgress({completed,total:plan.steps.length,frame:observe().frame});
 }
 return result(observe())??{status:'prediction-mismatch',completed};
}

// Qualification uses isolated emulator instances. The returned artifact contains
// only controller inputs; the owning game never loads a rehearsed Pokémon/state.
export async function buildWildRngPlan(options){
 return qualifyRngWithCalibration({...options,qualify:profile=>qualifyWildRngPlan({...options,profile})});
}
async function qualifyWildRngPlan({openTrial,source,game,area,speciesId,request={},profile,signal,onProgress=()=>{},maxAdvances=1000000}){
 if(game!=='firered')throw new Error('This game needs its own wild RNG adapter');
 const shinyRequired=request.shiny!=='any';
 const protect=(p,mechanics)=>p?.shiny||(!shinyRequired&&p?.species===speciesId&&evaluateRngTraits(p,request,mechanics).matched);
 profile=structuredClone(profile??{});
 const candidates=[],prepared=[];let active=null;
 async function open(){
  const lab=await openTrial();
  if(lab.commit&&!sameSource(lab.commit,source)){lab.session.close();throw new Error('RNG qualification source changed');}
  const inputs=lab.inputs,world=inputs.world,mechanics=inputs.battle;
  const objective={id:'rng-encounter-setup',target:{kind:'encounter-zone',map:area},safari:/SAFARI_ZONE/.test(area),dialogue:'advance',choice:'yes',deferOptionalDetours:true};
  const base=createCampaignPlanner({world,story:inputs.story,mechanics});
  const planner={...base,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],state:()=>({objective})};
  const player=createCentralPlayer({advisors:createPolicyAdvisors({world,mechanics,campaignPlanner:planner}),campaignPlanner:planner,mechanics});
  const ctx={lab,steps:[],observe:()=>lab.capture?lab.capture():lab.observer.capture(),world,mechanics,player};
  ctx.step=async(n,buttons=[])=>{
   for(let left=n;left>0;){
    if(signal?.aborted)throw new Error('RNG planning cancelled');
    const count=Math.min(600,left);ctx.steps.push({frames:count,buttons:[...buttons]});
    for(let i=0;i<count;i++)lab.session.step(buttons);left-=count;await pause();
   }
  };
  ctx.action=async a=>{await ctx.step(a.holdFrames||1,a.buttons??[]);if(a.releaseFrames)await ctx.step(a.releaseFrames);};
  ctx.menu=async goal=>{
   let unsupportedSince=null;
   for(let n=0;n<8000;n++){
    const o=ctx.observe(),e=o.playerMemory.encounter;
    if(e?.validity==='valid'&&protect(e.pokemon,ctx.mechanics))throw new FoundShiny(e.pokemon,ctx);
    const d=rngMenuIntent(o,{goal,world,area});
    if(d.kind==='ready')return o;
    if(d.kind==='blocked')throw new Error(d.reason);
    if(d.kind==='encounter'){
     const ui=o.playerMemory.ui.battle;
     const rec=ui?.stage==='action'?{kind:'choose-safari-command',targetIndex:3}:ui?.stage==='message'?{kind:'acknowledge-cartridge-prompt'}:null;
     await ctx.action(rec?mapRecommendation(rec,o):{holdFrames:8});
    }else if(d.kind==='navigate'||d.kind==='battle'){
     const decision=player.decide(o);if(['blocked','complete'].includes(decision.kind))throw new Error(decision.reason);
     // The trial is isolated: an unsupported route changes only when a moving NPC
     // clears it. Waiting out the whole menu budget held the owner still for minutes.
     if(d.kind==='navigate'&&decision.winner?.recommendation?.kind==='wait-for-supported-objective'){
      unsupportedSince??=o.frame;
      if(o.frame-unsupportedSince>1800)throw new Error(`RNG setup has no executable route to an encounter cell of ${area}`);
     }else unsupportedSince=null;
     await ctx.action(decision.action??{holdFrames:8});
    }else await ctx.action(d.kind==='wait'?{holdFrames:8}:mapRecommendation(d.recommendation,o));
   }
   throw new Error('RNG menu navigation exceeded its budget');
  };
  return ctx;
 }
 const snapshot=ctx=>({state:ctx.lab.session.saveState(),sram:ctx.lab.session.saveSram(),steps:structuredClone(ctx.steps)});
 const restore=(ctx,s)=>{ctx.lab.session.loadSram(s.sram);ctx.lab.session.loadState(s.state);ctx.lab.observer.resetHistory?.();ctx.steps=structuredClone(s.steps);};
 const report=(method,phase,extra={})=>onProgress({method,phase,...extra});
 function slotsFor(ctx){
  const o=ctx.observe(),data=ctx.world.data??ctx.world,mechanics=ctx.mechanics.data??ctx.mechanics;
  const table=data.wildEncounters.find(t=>t.map===area&&t.base_label.endsWith('_FireRed'))?.land_mons?.mons;
  if(!table)throw new Error('No game-specific land encounter table');
  const species=Object.values(mechanics.species),slots=table.map(x=>({species:species.find(s=>s.name===x.species)?.id,minLevel:x.min_level,maxLevel:x.max_level}));
  ctx.slots=slots;return slots;
 }
 async function search(ctx,minimum=0){
  const o=ctx.observe(),slots=slotsFor(ctx);
  let fallback=null;
  const start=advanceMainRng(o.playerMemory.rng.mainState,minimum);
  const result=await searchLandCandidates({state:start,otId:o.playerMemory.trainer.otId,slots,maxAdvances,signal,matches:(p,context)=>{
   if(p.species!==speciesId||(shinyRequired&&!p.shiny))return false;
   if(p.shiny)fallback??=context.advances;return evaluateRngTraits(p,request,ctx.mechanics).matched;
  }});
  if(result.status==='candidate')return {...result,advances:result.advances+minimum,traitsMatched:true};
  if(fallback!==null){
   const first=await searchLandCandidates({state:advanceMainRng(start,fallback),otId:o.playerMemory.trainer.otId,slots,maxAdvances:1,matches:p=>p.species===speciesId&&p.shiny});
   return {...first,advances:fallback+minimum,traitsMatched:false};
  }
  return null;
 }
 function add(method,ctx,target,waitFrames,extra={}){
  const entry={method,qualified:true,setupFrames:frames(ctx.steps),waitFrames,calibrationFrames:0,hitProbability:1,traitsMatched:target?.traitsMatched,...extra};
  candidates.push(entry);if(target)prepared.push({entry,target,snapshot:snapshot(ctx),ctx});return entry;
 }
 async function tryCandidate(ctx,target,method){
  const before=ctx.observe(),distance=mainRngDistance(before.playerMemory.rng.mainState,target.candidate.initialState,Math.min(1000000,maxAdvances+10000));
  if(distance===null)return null;
  const anchor=snapshot(ctx);
  for(const delay of [...new Set([...profile.delays,...profile.delays.map(n=>n-2),...profile.delays.map(n=>n+2)])]){
   const wait=(distance-delay)/profile.menuRate;
   if(!Number.isSafeInteger(wait)||wait<0)continue;
   restore(ctx,anchor);await ctx.step(wait);await ctx.step(1,['a']);
   for(let n=0;n<1200;n++){
    const o=ctx.observe(),e=o.playerMemory.encounter;
    if(e?.validity==='valid'){
     report(method,'observed',{predicted:target.candidate.pokemon.personality,observed:e.pokemon.personality,shiny:e.pokemon.shiny,delay,actualDelays:findLandDelays({state:advanceMainRng(before.playerMemory.rng.mainState,wait*profile.menuRate),otId:e.pokemon.otId,slots:ctx.slots,pokemon:e.pokemon})});
     if(protect(e.pokemon,ctx.mechanics))return {pokemon:e.pokemon,steps:structuredClone(ctx.steps),delay};
     break;
    }
    await ctx.step(1);
   }
  }
  return null;
 }
 try{
  active=await open();const original=active.observe();report('current-state','preparing');await active.menu('sweet-scent');
  if(!profile.delays?.length||!Number.isInteger(profile.menuRate)){
   report('automatic','calibrating');const anchor=snapshot(active),slots=slotsFor(active);
   const seed=active.observe().playerMemory.rng.mainState;await active.step(1);
   profile.menuRate=mainRngDistance(seed,active.observe().playerMemory.rng.mainState,1000);
   if(!(profile.menuRate>0))throw new Error('Sweet Scent menu RNG rate is not measurable');
   const delays=[];
   for(const wait of [0,1,10,50]){
    restore(active,anchor);await active.step(wait);const start=active.observe().playerMemory.rng.mainState;await active.step(1,['a']);
    for(let n=0;n<1200;n++){
     const o=active.observe(),e=o.playerMemory.encounter;
     if(e?.validity==='valid'){
      if(protect(e.pokemon,active.mechanics))throw new FoundShiny(e.pokemon,active);
      const found=findLandDelays({state:start,otId:e.pokemon.otId,slots,pokemon:e.pokemon});
      if(!found.length)throw new Error('This encounter does not match the supported land RNG method');
      delays.push(found[0]);break;
     }
     await active.step(1);
    }
   }
   if(delays.length!==4)throw new Error('Sweet Scent timing qualification did not finish');
   profile.delays=[...new Set(delays)];restore(active,anchor);
  }
  if(!profile.teachyRate&&active.observe().playerMemory.trainer.bag.keyItems.some(i=>i.itemId===366)){
   const anchor=snapshot(active);await active.menu('teachy-tv');await active.step(50);
   const seed=active.observe().playerMemory.rng.mainState;await active.step(1);
   profile.teachyRate=mainRngDistance(seed,active.observe().playerMemory.rng.mainState,1000);
   const exiting=active.observe().playerMemory.rng.mainState;await active.menu('sweet-scent');
   profile.teachyExitCalls=mainRngDistance(exiting,active.observe().playerMemory.rng.mainState,10000);
   if(!profile.teachyRate||profile.teachyExitCalls===null)throw new Error('Teachy TV timing qualification failed');
   restore(active,anchor);
  }
  const scent=snapshot(active),direct=await search(active,Math.max(...profile.delays));
  report('current-state','anchor',{frames:frames(active.steps),seed:active.observe().playerMemory.rng.mainState});
  if(direct)add('current-state',active,direct,Math.max(0,(direct.advances-Math.max(...profile.delays))/profile.menuRate)+400);
  if(profile.teachyRate>0&&active.observe().playerMemory.trainer.bag.keyItems.some(i=>i.itemId===366)){
   report('teachy-tv','measuring');await active.menu('teachy-tv');await active.step(50);
   const seed=active.observe().playerMemory.rng.mainState;await active.step(1);
   const rate=mainRngDistance(seed,active.observe().playerMemory.rng.mainState,1000);
   if(rate!==profile.teachyRate)throw new Error('Teachy TV rate changed; recalibration required');
   const reserve=Math.max(...profile.delays)+profile.teachyExitCalls+2*rate+128;
   const target=await search(active,reserve);
   report('teachy-tv','target',{seed:active.observe().playerMemory.rng.mainState,reserve,target:target?.advances,pid:target?.candidate.pokemon.personality});
   if(target){
    const coarse=Math.max(0,Math.floor((target.advances-reserve)/rate));
    await active.step(coarse);await active.menu('sweet-scent');
    const remaining=mainRngDistance(active.observe().playerMemory.rng.mainState,target.candidate.initialState,10000);
    report('teachy-tv','exit',{coarse,remaining,seed:active.observe().playerMemory.rng.mainState,frames:frames(active.steps)});
    if(remaining!==null)add('teachy-tv',active,target,Math.max(0,(remaining-Math.max(...profile.delays))/profile.menuRate)+400,{measuredRate:rate});
   }
  }
  // A title profile is tied to this ROM/core/save. New seeds are searched by
  // ordinary timed boot inputs, using the same Continue and navigation path.
  const bestBeforeTitles=rankRngMethods(candidates)[0]?.expectedFrames??Infinity;
  const titleOptions=[...(profile.titleSeeds??[]).map(p=>({...p,method:'title-seed'})),
   {titleFrames:2400,button:'a',method:'seed-search'},{titleFrames:2401,button:'a',method:'seed-search'}];
  for(const spec of titleOptions){
   const lowerBound=spec.titleFrames+210;
   if(lowerBound>=bestBeforeTitles){candidates.push({method:spec.method,qualified:false,reason:'Boot alone exceeds the fastest measured plan',lowerBoundFrames:lowerBound});continue;}
   const title=await open();
   try{
    report(spec.method,'booting',{titleFrames:spec.titleFrames});
    const boot=await runTitleTiming({session:title.lab.session,observer:title.lab.observer,titleFrames:spec.titleFrames,button:spec.button,nativeSaveVerified:true,signal});
    if(boot.mode!=='continue'){title.lab.session.close();continue;}
    title.steps=[{operation:'reset'},...boot.trace.flatMap(s=>Array.from({length:Math.ceil(s.frames/600)},(_,i)=>({frames:Math.min(600,s.frames-i*600),buttons:s.buttons})))];
    for(let n=0;n<6000;n++){
     const o=title.observe();if(o.emulator.mode==='overworld'&&o.phase==='stable'&&!o.playerMemory.questLog?.playback)break;
     if(o.playerMemory.ui.newGame)throw new Error('Native save did not offer Continue');
     await title.step(1,n%30===0?(o.playerMemory.questLog?.playback?['b']:o.emulator.mode==='boot'&&o.phase==='stable'?['a']:[]):[]);
    }
    if(!nativeSavePreservesPokemon(original,title.observe()))throw new Error('Title reset would lose or change an owned Pokémon; save in game first');
    await title.menu('sweet-scent');
    const target=await search(title,Math.max(...profile.delays));
    if(target){
     const entry=add(spec.method,title,target,Math.max(0,(target.advances-Math.max(...profile.delays))/profile.menuRate)+400,{titleFrames:spec.titleFrames,seed:boot.seed});
     // Prepared snapshots are owned by their trial until the winner is selected.
     entry.nativeSaveVerified=true;
    }else title.lab.session.close();
   }catch(error){title.lab.session.close();if(error instanceof FoundShiny)throw error;report(spec.method,'unavailable',{reason:error.message});}
  }
  const speciesProbability=landSpeciesProbability(active.slots,speciesId);
  if(speciesProbability>0)candidates.push({method:'random-encounters',qualified:true,setupFrames:frames(scent.steps),waitFrames:8192/speciesProbability*(profile.encounterFrames??600),calibrationFrames:0,hitProbability:1,reason:profile.encounterFrames?'Species odds from this game’s encounter table and measured encounter duration':'Species odds from this game’s encounter table; encounter duration is an estimate'});
  const ranked=rankRngMethods(candidates).sort((a,b)=>Number(a.traitsMatched!==true)-Number(b.traitsMatched!==true)||a.expectedFrames-b.expectedFrames);
  report(ranked[0]?.method,'selected',{candidates:ranked.map(c=>({method:c.method,expectedFrames:c.expectedFrames}))});
  let best=null;
  for(const choice of ranked){
   if(best?.traits?.matched&&choice.traitsMatched===false)continue;
   if(best&&(!choice.traitsMatched||best.traits.matched)&&choice.expectedFrames>=best.estimatedFrames)continue;
   const candidate=prepared.find(p=>p.entry===choice||p.entry.method===choice.method&&p.entry.setupFrames===choice.setupFrames&&p.entry.waitFrames===choice.waitFrames);
   if(!candidate)continue;
   restore(candidate.ctx,candidate.snapshot);report(choice.method,'qualifying');
   let result=await tryCandidate(candidate.ctx,candidate.target,choice.method);
   // A target can lie between reachable confirmation frames. Replan through the
   // accelerator instead of falling back to a long ordinary wait.
   for(let attempt=0;!result&&choice.method==='teachy-tv'&&attempt<4;attempt++){
    restore(candidate.ctx,candidate.snapshot);await candidate.ctx.menu('teachy-tv');await candidate.ctx.step(50);
    const reserve=Math.max(...profile.delays)+profile.teachyExitCalls+2*profile.teachyRate+128;
    const target=await search(candidate.ctx,reserve);if(!target)break;
    await candidate.ctx.step(Math.floor((target.advances-reserve)/profile.teachyRate));await candidate.ctx.menu('sweet-scent');
    candidate.snapshot=snapshot(candidate.ctx);candidate.target=target;
    result=await tryCandidate(candidate.ctx,target,choice.method);
   }
   if(!result)continue;
   choice.expectedFrames=frames(result.steps);choice.replayVerified=true;
   const plan={schema:'pokemon-suite/rng-input-plan/v1',game,area,speciesId,shinyRequired,method:choice.method,source,steps:result.steps,pokemon:result.pokemon,delay:result.delay,verified:true,nativeSaveVerified:result.steps.some(s=>s.operation==='reset'),candidates:ranked,timingProfile:profile,estimatedFrames:frames(result.steps),calculatedAt:new Date().toISOString()};
   plan.traits=evaluateRngTraits(plan.pokemon,request,active.mechanics);
   if(!best||(plan.traits.matched&&!best.traits.matched)||(plan.traits.matched===best.traits.matched&&plan.estimatedFrames<best.estimatedFrames))best=plan;
  }
  if(best){
   const plan=best;plan.traits=evaluateRngTraits(plan.pokemon,request,active.mechanics);plan.candidates.sort((a,b)=>a.expectedFrames-b.expectedFrames);
   const replay=await open();
   try{
    const repeated=await executeRngPlan({plan,source,observe:replay.observe,execute:async a=>replay.step(a.holdFrames,a.buttons),reset:async()=>replay.lab.session.reset(),signal});
    if(!['protected-shiny','protected-target'].includes(repeated.status)||!repeated.matched||encounterFingerprint(repeated.pokemon)!==encounterFingerprint(plan.pokemon))throw new Error('RNG input replay did not reproduce the protected Pokémon');
    plan.verifiedRepeats=2;return plan;
   }finally{replay.lab.session.close();}
  }
  throw new Error('No calculated shiny input plan passed cartridge replay');
 }catch(error){
  if(!(error instanceof FoundShiny))throw error;
  const plan={schema:'pokemon-suite/rng-input-plan/v1',game,area,speciesId,shinyRequired,method:error.pokemon.shiny?'incidental-shiny':'incidental-target',source,steps:error.steps,pokemon:error.pokemon,verified:true,nativeSaveVerified:error.steps.some(s=>s.operation==='reset'),candidates:rankRngMethods(candidates),estimatedFrames:frames(error.steps),calculatedAt:new Date().toISOString()};
  const replay=await open();
  try{
   const result=await executeRngPlan({plan,source,observe:replay.observe,execute:async a=>replay.step(a.holdFrames,a.buttons),reset:async()=>{replay.lab.session.reset();replay.lab.observer.resetHistory?.();},signal});
   if(!['protected-shiny','protected-target'].includes(result.status)||encounterFingerprint(result.pokemon)!==encounterFingerprint(plan.pokemon))throw new Error('Incidental encounter did not reproduce; owner checkpoint is preserved');
   plan.verifiedRepeats=2;return plan;
  }finally{replay.lab.session.close();}
 }finally{
  for(const ctx of new Set([active,...prepared.map(p=>p.ctx)]))ctx?.lab.session.close();
 }
}
