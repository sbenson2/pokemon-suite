// Explicit user-authorized FireRed League prize; never part of normal catching.
// FRLG save.c/global.h: 14 rotating 4 KiB sectors, encrypted bag quantities,
// 13 ball slots, and AddBagItem's maximum stack of 999. Safari stock is separate.
import {digest} from './save-vault.js';
const SECTOR=4096,DATA=3968,SIGNATURE=0x08012025;
const SIZES=[3876,3968,3968,3968,3816,...Array(8).fill(3968),2000];
const BALLS=[2,3,4,6,7,8,9,10,11,12];
function checksum(bytes,start,size){
 let sum=0;for(let i=0;i<size;i+=4)sum=(sum+bytes.readUInt32LE(start+i))>>>0;
 return ((sum>>>16)+(sum&65535))&65535;
}
export function awardLeagueBalls(input){
 const before=Buffer.from(input);
 if(before.length!==0x20000)throw Error('Unsupported FireRed save size.');
 const candidates=[];
 for(let slot=0;slot<2;slot++){
  const sectors=Array.from({length:14},(_,i)=>(slot*14+i)*SECTOR);
  const signed=sectors.filter(p=>before.readUInt32LE(p+4088)===SIGNATURE);
  if(!signed.length)continue;
  const counter=before.readUInt32LE(signed[0]+4092);
  candidates.push({slot,counter,sectors});
 }
 if(!candidates.length)throw Error('No valid FireRed save section headers.');
 const current=candidates.reduce((a,b)=>((b.counter-a.counter)|0)>0?b:a),sections=[];
 for(const p of current.sectors){
  const id=before.readUInt16LE(p+4084);
  if(id>=14||sections[id]!==undefined||before.readUInt32LE(p+4088)!==SIGNATURE||before.readUInt32LE(p+4092)!==current.counter)throw Error('Invalid current save sections.');
  if(checksum(before,p,SIZES[id])!==before.readUInt16LE(p+4086))throw Error('Current FireRed save checksum is invalid.');
  sections[id]=p;
 }
 const sb1=offset=>sections[1+Math.floor(offset/DATA)]+offset%DATA;
 const leagueFlag=3808+Math.floor(2092/8);
 if(!(before[sb1(leagueFlag)]&(1<<(2092%8))))throw Error('Complete the League before claiming this prize.');
 const encryption=before.readUInt32LE(sections[0]+3872)&65535,pocket=sb1(1072),bag=[];
 for(let slot=0;slot<13;slot++){
  const itemId=before.readUInt16LE(pocket+slot*4),quantity=before.readUInt16LE(pocket+slot*4+2)^encryption;
  if(itemId>12||quantity>999||itemId&&bag.some(b=>b.itemId===itemId))throw Error('Invalid FireRed ball pocket.');
  bag.push({slot,itemId,quantity});
 }
 const sram=Buffer.from(before),changes=[];
 for(const itemId of BALLS){
  const entry=bag.find(b=>b.itemId===itemId)??bag.find(b=>b.itemId===0);
  if(!entry)throw Error('The ball pocket has no free slot for the League prize.');
  changes.push({itemId,before:entry.itemId?entry.quantity:0,after:999});
  entry.itemId=itemId;entry.quantity=999;
  sram.writeUInt16LE(itemId,pocket+entry.slot*4);sram.writeUInt16LE(999^encryption,pocket+entry.slot*4+2);
 }
 sram.writeUInt16LE(checksum(sram,sections[1],SIZES[1]),sections[1]+4086);
 return {sram,receipt:{schema:'pokemon-suite/league-ball-prize/v1',game:'firered',leagueComplete:true,trainerId:before.readUInt32LE(sections[0]+10),slot:current.slot,saveCounter:current.counter,changes,masterBallsAdded:0,safariBallsAdded:0,beforeSha256:digest(before),afterSha256:digest(sram)}};
}
