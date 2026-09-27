const HM_MOVES=new Set([15,19,57,70,148,249,127,291]);
const input=button=>({kind:'input',button});
const wait=()=>({kind:'wait'});
const stop=reason=>({kind:'stop',reason});

// Bag/party inputs only. Completion comes from the cartridge's taught move.
export function inspectNativePartyItem(o,intent){
 if(o.emulator.paletteFadeActive||o.emulator.mode==='transition')return wait();
 if(o.emulator.mode==='evolution'){
  // EVOSTATE_TRY_LEARN_MOVE waits for the congratulatory text printer. A
  // advances that native message; B would cancel an earlier evolution phase.
  const evolved=o.party.find(p=>p.validity==='valid'&&p.personality===intent.personality&&p.otId===intent.otId&&p.species===intent.targetSpecies);
  return intent.kind==='level-up'&&evolved?input('a'):wait();
 }
 const slots=o.party.map((p,i)=>({p,i})).filter(({p})=>p.validity==='valid'&&p.personality===intent.personality&&p.otId===intent.otId);
 if(slots.length!==1)return stop('The native item recipient is missing or ambiguous.');
 const {p,i}=slots[0],menus=o.menus,mode=o.emulator.mode;
 const restoring=intent.kind==='restore',leveling=intent.kind==='level-up',move=intent.restoreMoveId&&p.moves.find(m=>m.id===intent.restoreMoveId);
 const leveled=leveling&&p.level>intent.before.level;
 const improved=leveling?leveled&&p.species===intent.targetSpecies:restoring?(intent.restoreMoveId?move?.pp>intent.before.pp:p.hp>intent.before.hp||intent.before.status&&p.status===0):p.moves.some(m=>m.id===intent.moveId);
 if(leveled&&o.fieldReady&&!improved)return stop('The native level-up did not produce the requested evolution. The Pokémon is preserved.');
 if(improved)return o.fieldReady?{kind:'complete'}:input('b');
 if(mode==='berry-tag')return input('b');
 if(restoring&&o.hasTask('Task_HandleWhichMoveInput')){
  const slot=p.moves.findIndex(m=>m.id===intent.restoreMoveId);
  if(menus.partyMenu.slotId!==i||slot<0)return stop('The native PP recovery recipient or move changed.');
  return input(menus.menuCursor===slot?'a':menus.menuCursor<slot?'down':'up');
 }
 if(o.hasTask('Task_HandleReplaceMoveInput')){
  const summary=menus.summaryScreen;
  if(summary?.curMonIndex!==i||(!leveling&&summary.newMove!==intent.moveId))return stop('The native move-learning recipient or move changed.');
  const choices=p.moves.map((m,index)=>({m,index})).filter(({m})=>!HM_MOVES.has(m.id)).sort((a,b)=>(a.m.power??0)-(b.m.power??0));
  if(!choices.length)return stop('The recipient has no replaceable move; its existing HMs must be retained.');
  const slot=choices[0].index;return input(summary.cursor===slot?'a':summary.cursor<slot?'down':'up');
 }
 if(menus.yesNoActive)return input(menus.menuCursor===0?'a':'up');
 if(mode==='party-menu'){
  if(o.hasTask('Task_HandleChooseMonInput')){
   const cursor=menus.partyMenu.slotId;
   return input(cursor===i?'a':i===0?'left':cursor===0?'right':cursor<i?'down':'up');
  }
  return input('a'); // item and move-learning messages, with bounded cadence
 }
 if(mode==='bag'){
  if(o.hasTask('Task_BagMenu_HandleInput')){
   const pocket=menus.bag.pocket;
   const targetPocket=leveling?0:restoring?(intent.pocket==='berries'?3:0):2,pocketName=leveling?'items':restoring?intent.pocket:'tmhm';
   if(pocket!==targetPocket)return input((targetPocket-pocket+5)%5<=2?'right':'left');
   const index=(o.bag[pocketName]??[]).findIndex(item=>item.itemId===intent.itemId&&item.quantity>0);
   if(index<0)return stop('The required item is absent from the native bag.');
   const cursor=menus.bag.cursor[targetPocket]+menus.bag.scroll[targetPocket];
   return input(cursor===index?'a':cursor<index?'down':'up');
  }
  if(o.hasTask('Task_ItemContext_SingleRow')||o.hasTask('Task_ItemContext_MultipleRows')){
   if(menus.bag.selectedItemId!==intent.itemId)return input('b');
   // Berries place CHECK TAG at 0, a blank at 1, and USE at 2.
   // Multi-row contexts move vertically by two positions.
   const target=restoring&&intent.pocket==='berries'?2:0,cursor=menus.menuCursor;
   if(cursor===target)return input('a');
   return input(cursor%2?'left':cursor<target?'down':'up');
  }
  return input('a'); // boot-up and contained-move message / confirmation
 }
 if(menus.startMenu){
  const index=menus.startMenu.actions.indexOf(2); // MENU_ACTION_BAG
  if(index<0)return stop('The native start menu has no bag action.');
  return input(menus.startMenu.cursor===index?'a':menus.startMenu.cursor<index?'down':'up');
 }
 return o.fieldReady?input('start'):wait();
}
