import {decodeBoxPokemonRecord} from '../evidence/pokemon-record.js';
const indexes=new WeakMap(),learnsetCache=new WeakMap();
const ram=(a,n=1)=>Number.isInteger(a)&&a>=0x02000000&&a+n<=0x02040000;
const rom=(a,n=1)=>Number.isInteger(a)&&a>=0x08000000&&a+n<=0x0a000000;
// VAR_HAPPINESS_STEP_COUNTER (include/constants/vars.h 0x4021), stored in
// SaveBlock1.vars[id-0x4000]; it wraps every 128 steps.
const HAPPINESS_STEP_COUNTER=0x4021;
// A species' level-up table from ROM gLevelUpLearnsets (src/data/pokemon/
// level_up_learnsets.h: u16 entries (level<<9)|move ending in 0xFFFF), as
// [[level,move],...]. Immutable cartridge data, cached per runtime.
function readLearnset(read,symbols,cache,species){
 if(cache.has(species))return cache.get(species);
 const table=symbols.gLevelUpLearnsets;let value=null;
 if(table&&Number.isInteger(species)&&species>0&&species*4+4<=table.size){
  const pointer=read(table.address+species*4,4)?.readUInt32LE();
  const bytes=rom(pointer,202)?read(pointer,202):null;
  if(bytes){const entries=[];for(let i=0;i<101;i++){const v=bytes.readUInt16LE(i*2);if(v===0xffff){value=entries;break;}entries.push([v>>9,v&511]);}}
 }
 cache.set(species,value);return value;
}

// BPRE revision 1 structures from the pinned cartridge source. Read-only: no
// writes, coin synthesis, egg generation or RNG changes occur in this decoder.
export function readAcquisitionEvidence(session,runtime,o){
 const data=runtime.data??runtime,{symbols,structures}=data,fields=structures?.SaveBlock1?.fields;
 if(!Number.isInteger(fields?.coins?.offset)||!symbols?.gSaveBlock1Ptr||!symbols?.gSaveBlock2Ptr)return null;
 const read=(a,n)=>{const b=Buffer.from(session.readMemory(a,n));return b.length===n?b:null;};
 const word=a=>read(a,4)?.readUInt32LE(),symbol=name=>symbols[name]?.address;
 const b1=word(symbol('gSaveBlock1Ptr')),b2=word(symbol('gSaveBlock2Ptr'));
 if(!ram(b1,fields.coins.offset+2)||!ram(b2,structures.SaveBlock2.fields.encryptionKey.offset+4))return null;
 const key=word(b2+structures.SaveBlock2.fields.encryptionKey.offset),raw=read(b1+fields.coins.offset,2);
 const coins=raw&&Number.isInteger(key)?raw.readUInt16LE()^(key&65535):null;
 let index=indexes.get(data);
 if(!index){index=new Map(Object.entries(symbols).filter(([name])=>name.startsWith('DayCare_Text_')||name.startsWith('MainTask_')||['Task_HandleDaycareLevelMenuInput','ListMenuDummyTask'].includes(name)).map(([name,s])=>[name.startsWith('DayCare_Text_')?s.address:s.address&~1,name]));indexes.set(data,index);}
 const bytes=symbol('gTasks')?read(symbol('gTasks'),640):null;
 const tasks=bytes?Array.from({length:16},(_,i)=>({id:i,active:bytes[i*40+4]===1,name:index.get(bytes.readUInt32LE(i*40)&~1),bytes:bytes.subarray(i*40+8,i*40+40)})):[];
 let slots=null,daycare=null;
 if(o?.emulator?.callback2==='CB2_RunSlotMachine'&&symbol('sSlotMachineState')){
  const ptr=word(symbol('sSlotMachineState')),b=ram(ptr,18)?read(ptr,18):null,t=b?tasks[b[16]]:null;
  if(t?.active&&t.name?.startsWith('MainTask_')&&b.readUInt16LE(14)<=3)slots={task:t.name,stage:t.bytes.readInt16LE(),bet:b.readUInt16LE(14)};
 }
 if(Number.isInteger(fields.daycare?.offset)&&ram(b1+fields.daycare.offset,284)){
  const b=read(b1+fields.daycare.offset,284);
  if(b){
   const parents=[0,1].map(slot=>({...decodeBoxPokemonRecord(b,slot*140),slot,steps:b.readUInt32LE(slot*140+136)}));
   const task=tasks.find(t=>t.active&&t.name==='Task_HandleDaycareLevelMenuInput'),list=task?tasks[task.bytes.readUInt16LE()]:null;
   const cursor=list?.active&&list.name==='ListMenuDummyTask'?list.bytes.readUInt16LE(24)+list.bytes.readUInt16LE(26):null;
   // DayCare.offspringPersonality (u16 at +280) is nonzero while an Egg is held; the cartridge rolls only while it is 0.
   daycare={validity:parents.every(p=>['valid','empty'].includes(p.validity))?'valid':'unknown',parents:parents.filter(p=>p.validity!=='empty'),pendingEgg:o?.playerMemory?.storyState?.flagIds?.[614]??null,offspringPersonality:b.readUInt16LE(280),menuCursor:cursor>=0&&cursor<=2?cursor:null};
  }
 }
 const context=symbol('sGlobalScriptContext')?word(symbol('sGlobalScriptContext')+100):null;
 // Level-up tables for every Pokémon a protected Day Care parent can be: shinies
 // in the party or PC, and both Day Care parents (native-breeding.js budget).
 let cache=learnsetCache.get(data);if(!cache){cache=new Map();learnsetCache.set(data,cache);}
 const t=o?.playerMemory?.trainer,learnsets={};
 for(const p of [...(t?.party??[]),...(t?.storage?.pokemon??[]),...(daycare?.parents??[])])
  if(p?.validity==='valid'&&!p.isEgg&&(p.shiny===true||daycare?.parents?.includes(p))&&!Object.hasOwn(learnsets,p.species)){const l=readLearnset(read,symbols,cache,p.species);if(l)learnsets[p.species]=l;}
 const happiness=Number.isInteger(fields.vars?.offset)&&ram(b1+fields.vars.offset+(HAPPINESS_STEP_COUNTER-0x4000)*2,2)?read(b1+fields.vars.offset+(HAPPINESS_STEP_COUNTER-0x4000)*2,2)?.readUInt16LE():null;
 const prompt=index.get(context)??null;
 const variable=name=>symbol(name)?read(symbol(name),2)?.readUInt16LE()??null:null;
 return {coins:coins>=0&&coins<=9999?coins:null,slots,daycare,prompt,selectedParent:variable('gSpecialVar_0x8004'),withdrawalCost:variable('gSpecialVar_0x8005'),
  learnsets,happinessStepCounter:Number.isInteger(happiness)?happiness:null};
}
