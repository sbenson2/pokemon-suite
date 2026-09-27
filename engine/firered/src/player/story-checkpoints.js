// Presentation of the actual campaign plan. This module never selects an
// objective or writes campaign/game state. The planner supplies completion
// evidence using its own cartridge-aware predicates.
export const STORY_STEPS = Object.freeze({
  'oak-parcel': ['Collect Oak’s Parcel', 'Visit the Viridian Poké Mart and accept the delivery for Professor Oak.', 'The parcel delivery scene has started.'],
  'regional-pokedex': ['Receive the Pokédex', 'Return the parcel to Oak’s lab and finish the Pokédex conversation.', 'The game records receipt of the Pokédex.'],
  'rival-route22-early': ['Defeat the rival on Route 22', 'Prepare the available team, then finish the early Route 22 rival battle.', 'The rival’s first Route 22 encounter is resolved.'],
  'mt-moon-fossil': ['Choose a Mt. Moon fossil', 'Cross Mt. Moon, defeat the fossil guard and choose a fossil.', 'The fossil choice is recorded.'],
  'rival-cerulean': ['Defeat the Cerulean rival', 'Finish the rival encounter before continuing north toward Bill.', 'The Cerulean rival scene is complete.'],
  'bill-enter-teleporter': ['Help Bill enter the teleporter', 'Speak to Bill in Sea Cottage and agree to help.', 'Bill enters the machine or his rescue has already advanced.'],
  'bill-cell-separator': ['Operate Bill’s PC', 'Use the cell separator after Bill enters the teleporter.', 'Bill is restored to his human form.'],
  'ss-ticket': ['Receive the S.S. Ticket', 'Speak to Bill again after restoring him.', 'Receipt of the S.S. Ticket is recorded.'],
  'cerulean-rocket': ['Clear the stolen-TM Rocket encounter', 'Leave through the robbed house and defeat the Rocket behind it.', 'The Rocket encounter is resolved.'],
  'vs-seeker': ['Receive the Vs. Seeker', 'Speak to the woman in Vermilion Pokémon Center for trainer rematches.', 'The Vs. Seeker is in the bag or its receipt is recorded.'],
  'bike-voucher': ['Receive the Bike Voucher', 'Listen to the Pokémon Fan Club chairman in Vermilion.', 'The Bike Voucher or the exchanged Bicycle is recorded.'],
  bicycle: ['Exchange the voucher for a Bicycle', 'Visit the Cerulean Bike Shop and exchange the voucher.', 'The Bicycle is present or its receipt is recorded.'],
  'rival-ss-anne': ['Defeat the S.S. Anne rival', 'Board with the ticket and finish the rival battle near the captain.', 'The ship’s rival scene is complete.'],
  'hm-cut': ['Receive Cut', 'Help the S.S. Anne captain and receive HM01.', 'The game records receipt of Cut.'],
  'surge-first-lock': ['Find Surge’s first switch', 'Search the gym’s bins for the first electrical switch.', 'The first switch is active or the gym has already been cleared.'],
  'surge-second-lock': ['Open Surge’s second lock', 'Find the adjacent second switch; recover if the puzzle resets.', 'The electrical barrier is open or the Thunder Badge is owned.'],
  'coin-case': ['Collect the Coin Case', 'Speak to the man in Celadon’s restaurant.', 'The Coin Case is held or its receipt is recorded.'],
  tea: ['Obtain Tea for the Saffron guards', 'Visit the woman in Celadon Condominiums to open the Saffron gate route.', 'The game records receipt of Tea.'],
  'game-corner-rocket': ['Defeat the poster guard', 'Battle the Rocket guarding the Game Corner poster.', 'The poster guard’s trainer flag is set.'],
  'rocket-hideout-poster': ['Open the Rocket Hideout', 'Inspect the poster switch after defeating its guard.', 'The hidden staircase is unlocked.'],
  'rocket-hideout-lift-key-grunt': ['Defeat the Lift Key guard', 'Reach basement 4 and defeat the Rocket carrying the Lift Key.', 'The Lift Key guard’s defeat is recorded.'],
  'rocket-hideout-lift-key': ['Collect the Lift Key', 'Speak to the defeated guard and pick up the dropped key.', 'The Lift Key is present in the bag.'],
  'rocket-hideout-door-grunt-left': ['Defeat Giovanni’s left guard', 'Use the lift and defeat the left Rocket outside Giovanni’s room.', 'The left guard’s defeat is recorded.'],
  'rocket-hideout-door-grunt-right': ['Defeat Giovanni’s right guard', 'Defeat the other Rocket to open Giovanni’s room.', 'The right guard’s defeat is recorded.'],
  'rocket-hideout-giovanni': ['Defeat Giovanni in the hideout', 'Enter the boss room with a prepared team and defeat Giovanni.', 'Giovanni’s hideout defeat is recorded.'],
  'silph-scope': ['Collect the Silph Scope', 'Pick up the Silph Scope left in Giovanni’s room.', 'The Silph Scope is present in the bag.'],
  'rocket-hideout-exit': ['Leave the Rocket Hideout', 'Return through the lift and exit to Celadon.', 'The player is outside the hideout.'],
  'rival-pokemon-tower': ['Defeat the Pokémon Tower rival', 'Finish the rival battle on the tower’s second floor.', 'The Pokémon Tower rival scene is complete.'],
  'mr-fuji': ['Rescue Mr. Fuji', 'Use the Silph Scope, resolve the Marowak encounter, clear the upper Rockets and speak to Mr. Fuji.', 'Mr. Fuji’s rescue is recorded.'],
  'poke-flute': ['Receive the Poké Flute', 'Speak to Mr. Fuji at the volunteer Pokémon house.', 'Receipt of the Poké Flute is recorded.'],
  'silph-card-key': ['Collect the Silph Card Key', 'Reach Silph Co. floor 5 and collect the Card Key.', 'The Card Key is present in the bag.'],
  'silph-third-floor-door-two': ['Open the first floor-3 card door', 'Use the Card Key on the first required third-floor door.', 'This card door’s unlock flag is set.'],
  'silph-third-floor-door': ['Open the floor-3 teleporter route', 'Unlock the other required third-floor door and reach the warp tile.', 'The teleporter-route door is unlocked.'],
  'silph-coverage-tm': ['Buy the planned coverage TM', 'Obtain Secret Power if this team’s plan requires it.', 'The TM is available or a party member already knows the move.'],
  'rival-silph': ['Defeat the Silph Co. rival', 'Follow the unlocked teleporters and win the seventh-floor rival battle.', 'The Silph rival scene is complete.'],
  'gift-lapras': ['Receive Lapras', 'Make party space and accept Lapras from the Silph employee.', 'Lapras is recorded as owned.'],
  'silph-eleventh-floor-door': ['Unlock the Silph president’s room', 'Use the Card Key on the eleventh-floor door.', 'The president’s room is unlocked.'],
  'silph-liberated': ['Free Silph Co.', 'Defeat Giovanni and finish the president’s-room scene.', 'Team Rocket’s Silph takeover is marked resolved.'],
  'route12-snorlax': ['Clear Route 12’s Snorlax', 'Use the Poké Flute and catch Snorlax when the team plan calls for it.', 'The roadblock is cleared and the required catch is owned.'],
  'route16-snorlax': ['Clear Route 16’s Snorlax', 'Use the Poké Flute to clear the Cycling Road approach.', 'The Route 16 roadblock is resolved.'],
  'route16-snorlax-clear': ['Open the Cycling Road approach', 'Wake Route 16’s Snorlax with the Poké Flute and resolve the encounter.', 'The game records removal of the Route 16 roadblock.'],
  'gold-teeth': ['Find the Gold Teeth', 'Traverse the Safari Zone to the western area and collect the teeth.', 'Collection of the Gold Teeth is recorded.'],
  'hm-surf': ['Receive Surf', 'Reach the Safari Zone Secret House before the visit ends.', 'Receipt of HM03 Surf is recorded.'],
  'hm-strength': ['Receive Strength', 'Return the Gold Teeth to Fuchsia’s Safari Zone warden.', 'Receipt of HM04 Strength is recorded.'],
  'hm-fly': ['Receive Fly', 'Reach the secluded house on Route 16 and accept HM02.', 'Receipt of Fly is recorded or the HM is available.'],
  'secret-key': ['Find the Cinnabar Gym key', 'Reach Pokémon Mansion’s basement using the statue switches and the correct drop, then collect the Secret Key.', 'The game records collection of the Secret Key.'],
  'rival-route22-late': ['Defeat the final Route 22 rival', 'Return to Route 22 with all eight badges and defeat the rival.', 'The final Route 22 rival scene is complete.'],
  'route23-boulder-gate': ['Pass the Boulder Badge gate', 'Show the first badge at the Pokémon League entrance.', 'The first badge inspection is complete.'],
  'victory-road-first-floor-switch': ['Open Victory Road’s first-floor barrier', 'Use Strength to push the first-floor boulder onto its switch.', 'The first-floor switch variable confirms activation.'],
  'victory-road-second-floor-switch-one': ['Open the first second-floor barrier', 'Push the western second-floor boulder onto its switch.', 'The first second-floor switch is active.'],
  'victory-road-third-floor-switch': ['Open the third-floor barrier', 'Use Strength to activate the third-floor switch.', 'The third-floor switch is active.'],
  'victory-road-drop-boulder': ['Drop the final Victory Road boulder', 'Push the third-floor boulder through the hole to floor 2.', 'The game records the boulder on the lower floor.'],
  'victory-road-second-floor-switch-two': ['Open Victory Road’s exit', 'Push the dropped boulder onto the final second-floor switch.', 'The exit barrier’s switch is active.'],
  'league-heal': ['Restore the team at Indigo Plateau', 'Use the Pokémon Center before entering the League.', 'Every party member has full HP, PP and no status, or the League attempt has begun.'],
  champion: ['Defeat the Champion and enter the Hall of Fame', 'Finish the Champion battle, registration and the game’s completion sequence.', 'The cartridge’s game-clear flag is set; the run additionally verifies the committed Hall of Fame team and save.'],
  'sevii-sail-two-island': ['Sail to Two Island', 'If Bill’s island trip has started, take the ferry to Two Island.', 'Two Island is recorded as visited.'],
  'sevii-find-lostelle': ['Learn about Lostelle', 'Speak to the father in Two Island’s Game Corner.', 'The Lostelle search scene has started.'],
  'sevii-sail-three-island': ['Sail to Three Island', 'Take the ferry to Three Island to follow the search.', 'Three Island is recorded as visited.'],
  'sevii-confront-bikers': ['Confront the Three Island bikers', 'Approach the bikers and finish their initial scene.', 'The confrontation has advanced to the battle stage.'],
  'sevii-defeat-bikers': ['Defeat the biker group', 'Accept the confrontation and finish all biker battles.', 'The biker encounter is resolved.'],
  'sevii-rescue-lostelle': ['Rescue Lostelle in Berry Forest', 'Cross Bond Bridge, reach Lostelle and resolve the Hypno encounter.', 'Lostelle’s rescue is recorded.'],
  'sevii-deliver-meteorite': ['Deliver the Meteorite', 'Return to the Game Corner and complete the delivery conversation.', 'The island errand has reached its return stage.'],
  'sevii-sail-one-island': ['Return to One Island', 'Take the ferry back to One Island.', 'The player reaches One Island.'],
  'sevii-return-to-kanto': ['Finish Bill and Celio’s island trip', 'Return to One Island Pokémon Center and complete the trip’s closing scene.', 'The game marks the introductory island trip complete.'],
});

export const STORY_CHAPTERS = Object.freeze([
  ['boulder','Pallet to Pewter','badge-boulder'],['cascade','Mt. Moon and Cerulean','badge-cascade'],
  ['thunder','Vermilion and the S.S. Anne','badge-thunder'],['rainbow','Celadon Gym','badge-rainbow'],
  ['hideout','Rocket Hideout','rocket-hideout-exit'],['tower','Pokémon Tower','poke-flute'],
  ['silph','Silph Co.','silph-liberated'],['soul','Safari Zone and Fuchsia','badge-soul'],
  ['marsh','Saffron Gym','badge-marsh'],['volcano','Pokémon Mansion and Cinnabar','badge-volcano'],
  ['earth','Viridian Gym','badge-earth'],['road','League gates and Victory Road','victory-road-second-floor-switch-two'],
  ['league','Elite Four and Champion','champion'],
]);
const badges=['Boulder','Cascade','Thunder','Rainbow','Soul','Marsh','Volcano','Earth'];
const leaders=['Brock','Misty','Lt. Surge','Erika','Koga','Sabrina','Blaine','Giovanni'];
export function storyName(value='') {
  return String(value).replace(/^MAP_/,'').replace(/SSANNE/g,'S.S. Anne').replace(/[_-]/g,' ')
    .toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bPokemon\b/g,'Pokémon').replace(/\bSilph Co\b/g,'Silph Co.').replace(/\b([123456789ab])f\b/gi,(_,n)=>`${n.toUpperCase()}F`);
}
function tableName(mechanics,table,id,fallback) {
  const common=table==='items'?{2:'Ultra Ball',3:'Great Ball',4:'Poké Ball',19:'Full Restore',20:'Max Potion',21:'Hyper Potion',22:'Super Potion',23:'Full Heal',24:'Revive',96:'Thunder Stone',331:'TM43 Secret Power'}:table==='moves'?{15:'Cut',19:'Fly',57:'Surf',70:'Strength',148:'Flash',249:'Rock Smash',290:'Secret Power'}:{};
  const t=(mechanics?.data??mechanics)?.[table];
  const entries=Array.isArray(t)?t:Object.values(t??{});
  const entry=entries.find(e=>Number(e.id??e.speciesId??e.moveId??e.itemId)===Number(id));
  return entry?.name?storyName(entry.name.replace(/^(SPECIES|MOVE|ITEM)_/,'')):common[id]??`${fallback} ${id}`;
}
export function describeStoryCheckpoint(o,mechanics=null) {
  let text=STORY_STEPS[o.id];
  const badge=badges.findIndex(b=>o.id===`badge-${b.toLowerCase()}`),target=o.target??{};
  if(badge>=0)text=[`${badge+1}. ${leaders[badge]} — ${badges[badge]} Badge`,
    `Reach ${leaders[badge]}, prepare the battle team and win the Gym battle.`, `The ${badges[badge]} Badge flag is set in the game.`];
  if(!text&&o.id.startsWith('cinnabar-gym-'))text=[`Defeat ${storyName(o.id.slice(13))}`, 'Clear this Cinnabar Gym trainer and proceed through the next gate.', 'This trainer’s defeat is recorded.'];
  if(!text&&o.id.startsWith('route23-badge-gate-')) {const n=Number(o.id.split('-').at(-1));text=[`Pass the ${badges[n-1]} Badge gate`, `Show badge ${n} to its Route 23 guard.`, `The game records at least ${n} completed badge inspections.`];}
  if(!text&&o.id.startsWith('elite-four-'))text=[`Defeat ${storyName(o.id.slice(11))}`, 'Enter the next League room with the prepared team and finish the battle.', 'This Elite Four member’s defeat flag is set for the current League attempt.'];
  if(!text&&target.kind==='heal-with-items')text=[`Restore the team after ${storyName(o.id.replace('restore-after-',''))}`, 'Revive and heal the whole party, cure status, restore PP where supplies allow, then save before continuing.', 'Available recovery is complete or the following League battle is already cleared.'];
  if(!text&&target.kind==='teach-move') {const move=tableName(mechanics,'moves',target.moveId,'Move');text=[`Teach ${move}`, 'Use the planned TM or HM on an eligible party member; Cut, Flash and Rock Smash require a utility carrier.', `The planned recipient knows ${move}, or the campaign’s superseding completion condition is met.`];}
  if(!text&&target.kind==='in-game-trade')text=[`Trade for ${tableName(mechanics,'species',target.receivedSpecies,'Pokémon')}`, `Bring ${tableName(mechanics,'species',target.requestedSpecies,'Pokémon')} to the NPC, select the correct party member and finish the complete trade sequence.`, 'The received species is owned or the NPC trade’s completion flag is set.'];
  if(!text&&target.kind==='purchase-items')text=[storyName(o.id),`Buy the planned reserve within the available budget: ${(target.items??[]).map(i=>`${i.quantity} × ${tableName(mechanics,'items',i.itemId,'item')}`).join(', ')}.`, 'The reserve is present, its later story condition is met, or no missing purchase is affordable.'];
  if(!text&&o.captureSpecies?.length)text=[`Acquire ${o.label??tableName(mechanics,'species',o.captureSpecies[0],'Pokémon')}`, 'Follow this run’s committed encounter or gift route and secure the required party family.', 'The planned acquisition’s ownership and encounter conditions are verified.'];
  if(!text&&o.completion?.kind==='party-member-minimum-level')text=[storyName(o.id),`Raise an eligible member of the required family to level ${o.completion.level} for this progression step.`, `A required party member is at least level ${o.completion.level}.`];
  if(!text&&(target.kind==='party-roster'||/roster|party-space/.test(o.id)))text=[storyName(o.id), 'Use the PC to arrange the planned party and field helpers without releasing Pokémon.', 'The required families and party-space conditions are met.'];
  if(!text)text=[storyName(o.id),`Complete the planned ${storyName(target.kind??'story').toLowerCase()} interaction for this run.`, 'The planner verifies this objective’s native event, inventory or party completion condition.'];
  return {id:o.id,label:text[0],detail:text[1],completion:text[2],location:target.map?storyName(target.map):'Current party or nearest suitable location',
    ...(o.importantBattle?{battle:{opponents:o.enemyPartySize??null,aceLevel:o.enemyAceLevel??null,readyMembers:o.minimumReadyBattleMembers??null,targetLevel:o.battleTeamTargetLevel??null}}:{})};
}

const prerequisites={
  'badge-thunder':['hm-cut','teach-cut','surge-second-lock'], 'badge-rainbow':['teach-cut'],
  'badge-marsh':['tea','silph-liberated'], 'secret-key':['badge-soul','hm-surf','teach-surf'],
  'badge-volcano':['secret-key'], 'badge-earth':badges.slice(0,7).map(b=>`badge-${b.toLowerCase()}`),
  'rival-route22-late':badges.map(b=>`badge-${b.toLowerCase()}`),
  'victory-road-first-floor-switch':['hm-strength','teach-strength','badge-rainbow'],
  'elite-four-lorelei':['league-heal','league-supplies'],
};

export function presentStoryProgress({campaign,index,active,observation,mechanics,evaluate,isKnown,isTemporary}) {
  const o=observation?.phase==='stable'?observation:null,flags=o?.playerMemory?.storyState?.flagIds??{};
  const describe=objective=>describeStoryCheckpoint(objective,mechanics);
  const row=(objective,recorded,conditional=false)=>{
    const badge=/^badge-/.test(objective.id),known=!!o&&isKnown(objective.completion,o);
    // A future map switch, healthy party or spent item is not a completed
    // story step. Badges alone are persistent, independently useful proof.
    const observed=known&&(badge||active?.id===objective.id||recorded)&&!isTemporary(objective.completion)&&evaluate(objective,o);
    const conflict=badge&&recorded&&known&&!observed;
    const status=conflict?'needs-review':badge&&!known?'unknown':observed||recorded?'complete':active?.id===objective.id?'current':conditional?'conditional':'pending';
    return {...describe(objective),status,evidence:conflict?'conflict':observed?'native':recorded&&!badge?'recorded':'unverified'};
  };
  let chapterIndex=0;
  const chapters=STORY_CHAPTERS.map(([id,label])=>({id,label,entries:[]}));
  campaign.objectives.forEach((objective,i)=>{
    chapters[chapterIndex].entries.push(row(objective,i<index));
    if(objective.id===STORY_CHAPTERS[chapterIndex][2])chapterIndex=Math.min(chapterIndex+1,chapters.length-1);
  });
  for(const interlude of campaign.mandatoryInterludes??[]) {
    const finished=!!o&&isKnown(interlude.completion,o)&&evaluate(interlude,o);
    const activeIndex=interlude.objectives.findIndex(x=>x.id===active?.id);
    chapters.splice(chapters.findIndex(c=>c.id==='earth'),0,{id:interlude.id,label:'Bill’s Sevii Islands trip',conditional:true,
      entries:interlude.objectives.map((objective,i)=>row(objective,finished||activeIndex>i,activeIndex<0&&!finished))});
  }
  const all=chapters.flatMap(c=>c.entries),byId=new Map(all.map(e=>[e.id,e]));
  for(const entry of all)entry.prerequisites=(prerequisites[entry.id]??[]).filter(id=>byId.has(id)).map(id=>{
    const p=byId.get(id);return {id,label:p.label,status:p.status};
  });
  const current=byId.get(active?.id)??(active?{...describe(active),status:'current',evidence:'unverified',prerequisites:[]}:null);
  const next=all.find(e=>e.status==='pending'&&e.id!==current?.id)??null;
  return {schema:'pokemon-suite/story-progress/v1',frame:o?.frame??null,location:o?storyName(o.playerMemory?.map?.id):'Awaiting game observation',
    current,planned:campaign.objectives[index]?describe(campaign.objectives[index]):null,next,
    badges:{earned:badges.filter((_,i)=>flags[2080+i]===true).length,known:badges.filter((_,i)=>typeof flags[2080+i]==='boolean').length,total:8},
    completed:all.filter(e=>e.status==='complete').length,total:all.length,chapters:chapters.filter(c=>c.entries.length),
    issues:all.filter(e=>e.status==='needs-review').map(e=>`${e.label}: recorded progress disagrees with the current game.`)};
}
