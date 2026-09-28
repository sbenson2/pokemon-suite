import {NativeAcquisitionTask,acquisitionField,acquiredPokemon} from './acquisition-task.js';
import {BreedingTask} from './native-breeding.js';
import {PcReleaseTask} from './pc-release.js';
export {selectOwnedBreeding} from './native-breeding.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {storageCapacity} from './storage-capacity.js';

export const FIRE_RED_PRIZES=[
 {speciesId:63,coins:180,level:9,index:0},
 {speciesId:35,coins:500,level:8,index:1},
 {speciesId:147,coins:2800,level:18,index:2},
 {speciesId:123,coins:5500,level:25,index:3},
 {speciesId:137,coins:9999,level:26,index:4},
];
const CORNER='MAP_CELADON_CITY_GAME_CORNER',PRIZES=CORNER+'_PRIZE_ROOM';
class GameCornerTask extends NativeAcquisitionTask{
 constructor({requestId,speciesId,state,world,planner}){
  super();
  this.prize=FIRE_RED_PRIZES.find(p=>p.speciesId===speciesId);
  if(!this.prize||!requestId)throw Error('Choose a FireRed Game Corner prize.');
  if(state&&(state.kind!=='game-corner'||state.requestId!==requestId||state.speciesId!==speciesId))throw Error('The prize checkpoint belongs to another acquisition.');
  this.state=structuredClone(state??{schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId,speciesId,phase:'preparing'});
  this.world=world;this.planner=planner;
 }
 policy(suffix,target,extra={}){return {kind:'policy',objective:{id:`acquire-${this.state.requestId}-${suffix}`,target,dialogue:'advance',choice:'yes',deferOptionalDetours:true,identityEvolution:true,...extra}};}
 stop(reason){this.state.reason=reason;return {kind:'stop',reason};}
 suspend(reason,o){
  const s=this.state,m=o.playerMemory,t=m?.trainer;
  if(s.suspension)return true;
  if(s.phase!=='preparing'||s.purchase||s.prizeBaseline||s.received||s.save||!acquisitionField(o)||
   t?.partyValidity!=='valid'||t.storage?.validity!=='valid'||!Number.isSafeInteger(t.money)||
   !Number.isSafeInteger(m.postgameEvidence?.acquisition?.coins)||!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return false;
  s.suspension={reason,coins:m.postgameEvidence.acquisition.coins,money:t.money,
   fingerprints:acquiredPokemon(o).map(encounterFingerprint).sort(),counter:m.gameStats.savedGame,sha256:o.sram.sha256};
  return true;
 }
 inspectSuspension(o){
  const s=this.state,b=s.suspension,m=o.playerMemory,t=m.trainer;
  if(b.coins!==m.postgameEvidence.acquisition.coins||b.money!==t.money||
   JSON.stringify(b.fingerprints)!==JSON.stringify(acquiredPokemon(o).map(encounterFingerprint).sort()))return this.stop('The suspended acquisition balance or Pokémon identities changed before its save verified.');
  const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===b.counter+1&&o.sram.sha256!==b.sha256;
  if(!verified||!acquisitionField(o))return this.policy('suspend-save',{kind:'save-game',map:m.map.id,saveVerified:verified});
  b.receipt={nativeSaveVerified:true,savedSramSha256:o.sram.sha256,savedFrame:o.frame,coins:b.coins,money:b.money};
  s.dirty=false;
  return {kind:'suspended',reason:b.reason,receipt:b.receipt};
 }
 event(map,script,kind='object',extra={}){
  const row=(this.world.data??this.world).maps.find(m=>m.id===map),index=(kind==='background'?row?.backgroundEvents:row?.objectEvents)?.findIndex(e=>e.script===script)??-1;
  return index>=0?this.policy(script,{kind,map,index},extra):this.stop('The required native acquisition interaction is unavailable: '+script);
 }
 slots(o,slots,coins,yieldRequested=false){
  const s=this.state;s.phase='slots';s.slotRounds??=0;s.dirty=true;
  if(slots.task==='MainTask_ConfirmExitGame'&&slots.stage===2){
   if(!s.exitSelected){s.exitSelected=true;return this.action(['up']);}
   return this.action(['a']);
  }
  if(slots.task==='MainTask_SlotsGameLoop'){
   s.exitSelected=false;
   if(slots.stage===3)return this.action(['a']);
   if(slots.stage===0){
    if(slots.bet>0){s.paidRound=true;return this.action(['a']);}
    if(s.paidRound){s.slotRounds++;s.paidRound=false;}
    if(yieldRequested||coins>=this.prize.coins||coins%50===49||s.slotRounds>=500)return this.action(['b']);
    return this.action(['down']);
   }
  }
  if(slots.task==='MainTask_WinHandlePayout'&&slots.stage===2)return this.action(['start']);
  return {kind:'wait'};
 }
 inspect(o,{yieldRequested=false}={}){
  const s=this.state,m=o.playerMemory??{},t=m.trainer??{},coins=m.postgameEvidence?.acquisition?.coins;
  const slots=m.postgameEvidence?.acquisition?.slots;
  if(o.emulator?.callback2==='CB2_RunSlotMachine'&&slots&&Number.isInteger(coins))return this.slots(o,slots,coins,yieldRequested);
  if(o.phase!=='stable'||o.emulator?.inBattle)return {kind:'wait'};
  if(t.partyValidity!=='valid'||t.storage?.validity!=='valid'||!Number.isInteger(coins)||coins<0||coins>9999)return acquisitionField(o)?this.stop('Verify party, storage and the native coin balance before purchasing a prize.'):{kind:'wait'};
  if(s.suspension)return this.inspectSuspension(o);
  if(s.receipt)return {kind:'complete',receipt:s.receipt};
  const free=acquisitionField(o);
  if(s.phase==='slots'&&free){
   s.phase='preparing';
   if(s.slotRounds>=500&&coins<this.prize.coins&&coins%50!==49)return this.stop('The native coin remainder needs another attempt after 500 completed rounds.');
  }
  if(s.purchase){
   const p=s.purchase;
   if(coins!==p.coins||t.money!==p.money){
    if(coins!==p.coins+p.quantity||t.money!==p.money-p.quantity*20){
     if(!free)return this.drain(o); // cartridge script applies the two counters sequentially
     return this.stop('The native coin purchase debit does not match the requested batch.');
    }
    s.dirty=true;
    if(!free)return this.drain(o);
    s.purchase=null;
   }else return this.event(CORNER,'CeladonCity_GameCorner_EventScript_CoinsClerk','object',{choiceByRows:{3:p.quantity===500?1:0}});
  }
  if(s.prizeBaseline){
   const b=s.prizeBaseline;
   const candidates=acquiredPokemon(o).filter(p=>p.validity==='valid'&&p.species===s.speciesId&&!b.fingerprints.includes(encounterFingerprint(p)));
   if(candidates.length>1)return this.stop('More than one new prize identity appeared.');
   if(candidates.length===1){
    const p=candidates[0];
    if(!s.received){
     if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return this.stop('The acquisition save baseline is unavailable.');
     s.received=encounterFingerprint(p);s.save={counter:m.gameStats?.savedGame,sha256:o.sram?.sha256,frame:o.frame};s.dirty=true;}
    if(s.received!==encounterFingerprint(p))return this.stop('The received prize identity changed.');
    if(m.ui?.choiceMenu)return {kind:'recommendation',recommendation:{kind:'choose-menu-option',targetOption:'no'}};
    if(!free&&!s.saving)return this.drain(o);
    if(coins!==b.coins-this.prize.coins)return this.stop('The received prize has no matching native coin payment.');
    if(!t.pokedex?.ownedSpecies?.includes(s.speciesId))return this.stop('The prize Pokédex registration is unverified.');
    s.saving=true;return this.save(o,p,{coinsSpent:this.prize.coins});
   }
   if(s.received||coins!==b.coins&&free)return this.stop('The paid prize is missing from the verified party and storage.');
  }
  if(yieldRequested&&free&&s.phase==='preparing')return {kind:'wait'};
  if(!storageCapacity(t).canStart)return this.stop('Keep free storage for the Game Corner prize and protected encounters.');
  if(m.storyState?.flagIds?.[579]!==true)return this.event('MAP_CELADON_CITY_RESTAURANT','CeladonCity_Restaurant_EventScript_CoinCaseMan');
  if(coins<this.prize.coins){
   const quantity=coins+500<=9999&&this.prize.coins-coins>=500?500:coins+50<=9999?50:null;
   if(quantity===null)return this.event(CORNER,'CeladonCity_GameCorner_EventScript_SlotMachine1','background');
   if(t.money<quantity*20){
    const funding=this.planner?.selectIncomePreparation(o);
    return funding?{kind:'policy',objective:funding}:this.stop('Earn enough money for the next native coin purchase.');
   }
   if(free&&m.map.id===CORNER)s.purchase={quantity,coins,money:t.money};
   return this.event(CORNER,'CeladonCity_GameCorner_EventScript_CoinsClerk','object',{choiceByRows:{3:quantity===500?1:0}});
  }
  if(free&&m.map.id===PRIZES&&!s.prizeBaseline)s.prizeBaseline={coins,fingerprints:acquiredPokemon(o).map(encounterFingerprint)};
  return this.event(PRIZES,'CeladonCity_GameCorner_PrizeRoom_EventScript_PrizeClerkMons','object',{choiceByRows:{6:this.prize.index}});
 }
}

export function createPostgameAcquisition(options){
 if(options.kind==='breeding')return new BreedingTask(options);
 if(options.kind==='game-corner')return new GameCornerTask(options);
 if(options.kind==='pc-release')return new PcReleaseTask(options);
 throw Error('This native acquisition workflow is unavailable.');
}
