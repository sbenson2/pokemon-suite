import {encounterFingerprint} from '../player/encounter-tracker.js';
import {ownedCaptureCount} from '../rng/protected-capture-plan.js';

// A native flee (6) is not Roar (4), defeat, capture, or an unknown outcome.
// Never restore a save here: the same released animal must still be roaming.
export function canContinueRoamerTracking({mission,observation:o,evidence}){
 const r=o?.playerMemory?.postgameEvidence?.roamer,p=evidence?.pokemon,release=mission?.release;
 return Boolean(mission?.method==='roamer'&&mission.protected&&release?.nativeSaveVerified&&
  o?.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&
  !Object.values(o.playerMemory.ui??{}).some(Boolean)&&o.playerMemory.battleOutcome===6&&
  p?.validity==='valid'&&p.shiny===false&&p.species===mission.route?.speciesId&&
  p.species===release.species&&p.personality===release.personality&&release.shiny===false&&
  evidence.fingerprint===encounterFingerprint(p)&&evidence.before?.party===0&&evidence.before?.storage===0&&
  !evidence.caught&&!evidence.postCatch&&!evidence.nativeSaveVerified&&
  mission.protectedAnchor?.stateSha256&&mission.protectedAnchor.sramSha256&&o.sram?.sha256===mission.protectedAnchor.sramSha256&&
  ownedCaptureCount(o,evidence.fingerprint)===0&&r?.active===true&&r.species===p.species&&
  r.personality===p.personality&&r.shiny===false&&Number.isInteger(r.location?.group)&&Number.isInteger(r.location?.number));
}
