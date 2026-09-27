import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {isIP} from 'node:net';
import {isAbsolute} from 'node:path';
export function nativeRadioCommand(options){
 if(options.transport==='appliance'){
  const {runtime,keysPath,stateDir}=options;
  for(const value of [runtime?.python,runtime?.bridge,runtime?.root,keysPath,stateDir]){
   if(typeof value!=='string'||!isAbsolute(value)||/[\r\n\0]/.test(value))throw Error('Configure the local wireless runtime and console key file.');
  }
  return {executable:runtime.python,args:['-B',runtime.bridge,'--runtime',runtime.root,'--keys',keysPath,'--state-dir',stateDir]};
 }
 if(options.transport&&options.transport!=='ssh')throw Error('Unsupported wireless transport.');
 return {executable:'ssh',args:[...nativeRadioArguments(options),
  'cd "$HOME/pokemon-suite-radio" && sudo -n ./venv/bin/python -u serve.py --protocol protocol --keys "$HOME/.switch/prod.keys"']};
}
export function nativeRadioArguments({host,knownHosts,bindAddress}){
 if(!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host??''))throw new Error('Invalid native radio host.');
 if(typeof knownHosts!=='string'||!knownHosts||/[\r\n\0]/.test(knownHosts))throw Error('Choose the verified radio host-key file.');
 if(bindAddress&&!isIP(bindAddress))throw Error('Invalid local radio interface address.');
 return ['-T','-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes',
  '-o',`UserKnownHostsFile=${knownHosts}`,...(bindAddress?['-b',bindAddress]:[]),host];
}

// Both transports carry live RFU peripheral traffic and liveness. The game
// and save remain owned by the Mac session.
export class NativeRadioLink {
 constructor({peripheral,log=()=>{},spawnProcess=spawn,...options}){
  const command=nativeRadioCommand(options);
  this.peripheral=peripheral;this.log=log;this.lastStatus=0;this.startedAt=Date.now();this.error=null;this.closed=false;
  this.state={available:false,advertising:false,connected:false};
  this.flow=null;this.sentPackets=0;this.packetQueue=[];
  this.process=spawnProcess(command.executable,command.args,{stdio:['pipe','pipe','pipe']});
  this.process.on('error',error=>this.fail(error.message));
  this.process.on('exit',(code)=>{if(!this.closed)this.fail(`Native radio exited (${code}).`);});
  this.process.stdin.on('error',error=>{if(!this.closed)this.fail(error.message);});
  this.process.stderr.on('data',chunk=>log(chunk.toString()));
  this.lines=createInterface({input:this.process.stdout});
  this.lines.on('line',line=>{
   if(this.closed)return;
   try{
    if(line.length>4096)throw new Error('Oversized radio response.');
    const message=JSON.parse(line);
    if(message.type==='packet'){
     if(!/^(?:[0-9a-f]{2}){12,104}$/.test(message.hex??'')||message.peer!==0)throw new Error('Invalid radio RFU packet.');
     peripheral.receive(Buffer.from(message.hex,'hex'),message.peer);
    }else if(message.type==='flow'){
     const {received,pending}=message;
     if(!Number.isSafeInteger(received)||!Number.isSafeInteger(pending)||received<(this.flow?.received??0)||received>this.sentPackets||pending<0||pending>32||pending>received)throw Error('Invalid radio flow receipt.');
     this.flow={received,pending};this.flushPackets();
    }else if(message.type==='error')this.fail(message.reason);
    else if(['status','available'].includes(message.type)){
     if(!this.lastStatus||message.type!==this.state.type)this.log(`[radio] ${message.type}; advertising=${!!message.advertising}\n`);
     this.lastStatus=Date.now();this.state={...message,available:true};
    }else if(message.type==='stopped')this.fail('Native radio stopped.');
   }catch(error){this.fail(error.message);}
  });
  this.unsubscribe=peripheral.subscribe(({peer,packet})=>{
   if(this.closed||this.error)return;
   // A single cartridge frame may emit several packets. Retain that burst,
   // then hold the next frame until the relay has room, without reordering it.
   if(this.packetQueue.length>=256){this.fail('Native radio frame burst exceeded its limit.');return;}
   this.packetQueue.push({type:'packet',peer,hex:Buffer.from(packet).toString('hex')});this.flushPackets();
  });
  this.heartbeat=setInterval(()=>this.send({type:'heartbeat',game:'firered'}),250);
  this.send({type:'heartbeat',game:'firered'});
 }
 flowFull(){return this.flow!==null&&this.sentPackets-this.flow.received+this.flow.pending>=8;}
 flushPackets(){
  while(this.packetQueue.length&&!this.closed&&!this.error&&!this.flowFull()){
   const packet=this.packetQueue.shift();this.sentPackets++;this.send(packet);
  }
 }
 canAdvanceFrame(){
  // Run the watchdog even when a queued input action cannot finish. A failed
  // transport must return control to the trade outcome/preservation handler.
  this.status();
  return Boolean(this.error||this.closed)||(!this.packetQueue.length&&!this.flowFull());
 }
 send(message){
  if(this.closed||this.error)return;
  if(this.process.stdin.writableLength>32768){this.fail('Native radio fell behind the emulator.');return;}
  this.process.stdin.write(JSON.stringify(message)+'\n');
 }
 fail(reason){if(!this.error){this.error=String(reason);this.log(`[radio] ${this.error}; last=${this.state.type}; age=${Date.now()-this.lastStatus}ms\n`);}this.state={...this.state,available:false,advertising:false,connected:false};}
 status(){
  if(!this.lastStatus&&this.startedAt&&Date.now()-this.startedAt>45000&&!this.error)this.fail('The native radio did not start.');
  // AP setup blocks the radio loop before its first regular status. Keep the
  // short watchdog once running, but allow the transport's startup deadline.
  const timeout=this.state.type==='available'?30000:4000;
  const fresh=Date.now()-this.lastStatus<timeout,adapter=this.peripheral.status();
  if(this.lastStatus&&!fresh&&!this.error)this.fail('Native radio status expired.');
  return {...this.state,available:!this.error&&fresh&&this.state.available,
   advertising:!this.error&&fresh&&adapter.mode===1&&this.state.advertising,
   reason:this.error,adapter};
 }
 close(){
  if(this.closed)return;
  clearInterval(this.heartbeat);this.unsubscribe();
  this.process.stdin.end(JSON.stringify({type:'stop'})+'\n');this.closed=true;
  this.state={available:false,advertising:false,connected:false};
 }
}
