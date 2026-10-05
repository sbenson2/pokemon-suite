import {NativeAcquisitionTask,acquisitionField,acquiredPokemon} from './acquisition-task.js';
import {encounterFingerprint as fingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId,nationalDexNumbers} from '../evidence/gen3-national-species.js';
import {storageCapacity} from './storage-capacity.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';
import {itemIsMail} from '../evidence/mail-state.js';

// FireRed's in-game trades (pret/pokefirered src/data/ingame_trades.h, the
// FIRERED branch; the trader's map script and FLAG_DID_*_TRADE from
// include/constants/flags.h). Each trade happens once per save. Species ids
// here are below #152, where internal and National numbers agree.
export const FIRE_RED_NPC_TRADES=Object.freeze([
 {key:'zynx',received:124,requested:61,map:'MAP_CERULEAN_CITY_HOUSE3',script:'CeruleanCity_House3_EventScript_Dontae',flagId:0x24A},
 {key:'marc',received:108,requested:55,map:'MAP_ROUTE18_EAST_ENTRANCE_2F',script:'Route18_EastEntrance_2F_EventScript_Haden',flagId:0x257},
 {key:'mimien',received:122,requested:63,map:'MAP_ROUTE2_HOUSE',script:'Route2_House_EventScript_Reyley',flagId:0x248},
 {key:'chding',received:83,requested:21,map:'MAP_VERMILION_CITY_HOUSE2',script:'VermilionCity_House2_EventScript_Elyssa',flagId:0x24D},
 {key:'msnido',received:29,requested:32,map:'MAP_UNDERGROUND_PATH_NORTH_ENTRANCE',script:'UndergroundPath_NorthEntrance_EventScript_Saige',flagId:0x24B},
 {key:'nina',received:30,requested:33,map:'MAP_ROUTE11_EAST_ENTRANCE_2F',script:'Route11_EastEntrance_2F_EventScript_Turner',flagId:0x251},
 {key:'esphere',received:101,requested:26,map:'MAP_CINNABAR_ISLAND_POKEMON_LAB_LOUNGE',script:'CinnabarIsland_PokemonLab_Lounge_EventScript_Norma',flagId:0x274},
 {key:'tangeny',received:114,requested:48,map:'MAP_CINNABAR_ISLAND_POKEMON_LAB_LOUNGE',script:'CinnabarIsland_PokemonLab_Lounge_EventScript_Clifton',flagId:0x275},
 {key:'seelor',received:86,requested:77,map:'MAP_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM',script:'CinnabarIsland_PokemonLab_ExperimentRoom_EventScript_Garett',flagId:0x276},
].map(Object.freeze));
export const NPC_TRADE_FLAGS=FIRE_RED_NPC_TRADES.map(t=>t.flagId);

// The unused trade that registers a missing species, and the plain spare the
// trader asks for: a boxed, non-shiny, unprotected individual that holds no item
// (the trader keeps it). Without a spare, `source` is null: catch one first.
export function selectNpcTrade({trainer,flags,protectedFingerprints=[],deferred=()=>false}){
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid'||!Array.isArray(trainer.pokedex?.ownedSpecies))return null;
 const owned=new Set(nationalDexNumbers(trainer.pokedex.ownedSpecies)),blocked=new Set([...protectedFingerprints,...trainer.party.map(fingerprint)]);
 for(const trade of FIRE_RED_NPC_TRADES){
  if(owned.has(trade.received)||flags?.[trade.flagId]!==false||deferred(trade.received))continue;
  const source=trainer.storage.pokemon.find(p=>p.validity==='valid'&&!p.isEgg&&p.shiny===false&&nationalSpeciesId(p.species)===trade.requested&&Number(p.heldItem)===0&&!blocked.has(fingerprint(p)))??null;
  return {trade,source:source?structuredClone(source):null};
 }
 return null;
}

export class NpcTradeTask extends NativeAcquisitionTask{
 constructor({requestId,tradeKey,source,world,mechanics,planner,state=null}){
  super();this.world=world;this.mechanics=mechanics;this.planner=planner;
  const trade=FIRE_RED_NPC_TRADES.find(t=>t.key===(state?.tradeKey??tradeKey));
  if(state){
   if(state.kind!=='npc-trade'||state.requestId!==requestId||!trade)throw Error('The trade checkpoint belongs to another acquisition.');
   this.trade=trade;this.state=structuredClone(state);return;
  }
  if(!requestId||!trade||source?.validity!=='valid'||source.isEgg||source.shiny!==false||nationalSpeciesId(source.species)!==trade.requested)throw Error('The in-game trade needs an identified plain Pokémon of the requested species.');
  this.trade=trade;
  this.state={schema:'pokemon-suite/native-acquisition/v1',kind:'npc-trade',requestId,tradeKey:trade.key,speciesId:trade.received,source:structuredClone(source),phase:'preparing'};
 }
 inspect(o){
  const s=this.state,t=this.trade,m=o.playerMemory??{},tr=m.trainer??{};
  // The central planner owns Fly's Start/party/map workflow and the trader's
  // prompts. Keep the reserved trade objective available across those screens.
  const policySurface=Boolean(m.ui?.startMenu||m.ui?.party||m.ui?.flyMap||m.ui?.fieldDialog||m.ui?.choiceMenu);
  if(o.emulator?.inBattle)return {kind:'wait'};
  if(s.receipt)return {kind:'complete',receipt:s.receipt};
  if(o.emulator?.mode==='in-game-trade'||m.ui?.inGameTrade){s.dirty=true;s.phase='trading';return {kind:'policy',objective:this.#tradeObjective()};}
  if(tr.partyValidity!=='valid'||tr.storage?.validity!=='valid')return acquisitionField(o)?this.stop('The party and PC must verify before an in-game trade.'):{kind:'wait'};
  const all=acquiredPokemon(o),sourceId=fingerprint(s.source),free=acquisitionField(o);
  if(!s.initial){
   s.initial=all.map(fingerprint);
   s.originalParty=tr.party.map(fingerprint);
  }
  const flag=m.storyState?.flagIds?.[t.flagId],held=all.filter(p=>fingerprint(p)===sourceId);
  const received=all.filter(p=>p.validity==='valid'&&!p.isEgg&&!s.initial.includes(fingerprint(p))&&nationalSpeciesId(p.species)===t.received);
  if(received.length>1)return this.stop('More than one new Pokémon of the traded species appeared.');
  if(received.length===1||flag===true&&!held.length){
   // Once restoration starts, its planner owns travel and PC menus.
   if(!free&&!s.saving)return s.preparationGoal?{kind:'policy',objective:s.preparationGoal}:this.drain(o);
   if(held.length)return this.stop('The traded Pokémon is still in this save.');
   if(received.length!==1)return this.stop('The in-game trade is recorded, but the received Pokémon is missing.');
   const p=received[0];s.received??=fingerprint(p);s.dirty=true;
   if(s.received!==fingerprint(p))return this.stop('The received Pokémon identity changed.');
   if(!nationalDexNumbers(tr.pokedex?.ownedSpecies).includes(t.received))return this.stop('The received Pokémon is absent from the native Pokédex.');
   // FireRed refuses to deposit a Pokémon holding Mail. Some cartridge trades
   // supply Mail, so remove it before a full original team can be restored.
   if(itemIsMail(p.heldItem))return this.#prepare(o,'remove-mail',{kind:'take-held-item',map:m.map?.id,fingerprint:s.received,itemId:p.heldItem,preserveLetter:true});
   // The team goes back as it was, minus the Pokémon the trader kept.
   const team=s.originalParty.filter(id=>id!==sourceId);
   if(!team.every(id=>tr.party.some(q=>fingerprint(q)===id)))return this.#prepare(o,'restore-team',{kind:'party-roster',map:fireRedPokemonCenter(m.map?.id),requiredFingerprints:team,maximumPartySize:6});
   s.phase='saving';s.saving=true;
   return this.save(o,p,{sent:{fingerprint:sourceId,species:s.source.species},trade:t.key,matched:true});
  }
  if(flag!==false)return free?this.stop('This save has already used the in-game trade.'):{kind:'wait'};
  if(held.length!==1)return free?this.stop('The reserved Pokémon for the trade is missing or duplicated.'):{kind:'wait'};
  if(s.preparationGoal){if(!free)return {kind:'policy',objective:s.preparationGoal};s.preparationGoal=null;}
  // The cartridge's party picker offers the first Pokémon of the requested
  // species: carry exactly the reserved one and store any look-alike.
  const lookalikes=tr.party.filter(p=>nationalSpeciesId(p.species)===t.requested&&fingerprint(p)!==sourceId).map(fingerprint);
  if(!tr.party.some(p=>fingerprint(p)===sourceId)||lookalikes.length){
   if(!storageCapacity(tr).known)return this.stop('Verify PC space before preparing the trade.');
   return this.#prepare(o,'party',{kind:'party-roster',map:fireRedPokemonCenter(m.map?.id),requiredFingerprints:[sourceId],excludedFingerprints:lookalikes,maximumPartySize:6});
  }
  const objective=this.#tradeObjective();
  if(objective.target.index<0)return this.stop('The in-game trader is not in the current cartridge.');
  if(!free)return policySurface?{kind:'policy',objective}:{kind:'wait'};
  s.phase='trading';
  return {kind:'policy',objective};
 }
 #tradeObjective(){
  const t=this.trade,index=(this.world?.data??this.world)?.maps?.find(x=>x.id===t.map)?.objectEvents?.findIndex(e=>e.script===t.script)??-1;
  return {id:`acquire-${this.state.requestId}-trade`,target:{kind:'in-game-trade',map:t.map,index,requestedSpecies:t.requested,receivedSpecies:t.received},
   completion:{kind:'flag-set',id:t.flagId},dialogue:'advance',choice:'yes',deferOptionalDetours:true,identityEvolution:true};
 }
 #prepare(o,suffix,target){const next=this.policy(suffix,target);this.state.preparationGoal=next.objective;return next;}
}
