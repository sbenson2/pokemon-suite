// Read-only Gen III display data. Indices/offsets are from the cartridge's
// include/constants/game_stat.h and struct SpeciesInfo; no save writes.
const u32=(b,o)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(o,true);
const COUNTERS={savedGame:0,steps:5,battles:7,wildBattles:8,trainerBattles:9,leagueEntries:10,captures:11,fishingCaptures:12,eggsHatched:13,evolutions:14,heals:15,trades:21};
export function decodeGameCounters(bytes,offset,key){
 if(!bytes||!Number.isInteger(offset)||offset<0||!Number.isInteger(key))return null;
 return Object.fromEntries(Object.entries(COUNTERS).filter(([,i])=>offset+i*4+4<=bytes.length).map(([name,i])=>[name,(u32(bytes,offset+i*4)^key)>>>0]));
}
export function createPartyDisplayReader({symbols,readMemory}){
 const read=name=>{const s=symbols[name];return s&&s.address>=0x08000000&&s.address+s.size<=0x0a000000&&s.size>0&&s.size<=20000?readMemory(s.address,s.size):null;};
 const species=read('gSpeciesInfo'),xp=read('gExperienceTables'),national=read('sSpeciesToNationalPokedexNum');
 return mon=>{
  if(!mon)return mon;
  const result={...mon},id=mon.species,level=mon.level,current=mon.experience;
  if(national&&id>0&&id*2<=national.length)result.nationalSpecies=national[(id-1)*2]|national[(id-1)*2+1]<<8;
  if(level===100){result.experienceProgress={current,remaining:0,ratio:1};return result;}
  if(!species||!xp||!Number.isInteger(id)||id<1||id*28+19>=species.length||!Number.isInteger(level)||level<1||level>=100||!Number.isInteger(current))return result;
  const growth=species[id*28+19],offset=(growth*101+level)*4;
  if(offset+8>xp.length)return result;
  const base=u32(xp,offset),next=u32(xp,offset+4);
  if(next>base&&current>=base&&current<=next)result.experienceProgress={current,levelStart:base,nextLevel:next,remaining:next-current,ratio:(current-base)/(next-base)};
  return result;
 };
}
