import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignPlanner,MAIN_STORY_CAMPAIGN,createMasterCampaign} from '../src/player/campaign.js';
import {createMasterTeamPlan} from '../src/player/origins-team.js';
import {describeStoryCheckpoint} from '../src/player/story-checkpoints.js';

const observation=(flags={})=>({phase:'stable',frame:123,emulator:{mode:'overworld'},playerMemory:{
  map:{id:'MAP_CINNABAR_ISLAND'},position:{x:20,y:6},storyState:{flagIds:flags,variableIds:{},variables:{}},
  trainer:{party:[{species:1,level:5,hp:20,maxHp:20,moves:[]}],bag:{}}}});
const resumed=id=>createCampaignPlanner({initialState:{schema:'master-red/campaign-planner-state/v1',completedThroughObjectiveId:id}});
const entries=p=>p.chapters.flatMap(c=>c.entries);

test('story progress separates Sabrina, the current map, and the remaining Cinnabar prerequisites without changing the planner',()=>{
  const planner=resumed('badge-soul'),before=planner.state();
  const p=planner.storyProgress(observation({2080:true,2081:true,2082:true,2083:true,2084:true,2085:false,2086:false,2087:false,424:false,83:true,678:true}));
  assert.equal(p.current.id,'badge-marsh');assert.match(p.current.label,/Sabrina/);
  assert.equal(p.location,'Cinnabar Island');assert.equal(p.badges.earned,5);
  const list=entries(p),s=list.find(e=>e.id==='badge-marsh'),v=list.find(e=>e.id==='badge-volcano');
  assert.equal(s.status,'current');assert.equal(v.status,'pending');
  assert.ok(v.prerequisites.some(e=>e.id==='secret-key'&&e.status==='pending'));
  assert.ok(!v.prerequisites.some(e=>e.id==='badge-marsh'),'planned order is not a cartridge door requirement');
  assert.ok(list.findIndex(e=>e.id==='badge-marsh')<list.findIndex(e=>e.id==='secret-key'));
  assert.deepEqual(planner.state(),before,'presentation cannot advance the saved campaign');
  assert.deepEqual(resumed(before.completedThroughObjectiveId).storyProgress(observation({2085:false})),planner.storyProgress(observation({2085:false})));
});

test('historical completion is distinct from native evidence; missing or contradictory badges are not invented',()=>{
  const planner=resumed('badge-marsh'),p=planner.storyProgress(observation({2084:true,2085:false}));
  assert.equal(entries(p).find(e=>e.id==='badge-marsh').status,'needs-review');
  assert.equal(entries(p).find(e=>e.id==='oak-parcel').evidence,'recorded');
  assert.equal(p.badges.earned,1);assert.equal(p.badges.known,2);
  const unknown=planner.storyProgress(null);assert.equal(unknown.badges.known,0);
  assert.equal(entries(unknown).find(e=>e.id==='badge-marsh').status,'unknown');
  assert.equal(planner.storyProgress({...observation({2085:true}),phase:'transition'}).badges.known,0);
});

test('every base, interlude and random-team checkpoint has an action, location policy and completion explanation',()=>{
  for(const starter of [1,4,7])for(const seed of [0,1,2,11]) {
    const c=createMasterCampaign(createMasterTeamPlan(starter,seed));
    for(const o of [...MAIN_STORY_CAMPAIGN.objectives,...c.objectives,...c.mandatoryInterludes.flatMap(i=>i.objectives)]) {
      const d=describeStoryCheckpoint(o);assert.ok(d.label.length>3,o.id);assert.ok(d.detail.length>15,o.id);
      assert.ok(d.completion.length>12,o.id);assert.ok(d.location,o.id);
      assert.ok(!d.detail.includes('undefined'),o.id);
    }
  }
});

test('future transient scenes and recovery checks remain pending and the Sevii trip is conditional',()=>{
  const p=resumed('badge-soul').storyProgress(observation({88:false,424:false})),list=entries(p);
  assert.equal(list.find(e=>e.id==='victory-road-drop-boulder').status,'pending');
  assert.equal(list.find(e=>e.id==='league-heal').status,'pending');
  assert.equal(list.find(e=>e.id==='sevii-sail-one-island').status,'conditional');
});
