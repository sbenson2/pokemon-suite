import test from 'node:test';
import assert from 'node:assert/strict';
import {readPostgameEvidence} from '../src/suite/postgame-agenda.js';

// These 64 bytes are the native SaveBlock1 region before and after the
// Indigo Plateau Black Belt's Agatha script in retained, ROM-verified saves.
const before='4a000000000000000a0000000a0000001a0000000a0000000a000000320000000a0000000e0000000e000000460000000e000000060000000a00000026000000';
const after='4a000000000000000a0000000a0000001a0000000a0000000a000000320000000a0000000e0000000e0000005e0000000e000000060000000a00000026000000';
const observation={phase:'stable',emulator:{callback2:'CB2_Overworld'},playerMemory:{trainer:{partyValidity:'unknown'}}};
const runtime={data:{symbols:{gSaveBlock1Ptr:{address:1},gSaveBlock2Ptr:{address:2}},structures:{
 SaveBlock1:{fields:{roamer:{offset:0},trainerTower:{offset:40},fameChecker:{offset:100}}},
 SaveBlock2:{fields:{encryptionKey:{offset:4}}}
}}};

function memory(hex,{truncate=false}={}){
 const b1=Buffer.alloc(200),b2=Buffer.alloc(16);
 Buffer.from(hex,'hex').copy(b1,100);
 const ptr=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
 return {readMemory(address,length){
  if(address===1)return ptr(1000);
  if(address===2)return ptr(2000);
  if(address>=2000)return b2.subarray(address-2000,address-2000+length);
  const actual=truncate&&address===1100?Math.min(length,32):length;
  return b1.subarray(address-1000,address-1000+actual);
 }};
}

test('native Fame evidence reads all 16 four-byte records and observes Agatha progression',()=>{
 const initial=readPostgameEvidence(memory(before),runtime,observation).fameChecker;
 assert.deepEqual(initial.map(p=>p.entries),[18,0,2,2,6,2,2,12,2,3,3,17,3,1,2,9]);
 const progressed=readPostgameEvidence(memory(after),runtime,observation).fameChecker;
 assert.deepEqual(progressed.map(p=>p.entries),[18,0,2,2,6,2,2,12,2,3,3,23,3,1,2,9]);
});

test('a truncated native Fame region leaves completion evidence unknown',()=>{
 assert.equal(readPostgameEvidence(memory(after,{truncate:true}),runtime,observation).fameChecker,null);
});
