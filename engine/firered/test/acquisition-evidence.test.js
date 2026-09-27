import test from 'node:test';
import assert from 'node:assert/strict';
import * as evidence from '../src/suite/postgame-agenda.js';
import {readAcquisitionEvidence} from '../src/suite/acquisition-evidence.js';
const fixture=()=>{
 const b1=Buffer.alloc(0x4000),b2=Buffer.alloc(0x1000),tasks=Buffer.alloc(640),slots=Buffer.alloc(32),control=Buffer.alloc(256);
 const base=0x02000000;control.writeUInt32LE(base);control.writeUInt32LE(base+0x4000,4);control.writeUInt32LE(base+0x6000,8);
 b2.writeUInt32LE(0x1234,16);b1.writeUInt16LE(9950^0x1234,20);
 const runtime={symbols:{gSaveBlock1Ptr:{address:0x03000000},gSaveBlock2Ptr:{address:0x03000004},sSlotMachineState:{address:0x03000008},gTasks:{address:base+0x5000},MainTask_SlotsGameLoop:{address:0x08010000},Task_HandleDaycareLevelMenuInput:{address:0x08020000},ListMenuDummyTask:{address:0x08030000}},structures:{SaveBlock1:{fields:{coins:{offset:20},daycare:{offset:100}}},SaveBlock2:{fields:{encryptionKey:{offset:16}}}}};
 const memory=[[base,b1],[base+0x4000,b2],[base+0x5000,tasks],[base+0x6000,slots],[0x03000000,control]];
 return {b1,tasks,slots,runtime,session:{readMemory(a,n){const range=memory.find(([start,b])=>a>=start&&a+n<=start+b.length);return range?range[1].subarray(a-range[0],a-range[0]+n):Buffer.alloc(n);}}};
};
test('acquisition evidence decrypts coins and reads only active native slot tasks during transitions',()=>{
 const f=fixture();f.tasks.writeUInt32LE(0x08010001,0);f.tasks[4]=1;f.tasks.writeUInt16LE(3,8);f.slots.writeUInt16LE(1,14);
 const o={phase:'transition',emulator:{callback2:'CB2_RunSlotMachine'}};
 const a=evidence.readPostgameEvidence(f.session,f.runtime,o)?.acquisition;
 assert.equal(a?.coins,9950);assert.deepEqual(a?.slots,{task:'MainTask_SlotsGameLoop',stage:3,bet:1});
 f.tasks[4]=0;assert.equal(evidence.readPostgameEvidence(f.session,f.runtime,o)?.acquisition.slots,null);
});
test('daycare evidence owns its actual list cursor and rejects truncated or unverified task pointers',()=>{
 const f=fixture();f.tasks.writeUInt32LE(0x08020001,0);f.tasks[4]=1;f.tasks.writeUInt16LE(2,8);
 f.tasks.writeUInt32LE(0x08030001,80);f.tasks[84]=1;f.tasks.writeUInt16LE(1,80+8+24);f.tasks.writeUInt16LE(0,80+8+26);
 const a=readAcquisitionEvidence(f.session,f.runtime,{phase:'transition'});
 assert.equal(a?.daycare?.validity,'valid');assert.equal(a.daycare.parents.length,0);assert.equal(a.daycare.menuCursor,1);
 f.tasks[84]=0;assert.equal(readAcquisitionEvidence(f.session,f.runtime,{phase:'transition'}).daycare.menuCursor,null);
});

test('daycare text pointers retain odd byte addresses rather than treating text as Thumb code',()=>{
 const f=fixture();f.runtime.symbols.sGlobalScriptContext={address:0x03000000};f.runtime.symbols.DayCare_Text_WouldYouLikeUsToRaiseMon={address:0x08100003};
 const original=f.session.readMemory;f.session.readMemory=(a,n)=>{if(a===0x03000064){const b=Buffer.alloc(4);b.writeUInt32LE(0x08100003);return b;}return original(a,n);};
 assert.equal(readAcquisitionEvidence(f.session,f.runtime,{phase:'transition'}).prompt,'DayCare_Text_WouldYouLikeUsToRaiseMon');
});

test('ordinary loading frames do not advertise incomplete postgame evidence',()=>{
 const f=fixture();
 assert.equal(evidence.readPostgameEvidence(f.session,f.runtime,{phase:'transition',emulator:{callback2:'CB2_LoadMap'}}),null);
});

test('the verified daycare withdrawal list remains readable while its script owns a transition',()=>{
 const f=fixture();f.tasks.writeUInt32LE(0x08020001,0);f.tasks[4]=1;f.tasks.writeUInt16LE(2,8);
 f.tasks.writeUInt32LE(0x08030001,80);f.tasks[84]=1;f.tasks.writeUInt16LE(1,80+8+24);
 const o={phase:'transition',emulator:{callback2:'CB2_Overworld'},playerMemory:{ui:{}}};
 assert.equal(evidence.readPostgameEvidence(f.session,f.runtime,o)?.acquisition.daycare.menuCursor,1);
 f.tasks[84]=0;assert.equal(evidence.readPostgameEvidence(f.session,f.runtime,o),null,'an unverified menu must not advertise ordinary field evidence');
});

test('daycare evidence reads the held Egg personality that gates the native pending-Egg rolls',()=>{
 // DayCare: two 140-byte DaycareMon records, then u16 offspringPersonality (daycare.c rolls only while it is 0).
 const f=fixture();
 assert.equal(readAcquisitionEvidence(f.session,f.runtime,{phase:'transition'}).daycare.offspringPersonality,0);
 f.b1.writeUInt16LE(0xbeef,100+280);
 assert.equal(readAcquisitionEvidence(f.session,f.runtime,{phase:'transition'}).daycare.offspringPersonality,0xbeef);
});
