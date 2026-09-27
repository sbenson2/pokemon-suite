import {createServer,connect} from 'node:net';
import {timingSafeEqual} from 'node:crypto';

const PROTOCOL='pokemon-suite/local-rfu/v1';
const GAMES=new Set(['firered','leafgreen','emerald']);
const MAX_BUFFER=8192;
// Two owners emulate on independent wall clocks. A linked RFU leader sends one
// frame of data per emulated frame and a guest answers each one, so frames run
// while the other owner's emulator is stalled pile up in its 64-packet native
// receive FIFO (gate 105: the FireRed partner's FIFO overflowed). While both
// adapters are natively connected, each owner reports its frames since that
// connection and the one ahead holds its next frame. A peer that keeps its
// heartbeat but stops emulating is not waited on past CLOCK_HOLD_MS; the
// native link's own errors, the overflow stop and the restart proof decide.
const CLOCK_WINDOW=16,CLOCK_HOLD_MS=5000;
function inspectPacket(value){
 if(!(value instanceof Uint8Array)||value.length<12||value.length>104)throw Error('Invalid local RFU packet length.');
 const b=Buffer.from(value),kind=b.readUInt32BE(4),header=b.readUInt32BE(8);
 if(b.readUInt32BE(0)!==0x52465531||kind>7||kind===0&&b.length!==36||kind===5&&(header>90||b.length<12+header)||kind===6&&((header>>>24)>16||b.length<12+(header>>>24)))throw Error('Invalid local RFU packet.');
 return {b,kind,header};
}

// One authenticated loopback stream carries the two ROMs' live RFU packets.
// This layer never opens a save, reads a Pokémon, or constructs game payloads.
// Peripheral peer IDs are stable within this pair: leader 0, guest 1.
export async function createNativeLocalLink(options){
 const {role,game,peerGame,pairId,token,peripheral,port}=options;
 const ownerId=options.ownerId??game,peerOwnerId=options.peerOwnerId??peerGame,identity=/^[a-zA-Z0-9_-]{1,100}$/;
 if(!['leader','guest'].includes(role)||!GAMES.has(game)||!GAMES.has(peerGame)||ownerId===peerOwnerId||!identity.test(ownerId)||!identity.test(peerOwnerId)||!identity.test(pairId??'')||!/^[a-f0-9]{64}$/.test(token??'')||!Number.isInteger(port)||port<(role==='leader'?0:1)||port>65535||!peripheral?.subscribe)throw Error('Invalid native local pairing configuration.');
 const link=new NativeLocalLink({...options,ownerId,peerOwnerId,ownerProtocol:options.ownerId!==undefined||options.peerOwnerId!==undefined});
 try{await link.open();return link;}catch(error){link.close();throw error;}
}

class NativeLocalLink{
 constructor({peripheral,role,game,peerGame,pairId,token,port,ownerId,peerOwnerId,ownerProtocol}){
  Object.assign(this,{peripheral,role,game,peerGame,pairId,token,port,ownerId,peerOwnerId});
  this.protocol=ownerProtocol?'pokemon-suite/local-rfu/v2':PROTOCOL;
  this.peerId=role==='leader'?1:0;this.closed=false;this.error=null;this.socket=null;this.server=null;
  this.nativeConnected=false;this.adapterClient=null;this.epoch=peripheral.status().epoch;
  this.candidates=new Set();this.authenticated=false;this.lastHeartbeat=0;
  this.disconnectQueue=[];this.disconnectBytes=0;this.disconnectAt=null;
  // Frame clock: requires a peripheral that counts its emulated frames.
  this.clock={supported:Number.isSafeInteger(peripheral.frames),connection:0,base:null,peer:null,heldAt:null,heldPeer:null,holds:0};
  this.unsubscribe=peripheral.subscribe(message=>this.sendPacket(message));
  this.timer=setInterval(()=>{
   this.drainDisconnect();
   if(this.authenticated){
    if(Date.now()-this.lastHeartbeat>4000)this.fail('The local partner heartbeat expired.');
    else this.send({type:'heartbeat',clock:this.clockReport()});
   }
  },250);this.timer.unref();
 }
 async open(){
  if(this.role==='leader'){
   this.server=createServer(socket=>this.attach(socket));
   await new Promise((resolve,reject)=>{
    this.server.once('error',reject);this.server.listen({host:'127.0.0.1',port:this.port},()=>{this.server.off('error',reject);resolve();});
   });
   this.server.on('error',error=>this.fail(error.message));this.port=this.server.address().port;
  }else await new Promise((resolve,reject)=>{
   const socket=connect({host:'127.0.0.1',port:this.port});
   socket.once('error',reject);
   socket.once('connect',()=>{socket.off('error',reject);this.attach(socket);resolve();});
  });
 }
 attach(socket){
  if(this.closed||this.error||this.authenticated||this.candidates.size>=4){socket.destroy();return;}
  this.candidates.add(socket);socket.setNoDelay(true);socket.setTimeout(4000);
  let buffer='',verified=false;
  const reject=reason=>{if(verified||this.role==='guest')this.fail(reason);socket.destroy();};
  socket.on('error',error=>reject(`Local link: ${error.message}`));
  socket.on('timeout',()=>reject('The local partner did not authenticate.'));
  socket.on('close',()=>{this.candidates.delete(socket);if(!this.closed&&(verified||this.role==='guest'))this.fail('The local partner disconnected.');});
  socket.on('data',chunk=>{
   if(this.closed||this.error)return;
   buffer+=chunk.toString('utf8');
   if(buffer.length>MAX_BUFFER){reject('The local link receive buffer exceeded its limit.');return;}
   for(let end;(end=buffer.indexOf('\n'))>=0;){
    // A failure while handling one line (e.g. the disconnect drain limit)
    // ends the link: later lines of the same read never reach the adapter.
    if(this.closed||this.error)return;
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    try{
     const message=JSON.parse(line);
     if(!verified){
      const supplied=typeof message.token==='string'&&/^[a-f0-9]{64}$/.test(message.token)?Buffer.from(message.token,'hex'):Buffer.alloc(0);
      if(message.type!=='hello'||message.protocol!==this.protocol||message.pairId!==this.pairId||message.game!==this.peerGame||this.protocol!==PROTOCOL&&(message.ownerId!==this.peerOwnerId||message.peerOwnerId!==this.ownerId)||supplied.length!==32||!timingSafeEqual(supplied,Buffer.from(this.token,'hex'))||this.authenticated)throw Error('The local partner identity could not be verified.');
      verified=true;this.authenticated=true;this.socket=socket;this.lastHeartbeat=Date.now();socket.setTimeout(0);
      if(this.role==='leader')socket.write(JSON.stringify(this.hello())+'\n');
      for(const other of this.candidates)if(other!==socket)other.destroy();
     }else if(message.type==='heartbeat'){this.lastHeartbeat=Date.now();this.peerClock(message.clock);}
     else if(message.type==='packet'){
      if(!/^(?:[0-9a-f]{2}){12,104}$/.test(message.hex??''))throw Error('Invalid local RFU encoding.');
      const packet=inspectPacket(Buffer.from(message.hex,'hex'));
      this.receivePacket(packet);this.lastHeartbeat=Date.now();this.peerClock(message.clock);
     }else throw Error('Unknown local link message.');
    }catch(error){reject(error.message);return;}
   }
  });
  if(this.role==='guest')socket.write(JSON.stringify(this.hello())+'\n');
 }
 hello(){return {type:'hello',protocol:this.protocol,pairId:this.pairId,game:this.game,token:this.token,ownerId:this.ownerId,peerOwnerId:this.peerOwnerId};}
 receivePacket(packet){
  // gpSP's disconnect handler clears unread RFU data. A TCP burst can carry
  // the final native close command and its disconnect before the next game
  // frame. Let the ROM consume that command and close its adapter first.
  // Unexpected departures still reach the adapter after a bounded drain;
  // this never substitutes for the game's save or normal-exit evidence.
  const connected=[1,3].includes(this.peripheral.status().mode);
  if(this.disconnectQueue.length||packet.kind===4&&connected){
   this.disconnectAt??=Date.now();this.disconnectBytes+=packet.b.length;
   if(this.disconnectBytes>MAX_BUFFER){this.fail('The local disconnect drain exceeded its limit.');return;}
   this.disconnectQueue.push(packet);
   if(packet.kind===4)this.track(packet);
   return;
  }
  this.peripheral.receive(packet.b,this.peerId);this.track(packet);
 }
 drainDisconnect(){
  if(this.closed||this.error||!this.disconnectQueue.length)return;
  if([1,3].includes(this.peripheral.status().mode)&&Date.now()-this.disconnectAt<3000)return;
  const pending=this.disconnectQueue;this.disconnectQueue=[];this.disconnectBytes=0;this.disconnectAt=null;
  try{for(const packet of pending){this.peripheral.receive(packet.b,this.peerId);this.track(packet);}}
  catch(error){this.fail(error.message);}
 }
 track({kind,header}){
  this.syncEpoch();
  if(kind===2){
   this.nativeConnected=true;this.adapterClient=header&65535;
   // Both owners observe the same connection ACK: the leader sends it, the guest receives it.
   if(this.clock.supported){this.clock.connection++;this.clock.base=this.peripheral.frames;this.clock.peer=null;this.clock.heldAt=null;this.send({type:'heartbeat',clock:this.clockReport()});}
  }
  if(kind===3||kind===4){this.nativeConnected=false;this.adapterClient=null;this.clock.base=null;}
 }
 linkedFrames(){return this.clock.supported&&this.nativeConnected&&this.clock.base!==null?this.peripheral.frames-this.clock.base:null;}
 clockReport(){const frames=this.linkedFrames();return frames===null?null:[this.clock.connection,frames];}
 peerClock(value){
  if(value===undefined)return; // an owner without a frame clock never holds this one
  if(value===null){this.clock.peer=null;return;}
  if(!Array.isArray(value)||value.length!==2||!value.every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Invalid local link frame clock.');
  if(!this.clock.peer||this.clock.peer.connection!==value[0]||value[1]>=this.clock.peer.frames)this.clock.peer={connection:value[0],frames:value[1]};
 }
 // Called before each emulated frame. False holds this owner's next frame.
 // The hold limit counts from the peer's last reported progress, so a slow
 // peer keeps throttling this owner and only a frozen one releases it.
 canAdvanceFrame(now=Date.now()){
  const own=this.linkedFrames(),peer=this.clock.peer;
  if(own===null||!peer||peer.connection!==this.clock.connection||!this.authenticated||this.closed||this.error||own-peer.frames<CLOCK_WINDOW){this.clock.heldAt=null;return true;}
  if(this.clock.heldAt===null){this.clock.holds++;this.send({type:'heartbeat',clock:this.clockReport()});}
  if(this.clock.heldAt===null||this.clock.heldPeer!==peer.frames){this.clock.heldAt=now;this.clock.heldPeer=peer.frames;}
  return now-this.clock.heldAt>=CLOCK_HOLD_MS;
 }
 sendPacket({peer,packet}){
  if(this.closed||this.error)return;
  try{
   const decoded=inspectPacket(packet);
   if(peer!==65535&&peer!==this.peerId)throw Error('Native RFU addressed a peer outside the reserved pair.');
   // Discovery before the other owner connects can be repeated by the native
   // adapter. Losing any connected traffic is an error, never a silent drop.
   if(!this.authenticated){if(decoded.kind!==0)throw Error('Native RFU traffic has no authenticated local partner.');return;}
   this.send({type:'packet',hex:decoded.b.toString('hex'),clock:this.clockReport()});this.track(decoded);
  }catch(error){this.fail(error.message);}
 }
 send(message){
  if(!this.authenticated||this.closed||this.error)return;
  if(this.socket.writableLength>MAX_BUFFER){this.fail('The local partner fell behind the emulator.');return;}
  this.socket.write(JSON.stringify(message)+'\n');
 }
 syncEpoch(){
  const adapter=this.peripheral.status();
  if(adapter.epoch!==this.epoch){this.epoch=adapter.epoch;this.nativeConnected=false;this.adapterClient=null;this.clock.base=null;}
  return adapter;
 }
 status(){
  this.drainDisconnect();
  const adapter=this.syncEpoch();
  if(adapter.dropped&&!this.error)this.fail('Native wireless queue overflowed.');
  const available=!this.closed&&!this.error&&this.authenticated;
  return {transport:'local',available,advertising:available&&adapter.mode===1,connected:available&&this.nativeConnected,
   reason:this.error,drainingDisconnect:this.disconnectQueue.length>0,adapter,peerGame:this.peerGame,
   clock:{own:this.linkedFrames(),peer:this.clock.peer?.connection===this.clock.connection?this.clock.peer.frames:null,holds:this.clock.holds,held:this.clock.heldAt!==null},ownerId:this.ownerId,peerOwnerId:this.peerOwnerId,pairId:this.pairId,
   link:available?{session:this.pairId,adapterClient:this.adapterClient}:null};
 }
 fail(reason){
  this.disconnectQueue=[];this.disconnectBytes=0;this.disconnectAt=null;
  this.error??=String(reason);this.authenticated=false;this.nativeConnected=false;this.adapterClient=null;
  for(const socket of this.candidates)socket.destroy();
 }
 close(){
  if(this.closed)return;this.closed=true;this.authenticated=false;this.nativeConnected=false;
  this.disconnectQueue=[];this.disconnectBytes=0;this.disconnectAt=null;
  clearInterval(this.timer);this.unsubscribe();for(const socket of this.candidates)socket.destroy();this.server?.close();
 }
}
