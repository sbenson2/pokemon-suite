import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
import {postgameChecklist} from '../src/suite/postgame-agenda.js';

const center='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
const stock=['ITEM_ULTRA_BALL','ITEM_GREAT_BALL','ITEM_FULL_RESTORE','ITEM_MAX_POTION','ITEM_REVIVE','ITEM_FULL_HEAL','ITEM_MAX_REPEL'];
const story={data:{scripts:[{label:'Shop',instructions:[{op:'pokemart',args:['Stock']}]},{label:'Stock',instructions:stock.map(name=>({op:'.2byte',args:[name]}))}],symbols:{items:Object.fromEntries(stock.map((name,i)=>[name,{value:[2,3,19,20,24,23,84][i]}]))}}};
const world={data:{maps:[{id:center,objectEvents:[{script:'Shop'},{script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}]},{id:'MAP_FOUR_ISLAND_HOUSE2',objectEvents:[{script:'FourIsland_House2_EventScript_StickerMan'}]}],wildEncounters:[]}};
const mechanics={data:{moves:[{id:33,pp:35,power:40,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}],species:[{id:132,name:'SPECIES_DITTO',eggGroups:['EGG_GROUP_DITTO'],genderRatio:'MON_GENDERLESS'},{id:16,name:'SPECIES_PIDGEY',eggGroups:['EGG_GROUP_FLYING'],genderRatio:{call:'PERCENT_FEMALE',args:[50]}}]}};
const mon=(species,personality)=>({slot:0,species,personality,otId:10,validity:'valid',shiny:false,isEgg:false,heldItem:0,moves:[33],pp:[35],hp:100,maxHp:100,level:80,status1:0});
const observation=()=>({captureId:'egg-budget',frame:100,phase:'stable',sram:{sha256:'saved',captureId:'egg-budget',frame:100},emulator:{captureId:'egg-budget',frame:100,mode:'overworld',inBattle:false,inputReady:true},playerMemory:{captureId:'egg-budget',frame:100,map:{id:center},position:{x:5,y:5},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{0x404a:1}},gameStats:{savedGame:10,eggsHatched:1},saveAttemptStatus:1,trainer:{partyValidity:'valid',party:[mon(22,3)],usablePartyCount:1,money:30000,bag:{items:[],pokeBalls:[]},storage:{validity:'valid',pokemon:[mon(132,1),mon(16,2)],boxCounts:[2,...Array(13).fill(0)]},pokedex:{ownedSpecies:[132,16,22]}}}});

test('Egg work keeps the daycare recovery reserve before agenda.active is selected',()=>{
 const o=observation(),now=1000;
 const controller=createPostgameController({world,story,mechanics,clock:()=>now});controller.beginAdventure();
 const state=controller.state();state.preparation={kind:'postgame',phase:'complete'};
 for(const entry of postgameChecklist(o,state.agenda.workflows))if(entry.id!=='egg-sticker'&&entry.status!=='complete')state.agenda.failures[entry.id]={attempts:1,retryAt:now+86400000};
 const restarted=createPostgameController({world,story,mechanics,clock:()=>now,state});
 restarted.decide(o);
 assert.equal(restarted.state().agenda.active,'egg-sticker',JSON.stringify({objective:restarted.state().objective,fieldCare:restarted.state().fieldCare,preparation:restarted.state().preparation}));
 assert.equal(restarted.state().fieldCare.active?.kind,undefined,'generic shopping must not claim the money first');
 assert.equal(restarted.state().acquisition?.kind,'breeding',JSON.stringify({objective:restarted.state().objective,acquisition:restarted.state().acquisition}));
});
