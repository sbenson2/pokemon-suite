// Fault injection stays in test support. All decisions below use the real
// planner; this worker never receives an emulator or a memory-write interface.
import {createCampaignPlanner} from '../src/player/campaign.js';
import {createCentralPlayer} from '../src/player/delegator.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';

export function createCampaignController({state,world,story,mechanics,objective,gate}){
 const planner=createCampaignPlanner({world,story,mechanics,campaign:{objectives:[objective]},initialState:state?.campaignPlanner??null});
 const player=createCentralPlayer({campaignPlanner:planner,mechanics,initialState:state,
  advisors:createPolicyAdvisors({world,mechanics,campaignPlanner:planner})});
 return {state:()=>player.state(),storyWatch:()=>planner.storyWatch(),campaignStatus:()=>planner.campaignStatus(),
  decide(o){if(Atomics.sub(new Int32Array(gate),0,1)>0)while(true){}return player.decide(o);},
  observeExecution:o=>player.observeExecution(o)};
}
