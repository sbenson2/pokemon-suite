import test from 'node:test';
import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createNativeLocalLink} from '../src/suite/native-local-link.js';

const peripheral=()=>{
 const listeners=new Set(),received=[];
 return {received,mode:0,epoch:1,status(){return {attached:true,mode:this.mode,epoch:this.epoch,dropped:0};},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  send(peer,packet){for(const fn of listeners)fn({peer,packet});},
  receive(packet,peer){received.push({packet:Buffer.from(packet),peer});}};
};
const packet=(kind=5,value=4)=>{const b=Buffer.alloc(kind===0?36:kind===5||kind===6?104:16);b.writeUInt32BE(0x52465531);b.writeUInt32BE(kind,4);b.writeUInt32BE(value,8);return b;};
async function until(check){for(let i=0;i<100;i++){if(check())return;await sleep(10);}assert.fail('Local link did not reach the expected state');}
async function pair(t){
 const a=peripheral(),b=peripheral(),config={pairId:'evolution-owned-pair',token:randomBytes(32).toString('hex')};
 const host=await createNativeLocalLink({...config,role:'leader',game:'firered',peerGame:'emerald',peripheral:a,port:0});t.after(()=>host.close());
 const guest=await createNativeLocalLink({...config,role:'guest',game:'emerald',peerGame:'firered',peripheral:b,port:host.port});t.after(()=>guest.close());
 await until(()=>host.status().available&&guest.status().available);
 return {host,guest,a,b,config};
}
test('a disconnect does not erase the final queued native command before the receiving game closes its adapter',async t=>{
 const {host,guest,a,b}=await pair(t);
 b.mode=3;let unread=0;
 const receive=b.receive.bind(b);
 b.receive=(packet,peer)=>{receive(packet,peer);if(packet.readUInt32BE(4)===5)unread++;if(packet.readUInt32BE(4)===4)unread=0;};
 a.send(1,packet(5));a.send(1,packet(4));a.send(1,packet(7));
 await until(()=>b.received.length>0);await sleep(30);
 assert.equal(unread,1,'native disconnect must not clear the command waiting for the next emulated frame');
 assert.equal(guest.status().drainingDisconnect,true);
 assert.equal(guest.status().connected,false);
 // The native game consumes its command and closes the adapter itself.
 unread--;b.mode=0;guest.status();
 assert.deepEqual(b.received.map(p=>p.packet.readUInt32BE(4)),[5,4,7]);
 assert.equal(guest.status().drainingDisconnect,false);
 assert.equal(host.status().reason,null);
});
test('an unexpected disconnect is delivered after the bounded native drain even if the game never closes',async t=>{
 const {guest,a,b}=await pair(t);b.mode=3;
 let now=10000;t.mock.method(Date,'now',()=>now);
 a.send(1,packet(4));await sleep(30);
 assert.equal(b.received.length,0);
 assert.equal(guest.status().drainingDisconnect,true);
 now+=3001;guest.status();
 assert.deepEqual(b.received.map(p=>p.packet.readUInt32BE(4)),[4]);
 assert.equal(guest.status().drainingDisconnect,false);
});
test('closing a transport discards its pending disconnect without delivering it into a later adapter',async t=>{
 const {guest,a,b}=await pair(t);b.mode=3;
 a.send(1,packet(4));await sleep(30);
 assert.equal(b.received.length,0);guest.close();b.mode=0;guest.status();
 assert.equal(b.received.length,0);
 assert.equal(guest.status().drainingDisconnect,false);
});
test('the leader also drains before disconnect, and the deferred packet queue remains bounded',async t=>{
 const {host,guest,a,b}=await pair(t);a.mode=1;
 b.send(0,packet(4));await sleep(30);
 assert.equal(a.received.length,0);assert.equal(host.status().drainingDisconnect,true);
 // Deliver in small socket bursts so this tests the drain, not the separate
 // per-read receive-buffer limit.
 for(let i=0;i<85&&!host.status().reason;i++){
  b.send(0,packet(6));await sleep(2);
 }
 assert.match(host.status().reason,/disconnect drain exceeded/);
 assert.equal(host.status().drainingDisconnect,false);
 assert.equal(a.received.length,0);
 await until(()=>guest.status().reason);
});
test('pairs only the named games and forwards native bytes with stable peripheral peer IDs',async t=>{
 const {host,guest,a,b}=await pair(t);
 assert.equal(host.status().transport,'local');assert.equal(host.status().connected,false);
 a.mode=1;assert.equal(host.status().advertising,true);
 const broadcast=packet(0,123);a.send(65535,broadcast);
 const request=packet(1,321);b.send(0,request);
 await until(()=>a.received.length===1&&b.received.length===1);
 assert.deepEqual(b.received[0],{packet:broadcast,peer:0});
 assert.deepEqual(a.received[0],{packet:request,peer:1});
 assert.equal(host.status().connected,false);
 a.send(1,packet(2,456));await until(()=>guest.status().connected);
 assert.equal(host.status().link.adapterClient,456);assert.equal(guest.status().link.adapterClient,456);
 const burst=Array.from({length:9},(_,i)=>packet(5,i));for(const p of burst)a.send(1,p);
 await until(()=>b.received.length===11);
 assert.deepEqual(b.received.slice(2).map(p=>p.packet),burst);
 b.send(0,packet(6,16<<24));await until(()=>a.received.length===2);
 assert.deepEqual(a.received[1].packet,packet(6,16<<24));
 b.send(0,packet(4));await until(()=>!host.status().connected);
 assert.equal(host.status().available,true);
});

test('a native adapter restart followed by its connection ACK is not cleared by the next status read',async t=>{
 const {host,guest,a,b}=await pair(t);a.epoch++;b.epoch++;
 a.send(1,packet(2,456));await until(()=>b.received.length===1);
 assert.equal(host.status().connected,true);assert.equal(guest.status().connected,true);
 assert.equal(host.status().link.adapterClient,456);
 a.epoch++;assert.equal(host.status().connected,false);
});
test('an unauthenticated socket cannot inject RFU bytes or take the reserved partner',async t=>{
 const a=peripheral(),config={pairId:'reserved-evolution',token:randomBytes(32).toString('hex')};
 const host=await createNativeLocalLink({...config,role:'leader',game:'firered',peerGame:'emerald',peripheral:a,port:0});t.after(()=>host.close());
 const bad=connect({host:'127.0.0.1',port:host.port});bad.on('error',()=>{});bad.resume();t.after(()=>bad.destroy());
 bad.write(JSON.stringify({type:'packet',hex:packet(2).toString('hex')})+'\n');
 await until(()=>bad.destroyed);assert.deepEqual(a.received,[]);assert.equal(host.status().available,false);
 const guest=await createNativeLocalLink({...config,role:'guest',game:'emerald',peerGame:'firered',peripheral:peripheral(),port:host.port});t.after(()=>guest.close());
 await until(()=>host.status().available);
});
test('rejects a different request token without advertising or delivering packets',async t=>{
 const a=peripheral(),config={pairId:'reserved-evolution',token:randomBytes(32).toString('hex')};
 const host=await createNativeLocalLink({...config,role:'leader',game:'firered',peerGame:'emerald',peripheral:a,port:0});t.after(()=>host.close());
 const guest=await createNativeLocalLink({...config,token:randomBytes(32).toString('hex'),role:'guest',game:'emerald',peerGame:'firered',peripheral:peripheral(),port:host.port});t.after(()=>guest.close());
 await until(()=>guest.status().reason);assert.equal(host.status().available,false);assert.deepEqual(a.received,[]);
});
test('preserves a failed link as unavailable instead of silently dropping malformed or misaddressed data',async t=>{
 const {host,guest,a}=await pair(t);
 a.send(7,packet());await until(()=>guest.status().reason);
 assert.match(host.status().reason,/peer/);assert.equal(host.status().available,false);
});
test('closing one owner clears advertising and does not reconnect an exchange automatically',async t=>{
 const {host,guest,a}=await pair(t);a.mode=1;guest.close();
 await until(()=>host.status().reason);assert.equal(host.status().advertising,false);assert.equal(host.status().connected,false);
});
test('a native adapter reset invalidates the previous native connection',async t=>{
 const {host,guest,a}=await pair(t);a.send(1,packet(2,456));await until(()=>guest.status().connected);
 a.epoch++;assert.equal(host.status().connected,false);assert.equal(host.status().available,true);
});
test('invalid pairing configuration is rejected before opening a socket',async()=>{
 await assert.rejects(createNativeLocalLink({role:'leader',game:'firered',peerGame:'firered',pairId:'same-owner',token:'x',peripheral:peripheral(),port:0}),/pair/);
});

test('two FireRed owners can exchange native packets only with distinct authenticated save-owner identities',async t=>{
 const config={pairId:'two-firered-owners',token:randomBytes(32).toString('hex')},a=peripheral(),b=peripheral();
 await assert.rejects(createNativeLocalLink({...config,role:'leader',game:'firered',peerGame:'firered',ownerId:'same-save',peerOwnerId:'same-save',peripheral:a,port:0}),/pair/);
 const host=await createNativeLocalLink({...config,role:'leader',game:'firered',peerGame:'firered',ownerId:'primary-save',peerOwnerId:'partner-save',peripheral:a,port:0});t.after(()=>host.close());
 const wrong=await createNativeLocalLink({...config,role:'guest',game:'firered',peerGame:'firered',ownerId:'wrong-save',peerOwnerId:'primary-save',peripheral:peripheral(),port:host.port});t.after(()=>wrong.close());
 await until(()=>wrong.status().reason);assert.equal(host.status().available,false);assert.deepEqual(a.received,[]);
 const guest=await createNativeLocalLink({...config,role:'guest',game:'firered',peerGame:'firered',ownerId:'partner-save',peerOwnerId:'primary-save',peripheral:b,port:host.port});t.after(()=>guest.close());
 await until(()=>host.status().available&&guest.status().available);
 const payload=packet(5,3);a.send(1,payload);await until(()=>b.received.length===1);
 assert.deepEqual(b.received[0].packet,payload);assert.equal(host.status().peerOwnerId,'partner-save');
});

// September 23 (gate 105): the FireRed partner's 64-packet native receive FIFO
// overflowed because the two owners' emulation clocks drift independently:
// the leader's game sends one RFU frame per emulated frame, so every frame it
// runs while the guest's emulator is stalled leaves a packet in the guest's
// FIFO. While both adapters are natively connected, each owner reports its
// frames since the connection and the one ahead holds its next frame.
const clocked=()=>Object.assign(peripheral(),{frames:0,step(n=1){this.frames+=n;}});
async function clockedPair(t){
 const a=clocked(),b=clocked(),config={pairId:'clocked-pair',token:randomBytes(32).toString('hex')};
 const host=await createNativeLocalLink({...config,role:'leader',game:'firered',peerGame:'firered',ownerId:'firered',peerOwnerId:'firered-partner',peripheral:a,port:0});t.after(()=>host.close());
 const guest=await createNativeLocalLink({...config,role:'guest',game:'firered',peerGame:'firered',ownerId:'firered-partner',peerOwnerId:'firered',peripheral:b,port:host.port});t.after(()=>guest.close());
 await until(()=>host.status().available&&guest.status().available);
 a.mode=1;b.mode=3;a.send(1,packet(2,456));await until(()=>guest.status().connected&&host.status().connected);
 await until(()=>host.status().clock.peer===0&&guest.status().clock.peer===0);
 return {host,guest,a,b};
}
test('a linked leader holds its next frame while it is a bounded number of frames ahead of the guest',async t=>{
 const {host,guest,a,b}=await clockedPair(t);
 for(let i=0;i<60;i++){if(host.canAdvanceFrame())a.step();}
 const lead=a.frames;
 assert.ok(lead>=8&&lead<=32,`the leader stops within its window (${lead} frames ahead)`);
 assert.equal(host.canAdvanceFrame(),false);
 assert.equal(guest.canAdvanceFrame(),true,'the guest behind it keeps running');
 // The guest catches up; its reported frames release the leader.
 b.step(lead);guest.canAdvanceFrame();b.send(0,packet(6,16<<24));
 await until(()=>host.canAdvanceFrame());
 assert.equal(host.status().reason,null);assert.equal(guest.status().reason,null);
});
test('the guest likewise holds when it runs ahead of a stalled leader, and neither side can hold the other forever',async t=>{
 const {host,guest,a,b}=await clockedPair(t);
 let now=50000;
 for(let i=0;i<60;i++){if(guest.canAdvanceFrame(now))b.step();}
 assert.equal(guest.canAdvanceFrame(now),false);assert.ok(b.frames<=32);
 assert.equal(host.canAdvanceFrame(now),true);
 // A slow leader that still advances keeps throttling the guest: its
 // progress releases one more frame and restarts the hold limit...
 now+=4000;a.step();a.send(1,packet(5));await until(()=>guest.status().clock.peer===1);
 assert.equal(guest.canAdvanceFrame(now),true);b.step();
 assert.equal(guest.canAdvanceFrame(now),false);
 now+=4000;assert.equal(guest.canAdvanceFrame(now),false,'progress restarted the hold limit');
 // ...but a peer that keeps its heartbeat and never advances (a paused engine)
 // is not waited on indefinitely; its own link errors and restart proof decide.
 now+=1001;assert.equal(guest.canAdvanceFrame(now),true);
});
test('frames are not held before both adapters are natively connected or with a peer that reports no clock',async t=>{
 const a=clocked(),config={pairId:'unclocked-pair',token:randomBytes(32).toString('hex')};
 const host=await createNativeLocalLink({...config,role:'leader',game:'firered',peerGame:'emerald',peripheral:a,port:0});t.after(()=>host.close());
 const guest=await createNativeLocalLink({...config,role:'guest',game:'emerald',peerGame:'firered',peripheral:peripheral(),port:host.port});t.after(()=>guest.close());
 await until(()=>host.status().available&&guest.status().available);
 for(let i=0;i<100;i++){assert.equal(host.canAdvanceFrame(),true);a.step();}
 a.mode=1;a.send(1,packet(2,456));await until(()=>guest.status().connected);
 for(let i=0;i<100;i++){assert.equal(host.canAdvanceFrame(),true,'a peer without a frame clock never holds this game');a.step();}
});
test('a new native connection restarts both clocks instead of carrying the earlier lead',async t=>{
 const {host,guest,a,b}=await clockedPair(t);
 for(let i=0;i<60;i++){if(host.canAdvanceFrame())a.step();}
 assert.equal(host.canAdvanceFrame(),false);
 a.send(1,packet(4));await until(()=>!guest.status().connected||guest.status().drainingDisconnect);
 b.mode=0;guest.status();await until(()=>!guest.status().drainingDisconnect);
 assert.equal(host.canAdvanceFrame(),true,'no clock after the native disconnect');
 a.mode=1;b.mode=3;a.send(1,packet(2,789));await until(()=>guest.status().connected&&host.status().connected);
 assert.equal(host.canAdvanceFrame(),true,'the next connection starts level');
});
