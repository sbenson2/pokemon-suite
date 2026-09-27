import test from 'node:test';
import assert from 'node:assert/strict';

test('Emerald leader discovery reads its active group task and native list position',async()=>{
 const {readEmeraldNativeGroup}=await import('../src/suite/emerald-native-trade.js');
 const symbols={gTasks:{address:0x03001000},Task_TryJoinLinkGroup:{address:0x08010000},sWirelessLinkMain:{address:0x02000000}};
 const memory=new Uint8Array(0x10000),views=new Map();
 const block=(address,size)=>{const b=memory.subarray(views.size*1024,views.size*1024+size);views.set(address,b);return b;};
 const word=(b,i,n)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(i,n,true);
 const tasks=block(symbols.gTasks.address,640),pointer=block(0x02000000,4),players=block(0x02002000,512);
 tasks[4]=1;word(tasks,0,0x08010001);word(pointer,0,0x03001008);word(tasks,8,0x02002000);tasks[16]=3;tasks[22]=1;
 tasks[44]=1;const list=new DataView(tasks.buffer,tasks.byteOffset+48,32);list.setUint16(24,2,true);list.setUint16(26,1,true);
 const p=new DataView(players.buffer,players.byteOffset+32,32);p.setUint16(0,(4<<10)|128,true);p.setUint16(2,123,true);players[32+10]=4;players[32+26]=1;
 const session={readMemory(address,size){const b=views.get(address);assert.ok(b&&b.length===size,`${address.toString(16)} ${size}`);return b;}};
 const group=readEmeraldNativeGroup(session,symbols);assert.equal(group.state,3);assert.equal(group.cursor,3);assert.deepEqual(group.leaders.filter(p=>p.active),[{index:1,trainerId:123,version:4,active:true}]);
 tasks[4]=0;assert.equal(readEmeraldNativeGroup(session,symbols),null);
});

test('packaged native trading reads the configured private adapter data rather than a development vendor folder',async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const root=mkdtempSync(join(tmpdir(),'emerald-private-adapter-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'pokeemerald-symbols'));
 const names={gTasks:640,gRfu:3316,gObjectEvents:576,gLinkPlayers:140,gEnemyParty:600,gMain:1084,sMenu:12,sWirelessLinkMain:4,sCursorMoveDestinations:312,Task_TryJoinLinkGroup:2,SaveGameTask:2,CB2_SaveAndEndWirelessTrade:2,CB2_TradeMenu:2,gSaveBlock1Ptr:4,gSaveBlock2Ptr:4,gReceivedRemoteLinkPlayers:1,gWirelessCommType:1};
 writeFileSync(join(root,'pokeemerald-symbols/pokeemerald.sym'),Object.entries(names).map(([n,size],i)=>(0x02000100+i*0x1000).toString(16).padStart(8,'0')+' g '+size.toString(16).padStart(8,'0')+' '+n).join('\n'));
 const module=new URL('../src/suite/emerald-native-trade.js',import.meta.url).href;
 const script=`import {createEmeraldNativeTradeAdapter} from ${JSON.stringify(module)};const a=await createEmeraldNativeTradeAdapter({researchBots:'/no-development-source',runtime:{constants:{maps:{byId:new Map()}},world:{},session:{}}});console.log(a.nativeRuntime.data.symbols.gTasks.address);`;
 const result=execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,POKEMON_SUITE_ADAPTER_DATA:root},encoding:'utf8'});
 assert.equal(Number(result.trim()),0x02000100);
});
