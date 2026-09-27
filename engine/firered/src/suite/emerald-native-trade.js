// Emerald's native Direct Corner observer. All structures are read-only and
// come from the pinned cartridge's union_room.h, list_menu.h and trade.c.
import {readAdapterFile} from '../../../shared/shared/adapter-resources.mjs';
import {createHash} from 'node:crypto';
import {readNativeWirelessStatus,readNativeLinkGroup} from './native-trade-host.js';
import {decodeBoxPokemonRecord} from '../evidence/pokemon-record.js';

// The group reader is shared with the FireRed guest; the layouts are identical.
export const readEmeraldNativeGroup=readNativeLinkGroup;

export async function createEmeraldNativeTradeAdapter({runtime,researchBots}){
 const text=await readAdapterFile('pokeemerald-symbols/pokeemerald.sym');
 const symbols={},names=new Map();
 for(const match of text.matchAll(/^([\da-f]{8})\s+[lg]\s+([\da-f]{8})\s+(\S+)$/gm)){
  const address=parseInt(match[1],16),size=parseInt(match[2],16),name=match[3];
  if(name==='sMenu'&&size!==12)continue;
  symbols[name]={address,size};if(address>=0x08000000)names.set(address&~1,name);
 }
 for(const [name,size] of Object.entries({gTasks:640,gRfu:3316,gObjectEvents:576,gLinkPlayers:140,gEnemyParty:600,gMain:1084,sMenu:12,sWirelessLinkMain:4,sCursorMoveDestinations:312})){
  if(symbols[name]?.size!==size)throw Error(`The pinned Emerald ${name} layout is unavailable.`);
 }
 for(const name of ['Task_TryJoinLinkGroup','SaveGameTask','CB2_SaveAndEndWirelessTrade','CB2_TradeMenu','gSaveBlock1Ptr','gSaveBlock2Ptr','gReceivedRemoteLinkPlayers','gWirelessCommType'])if(!symbols[name])throw Error(`Missing Emerald trade symbol: ${name}`);
 const nativeRuntime={data:{symbols,structures:{SaveBlock1:{fields:{gameStats:{offset:0x159c}}},SaveBlock2:{fields:{encryptionKey:{offset:0xac}}}}}};
 const maps=[];
 for(const entry of runtime.constants.maps.byId.values())if(entry.id==='MAP_TRADE_CENTER'||entry.id.endsWith('POKEMON_CENTER_2F')){
  const geometry=runtime.world.geometry(entry.group,entry.number),cells=[];
  for(let y=0;y<geometry.height;y++)for(let x=0;x<geometry.width;x++)cells.push({x,y,...runtime.world.tile(geometry,x,y)});
  maps.push({id:entry.id,objectEvents:entry.objects,warpEvents:geometry.warps,coordEvents:entry.coordEvents,layout:{cells}});
 }
 const session=runtime.session;
 return {
  nativeRuntime,world:{data:{maps}},
  wireless(){return {...readNativeWirelessStatus(session,nativeRuntime),guest:readEmeraldNativeGroup(session,symbols)};},
  capture(){
   const o=runtime.observe(),callback2=names.get(o.emulator.callback2&~1)??o.emulator.callback2Name,choice=o.menus.multichoice;
   const enemy=session.readMemory(symbols.gEnemyParty.address,600);
   return {frame:o.frame,phase:!o.emulator.paletteFadeActive&&o.emulator.mode==='overworld'?'stable':'transition',emulator:{...o.emulator,callback2,mainState:o.emulator.state},sram:{sha256:createHash('sha256').update(session.saveSram()).digest('hex')},
    native:o,playerMemory:{map:o.player?.map,position:o.player?.position,trainer:{partyValidity:o.party.length&&o.party.every(p=>p.validity==='valid')?'valid':'unknown',party:o.party},gameStats:{savedGame:o.nativeSave.gameStat},
     partnerParty:Array.from({length:6},(_,i)=>decodeBoxPokemonRecord(enemy,i*100)),
     ui:{fieldDialog:o.script.textPrinterActive?{stage:'awaiting-page'}:null,choiceMenu:choice?.active?{minCursor:choice.min,maxCursor:choice.max,cursor:choice.cursor}:o.menus.yesNoActive?{minCursor:0,maxCursor:1,cursor:o.menus.menuCursor}:null},
     activeTasks:o.tasks.map(t=>({function:names.get(t.func&~1)??t.name,data:t.data})),scripts:{fieldControlsLocked:o.script.fieldControlsLocked}}};
  },
 };
}
