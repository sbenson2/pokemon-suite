/* Original console recordings, played only for explicit power-on transactions. */
(() => {
 async function installedRecordings(){
  const response=await fetch('/api/presentation-assets',{cache:'no-store'});
  if(!response.ok)return {};
  return (await response.json()).recordings||{};
 }
 function isPowered(session){
  if(!session?.sessionId||['closed','offline'].includes(session.state))return false;
  if(session.consolePresentation)return true;
  if(typeof session.bot?.consolePowered==='boolean')return session.bot.consolePowered;
  if(session.state==='stopped')return false;
  // Older bot owners have no explicit power flag. Only a disabled, paused
  // owner represents power-off; an inspection pause leaves the console on.
  return !(session.bot?.enabled===false&&session.control?.paused);
 }
 function create({stage,getMuted=()=>true,suppressAudio=()=>{},recordings=installedRecordings}){
  let assets={};
  const screen=document.createElement('div');screen.className='console-power-screen';screen.hidden=true;
  screen.setAttribute('aria-label','Console display');
  let generation=0,booting=false,currentGame='',cancelPlayback=null,activeVideo=null;
  function attach(){if(!screen.hidden&&screen.parentNode!==stage)stage.append(screen);}
  const observer=new MutationObserver(attach);observer.observe(stage,{childList:true});stage.append(screen);
  function display(phase,platform,visible=true){screen.dataset.phase=phase;screen.dataset.platform=platform;screen.hidden=!visible;attach();}
  function audio(){if(activeVideo)activeVideo.muted=getMuted();}
  window.addEventListener('pokemon-suite-audio',audio);
  function clearMedia(){cancelPlayback?.();cancelPlayback=null;activeVideo?.pause();activeVideo=null;screen.replaceChildren();}
  async function play(source,token){
   const video=document.createElement('video');activeVideo=video;video.className='console-power-video';
   video.playsInline=true;video.preload='auto';video.muted=getMuted();video.src=source;
   video.setAttribute('aria-label','Original console startup');screen.replaceChildren(video);attach();
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(Error('The console startup video could not finish. Press Start game to retry.')),20000);
    function finish(error){clearTimeout(timer);video.onended=null;video.onerror=null;cancelPlayback=null;error?reject(error):resolve();}
    cancelPlayback=()=>finish(Error('Console startup cancelled.'));
    video.onended=()=>finish();video.onerror=()=>finish(Error('The original startup recording could not load. Press Start game to retry.'));
    video.play().catch(async error=>{
     if(token!==generation)return;
     if(error.name==='NotAllowedError'){video.muted=true;try{await video.play();}catch(e){finish(e);}}
     else finish(error);
    });
   });
  }
  async function boot({game,platform,start,open,finish}){
   const token=++generation;clearMedia();booting=true;currentGame=game;
   display('starting',platform);suppressAudio(true);
   try{
    assets=await recordings();
    if(token!==generation)throw Error('Console startup changed.');
    const source=assets[platform],session=await start(Boolean(source));
    if(token!==generation)throw Error('Console startup changed.');
    const present=Boolean(source&&session.consolePresentation?.id);
    if(source&&!present&&!session.bot?.enabled)throw Error('The game did not confirm its startup pause.');
    await open();attach();
    if(token!==generation)throw Error('Console startup changed.');
    if(present){await play(source,token);if(token!==generation)throw Error('Console startup changed.');await finish(session);}
    if(token!==generation)throw Error('Console startup changed.');
    booting=false;clearMedia();display('on',platform,false);suppressAudio(false);
   }catch(error){if(token===generation){booting=false;clearMedia();display('error',platform);suppressAudio(true);}throw error;}
  }
  function update({game,platform,session,visible}){
   if(booting)return;
   if(!visible){screen.hidden=true;suppressAudio(false);return;}
   currentGame=game;
   const off=Boolean(session&&!isPowered(session));
   if(off){clearMedia();display('off',platform);suppressAudio(true);}
   else if(session?.consolePresentation?.phase==='waiting'){display('starting',platform);suppressAudio(true);}
   else if(isPowered(session)){display('on',platform,false);suppressAudio(false);}
  }
  function dispose(){generation++;booting=false;clearMedia();observer.disconnect();screen.remove();window.removeEventListener('pokemon-suite-audio',audio);suppressAudio(false);}
  return {boot,update,dispose,hasRecording:platform=>Boolean(assets[platform])};
 }
 window.SuiteConsolePower={create,isPowered};
})();
