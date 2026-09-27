import {partyFullyRestored} from '../player/recovery.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';
import {postgameCareObjective} from './postgame-care.js';

export function fieldRecoveryObjective(o,world,mechanics,context=null){
 const m=o.playerMemory;
 if(context&&m?.storyState?.flagIds?.[2092]===true)return postgameCareObjective(o,{...context,world,mechanics});
 if(o.phase!=='stable'||o.emulator.inBattle||!m?.trainer?.party?.length||partyFullyRestored(m,mechanics))return null;
 const map=fireRedPokemonCenter(m.map?.id),index=(world?.data??world)?.maps?.find(m=>m.id===map)?.objectEvents?.findIndex(e=>/EventScript_Nurse$/.test(e.script));
 if(!(index>=0))return null;
 return {id:'restore-postgame-party',target:{kind:'object',map,index},dialogue:'advance',choice:'yes',deferOptionalDetours:true};
}
