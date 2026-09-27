import {readFileSync} from 'node:fs';
import {digest} from './save-vault.js';

export async function ensureInitialSave(vault, cfg, createSession) {
  if(vault.current()){vault.read();return false;}
  if(cfg.seed){
    const state=readFileSync(cfg.seed.stateFilePath),sram=readFileSync(cfg.seed.sramFilePath);
    if(digest(state)!==cfg.seed.stateSha256||digest(sram)!==cfg.seed.sramSha256)throw Error('The source save failed verification.');
    vault.write(state,sram,{source:cfg.seed,frame:cfg.seed.frame,reason:'initial-import'});
  }else{
    const session=await createSession();
    try{vault.write(session.saveState(),session.saveSram(),{frame:session.frame,reason:'first-launch',newProfile:true});}
    finally{session.close();}
  }
  return true;
}
