import {createHash} from './crypto.js';
import {Buffer} from 'buffer';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function encodeCheckpoint({identity,state,sram,campaign,decisions,frame}){
 const payload={schema:'pokemon-suite/mobile-checkpoint/v1',identity,frame,decisions,campaign,
  state:Buffer.from(state).toString('base64'),sram:Buffer.from(sram).toString('base64')};
 return {...payload,sha256:digest(JSON.stringify(payload))};
}
export function decodeCheckpoint(record,identity){
 if(!record||record.schema!=='pokemon-suite/mobile-checkpoint/v1'||record.identity?.romSha1!==identity.romSha1||
  record.identity?.coreSha256!==identity.coreSha256)throw Error('This save belongs to another cartridge or emulator build.');
 const {sha256,...payload}=record;
 if(digest(JSON.stringify(payload))!==sha256)throw Error('The local checkpoint failed its integrity check.');
 if(!Number.isSafeInteger(record.frame)||record.frame<0||!Number.isSafeInteger(record.decisions)||record.decisions<0||
  typeof record.state!=='string'||record.state.length>32000000||typeof record.sram!=='string'||record.sram.length>2000000)
  throw Error('The local checkpoint has invalid sizes or counters.');
 const state=new Uint8Array(Buffer.from(record.state,'base64')),sram=new Uint8Array(Buffer.from(record.sram,'base64'));
 if(!state.length)throw Error('The local checkpoint has no emulator state.');
 return {...payload,state,sram};
}
