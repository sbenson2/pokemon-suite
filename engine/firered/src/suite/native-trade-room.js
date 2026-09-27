// Read-only FireRed link-room and trade UI. Layouts come from the pinned
// overworld.h, ObjectEvent, and trade.c; all actions remain ordinary GBA inputs.
const directions=['up','down','left','right'];
const deltas=[[0,-1],[0,1],[-1,0],[1,0]];

export function readNativeMenuCursor(session,runtime){
 // The ROM also has a four-byte static sMenu in another translation unit.
 // menu.c owns the twelve-byte struct used by both membership and trade menus.
 const matches=Object.entries(runtime?.data?.symbols??{}).filter(([name,s])=>
  (name==='sMenu'||s.sourceName==='sMenu')&&s.size===12);
 if(matches.length!==1)return undefined;
 return session.readMemory(matches[0][1].address,12)[2];
}

export function readNativeTradeUi(session,runtime){
 const symbols=runtime?.data?.symbols??{},result={};
 const read=name=>{const s=symbols[name];return s?session.readMemory(s.address,s.size):null;};
 const word=b=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(0,true);
 const local=read('gLocalLinkPlayerId')?.[0],links=read('gLinkPlayerObjectEvents'),objects=read('gObjectEvents'),states=read('sPlayerLinkStates');
 if(local<2&&links?.length===16&&objects?.length===576&&states?.length===4){
  const players=[];
  for(let id=0;id<2;id++){
   const offset=id*4,obj=links[offset+2];
   if(links[offset]!==1||links[offset+1]!==id||obj>=16||!(objects[obj*36]&1))continue;
   const view=new DataView(objects.buffer,objects.byteOffset+obj*36,36);
   players.push({id,position:{x:view.getInt16(16,true)-7,y:view.getInt16(18,true)-7},movementMode:links[offset+3],linkState:states[id]});
  }
  const player=players.find(p=>p.id===local);
  if(player)result.room={localPlayer:local,...player,players};
 }
 const main=read('gMain'),pointer=read('sTradeMenu');
 if(main&&pointer&&symbols.CB2_TradeMenu&&(word(main.subarray(4,8))&~1)===(symbols.CB2_TradeMenu.address&~1)){
  const address=word(pointer);
  if(address>=0x02000000&&address+128<=0x02040000){
   const b=session.readMemory(address,128),table=read('sCursorMoveDestinations');
   if(b[53]<=12&&b[54]>=1&&b[54]<=6&&b[55]>=1&&b[55]<=6&&table?.length===312){
    const neighbors=Array.from({length:13},(_,cursor)=>directions.map((_,dir)=>
     Array.from(table.subarray((cursor*4+dir)*6,(cursor*4+dir+1)*6)).find(n=>n<13&&b[56+n]===1)??0));
    result.tradeMenu={cursor:b[53],partyCount:b[54],callback:b[111],menuCursor:readNativeMenuCursor(session,runtime),
     drawStates:[b[116],b[117]],selectedSlot:b[118],partnerSlot:b[119],neighbors};
   }
  }
 }
 return result;
}

function firstDirection(start,target,next){
 const queue=[{node:start,first:null}],seen=new Set([start]);
 for(let i=0;i<queue.length;i++){
  const {node,first}=queue[i];
  for(const [direction,destination] of next(node)){
   if(seen.has(destination))continue;
   const step=first??direction;if(destination===target)return step;
   seen.add(destination);queue.push({node:destination,first:step});
  }
 }
 return null;
}

export function inspectNativeTradeExit(o,wireless,world){
 const wait={kind:'wait',phase:'leaving-trade'},menu=wireless.tradeMenu;
 const input=button=>({kind:'input',phase:'leaving-trade',action:{buttons:[button],holdFrames:3,releaseFrames:30}});
 // Direct Corner's leader task owns input before the link room exists.
 // union_room.c: B leaves AWAIT_PLAYERS, declines a pending member, or
 // backs out of member confirmation; CANCEL_PROMPT_HANDLE_INPUT needs Yes.
 const leader=wireless.leader;
 if(o.emulator?.callback2==='CB2_Overworld'&&leader){
  if(leader.state===6)return input('b');
  if([11,16].includes(leader.state)&&leader.textState===1)return input('b');
  if(leader.state===20&&leader.textState===1&&[0,1].includes(leader.cursor))return input(leader.cursor===0?'a':'up');
  return wait;
 }
 // Cancelling leader setup returns to JOIN GROUP / BECOME LEADER / EXIT.
 // B closes that native attendant menu instead of starting another lobby.
 const role=o.playerMemory?.ui?.choiceMenu;
 if(o.emulator?.callback2==='CB2_Overworld'&&/_POKEMON_CENTER_2F$/.test(o.playerMemory?.map?.id??'')&&
    o.playerMemory.scripts?.fieldControlsLocked&&role?.minCursor===0&&role.maxCursor===2&&wireless.remotePlayers===0)return input('b');
 // Acknowledge both the partner-leaving page and the attendant's return
 // scene. The controller retains ownership until field controls release.
 const stage=o.playerMemory.ui?.fieldDialog?.stage;
 const waitingForButton=['awaiting-page','awaiting-input'].includes(stage)||stage==='awaiting-close'&&o.playerMemory.scripts?.globalNative==='WaitForAorBPress';
 if(o.emulator?.callback2==='CB2_Overworld'&&o.playerMemory.scripts?.fieldControlsLocked&&waitingForButton&&!o.playerMemory.ui?.choiceMenu)return input('a');
 if(o.emulator?.callback2==='CB2_Overworld'&&o.playerMemory?.map?.id==='MAP_TRADE_CENTER'){
  const room=wireless.room,map=world?.data?.maps?.find(m=>m.id==='MAP_TRADE_CENTER');
  if(!room||!map)return wait;
  const target=map.warpEvents?.[room.localPlayer];if(!target)return wait;
  if(room.position.x===target.x&&room.position.y===target.y){
   // The south-arrow warp owns TradeCenter_ConfirmLeaveRoom's Yes/No.
   const choice=o.playerMemory.ui?.choiceMenu;
   if(choice?.minCursor===0&&choice.maxCursor===1&&[0,1].includes(choice.cursor))return input(choice.cursor===0?'a':'up');
   if(room.movementMode!==1&&room.linkState===0x80&&!o.playerMemory.scripts?.fieldControlsLocked)return input('down');
   return wait;
  }
  if(room.movementMode===1||room.linkState!==0x80||o.playerMemory.scripts?.fieldControlsLocked)return wait;
  const direction=roomDirection(room,map,target);return direction?input(direction):wait;
 }
 if(o.emulator?.callback2!=='CB2_TradeMenu'||!menu)return wait;
 if([1,3].includes(menu.callback))return input('b');
 if(menu.callback===0){
  if(menu.cursor===12)return input('a');
  const direction=firstDirection(menu.cursor,12,cursor=>(menu.neighbors[cursor]??[]).map((n,d)=>[directions[d],n]));
  return direction?input(direction):wait;
 }
 // Once the exchange is saved, Cancel is the ROM's normal "stop trading"
 // operation. Both games must agree; keep the radio running while waiting.
 if(menu.callback===4&&[0,1].includes(menu.menuCursor))return input(menu.menuCursor===0?'a':'up');
 if(menu.callback===8)return input('a');
 return wait;
}

function roomDirection(room,map,target){
 const key=p=>`${p.x},${p.y}`,start=key(room.position),goal=key(target);
 const occupied=new Set([...(room.players??[]).filter(p=>p.id!==room.localPlayer).map(p=>key(p.position)),...(map.objectEvents??[]).map(key)]);
 const walkable=new Set((map.layout?.cells??[]).filter(c=>c.collision===0&&!occupied.has(key(c))).map(key));
 for(const seat of map.coordEvents??[])if(key(seat)!==goal)walkable.delete(key(seat));
 for(const warp of map.warpEvents??[])if(key(warp)!==start&&key(warp)!==goal)walkable.delete(key(warp));
 return firstDirection(start,goal,node=>{const [x,y]=node.split(',').map(Number);return deltas.map(([dx,dy],i)=>[directions[i],`${x+dx},${y+dy}`]).filter(([,dest])=>walkable.has(dest));});
}

export function inspectNativeTradeRoom(o,wireless,world,slot){
 const wait=phase=>({kind:'wait',phase});
 const input=(button,phase)=>({kind:'input',phase,action:{buttons:[button],holdFrames:3,releaseFrames:30}});
 const stop=reason=>({kind:'stop',phase:'trade-menu-unavailable',reason});
 const menu=wireless.tradeMenu;
 if(o.emulator?.callback2==='CB2_TradeMenu'){
  if(!menu)return wait('reading-trade-menu');
  if(slot<0||slot>=menu.partyCount)return stop('The prepared Pokémon is absent from the native trade menu.');
  if(menu.callback===0){
   if(menu.cursor===slot)return input('a','selecting-pokemon');
   const direction=firstDirection(menu.cursor,slot,cursor=>(menu.neighbors[cursor]??[]).map((n,d)=>[directions[d],n]));
   return direction?input(direction,'selecting-pokemon'):stop('The native trade cursor cannot reach the prepared Pokémon.');
  }
  if(menu.callback===1){
   if(menu.cursor!==slot)return input('b','selecting-pokemon');
   return [0,1].includes(menu.menuCursor)?input(menu.menuCursor===1?'a':'down','offering-pokemon'):wait('offering-pokemon');
  }
  if(menu.callback===3){
   if(menu.cursor!==slot||menu.selectedSlot!==slot)return stop('The native confirmation selected another Pokémon.');
   if(menu.partnerSlot<6||menu.partnerSlot>=12||menu.drawStates?.some(n=>n!==5))return wait('confirming-trade');
   return [0,1].includes(menu.menuCursor)?input(menu.menuCursor===0?'a':'up','confirming-trade'):wait('confirming-trade');
  }
  if(menu.callback===4)return input('b','selecting-pokemon'); // No to cancel-room prompt
  if(menu.callback===8)return input('a','selecting-pokemon'); // Native canceled/error message
  return wait('waiting-for-trade');
 }
 if(o.emulator?.callback2!=='CB2_Overworld')return wait('entering-trade-menu');
 const room=wireless.room,map=world?.data?.maps?.find(m=>m.id==='MAP_TRADE_CENTER');
 if(!room||!map)return wait('reading-trade-room');
 const target=map.coordEvents?.find(e=>[`TradeCenter_EventScript_Chair${room.localPlayer}`,`EventScript_TradeCenter_Chair${room.localPlayer}`].includes(e.script));
 if(!target)return stop('This game has no verified trade seat for its local player.');
 if(room.position.x===target.x&&room.position.y===target.y)return wait('waiting-at-seat');
 if(room.movementMode===1||room.linkState!==0x80||o.playerMemory?.scripts?.fieldControlsLocked)return wait('walking-to-seat');
 const direction=roomDirection(room,map,target);
 return direction?input(direction,'walking-to-seat'):wait('waiting-for-clear-path');
}
