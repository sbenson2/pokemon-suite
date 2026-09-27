import test from 'node:test';
import assert from 'node:assert/strict';
import {canContinuePostgame} from '../src/suite/postgame.js';

// Live September 23: a Slugma hunt for the National Dex exhausted its navigation
// recovery and was handed back to the checklist, which deferred the objective
// and continued. An Emerald evolution exchange later paused the postgame; when
// it finished, the still-attached blocked hunt and its needs-review recovery
// prevented the postgame from resuming. A released hunt keeps its own stop, but
// no longer holds the checklist that already moved on.
const released={id:'postgame-national-collection-1',status:'blocked',reason:'repeated-navigation-cycle',postgameObjective:'national-collection',protected:false};
const base={enabled:true,running:false,wireless:{remotePlayers:0},mission:released,
 postgame:{status:'running',agenda:{enabled:true,hunts:{},failures:{'national-collection':{reason:'repeated-navigation-cycle'}}}},
 recovery:{huntId:released.id,status:'needs-review'}};

test('a blocked hunt the checklist already released does not stop the postgame from resuming',()=>{
 assert.equal(canContinuePostgame(base),true);
 assert.equal(canContinuePostgame({...base,recovery:null}),true);
});

test('protected, still-held or running hunts keep holding the postgame',()=>{
 assert.equal(canContinuePostgame({...base,mission:{...released,protected:true}}),false,'a protected capture is never left behind');
 assert.equal(canContinuePostgame({...base,postgame:{...base.postgame,agenda:{...base.postgame.agenda,hunts:{'national-collection':{id:released.id}}}}}),false,'the agenda still owns this hunt');
 assert.equal(canContinuePostgame({...base,mission:{...released,status:'running'}}),false);
 assert.equal(canContinuePostgame({...base,mission:{...released,postgameObjective:null}}),false,'an ordinary task hunt is not a checklist hunt');
 assert.equal(canContinuePostgame({...base,postgame:{...base.postgame,agenda:{...base.postgame.agenda,enabled:false}}}),false);
 assert.equal(canContinuePostgame({...base,recovery:{huntId:released.id,status:'recovering'}}),false,'an active recovery still owns the game');
 assert.equal(canContinuePostgame({...base,postgame:{...base.postgame,status:'waiting'}}),false);
 assert.equal(canContinuePostgame({...base,enabled:false}),false);
});
