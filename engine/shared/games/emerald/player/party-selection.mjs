// Native party selection for Steven's Space Center multi battle.
export function inspectStevenPartySelection(o){
 if(o.player?.map.id!=='MAP_MOSSDEEP_CITY_SPACE_CENTER_2F'||o.menus.partyMenu?.menuType!==4||o.battle)return null;
 const wait={kind:'wait-for-steven-party',button:null};
 if(o.emulator.paletteFadeActive||!Array.isArray(o.menus.selectedPartyOrder))return wait;
 const candidates=o.party.map((p,index)=>({...p,index})).filter(p=>p.validity==='valid'&&!p.isEgg&&p.hp>0).sort((a,b)=>b.level-a.level||b.hp-a.hp).slice(0,3);
 if(!candidates.length)return {kind:'cancel-steven-party',button:'b'};
 const selected=o.menus.selectedPartyOrder.filter(n=>n>0),next=candidates.find(p=>!selected.includes(p.index+1));
 const slot=o.menus.partyMenu.slotId;
 if(o.hasTask('Task_HandleSelectionMenuInput')){
  if(!next||slot!==next.index)return {kind:'close-steven-selection-menu',button:'b'};
  return {kind:'enter-steven-party',button:o.menus.menuCursor===0?'a':'up'};
 }
 if(!o.hasTask('Task_HandleChooseMonInput'))return wait;
 const target=next?.index??6;
 return {kind:slot===target?(next?'select-steven-party':'confirm-steven-party'):'steven-party-cursor',button:slot===target?'a':slot<target?'down':'up',slot:target};
}
