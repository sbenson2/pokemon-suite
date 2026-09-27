import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';

async function open(options){
 const m=await import('../src/player/live-video.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 assert.equal(typeof m.createLatestFrameWriter,'function');return m.createLatestFrameWriter(options);
}
test('a slow stream retains only the newest complete frame and resumes when its consumer drains',async()=>{
 const output=new EventEmitter(),writes=[];output.writableNeedDrain=true;
 const writer=await open({output,write:(frame,done)=>{writes.push(frame);done();}});
 for(let sequence=1;sequence<=1000;sequence++)writer.push({sequence});
 assert.equal(writes.length,0);output.writableNeedDrain=false;output.emit('drain');
 assert.deepEqual(writes,[{sequence:1000}]);
 writer.push({sequence:1001});assert.equal(writes.at(-1).sequence,1001);writer.close();
});
test('compression owns one whole packet at a time and cancellation releases the pending frame',async()=>{
 const output=new EventEmitter(),writes=[];let complete;
 const writer=await open({output,write:(frame,done)=>{writes.push(frame);complete=done;}});
 writer.push({sequence:1});writer.push({sequence:2});writer.push({sequence:3});
 assert.deepEqual(writes,[{sequence:1}]);complete();assert.deepEqual(writes,[{sequence:1},{sequence:3}]);
 writer.push({sequence:4});writer.close();complete();output.emit('drain');writer.push({sequence:5});
 assert.equal(writes.length,2);assert.equal(output.listenerCount('drain'),0);
});
