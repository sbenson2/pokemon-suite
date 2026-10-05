import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {nationalDexProgress} from './postgame-progress.js';
import {storageCapacity} from './storage-capacity.js';
import evolutionRules from './fire-red-evolution-rules.json' with {type:'json'};
import fireRedCatchable from './firered-catchable.json' with {type:'json'};
import {campaignTargetReachable} from '../player/campaign.js';
import {fireRedIsland,fireRedFerryArrival} from './fire-red-link-quest.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {FIRE_RED_NPC_TRADES} from './native-npc-trade.js';

// FireRed's three rods (pokefirered src/wild_encounter.c ChooseWildMonIndex_Fishing:
// fishing_mons slots 0-1 Old Rod, 2-4 Good Rod, 5-9 Super Rod) and their givers
// (data/maps/VermilionCity_House1, FuchsiaCity_House2, Route12_FishingHouse;
// include/constants/flags.h FLAG_GOT_OLD_ROD 0x240, FLAG_GOT_GOOD_ROD 0x244,
// FLAG_GOT_SUPER_ROD 0x255).
export const FIRE_RED_RODS=Object.freeze([
 Object.freeze({itemId:262,name:'Old Rod',start:0,end:2,shares:Object.freeze([70,30]),flagId:576,map:'MAP_VERMILION_CITY_HOUSE1',script:'VermilionCity_House1_EventScript_FishingGuru'}),
 Object.freeze({itemId:263,name:'Good Rod',start:2,end:5,shares:Object.freeze([60,20,20]),flagId:580,map:'MAP_FUCHSIA_CITY_HOUSE2',script:'FuchsiaCity_House2_EventScript_FishingGurusBrother'}),
 Object.freeze({itemId:264,name:'Super Rod',start:5,end:10,shares:Object.freeze([40,40,15,4,1]),flagId:597,map:'MAP_ROUTE12_FISHING_HOUSE',script:'Route12_FishingHouse_EventScript_FishingGuruBrother'}),
]);
export const ROD_FLAGS=FIRE_RED_RODS.map(r=>r.flagId);
const bagCount=(o,id)=>Object.values(o?.playerMemory?.trainer?.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?Number(i.quantity)||0:0),0);
// 'owned', 'obtainable' (its gift flag is still clear) or null.
export function rodAvailability(o,rod){
 if(bagCount(o,rod.itemId)>0)return 'owned';
 return o?.playerMemory?.storyState?.flagIds?.[rod.flagId]===false?'obtainable':null;
}
// Lost Cave item balls (data/maps/FiveIsland_LostCave_Room11/map.json and
// Room12/map.json; FLAG_HIDE_..._LAX_INCENSE 0x1F9, ..._SEA_INCENSE 0x1FA).
export const FIRE_RED_INCENSE=Object.freeze({360:Object.freeze({itemId:221,name:'Lax Incense',flagId:505,place:'Five Island Lost Cave'}),298:Object.freeze({itemId:220,name:'Sea Incense',flagId:506,place:'Five Island Lost Cave'})});
export const COLLECTION_ITEM_FLAGS=[480,483,486,487,503,505,506];
const incenseAvailable=(o,incense)=>bagCount(o,incense.itemId)>0||o?.playerMemory?.storyState?.flagIds?.[incense.flagId]===false;
// Held evolution items the cartridge places as one-time item balls (the
// FLAG_HIDE_* flags in include/constants/flags.h).
const ITEM_BALL_FLAGS={187:[0x1E7],199:[0x1E0],201:[0x1E3],218:[0x1F7]};
const itemSources=item=>ITEM_BALL_FLAGS[item]??[];

// Altering Cave has nine FireRed tables in cartridge order, and the game uses
// only the one VAR_ALTERING_CAVE_WILD_SET selects (src/wild_encounter.c
// GetCurrentMapWildMonHeaderId). 0, unset, or out of range means table 1.
// Only the Mystery Event script changes it (data/mystery_event_msg.s:327).
export const ALTERING_CAVE_WILD_SET=0x4024;
const alteringCaveTable=table=>{
 const match=table.map==='MAP_SIX_ISLAND_ALTERING_CAVE'&&/AlteringCave(?:_(\d+))?_FireRed$/.exec(table.base_label);
 return match?Number(match[1]??1)-1:null;
};
const activeAlteringCaveTable=variables=>{const value=Number(variables?.[ALTERING_CAVE_WILD_SET]);return Number.isInteger(value)&&value>=0&&value<9?value:0;};
const inactiveAlteringCaveTable=(table,variables)=>{const index=alteringCaveTable(table);return index!==null&&index!==activeAlteringCaveTable(variables);};

const sourceCache=new WeakMap();
function cartridgeSources(world,mechanics){
 if(sourceCache.has(world))return sourceCache.get(world);
 const species=new Map((mechanics.data??mechanics).species.map(s=>[s.name,nationalSpeciesId(s.id)])),sources=new Map();
 const add=(id,source)=>{if(!id)return;const list=sources.get(id)??[];if(!list.some(r=>r.map===source.map&&r.method===source.method&&r.rodItemId===source.rodItemId&&r.alteringCaveTable===source.alteringCaveTable))list.push(source);sources.set(id,list);};
 for(const table of (world.data??world).wildEncounters??[]){
  if(!table.base_label?.endsWith('_FireRed'))continue;
  const cave=alteringCaveTable(table);
  for(const [key,method] of [['land_mons',table.map.startsWith('MAP_SAFARI_ZONE_')?'safari-land':'wild-land'],['water_mons','surf'],['rock_smash_mons','rock-smash']])
   for(const slot of table[key]?.mons??[])add(species.get(slot.species),{map:table.map,method,...(cave!==null?{alteringCaveTable:cave}:{})});
  const fishing=table.fishing_mons?.mons??[];
  for(const rod of FIRE_RED_RODS)for(const slot of fishing.slice(rod.start,rod.end))add(species.get(slot.species),{map:table.map,method:'fishing',rodItemId:rod.itemId});
 }
 sourceCache.set(world,sources);return sources;
}

const rules=evolutionRules.rules;
const ruleTo=id=>rules.find(r=>r.speciesId===id);
// The earlier forms an evolution can come from, nearest first.
function preChain(id){const chain=[];let r=ruleTo(id);while(r&&chain.length<4){chain.push(r.fromSpecies);r=ruleTo(r.fromSpecies);}return chain;}
// Every species of a family (its base form and all evolutions).
function familyOf(id){
 let base=id;for(let i=0;i<4;i++){const r=ruleTo(base);if(!r)break;base=r.fromSpecies;}
 const family=new Set([base]);for(let grew=true;grew;){grew=false;for(const r of rules)if(family.has(r.fromSpecies)&&!family.has(r.speciesId)){family.add(r.speciesId);grew=true;}}
 return {base,family};
}
const factsCache=new WeakMap();
const speciesFacts=(mechanics,nationalId)=>{
 const data=mechanics.data??mechanics;let index=factsCache.get(data);
 if(!index){index=new Map(data.species.map(s=>[nationalSpeciesId(s.id),s]));factsCache.set(data,index);}
 return index.get(nationalId);
};
function genderOf(p,f){
 const ratio=f?.genderRatio;
 if(ratio==='MON_GENDERLESS')return null;if(ratio==='MON_FEMALE')return 'female';if(ratio==='MON_MALE')return 'male';
 return ratio?.call==='PERCENT_FEMALE'?(p.personality&255)<Math.floor(255*ratio.args[0]/100)?'female':'male':null;
}
// A Day Care partner for `parent` whose Egg is `parent`'s own family base
// (pokefirered src/daycare.c DetermineEggSpeciesAndParentSlots: the Egg is the
// mother's base form; Ditto is the mother of a male or genderless partner).
export function eggPartner(parent,candidates,mechanics){
 const fp=speciesFacts(mechanics,nationalSpeciesId(parent.species)),groups=fp?.eggGroups??[];
 if(!groups.length||groups.includes('EGG_GROUP_UNDISCOVERED')||groups.includes('EGG_GROUP_DITTO'))return null;
 const ditto=candidates.find(q=>q.species===132);if(ditto)return ditto;
 if(genderOf(parent,fp)!=='female')return null;
 return candidates.find(q=>{const fq=speciesFacts(mechanics,nationalSpeciesId(q.species));
  return genderOf(q,fq)==='male'&&(fq?.eggGroups??[]).some(g=>groups.includes(g))&&!fq.eggGroups.includes('EGG_GROUP_UNDISCOVERED');})??null;
}

const STARTERS=[1,4,7],ROAMERS=[243,244,245];
const STATIC_FLAGS={150:700,146:701,144:702,145:703};
// The owner's goal for FireRed: every species a FireRed player can register
// without another game or an event (scripts/derive-firered-catchable.py from
// pret/pokefirered; pinned by test/firered-catchable.test.js).
export const FIRERED_CATCHABLE=Object.freeze(fireRedCatchable.species.map(x=>x.id));
const GOAL=new Set(FIRERED_CATCHABLE);
const ONE_PER_SAVE=new Map(fireRedCatchable.species.filter(x=>x.onePerSave).map(x=>[x.id,x.onePerSave]));
// Missing FireRed species a single save cannot reach alone. Each needs a
// feature planned for a later build: another FireRed save played by the bot
// (the other starters, the Dome Fossil, the other roaming beasts), or borrowing
// a Hitmon from the FireRed partner to breed Tyrogue.
const PLANNED_TEXT={'another-firered-save':'needs another FireRed save (planned)','partner-borrow':'needs a Pokémon borrowed from the FireRed partner (planned)'};
const CATEGORY_TEXT={'other-games':'other games or events',...PLANNED_TEXT};
export function nationalDexSources({o,world,mechanics}){
 const m=o.playerMemory??{},t=m.trainer??{},flags=m.storyState?.flagIds??{},variables=m.storyState?.variableIds??{},dex=nationalDexProgress(t.pokedex?.ownedSpecies);
 const missing=new Set(dex.missing),sources=cartridgeSources(world,mechanics);
 const names=new Map((mechanics.data??mechanics).species.map(s=>[nationalSpeciesId(s.id),s.name.replace('SPECIES_','').toLowerCase()]));
 const label=id=>{const n=names.get(id)??`#${id}`;return n.charAt(0).toUpperCase()+n.slice(1).replaceAll('_',' ');};
 const verified=t.partyValidity==='valid'&&t.storage?.validity==='valid';
 const individuals=verified?[...(t.party??[]),...(t.storage?.pokemon??[])].filter(p=>p.validity==='valid'&&!p.isEgg):[];
 const partners=individuals.filter(p=>p.shiny===false);
 const national=p=>nationalSpeciesId(p.species);
 const partnerFor=parent=>eggPartner(parent,partners.filter(q=>encounterFingerprint(q)!==encounterFingerprint(parent)),mechanics);
 // Plain individuals evolve directly; a family member owned only as a shiny is
 // bred into a plain copy first (native-breeding.js selectBreedToEvolve).
 const breedable=family=>individuals.filter(p=>family.has(national(p))).find(p=>partnerFor(p))??null;
 const rows=new Map();
 const rowOf=speciesId=>{
  if(rows.has(speciesId))return rows.get(speciesId);
  rows.set(speciesId,{speciesId,name:names.get(speciesId)??`#${speciesId}`,method:'partner-source',status:'external',category:'another-game',reason:'Unresolved dependency.'});
  const row=computeRow(speciesId);rows.set(speciesId,row);return row;
 };
 const computeRow=speciesId=>{
  const name=names.get(speciesId)??`#${speciesId}`;
  const row=(method,status,reason,extra={})=>({speciesId,name,method,status,reason,...extra});
  const external=(method,category,reason,extra={})=>row(method,'external',reason,{category,...extra});
  if(dex.known&&!missing.has(speciesId))return row('owned','complete','Registered as caught in this save.');
  const wild=sources.get(speciesId)??[];
  const active=wild.filter(s=>!(s.alteringCaveTable!=null&&s.alteringCaveTable!==activeAlteringCaveTable(variables))&&
   !(s.method==='fishing'&&!rodAvailability(o,FIRE_RED_RODS.find(r=>r.itemId===s.rodItemId))));
  if(active.length){
   const land=active.filter(s=>s.method!=='fishing');
   if(land.length)return row(land[0].method,'local','Acquire from this cartridge’s native encounter table.',{locations:active.map(({map,method,rodItemId})=>({map,method,...(rodItemId?{rodItemId}:{})}))});
   const rods=[...new Set(active.map(s=>s.rodItemId))].map(id=>FIRE_RED_RODS.find(r=>r.itemId===id));
   const missingRod=rods.find(r=>rodAvailability(o,r)==='obtainable'&&!rods.some(x=>rodAvailability(o,x)==='owned'));
   return row('fishing','local',`Fish with the ${rods.map(r=>r.name).join(' or ')} on this cartridge’s native tables.${missingRod?` The ${missingRod.name} is a gift from ${missingRod.map==='MAP_FUCHSIA_CITY_HOUSE2'?'the Fuchsia City fishing guru’s brother':missingRod.map==='MAP_VERMILION_CITY_HOUSE1'?'the Vermilion City fishing guru':'the Route 12 fishing house'}.`:''}`,
    {locations:active.map(({map,rodItemId})=>({map,method:'fishing',rodItemId}))});
  }
  if(wild.length&&wild.every(s=>s.alteringCaveTable!=null))
   return external('event-source','event','Appears only in an Altering Cave table that a Mystery Gift event selects (VAR_ALTERING_CAVE_WILD_SET); this save’s cave has its default table.');
  // A FireRed in-game trade this save has not used (src/data/ingame_trades.h).
  const npc=FIRE_RED_NPC_TRADES.find(t=>t.received===speciesId&&flags[t.flagId]===false);
  if(npc)return row('npc-trade','local',`Trade a ${label(npc.requested)} for it in the FireRed in-game trade (${npc.map.replace('MAP_','').replaceAll('_',' ').toLowerCase()}); catch a spare ${label(npc.requested)} first if needed.`,{trade:npc.key,requested:npc.requested});
  if([151,251,385].includes(speciesId))return external('event-source','event','Requires a legitimately acquired Pokémon from an official event distribution.');
  if([249,250,386].includes(speciesId))return external('event-source','event','Requires the official event ticket and encounter, or a compatible trade.');
  const rule=ruleTo(speciesId);
  if(rule){
   const requirements={fromSpecies:rule.fromSpecies,requirements:rule};
   if(rule.trigger==='trade'){
    // A FireRed-to-FireRed trade round trip with the FireRed partner game: the
    // evolution happens in FireRed. Its held item must be one this save holds
    // or can still collect.
    const item=rule.heldItem?.nativeId,itemOk=!item||bagCount(o,item)>0||individuals.some(p=>p.heldItem===item)||itemSources(item).some(f=>flags[f]===false);
    const pre=rowOf(rule.fromSpecies),source=individuals.some(p=>p.shiny===false&&national(p)===rule.fromSpecies)||pre.status==='local'||
     pre.status==='complete'&&(sources.get(rule.fromSpecies)??[]).length>0;
    if(GOAL.has(speciesId)&&itemOk&&source)return row('trade-evolution','local',`Trade ${label(rule.fromSpecies)}${item?` holding the ${rule.heldItem.name}`:''} to the FireRed partner game and back; it evolves in FireRed.`,{...requirements,category:'firered-partner'});
    return external('trade-evolution','partner','Reserve the original individual, trade with a compatible independent save, verify evolution, and trade it back.',requirements);
   }
   if(rule.evolutionGame||rule.beauty)return external('partner-evolution','another-game','Evolve in a compatible partner game and return the same individual.',requirements);
   const pre=rowOf(rule.fromSpecies),chain=new Set([rule.fromSpecies,...preChain(rule.fromSpecies)]);
   if(individuals.some(p=>p.shiny===false&&chain.has(national(p))&&p.heldItem!==195))return row('evolution','local','Evolve an owned earlier form natively.',requirements);
   const {family}=familyOf(speciesId),parent=breedable(family);
   if(parent&&parent.shiny!==false)return row('evolution','local',`This save’s only ${label(national(parent))} is shiny, and shinies are never evolved: breed a plain copy at the Four Island Day Care, then evolve it.`,requirements);
   if(parent)return row('evolution','local',`Breed a plain ${label(familyOf(speciesId).base)} at the Four Island Day Care, then evolve it.`,requirements);
   if(pre.status==='complete')return external('evolution','partner',`${label(rule.fromSpecies)} is registered, but no individual of its family remains in this save to evolve or breed.`,requirements);
   if(pre.status==='external')return external('evolution',pre.category,`Needs ${label(rule.fromSpecies)} first: ${pre.reason}`,requirements);
   return row('evolution',pre.status,pre.status==='local'?`Acquire ${label(rule.fromSpecies)} first, then evolve it natively.`:`Needs ${label(rule.fromSpecies)} first: ${pre.reason}`,requirements);
  }
  if(speciesId===138||speciesId===140){
   // Mt. Moon gives one of the two fossils (data/maps/MtMoon_B2F/scripts.inc);
   // FLAG_GOT_DOME_FOSSIL 0x272, FLAG_GOT_HELIX_FOSSIL 0x273, FLAG_REVIVED_DOME/HELIX 0x2EC/0x2ED.
   const [got,revived,fossil,other]=speciesId===140?[626,748,'Dome Fossil','Helix Fossil']:[627,749,'Helix Fossil','Dome Fossil'];
   if(flags[got]===true&&flags[revived]===false)return row('gift','local','Revive this save’s fossil at the Cinnabar Pokémon Lab.');
   if(flags[got]===false&&typeof flags[got===626?627:626]==='boolean'&&flags[got===626?627:626])return external('gift','partner',`This save took the ${other} at Mt. Moon, so it has no ${fossil}; only one of the two can be taken.`);
  }
  const giftFlags={131:582,133:611,142:750,175:730};
  if(Object.hasOwn(giftFlags,speciesId)&&flags[giftFlags[speciesId]]===false)return row('gift','local','A native gift or fossil revival remains; verify its prerequisites.');
  if(Object.hasOwn(STATIC_FLAGS,speciesId)||speciesId===143){
   const unused=speciesId===143?flags[84]===false||flags[128]===false:flags[STATIC_FLAGS[speciesId]]===false;
   if(unused)return row('static-or-roamer','local','This save’s one-time encounter remains.');
   return external('static-or-roamer','partner','This save’s one-time encounter is used; another save must trade one.');
  }
  if(ROAMERS.includes(speciesId)){
   const roamer=m.postgameEvidence?.roamer;
   if(roamer?.active&&nationalSpeciesId(roamer.species)===speciesId)return row('static-or-roamer','local','This save’s roaming encounter remains.');
   if(ROAMERS.some(id=>!missing.has(id))||roamer&&!roamer.active)return external('static-or-roamer','partner','Each save roams one of the three beasts, chosen by its starter; another save must trade this one.');
   return row('static-or-roamer','dependency','Verify this save’s roaming encounter.');
  }
  const childOf=rules.filter(r=>r.fromSpecies===speciesId).map(r=>r.speciesId);
  if(childOf.length){
   const {family}=familyOf(speciesId),incense=FIRE_RED_INCENSE[speciesId];
   // No parent held yet, but this save can get one (an in-game trade Jynx for Smoochum).
   const obtainable=!breedable(family)&&childOf.map(rowOf).find(r=>r.status==='local'&&r.method!=='evolution');
   if(obtainable&&!incense)return row('breeding','local',`Get ${label(obtainable.speciesId)} first (${obtainable.method==='npc-trade'?'in-game trade':obtainable.method}), then breed it with Ditto at the Four Island Day Care.`,{family:childOf});
   // Wynaut and Azurill hatch only while a parent holds the incense
   // (pokefirered src/daycare.c AlterEggSpeciesWithIncenseItem).
   const parent=breedable(family);
   if(parent&&(!incense||incenseAvailable(o,incense)))
    return row('breeding','local',`Breed ${parent.shiny?'this save’s shiny ':''}${label(national(parent))} at the Four Island Day Care${incense?` while a parent holds the ${incense.name} (${bagCount(o,incense.itemId)?'in the Bag':incense.place})`:''}.`,{family:childOf});
   if(parent&&incense)return external('breeding','partner',`Needs the ${incense.name}, which this save no longer has.`,{family:childOf});
   if(childOf.some(id=>!missing.has(id)))return external('breeding','partner',`${childOf.filter(id=>!missing.has(id)).map(label).join(', ')} is registered, but no individual remains in this save to breed.`,{family:childOf});
  }
  if(STARTERS.includes(speciesId))return external('partner-source','partner','Another FireRed or LeafGreen save chooses this starter; trade one in.');
  return external('partner-source','another-game','Not in FireRed: requires LeafGreen, Ruby, Sapphire, Emerald or another Generation III source, or a compatible trade.');
 };
 return Array.from({length:386},(_,i)=>goalRow(rowOf(i+1)));
}
// The same row, placed in the owner's FireRed goal: outside it are other games
// and events; inside it, what one save cannot reach alone is planned work.
function goalRow(row){
 const goal=GOAL.has(row.speciesId),out={...row,goal};
 if(row.status!=='external')return out;
 if(!goal)return {...out,category:'other-games',origin:row.category==='event'?'event':'another-game'};
 const family=[row.speciesId,...preChain(row.speciesId)];
 const onePerSave=family.find(id=>ONE_PER_SAVE.has(id)&&!['dojo'].every(k=>ONE_PER_SAVE.get(id).includes(k)));
 if(onePerSave)return {...out,category:'another-firered-save',planned:true,reason:`${row.reason} Each save gets one ${ONE_PER_SAVE.get(onePerSave)[0]} choice; this one ${PLANNED_TEXT['another-firered-save']}.`};
 if(family.some(id=>[106,107,236,237].includes(id)))return {...out,category:'partner-borrow',planned:true,reason:`${row.reason} It ${PLANNED_TEXT['partner-borrow']}.`};
 // A one-time source this save has spent (for example a used incense).
 return {...out,category:'spent-here'};
}

export function nationalCollectionSummary(rows){
 const count=(status,list=rows)=>list.filter(r=>r.status===status).length;
 const categories={'other-games':0,'another-firered-save':0,'partner-borrow':0,'spent-here':0};
 for(const r of rows)if(r.status==='external')categories[r.category]=(categories[r.category]??0)+1;
 const goal=rows.filter(r=>r.goal);
 return {total:rows.length,owned:count('complete'),local:count('local'),dependency:count('dependency'),external:count('external'),categories,
  fireRed:{total:goal.length,owned:count('complete',goal),reachable:count('local',goal)+count('dependency',goal),planned:goal.filter(r=>r.planned).length,
   partner:goal.filter(r=>r.status==='local'&&r.category==='firered-partner').length,
   complete:goal.every(r=>r.status==='complete'||r.planned)},
  localSpecies:rows.filter(r=>r.status==='local').map(r=>r.speciesId),plannedSpecies:goal.filter(r=>r.planned).map(r=>r.speciesId)};
}
// "X of N catchable in FireRed" (the owner's goal).
export const fireRedCatchableText=summary=>`${summary.fireRed.owned} of ${summary.fireRed.total} catchable in FireRed`;
// The plain statement for a save that has nothing left it can do alone.
// With the FireRed partner game ready, a round trip that still did not start is
// missing a workflow, not waiting for the partner.
// build 126: the live extra-save rows (postgame workflows.extraSaves.presentation)
// name which save serves each family and what it waits for.
const EXTRA_SAVE_STATUS={ready:'ready','needs-partner-owner':'prepare that save','needs-park':'prepare that save','needs-helper-task':'start its helper task',
 'needs-helper-save':'start its helper save','planned-long':'long helper task'};
export function nationalCollectionFinishedReason(summary,rows=[],{fireRedPartnerReady=false,extraSaves=[]}={}){
 const c=summary.categories,planned=summary.fireRed.planned;
 const live=(Array.isArray(extraSaves)?extraSaves:[]).filter(r=>r?.label&&r.status);
 const plannedText=!planned?'':live.length?` ${planned} more need another FireRed save or a loan from one: ${live.map(r=>`${r.label} from ${r.save??'another FireRed save'} (${EXTRA_SAVE_STATUS[r.status]??r.doing??r.status})`).join('; ')}.`:
  ` ${planned} more ${planned===1?'needs':'need'} another FireRed save (${c['another-firered-save']??0}) or a Pokémon borrowed from the FireRed partner (${c['partner-borrow']??0}); both are planned.`;
 const waitsForPartner=r=>r.category==='firered-partner'&&!fireRedPartnerReady;
 const partnerRows=rows.filter(r=>r.status==='local'&&waitsForPartner(r)),waiting=rows.filter(r=>['local','dependency'].includes(r.status)&&!waitsForPartner(r));
 const partner=partnerRows.length?` ${partnerRows.length} ${partnerRows.length===1?'waits':'wait'} for the FireRed partner game to be ready for its trade round trip: ${partnerRows.map(r=>r.name).join(', ')}.`:'';
 const pending=(waiting.length?` ${waiting.length} more ${waiting.length===1?'is':'are'} possible in this save but need a workflow the bot does not have yet: ${waiting.map(r=>r.name).slice(0,8).join(', ')}${waiting.length>8?', …':''}.`:'')+partner;
 const spent=c['spent-here']?` ${c['spent-here']} used a one-time source this save no longer has.`:'';
 return `This save has finished what it can do alone: ${fireRedCatchableText(summary)}.${plannedText}${spent} ${c['other-games']??0} other Pokédex entries are only in other games or events.${pending}`;
}
export const NATIONAL_COLLECTION_CATEGORIES=CATEGORY_TEXT;

export function postgameCaptureRequest(speciesId,{shiny='any',locationId='any'}={}){
 return {schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId,quantity:1,locationId,shiny,natures:[],gender:'any',abilityId:null,
  ball:{id:'any',requirement:'preferred'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,
  limits:{maxEncounters:10000,maxMinutes:120,minBalls:10,maxSpend:999999},afterCompletion:'stop-save'};
}

const WEIGHTS=[20,20,10,10,10,10,5,5,4,4,1,1];
// targets: National numbers to catch whether or not they are registered (a
// plain spare an in-game trade or trade evolution needs); default: every
// missing species.
export function selectNationalDexCapture({o,world,mechanics,state={},now=Date.now(),targets=null}){
 const m=o.playerMemory??{},f=m.storyState?.flagIds??{},dex=nationalDexProgress(m.trainer?.pokedex?.ownedSpecies);
 if(o.phase!=='stable'||!dex.known||f[2092]!==true||f[2112]!==true||f[2116]!==true||!storageCapacity(m.trainer).canStart)return null;
 const missing=new Set(targets??dex.missing),species=new Map((mechanics.data??mechanics).species.map(s=>[s.name,s.id])),candidates=[];
 const nameOf=nativeSpecies=>(mechanics.data??mechanics).species.find(s=>s.id===nativeSpecies).name.replace('SPECIES_','').toLowerCase();
 const deferred=(id,map)=>state.failed?.[id]?.retryAt>now||state.failed?.[`${id}:${map}`]?.retryAt>now;
 for(const table of (world.data??world).wildEncounters??[]){
  if(!table.base_label?.endsWith('_FireRed'))continue;
  if(table.land_mons?.mons?.length&&!(table.map.includes('TANOBY_RUINS')&&f[2121]!==true)&&!inactiveAlteringCaveTable(table,m.storyState?.variableIds)){
   const shares=new Map();
   for(const [i,slot] of table.land_mons.mons.entries()){
    const nativeSpecies=species.get(slot.species),id=nationalSpeciesId(nativeSpecies);
    if(!id||!missing.has(id)||deferred(id,table.map))continue;
    shares.set(nativeSpecies,(shares.get(nativeSpecies)??0)+(WEIGHTS[i]??0));
   }
   for(const [nativeSpecies,share] of shares){
    const speciesId=nationalSpeciesId(nativeSpecies),safari=table.map.startsWith('MAP_SAFARI_ZONE_');
    candidates.push({speciesId,nativeSpecies,map:table.map,method:safari?'safari-land':'wild-land',share,
     weight:share*table.land_mons.encounter_rate,here:table.map===m.map?.id,name:nameOf(nativeSpecies)});
   }
  }
  // Fishing: each rod reads its own slots. A rod the save has not received
  // yet is still usable when its giver's gift flag is clear; the hunt
  // collects it first (wild-mission.js). Plain catches only.
  const fishing=table.fishing_mons?.mons??[];
  if(fishing.length)for(const rod of FIRE_RED_RODS){
   const availability=rodAvailability(o,rod);if(!availability)continue;
   const shares=new Map();
   for(const [i,slot] of fishing.slice(rod.start,rod.end).entries()){
    const nativeSpecies=species.get(slot.species),id=nationalSpeciesId(nativeSpecies);
    if(!id||!missing.has(id)||deferred(id,table.map))continue;
    shares.set(nativeSpecies,(shares.get(nativeSpecies)??0)+(rod.shares[i]??0));
   }
   for(const [nativeSpecies,share] of shares)candidates.push({speciesId:nationalSpeciesId(nativeSpecies),nativeSpecies,map:table.map,method:'fishing',rodItemId:rod.itemId,share,
    weight:share*table.fishing_mons.encounter_rate,here:table.map===m.map?.id,name:nameOf(nativeSpecies)});
  }
 }
 // Hunt only a table navigation can reach. A trip starts here on the same
 // island; the island's ferry landing also counts (the cross-island start,
 // and a Kanto Fly/ferry detour out of a walled-off pocket such as Indigo
 // Plateau). Unknown maps stay eligible; the hunt's own route owns them.
 const reachable=new Map(),canReach=c=>{
  const key=JSON.stringify([c.map,c.method==='fishing']);
  if(!reachable.has(key))reachable.set(key,campaignTargetReachable({world,observation:o,target:c.method==='fishing'?{kind:'fishing-zone',map:c.map,rodItemId:c.rodItemId}:{kind:'encounter-zone',map:c.map},exact:true,
   origins:[...(fireRedIsland(c.map)===fireRedIsland(m.map?.id)&&m.position?[{map:m.map.id,position:m.position}]:[]),fireRedFerryArrival(c.map)]})!==false);
  return reachable.get(key);
 };
 const retained=candidates.find(c=>c.speciesId===state.target?.speciesId&&c.map===state.target.map&&canReach(c));
 const chosen=retained??candidates.sort((a,b)=>Number(b.here)-Number(a.here)||b.weight-a.weight||a.speciesId-b.speciesId||a.map.localeCompare(b.map)||(a.rodItemId??0)-(b.rodItemId??0)).find(canReach);
 if(!chosen){state.target=null;return null;}
 state.target={speciesId:chosen.speciesId,map:chosen.map};
 return {id:'postgame-national-catch-'+chosen.speciesId,target:{kind:'postgame-hunt'},route:chosen,request:postgameCaptureRequest(chosen.speciesId)};
}
