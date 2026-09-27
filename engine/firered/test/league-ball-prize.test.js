import test from 'node:test';
import assert from 'node:assert/strict';
import {awardLeagueBalls} from '../src/suite/league-ball-prize.js';
const sizes=[3876,3968,3968,3968,3816,...Array(8).fill(3968),2000];
const checksum=(b,start,size)=>{let sum=0;for(let i=0;i<size;i+=4)sum=(sum+b.readUInt32LE(start+i))>>>0;return((sum>>>16)+(sum&65535))&65535;};
function fixture({league=true,counters=[8,9]}={}){
 const b=Buffer.alloc(0x20000,0x58),sections=[];
 for(let slot=0;slot<2;slot++){
  const map=[];
  for(let id=0;id<14;id++){const p=(slot*14+(id+slot+4)%14)*4096;map[id]=p;b.fill(0,p,p+3968);b.writeUInt16LE(id,p+4084);b.writeUInt32LE(0x08012025,p+4088);b.writeUInt32LE(counters[slot],p+4092);}
  b.writeUInt32LE(0x12345678,map[0]+3872);b.writeUInt32LE(0x80d11ff9,map[0]+10);
  if(league)b[map[2]+101]=0x10; // SB1 flags 0xee0 + flag 2092/8 = 4069.
  for(let i=0;i<13;i++){b.writeUInt16LE([1,2,5][i]??0,map[1]+1072+i*4);b.writeUInt16LE(([1,12,30][i]??0)^0x5678,map[1]+1074+i*4);}
  for(let id=0;id<14;id++)b.writeUInt16LE(checksum(b,map[id],sizes[id]),map[id]+4086);
  sections.push(map);
 }
 return {b,sections};
}
test('awards 999 of every ordinary ball and preserves Master and Safari stock',()=>{
 const {b,sections}=fixture(),before=Buffer.from(b);const result=awardLeagueBalls(b);
 const p=sections[1][1]+1072,bag=[];
 for(let i=0;i<13;i++)bag.push([result.sram.readUInt16LE(p+i*4),result.sram.readUInt16LE(p+i*4+2)^0x5678]);
 for(const id of [2,3,4,6,7,8,9,10,11,12])assert.deepEqual(bag.find(e=>e[0]===id),[id,999]);
 assert.deepEqual(bag.find(e=>e[0]===1),[1,1]);assert.deepEqual(bag.find(e=>e[0]===5),[5,30]);
 assert.deepEqual(b,before);assert.equal(result.receipt.leagueComplete,true);
 // Only the current slot's ball pocket and its checksum may differ.
 const normalized=Buffer.from(result.sram);before.copy(normalized,p,p,p+52);before.copy(normalized,sections[1][1]+4086,sections[1][1]+4086,sections[1][1]+4088);
 assert.deepEqual(normalized,before);
 assert.equal(result.sram.readUInt16LE(sections[1][1]+4086),checksum(result.sram,sections[1][1],3968));
 assert.deepEqual(awardLeagueBalls(result.sram).sram,result.sram);
});
test('refuses the prize before the League is complete',()=>{assert.throws(()=>awardLeagueBalls(fixture({league:false}).b),/League/);});
test('handles rotated sectors and the native save counter wrap',()=>{
 const {b,sections}=fixture({counters:[0xffffffff,0]});const {sram}=awardLeagueBalls(b);
 assert.equal(sram.readUInt16LE(sections[1][1]+1078)^0x5678,999);
 assert.equal(sram.readUInt16LE(sections[0][1]+1078)^0x5678,12);
});
test('rejects a damaged current save instead of awarding an older checkpoint',()=>{
 const {b,sections}=fixture();b[sections[1][5]+2]^=1;assert.throws(()=>awardLeagueBalls(b),/checksum|invalid/i);
});
test('rejects duplicate section ids and unsupported save sizes',()=>{
 const {b,sections}=fixture();b.writeUInt16LE(4,sections[1][5]+4084);assert.throws(()=>awardLeagueBalls(b),/section|invalid/i);
 assert.throws(()=>awardLeagueBalls(Buffer.alloc(32)),/size/);
});
