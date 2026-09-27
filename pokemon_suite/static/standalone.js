/* Pokémon Suite owns selection, telemetry and playback. No host app bridge. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const text = (selector, value) => { const element=$(selector); if(element)element.textContent=value??'—'; };
  const node = (tag, className, value) => {const el=document.createElement(tag);el.className=className;if(value!==undefined)el.textContent=value;return el;};
  let state, suite, selectedKey='', streamController, disposeShell, disposeControls, previousModel;
  let dataRevisions='';
  let reconnectTimer, audioContext, audioEnabled=false, audioController, audioGeneration=0;
  const stage=$('#stage'), canvas=document.createElement('canvas');
  canvas.className='suite-game-screen';canvas.setAttribute('aria-label','Live emulator screen');
  stage.append(canvas);
  const screenMessage=node('p','suite-screen-message','Choose a game in ROMs.');stage.append(screenMessage);
  const notify=message=>text('#standalone-notice',message);
  async function api(path, body) {
    const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error(result.error||`Request failed (${response.status})`);return result;
  }
  const currentPack=()=>state?.packs.find(p=>p.id===state.selected);
  const currentGame=()=>currentPack()?.game.id.replace(/^pokemon-/,'');
  const currentSession=()=>state?.sessions.find(s=>s.game===currentGame());
  // Browsers can reuse decoded images even for no-store responses. Version every
  // game image, including images inserted by farming/collection panels, by ROM.
  function versionArtwork(image) {
    const url=new URL(image.src,location.href);if(url.origin!==location.origin)return;
    const match=url.pathname.match(/^\/api\/rom-art\/([^/]+)\//)||url.pathname.match(/^\/assets\/pokedex\/([^/]+)\//);
    const legacy=url.pathname.startsWith('/assets/firered/');
    const shared=/^\/assets\/pokemon\/(items|ui)\//.test(url.pathname);
    if(!match&&!legacy&&!shared)return;
    const game=match?match[1]:legacy?'firered':currentGame()||'firered';
    url.searchParams.set('rom',state?.artwork?.[game]?.sha256||'missing');
    if(shared)url.searchParams.set('game',game);
    if(image.src!==url.href)image.src=url.href;
  }
  new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='attributes')versionArtwork(record.target);
      else for(const node of record.addedNodes){
        if(node.nodeType!==1)continue;
        if(node.tagName==='IMG')versionArtwork(node);
        node.querySelectorAll('img').forEach(versionArtwork);
      }
    }
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  $('#suite-install-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
    text('#suite-install-status','Checking and installing the game resources…');
    try{const result=await api('/api/install/firered',Object.fromEntries(new FormData(form)));text('#suite-install-status',result.message);await refresh();}
    catch(error){text('#suite-install-status',error.message);}finally{button.disabled=false;}
  });
  function manualView(open) {
    const session=currentSession(),game=currentGame();
    $('#suite-manual-toggle').setAttribute('aria-pressed',String(open));
    $('#suite-manual-toggle').textContent=open?'Release controller':'Take control';
    window.dispatchEvent(new CustomEvent('pokemon-suite-manual-view',{detail:{game,sessionId:session?.sessionId,open}}));
  }
  $('#suite-manual-toggle').addEventListener('click',async()=>{
    if($('#suite-manual-toggle').getAttribute('aria-pressed')==='true'){manualView(false);return;}
    const session=currentSession();if(!session?.sessionId)return;
    try {
      // The task API releases the bot before accepting any manual controller input.
      if(session.bot)await api('/api/pokemon-suite/player-tasks',{game:currentGame(),action:'stop'});
      await refresh();manualView(true);
    }catch(error){notify(error.message);}
  });
  for(const button of document.querySelectorAll('[data-journey-tab]'))button.addEventListener('click',()=>{
    for(const item of document.querySelectorAll('[data-journey-tab]'))item.setAttribute('aria-pressed',String(item===button));
    $('.journey-content').dataset.mobileTab=button.dataset.journeyTab;
    window.dispatchEvent(new Event('pokemon-suite-live-tab'));
  });
  $('#journey-manual-toggle').addEventListener('click',()=>document.querySelector('[data-journey-tab=manual]').click());
  $('#suite-download-report').addEventListener('click',()=>{
    // Reports stay with the Suite and can be attached to any issue tracker or editor.
    const report={schema:'pokemon-suite/diagnostic-report/v1',createdAt:new Date().toISOString(),game:currentGame()||null,
      host:state?.diagnostics?.host,issues:state?.diagnostics?.issues,session:currentSession()||null};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=node('a','');link.href=url;link.download=`pokemon-suite-${report.game||'setup'}-report.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  function renderTelemetry(emulator) {
    const session=currentSession(), pack=currentPack();
    $('#journey-deck').hidden=!pack;
    $('#suite-manual-toggle').disabled=!session?.sessionId||['closed','offline'].includes(session.state);
    $('#journey-manual-toggle').disabled=$('#suite-manual-toggle').disabled;
    $('#journey-manual-toggle').title='Open manual play';
    window.SuitePlaybackStatus=session;
    window.SuiteHuntPanel.update(emulator);
    const model=window.SuiteLivePanel.projectProgressDeck(emulator,previousModel);
    if(!model)return;
    previousModel=model;
    const trainer=model.trainerCard;
    for(const [id,value] of Object.entries({title:trainer.name,'trainer-name':trainer.name,'trainer-id':trainer.id,money:trainer.money,pokedex:trainer.pokedex,'play-time':trainer.playTime,location:trainer.location,'team-count':`${model.team.length} / 6`}))text('#journey-'+id,value);
    const portrait=$('#journey-trainer-portrait');if(trainer.portrait){portrait.src=trainer.portrait;portrait.alt=trainer.portraitAlt;}
    const readable=trainer.activity?.readable;
    text('#journey-campaign',readable?.goal||trainer.goal||session?.bot?.objective?.id||'Ready for commands');
    text('#journey-current-decision',readable?.now||session?.bot?.reason||session?.message||'Waiting for game telemetry');
    text('#journey-why',readable?.why||'');
    const party=$('#journey-party');
    const signature=JSON.stringify(model.team);
    if(party.dataset.signature!==signature){
      party.dataset.signature=signature;party.replaceChildren();
      for(const mon of model.team){
        const row=node('article','suite-party-member'),sprite=node('img','');sprite.src=mon.sprite;sprite.alt='';
        const copy=node('div','');copy.append(node('strong','',`${mon.position}. ${mon.name} · Lv. ${mon.level}`),node('small','',`${mon.hp} HP · ${mon.status||'Healthy'}`));
        const health=node('progress','');health.max=100;health.value=mon.hpPercent;health.setAttribute('aria-label',mon.name+' health');
        const experience=node('progress','');experience.max=100;experience.value=mon.experiencePercent;experience.setAttribute('aria-label',mon.name+' experience');
        copy.append(health,node('small','',`${window.SuiteItems?.[mon.heldItem]?.name||'No held item'} · ${mon.experience||'XP unavailable'}`),experience);row.append(sprite,copy);party.append(row);
      }
      if(!model.team.length)party.append(node('p','suite-empty','Team details appear after loading a supported game save.'));
    }
    $('#journey-stats').replaceChildren(...model.stats.map(s=>{const el=node('span','');el.append(node('strong','',s.value),node('small','',s.label));return el;}));
    $('#journey-badges').replaceChildren(...model.badges.map(b=>{const el=node('span','suite-badge',b.label);el.dataset.earned=String(b.earned);return el;}));
  }
  async function connectFrames(game, signal) {
    let pending=new Uint8Array(), paintId=0, newest;
    try {
      const response=await fetch(`/game/${game}/stream`,{signal,cache:'no-store'});
      if(!response.ok)throw Error('Start the game to connect its screen.');
      const reader=response.body.getReader();
      while(!signal.aborted){
        const {value,done}=await reader.read();if(done)break;
        const bytes=new Uint8Array(pending.length+value.length);bytes.set(pending);bytes.set(value,pending.length);pending=bytes;
        let offset=0;
        while(pending.length-offset>=16){
          const view=new DataView(pending.buffer,pending.byteOffset+offset,16);
          const width=view.getUint16(4),height=view.getUint16(6),length=view.getUint32(8);
          if(view.getUint32(0)!==0x4d524631||width<1||height<1||width>4096||height>4096||length!==width*height*4)throw Error('The emulator sent an invalid frame.');
          if(pending.length-offset<16+length)break;
          newest={width,height,pixels:new Uint8ClampedArray(pending.slice(offset+16,offset+16+length))};offset+=16+length;
        }
        pending=pending.slice(offset);
        if(newest&&!paintId)paintId=requestAnimationFrame(()=>{
          paintId=0;if(signal.aborted)return;
          if(canvas.width!==newest.width||canvas.height!==newest.height){canvas.width=newest.width;canvas.height=newest.height;}
          canvas.getContext('2d',{alpha:false}).putImageData(new ImageData(newest.pixels,newest.width,newest.height),0,0);
          screenMessage.hidden=true;
        });
      }
      if(!signal.aborted)throw Error('Reconnecting to the game…');
    }catch(error){if(!signal.aborted){screenMessage.textContent=error.message;screenMessage.hidden=false;reconnectTimer=setTimeout(()=>connectFrames(game,signal),1500);}}
    finally{if(paintId)cancelAnimationFrame(paintId);}
  }
  async function connectAudio(game) {
    const generation=++audioGeneration;audioController?.abort();audioController=new AbortController();
    if(!audioEnabled||!game)return;
    try {
      const health=await api(`/game/${game}/health`);if(generation!==audioGeneration)return;
      const sampleRate=health.audio?.sampleRate,channels=health.audio?.channels;
      if(!sampleRate||channels!==2)throw Error('This emulator has no compatible audio feed.');
      const response=await fetch(`/game/${game}/audio`,{signal:audioController.signal});if(!response.ok)throw Error('Audio unavailable');
      const reader=response.body.getReader();let remainder=new Uint8Array(),scheduled=audioContext.currentTime;
      while(generation===audioGeneration&&audioEnabled){
        const {done,value}=await reader.read();if(done)break;
        const bytes=new Uint8Array(remainder.length+value.length);bytes.set(remainder);bytes.set(value,remainder.length);
        const frames=Math.floor(bytes.length/4);remainder=bytes.slice(frames*4);if(!frames)continue;
        // Bound latency after backgrounding or a slow connection: drop old audio.
        if(scheduled-audioContext.currentTime>.25)continue;
        const buffer=audioContext.createBuffer(2,frames,sampleRate),data=new DataView(bytes.buffer);
        for(let c=0;c<2;c++){const out=buffer.getChannelData(c);for(let i=0;i<frames;i++)out[i]=data.getInt16(i*4+c*2,true)/32768;}
        const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioContext.destination);
        scheduled=Math.max(audioContext.currentTime+.02,scheduled);source.start(scheduled);scheduled+=buffer.duration;
      }
    }catch(error){if(generation===audioGeneration&&error.name!=='AbortError')notify(error.message);}
  }
  $('#audio-toggle').addEventListener('click',async()=>{
    audioEnabled=!audioEnabled;
    if(audioEnabled){audioContext ||= new AudioContext();await audioContext.resume();}else await audioContext?.suspend();
    $('#audio-toggle').setAttribute('aria-pressed',String(audioEnabled));text('#audio-toggle',audioEnabled?'Sound on':'Sound off');void connectAudio(currentGame());
  });
  function mountGame() {
    const pack=currentPack(),session=currentSession(),game=currentGame(),key=`${game||''}:${session?.sessionId||''}`;
    if(key===selectedKey)return;selectedKey=key;previousModel=null;
    manualView(false);streamController?.abort();clearTimeout(reconnectTimer);disposeControls?.();disposeShell?.();
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);screenMessage.hidden=false;
    if(!pack){screenMessage.textContent='Choose a game in ROMs.';return;}
    if(['gb','gbc','gba'].includes(pack.game.platform))disposeShell=window.SuiteHardwareShell.mount(stage,pack.game.platform);
    disposeControls=window.SuitePlayback.mount(stage,canvas,pack,()=>Boolean(state?.controlAvailable));
    streamController=new AbortController();void connectFrames(game,streamController.signal);void connectAudio(game);
  }
  let refreshing;
  async function refresh() {
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      state=await api('/api/state');
      window.SuiteUpdates?.update(state,currentGame());
      const revision=JSON.stringify(Object.entries(state.software?.active||{}).filter(([key])=>key.startsWith('data:')));
      if(dataRevisions&&dataRevisions!==revision)window.dispatchEvent(new Event('suite-data-updated'));
      dataRevisions=revision;
      document.querySelectorAll('img').forEach(versionArtwork);
      const session=currentSession(),pack=currentPack();
      const emulator={...session,pokemonSuite:session,spectator:session?.spectator,game:pack?.game};
      suite.update({...state,cards:state.cartridges,emulator});mountGame();renderTelemetry(emulator);
      text('#connection-status',session?.sessionId?'Game connected':'Local service connected');
    })().finally(()=>refreshing=null);
    return refreshing;
  }
  suite=window.PokemonSuite.create({root:$('#pokemon-suite'),
    openViewer:async id=>{await api('/api/select',{game:id.replace(/^pokemon-/,'')});await refresh();},
    onGameMessage:notify,onViewChange:view=>{try{localStorage.setItem('pokemon-suite.view',view);}catch{}}
  });
  (async()=>{
    try {await refresh();suite.setLibraryOpen(false);suite.open(localStorage.getItem('pokemon-suite.view')||(state.selected?'workspace':'roms'));}
    catch(error){text('#connection-status','Connection failed');notify(error.message);}
    setInterval(()=>{if(!document.hidden)void refresh().catch(error=>{text('#connection-status','Reconnecting…');notify(error.message);});},2000);
  })();
})();
