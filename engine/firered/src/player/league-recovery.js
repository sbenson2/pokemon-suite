import {nextRecoveryTreatment,hasUsableAttackingPp} from './recovery.js';

// A completed treatment is not a completed intermission. Verify the resulting
// party and a cartridge save before allowing the next opponent to own input.
export function createLeagueRecovery({initialState=null,mechanics}={}) {
 let state=initialState ? structuredClone(initialState) : null;
 return {
  state:()=>state ? structuredClone(state) : null,
  reset:()=>{state=null;},
  inspect(objective,observation) {
   const memory=observation.playerMemory ?? {},ui=memory.ui ?? {};
   const result=(target,complete=false)=>({complete,objective:{...objective,target:{...target}}});
   const blocked=reason=>result({kind:'stop-for-review',reason});
   if(observation.phase!=='stable' || observation.emulator?.inBattle || observation.emulator?.mode==='battle') return result(objective.target);
   if(state?.objectiveId!==objective.id) state={objectiveId:objective.id,save:null};
   const party=memory.trainer?.party;
   if(!Array.isArray(party) || !party.length || !memory.trainer?.bag || memory.trainer.partyValidity==='unknown') return blocked('league-party-state-unknown');
   if(nextRecoveryTreatment(memory,mechanics)) {
    state.save=null;
    return result({kind:'heal-with-items'});
   }
   if(!party.every(p=>Number(p.maxHp)>0 && Number(p.hp)===Number(p.maxHp) && Number(p.status1 ?? 0)===0)) return blocked('league-recovery-supplies-exhausted');
   if(party.some(p=>!hasUsableAttackingPp(p,mechanics))) return blocked('league-pp-restoration-unavailable');
   // A save verified on the overworld stays verified while nothing else is
   // saved: a later field menu (the Champion lead order) is not a new save.
   if(state.save?.verified && memory.gameStats?.savedGame===state.save.counter+1) return result({kind:'save-game'},true);
   // Finish the last medicine dialog before establishing a save baseline.
   if(ui.bag || ui.party) return result({kind:'heal-with-items'});
   if(!state.save) {
    if(!Number.isSafeInteger(memory.gameStats?.savedGame) || !observation.sram?.sha256) return blocked('league-save-baseline-unknown');
    state.save={counter:memory.gameStats.savedGame,sramSha256:observation.sram.sha256,map:memory.map?.id};
   }
   if(['error','saving-error'].includes(ui.saveDialog?.stage)) return blocked('league-native-save-failed');
   if(memory.gameStats?.savedGame>state.save.counter+1) return blocked('league-save-counter-changed-unexpectedly');
   const saved=memory.saveAttemptStatus===1 && memory.gameStats?.savedGame===state.save.counter+1 && observation.sram?.sha256!==state.save.sramSha256;
   if(saved && observation.emulator?.mode==='overworld' && !ui.saveDialog && !ui.startMenu && !ui.fieldDialog && !ui.choiceMenu && memory.map?.id===state.save.map){
    state.save.verified=true;
    return result({kind:'save-game'},true);
   }
   return result({kind:'save-game',saveVerified:saved});
  },
 };
}
