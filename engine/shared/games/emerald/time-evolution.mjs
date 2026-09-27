// Cartridge-specific Eevee preparation. Friendship is built after receiving
// the individual; Gen III trading resets it to 70. This planner emits inputs
// through the ordinary field/item player and never changes Pokémon data.
const wait=reason=>({kind:'wait',reason});
const stop=reason=>({kind:'stop',reason});
const ivKeys=['hp','attack','defense','speed','spAttack','spDefense'];
export function planTimeEvolution(o,{source,targetSpecies},c){
 if(![196,197].includes(targetSpecies))return stop('This preparation needs an Emerald Espeon or Umbreon evolution.');
 if(o.emulator.paletteFadeActive||['transition','evolution'].includes(o.emulator.mode))return wait('The native Pokémon transition is in progress.');
 const family=o.party.filter(p=>p.validity==='valid'&&p.personality===source.personality&&p.otId===source.otId);
 if(family.length!==1||ivKeys.some(k=>family[0].ivs[k]!==source.ivs[k])||source.shiny&&!family[0].shiny)return stop('The reserved evolution individual no longer matches its saved identity.');
 const p=family[0];
 if(p.species===targetSpecies)return {kind:'evolved',pokemon:p};
 if(p.species!==133)return stop('This Eevee evolved into a different species. Preserve it for review.');
 if(p.level>=100)return stop('A native Gen III level-up evolution cannot start at level 100.');
 if(p.heldItem===195)return stop('Remove the reserved Eevee’s Everstone before its evolution.');
 if(!(o.bag.items??[]).some(i=>i.itemId===c.items.ITEM_RARE_CANDY&&i.quantity>0)){
  for(const name of ['MAP_PETALBURG_CITY','MAP_ROUTE110','MAP_ROUTE114','MAP_ROUTE119','MAP_ROUTE120','MAP_ROUTE123','MAP_ROUTE127','MAP_ROUTE111']){
   const map=c.maps.get(name),hidden=map.bgEvents.find(e=>e.item==='ITEM_RARE_CANDY'&&!o.flag(e.flag));
   if(hidden)return {kind:'interact',map:name,x:hidden.x,y:hidden.y};
   const ball=map.objects.find(e=>/ItemRareCandy$/.test(e.script??'')&&e.flag&&!o.flag(e.flag));
   if(ball)return {kind:'interact',map:name,x:ball.x,y:ball.y,localId:ball.localId};
  }
  return wait('The native level-up needs a Rare Candy; the currently supported pickups are exhausted.');
 }
 if(p.friendship<220||o.player.map.id!=='MAP_OLDALE_TOWN')return {kind:'goto',map:'MAP_OLDALE_TOWN',x:o.player.position.x===8&&o.player.position.y===12?16:8,y:12,reason:'friendship-walking',friendship:p.friendship,required:220};
 const clock=o.localTime;
 if(!clock||!Number.isInteger(clock.hours)||clock.hours<0||clock.hours>23||!Number.isInteger(clock.minutes)||clock.minutes<0||clock.minutes>59)return wait('Waiting for a readable native Emerald clock.');
 const correct=targetSpecies===197?clock.hours<12:clock.hours>=12;
 if(!correct||clock.hours%12===11&&clock.minutes>=59)return wait(`Waiting for Emerald’s ${targetSpecies===197?'00:00–11:59':'12:00–23:59'} evolution window before using the Rare Candy.`);
 return {kind:'level-up',itemId:c.items.ITEM_RARE_CANDY,personality:p.personality,otId:p.otId,targetSpecies,before:{level:p.level}};
}
