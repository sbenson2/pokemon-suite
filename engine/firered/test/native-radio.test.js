import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeRadioLink,nativeRadioArguments,nativeRadioCommand} from '../src/suite/native-radio.js';

test('local radio launches the bundled bridge without putting credential contents in arguments',()=>{
 const command=nativeRadioCommand({transport:'appliance',runtime:{python:'/App Runtime/python',bridge:'/App Suite/radio.py',root:'/App Runtime/RadioHost'},keysPath:'/private/console.keys',stateDir:'/profile/firered',host:'user@host',knownHosts:'/private/known'});
 assert.equal(command.executable,'/App Runtime/python');
 assert.deepEqual(command.args,['-B','/App Suite/radio.py','--runtime','/App Runtime/RadioHost','--keys','/private/console.keys','--state-dir','/profile/firered']);
});

test('a local radio with no first response has a bounded startup deadline',()=>{
 const link=Object.assign(linkAt('starting',0),{lastStatus:0,startedAt:Date.now()-46000,state:{available:false}});
 assert.match(link.status().reason??'',/start/i);
});

test('wireless SSH can bind the VM interface without relaxing host verification',()=>{
 const args=nativeRadioArguments({host:'user@192.168.64.2',knownHosts:'/private/known hosts',bindAddress:'192.168.64.1'});
 assert.equal(args[args.indexOf('-b')+1],'192.168.64.1');
 assert.ok(args.includes('StrictHostKeyChecking=yes'));
 assert.ok(args.includes('UserKnownHostsFile=/private/known hosts'));
 assert.throws(()=>nativeRadioArguments({host:'user@host',knownHosts:'file',bindAddress:'127.0.0.1;bad'}));
});

// Exercise the status watchdog without opening a physical radio or SSH session.
const linkAt = (type, age) => Object.assign(Object.create(NativeRadioLink.prototype), {
 lastStatus: Date.now()-age, error: null, log:()=>{},
 state: {type, available:true, advertising:type==='status', connected:false},
 peripheral: {status:()=>({mode:1})},
});

test('allows AP setup to exceed the running radio heartbeat deadline',()=>{
 const link=linkAt('available',6000);
 assert.equal(link.status().reason,null);
 assert.equal(link.status().available,true);
 assert.equal(link.status().advertising,false);
});

test('still stops a running radio after its status goes stale',()=>{
 const status=linkAt('status',6000).status();
 assert.equal(status.available,false);
 assert.equal(status.advertising,false);
 assert.match(status.reason,/expired/);
});

test('does not wait indefinitely for AP setup',()=>{
 const status=linkAt('available',31000).status();
 assert.equal(status.available,false);
 assert.equal(status.advertising,false);
 assert.match(status.reason,/expired/);
});


import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
function radioHarness(){
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
 let listener;const written=[];child.stdin.on('data',b=>written.push(...b.toString().trim().split('\n').map(JSON.parse)));
 const peripheral={subscribe:f=>{listener=f;return()=>{};},status:()=>({mode:1}),receive:()=>{}};
 const link=new NativeRadioLink({transport:'appliance',runtime:{python:'/nonexistent/test-radio',bridge:'/bridge',root:'/runtime'},keysPath:'/keys',stateDir:'/state',peripheral,spawnProcess:()=>child});
 const reply=m=>child.stdout.write(JSON.stringify(m)+'\n');
 reply({type:'available',advertising:false});reply({type:'flow',received:0,pending:0});
 return {link,reply,emit:n=>listener({peer:0,packet:Buffer.from('524655310000000500000001'+n.toString(16).padStart(2,'0'),'hex')}),packets:()=>written.filter(m=>m.type==='packet')};
}
test('flow control bounds a burst across the guest pipe and releases every packet once in order',()=>{
 const h=radioHarness();
 try{
  for(let n=0;n<40;n++)h.emit(n);
  assert.equal(h.packets().length,8);assert.equal(h.link.canAdvanceFrame(),false);
  h.reply({type:'flow',received:8,pending:8});assert.equal(h.packets().length,8);
  for(let received=8;received<=40;received+=8)h.reply({type:'flow',received,pending:0});
  assert.deepEqual(h.packets().map(p=>parseInt(p.hex.slice(-2),16)),Array.from({length:40},(_,i)=>i));
  assert.equal(h.link.canAdvanceFrame(),true);assert.equal(h.link.status().reason,null);
 }finally{h.link.close();}
});
test('impossible or backwards flow receipts fail instead of releasing unsent packets',()=>{
 for(const bad of [{received:9,pending:0},{received:0,pending:1},{received:-1,pending:0}]){
  const h=radioHarness();try{h.emit(1);h.reply({type:'flow',...bad});assert.match(h.link.status().reason??'',/flow/i);}finally{h.link.close();}
 }
 const h=radioHarness();try{h.emit(1);h.reply({type:'flow',received:1,pending:0});h.reply({type:'flow',received:0,pending:0});assert.match(h.link.status().reason??'',/flow/i);}finally{h.link.close();}
});
test('a lost relay cannot deadlock an input action waiting on flow control',()=>{
 const h=radioHarness();try{for(let n=0;n<8;n++)h.emit(n);h.link.lastStatus=Date.now()-31000;assert.equal(h.link.canAdvanceFrame(),true);assert.match(h.link.status().reason,/expired/);}finally{h.link.close();}
});
