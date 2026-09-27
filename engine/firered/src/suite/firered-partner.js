// The invisible FireRed trade partner: a second FireRed save that only serves
// trade-evolution round trips for the source FireRed owner. It is never given
// tasks. Readiness is read from the live game and a cold boot of its own
// native save; nothing here writes game memory or chooses a Pokémon to keep.
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {selectPartnerPlaceholder,partnerHoldings} from './local-evolution.js';

export const FIRERED_PARTNER_WATCH=Object.freeze({flags:Object.freeze([2089,2092,2112]),variables:Object.freeze([])});
const CENTER=/^MAP_[A-Z0-9_]+_POKEMON_CENTER_(1F|2F)$/;
const OWNER=/^[a-zA-Z0-9_-]{1,100}$/;

export function inspectFireRedPartnerReadiness({live,saved,world,owner,requestId,sourceOwner='firered',sramSha256}){
 if(!OWNER.test(owner??'')||!OWNER.test(requestId??'')||!OWNER.test(sourceOwner??'')||owner===sourceOwner)throw Error('Choose the source evolution request for this FireRed partner.');
 const base={requestId,owner,sourceOwner,kind:'firered-partner',methods:['trade']};
 const waiting=reason=>({...base,phase:'waiting',reason});
 const m=live?.playerMemory,t=m?.trainer,ui=m?.ui??{};
 if(live?.phase!=='stable'||live.emulator?.mode!=='overworld'||live.emulator.inBattle||Object.values(ui).some(Boolean))return waiting('The FireRed partner must be idle in the field before it can serve a trade.');
 const map=m?.map?.id,floor=CENTER.exec(map??'');
 const upstairs=floor&&world?.data?.maps?.find(x=>x.id===map.replace(/_1F$/,'_2F'))?.objectEvents?.some(e=>e.script==='Common_EventScript_DirectCornerAttendant');
 if(!upstairs)return waiting('The FireRed partner must be saved inside a Pokémon Center with a Direct Corner.');
 // Its own native save must continue in the same Center with the same party,
 // PC and trainer, so a restart can prove any exchange was not committed.
 const s=saved?.playerMemory,st=s?.trainer;
 if(!/^[a-f0-9]{64}$/.test(sramSha256??'')||saved?.emulator?.callback2!=='CB2_Overworld'||s?.map?.id!==map)return waiting('Save the FireRed partner in this Pokémon Center before it serves a trade.');
 let holdings;
 try{
  holdings=partnerHoldings(t);
  const savedHoldings=partnerHoldings(st);
  if(JSON.stringify(savedHoldings)!==JSON.stringify(holdings)||JSON.stringify(t.party.map(encounterFingerprint))!==JSON.stringify(st.party.map(encounterFingerprint)))
   return waiting('The FireRed partner party or PC differs from its native save. Save it in this Pokémon Center first.');
 }catch(error){return waiting(error.message);}
 const trainerId=t.trainerId;
 if(!Number.isInteger(trainerId)||trainerId<0||trainerId>65535||st.trainerId!==trainerId)return waiting('The FireRed partner trainer ID could not be verified.');
 const flags=s.storyState?.flagIds??{},pokedex=flags[2089]===true||flags[2092]===true;
 if(!pokedex)return waiting('The FireRed partner needs its Pokédex before it can trade.');
 const candidate=selectPartnerPlaceholder(t.party);
 if(!candidate)return waiting('The FireRed partner party has no ordinary placeholder: a non-shiny, non-legendary Pokémon from #1–151 with no held item, no HM and no trade evolution.');
 return {...base,phase:'ready-for-transfer',reason:'The FireRed partner is saved in its Pokémon Center and ready for the paired trade evolution.',
  center:map.replace(/_2F$/,'_1F'),trainerId,pokedex:true,nationalDex:flags[2112]===true,transferCandidate:structuredClone(candidate),
  holdings,nativeSaveVerified:true,savedSramSha256:sramSha256};
}
