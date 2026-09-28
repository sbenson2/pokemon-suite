// Releasing the Egg sticker's own hatchlings (owner decision, Sept 27 2026).
// The Egg sticker needs 300 native hatches; its hatchlings filled the PC and the
// shiny reserve stopped postgame. Only non-shiny hatchlings that this owner's
// Egg-sticker breeding recorded, verified and saved are ever released, through
// the cartridge's own PC menu (controller input only).
import {encounterFingerprint as fingerprint} from '../player/encounter-tracker.js';
import {storageCapacity} from './storage-capacity.js';
import {GROWTH} from './qmm-supply.js';
import {NativeAcquisitionTask,acquisitionField} from './acquisition-task.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';

export const RELEASE_LABEL='Releasing Egg-sticker hatchlings to free PC space';

// One PC visit releases at most this many, then leaves the PC and saves: a
// crash or restart before the save loses at most one batch of releases, which
// the cartridge simply still holds and the next visit repeats.
export const RELEASE_BATCH=10;
// Release until the free space is the shiny reserve plus this buffer, so the
// Egg loop and other catches run between visits.
export const RELEASE_BUFFER=20;
// daycare.c: hatched Pokémon start at level 5 (EGG_HATCH_LEVEL) with
// friendship 120 (CreatedHatchedMon), met level 0 (AddHatchedMonToParty).
export const HATCH_LEVEL=5,HATCH_FRIENDSHIP=120;
// Cut, Fly, Surf, Strength, Flash, Rock Smash, Waterfall, Dive. The cartridge
// refuses to release its last Surf or Dive user, and HM users are field helpers.
const HM_MOVES=new Set([15,19,57,70,148,249,127,291]);
const EGG_STICKER=/^postgame-egg-sticker-/;

const dataOf=d=>d?.data??d??{};
const speciesRow=(species,mechanics)=>{const rows=dataOf(mechanics).species;return rows?.[species]?.id===species?rows[species]:Array.isArray(rows)?rows.find(r=>r?.id===species):null;};
const levelExperience=(species,level,mechanics)=>{const curve=GROWTH[speciesRow(species,mechanics)?.growthRate];return curve?curve(level):null;};
const slotKey=(box,slot)=>`${box}:${slot}`;

// Verified Egg-sticker hatch receipts by the hatchling's fingerprint. A receipt
// is provenance only when its save verified and it names the Pokémon it holds.
export function eggStickerHatchRecords(receipts=[]){
 const records=new Map();
 for(const r of Array.isArray(receipts)?receipts:[]){
  if(r?.method!=='breeding'||r.nativeSaveVerified!==true||!EGG_STICKER.test(r.requestId??'')||r.pokemon?.isEgg!==false&&r.pokemon?.isEgg!==undefined)continue;
  const id=fingerprint(r.pokemon);
  if(!id||id!==r.fingerprint)continue;
  records.set(id,r);
 }
 return records;
}

// Every {personality, otId} identity referenced by a value: Pokémon records,
// encounter fingerprints ([species,personality,otId,...ivs]), lineages
// ([personality,otId,...ivs]), [personality,otId] pairs (either order) and
// "personality:otId" keys, at any depth. Protection is by the individual, so a
// reserved Pokémon stays protected across an evolution.
const unsigned=v=>typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;
export function releaseIdentityKeys(values,keys=new Set()){
 const pair=(a,b)=>{a=unsigned(a);b=unsigned(b);if(Number.isSafeInteger(a)&&Number.isSafeInteger(b))keys.add(`${a>>>0}:${b>>>0}`);};
 const visit=(v,depth)=>{
  if(v==null||depth>16)return;
  if(v instanceof Set||v instanceof Map){for(const x of v.values())visit(x,depth+1);return;}
  if(typeof v==='string'){
   if(/^\d+:\d+$/.test(v)){const [a,b]=v.split(':');pair(a,b);return;}
   if(v.length>256||!v.startsWith('['))return;
   let a;try{a=JSON.parse(v);}catch{return;}
   if(!Array.isArray(a)||!a.every(Number.isSafeInteger))return;
   if(a.length===9)pair(a[1],a[2]);
   else if(a.length===8)pair(a[0],a[1]);
   else if(a.length===2){pair(a[0],a[1]);pair(a[1],a[0]);}
   return;
  }
  if(Array.isArray(v)){for(const x of v)visit(x,depth+1);return;}
  if(typeof v==='object'){
   if(v.personality!=null&&v.otId!=null)pair(v.personality,v.otId);
   for(const [k,x] of Object.entries(v)){if(/^\d+:\d+$/.test(k))visit(k,depth+1);visit(x,depth+1);}
  }
 };
 visit(values,0);
 return keys;
}
const identityKey=p=>`${p.personality>>>0}:${p.otId>>>0}`;

function context({trainer,receipts,mechanics,protectedFingerprints=[],protectedIdentities=[],protectedSlots=[],protectedSpecies=[]}){
 const records=eggStickerHatchRecords(receipts);
 return {trainer,mechanics,records,species:new Set([...records.values()].map(r=>r.pokemon.species)),
  protectedKeys:releaseIdentityKeys([protectedFingerprints,protectedIdentities]),reserved:new Set(protectedSlots.map(s=>slotKey(s.box,s.slot))),
  teamSpecies:new Set([...protectedSpecies].map(Number)),
  party:new Set((trainer?.party??[]).map(fingerprint).filter(Boolean))};
}

// Why this individual must not be released, or null. Species survival is judged
// by selectReleasableHatchlings over the whole party and PC.
function refusal(p,c){
 const t=c.trainer;
 if(p?.validity!=='valid')return 'unverified';
 const id=fingerprint(p);
 if(c.party.has(id)||!Number.isInteger(p.box)||!Number.isInteger(p.slot))return 'in-party';
 if(p.isEgg!==false)return 'egg';
 if(p.shiny!==false)return 'shiny';
 if(!Number.isSafeInteger(t?.otId)||p.otId!==t.otId)return 'other-trainer';
 const level5=levelExperience(p.species,HATCH_LEVEL,c.mechanics);
 if(Number.isInteger(p.metLevel)?p.metLevel!==0:false)return 'not-hatched';
 if(!Number.isInteger(level5)||p.experience!==level5||Object.values(p.evs??{}).some(v=>v!==0))return 'trained';
 if(!(p.friendship>=HATCH_FRIENDSHIP))return 'not-hatch-friendship';
 if(p.heldItem!==0)return 'holds-item';
 if((p.moves??[]).some(m=>HM_MOVES.has(m)))return 'knows-hm';
 if(p.pokerus!==0)return 'pokerus';
 if(!c.species.has(p.species))return 'not-bred-species';
 if(!c.records.has(id))return 'no-egg-sticker-receipt';
 if(c.protectedKeys.has(identityKey(p)))return 'protected';
 if(c.reserved.has(slotKey(p.box,p.slot)))return 'reserved-slot';
 if(c.teamSpecies.has(p.species))return 'team-species';
 return null;
}

export function releaseRefusal(pokemon,options){return refusal(pokemon,context(options));}

// Releasable hatchlings in box order; never the last of a species across the
// party and PC. Unverified party or storage evidence selects nothing.
export function selectReleasableHatchlings({trainer,receipts=[],mechanics,protectedFingerprints=[],protectedIdentities=[],protectedSlots=[],protectedSpecies=[],limit=Infinity}){
 const c=context({trainer,receipts,mechanics,protectedFingerprints,protectedIdentities,protectedSlots,protectedSpecies});
 const party=trainer?.party,stored=trainer?.storage?.pokemon;
 const known=trainer?.partyValidity==='valid'&&trainer?.storage?.validity==='valid'&&Array.isArray(party)&&Array.isArray(stored)&&Number.isSafeInteger(trainer.otId)&&
  [...party,...stored].every(p=>p?.validity==='valid');
 if(!known)return {candidates:[],species:[...c.species],refusals:{}};
 const ids=[...party,...stored].map(fingerprint);
 const alive=new Map();
 for(const p of [...party,...stored])if(!p.isEgg)alive.set(p.species,(alive.get(p.species)??0)+1);
 const candidates=[],refusals={};
 for(const p of [...stored].sort((a,b)=>a.box-b.box||a.slot-b.slot)){
  const id=fingerprint(p);
  if(!c.records.has(id)&&!c.species.has(p.species))continue;
  const reason=ids.filter(x=>x===id).length>1?'duplicate-identity':refusal(p,c)??(alive.get(p.species)<=1?'last-of-species':null);
  if(reason){refusals[id]=reason;continue;}
  if(candidates.length>=limit)continue;
  candidates.push(p);alive.set(p.species,alive.get(p.species)-1);
 }
 return {candidates,species:[...c.species],refusals};
}

// Releases needed for the free space to reach the reserve plus the buffer.
export function releaseDemand(trainer,{buffer=RELEASE_BUFFER}={}){
 const space=storageCapacity(trainer);
 return space.known?Math.max(0,space.reserveSlots+buffer-space.free):0;
}

// The identities a release plan carries: the fingerprint and the fields the
// advisor re-checks at the cursor. Boxes are visited from the open box onward.
export function planHatchlingRelease({trainer,receipts,mechanics,protectedFingerprints=[],protectedIdentities=[],protectedSlots=[],protectedSpecies=[],count=RELEASE_BATCH}){
 const {candidates}=selectReleasableHatchlings({trainer,receipts,mechanics,protectedFingerprints,protectedIdentities,protectedSlots,protectedSpecies});
 const open=Number.isInteger(trainer?.storage?.currentBox)?trainer.storage.currentBox:0;
 return [...candidates].sort((a,b)=>(a.box-open+14)%14-(b.box-open+14)%14||a.slot-b.slot).slice(0,Math.max(0,count))
  .map(p=>({fingerprint:fingerprint(p),box:p.box,slot:p.slot,species:p.species,personality:p.personality,otId:p.otId,experience:p.experience,friendship:p.friendship,metLevel:p.metLevel??null}));
}

const PLAN_FIELDS=['box','slot','species','personality','otId','experience','friendship'];
const planMatches=(p,e)=>PLAN_FIELDS.every(k=>p[k]===e[k])&&(e.metLevel==null||p.metLevel===e.metLevel)&&fingerprint(p)===e.fingerprint;
// Where every Pokémon is: the evidence that a release changed nothing else.
const layout=t=>[...t.party.map(p=>`${fingerprint(p)}@party:${p.slot}`),...t.storage.pokemon.map(p=>`${fingerprint(p)}@${p.box}:${p.slot}`)].sort();

// One PC visit: release the planned hatchlings one at a time through the
// cartridge menu, verify each from the next stable observation, leave the PC
// and make a verified native save. Controller input only.
export class PcReleaseTask extends NativeAcquisitionTask{
 constructor({requestId,plan,world,mechanics,planner,state=null}){
  super();this.world=world;this.mechanics=mechanics;this.planner=planner;
  if(state){
   if(state.kind!=='pc-release'||state.requestId!==requestId)throw Error('The PC release checkpoint belongs to another task.');
   this.state=structuredClone(state);return;
  }
  if(!requestId||!Array.isArray(plan)||!plan.length||plan.length>RELEASE_BATCH||new Set(plan.map(e=>e?.fingerprint)).size!==plan.length||
   plan.some(e=>!e?.fingerprint||!Number.isInteger(e.box)||!Number.isInteger(e.slot)))throw Error('A PC release needs a bounded plan of distinct, located hatchlings.');
  this.state={schema:'pokemon-suite/native-acquisition/v1',kind:'pc-release',requestId,plan:structuredClone(plan),released:[],refused:[],phase:'releasing'};
 }
 refuse(entry,reason){this.state.refused.push({...entry,reason});}
 inspect(o,{release={}}={}){
  const s=this.state,m=o.playerMemory??{},t=m.trainer??{},stage=m.ui?.storage?.stage;
  if(s.receipt)return {kind:'complete',receipt:s.receipt};
  if(o.emulator?.inBattle||o.phase!=='stable')return {kind:'wait'};
  const free=acquisitionField(o);
  if(t.partyValidity!=='valid'||t.storage?.validity!=='valid'||!Array.isArray(t.party)||!Array.isArray(t.storage?.pokemon)||[...t.party,...t.storage.pokemon].some(p=>p?.validity!=='valid'))
   return free?this.stop('PC release: the party and PC must verify before releasing hatchlings.'):{kind:'wait'};
  const now=layout(t);
  s.baseline??=now;s.freeBefore??=storageCapacity(t).free;
  const present=id=>t.storage.pokemon.find(p=>fingerprint(p)===id)??null;
  if(s.pending){
   const pending=s.pending;
   if(!present(pending.fingerprint)){
    const expected=pending.layout.filter(x=>x!==pending.entry);
    if(JSON.stringify(expected)!==JSON.stringify(now)||t.party.some(p=>fingerprint(p)===pending.fingerprint))
     return this.stop('PC release: the PC changed beyond the released hatchling. Keep this save for review.');
    s.released.push({...pending.target,releasedFrame:o.frame});s.dirty=true;s.pending=null;
   }else if(stage==='release-refused'){this.refuse(pending.target,'cartridge-refused');s.pending=null;}
  }
  const done=new Set([...s.released,...s.refused].map(e=>e.fingerprint));
  for(const entry of s.plan){
   if(done.has(entry.fingerprint))continue;
   if(s.pending&&s.pending.fingerprint!==entry.fingerprint)return this.stop('PC release: the pending hatchling is no longer the next planned release.');
   const p=present(entry.fingerprint);
   if(!p)return this.stop('PC release: a planned hatchling left the PC before its release.');
   const alive=[...t.party,...t.storage.pokemon].filter(q=>!q.isEgg&&q.species===p.species).length;
   const reason=!planMatches(p,entry)?'plan-mismatch':releaseRefusal(p,{trainer:t,mechanics:this.mechanics,...release})??(alive<2?'last-of-species':null);
   if(reason){this.refuse(entry,reason);done.add(entry.fingerprint);continue;}
   s.center??=/_POKEMON_CENTER_1F$/.test(m.map?.id??'')?m.map.id:fireRedPokemonCenter(m.map?.id);
   s.pending={fingerprint:entry.fingerprint,target:entry,entry:`${entry.fingerprint}@${entry.box}:${entry.slot}`,layout:now};
   return this.policy(`release-${s.released.length+s.refused.length+1}`,{kind:'party-roster',map:s.center,release:entry},{label:RELEASE_LABEL});
  }
  if(!s.released.length)return this.stop(`PC release: no planned hatchling could be released (${s.refused.map(e=>e.reason).join(', ')}).`);
  const expected=s.baseline.filter(x=>!s.released.some(e=>x.startsWith(e.fingerprint+'@')));
  if(JSON.stringify(expected)!==JSON.stringify(now))return this.stop('PC release: the party or PC differs from the verified releases. Keep this save for review.');
  s.phase='saving';
  if(!free&&!s.saving)return this.drain(o);
  s.saving=true;
  if(!s.save){
   if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return this.stop('PC release: the save baseline is unavailable.');
   s.save={counter:m.gameStats.savedGame,sha256:o.sram.sha256,frame:o.frame};
  }
  const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===s.save.counter+1&&o.sram?.sha256!==s.save.sha256;
  if(!verified||!free)return this.policy('save',{kind:'save-game',map:m.map.id,saveVerified:verified},{label:RELEASE_LABEL});
  s.receipt={requestId:s.requestId,method:'pc-release',released:structuredClone(s.released),refused:structuredClone(s.refused),
   freeBefore:s.freeBefore,freeAfter:storageCapacity(t).free,nativeSaveVerified:true,savedFrame:o.frame,savedSramSha256:o.sram.sha256};
  s.phase='complete';s.dirty=false;return {kind:'complete',receipt:s.receipt};
 }
}
