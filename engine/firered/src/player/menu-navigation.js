import {createHash} from 'node:crypto';
import {transactionProgressSignature} from './transaction-recovery.js';
import {battleDecisionState} from './battle-model.js';

const directions=['down','up','right','left'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ready=o=>o?.phase==='stable'&&o.emulator?.inputReady!==false;
// FireRed ignores directional input for roughly the first 12 frames after a
// battle menu reopens (measured on an Elite Four rematch turn, Rev 1). Presses
// issued inside this window are not evidence against a cursor edge.
const MENU_SETTLE_FRAMES=16;
const validIndex=(n,size)=>Number.isSafeInteger(n)&&n>=0&&n<size;

function grid(count){
  return Array.from({length:count},(_,i)=>Object.fromEntries([
    ['down',i+2,i<2&&i+2<count],['up',i-2,i>=2],
    ['right',i+1,i%2===0&&i+1<count],['left',i-1,i%2===1],
  ].filter(([, ,allowed])=>allowed).map(([button,to])=>[button,to])));
}
function moveGrid(o){
  const moves=battleDecisionState(o.playerMemory,o.playerMemory?.ui)?.player?.moves;
  if(!Array.isArray(moves))return undefined;
  const count=moves.filter(id=>Number.isSafeInteger(id)&&id>0).length;
  // The cartridge counts learned moves, not remaining PP. Reject malformed
  // holes rather than interpreting an inaccessible slot as a different move.
  if(count<1||count>4||moves.some((id,i)=>i<count?!(id>0):id!==0))return null;
  return grid(count);
}
function route(edges,from,to,excluded=[]){
  if(!validIndex(from,edges.length)||!validIndex(to,edges.length))return null;
  const queue=[{at:from,steps:[]}],seen=new Set([from]);
  while(queue.length){
    const {at,steps}=queue.shift();if(at===to)return steps;
    for(const button of directions){
      const next=edges[at][button];
      if(next===undefined||seen.has(next)||excluded.some(e=>e.from===at&&e.button===button))continue;
      seen.add(next);queue.push({at:next,steps:[...steps,button]});
    }
  }
  return null;
}
export function battleMoveCursorStep(recommendation,o){
  const edges=moveGrid(o);
  if(edges===undefined)return undefined; // legacy observations without moves
  if(!edges)return null;
  const target=recommendation.targetMoveSlot,
    moves=battleDecisionState(o.playerMemory,o.playerMemory?.ui)?.player?.moves;
  if(!validIndex(target,edges.length)||recommendation.targetMoveId!==undefined&&recommendation.targetMoveId!==moves[target])return null;
  const path=route(edges,o.playerMemory.ui?.battle?.cursor,target);
  return path?.[0]??(path?'a':null);
}

function surface(o){
  const m=o.playerMemory??{},ui=m.ui??{},battle=battleDecisionState(m,ui);
  if(ui.saveDialog||ui.inGameTrade||o.emulator?.mode==='in-game-trade'||
      (Number(m.battleTypeFlags)&2)!==0||/UNION_ROOM|TRADE|COLOSSEUM|CABLE_CLUB/.test(m.map?.id??''))return null;
  let edges,cursor,kind,identity;
  if(o.emulator?.mode==='battle'&&ui.battle?.stage==='move'){
    edges=moveGrid(o);cursor=ui.battle.cursor;kind='move';
    identity=[ui.battle.battler,battle?.playerPartySlot,battle?.player?.species,battle?.player?.personality,battle?.player?.moves];
  }else if(o.emulator?.mode==='battle'&&ui.battle?.stage==='action'){
    edges=grid(4);cursor=ui.battle.cursor;kind='action';identity=[ui.battle.battler,battle?.playerPartySlot];
  }else if(o.emulator?.mode==='start-menu'&&ui.startMenu){
    const menu=ui.startMenu;
    if(!Number.isSafeInteger(menu.count)||menu.count<1||menu.count>10||menu.order?.length!==menu.count)return null;
    // start_menu.c uses Menu_MoveCursor, which wraps at either end.
    edges=Array.from({length:menu.count},(_,i)=>({down:(i+1)%menu.count,up:(i+menu.count-1)%menu.count}));
    cursor=menu.cursor;kind='start';identity=menu.order;
  }
  if(!edges||!validIndex(cursor,edges.length))return null;
  return {key:hash([m.map?.id,m.position,kind,identity]),kind,edges,cursor};
}
function targetFor(s,r){
  if(s.kind==='move'&&r?.kind==='choose-battle-move')return r.targetMoveSlot;
  if(s.kind==='action'&&r?.kind==='choose-battle-command')return {fight:0,bag:1,pokemon:2,run:3}[r.targetCommand];
  if(s.kind==='start'&&r?.kind==='choose-start-menu-item')return r.targetIndex;
  return null;
}

// Learn only from completed input receipts followed by settled native facts.
// A directional detour never changes a move, recipient, item, or campaign goal.
export function createMenuRouteRecovery(state=null){
  let epoch=state?.epoch??null,pending=structuredClone(state?.pending??null);
  let failures=structuredClone(state?.failures??[]),active=structuredClone(state?.active??null);
  let history=structuredClone(state?.history??[]),visible=structuredClone(state?.visible??null);
  const keyValid=k=>typeof k==='string'&&/^[a-f0-9]{64}$/.test(k);
  const edgeValid=e=>keyValid(e?.surface)&&validIndex(e.from,10)&&validIndex(e.to,10)&&directions.includes(e.button);
  if(epoch!==null&&!keyValid(epoch)||!Array.isArray(failures)||failures.length>64||
      failures.some(e=>!edgeValid(e)||!Number.isSafeInteger(e.count)||e.count<1||e.count>3)||
      pending&&(!edgeValid(pending)||!Number.isSafeInteger(pending.endFrame)||pending.endFrame<0)||
      active&&(!keyValid(active.surface)||!validIndex(active.target,10)||typeof active.objective!=='string')||
      !Array.isArray(history)||history.length>32||history.some(e=>!keyValid(e.surface)||!Number.isSafeInteger(e.frame)||e.frame<0)||
      visible&&(!keyValid(visible.key)||!Number.isSafeInteger(visible.since)||visible.since<0)){
    throw new TypeError('invalid menu route recovery evidence');
  }
  const record=event=>{history.push(event);history=history.slice(-32);};
  const sameEdge=(a,b)=>a.surface===b.surface&&a.from===b.from&&a.button===b.button;
  return Object.freeze({
    observe(o){
      if(!ready(o))return;
      const s=surface(o);
      if(!s){pending=null;visible=null;return;}
      const next=hash([transactionProgressSignature(o),o.playerMemory?.battle?.turn,
        o.playerMemory?.encounter?.pokemon?.personality,o.playerMemory?.encounter?.pokemon?.otId]);
      if(epoch!==next){epoch=next;pending=null;failures=[];active=null;visible=null;}
      if(visible?.key!==s.key)visible={key:s.key,since:o.frame};
      if(pending&&o.frame>=pending.endFrame){
        const previous=pending;pending=null;
        if(s.key===previous.surface){
          if(s.cursor===previous.to&&s.cursor!==previous.from){
            failures=failures.filter(e=>!sameEdge(e,previous));
          }else if(!previous.early){
            let failed=failures.find(e=>sameEdge(e,previous));
            if(!failed){failed={surface:s.key,from:previous.from,to:previous.to,button:previous.button,count:0};failures.push(failed);failures=failures.slice(-64);}
            if(failed.count<3){failed.count++;
              if(failed.count===3)record({surface:s.key,frame:o.frame,outcome:'edge-rejected',from:failed.from,button:failed.button});
            }
          }
        }
      }
      if(active&&active.surface===s.key&&active.target===s.cursor){
        record({...active,frame:o.frame,outcome:'cursor-confirmed'});active=null;
      }
    },
    observeExecution({observation:o,decision,execution}){
      if(!ready(o)||execution?.interrupted||!Number.isSafeInteger(execution?.endFrame)||execution.endFrame<=o.frame)return;
      const s=surface(o),buttons=decision?.action?.buttons??[];
      if(!s||buttons.length!==1||!directions.includes(buttons[0])||!Number.isSafeInteger(targetFor(s,decision.winner?.recommendation)))return;
      const early=!visible||visible.key!==s.key||o.frame-visible.since<MENU_SETTLE_FRAMES;
      pending={surface:s.key,from:s.cursor,to:s.edges[s.cursor][buttons[0]]??s.cursor,button:buttons[0],endFrame:execution.endFrame,early};
    },
    adjust(o,decision){
      if(!ready(o)||decision.kind!=='act')return decision;
      const s=surface(o),r=decision.winner?.recommendation;
      if(!s)return decision;
      const target=targetFor(s,r);
      if(!validIndex(target,s.edges.length))return decision;
      const rejected=failures.filter(e=>e.surface===s.key&&e.count>=3);
      if(!rejected.length)return decision;
      const path=route(s.edges,s.cursor,target,rejected);
      if(path?.length===0)return decision;
      const button=path?.[0],objective=String(r.objective??r.kind);
      if(button===decision.action.buttons?.[0]&&!active)return decision;
      if(!active||active.surface!==s.key||active.target!==target||active.objective!==objective){
        active={surface:s.key,target,objective};
        record({...active,frame:o.frame,outcome:button?'alternate-route':'no-safe-route'});
      }
      return Object.freeze({...decision,reason:'menu-route-recovery',
        action:{kind:button?'bounded-edge':'neutral',buttons:button?[button]:[],holdFrames:1,releaseFrames:1,reason:button?'alternate-menu-route':'await-safe-menu-route'},
        recovery:{action:button?'alternate-menu-route':'no-safe-menu-route',objective,target,
          failedEdges:rejected.map(e=>({from:e.from,button:e.button})),remainingSteps:path?.length??null}});
    },
    reset(){epoch=null;pending=null;failures=[];active=null;visible=null;},
    state(){return {epoch,pending:structuredClone(pending),failures:structuredClone(failures),active:structuredClone(active),history:structuredClone(history),visible:structuredClone(visible)};},
  });
}
