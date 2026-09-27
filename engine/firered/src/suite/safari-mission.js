import {WildMission} from './wild-mission.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {validateHuntConfig} from '../player/hunt-config.js';
import {knownCaptureFreeSlots} from '../player/encounter-safety.js';

export function readSafariStatus(session,runtime,battleFlags=0){
 const s=runtime?.data?.symbols??{};
 if(!s.gNumSafariBalls||!s.gSafariZoneStepCounter)return {validity:'unknown'};
 const word=(address,n)=>{const b=session.readMemory(address,n);return new DataView(b.buffer,b.byteOffset,n);};
 const result={validity:'valid',balls:session.readMemory(s.gNumSafariBalls.address,1)[0],steps:word(s.gSafariZoneStepCounter.address,2).getUint16(0,true)};
 if(battleFlags===132){
  if(!s.gBattleStruct)return {...result,battleValidity:'unknown'};
  const pointer=word(s.gBattleStruct.address,4).getUint32(0,true);
  if(pointer<0x02000000||pointer+0x7d>0x02040000)return {...result,battleValidity:'unknown'};
  const b=session.readMemory(pointer+0x79,4);
  Object.assign(result,{rocks:b[0],bait:b[1],escapeFactor:b[2],catchFactor:b[3]});
 }
 return result;
}

export {chooseSafariCapture} from '../player/safari-capture.js';

export function supportsSafari(request){
 let reason=null;
 if(request.game!=='firered'||request.speciesId!==113)reason='This Safari executor currently supports FireRed Chansey.';
 else if(!['any','10:347:1:'].includes(request.locationId))reason='Choose the north Safari Zone for this Chansey hunt.';
 else if(request.quantity!==1)reason='This Safari hunt stops after one verified capture.';
 else if(request.shiny!=='required')reason='This Safari executor currently requires a shiny target.';
 else if(request.moves?.length||request.heldItemId!==null||request.finalLevel!==null)reason='Safari hunts currently save the Pokémon as caught.';
 else if(request.ball?.requirement==='required'&&!['any','safari-ball'].includes(request.ball.id))reason='Safari encounters require Safari Balls.';
 else if(request.encounterLevel.min>26||request.encounterLevel.max<26)reason='The north Safari Zone Chansey encounter is level 26.';
 return {supported:!reason,reason};
}

export class SafariMission extends WildMission {
 constructor(args){
  const support=supportsSafari(args.request);if(!support.supported)throw new Error(support.reason);
  super({...args,route:{map:'MAP_SAFARI_ZONE_NORTH',method:'safari-land',speciesId:113,nativeSpecies:113,locationId:'10:347:1:',name:'Chansey'},world:null});
 }
}
