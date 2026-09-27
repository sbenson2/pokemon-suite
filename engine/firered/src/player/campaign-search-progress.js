import {createEncounterTracker, encounterFingerprint} from './encounter-tracker.js';
import {isProgressObservation} from './progress-observation.js';

// A rare-species search can be productive without XP or a catch. Credit only
// an independent, checked encounter followed by a normal return to the field.
// Walking, battle text, reloads and encounters en route are not search progress.
export function createCampaignSearchProgress(initialState=null) {
  if(initialState && (initialState.schema!=='master-red/campaign-search-progress/v1'||
      !Number.isSafeInteger(initialState.completedEncounters)||initialState.completedEncounters<0))
    throw new TypeError('invalid campaign search progress checkpoint');
  const tracker=createEncounterTracker({initialState:initialState?.tracker??null});
  let pending=structuredClone(initialState?.pending??null),completedEncounters=initialState?.completedEncounters??0;
  function context(objective) {
    return objective?.id && ['encounter-zone','surf-encounter-zone','fishing-zone'].includes(objective.target?.kind) &&
      objective.captureSpecies?.some(s=>Number.isSafeInteger(s)&&s>0)
      ? JSON.stringify([objective.id,objective.target,objective.captureSpecies]) : null;
  }
  return {
    observe(observation,objective) {
      if(!isProgressObservation(observation))return false;
      const m=observation.playerMemory,key=context(objective),previousFrame=tracker.state().lastFrame;
      const tracked=tracker.observe(observation);
      if(!Number.isSafeInteger(observation.frame)||previousFrame!==null&&observation.frame<previousFrame)return false;
      if(!key||m.map.id!==objective.target.map||pending&&pending.context!==key)pending=null;
      if(!key||m.map.id!==objective.target.map)return false;
      if(tracked.event?.kind==='encounter-identified'&&!tracked.event.repeatedOutcome&&m.encounter?.kind==='wild') {
        pending={context:key,fingerprint:tracked.current.fingerprint,startedFrame:observation.frame,
          target:objective.captureSpecies.includes(m.encounter.pokemon.species),captureAttempted:false};
      }
      if(!pending||observation.emulator.inBattle||observation.emulator.mode!=='overworld'||
          Object.values(m.ui??{}).some(Boolean))return false;
      const completed=pending;pending=null;
      // A requested Pokemon deliberately run from is not a productive attempt.
      const validOutcome=completed.target ? m.battleOutcome===7||completed.captureAttempted&&[6,10].includes(m.battleOutcome)
        : [1,4,6,7,10].includes(m.battleOutcome);
      if(observation.frame<=completed.startedFrame||!validOutcome)return false;
      completedEncounters++;
      return true;
    },
    recordDecision({observation,decision}={}) {
      if(!pending||decision?.kind!=='act'||!isProgressObservation(observation)||
          !observation.emulator.inBattle||encounterFingerprint(observation.playerMemory.encounter?.pokemon)!==pending.fingerprint)return;
      const r=decision.winner?.recommendation,bag=observation.playerMemory.ui?.bag;
      if(r?.kind==='choose-safari-command'&&r.targetAction==='ball'||
          r?.kind==='choose-bag-item'&&bag?.pocket===2&&Number.isSafeInteger(r.targetItemId))pending.captureAttempted=true;
    },
    state:()=>({schema:'master-red/campaign-search-progress/v1',completedEncounters,pending:structuredClone(pending),tracker:tracker.state()}),
  };
}
