import test from 'node:test';
import assert from 'node:assert/strict';
import {StaticMission} from '../src/suite/static-mission.js';
const world={data:{maps:[{id:'MAP_MT_EMBER_SUMMIT',objectEvents:[{script:'MtEmber_Summit_EventScript_Moltres'}]}]}};
const request={game:'firered',speciesId:146,quantity:1,locationId:'any',encounterLevel:{min:1,max:100},ball:{requirement:'preferred',id:'any'},limits:{maxMinutes:120,maxEncounters:1000},shiny:'required'};
const make=state=>new StaticMission({id:'moltres',request,world,state});
const o=(map,objects=[])=>({frame:1,phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:map},position:{x:28,y:47},ui:{},objectEvents:objects,trainer:{party:[{validity:'valid',species:55,hp:100,maxHp:100,moves:[70],pp:[15]}],bag:{pokeBalls:[{itemId:2,quantity:40}]}}}});
test('Moltres breaks the distant summit objective into a retained observed Strength route',()=>{
 let m=make();assert.equal(m.inspect(o('MAP_ONE_ISLAND_HARBOR')).objective.target.map,'MAP_MT_EMBER_EXTERIOR');
 let obs=o('MAP_MT_EMBER_EXTERIOR',[{localId:9,current:{x:22,y:45}},{localId:10,current:{x:17,y:46}}]);
 let next=m.inspect(obs);assert.equal(next.objective.target.kind,'push-boulder');assert.equal(next.objective.target.objectIndex,8);
 obs.playerMemory.objectEvents[0].current={x:20,y:45};m=make(m.state);next=m.inspect(obs);assert.equal(next.objective.target.objectIndex,8,'partial pushes survive restart');
 obs.playerMemory.objectEvents[0].current={x:19,y:45};next=m.inspect(obs);assert.equal(next.objective.target.objectIndex,9);
 obs.playerMemory.objectEvents[1].current={x:14,y:46};assert.equal(m.inspect(obs).objective.target.map,'MAP_MT_EMBER_SUMMIT_PATH_1F');
 obs=o('MAP_MT_EMBER_SUMMIT_PATH_1F');m=make(m.state);assert.equal(m.inspect(obs).objective.target.map,'MAP_MT_EMBER_SUMMIT_PATH_2F');
});
test('Moltres summit push completion survives restart and only then hands off to its encounter',()=>{
 let m=make(),obs=o('MAP_MT_EMBER_SUMMIT',[{localId:2,current:{x:10,y:12}},{localId:3,current:{x:9,y:12}},{localId:4,current:{x:8,y:11}},{localId:5,current:{x:8,y:10}}]);
 assert.equal(m.inspect(obs).objective.target.objectIndex,1);
 for(const [i,pos] of [[0,{x:10,y:11}],[1,{x:8,y:12}],[2,{x:7,y:11}],[3,{x:8,y:9}]]){obs.playerMemory.objectEvents[i].current=pos;m=make(m.state);m.inspect(obs);}
 assert.equal(m.inspect(obs).objective.target.objectIndex,4);
 obs.playerMemory.objectEvents[3].current={x:10,y:9};assert.equal(m.inspect(obs).objective.target.kind,'object');assert.equal(m.inspect(obs).objective.target.index,0);
});

test('a Strength interaction on the summit cannot become the legendary encounter anchor',()=>{
 const m=make(),obs=o('MAP_MT_EMBER_SUMMIT');obs.playerMemory.gameStats={savedGame:10};obs.sram={sha256:'unchanged'};
 assert.equal(m.beforeInteraction(obs,{winner:{recommendation:{kind:'interact-with-object',objective:'moltres-strength-required'}}}),false);
 assert.equal(m.state.phase,'traveling');
 assert.equal(m.beforeInteraction(obs,{winner:{recommendation:{kind:'interact-with-object',objective:'hunt-moltres'}}}),true);
 assert.equal(m.state.phase,'saving-anchor');
});

test('observed completed pushes remain complete when boulders leave scan range, but a reloaded map is rechecked',()=>{
 let m=make(),obs=o('MAP_MT_EMBER_EXTERIOR',[{localId:9,current:{x:19,y:45}},{localId:10,current:{x:14,y:46}}]);
 assert.equal(m.inspect(obs).objective.target.map,'MAP_MT_EMBER_SUMMIT_PATH_1F');
 m=make(m.state);obs.playerMemory.position={x:9,y:36};obs.playerMemory.objectEvents=[];
 assert.equal(m.inspect(obs).objective.target.map,'MAP_MT_EMBER_SUMMIT_PATH_1F');
 obs.playerMemory.objectEvents=[{localId:10,current:{x:17,y:46}}];
 assert.equal(m.inspect(obs).objective.target.map,'MAP_MT_EMBER_SUMMIT_PATH_1F','offscreen boulder respawn behind the player does not reclaim the completed passage');
 m.inspect(o('MAP_MT_EMBER_SUMMIT_PATH_1F'));
 obs.playerMemory.objectEvents=[{localId:9,current:{x:22,y:45}},{localId:10,current:{x:17,y:46}}];
 assert.equal(m.inspect(obs).objective.target.kind,'push-boulder');
});
