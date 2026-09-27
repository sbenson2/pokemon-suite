import assert from 'node:assert/strict';
import {itemCatalog,heldStatFactors} from '../engine/firered/src/player/held-items.js';
import {withBattleAbility,BATTLE_TYPES,typeMultiplier} from '../engine/firered/src/player/mechanics-data.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';

// Read-only evidence from the qualified ROM and a real saved PC inventory.
// This qualifies catalog decoding and retained PC handoff, not observed damage
// from an item-bearing combatant. Damage/capture bounds have behavioral tests.
export function verifyNativeHeldReference({inputs,romBytes,observation}) {
  const symbols=(inputs.runtime.data??inputs.runtime).symbols;
  const table=symbols.gItems;
  assert.equal(table.size,itemCatalog.items.length*44);
  const bytes=new DataView(romBytes.buffer,romBytes.byteOffset,romBytes.byteLength);
  for(const item of itemCatalog.items){
    const at=table.address-0x08000000+item.id*44;
    assert.equal(bytes.getUint16(at+14,true),item.reserved?0:item.id,item.name);
    assert.equal(bytes.getUint8(at+18),item.effectId,item.name);
    assert.equal(bytes.getUint8(at+19),item.param,item.name);
  }
  const chart=symbols.gTypeEffectiveness,entries=[];
  let foresight=false;
  for(let i=0;i<chart.size;i+=3){
    const at=chart.address-0x08000000+i,a=bytes.getUint8(at),d=bytes.getUint8(at+1),factor=bytes.getUint8(at+2);
    if(a===255)break;
    if(a===254){foresight=true;continue;}
    entries.push({a,d,factor,foresight});
  }
  const types=BATTLE_TYPES.map((_,i)=>i).filter(i=>i!==9);
  for(const a of types)for(const d1 of types)for(const d2 of types.filter(d=>d>=d1))for(const seen of [false,true]){
    let expected=1;
    for(const d of new Set([d1,d2]))for(const entry of entries)
      if(entry.a===a&&entry.d===d&&!(seen&&entry.foresight))expected*=entry.factor/10;
    assert.equal(typeMultiplier(inputs.battle,BATTLE_TYPES[a],[BATTLE_TYPES[d1],BATTLE_TYPES[d2]],{foresight:seen}),expected,`${a} vs ${d1}/${d2} Foresight=${seen}`);
  }
  const onix=observation.playerMemory.trainer.storage.pokemon.find(p=>p.validity==='valid'&&p.species===95&&p.heldItem===204);
  assert.ok(onix,'preserved inventory includes an Onix holding its own Hard Stone');
  assert.equal(heldStatFactors(onix,{type:'TYPE_ROCK',physical:true}).attack,1.1);
  assert.equal(heldStatFactors(onix,{type:'TYPE_NORMAL',physical:true}).attack,1);
  assert.equal(withBattleAbility(inputs.battle,onix).ability,'ABILITY_STURDY');
  return [onix.personality,onix.otId,onix.heldItem];
}

export function replayNativeHeldEquipment({session,inputs,capture,basePlanner}){
  const before=capture(),original=before.playerMemory.trainer;
  const planner={...basePlanner,select:()=>null,selectTraining:()=>null,selectCollection:()=>null};
  const open=initialState=>createCentralPlayer({campaignPlanner:planner,advisors:createPolicyAdvisors({mechanics:inputs.battle,world:inputs.world,campaignPlanner:planner}),mechanics:inputs.battle,initialState});
  let player=open(),restarted=false,selected=false;
  for(let i=0;i<1800;i++){
    const after=capture(),m=after.playerMemory;
    if(m.ui.bag?.stage==='berry-pouch-context'&&!restarted){player=open(JSON.parse(JSON.stringify(player.state())));restarted=true;}
    const changed=m.trainer.party.filter((p,j)=>p.heldItem!==original.party[j].heldItem);
    if(changed.length&&after.phase==='stable'&&after.emulator.mode==='overworld'&&!Object.values(m.ui).some(Boolean)){
      assert.ok(restarted&&selected,'observed Berry Pouch selection survives controller reconstruction');
      for(const [i,p] of m.trainer.party.entries()){
        const old=original.party[i];assert.deepEqual({...p,heldItem:old.heldItem},old,'equipment changes only the held item');
        if(p.heldItem!==old.heldItem){assert.equal(old.heldItem,0);assert.ok(original.bag.berries.some(b=>b.itemId===p.heldItem));}
      }
      for(const item of original.bag.berries){
        const equipped=changed.filter(p=>p.heldItem===item.itemId).length;
        assert.equal(m.trainer.bag.berries.find(b=>b.itemId===item.itemId)?.quantity??0,item.quantity-equipped);
      }
      assert.equal(after.sram.sha256,before.sram.sha256);return after;
    }
    const decision=player.decide(after),r=decision.winner?.recommendation;
    assert.notEqual(decision.kind,'blocked',decision.reason);
    if(r?.targetAction==='give'&&m.ui.bag?.stage==='berry-pouch-context')selected=true;
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('Native held-berry preparation did not return to the field.');
}
