import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {replayMajorBattle} from './replay-major-battle.mjs';

// Laya L2 groundwork: the opt-in battle tape must never change play. The
// Cerulean Gym battle replays twice from its checkpoint, first without and then
// with POKEMON_SUITE_BATTLE_TAPE. Both runs must end on the same frame with the
// same save, and the taped run must have recorded the battle's choices.
export async function replayBattleTape({session,saved,inputs,createSession}){
 const previous=process.env.POKEMON_SUITE_BATTLE_TAPE;
 delete process.env.POKEMON_SUITE_BATTLE_TAPE;
 const directory=mkdtempSync(join(tmpdir(),'suite-battle-tape-')),tape=join(directory,'tape.ndjson');
 let second=null;
 try{
  const plain=replayMajorBattle({session,saved,inputs});
  second=await createSession();
  second.loadSram(saved.sram);second.loadState(saved.state);
  process.env.POKEMON_SUITE_BATTLE_TAPE=tape;
  const taped=replayMajorBattle({session:second,saved,inputs});
  delete process.env.POKEMON_SUITE_BATTLE_TAPE;
  assert.equal(taped.after.frame,plain.after.frame,'the tape changed how the battle played out');
  assert.equal(taped.after.sram.sha256,plain.after.sram.sha256,'the tape changed the saved game');
  const records=readFileSync(tape,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(records.length>0&&records.every(record=>record.schema==='pokemon-suite/battle-turn/v1'&&record.map==='MAP_CERULEAN_CITY_GYM'));
  assert.ok(records.some(record=>record.choice.kind==='move'&&Number.isInteger(record.choice.moveId)&&record.options?.length>0&&Number.isInteger(record.turn)));
  const kinds={};for(const record of records)kinds[record.choice.kind]=(kinds[record.choice.kind]??0)+1;
  console.log('# battle-tape '+JSON.stringify({records:records.length,kinds,endFrame:plain.after.frame,sramSha256:plain.after.sram.sha256}));
  return {before:plain.before,after:plain.after};
 }finally{
  if(previous===undefined)delete process.env.POKEMON_SUITE_BATTLE_TAPE;else process.env.POKEMON_SUITE_BATTLE_TAPE=previous;
  second?.close?.();
  rmSync(directory,{recursive:true,force:true});
 }
}
