// The original use_pokeblock.c formula: aggregate flavor preference chooses
// which nature adjustment applies. It is not an unconditional ±10% of dry.
const flavorStats=[0,3,2,4,1]; // spicy/dry/sweet/bitter/sour → native nature stat
const flavors=['spicy','dry','sweet','bitter','sour'];
export function pokeblockBeautyGain(personality,block){
 const nature=(personality>>>0)%25,up=Math.floor(nature/5),down=nature%5;
 const relation=flavorStats.map(stat=>up===down?0:stat===up?1:stat===down?-1:0);
 const direction=Math.sign(flavors.reduce((sum,key,i)=>sum+block[key]*relation[i],0));
 return block.dry+(direction&&relation[1]===direction?Math.floor(block.dry/10)+(block.dry%10>=5?1:0):0)*relation[1];
}
export function decodePokeblocks(bytes){
 if(bytes.length!==40*8)throw Error('The native Pokéblock layout is unavailable.');
 const result=[];
 // Original ARM code indexes with LSL #3: seven fields plus compiler padding.
 for(let slot=0;slot<40;slot++)if(bytes[slot*8])result.push(Object.fromEntries([['slot',slot],...['color',...flavors,'feel'].map((k,i)=>[k,bytes[slot*8+i]])]));
 return result;
}
export function planBeautyFeeding(p,blocks){
 if(!Number.isInteger(p.personality)||![p.beauty,p.sheen].every(x=>Number.isInteger(x)&&x>=0&&x<=255))return {kind:'stop',reason:'The individual’s native Beauty and Sheen are unavailable.'};
 if(p.beauty>=170)return {kind:'ready',beauty:p.beauty,sheen:p.sheen};
 if(p.sheen===255)return {kind:'stop',reason:'This individual has maximum Sheen below Beauty 170. These cartridges cannot reduce Sheen.'};
 const usable=blocks.filter(b=>b.color&&Number.isInteger(b.slot)&&[...flavors,'feel'].every(k=>Number.isInteger(b[k])&&b[k]>=0&&b[k]<=255)).map(b=>({...b,gain:pokeblockBeautyGain(p.personality,b)})).filter(b=>b.gain>0);
 if(new Set(usable.map(b=>b.slot)).size!==usable.length)return {kind:'stop',reason:'The native Pokéblock slots are ambiguous.'};
 const budget=254-p.sheen,needed=170-p.beauty;let best=null;
 // The last block may bring Sheen to 255. All preceding blocks must leave
 // it below 255. Solve bounded subsets for every candidate final block.
 for(const last of usable){
  const remaining=usable.filter(b=>b.slot!==last.slot),rows=Array.from({length:remaining.length+1},()=>new Map());rows[0].set(0,{gain:0,slots:[]});
  for(const b of remaining)for(let count=remaining.length-1;count>=0;count--)for(const [feel,value] of rows[count]){
   const nextFeel=feel+b.feel;if(nextFeel>budget)continue;
   const gain=value.gain+b.gain,prior=rows[count+1].get(nextFeel);
   if(!prior||gain>prior.gain)rows[count+1].set(nextFeel,{gain,slots:[...value.slots,b.slot]});
  }
  for(let count=0;count<rows.length;count++)for(const [feel,value] of rows[count])if(value.gain+last.gain>=needed){
   const candidate={kind:'feed',slots:[...value.slots,last.slot],beauty:Math.min(255,p.beauty+value.gain+last.gain),sheen:Math.min(255,p.sheen+feel+last.feel)};
   if(!best||candidate.slots.length<best.slots.length||candidate.slots.length===best.slots.length&&candidate.sheen<best.sheen)best=candidate;
  }
 }
 return best??{kind:'supply',reason:'Obtain enough suitable dry Pokéblocks for a complete Beauty 170 plan before feeding this individual.',beauty:p.beauty,sheen:p.sheen};
}

const blockKey=b=>JSON.stringify(['color',...flavors,'feel'].map(k=>b[k]));
const inventoryKey=blocks=>JSON.stringify(blocks.map(blockKey).sort());
const ivKeys=['hp','attack','defense','speed','spAttack','spDefense'];
export function inspectNativePokeblock(o,intent){
 const input=button=>({kind:'input',button}),wait=()=>({kind:'wait'}),stop=reason=>({kind:'stop',reason});
 if(o.emulator.paletteFadeActive||o.emulator.mode==='transition')return wait();
 const source=intent.source,matches=o.party.filter(p=>p.validity==='valid'&&p.personality===source.personality&&p.otId===source.otId);
 if(matches.length!==1||ivKeys.some(k=>matches[0].ivs[k]!==source.ivs[k])||matches[0].species!==source.species||source.shiny&&!matches[0].shiny)return stop('The Pokéblock recipient no longer matches its saved identity.');
 const p=matches[0],menu=o.menus.pokeblock,after=p.beauty===intent.expected.beauty&&p.sheen===intent.expected.sheen;
 if(!after&&(p.beauty!==intent.before.beauty||p.sheen!==intent.before.sheen))return stop('Native Beauty or Sheen changed unexpectedly. Preserve this individual.');
 if(after){
  if(o.fieldReady)return inventoryKey(o.pokeblocks)===inventoryKey(intent.blocksBefore.filter(b=>b.slot!==intent.block.slot))?{kind:'complete'}:stop('The consumed Pokéblock inventory does not match the verified feeding.');
  if(menu?.phase==='ShowPokeblockResults')return [1,5].includes(menu.state)?input('a'):wait();
  if(menu?.phase)return wait();
  if(o.hasTask('Task_WaitForAtePokeblockMessage'))return input('a');
  return o.hasTask('Task_HandlePokeblockMenuInput')||o.hasTask('Task_BagMenu_HandleInput')||o.menus.startMenu?input('b'):wait();
 }
 if(inventoryKey(o.pokeblocks)!==inventoryKey(intent.blocksBefore))return stop('The reserved Pokéblock inventory changed before feeding.');
 if(menu?.phase==='ShowPokeblockResults')return menu.state===1?input('a'):wait();
 if(menu?.phase==='UsePokeblockMenu'){
  const selection=o.party.filter(p=>!p.isEgg).indexOf(p);
  if(menu.blockSlot!==intent.block.slot||blockKey(o.pokeblocks.find(b=>b.slot===menu.blockSlot)??{})!==blockKey(intent.block))return stop('The condition screen opened a different Pokéblock.');
  if(menu.state===0)return input(menu.selection===selection?'a':menu.selection<selection?'down':'up');
  if(menu.state===6){
   if(menu.selection!==selection||p.sheen===255)return stop('The native feeding confirmation is not the reserved eligible recipient.');
   return input(o.menus.menuCursor===0?'a':'up');
  }
  if(menu.state===7)return stop('The native game refused this Pokéblock.');
  return wait();
 }
 if(menu?.phase||o.hasTask('Task_WaitForAtePokeblockMessage'))return o.hasTask('Task_WaitForAtePokeblockMessage')?input('a'):wait();
 if(o.hasTask('Task_HandlePokeblockMenuInput')){
  const index=o.pokeblocks.findIndex(b=>b.slot===intent.block.slot);
  return input(menu.cursor===index?'a':menu.cursor<index?'down':'up');
 }
 if(o.hasTask('Task_HandlePokeblockActionsInput'))return input(menu.selectedSlot!==intent.block.slot?'b':o.menus.menuCursor===0?'a':'up');
 if(o.emulator.mode==='bag'){
  if(o.hasTask('Task_BagMenu_HandleInput')){
   const bag=o.menus.bag;
   if(bag.pocket!==4)return input((4-bag.pocket+5)%5<=2?'right':'left');
   const index=o.bag.keyItems.findIndex(b=>b.itemId===intent.caseItemId&&b.quantity>0);
   if(index<0)return stop('Obtain the native Pokéblock Case before feeding.');
   const cursor=bag.cursor[4]+bag.scroll[4];return input(cursor===index?'a':cursor<index?'down':'up');
  }
  if(o.hasTask('Task_ItemContext_SingleRow')||o.hasTask('Task_ItemContext_MultipleRows'))return input(o.menus.bag.selectedItemId!==intent.caseItemId?'b':o.menus.menuCursor===0?'a':'up');
  return wait();
 }
 if(o.menus.startMenu){const {cursor,actions}=o.menus.startMenu,index=actions.indexOf(2);return index<0?stop('The native bag is unavailable.'):input(cursor===index?'a':cursor<index?'down':'up');}
 return o.fieldReady?input('start'):wait();
}
