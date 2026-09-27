// Optional peripheral interface. The mGBA shim owns all emulated IO writes.
export class NativeRfuPeripheral {
 constructor(module){
  // frames: emulated frames pumped since attachment (the local link's frame clock).
  this.module=module;this.listeners=new Set();this.frames=0;
  const names=['attach','status','epoch','drops','tx_size','tx_peer','tx_ptr','tx_pop','receive'];
  if(names.some(n=>typeof module['_mgbawasm_rfu_'+n]!=='function'))throw new Error('This core has no native RFU adapter.');
  if(module._mgbawasm_rfu_attach()!==1)throw new Error('The native RFU adapter could not attach.');
 }
 status(){
  const n=this.module._mgbawasm_rfu_status();
  return {attached:!!(n&1),mode:(n>>>8)&255,commandState:(n>>>16)&255,
   epoch:this.module._mgbawasm_rfu_epoch(),dropped:this.module._mgbawasm_rfu_drops()};
 }
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 pump(){
  const m=this.module;this.frames++;
  if(m._mgbawasm_rfu_drops())throw new Error('Native wireless queue overflowed; stop the link.');
  while(m._mgbawasm_rfu_tx_size()){
   const size=m._mgbawasm_rfu_tx_size(),ptr=m._mgbawasm_rfu_tx_ptr(),peer=m._mgbawasm_rfu_tx_peer();
   if(size<12||size>104||!ptr||ptr+size>m.HEAPU8.length)throw new Error('Invalid native RFU packet.');
   const packet=m.HEAPU8.slice(ptr,ptr+size);
   for(const listener of this.listeners)listener({peer,packet});
   m._mgbawasm_rfu_tx_pop();
  }
 }
 receive(packet,peer=0){
  if(!(packet instanceof Uint8Array)||packet.length<12||packet.length>104||!Number.isInteger(peer)||peer<0||peer>=32)throw new Error('Invalid native RFU input.');
  const m=this.module,p=m._malloc(packet.length);
  if(!p)throw new Error('Cannot allocate wireless packet.');
  try{m.HEAPU8.set(packet,p);if(m._mgbawasm_rfu_receive(p,packet.length,peer)!==1)throw new Error('Native RFU rejected a radio packet.');}
  finally{m._free(p);}
 }
}
