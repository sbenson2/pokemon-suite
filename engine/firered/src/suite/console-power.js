// Starting the bot continues the owning save, then waits for an explicit task.
export const canAutomate=policy=>Boolean(policy?.enabled&&!policy.awaitingCommand);
export async function startCommandReady({local,trade,capture,remotePlayers=0,newProfile=false},owner){
 if(local?.phase&&local.phase!=='complete'||trade?.phase&&trade.phase!=='complete'||remotePlayers>0)
  throw Error('Resume the linked task before starting a new command session.');
 if(capture&&!capture.nativeSaveVerified)
  throw Error('Resume the saved hunt to finish capturing and saving the protected Pokémon.');
 await owner.stop();
 await owner.checkpoint();
 if(!newProfile)await owner.continueSave();
 else await owner.prepareNewGame?.();
 await owner.ready();
}

// Manual takeover remains explicit and never selects a new task.
export async function manualConsoleStart({boot,local,trade,capture,remotePlayers=0}, owner) {
 if(local?.phase && local.phase!=='complete' || trade?.phase && trade.phase!=='complete' || remotePlayers>0)
  throw Error('Finish the linked task from Bot settings before restarting the console.');
 if(boot&&capture&&!capture.nativeSaveVerified)
  throw Error('Save the protected Pokémon before restarting the console. Manual control can continue from this frame.');
 await owner.stop();
 await owner.checkpoint();
 if(boot)await owner.reset();
 await owner.manual();
}

export class ConsolePresentationGate {
 #pending = null;
 status(){return this.#pending ? {...this.#pending} : null;}
 clear(){this.#pending=null;}
 begin(id){
  if(!/^[a-f0-9]{32}$/.test(id??''))throw Error('Invalid console presentation.');
  this.#pending={id,phase:'waiting'};
 }
 finish(id,resume){
  if(!this.#pending || this.#pending.id!==id)throw Error('The console startup changed. Refresh its viewer.');
  this.#pending=null;return resume();
 }
}
