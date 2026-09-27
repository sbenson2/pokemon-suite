import assert from 'node:assert/strict';
import test from 'node:test';

const digest='a'.repeat(64);
const picture=()=>({width:2,height:1,rgba:Uint8Array.from([12,34,56,255,78,90,12,255])});
async function api(){
  const module=await import('../src/suite/save-preview.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
  assert.equal(typeof module.captureSavePreview,'function');
  assert.equal(typeof module.createRestoredVideoSession,'function');return module;
}
test('a paused checkpoint reopens with its saved picture without taking a game step',async()=>{
  const {captureSavePreview,createRestoredVideoSession}=await api();
  const saved=captureSavePreview({session:{frame:42,videoFrame:picture},stateSha256:digest});
  let steps=0;
  const session={frame:42,videoFrame:()=>({...picture(),rgba:new Uint8Array(8)}),step:()=>steps++};
  const display=createRestoredVideoSession({session,checkpoint:{stateSha256:digest,metadata:{frame:42,preview:saved}}});
  assert.deepEqual(display.videoFrame(),picture());assert.equal(display.frame,42);assert.equal(steps,0);
  const resaved=captureSavePreview({session:display,stateSha256:digest});
  assert.deepEqual(resaved,saved,'closing while paused preserves the picture on the next reopen');
});
test('the saved picture expires when gameplay resumes and cannot cover a real black fade',async()=>{
  const {captureSavePreview,createRestoredVideoSession}=await api();
  const preview=captureSavePreview({session:{frame:42,videoFrame:picture},stateSha256:digest});
  let frame={...picture(),rgba:new Uint8Array(8)};
  const session={frame:42,videoFrame:()=>frame};
  const display=createRestoredVideoSession({session,checkpoint:{stateSha256:digest,metadata:{frame:42,preview}}});
  assert.deepEqual(display.videoFrame(),picture());
  frame={...picture(),rgba:Uint8Array.from([0,0,0,255,0,0,0,255])};
  assert.deepEqual(display.videoFrame(),frame,'native black frames own the display');
  session.frame=43;frame={...picture(),rgba:new Uint8Array(8)};display.videoFrame();session.frame=42;
  assert.deepEqual(display.videoFrame(),frame,'an old checkpoint cannot leak into later resets');
});
test('invalid or differently bound preview data cannot replace the native display',async()=>{
  const {captureSavePreview,createRestoredVideoSession}=await api();
  const preview=captureSavePreview({session:{frame:42,videoFrame:picture},stateSha256:digest});
  const native={...picture(),rgba:new Uint8Array(8)},session={frame:42,videoFrame:()=>native};
  for(const invalid of [{...preview,stateSha256:'b'.repeat(64)},{...preview,frame:41},{...preview,data:'invalid'},
    {...preview,sha256:'b'.repeat(64)},{...preview,width:100000},null]){
    const display=createRestoredVideoSession({session,checkpoint:{stateSha256:digest,metadata:{frame:42,preview:invalid}}});
    assert.deepEqual(display.videoFrame(),native);
  }
  assert.equal(captureSavePreview({session,stateSha256:digest}),null,'an unpainted framebuffer is never saved as the preview');
});
