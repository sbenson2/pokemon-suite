// Bound viewer work independently of cartridge speed. A frame is either sent
// whole or superseded before encoding; a slow connection never queues history.
export function createLatestFrameWriter({output,write}) {
 let closed=false,busy=false,pending=null;
 function pump(){
  if(closed||busy||!pending||output.destroyed||output.writableNeedDrain)return;
  const frame=pending;pending=null;busy=true;
  write(frame,()=>{busy=false;pump();});
 }
 output.on('drain',pump);
 return {push(frame){if(!closed){pending=frame;pump();}},close(){closed=true;pending=null;output.off('drain',pump);}};
}
