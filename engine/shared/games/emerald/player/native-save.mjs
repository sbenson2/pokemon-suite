const partyKey=o=>JSON.stringify(o.party.map(p=>[p.species,p.personality,p.otId,...['hp','attack','defense','speed','spAttack','spDefense'].map(k=>p.ivs[k])]));
export function createNativeSave({observation:o,state=null,emptyFlash=false}){
 if(!state&&(!o.fieldReady||!o.party.length||o.party.some(p=>p.validity!=='valid')||!Number.isInteger(o.nativeSave?.gameStat)))throw Error('A native save must begin from a stable, verified party.');
 const s=state?structuredClone(state):{startedFrame:o.frame,party:partyKey(o),counter:o.nativeSave.counter,gameStat:o.nativeSave.gameStat,emptyFlash:emptyFlash&&o.nativeSave.fileStatus===0,sawSuccess:false,verified:false};
 const stop=reason=>{s.reason=reason;return {kind:'stop',reason};};
 const input=(button,o)=>{s.press={button,holdUntil:o.frame+2,releaseUntil:o.frame+12};return {kind:'input',buttons:[button]};};
 return {
  state:()=>structuredClone(s),
  next(o){
   if(s.verified)return {kind:'complete'};
   if(s.reason)return {kind:'stop',reason:s.reason};
   if(o.emulator.paletteFadeActive)return {kind:'input',buttons:[]};
   if(o.party.some(p=>p.validity!=='valid'))return {kind:'input',buttons:[]};
   if(partyKey(o)!==s.party)return stop('The party changed during native saving; the game is preserved.');
   const save=o.nativeSave;
   if(save?.differentFile&&!(s.emptyFlash&&save.fileStatus===0))return stop('The cartridge reported a different native save file; it was not overwritten.');
   if(save?.active&&['SaveErrorCallback','SaveReturnErrorCallback'].includes(save.callback))return stop('The cartridge reported a native save error.');
   if(save?.active&&['SaveSuccessCallback','SaveReturnSuccessCallback'].includes(save.callback)&&save.gameStat===s.gameStat+1)s.sawSuccess=true;
   if(s.sawSuccess&&o.fieldReady&&save.counter===((s.counter+1)>>>0)&&save.gameStat===s.gameStat+1){s.verified=true;s.savedFrame=o.frame;s.savedCounter=save.counter;return {kind:'complete'};}
   if(o.frame-s.startedFrame>3600)return stop('The native save did not finish within its verification window.');
   if(s.press&&o.frame<s.press.releaseUntil)return {kind:'input',buttons:o.frame<s.press.holdUntil?[s.press.button]:[]};
   if(o.menus.startMenu){
    const index=o.menus.startMenu.actions.indexOf(5);
    if(index<0)return stop('The native start menu has no SAVE action.');
    const cursor=o.menus.startMenu.cursor;return input(cursor===index?'a':cursor<index?'down':'up',o);
   }
   if(save?.active){
    if(['SaveConfirmInputCallback','SaveOverwriteInputCallback'].includes(save.callback))return input(o.menus.menuCursor===0?'a':'up',o);
    return input('a',o);
   }
   return o.fieldReady?input('start',o):{kind:'input',buttons:[]};
  },
 };
}
