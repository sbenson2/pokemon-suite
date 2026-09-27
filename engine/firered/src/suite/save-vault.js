// A commit points to an immutable, checksum-bound emulator state + native save.
// The caller owns the emulator; capture both buffers synchronously, before I/O.
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync,existsSync,readdirSync,unlinkSync} from 'node:fs';
import {join,basename} from 'node:path';

export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const saveReference=commit=>Object.fromEntries(Object.entries(commit).filter(([key])=>key!=='metadata'));
export function atomicJson(path,value){
 const temporary=`${path}.${randomUUID()}.tmp`;
 writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
 const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temporary,path);
}
export class SaveVault {
 constructor(directory,identity){this.directory=directory;this.identity=identity;mkdirSync(directory,{recursive:true,mode:0o700});}
 current(){return existsSync(join(this.directory,'current.json'))?JSON.parse(readFileSync(join(this.directory,'current.json'),'utf8')):null;}
 pinned(){return existsSync(join(this.directory,'pinned.json'))?JSON.parse(readFileSync(join(this.directory,'pinned.json'),'utf8')):[];}
 pin(commit=this.current()){
  this.read(commit);
  const retained=this.pinned();
  if(!retained.some(c=>c.stateSha256===commit.stateSha256&&c.sramSha256===commit.sramSha256)){
   atomicJson(join(this.directory,'pinned.json'),[...retained,saveReference(commit)]);
  }
 }
 read(commit=this.current()){
  if(!commit)throw new Error('No current game save is available.');
  if(commit.schema!=='pokemon-suite/save/v1'||JSON.stringify(commit.identity)!==JSON.stringify(this.identity))throw new Error('Save identity does not match this game, ROM and emulator core.');
  for(const key of ['statePath','sramPath'])if(typeof commit[key]!=='string'||basename(commit[key])!==commit[key])throw new Error('Invalid save path.');
  const state=readFileSync(join(this.directory,commit.statePath)),sram=readFileSync(join(this.directory,commit.sramPath));
  if(digest(state)!==commit.stateSha256||digest(sram)!==commit.sramSha256)throw new Error('Save checksum verification failed; current progress was not replaced.');
  return {...commit,state,sram};
 }
 write(state,sram,metadata={}){
  const stateSha256=digest(state),sramSha256=digest(sram);
  const commit={schema:'pokemon-suite/save/v1',identity:this.identity,statePath:`${stateSha256}.state`,sramPath:`${sramSha256}.sav`,stateSha256,sramSha256,stateBytes:state.length,sramBytes:sram.length,updatedAt:new Date().toISOString(),metadata};
  for(const [key,bytes] of [['statePath',state],['sramPath',sram]]){
   const path=join(this.directory,commit[key]);
   if(!existsSync(path)){
    const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
   } else if(digest(readFileSync(path))!==digest(bytes))throw new Error('Existing save checksum mismatch.');
  }
  atomicJson(join(this.directory,'current.json'),commit);
  // Windows does not expose POSIX directory fsync. Each content file and the
  // replacement pointer have already been flushed before the atomic rename.
  if(process.platform!=='win32'){const fd=openSync(this.directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
  return commit;
 }
 prune(retained=[]){
  const pinned=this.pinned();
  // Fail before deleting anything if a durable profile is already damaged.
  for(const commit of pinned)this.read(commit);
  const keep=new Set([this.current(),...pinned,...retained].filter(Boolean).flatMap(c=>[c.statePath,c.sramPath]));
  for(const name of readdirSync(this.directory))if(/^[a-f0-9]{64}\.(state|sav)$/.test(name)&&!keep.has(name))unlinkSync(join(this.directory,name));
 }
}
