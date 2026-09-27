import {createLocalGame} from './host.js';
import {Buffer} from 'buffer';

let game=null;
const send=value=>globalThis.webkit.messageHandlers.suiteEvent.postMessage(value);
const resource=async name=>{try{const r=await fetch(name);if(!r.ok)throw Error(`status ${r.status}`);return r;}catch(error){throw Error(`Local resource ${name}: ${error.message}`);}};
const json=async name=>(await resource(name)).json();
const bytes=async name=>new Uint8Array(await (await resource(name)).arrayBuffer());
const canvas=document.querySelector('canvas'),context=canvas.getContext('2d',{alpha:false});
async function load(){
 await game?.close();game=null;
 const [rom,wasm,manifest,inputs,saved]=await Promise.all([
  bytes('cartridge.gba'),bytes('mgba.wasm'),json('build-manifest.json'),
  Promise.all(['runtime','world','story','battle'].map(async k=>[k,await json(k+'.json')])).then(Object.fromEntries),
  json('current.json')]);
 game=await createLocalGame({assets:{rom,wasm,manifest,inputs},createModule:globalThis.createMgbaModule,checkpoint:saved.checkpoint,
  onFrame(frame){context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba),frame.width,frame.height),0,0);},
  onAudio(pcm,format){if(format)send({type:'audio',pcm:Buffer.from(pcm).toString('base64'),sampleRate:format.sampleRate});},
  onStatus(status){send({type:'status',status});},
  persist:checkpoint=>globalThis.webkit.messageHandlers.suiteSave.postMessage(JSON.stringify(checkpoint))});
 send({type:'status',status:game.status()});
 return game.status();
}
globalThis.suite={async command(command){
 try{
  if(command.action==='load')return await load();
  if(!game)throw Error('Import FireRed before starting a game.');
  if(command.action==='prepare')return game.prepareCampaign(command.settings??{});
  if(command.action==='start')return await game.startCampaign();
  if(command.action==='pause')return await game.pause().then(()=>game.status());
  if(command.action==='manual')return await game.manual();
  if(command.action==='buttons'){game.buttons(command.buttons??[]);return null;}
  if(command.action==='checkpoint')return await game.checkpoint().then(()=>game.status());
  if(command.action==='close'){await game.close();game=null;return null;}
  throw Error('Unknown local game command.');
 }catch(error){send({type:'error',message:error.message});throw error;}
}};
addEventListener('error',event=>send({type:'error',message:event.message}));
addEventListener('unhandledrejection',event=>send({type:'error',message:event.reason?.message??String(event.reason)}));
send({type:'ready'});
