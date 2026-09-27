import {encounterFingerprint} from '../player/encounter-tracker.js';
export const acquisitionField=o=>o.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory?.ui??{}).some(Boolean);
export const acquiredPokemon=o=>[...(o.playerMemory?.trainer?.party??[]),...(o.playerMemory?.trainer?.storage?.pokemon??[])];

export class NativeAcquisitionTask{
 event(map,script,kind='object',extra={}){
  const row=(this.world.data??this.world).maps.find(m=>m.id===map),index=(kind==='background'?row?.backgroundEvents:row?.objectEvents)?.findIndex(e=>e.script===script)??-1;
  return index>=0?this.policy(script,{kind,map,index},extra):this.stop('The required native acquisition interaction is unavailable: '+script);
 }
 policy(suffix,target,extra={}){return {kind:'policy',objective:{id:`acquire-${this.state.requestId}-${suffix}`,target,dialogue:'advance',choice:'yes',deferOptionalDetours:true,identityEvolution:true,...extra}};}
 stop(reason){this.state.reason=reason;return {kind:'stop',reason};}
 action(buttons){return {kind:'act',action:{buttons,holdFrames:1,releaseFrames:7}};}
 drain(o){return this.policy('finish-dialogue',{kind:'map',map:o.playerMemory.map.id});}
 save(o,pokemon,extra={}){
  const s=this.state,m=o.playerMemory;
  if(!s.save){
   if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return this.stop('The acquisition save baseline is unavailable.');
   s.save={counter:m.gameStats.savedGame,sha256:o.sram.sha256,frame:o.frame};s.dirty=true;
  }
  const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===s.save.counter+1&&o.sram?.sha256!==s.save.sha256;
  if(!verified||!acquisitionField(o))return this.policy('save',{kind:'save-game',map:m.map.id,saveVerified:verified});
  s.receipt={requestId:s.requestId,method:s.kind,pokemon:structuredClone(pokemon),fingerprint:encounterFingerprint(pokemon),nativeSaveVerified:true,savedFrame:o.frame,savedSramSha256:o.sram.sha256,...extra};
  s.phase='complete';s.dirty=false;return {kind:'complete',receipt:s.receipt};
 }
}

