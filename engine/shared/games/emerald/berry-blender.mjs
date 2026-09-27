// Read-only ROM recipes and native input timing, from pinned berry_blender.c.
const flavors=['spicy','dry','sweet','bitter','sour'];
const u16=(b,o=0)=>b[o]|b[o+1]<<8;
const u32=b=>(b[0]|b[1]<<8|b[2]<<16|b[3]<<24)>>>0;
export function predictPokeblock(berries,maxRPM=0){
 if(berries.length<2||new Set(berries.map(b=>b.itemId)).size!==berries.length)return null;
 const totals=flavors.map(k=>berries.reduce((s,b)=>s+b[k],0));
 const reduced=totals.map((n,i)=>n-totals[(i+1)%5]),negatives=reduced.filter(n=>n<0).length;
 const values=reduced.map(n=>Math.max(0,n-negatives)).map(n=>Math.min(255,Math.floor((n*(Math.floor(maxRPM/333)+100)+50)/100)));
 const positive=values.map((n,i)=>n>0?i:-1).filter(i=>i>=0);
 if(!positive.length||negatives>3)return null; // Black blocks have random, unhelpful flavors.
 const color=positive.length>3?13:positive.length===3?11:Math.max(...values)>50?14:positive.length===1?positive[0]+1:(values[positive[0]]>=values[positive[1]]?positive[0]:positive[1])+6;
 return {color,...Object.fromEntries(flavors.map((k,i)=>[k,values[i]])),feel:Math.min(255,Math.max(0,Math.floor(berries.reduce((n,b)=>n+b.smoothness,0)/berries.length)-berries.length))};
}
export function createBerryRecipes(read,manifest){
 const berry=itemId=>{
  if(!Number.isInteger(itemId)||itemId<133||itemId>174)throw Error('This recipe requires a regular native berry.');
  const b=read(manifest.gBerries+(itemId-133)*28,28);
  return {itemId,...Object.fromEntries(flavors.map((k,i)=>[k,b[21+i]])),smoothness:b[26]};
 };
 return {berry,recipe(itemId,maxRPM=0){
  const index=itemId-133,set=index<5?index:index%5+5,npcs=Array.from(read(manifest.sOpponentBerrySets+set*3,3),v=>v+133);
  const berries=[itemId,...npcs].map(berry);return {itemId,berries,block:predictPokeblock(berries,maxRPM)};
 }};
}
export function readNativeBlender(read,manifest,o){
 const phase=['CB2_LoadBerryBlender','CB2_PlayBlender','CB2_EndBlenderGame','CB2_CheckPlayAgainLocal'].find(n=>o.emulator.callback2===(manifest[n]|1));
 if(!phase)return null; // sBerryBlender is dangling after the native scene frees it.
 const ptr=u32(read(manifest.sBerryBlender,4));if(ptr<0x02000000||ptr+316>0x02040000)throw Error('The native blender state is unavailable.');
 const b=read(ptr,316);
 return {phase,arrowPos:u16(b,74),speed:u16(b,76),maxRPM:u16(b,78),gameEndState:b[99],playAgainState:b[112],chosenItems:Array.from({length:4},(_,i)=>u16(b,116+i*2)),numPlayers:b[124],playerArrow:u16(b,150),progress:u16(b,278),perfectOpponents:b[291],scores:Array.from({length:3},(_,i)=>u16(b,292+i*2))};
}
export function blenderButtons(b,lastA){
 if(!Number.isInteger(b.playerArrow)||b.playerArrow<0||b.playerArrow>3)throw Error('The player’s native blender arrow is unavailable.');
 const pos=(((b.arrowPos+b.speed)&65535)>>>8)+24,start=[32,224,96,160][b.playerArrow];
 return !lastA&&pos>=start+20&&pos<start+28?['a']:[];
}
const blockKey=b=>JSON.stringify(['color',...flavors,'feel'].map(k=>b[k]));
export function verifyBlenderResult(before,after,itemId){
 const quantities=list=>new Map(list.map(b=>[b.itemId,b.quantity]));
 const a=quantities(before.berries),b=quantities(after.berries);
 for(const id of new Set([...a.keys(),...b.keys()]))if((a.get(id)||0)-(b.get(id)||0)!==(id===itemId?1:0))throw Error('The native blender did not consume exactly the selected berry.');
 const remaining=[...after.blocks];
 for(const old of before.blocks){const i=remaining.findIndex(b=>blockKey(b)===blockKey(old));if(i<0)throw Error('An existing Pokéblock changed during blending.');remaining.splice(i,1);}
 if(remaining.length!==1)throw Error('The native blender did not add exactly one Pokéblock.');
 return remaining[0];
}
