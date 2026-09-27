// main_menu.c: type0 has no save; saved-game menus put Continue at index0.
export function inspectNativeContinue(o){
 if(o.hasTask('Task_Hof_ExitOnKeyPressed'))return o.emulator.paletteFadeActive?{kind:'wait'}:{kind:'input',button:'a'};
 if(o.hasTask('Task_TitleScreenPhase3'))return {kind:'continue-title',button:'start'};
 const menu=o.emulator.mode==='main-menu'?o.task('Task_HandleMainMenuInput'):null;
 if(menu){
  if(o.emulator.paletteFadeActive)return {kind:'continue-settle'};
  if(menu.data[0]<1||menu.data[0]>3)return {kind:'stop',reason:'The native menu has no verified Continue entry. The existing game has not been replaced.'};
  return {kind:'continue-save',button:menu.data[1]===0?'a':'up'};
 }
 return o.emulator.mode==='main-menu'?{kind:'continue-settle'}:null;
}
