// Conservative boundary shared by planner replacement and whole-worker handoff.
import {nativeTradeFinished} from './native-trade-host.js';
export function updateBoundary({game,observation:o,mission,nativeTrade,localBusy,captureTiming,postgameActive,postgameYieldReady=false,emeraldActive}){
 let reason=null;
 if(game!=='firered')reason='This adapter has not qualified an in-session software handoff. Stop the game before updating.';
 else if(localBusy||!nativeTradeFinished(nativeTrade))reason='Waiting for the native trade and its saved completion.';
 else if(captureTiming||mission&&!['complete','archived'].includes(mission.status))reason='Waiting for the capture task to finish and save.';
 else if(postgameActive&&!postgameYieldReady||emeraldActive)reason='Waiting for the current linked or postgame transaction to finish.';
 else if(o?.phase!=='stable'||o.emulator?.mode!=='overworld'||o.emulator?.inBattle||Object.values(o.playerMemory?.ui??{}).some(Boolean))reason='Waiting for a stable field with no open menu or battle.';
 return {ready:reason===null,reason};
}
