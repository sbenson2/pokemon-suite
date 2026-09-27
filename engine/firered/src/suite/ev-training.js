import {IV_STATS} from '../evidence/pokemon-record.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {acceptableEffortGain,validateEffortRequest} from '../player/effort-values.js';
import {selectEffortTrainingLocation} from '../player/campaign.js';

export class EffortTrainingTask {
  constructor({request,state=null,world,mechanics,planner}) {
    this.state=structuredClone(state??{request,phase:'checking'});validateEffortRequest(this.state.request);
    this.world=world;this.mechanics=mechanics;this.planner=planner;
  }
  inspect(o) {
    const s=this.state,r=s.request,m=o.playerMemory,t=m?.trainer;
    const stop=reason=>({kind:'stop',reason});
    if(o.phase!=='stable'||!o.emulator.inputReady||t?.partyValidity!=='valid')return {kind:'wait'};
    const field=o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
    const party=t.party??[],stored=t.storage?.validity==='valid'?t.storage.pokemon??[]:[];
    const matches=[...party,...stored].filter(p=>encounterFingerprint(p)===r.fingerprint);
    if(matches.length!==1)return stop('The selected Pokémon must be uniquely identified in the current party or PC.');
    const p=matches[0];
    if(p.isEgg||IV_STATS.some(k=>!Number.isInteger(p.evs?.[k]))||!Number.isInteger(p.pokerus))return stop('The Pokémon’s EVs and Pokérus status are not verified.');
    for(const [stat,range] of Object.entries(r.ivRanges))if(!Number.isInteger(p.ivs?.[stat])||p.ivs[stat]<range.min||p.ivs[stat]>range.max)return stop(`${stat} IV is outside the required range. IVs are fixed in FireRed; acquire a matching individual before training.`);
    if(IV_STATS.some(k=>p.evs[k]>r.evs[k]))return stop('FireRed cannot remove unwanted EVs. Use a fresh matching Pokémon or reset its EVs through a separate Emerald transfer.');
    s.initialEvs??=structuredClone(p.evs);s.originalItem??=p.heldItem;
    s.progress={current:structuredClone(p.evs),target:r.evs,remaining:Object.fromEntries(IV_STATS.map(k=>[k,r.evs[k]-p.evs[k]]))};
    const policy=(target,allowedSpecies=[],training=false)=>({kind:'policy',objective:s.objective={id:`ev-training-${r.id}`,target,dialogue:'advance',choice:'yes',
      identityEvolution:true,deferOptionalDetours:true,trainerTrainingAllowed:false,
      evTraining:{fingerprint:r.fingerprint,allowedSpecies,training,targets:r.evs,encounter:s.location?.encounter},trainingFingerprint:r.fingerprint}});
    if(!party.includes(p))return policy({kind:'party-roster',map:'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F',minimumPartySize:1,maximumPartySize:6,requiredFingerprints:[r.fingerprint]});
    const done=IV_STATS.every(k=>p.evs[k]===r.evs[k]);
    if(done) {
      if(!field&&s.phase!=='saving')return policy({kind:'map',map:m.map.id});
      if(p.heldItem!==s.originalItem){
        if(p.heldItem)return policy({kind:'take-held-item',map:m.map.id,fingerprint:r.fingerprint,itemId:p.heldItem});
        const owned=Object.values(t.bag??{}).flatMap(x=>Array.isArray(x)?x:[]).some(i=>i.itemId===s.originalItem&&i.quantity>0);
        if(!owned)return stop('Restore the Pokémon’s original held item before completing training.');
        return policy({kind:'give-held-item',map:m.map.id,fingerprint:r.fingerprint,itemId:s.originalItem});
      }
      if(!s.save){
        if(!Number.isInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return {kind:'wait'};
        s.save={counter:m.gameStats.savedGame,sha256:o.sram.sha256};s.phase='saving';
      }
      const verified=m.saveAttemptStatus===1&&m.gameStats.savedGame===s.save.counter+1&&o.sram.sha256!==s.save.sha256;
      if(['error','saving-error'].includes(m.ui?.saveDialog?.stage))return stop('EV training is finished, but the native save failed.');
      if(verified&&field){s.phase='complete';s.receipt={request:r,fingerprint:r.fingerprint,evs:structuredClone(p.evs),ivs:structuredClone(p.ivs),initialEvs:s.initialEvs,
        nativeSaveVerified:true,savedSramSha256:o.sram.sha256,frame:o.frame,onlineReady:false};return {kind:'complete',receipt:s.receipt};}
      return policy({kind:'save-game',map:m.map.id,saveVerified:verified});
    }
    if(p.level>=100)return stop('Level 100 Pokémon cannot gain battle EVs in FireRed.');
    if(p.heldItem===175)return stop('Remove the Enigma Berry before EV training; its custom held effect is not verified.');
    const owned=itemId=>Object.values(t.bag??{}).flatMap(x=>Array.isArray(x)?x:[]).some(i=>i.itemId===itemId&&i.quantity>0);
    const vitamins={hp:63,attack:64,defense:65,speed:66,spAttack:67,spDefense:70};
    const parityBridges=new Set();
    if(p.pokerus!==0){
      const uncorrected=IV_STATS.filter(stat=>{
        if((r.evs[stat]-p.evs[stat])%2===0||r.evs[stat]===255)return false;
        if(p.evs[stat]%2===1&&p.evs[stat]<100&&r.evs[stat]>=100&&owned(vitamins[stat])){parityBridges.add(stat);return false;}
        return true;
      });
      if(uncorrected.length&&!(uncorrected.length===1&&Object.values(r.evs).reduce((a,b)=>a+b,0)===510))
        return stop('Pokérus doubles battle EVs, so this exact spread cannot be reached from the current EVs with the available vitamins.');
    }
    // Vitamins are not multiplied, and their 100-EV cap can correct an odd
    // deficit. Keep the last such vitamin until it actually reaches the cap.
    if(field)for(const [stat,itemId] of Object.entries(vitamins)){
      const gain=Math.max(0,Math.min(10,100-p.evs[stat],510-Object.values(p.evs).reduce((a,b)=>a+b,0)));
      // An odd capped vitamin gain must not break an already reachable
      // even deficit. A 255 target can still use the native per-stat cap.
      if(p.pokerus!==0&&gain%2===1&&(r.evs[stat]-p.evs[stat])%2===0&&r.evs[stat]!==255)continue;
      if(gain>0&&p.evs[stat]+gain<=r.evs[stat]&&owned(itemId)&&(!parityBridges.has(stat)||p.evs[stat]>=90))
        return policy({kind:'use-party-item',map:m.map.id,fingerprint:r.fingerprint,itemId});
    }
    const species=Object.values((this.mechanics?.data??this.mechanics)?.species??{}).filter(Boolean);
    const allowed=species.filter(mon=>acceptableEffortGain(p,mon,r.evs)).map(mon=>mon.id);
    if(!allowed.length&&p.heldItem===181&&field)return policy({kind:'take-held-item',map:m.map.id,fingerprint:r.fingerprint,itemId:181});
    if(!allowed.length)return stop('No exact EV gain is possible with this spread and Pokérus multiplier. Choose a reachable target or another individual.');
    if(o.emulator.inBattle||o.emulator.mode==='battle')return policy({kind:'map',map:m.map.id},allowed,s.phase==='training');
    if(!field)return policy(s.objective?.target??{kind:'map',map:m.map.id},[],false);
    if(p.heldItem===0&&owned(181)&&species.some(mon=>acceptableEffortGain({...p,heldItem:181},mon,r.evs)))
      return policy({kind:'give-held-item',map:m.map.id,fingerprint:r.fingerprint,itemId:181});
    if(p.hp<p.maxHp/2||p.status1||(p.pp??[]).every(n=>n===0)){
      const recovery=this.planner.selectRecovery(o);if(!recovery)return stop('No reachable healing location is available for this training task.');
      s.phase='healing';s.objective=recovery;return policy(recovery.target);
    }
    const selectionSignature=JSON.stringify([p.evs,p.level,p.heldItem,p.pokerus]);
    const location=s.selectionSignature===selectionSignature&&s.location?s.location:selectEffortTrainingLocation({world:this.world,mechanics:this.mechanics,observation:o,member:p,targets:r.evs,preferredMap:s.location?.target.map});
    if(!location)return stop('No reachable, safe land encounter can provide these exact EVs in the current game.');
    s.location=location;s.objective=location;s.selectionSignature=selectionSignature;
    if(m.map.id!==location.target.map){s.phase='travel';return policy(location.target);}
    if(p.slot!==0){s.phase='preparing';return policy({kind:'lead-party-member',map:m.map.id,fingerprint:r.fingerprint});}
    s.phase='training';return policy(location.target,allowed,true);
  }
}
