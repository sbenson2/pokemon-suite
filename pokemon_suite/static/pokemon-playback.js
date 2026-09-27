/* Manual main-series playback. Inputs belong to one exact game and expire at the owner. */
(() => {
  function hasNativeStatus(pack,state) {
    return Boolean(pack?.id?.endsWith('-suite')&&['3ds','switch'].includes(pack.game?.platform)
      &&state?.game===pack.game.id.slice(8)&&state.capabilities?.nativeSave===true);
  }
  async function lifecycle(game,session,action) {
    if(session?.game!==game||!session.sessionId)throw Error('The game session changed. Refresh its status.');
    const response=await fetch('./api/pokemon-suite/lifecycle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game,sessionId:session.sessionId,action})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'The game did not confirm this action.');
    return result.session;
  }
  function closeGame(game,session,title) {
    if(document.querySelector('.suite-close-dialog'))return;
    const dialog=document.createElement('dialog');dialog.className='suite-close-dialog';
    dialog.innerHTML='<h2></h2><p>Save inside the game before closing. Your saved progress is kept; unsaved progress will be lost.</p><p class="suite-close-status" role="status"></p><div><button type="button" class="suite-keep-playing">Keep playing</button><button type="button" class="suite-confirm-close">Close game</button></div>';
    dialog.querySelector('h2').textContent=`Close ${title}?`;
    const focus=document.activeElement;document.body.append(dialog);dialog.showModal();
    let pending=false;
    dialog.addEventListener('cancel',event=>{if(pending)event.preventDefault();});
    dialog.addEventListener('close',()=>{dialog.remove();focus?.focus?.({preventScroll:true});});
    dialog.querySelector('.suite-keep-playing').onclick=()=>dialog.close();
    dialog.querySelector('.suite-confirm-close').onclick=async()=>{
      pending=true;for(const b of dialog.querySelectorAll('button'))b.disabled=true;
      dialog.querySelector('.suite-close-status').textContent='Waiting for the game to close…';
      try{const result=await lifecycle(game,session,'close');if(result?.state!=='closed')throw Error('The game has not finished closing.');dialog.close();window.dispatchEvent(new CustomEvent('pokemon-suite-game-closed',{detail:{game,sessionId:session.sessionId}}));}
      catch(error){dialog.querySelector('.suite-close-status').textContent=error.message;pending=false;for(const b of dialog.querySelectorAll('button'))b.disabled=false;}
    };
  }
  // One request in flight and one current input snapshot. A stalled network must
  // not replay a long history of pointer movements after the player lets go.
  function createInputLane(transfer,onError) {
    let busy=false,pending=null;
    async function drain() {
      busy=true;
      while(pending) {
        const value=pending;pending=null;
        try{await transfer(value);}catch(error){onError(error);}
      }
      busy=false;
    }
    return value=>{pending=value;if(!busy)void drain();};
  }
  function touchAt(rect,clientX,clientY,platform='nds') {
    if(platform==='3ds') {
      const scale=Math.min(rect.width/400,rect.height/480),left=rect.left+(rect.width-400*scale)/2,top=rect.top+(rect.height-480*scale)/2;
      const x=(clientX-left)/scale-40,y=(clientY-top)/scale-240;
      return x>=0&&x<320&&y>=0&&y<240?{x:Math.floor(x),y:Math.floor(y),pressed:true}:null;
    }
    const width=Math.min(rect.width,rect.height*2/3),height=width*1.5;
    const left=rect.left+(rect.width-width)/2,top=rect.top+(rect.height-height)/2;
    const x=(clientX-left)/width,y=(clientY-top)/height;
    if(x<0||x>=1||y<.5||y>=1)return null;
    return {x:Math.min(255,Math.floor(x*256)),y:Math.min(191,Math.floor((y-.5)*384)),pressed:true};
  }
  function mount(stage,video,pack,canControl) {
    const game=pack.game.id.slice(8),platform=pack.game.platform,ds=platform==='nds',three=platform==='3ds',sw=platform==='switch',desktop=three||sw,dual=ds||three;
    const panel=document.createElement('section');panel.className='suite-play-controls';panel.setAttribute('aria-label',`${pack.game.title} controls`);
    panel.innerHTML='<div class="suite-play-heading"><strong></strong><span class="suite-play-rate">Connecting…</span><button type="button" class="suite-checkpoint">Save checkpoint</button></div><div class="suite-pad" aria-label="Game buttons"></div><p class="suite-play-note" role="status"></p>';
    panel.querySelector('strong').textContent=pack.game.title;
    if(desktop){
      panel.querySelector('.suite-checkpoint').textContent='Back up in-game save';
      const close=document.createElement('button');close.type='button';close.className='suite-close-game';close.textContent='Close game';
      close.onclick=()=>{release();closeGame(game,window.SuitePlaybackStatus,pack.game.title);};panel.querySelector('.suite-play-heading').append(close);
    }
    panel.querySelector('.suite-play-note').textContent=desktop?'Native speed · Save inside the game before making a backup. WASD: move · IJKL: camera · Z/A · X/B · Enter/Start.':ds?'Lower screen: touch or click. Arrows move · Z/A · X/B · A/Y · S/X · Enter/Start. Save normally in the game to create its native save.':'Arrows move · Z/A · X/B · Enter/Start. Save normally in the game; checkpoints also preserve your current screen.';
    const pad=panel.querySelector('.suite-pad'),pressed=new Set();let touch={x:0,y:0,pressed:false},axes=[0,0,0,0],closed=false,manualOpen=false;
    panel.dataset.manualOpen='false';
    const manualView=event=>{if(event.detail?.game!==game||event.detail?.sessionId!==window.SuitePlaybackStatus?.sessionId)return;const next=event.detail.open===true;if(manualOpen===next)return;manualOpen=next;panel.dataset.manualOpen=String(next);if(!next)release();};
    window.addEventListener('pokemon-suite-manual-view',manualView);
    const live=()=>manualOpen&&!closed&&!document.querySelector('.suite-close-dialog[open]')&&window.SuitePlaybackStatus?.capabilities?.input!==false&&canControl()&&document.body.dataset.launcher!=='true'&&document.body.dataset.suiteView==='workspace';
    const inputLane=createInputLane(async value=>{
      const response=await fetch('./api/pokemon-suite/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game,...value}),signal:AbortSignal.timeout(1500)});
      if(!response.ok)throw Error((await response.json()).error||'Controller disconnected.');
    },error=>{if(!closed)panel.querySelector('.suite-play-note').textContent=error.message;});
    function send(force=false) {
      const buttons=live()?[...pressed]:[],point=live()?{...touch}:{...touch,pressed:false};
      if(!force&&!buttons.length&&!point.pressed&&!axes.some(Math.abs))return;
      inputLane({buttons,...(dual?{touch:point}:{}),...(sw?{axes:live()?[...axes]:[0,0,0,0]}:{})});
    }
    function release(){pressed.clear();touch.pressed=false;axes=[0,0,0,0];send(true);for(const b of pad.children)b.dataset.pressed='false';}
    for(const key of ['up','left','down','right','a','b',...((ds||desktop)?['x','y']:[]),'l','r',...(desktop?['zl','zr']:[]),'start','select',...(sw?['l3','r3']:[])]) {
      const button=document.createElement('button');button.type='button';button.dataset.key=key;button.textContent=({up:'↑',left:'←',down:'↓',right:'→'})[key]||key.toUpperCase();button.setAttribute('aria-label',key);
      button.addEventListener('pointerdown',event=>{if(!live())return;event.preventDefault();button.setPointerCapture(event.pointerId);pressed.add(key);button.dataset.pressed='true';send(true);});
      const up=()=>{pressed.delete(key);button.dataset.pressed='false';send(true);};button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);button.addEventListener('lostpointercapture',up);pad.append(button);
    }
    if(desktop){
      const sticks=document.createElement('div');sticks.className='suite-native-sticks';pad.before(sticks);
      for(const [label,prefix,offset] of [['Move','ls',0],['Camera','rs',2]]){
        const stick=document.createElement('div');stick.className='suite-stick';stick.tabIndex=0;stick.setAttribute('role','group');stick.setAttribute('aria-label',label+' stick');stick.innerHTML='<span></span><small></small>';stick.querySelector('small').textContent=label;sticks.append(stick);
        let held=false;
        const reset=()=>{held=false;axes[offset]=axes[offset+1]=0;for(const direction of ['up','down','left','right'])pressed.delete(prefix+'-'+direction);stick.querySelector('span').style.transform='translate(0,0)';send(true);};
        const move=event=>{const r=stick.getBoundingClientRect();let x=(event.clientX-r.left-r.width/2)/(r.width*.4),y=(event.clientY-r.top-r.height/2)/(r.height*.4);const length=Math.max(1,Math.hypot(x,y));x/=length;y/=length;axes[offset]=x;axes[offset+1]=y;for(const direction of ['up','down','left','right'])pressed.delete(prefix+'-'+direction);if(three){if(x<-.2)pressed.add(prefix+'-left');if(x>.2)pressed.add(prefix+'-right');if(y<-.2)pressed.add(prefix+'-up');if(y>.2)pressed.add(prefix+'-down');}stick.querySelector('span').style.transform=`translate(${x*16}px,${y*16}px)`;send(true);};
        stick.addEventListener('pointerdown',event=>{if(!live())return;event.preventDefault();held=true;stick.setPointerCapture(event.pointerId);move(event);});stick.addEventListener('pointermove',event=>{if(held)move(event);});for(const event of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(event,reset);
      }
    }
    const keymap={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',KeyZ:'a',KeyX:'b',Enter:'start',ShiftRight:'select',KeyQ:'l',KeyW:'r',...(ds?{KeyA:'y',KeyS:'x'}:{}),...(desktop?{KeyW:'ls-up',KeyS:'ls-down',KeyA:'ls-left',KeyD:'ls-right',KeyI:'rs-up',KeyK:'rs-down',KeyJ:'rs-left',KeyL:'rs-right',KeyC:'x',KeyV:'y',KeyE:'r',Digit1:'zl',Digit2:'zr'}:{})};
    const key=(event)=>{if(!live()||event.target.closest?.('input,textarea,select'))return;const button=keymap[event.code];if(!button)return;event.preventDefault();event.stopImmediatePropagation();if(event.type==='keydown')pressed.add(button);else pressed.delete(button);send(true);};
    window.addEventListener('keydown',key,true);window.addEventListener('keyup',key,true);window.addEventListener('blur',release);
    const visibility=()=>{if(document.hidden)release();};document.addEventListener('visibilitychange',visibility);
    const pointer=event=>{if(!dual||!live())return;const point=touchAt(video.getBoundingClientRect(),event.clientX,event.clientY,platform);if(event.type==='pointerdown'&&point){video.setPointerCapture(event.pointerId);touch=point;event.preventDefault();send(true);}else if(event.type==='pointermove'&&touch.pressed&&point){touch=point;send(true);}else if(['pointerup','pointercancel','lostpointercapture'].includes(event.type)){touch.pressed=false;send(true);}};
    for(const name of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])video.addEventListener(name,pointer);
    panel.querySelector('.suite-checkpoint').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;release();
      try{const response=await fetch('./api/pokemon-suite/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game})});const result=await response.json();if(!response.ok)throw Error(result.error);panel.querySelector('.suite-play-note').textContent=desktop?'Native save files backed up. Your game keeps running.':'Checkpoint saved. This viewer will resume here. Native game saves are preserved separately.';}
      catch(error){panel.querySelector('.suite-play-note').textContent=error.message;}finally{button.disabled=!canControl();}
    });
    let previousPad='';const heartbeat=setInterval(()=>{
      if(!live()){if(pressed.size||touch.pressed)release();return;}
      const controller=[...(navigator.getGamepads?.()||[])].find(Boolean);
      const values=controller?[['b',0],['a',1],['y',2],['x',3],['l',4],['r',5],...(desktop?[['zl',6],['zr',7]]:[]),...(sw?[['l3',10],['r3',11]]:[]),['select',8],['start',9],['up',12],['down',13],['left',14],['right',15]].filter(([b,i])=>(ds||desktop||!['x','y'].includes(b))&&controller.buttons[i]?.pressed).map(([b])=>b):[];
      if(controller&&desktop){axes=[0,1,2,3].map(i=>Math.abs(controller.axes[i]||0)>.15?Math.max(-1,Math.min(1,controller.axes[i])):0);if(three)for(const [prefix,index] of [['ls',0],['rs',2]]){if(axes[index]<-.2)values.push(prefix+'-left');if(axes[index]>.2)values.push(prefix+'-right');if(axes[index+1]<-.2)values.push(prefix+'-up');if(axes[index+1]>.2)values.push(prefix+'-down');}}
      const next=values.join(',');if(next!==previousPad){for(const b of previousPad.split(','))pressed.delete(b);for(const b of values)pressed.add(b);previousPad=next;send(true);}else send();
    },200);
    const unavailable=document.createElement('section');unavailable.className='suite-video-status';unavailable.hidden=true;
    unavailable.innerHTML='<strong></strong><p role="status"></p>';unavailable.querySelector('strong').textContent=pack.game.title;stage.append(unavailable);
    if(three){
      const recovery=document.createElement('div');recovery.className='suite-video-recovery';
      for(const [action,label] of [['permissions','Enable permissions'],['retry-video','Retry video']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.onclick=async()=>{button.disabled=true;try{await lifecycle(game,window.SuitePlaybackStatus,action);}catch(error){panel.querySelector('.suite-play-note').textContent=error.message;}finally{button.disabled=!canControl();}};recovery.append(button);
      }
      panel.querySelector('.suite-play-heading').after(recovery);
    }
    let promptId=null;
    const prompt=document.createElement('form');prompt.className='suite-native-prompt';prompt.hidden=true;
    prompt.innerHTML='<label><strong></strong><span></span><input type="text" autocomplete="off"></label><button type="submit">Confirm</button><button type="button" class="suite-text-cancel">Cancel</button>';
    panel.prepend(prompt);
    const sessionMessage=document.createElement('p');sessionMessage.className='suite-session-message';sessionMessage.setAttribute('role','status');sessionMessage.hidden=true;panel.prepend(sessionMessage);
    async function submitText(text){
      try{const response=await fetch('./api/pokemon-suite/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game,requestId:promptId,text})});const result=await response.json();if(!response.ok)throw Error(result.error);prompt.hidden=true;}
      catch(error){panel.querySelector('.suite-play-note').textContent=error.message;}
    }
    prompt.addEventListener('submit',event=>{event.preventDefault();void submitText(prompt.querySelector('input').value);});
    prompt.querySelector('.suite-text-cancel').addEventListener('click',()=>void submitText(null));
    const update=()=>{const state=window.SuitePlaybackStatus;if(state?.game!==game)return;const actual=Number(state.sourceFps);panel.querySelector('.suite-play-rate').textContent=desktop?`Native 1× · ${Number.isFinite(actual)?actual.toFixed(1):'—'} captured frames/s`:`${Number.isFinite(actual)?actual.toFixed(1):'—'} emulated frames/s · 60 FPS stream target`;
      sessionMessage.hidden=!state.message;sessionMessage.textContent=state.message||'';
      unavailable.hidden=!desktop||!state.message||state.state==='running';unavailable.querySelector('p').textContent=state.message||'';
      for(const button of pad.querySelectorAll('button'))button.disabled=!canControl()||state.capabilities?.input===false||state.state==='closing';
      const recovery=panel.querySelector('.suite-video-recovery');if(recovery)recovery.hidden=state.state==='running'&&state.capabilities?.input!==false;
      const request=state.textRequest;
      if(request&&request.id!==promptId){release();promptId=request.id;prompt.hidden=false;prompt.querySelector('strong').textContent=request.title||'Enter text for the game';prompt.querySelector('span').textContent=request.guide||'';const input=prompt.querySelector('input');input.value=request.initial||'';input.minLength=request.min;input.maxLength=request.max;input.focus({preventScroll:true});panel.scrollTop=0;}
      if(!request){prompt.hidden=true;promptId=null;}
    };
    const statusTimer=setInterval(update,500);
    (document.querySelector('#suite-native-controller')||stage.parentNode).append(panel);document.body.dataset.suitePlayback='true';stage.dataset.dualScreen=String(dual);
    for(const button of panel.querySelectorAll('button'))button.disabled=!canControl();
    return ()=>{release();closed=true;clearInterval(heartbeat);clearInterval(statusTimer);window.removeEventListener('pokemon-suite-manual-view',manualView);window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',key,true);window.removeEventListener('blur',release);document.removeEventListener('visibilitychange',visibility);for(const name of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])video.removeEventListener(name,pointer);panel.remove();unavailable.remove();delete document.body.dataset.suitePlayback;delete stage.dataset.dualScreen;};
  }
  window.SuitePlayback={touchAt,mount,createInputLane,hasNativeStatus,lifecycle,closeGame};
})();
