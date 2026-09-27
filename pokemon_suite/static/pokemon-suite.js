(() => {
  'use strict';
  const ID = 'pokemon-suite';
  const STORAGE = 'pokemon-suite.tasks.v1';
  const isPokemon = pack => Boolean(pack && (pack.id === 'kanto' ||
    /^(pokemon-|master-red(?:-|$))/.test(pack.id || '') || /^pokemon-/.test(pack.game?.id || '')));
  function resolveGame(state) {
    const pack=state.packs?.find(p=>p.id===state.selected);
    if(pack?.game?.id?.startsWith('pokemon-'))return pack.game.id.slice(8);
    if(['master-red-research','master-red-v3','pokemon-test-fleet','kanto'].includes(state.selected))return 'firered';
    const match=/^pokemon-([a-z0-9-]+)-(?:research|suite)$/.exec(state.selected||'');
    return match?.[1] || null;
  }
  function projectLibrary(cards) {
    const members = cards.filter(isPokemon);
    if (!members.length) return cards;
    const suite = {id:ID,name:'Pokémon Suite',kind:'suite',
      searchText:members.map(p=>`${p.id} ${p.name || ''} ${p.game?.title || ''} ${p.gallery?.title || ''}`).join(' '),
      releaseIds:[...new Set(members.flatMap(p => p.releaseIds || [p.id]))],
      gallery:{title:'Pokémon Suite',subtitle:'Games, bot tasks and tests',label:'Pokémon Suite',
        cover:'./assets/gallery/pokemon-suite.svg',accent:'#b45350'}};
    let inserted = false;
    return cards.flatMap(card => {
      if (!isPokemon(card)) return [card];
      if (inserted) return [];
      inserted = true;
      return [suite];
    });
  }
  function readDrafts(raw) {
    try {
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) return [];
      return entries.filter(d => d && typeof d.id === 'string' && typeof d.text === 'string' && d.text.trim())
        .slice(0,50).map(d => ({id:d.id.slice(0,100),text:d.text.slice(0,1000),
          game:typeof d.game === 'string' ? d.game.slice(0,100) : '',
          createdAt:typeof d.createdAt === 'string' ? d.createdAt.slice(0,40) : '',state:'draft'}));
    } catch {return [];}
  }
  function create({root,openViewer,onViewChange,onVisibilityChange,onGameMessage,consolePower}) {
    // Keep one settings form and its drafts while moving between the live card
    // and the full settings page. The player deck is outside the suite root.
    const botWorkspace=root.querySelector('.suite-bot-workspace');
    const botWorkspaceHome=botWorkspace.parentNode;
    const $ = selector => root.querySelector(selector)||botWorkspace.querySelector(selector);
    const streamStatus=document.querySelector('.live-footer');
    const streamStatusHome=document.createComment('Suite stream status');
    streamStatus.before(streamStatusHome);
    const panels = [...root.querySelectorAll('[data-suite-panel]')];
    const tabs = [...root.querySelectorAll('[data-suite-view]')];
    const form = $('#suite-task-form'), input = $('#suite-task-text'), taskGame = $('#suite-task-game');
    const message = $('#suite-task-message');
    const libraryLabel = document.querySelector('#library').textContent;
    const brand = document.querySelector('.workspace-brand strong');
    const brandLabel = brand.textContent;
    let opened = false, libraryOpen = true, view = 'workspace', busy = false;
    let state = {cards:[],packs:[],selected:'',controlAvailable:false,emulator:null}, signature = '';
    let drafts = [], sessions = [], library = [];
    let collection=null,botSettings=null,botTasks=null,campaignRuns=null,botBusy=false,botError='',botGame='',openMessage='',liveBusy=false;
    const liveStart=document.querySelector('#suite-live-start');
    const selectedGame=()=>resolveGame(state);
    const controlGame=()=> (view==='workspace'?selectedGame():botGame)||selectedGame()||sessions.find(s=>s.bot)?.game||library[0]?.id;
    const selectedSession=()=>sessions.find(s=>s.game===controlGame()) || (state.emulator?.pokemonSuite?.game===controlGame()?state.emulator?.pokemonSuite??null:null);
    const controlCard=()=>state.cards.find(c=>c.id===`pokemon-${controlGame()}`);
    const words=value=>String(value||'').replace(/[-_]/g,' ');
    function renderBot(){
      const game=controlGame(),session=selectedSession(),bot=session?.bot,available=Boolean(bot),entry=library.find(e=>e.id===game),card=controlCard();
      const fleet=currentPack()?.id==='pokemon-test-fleet';
      if(fleet&&botWorkspace.dataset.testCampaign!=='true')$('.suite-bot-reports').open=true;
      botWorkspace.dataset.testCampaign=String(fleet);
      $('#suite-bot-live-info').hidden=game!==selectedGame()||!isPokemon(currentPack());
      const runSettingsActive=opened&&(view==='tests'||(view==='workspace'&&(matchMedia('(min-width:1801px)').matches||document.querySelector('.journey-content').dataset.mobileTab==='bot')));
      campaignRuns?.update({game,session:fleet?null:session,owner:state.controlAvailable&&!botBusy&&!liveBusy,active:runSettingsActive});
      if(fleet){
        const emulator=state.emulator||{},evidence=window.SuiteTestFleet?.project(emulator.testFleet,emulator.runId);
        const run=evidence?.rows.find(row=>row.active)||(evidence?.rows.length===1?evidence.rows[0]:null);
        $('#suite-bot-controls').hidden=false;
        $('#suite-bot-controls strong').textContent='FireRed campaign';
        $('#suite-bot-status').textContent=run?.status||evidence?.status||'Connecting…';
        $('#suite-bot-description').textContent='This recorded campaign runs independently. Follow its progress here, or stop it and request a report.';
        const episode=emulator.testFleet?.episodes?.find(e=>e.id===run?.id);
        const details=$('#suite-bot-details');details.replaceChildren();
        for(const [label,value] of [['Campaign target',episode?.target==='hall-of-fame'?'Enter the Hall of Fame':words(episode?.target)||'Waiting for campaign'],['Progress',run?.progress||'Waiting for progress'],['Run',run?.id||'Connecting…']])details.append(node('dt','',label),node('dd','',value));
        botSettings?.update({game,session:null,owner:false,active:false});
        botTasks?.update({game,session:null,owner:false,active:false});
        window.SuiteHuntPanel?.updateCollection(null);
        renderLiveActions();return;
      }
      const title=entry?.title||({firered:'Pokémon FireRed',emerald:'Pokémon Emerald',crystal:'Pokémon Crystal'})[game]||'Choose a game';
      const select=$('#suite-bot-game');
      const choices=library.filter(e=>state.cards.some(c=>c.id===e.cartridgeId));
      const key=choices.map(e=>e.id).join(',');
      if(select.dataset.choices!==key){select.replaceChildren();for(const e of choices){const option=node('option','',e.title);option.value=e.id;select.append(option);}select.dataset.choices=key;}
      if(game&&!select.options.length){const option=node('option','',title);option.value=game;select.append(option);}
      if(game)select.value=game;
      select.disabled=view==='workspace'||busy||botBusy;
      $('#suite-game-control-title').textContent=title;
      const running=Boolean(session?.sessionId&&!['offline','closed'].includes(session.state)),checking=Boolean(running&&!sessions.some(s=>s.game===game));
      $('#suite-game-status').textContent=botError||openMessage||(checking?'Checking live game status…':!running?'Start game loads the current save and waits for your command.':bot?.awaitingCommand?'Ready for commands. Choose a task below.':!isStarted(session)?'Game stopped. Start game to prepare for your next command.':session.message||'The bot is on. Choose a task or stop the game below.');
      $('#suite-bot-controls strong').textContent='Pokémon bot';
      $('#suite-bot-controls').hidden=false;root.dataset.botControls='false';document.body.dataset.suiteBotControls='false';
      $('#suite-bot-status').textContent=checking?'Checking…':!available?'Manual play':bot.awaitingCommand?'Ready for commands':!bot.enabled?'Off':session?.control?.paused?'Game paused':['waiting','blocked'].includes(bot.status)?'Needs attention':'Running';
      $('#suite-bot-description').textContent=!available?'This game supports manual play. An automatic bot driver is not implemented for it yet.':bot.reason||'Start bot loads the current save and waits for a command. Run task begins your chosen task.';
      const details=$('#suite-bot-details');details.replaceChildren();
      if(bot){
        for(const [label,value] of [['Activity',words(bot.activity)],['Current task',bot.preparation?.reason||words(bot.objective?.id)||'Ready for commands'],['Task phase',words(bot.preparation?.phase||bot.status)],['Saved progress',session.save?.updatedAt?new Date(session.save.updatedAt).toLocaleString():'No save receipt available']]){details.append(node('dt','',label),node('dd','',value));}
      }
      // Why it stopped (L1.1): the host's read-only triage; a suggested fix runs only on the owner's tap.
      const triage=available&&session?.triage||null;
      window.SuiteStopTriage?.render($('#suite-bot-triage'),{game,triage:triage&&!state.controlAvailable&&triage.suggestedAction?.safe?{...triage,suggestedAction:{...triage.suggestedAction,safe:false,why:'Owner control is required to run this fix.'}}:triage,post:postTriage,details:triageDetails,
        done:message=>{botError=message;if(message)showOpenMessage(message);renderBot();}});
      $('#suite-bot-farming').disabled=!available;$('#suite-bot-shinies').disabled=!available;
      const settingsActive=opened&&(view==='tests'||(view==='workspace'&&(matchMedia('(min-width:1801px)').matches||document.querySelector('.journey-content').dataset.mobileTab==='bot')));
      botSettings?.update({game,session,owner:state.controlAvailable,active:settingsActive});
      botTasks?.update({game,session,owner:state.controlAvailable&&!botBusy&&!liveBusy,active:settingsActive});
      window.SuiteHuntPanel?.updateCollection(liveSession()?.collectionRun||null);
      renderLiveActions();
    }
    // The existing player-tasks action with the suggestion's token; the host refuses it (409) if the stop changed.
    async function postTriage(body){
      const response=await fetch('./api/pokemon-suite/player-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();
      if(!response.ok)throw Error(result.error||'The suggested fix was not accepted.');
      return result;
    }
    async function triageDetails(game){
      const response=await fetch(`./api/pokemon-suite/stop-triage?game=${encodeURIComponent(game)}`,{cache:'no-store'}),result=await response.json();
      return response.ok?result.triage:null;
    }
    $('#suite-bot-game').addEventListener('change',event=>{botGame=event.target.value;botError='';renderBot();});
    window.addEventListener('pokemon-suite-live-tab',()=>renderBot());
    matchMedia('(min-width:1801px)').addEventListener('change',()=>renderBot());
    async function openBotPage(next){
      const game=controlGame(),card=controlCard();
      if(!card||busy||botBusy)return;
      if(game!==selectedGame()&&!await openCard(card))return;
      selectView(next);
    }
    $('#suite-bot-farming').addEventListener('click',()=>void openBotPage('tasks'));
    $('#suite-bot-shinies').addEventListener('click',()=>void openBotPage('shinies'));
    const liveSession=()=>sessions.find(s=>s.game===selectedGame())||(state.emulator?.pokemonSuite?.game===selectedGame()?state.emulator?.pokemonSuite??null:null);
    const isPowered=session=>window.SuiteConsolePower.isPowered(session);
    const isStarted=session=>session?.capabilities?.bot!==false&&session?.bot&&['firered','emerald'].includes(session.game)?Boolean(session.bot.enabled||session.consolePresentation):isPowered(session);
    function renderLiveActions(){
      if(!liveStart)return;
      const session=liveSession(),game=selectedGame(),confirmed=Boolean(sessions.some(s=>s.game===game&&s.sessionId===session?.sessionId));
      const isFleet=currentPack()?.id==='pokemon-test-fleet';
      const consolePanel=document.querySelector('#suite-console');
      consolePanel.hidden=!opened||libraryOpen||view!=='workspace'||!game||isFleet;
      document.querySelector('.journey-bot')?.setAttribute('hidden','');
      document.body.dataset.suiteConsole=String(opened&&!libraryOpen&&view==='workspace'&&Boolean(game));
      const platform=library.find(e=>e.id===game)?.platform||currentPack()?.game?.platform||(['firered','emerald'].includes(game)?'gba':undefined);
      consolePower?.update({game,platform,session,visible:!consolePanel.hidden});
      liveStart.disabled=liveBusy||busy||botBusy||!state.controlAvailable||!game;
      const powered=isStarted(session);
      liveStart.dataset.started=String(powered);
      liveStart.textContent=liveBusy||botBusy?'Please wait…':powered?'Stop game':'Start game';
      liveStart.title=powered?'Stop the game and bot, preserving progress.':'Load the current save and leave the bot ready for a command.';
    }
    liveStart?.addEventListener('click',async()=>{
      const game=selectedGame(),session=liveSession();if(liveBusy||busy||botBusy||!state.controlAvailable)return;
      if(!isStarted(session)){
        const card=currentCard();if(card)await startCard(card,game);return;
      }
      await stopCard(game,session);
    });
    async function stopCard(game,session){
      if(liveBusy||busy||botBusy||!state.controlAvailable||!isStarted(session))return;
      const entry=library.find(e=>e.id===game),pack=state.packs.find(p=>p.game?.id===`pokemon-${game}`);
      if(['3ds','switch'].includes(entry?.platform||pack?.game?.platform)){
        window.SuitePlayback.closeGame(game,session,entry?.title||pack?.game?.title||game);return;
      }
      const reportStop=text=>view==='workspace'?onGameMessage?.(text):showOpenMessage(text);
      liveBusy=true;renderBot();reportStop('Stopping the game and preserving its current progress…');renderCatalog();
      try{
        const response=await fetch('./api/pokemon-suite/stop-game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game,sessionId:session.sessionId})}),result=await response.json();
        if(!response.ok)throw Error(result.error||'The game did not confirm stopping.');
        sessions=[...sessions.filter(s=>s.game!==game),result.session];
        reportStop('Game stopped. Your current progress is preserved.');
        if(result.session.state==='closed')window.dispatchEvent(new CustomEvent('pokemon-suite-game-closed',{detail:{game,sessionId:session.sessionId}}));
      }catch(error){reportStop(error.message);}
      finally{liveBusy=false;renderBot();renderCatalog();}
    }
    try {drafts = readDrafts(localStorage.getItem(STORAGE));} catch { /* Storage errors are reported on save. */ }
    const node = (tag,cls,text) => {const el=document.createElement(tag);el.className=cls;if(text)el.textContent=text;return el;};
    const currentPack = () => state.packs.find(p => p.id === state.selected);
    const currentCard = () => state.cards.find(p => p.id === state.selected || p.releaseIds?.includes(state.selected));
    const presentation = card => ({title:card?.game?.title||card?.name||card?.id||'Choose a game',cover:card?.game?.cover||'./assets/pokemon/items/poke_ball.png'});
    const title = card => presentation(card).title;
    function showOpenMessage(text) {
      openMessage=text;
      $('#suite-open-message').textContent = text;
      $('#suite-tests-message').textContent = text;
      if(opened&&view==='workspace')onGameMessage?.(text);
      renderBot();
    }
    function openingMessage(card,verb) {
      const game=card.id.replace(/^pokemon-/,'');
      const previous=sessions.find(s=>s.game!==game && s.sessionId && !['offline','closed'].includes(s.state)
        && library.some(e=>e.id===s.game && ['3ds','switch'].includes(e.platform)));
      return previous ? `Closing the previous 3DS or Switch game before opening ${title(card)}…` : `${verb} ${title(card)}…`;
    }
    function visibility() {
      root.hidden = !opened;
      root.inert = libraryOpen || !opened;
      document.body.dataset.pokemonSuite = String(opened);
      window.SuiteTheme?.sync();
      onVisibilityChange?.(opened);
      document.body.dataset.suiteView = view;
      document.querySelector('#player-layout').inert = libraryOpen || (opened && view !== 'workspace');
      const settingsHome=opened&&view==='workspace'?document.querySelector('#journey-settings-host'):botWorkspaceHome;
      if(botWorkspace.parentNode!==settingsHome)settingsHome.append(botWorkspace);
      if(opened&&!libraryOpen)$('#suite-stream-status-host').append(streamStatus);
      else if(streamStatus.parentNode!==streamStatusHome.parentNode)streamStatusHome.after(streamStatus);
      for (const panel of panels) panel.hidden = panel.dataset.suitePanel !== view;
      for (const tab of tabs) tab.setAttribute('aria-pressed',String(tab.dataset.suiteView === view));
      document.querySelector('#library').textContent = opened ? 'Suite' : libraryLabel;
      brand.textContent = opened ? 'Pokémon Suite' : brandLabel;
      collection?.update({active:opened&&view==='shinies',controlAvailable:state.controlAvailable});
      renderLiveActions();
    }
    function selectView(next) {
      if (!['workspace','pokedex','tasks','shinies','roms','tests','settings'].includes(next)) return;
      const previous = view;
      const liveSettings=next==='tests'&&isPokemon(currentPack());
      view = liveSettings?'workspace':next;
      if (view === 'workspace' && !isPokemon(currentPack())) view = 'roms';
      visibility();
      if(liveSettings)document.querySelector('[data-journey-tab="bot"]').click();
      renderBot();
      if (view === 'pokedex' || view === 'tasks') farming?.show(view);
      if (previous !== view) onViewChange?.(view);
    }
    window.addEventListener('pokemon-suite-game-closed',event=>{sessions=sessions.map(s=>s.game===event.detail.game?{...s,state:'closed'}:s);signature='';renderCatalog();showOpenMessage('Game closed.');});
    async function startCard(card,game){
      if(busy||botBusy||liveBusy||!state.controlAvailable)return;botBusy=true;botError='';renderBot();
      showOpenMessage(openingMessage(card,'Starting'));renderCatalog();
      const platform=library.find(e=>e.id===game)?.platform||state.packs.find(p=>card.releaseIds?.includes(p.id))?.game?.platform||(['firered','emerald'].includes(game)?'gba':undefined);
      const start=async wait=>{
        const response=await fetch('./api/pokemon-suite/start-game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game,...(wait?{waitForPresentation:true}:{})})});
        const result=await response.json();if(!response.ok)throw Error(result.error);
        sessions=[...sessions.filter(s=>s.game!==game),result.session];return result.session;
      };
      const open=async()=>{if(!await openCard(card))throw Error('The game viewer could not connect. Press Start game to retry.');};
      const finish=async session=>{
        const response=await fetch('./api/pokemon-suite/console-presented',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game,sessionId:session.sessionId,presentationId:session.consolePresentation.id})});
        const result=await response.json();if(!response.ok)throw Error(result.error);
        sessions=[...sessions.filter(s=>s.game!==game),result.session];return result.session;
      };
      try{if(consolePower)await consolePower.boot({game,platform,start,open,finish});else{await start(false);await open();}const campaign=sessions.find(s=>s.game===game)?.campaign;showOpenMessage(campaign&&campaign.status!=='complete'?'Resuming the saved adventure.':(['firered','emerald'].includes(game)?'Ready for commands. Choose a task in Bot settings.':'Game started. Manual play is available.'));}
      catch(error){botError=error.message;showOpenMessage(error.message);}finally{botBusy=false;renderBot();renderCatalog();}
    }
    async function openCard(card) {
      if (busy) return;
      busy = true; botError=''; signature = ''; renderCatalog();
      showOpenMessage(openingMessage(card,'Opening'));
      try {
        const result = await openViewer(card.id);
        if (result?.error) throw new Error(result.error);
        showOpenMessage('');
        selectView(card.id === 'pokemon-test-fleet' && view === 'tests' ? 'tests' : 'workspace');
        return true;
      } catch (error) {
        showOpenMessage(error.message || 'The viewer could not open. Try again.');
      } finally {busy = false; signature = ''; renderCatalog();renderBot();}
    }
    function renderCatalog() {
      const cards = state.cards.filter(isPokemon).filter(c => c.id !== ID);
      const key = JSON.stringify([cards,state.selected,state.controlAvailable,busy,botBusy,liveBusy,sessions,library,$('#suite-game-search')?.value,$('#suite-game-platform')?.value]);
      if (signature === key) return;
      signature = key;
      const list = $('#suite-rom-list'); list.replaceChildren();
      const ordinary = cards.filter(c => c.id !== 'pokemon-test-fleet');
      const shown=library.length ? library.map(entry=>({entry,card:ordinary.find(c=>c.id===entry.cartridgeId)})) : ordinary.map(card=>({card}));
      const query=($('#suite-game-search')?.value||'').toLowerCase(),platform=$('#suite-game-platform')?.value||'all';
      for (const {card,entry} of shown) {
        if(query && !(entry?.title||title(card)).toLowerCase().includes(query))continue;
        if(platform!=='all'&&entry?.platform!==platform)continue;
        const row = node('article','suite-rom-row');
        const info = card ? presentation(card) : {title:entry.title,cover:'./assets/pokemon/items/poke_ball.png'};
        const image = node('img','suite-rom-art');image.src=info.cover;image.alt='';
        image.addEventListener('error',()=>image.remove(),{once:true});
        const copy=node('div','suite-rom-copy');copy.append(node('h3','',info.title));
        const game=entry?.id||card.id.replace(/^pokemon-/,''),session=sessions.find(s=>s.game===game);
        if(entry)copy.append(node('span','suite-game-platform',`${({gb:'Game Boy',gbc:'Game Boy Color',gba:'Game Boy Advance',nds:'Nintendo DS','3ds':'Nintendo 3DS',switch:'Nintendo Switch'})[entry.platform]} · ${entry.region}`));
        if(entry?.updateCount||entry?.dlcCount)copy.append(node('p','',`${entry.updateCount} updates · ${entry.dlcCount} DLC files found`));
        copy.append(node('p','',!card ? entry.reason : session?.save ? `${session.save.schema==='pokemon-suite/checkpoint/v1'?'Checkpoint':session.save.schema==='pokemon-suite/native-backup/v1'?'Native save backup':'Game save'} · ${new Date(session.save.updatedAt).toLocaleString()}` : entry?.capabilities?.bot ? 'Resume current game save' : 'Separate game save · manual play'));
        if(session?.mission)copy.append(node('p','',`Hunt ${session.mission.state} · ${session.mission.encounters} encounters`));
        const powered=isStarted(session);
        const button = node('button','suite-secondary',!card ? entry.status==='missing'?'Image missing':'Awaiting emulator' : powered ? 'Stop' : 'Start');
        button.type='button';button.disabled=!card || busy || botBusy || liveBusy || !state.controlAvailable;
        button.setAttribute('aria-label',`${powered?'Stop':'Start'} ${info.title}`);
        if(card)button.addEventListener('click',()=>powered?stopCard(game,session):startCard(card,game));
        row.append(image,copy,button);
        list.append(row);
      }
      if (!ordinary.length) list.append(node('p','suite-empty','Add your game images and emulator resources in Settings to start playing.'));
      $('#suite-tests-description').textContent='Download this game’s current status, save receipts and bot diagnostics for investigation.';
      const selectedGame = taskGame.value;
      taskGame.replaceChildren();
      const option=node('option','','Current Pokémon game');option.value='current';taskGame.append(option);
      for (const card of ordinary) {const option=node('option','',title(card));option.value=card.id;taskGame.append(option);}
      if ([...taskGame.options].some(o => o.value === selectedGame)) taskGame.value=selectedGame;
    }
    for(const selector of ['#suite-game-search','#suite-game-platform'])$(selector)?.addEventListener('input',()=>{signature='';renderCatalog();});
    $('#suite-library-scan')?.addEventListener('click',async event=>{
      if(!state.controlAvailable)return;const button=event.currentTarget;button.disabled=true;showOpenMessage('Scanning the collection…');
      try{const response=await fetch('./api/pokemon-suite/scan-library',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok)throw Error(result.error);library=result.library;signature='';renderCatalog();showOpenMessage(`${library.filter(g=>g.status!=='missing').length} versions found or installed · ${library.filter(g=>g.status==='missing').length} images missing.`);}
      catch(error){showOpenMessage(error.message);}finally{button.disabled=!state.controlAvailable;}
    });
    function persist(next) {
      try {localStorage.setItem(STORAGE,JSON.stringify(next));drafts=next;renderDrafts();return true;}
      catch {message.textContent='Could not save on this device. Keep or copy the request text before closing.';return false;}
    }
    function renderDrafts() {
      const list=$('#suite-task-list');list.replaceChildren();
      $('#suite-task-count').textContent = String(drafts.length);
      if (!drafts.length) list.append(node('p','suite-empty','No saved requests. Write a task above to keep it here.'));
      for (const draft of drafts) {
        const row=node('article','suite-draft');
        const heading=node('div','suite-draft-heading');
        heading.append(node('span','suite-draft-state','Draft'),node('span','suite-draft-game',
          draft.game && draft.game !== 'current' ? title({id:draft.game}) : 'Current Pokémon game'));
        const copy=node('button','suite-text-button','Copy request');copy.type='button';
        copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(draft.text);message.textContent='Request copied.';}catch{message.textContent='Copy was unavailable. Select and copy the request text.';}});
        const remove=node('button','suite-text-button','Remove');remove.type='button';
        remove.addEventListener('click',()=>persist(drafts.filter(d=>d.id!==draft.id)));
        const actions=node('div','suite-draft-actions');actions.append(copy,remove);
        row.append(heading,node('p','suite-draft-text',draft.text),actions);list.append(row);
      }
    }
    for (const tab of tabs) tab.addEventListener('click',()=>selectView(tab.dataset.suiteView));
    for (const suggestion of root.querySelectorAll('[data-suite-prompt]')) suggestion.addEventListener('click',()=>{
      input.value=suggestion.dataset.suitePrompt;input.focus();
    });
    form.addEventListener('submit',event=>{
      event.preventDefault();const text=input.value.trim();
      if (!text) {input.focus();return;}
      if (drafts.length >= 50) {message.textContent='Remove a saved request before adding another. This device can keep 50 drafts.';return;}
      const card=currentCard();
      const game=taskGame.value==='current' ? (card?.id==='pokemon-test-fleet' ? 'pokemon-firered' : card?.id || 'current') : taskGame.value;
      const draft={id:crypto.randomUUID(),text:text.slice(0,1000),game,createdAt:new Date().toISOString(),state:'draft'};
      if (persist([draft,...drafts])) {input.value='';message.textContent='Draft saved on this device. It has not been sent to the bot.';}
    });
    const openGame=async game=>{
      const card=state.cards.find(c=>c.id===`pokemon-${game}`||c.id===(game==='firered'?'master-red-research':`pokemon-${game}-research`));
      if(!card)throw new Error('This game’s viewer is not installed.');
      await openCard(card);
    };
    const farming = window.SuiteFarming?.create({root,selectView,openGame});
    campaignRuns=window.SuiteCampaignRuns?.create({root,onSession:session=>{sessions=[...sessions.filter(s=>s.game!==session.game),session];renderBot();},onStarted:async game=>{const card=state.cards.find(c=>c.id===`pokemon-${game}`);if(card)await openCard(card);}});
    botSettings=window.SuiteBotSettings?.create({root});
    botTasks=window.SuiteBotTasks?.create({root,onStart:game=>startCard(state.cards.find(c=>c.id===`pokemon-${game}`),game),onStop:stopCard,onFarming:()=>openBotPage('tasks'),onSession:session=>{sessions=[...sessions.filter(s=>s.game!==session.game),session];renderBot();}});
    collection=window.SuiteShinies?.create({root,openGame});
    setInterval(async()=>{
      if(!opened||!state.controlAvailable||document.hidden)return;
      try{const response=await fetch('./api/pokemon-suite/sessions',{cache:'no-store'});if(response.ok){const result=await response.json();sessions=result.sessions||[];library=result.library||[];renderBot();if(view==='roms')renderCatalog();}}catch{/* Keep the last known save status while reconnecting. */}
    },3000);
    renderDrafts();
    return {
      isOpen:()=>opened,
      open(next='workspace') {opened=true;selectView(next);},
      close() {opened=false;visibility();},
      setLibraryOpen(value) {libraryOpen=value;visibility();},
      update(next) {
        state=next;renderCatalog();renderBot();farming?.update({selected:next.selected,game:selectedGame(),controlAvailable:next.controlAvailable});
        collection?.update({active:opened&&view==='shinies',controlAvailable:next.controlAvailable});
        const active=isPokemon(currentPack()), card=currentCard();
        document.body.dataset.suiteGame = String(active);
        $('#suite-current-game').textContent=active ? (card?.id==='pokemon-test-fleet' ? 'FireRed test campaign' : title(card || currentPack())) : 'No Pokémon viewer selected';
        const emulator=state.emulator || {};
        const run=emulator.runId || emulator.testFleet?.episodes?.find(e=>e.status==='running')?.id;
        $('#suite-current-run').textContent=active && run ? run : 'Choose a viewer in ROMs';
        $('#suite-current-run').title=run || '';
        if (opened && view==='workspace' && !active) selectView('roms');
      },
    };
  }
  window.PokemonSuite={ID,isPokemon,projectLibrary,readDrafts,resolveGame,create};
})();
