#!/usr/bin/env node
// Laya program L2 groundwork: turns battle tapes (POKEMON_SUITE_BATTLE_TAPE,
// schema pokemon-suite/battle-turn/v1) into Laya training rows, one per
// recorded choice: {id, state, questions, label, meta}. The label is the
// deterministic advisor's choice (an imitation prior; outcome labels from
// forks come later). Item choices are counted but not exported: the tape does
// not record the bag, so an item option would reveal its own label.
//
//   node scripts/laya-export-battles.mjs --mechanics <battle knowledge.json> --out rows.jsonl tape.ndjson [...]
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const ROW_SCHEMA='pokemon-suite/laya-battle-row/v1';
const TAPE_SCHEMA='pokemon-suite/battle-turn/v1';
const BATTLE_TYPE_TRAINER=8;

const title=name=>String(name??'').replace(/^(SPECIES|MOVE|TYPE)_/,'').toLowerCase().split('_').filter(Boolean)
 .map(word=>word[0].toUpperCase()+word.slice(1)).join(' ');

// Live battle memory stores Gen III type ids; the knowledge files use TYPE_ names.
const TYPE_IDS=['Normal','Fighting','Flying','Poison','Ground','Rock','Bug','Ghost','Steel','???','Fire','Water','Grass','Electric','Psychic','Ice','Dragon','Dark'];
const STAGES={attack:'Atk',defense:'Def',speed:'Spe',spAttack:'SpA',spDefense:'SpD',accuracy:'Acc',evasion:'Eva'};

export function battleNames(mechanics){
 const data=mechanics?.data??mechanics??{};
 const byId=list=>new Map((Array.isArray(list)?list:Object.values(list??{})).map(entry=>[entry.id,title(entry.name)]));
 const species=byId(data.species),moves=byId(data.moves);
 return {species:id=>species.get(id)||`Pokémon #${id}`,move:id=>moves.get(id)||`Move #${id}`,
  type:value=>Number.isInteger(value)?TYPE_IDS[value]??`Type #${value}`:title(value)};
}

function statusText(status1){
 const s=Number(status1)||0;
 return s&7?'asleep':s&8?'poisoned':s&16?'burned':s&32?'frozen':s&64?'paralyzed':s&128?'badly poisoned':'';
}
const hp=p=>Number.isFinite(p?.hp)&&Number(p?.maxHp)>0?`HP ${p.hp}/${p.maxHp}`:'HP unknown';
// Stages are stored with 6 as neutral.
const stages=p=>Object.entries(STAGES).map(([stat,label])=>{const n=Number(p.statStages?.[stat])-6;return Number.isFinite(n)&&n?`${label} ${n>0?'+':''}${n}`:null;}).filter(Boolean).join(' ');
const describe=(p,names)=>[`${names.species(p.species)} L${p.level??'?'}`,hp(p),statusText(p.status1),[...new Set((p.types??[]).map(names.type))].join('/'),stages(p)]
 .filter(Boolean).join(' ');

/** The battle as the model reads it: the active Pokémon and its moves, the foes, and the bench. */
export function battleState(record,names){
 const player=record.player??{},lines=[`You: ${describe(player,names)}`];
 const moves=(player.moves??[]).map((id,slot)=>id?`${names.move(id)} (PP ${player.pp?.[slot]??'?'})`:null).filter(Boolean);
 if(moves.length)lines.push(`Moves: ${moves.join(', ')}`);
 for(const foe of record.opponents??[])if(foe)lines.push(`Foe: ${describe(foe,names)}`);
 const bench=(record.party??[]).filter(member=>member&&member.slot!==record.playerPartySlot);
 if(bench.length)lines.push(`Bench: ${bench.map(member=>`${names.species(member.species)} L${member.level??'?'} ${member.hp>0?`${member.hp}/${member.maxHp}`:'fainted'}`).join(', ')}`);
 if(record.context==='shift'&&record.announcedOpponent)lines.push(`The trainer is about to send out ${title(record.announcedOpponent)}.`);
 if(record.context==='forced')lines.push('Your active Pokémon fainted; choose a replacement.');
 lines.push((Number(record.battleTypeFlags)&BATTLE_TYPE_TRAINER)?'Trainer battle.':'Wild battle.');
 return lines.join('\n');
}

/**
 * The actions open at this decision. A turn offers usable moves, healthy switches
 * and running from a wild battle; a free shift before an announced trainer
 * Pokémon offers keeping the active Pokémon or switching; a forced replacement
 * offers switches only.
 */
export function battleActions(record,names){
 const player=record.player??{},context=record.context??'turn',actions=[];
 if(context==='turn')(player.moves??[]).forEach((id,slot)=>{if(id&&Number(player.pp?.[slot]??0)>0)actions.push({kind:'move',moveId:id,moveSlot:slot,text:`Use ${names.move(id)}`});});
 if(context==='shift')actions.push({kind:'keep',text:`Keep ${names.species(player.species)} in`});
 for(const member of record.party??[])
  if(member&&member.slot!==record.playerPartySlot&&member.hp>0)actions.push({kind:'switch',partySlot:member.slot,species:member.species,text:`Switch to ${names.species(member.species)}`});
 if(context==='turn'&&!(Number(record.battleTypeFlags)&BATTLE_TYPE_TRAINER))actions.push({kind:'run',text:'Run'});
 return actions;
}

const matches=(action,choice)=>action.kind===choice.kind&&(choice.kind==='move'?action.moveSlot===choice.moveSlot&&action.moveId===choice.moveId:
 choice.kind==='switch'?action.partySlot===choice.partySlot:true);

/** One Laya row for a tape record, or {skipped: reason}. */
export function exportRecord(record,names,source=null){
 if(record?.schema!==TAPE_SCHEMA||record.truncated)return {skipped:'not-a-turn'};
 if(['item','item-target'].includes(record.choice?.kind))return {skipped:'item'};
 const actions=battleActions(record,names),label=actions.findIndex(action=>matches(action,record.choice??{}));
 if(label<0)return {skipped:'choice-not-offered'};
 const state=battleState(record,names);
 const id=createHash('sha256').update(JSON.stringify([state,actions.map(action=>action.text),label])).digest('hex').slice(0,16);
 return {row:{schema:ROW_SCHEMA,id,state,
  questions:[{id:'action',type:'choice',prompt:'Which action should the bot take this turn?',options:actions.map(action=>action.text)}],
  label:{action:label},
  meta:{source,frame:record.frame,map:record.map,turn:record.turn??null,context:record.context??'turn',announcedOpponent:record.announcedOpponent??null,
   choice:record.choice,advisor:record.advisor,reason:record.reason,scores:record.options}}};
}

export function exportTapes(texts,names){
 const rows=new Map(),skipped={};
 for(const {source,text} of texts)for(const line of text.split('\n')){
  if(!line.trim())continue;
  let record;try{record=JSON.parse(line);}catch{skipped['bad-json']=(skipped['bad-json']??0)+1;continue;}
  const result=exportRecord(record,names,source);
  if(result.row)rows.set(result.row.id,result.row);else skipped[result.skipped]=(skipped[result.skipped]??0)+1;
 }
 const kinds={};for(const row of rows.values())kinds[row.meta.choice.kind]=(kinds[row.meta.choice.kind]??0)+1;
 return {rows:[...rows.values()],summary:{rows:rows.size,kinds,skipped}};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const args=process.argv.slice(2),take=flag=>{const at=args.indexOf(flag);return at<0?null:args.splice(at,2)[1];};
 const mechanicsPath=take('--mechanics'),out=take('--out');
 if(!mechanicsPath||!out||!args.length){console.error('usage: laya-export-battles.mjs --mechanics <battle knowledge.json> --out <rows.jsonl> <tape.ndjson> [...]');process.exit(2);}
 const names=battleNames(JSON.parse(readFileSync(mechanicsPath,'utf8')));
 const {rows,summary}=exportTapes(args.map(source=>({source,text:readFileSync(source,'utf8')})),names);
 writeFileSync(out,rows.map(row=>JSON.stringify(row)).join('\n')+(rows.length?'\n':''));
 console.log(JSON.stringify(summary));
}
