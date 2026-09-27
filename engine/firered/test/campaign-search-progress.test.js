import assert from 'node:assert/strict';
import test from 'node:test';
import {createCampaignSupervisor} from '../src/player/campaign-supervisor.js';
import {createCampaignEpisodeMonitor} from '../src/player/campaign-episode.js';
const objective={id:'assemble-roster',captureSpecies:[115],target:{kind:'encounter-zone',map:'MAP_SAFARI_ZONE_EAST'}};
function observed(frame,{battle=false,pid=123,species=46,map=objective.target.map,phase='stable',outcome=4}={}) {
 return {frame,phase,emulator:{mode:battle?'battle':'overworld',inBattle:battle},playerMemory:{map:{id:map},ui:{},trainer:{party:[]},
  encounter:battle?{kind:'wild',validity:'valid',pokemon:{validity:'valid',species,personality:pid,otId:91,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}}}:null,battleOutcome:battle?0:outcome}};
}
const update=(o,extra={})=>({observation:o,objective,...extra});
test('completed independent encounters in the capture habitat count as search progress',()=>{
 let now=0;const s=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100});
 s.observe(update(observed(1)));
 for(let i=0;i<4;i++){
  now+=45;s.observe(update(observed(2+i*2,{battle:true,pid:123+i})));
  now+=40;assert.equal(s.observe(update(observed(3+i*2))).stopReason,null);
 }
 assert.equal(s.state().search.completedEncounters,4);
 now+=101;assert.equal(s.observe(update(observed(12))).stopReason,'no-meaningful-progress','walking after the final encounter must still time out');
});
test('restoring during a search encounter preserves its identity and credits its completion once',()=>{
 let now=0;let s=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100});
 s.observe(update(observed(1)));now=60;s.observe(update(observed(2,{battle:true})));
 const saved=JSON.parse(JSON.stringify(s.state()));now=10000;s=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100,initialState:saved});
 now+=20;assert.equal(s.observe(update(observed(3))).stopReason,null);
 assert.equal(s.state().search.completedEncounters,1);
 now+=60;s.observe(update(observed(4,{battle:true})));
 now+=41;assert.equal(s.observe(update(observed(5))).stopReason,'no-meaningful-progress','replaying the same individual is not another search attempt');
});
for(const scenario of ['wrong-map','wrong-objective','unfinished','transition','recap','trainer','tutorial','invalid','blackout','skipped-target'])test(`${scenario} cannot renew the capture search watchdog`,()=>{
 let now=0;const s=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100});
 const map=scenario==='wrong-map'?'MAP_ROUTE1':objective.target.map;
 s.observe(update(observed(1,{map})));
 const o=observed(2,{battle:true,map,species:scenario==='skipped-target'?115:46});
 if(scenario==='wrong-map')o.playerMemory.map.id='MAP_ROUTE1';
 if(scenario==='transition')o.phase='transition';
 if(scenario==='recap')o.playerMemory.questLog={playback:true};
 if(['trainer','tutorial'].includes(scenario))o.playerMemory.encounter.kind=scenario;
 if(scenario==='invalid')o.playerMemory.encounter.pokemon.validity='unknown';
 now=70;s.observe(update(o));
 const end=scenario==='unfinished'?observed(3,{battle:true}):observed(3,{map,outcome:scenario==='blackout'?2:4});
 now=90;s.observe(update(end,scenario==='wrong-objective'?{objective:{...objective,id:'other'}}:{}));
 now=101;assert.equal(s.observe(update(observed(4,{map,battle:scenario==='unfinished'}))).stopReason,'no-meaningful-progress');
});
test('a target that flees after an actual capture command is a completed attempt',()=>{
 let now=0;const s=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100});s.observe(update(observed(1)));
 now=60;const o=observed(2,{battle:true,species:115});s.observe(update(o));
 s.recordDecision(update(o,{decision:{kind:'act',winner:{recommendation:{kind:'choose-safari-command',targetAction:'ball'}}}}));
 now=90;s.observe(update(observed(3,{outcome:6})));
 now=150;assert.equal(s.observe(update(observed(4))).stopReason,null);
 assert.equal(s.state().search.completedEncounters,1);
});
test('qualification uses the same search progress rules as the live campaign',()=>{
 let now=0;const m=createCampaignEpisodeMonitor({clock:()=>now,progressTimeoutMs:100,maxGameSeconds:null,target:'hall-of-fame'});
 m.observe(update(observed(1)));now=60;m.observe(update(observed(2,{battle:true})));
 now=90;m.observe(update(observed(3)));now=150;
 assert.equal(m.observe(update(observed(4))).stopReason,null);
});
