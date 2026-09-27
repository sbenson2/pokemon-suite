import {createCampaignPlanner} from '../src/player/campaign.js';
import {createCentralPlayer} from '../src/player/delegator.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';

function map(id,{connections=[],warpEvents=[],objectEvents=[],door=false}={}) {
  return {id,connections,warpEvents,objectEvents,coordEvents:[],properties:{},
    layout:{width:8,height:6,blockDataSha256:id,cells:Array.from({length:48},(_,i)=>{
      const x=i%8,y=Math.floor(i/8);return {x,y,collision:door&&x===3&&y===2?1:0,elevation:3,encounterType:0,
        behaviorName:door&&x===3&&y===2?'MB_WARP_DOOR':'MB_NORMAL'};
    })}};
}

export function campaignTaskFixture({training=false}={}) {
  const route=map('MAP_TASK_ROUTE',{connections:[{direction:'down',map:'MAP_TASK_CITY',offset:0}],objectEvents:[
    {x:5,y:2,trainer_type:'TRAINER_TYPE_NORMAL',script:'TaskRoute_EventScript_Trainer'}]});
  const city=map('MAP_TASK_CITY',{connections:[{direction:'up',map:route.id,offset:0}],door:true,
    warpEvents:[{x:3,y:2,dest_map:'MAP_TASK_CITY_POKEMON_CENTER_1F',dest_warp_id:'0'}]});
  const center=map('MAP_TASK_CITY_POKEMON_CENTER_1F',{warpEvents:[{x:3,y:5,dest_map:city.id,dest_warp_id:'0'}],
    objectEvents:[{x:3,y:1,script:'TaskCity_PokemonCenter_1F_EventScript_Nurse'}]});
  const world={maps:[route,city,center]};
  const story={symbols:{trainers:{TRAINER_TASK_BASE:{value:41}}},scripts:[{label:'TaskRoute_EventScript_Trainer',
    instructions:[{op:'trainerbattle_single',args:['TRAINER_TASK_BASE','intro','defeat']}]}]};
  const mechanics={species:[{id:50,name:'SPECIES_DIGLETT',expYield:81}],moves:[{id:33,power:35,pp:35,type:'TYPE_NORMAL',accuracy:95}],
    trainers:[{id:41,name:'TRAINER_TASK_BASE',party:[{lvl:14,species:'SPECIES_DIGLETT'}]},
      {id:42,name:'TRAINER_TASK_REMATCH',party:[{lvl:22,species:'SPECIES_DIGLETT'}]}],
    rematches:[{map:route.id,trainerIds:[41,42],trainerNames:['TRAINER_TASK_BASE','TRAINER_TASK_REMATCH']}]};
  const objective=training?{id:'train-carrier',target:{kind:'roster-training'},minimumCoreLevel:36,coreSpecies:[4,5,6],
    completion:{kind:'party-member-minimum-level',species:[4,5,6],level:36}}:
    {id:'continue-story',target:{kind:'object',map:route.id,index:0},completion:{kind:'flag-set',id:9999}};
  const campaign={objectives:[objective]};
  const open=(state=null)=>{
    const planner=createCampaignPlanner({campaign,world,story,mechanics,initialState:state?.campaignPlanner??null});
    const player=createCentralPlayer({campaignPlanner:planner,mechanics,initialState:state,
      advisors:createPolicyAdvisors({world,story,mechanics,campaignPlanner:planner})});
    return {planner,player};
  };
  const party=[{slot:0,species:5,personality:101,otId:700,level:33,experience:30055,hp:87,maxHp:87,status1:0,moves:[33],pp:[35]},
    {slot:1,species:130,personality:202,otId:700,level:30,experience:34997,hp:41,maxHp:104,status1:0,moves:[33],pp:[35]}];
  const observation=(frame,{map=route.id,responses=true,healed=false,members=party,mode='overworld',phase='stable'}={})=>{
    const captureId=`task-${frame}`;
    const current=structuredClone(members);if(healed)for(const p of current){p.hp=p.maxHp;p.status1=0;p.pp=[35];}
    return {captureId,frame,phase,phaseReasons:[],sram:{captureId,frame,sha256:'task-sram'},
      emulator:{captureId,frame,mode,inputReady:true,callback2:'CB2_Overworld'},
      playerMemory:{captureId,frame,sha256:'task-memory',map:{id:map},position:{x:2,y:3},ui:{},
        storyState:{flagIds:{658:true,1321:true,1322:false,9999:false},variableIds:{0x407d:1}},
        vsSeeker:{batterySteps:responses?0:100,responseClearSteps:0,rematchEntries:[0,responses?1:0,...Array(98).fill(0)]},
        trainer:{party:current,partyCount:current.length,partyValidity:'valid',usablePartyCount:current.length,bag:{keyItems:[{itemId:362,quantity:1}],items:[]}}}};
  };
  return {world,story,mechanics,campaign,objective,route,city,center,party,observation,open};
}
