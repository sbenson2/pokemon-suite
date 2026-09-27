import {saveFireRedQuestMilestone} from './fire-red-link-quest.js';

export function finishPostgame(o,state,progress){
 const saving=state.finalSave?.linkSave&&!state.finalSave.nativeLinkSave;
 if(!progress.complete&&!saving){delete state.finalSave;delete state.completion;return null;}
 const result=saveFireRedQuestMilestone(o,state.finalSave??={},{flagId:2092,id:'postgame-final-save',label:'The completed FireRed adventure'});
 if(result.kind!=='ready')return result;
 if(!progress.complete){delete state.finalSave;delete state.completion;return null;}
 state.completion={schema:'pokemon-suite/postgame-completion/v1',...result.receipt,completed:progress.completed,total:progress.total};
 return {kind:'complete',receipt:state.completion};
}
