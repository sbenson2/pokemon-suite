(() => {
  'use strict';

  function finite(value) {
    if (value === null || value === undefined
      || (typeof value === 'string' && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function isDecisionChannel(pack) {
    return (pack?.decisionPanel === true
      || ['master-red-v3','master-red-research'].includes(pack?.id))
      && pack?.rendererBackend === 'headless-mgba';
  }

  function projectTelemetry(emulator = {}) {
    const spectator = emulator.spectator || {};
    const map = spectator.map || {};
    const mapName = map.name || map.region || emulator.map || 'UNKNOWN';
    const mapId = finite(map.group) !== null && finite(map.number) !== null
      ? `${finite(map.group)}.${finite(map.number)}` : '';
    const position = finite(map.x) !== null && finite(map.y) !== null
      ? `@ ${finite(map.x)},${finite(map.y)}` : '';
    const party = Array.isArray(spectator.party) ? spectator.party : [];
    const lead = party[0] || null;
    const speed = finite(emulator.effectiveEmulationSpeed) ?? finite(emulator.emulationSpeed);
    const fps = finite(emulator.measuredEmulatedFps) ?? finite(emulator.emulatedFps);
    const frame = finite(emulator.frame);
    return {
      phase:String(emulator.botPhase || emulator.phase || 'STARTING').toUpperCase(),
      map:[mapName,[mapId,position].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
      speed:speed === null ? '—' : `${speed.toFixed(1)}×`,
      fps:fps === null ? '—' : fps.toFixed(1),
      frame:frame === null ? '—' : Math.max(0,Math.floor(frame)).toLocaleString('en-US'),
      party:`${party.length} / 6`,
      health:lead && finite(lead.hp) !== null
        ? `${finite(lead.hp)} / ${finite(lead.maxHp) ?? '?'}` : '—',
    };
  }

  function projectBotTelemetry(emulator = {}, now = Date.now()) {
    const telemetry = projectTelemetry(emulator);
    const current = emulator.debug?.current || {};
    const health = emulator.debug?.health || {};
    const alert = emulator.heartbeat?.level === 'critical'
      ? String(emulator.heartbeat.message || 'Controller needs attention') : '';
    const research = emulator.pokemonResearch || emulator.masterRedResearch || {};
    const playerObjective=emulator.masterRedV3?.player?.activeObjective?.rootGoal
      || research.activeObjective?.rootGoal;
    const strategy=emulator.spectator?.strategy || {};
    const suite=emulator.pokemonSuite;
    const fleet=emulator.testFleet;
    const recent=value=>Number.isFinite(Date.parse(value)) && Math.abs(now-Date.parse(value))<=15000;
    const finished=!emulator.runId && Array.isArray(fleet?.episodes) && fleet.episodes.length===1
      && !fleet.stale && !fleet.error && recent(fleet.fetchedAt)
      && ['failed','stopped','interrupted','passed'].includes(fleet.episodes[0].status)
      ? fleet.episodes[0] : null;
    const episode=emulator.runId && Array.isArray(fleet?.episodes)
      ? fleet.episodes.find(item=>item.id===emulator.runId) : finished;
    const progressAt=Date.parse(episode?.lastProgressAt);
    const stalled=finite(health.noProgressSeconds)
      ?? (Number.isFinite(progressAt) ? Math.max(0,(now-progressAt)/1000) : null);
    const playerAt=Date.parse(emulator.playerUpdatedAt);
    const sourceRecent=Number.isFinite(playerAt) ? recent(emulator.playerUpdatedAt)
      : episode?.status==='running' && recent(episode.updatedAt) && recent(fleet.fetchedAt);
    const external=emulator.externalFrameFeed===true || Boolean(research.action || research.decision);
    const stale=(Number.isFinite(playerAt) && !recent(emulator.playerUpdatedAt))
      || (episode && (fleet.stale===true || fleet.error || episode.stale===true || !recent(fleet.fetchedAt)));
    let state='SYNCING';
    if (alert) state='ATTENTION';
    else if (emulator.botPaused) state='PAUSED';
    else if (episode && episode.status!=='running') {
      state=({failed:'STOPPED',stopped:'STOPPED',interrupted:'INTERRUPTED',passed:'TARGET REACHED',pending:'QUEUED'})[episode.status] || 'SYNCING';
    } else if (stale) state='STALE';
    else if (suite?.bot) state=!suite.bot.enabled?'OFF':['waiting','blocked','protected-encounter'].includes(suite.bot.status)?'ATTENTION':suite.bot.activity==='ready'?'READY':'LIVE';
    else if (!(fleet && !episode) && (current.action || (!external && playerObjective)
      || (sourceRecent && (research.action || research.decision)))) state='LIVE';
    return {
      state,
      phase:finished ? state : telemetry.phase,
      map:finished?.map ? titleIdentifier(finished.map,{map:true}) : telemetry.map,
      action:String((suite?.bot?.activity==='ready'?'WAIT':null) || current.action || research.action?.kind || research.decision?.kind || '—').toUpperCase(),
      goal:String(suite?.localEvolution && suite.localEvolution.phase!=='complete' ? 'Paired evolution' : current.goal || playerObjective?.key || strategy.campaign?.activeObjective?.label
        || strategy.campaign?.activeObjective?.id || strategy.activeStoryGoal
        || research.winner?.recommendation?.objective || emulator.goal || '—'),
      speed:finished ? '0.0×' : telemetry.speed,fps:finished ? '0.0' : telemetry.fps,lead:telemetry.health,
      stall:stalled===null ? '—' : `${stalled.toFixed(1)}s`,alert,
    };
  }

  function spriteSlug(value) {
    return String(value || 'unknown').trim().toLowerCase()
      .replace(/♀/gu,'-f').replace(/♂/gu,'-m').replace(/['’]/gu,'')
      .normalize('NFKD').replace(/[\u0300-\u036f]/gu,'')
      .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  }

  function titleIdentifier(value, {map = false} = {}) {
    const source = String(value || '')
      .replace(map ? /^MAP_/u : /^(?:MAP_|SPECIES_)/u, '')
      .replace(/[-_]+/gu, ' ').trim();
    if (!source) return 'Not published';
    return source.split(/\s+/u).map((part) => {
      const upper = part.toUpperCase();
      if (/^[B]?\d+F$/u.test(upper)) return upper;
      if (upper === 'SS') return 'S.S.';
      if (upper === 'CO') return 'Co';
      if (upper === 'MT') return 'Mt.';
      if (upper === 'POKEMON') return 'Pokémon';
      return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
    }).join(' ');
  }

  function sentenceIdentifier(value) {
    const words = String(value || '').replace(/[-_]+/gu, ' ').trim().toLowerCase();
    return words ? `${words[0].toUpperCase()}${words.slice(1)}` : 'Not published';
  }

  function attemptPlayTime(attempt, now = Date.now()) {
    if (attempt?.schema !== 'master-red/run-attempt/v1') return null;
    const startedAt = Date.parse(String(attempt.startedAt || ''));
    const completedAt = attempt.completedAt
      ? Date.parse(String(attempt.completedAt)) : null;
    const current = finite(now);
    if (!Number.isFinite(startedAt) || current === null
      || (attempt.completedAt && !Number.isFinite(completedAt))) return null;
    const elapsed = Math.max(0,Math.floor(((completedAt ?? current) - startedAt) / 1000));
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor(elapsed % 3600 / 60);
    const seconds = elapsed % 60;
    return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }

  function campaignTarget(target = {}) {
    const parts = [];
    if (target.map) parts.push(titleIdentifier(target.map,{map:true}));
    const kind = target.kind ? titleIdentifier(target.kind) : '';
    if (kind) {
      const indexed = Number.isSafeInteger(Number(target.index))
        ? `${kind} #${Number(target.index)}` : kind;
      parts.push(indexed);
    }
    if (finite(target.x) !== null && finite(target.y) !== null) {
      parts.push(`@ ${finite(target.x)},${finite(target.y)}`);
    }
    return parts.join(' · ') || 'Target not published';
  }

  function decisionSummary(recommendation, action, decision) {
    if (!recommendation?.kind) {
      const reason = decision?.reason || action?.reason || 'awaiting policy decision';
      return `Wait · ${titleIdentifier(reason)}`;
    }
    if (recommendation.kind === 'move-toward') {
      const running = recommendation.travelMode === 'run'
        || recommendation.useRunningShoes === true
        || String(action?.reason || '').includes('running');
      const verb = running ? 'Run' : recommendation.travelMode === 'bicycle'
        ? 'Bike' : recommendation.travelMode === 'surf' ? 'Surf' : 'Move';
      const parts = [recommendation.direction
        ? `${verb} ${String(recommendation.direction).toLowerCase()}` : verb];
      const steps = finite(recommendation.remainingSteps);
      if (steps !== null) parts.push(`${steps} ${steps === 1 ? 'tile' : 'tiles'}`);
      if (recommendation.targetMap) {
        parts.push(titleIdentifier(recommendation.targetMap,{map:true}));
      }
      return parts.join(' · ');
    }
    if (recommendation.kind === 'choose-party-member') {
      const slot = finite(recommendation.targetPartySlot);
      return slot === null ? 'Choose a party member' : `Choose party slot ${slot + 1}`;
    }
    if (recommendation.kind === 'choose-battle-move') {
      const move = finite(recommendation.targetMoveId);
      const slot = finite(recommendation.targetMoveSlot);
      return [move === null ? 'Choose battle move' : `Use move #${move}`,
        slot === null ? '' : `slot ${slot + 1}`].filter(Boolean).join(' · ');
    }
    if (recommendation.kind === 'choose-battle-command') {
      return `${titleIdentifier(recommendation.targetCommand || 'battle command')}`;
    }
    return titleIdentifier(recommendation.kind);
  }

  function evidenceExplanation(reference) {
    const value = String(reference || '');
    let match = value.match(/^campaign:preparation-for:(.+)$/u);
    if (match) return `Preparing for ${titleIdentifier(match[1])}`;
    match = value.match(/^cartridge:team-anchor-level:(\d+)\/(\d+)$/u);
    if (match) return `Team anchor Lv${match[1]} / ${match[2]}`;
    match = value.match(/^cartridge:trainer:(\d+)$/u);
    if (match) return `Trainer #${match[1]}`;
    match = value.match(/^cartridge:trainer-levels:(\d+)-(\d+)$/u);
    if (match) return match[1] === match[2]
      ? `Trainer team Lv${match[1]}` : `Trainer team Lv${match[1]}–${match[2]}`;
    match = value.match(/^cartridge:target-map:(.+)$/u);
    if (match) return `Target ${titleIdentifier(match[1],{map:true})}`;
    return '';
  }

  const constraintExplanations = Object.freeze({
    'minimum-team-anchor-level':'Team level is below the campaign target',
    'trainer-first-training':'Using an undefeated trainer before wild encounters',
    'campaign-objective-order':'This is the next unfinished campaign step',
    'cartridge-map-graph':'Route follows the cartridge map graph',
    'preplanned-current-area-route':'The complete current-area route is collision checked',
    'exact-waypoints-then-reobserve':'The worker will stop at the exact route target',
  });

  function evidenceMatch(references, pattern) {
    for (const reference of references) {
      const match = String(reference || '').match(pattern);
      if (match) return match;
    }
    return null;
  }

  function readableGoal(campaignId, objective) {
    const campaign = titleIdentifier(campaignId || 'awaiting-campaign-state');
    const targetMap = objective?.target?.map
      ? titleIdentifier(objective.target.map,{map:true}) : '';
    return [campaign,targetMap].filter(Boolean).join(' · ');
  }

  function readableNow(recommendation, action, decision, evidenceRefs, transitioning) {
    if (transitioning) return 'Game transition';
    const objective = String(recommendation?.objective || '');
    const levels = evidenceMatch(evidenceRefs,
      /^cartridge:team-anchor-level:(\d+)\/(\d+)$/u);
    if (objective.startsWith('train-battle-member')) {
      return levels ? `Train team · Lv${levels[1]}→${levels[2]}` : 'Train team';
    }
    if (objective === 'leave-safari-encounter') return 'Leave Safari encounter';
    if (objective.startsWith('capture-') || objective.startsWith('pokedex-capture-')) {
      return 'Catch target Pokémon';
    }
    if (recommendation?.kind === 'move-toward') {
      const running = recommendation.travelMode === 'run'
        || recommendation.useRunningShoes === true
        || String(action?.reason || '').includes('running');
      const verb = running ? 'Run' : recommendation.travelMode === 'bicycle'
        ? 'Bike' : recommendation.travelMode === 'surf' ? 'Surf' : 'Move';
      const steps = finite(recommendation.remainingSteps);
      return [recommendation.direction
        ? `${verb} ${String(recommendation.direction).toLowerCase()}` : verb,
      steps === null ? '' : `${steps} ${steps === 1 ? 'tile' : 'tiles'}`]
        .filter(Boolean).join(' · ');
    }
    if (recommendation?.kind === 'choose-battle-command') {
      return titleIdentifier(recommendation.targetCommand || 'battle command');
    }
    return decisionSummary(recommendation,action,decision);
  }

  function readableWhy(constraints, evidenceRefs, campaignId, transitioning) {
    if (transitioning) return 'Waiting for stable state';
    if (constraints.includes('preserve-safari-steps')) return 'Preserve Safari steps';
    const parts = [];
    if (constraints.includes('minimum-team-anchor-level')) parts.push('Team low');
    const trainer = evidenceMatch(evidenceRefs,/^cartridge:trainer:(\d+)$/u);
    const wild = evidenceMatch(evidenceRefs,
      /^cartridge:land-encounters:[^:]+:(\d+)-(\d+)$/u);
    if (trainer) parts.push(`Trainer #${trainer[1]} first`);
    else if (wild) parts.push(`Wild Lv${wild[1]}–${wild[2]}`);
    if (parts.length) return parts.slice(0,2).join(' · ');
    const preparation = evidenceMatch(evidenceRefs,/^campaign:preparation-for:(.+)$/u);
    if (preparation) return `Prepare for ${titleIdentifier(preparation[1])}`;
    if (constraints.includes('campaign-objective-order')) return 'Next campaign step';
    return campaignId ? `Follow ${titleIdentifier(campaignId)} plan` : 'Waiting for policy';
  }

  function decisionPlayTime(value) {
    if (!value || typeof value !== 'object') return '—:—:—';
    const hours = Math.max(0,Math.floor(finite(value.hours) ?? 0));
    const minutes = Math.max(0,Math.floor(finite(value.minutes) ?? 0)) % 60;
    const seconds = Math.max(0,Math.floor(finite(value.seconds) ?? 0)) % 60;
    return `${hours}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }

  function decisionLocation(entry) {
    const map = entry?.map
      ? titleIdentifier(entry.map,{map:true}).replace(/\bRoute(\d+)\b/gu,'Route $1')
      : '';
    const position = entry?.position || {};
    const coordinates = finite(position.x) !== null && finite(position.y) !== null
      ? `@ ${finite(position.x)},${finite(position.y)}` : '';
    return [map,coordinates].filter(Boolean).join(' ') || 'Location unavailable';
  }

  function currentResearchDecisionEntry(emulator, research) {
    const nativeDecision = emulator.spectator?.strategy?.decision;
    const decision = research?.decision || nativeDecision;
    const sequence = finite(decision?.sequence);
    if (sequence === null) return [];
    const spectator = emulator.spectator || {};
    return [{
      id:`${research?.runId || emulator.runId || 'research'}:${sequence}`,
      firstSequence:sequence,lastSequence:sequence,repeats:1,
      mode:emulator.mode || emulator.botPhase || null,
      map:emulator.map || spectator.map?.id || spectator.map?.name || null,
      position:emulator.position || (finite(spectator.map?.x) !== null
        ? {x:spectator.map.x,y:spectator.map.y} : null),
      playTime:spectator.trainer?.playTime || null,
      campaignId:spectator.strategy?.activeStoryGoal || null,
      decision,winner:research.winner || (nativeDecision ? {advisor:nativeDecision.advisor,recommendation:nativeDecision.recommendation} : null),action:research.action || nativeDecision?.action || null,
    }];
  }

  function projectDecisionFeedEntry(entry, fallbackRunId, index) {
    if (!entry || typeof entry !== 'object') return null;
    const decision = entry.decision || {};
    const winner = entry.winner || {};
    const recommendation = winner.recommendation || null;
    const action = entry.action || null;
    const first = finite(entry.firstSequence) ?? finite(decision.sequence);
    const last = finite(entry.lastSequence) ?? finite(decision.sequence) ?? first;
    const repeats = Math.max(1,Math.floor(finite(entry.repeats) ?? 1));
    const campaignId = String(entry.campaignId || '').trim();
    const constraints = Array.isArray(winner.constraints) ? winner.constraints : [];
    const evidenceRefs = Array.isArray(winner.evidenceRefs) ? winner.evidenceRefs : [];
    const transitioning = decision.kind === 'resample'
      && ['transition','unknown'].includes(String(decision.reason || ''));
    const title = transitioning ? 'Game transition'
      : decisionSummary(recommendation,action,decision);
    const sequence = first === null ? '#—' : first === last
      ? `#${Math.floor(first)}` : `#${Math.floor(first)}–${Math.floor(last)}`;
    return {
      id:String(entry.id || `${fallbackRunId || 'decision'}:${first ?? index}`),
      sequence,
      clock:decisionPlayTime(entry.playTime),
      title,
      location:decisionLocation(entry),
      goal:titleIdentifier(campaignId || recommendation?.objective || 'awaiting-campaign-state'),
      reason:readableWhy(constraints,evidenceRefs,campaignId,transitioning),
      advisor:titleIdentifier(winner.advisor || 'central-player'),
      mode:String(entry.mode || entry.phase || 'waiting').toUpperCase(),
      repeats,
      repeatLabel:repeats > 1 ? `×${repeats}` : '',
      confidence:finite(winner.confidence),
    };
  }

  function projectDecisionFeed(emulator = {}) {
    const research = emulator.pokemonResearch || emulator.masterRedResearch || {};
    const source = typeof research.decisionFeed?.schema === 'string'
      && research.decisionFeed.schema.endsWith('/decision-feed/v1')
      && Array.isArray(research.decisionFeed.entries)
      ? research.decisionFeed : null;
    const rawEntries = source?.entries?.length ? source.entries : currentResearchDecisionEntry(emulator,research);
    const entries = rawEntries.slice(-80)
      .map((entry,index) => projectDecisionFeedEntry(entry,source?.runId,index))
      .filter(Boolean);
    const totalDecisions = Math.max(entries.reduce((sum,entry) => sum + entry.repeats,0),
      Math.floor(finite(source?.totalDecisions) ?? 0));
    return {
      schema:source?.schema || 'pokemon-research/decision-feed/v1',
      runId:source?.runId || emulator.runId || null,
      capacity:Math.min(80,Math.max(1,Math.floor(finite(source?.capacity) ?? 80))),
      totalDecisions,
      droppedEntries:Math.max(0,Math.floor(finite(source?.droppedEntries) ?? 0)),
      newestId:entries.at(-1)?.id || null,
      entries,
    };
  }

  function shouldFollowDecisionFeed(metrics = {}, threshold = 24) {
    const scrollHeight = Math.max(0,finite(metrics.scrollHeight) ?? 0);
    const scrollTop = Math.max(0,finite(metrics.scrollTop) ?? 0);
    const clientHeight = Math.max(0,finite(metrics.clientHeight) ?? 0);
    const tolerance = Math.max(0,finite(threshold) ?? 24);
    return scrollHeight <= clientHeight
      || scrollHeight - scrollTop - clientHeight <= tolerance;
  }

  function createActivityPresenter({minimumDwellMs = 3000} = {}) {
    const dwell = Math.max(0,finite(minimumDwellMs) ?? 3000);
    let visible = null;
    let queued = null;
    let visibleAt = null;
    const signature = (activity) => JSON.stringify(activity?.readable || null);
    return (activity, now = Date.now()) => {
      if (!activity || typeof activity !== 'object') return visible;
      const timestamp = finite(now) ?? Date.now();
      if (!activity.readable?.transient) queued = activity;
      if (!visible) {
        visible = queued || activity;
        visibleAt = timestamp;
        return visible;
      }
      const campaignChanged = activity.campaignId
        && activity.campaignId !== visible.campaignId;
      if (campaignChanged || (visible.readable?.transient && queued)) {
        visible = queued || activity;
        visibleAt = timestamp;
        return visible;
      }
      const candidate = queued || activity;
      if (timestamp - visibleAt >= dwell && signature(candidate) !== signature(visible)) {
        visible = candidate;
        visibleAt = timestamp;
      }
      return visible;
    };
  }

  function projectResearchActivity(emulator, spectator) {
    const suite=emulator.pokemonSuite, bot=suite?.bot;
    if(bot && (bot.activity==='ready' || bot.activity==='evolution' || !bot.enabled || bot.status==='waiting' || bot.preparation?.kind==='evolution'&&bot.preparation.phase!=='complete')){
      const prep=bot.preparation,training=prep?.kind==='evolution'&&prep.phase!=='complete';
      const trainingMon=(spectator.party||[]).find(p=>(bot.objective?.coreSpecies||[]).includes(p.speciesId))||(spectator.party||[])[0];
      const goal=training?`Evolve ${trainingMon?.speciesName||'the requested Pokémon'}`:bot.activity==='evolution'?'Complete the paired evolution':bot.activity==='ready'?'Ready for commands':titleIdentifier(bot.objective?.id || 'Current task');
      const progress=suite.localEvolution?.progress;
      const beauty=Number.isInteger(progress?.beauty)?`Feebas: ${String(progress.stage || 'preparing').replaceAll('-',' ')} · Beauty ${progress.beauty}/170 · Sheen ${progress.sheen}/255 · ${progress.blocksBlended || 0} blended, ${progress.blocksFed || 0} fed.`:null;
      const reason=!bot.enabled?'Bot is off. The current game is saved.':bot.reason==='unexpected-hunt-battle-menu'?'Paused at an unexpected battle prompt':bot.reason ? titleIdentifier(bot.reason) : beauty || (training&&prep.progress?.required ? `Training from Lv${prep.progress.level} to Lv${prep.progress.required}`:bot.activity==='ready'?'Waiting for your next command.':titleIdentifier(bot.status));
      return {campaign:goal,campaignId:bot.activity,target:'Current game',decision:reason,decisionId:bot.status,why:reason,detail:reason,readable:{goal,now:reason,why:reason,transient:false}};
    }
    const mission=suite?.mission;
    if(suite?.state==='running' && bot?.enabled && bot.activity==='task'
      && mission?.state==='running'
      && ['planning-rng','planning-capture','timing-shiny'].includes(mission.phase)){
      const rng=mission.rng || {};
      const goal=spectator.strategy?.campaign?.activeObjective?.id
        || spectator.strategy?.activeStoryGoal || 'Find the requested Pokémon';
      const checking=['qualifying','observed'].includes(rng.phase);
      const encounter=/^shiny\s/i.test(goal)?'shiny encounter':'encounter';
      let now=mission.phase==='planning-capture'?'Verifying capture timing'
        :mission.phase==='timing-shiny'?'Applying verified encounter timing'
        :checking?`Verifying ${encounter} timing`:`Calculating ${encounter} timing`;
      if(mission.phase==='timing-shiny' && finite(rng.completed)!==null && finite(rng.total)>0){
        now+=` · ${Math.min(100,Math.max(0,Math.floor(rng.completed/rng.total*100)))}%`;
      }
      const why=mission.phase==='planning-capture'
        ?'Checking a catch sequence while keeping the shiny encounter safe.'
        :mission.phase==='timing-shiny'
        ?'The bot is applying the timing that passed encounter verification.'
        :'Checking that the encounter timing works before advancing the game.';
      const method={'current-state':'Current game timing','teachy-tv':'Teachy TV timing',
        'seed-search':'Start-screen timing','title-seed':'Start-screen timing'}[rng.method];
      return {campaign:goal,campaignId:mission.id,target:titleIdentifier(mission.route,{map:true}),
        decision:now,decisionId:`${mission.id}:${mission.phase}:${rng.phase || ''}`,why,
        detail:[method,now].filter(Boolean).join(' · '),readable:{goal,now,why,transient:false}};
    }
    const research = emulator.pokemonResearch || emulator.masterRedResearch;
    if (!research || typeof research !== 'object') return null;
    const strategy = spectator.strategy || {};
    const objective = strategy.campaign?.activeObjective || null;
    const campaignId = String(objective?.id || strategy.activeStoryGoal || '').trim();
    const winner = research.winner || {};
    const projectedDecision = strategy.decision || {};
    const recommendation = winner.recommendation || projectedDecision.recommendation || null;
    const action = research.action || projectedDecision.action || null;
    const decision = research.decision || projectedDecision;
    const evidenceRefs = winner.evidenceRefs || projectedDecision.evidenceRefs || [];
    const constraintIds = winner.constraints || projectedDecision.constraints || [];
    const evidence = evidenceRefs
      .map(evidenceExplanation).filter(Boolean);
    const constraints = constraintIds
      .map((value) => constraintExplanations[value] || '').filter(Boolean);
    const transitioning = decision?.kind === 'resample'
      && ['transition','unknown'].includes(String(decision?.reason || ''));
    const why = transitioning
      ? 'Cartridge state is transitioning; controls stay neutral until it is stable.'
      : [...evidence,...constraints].slice(0,3).join(' · ')
        || 'Waiting for the policy to publish causal evidence.';
    const confidence = finite(winner.confidence ?? projectedDecision.confidence);
    const advisor = winner.advisor || projectedDecision.advisor;
    const sequence = finite(decision?.sequence);
    const detail = [
      titleIdentifier(advisor || 'central-player'),
      confidence === null ? '' : `${Math.round(confidence * 100)}% confidence`,
      !advisor && sequence !== null ? `Decision #${Math.floor(sequence)}` : '',
      decision?.reason ? sentenceIdentifier(decision.reason) : '',
    ].filter(Boolean).join(' · ');
    return {
      campaign:titleIdentifier(campaignId || 'awaiting-campaign-state'),
      campaignId:campaignId || 'awaiting-campaign-state',
      target:campaignTarget(objective?.target),
      decision:decisionSummary(recommendation,action,decision),
      decisionId:String(recommendation?.objective || recommendation?.kind
        || action?.reason || decision?.reason || 'awaiting-policy-decision'),
      why,
      detail:detail || 'Central Player · Awaiting policy decision',
      readable:{
        goal:readableGoal(campaignId,objective),
        now:readableNow(recommendation,action,decision,evidenceRefs,transitioning),
        why:readableWhy(constraintIds,evidenceRefs,campaignId,transitioning),
        transient:transitioning,
      },
    };
  }

  function projectProgressDeck(emulator = {}, previous = null, now = Date.now()) {
    const suite = emulator.pokemonSuite;
    const spectator = emulator.spectator || {};
    const trainer = spectator.trainer || {};
    const current = emulator.debug?.current || {};
    const research = emulator.pokemonResearch || emulator.masterRedResearch || {};
    const game = emulator.game || research.game || {};
    const region = String(game.region || spectator.map?.region || 'Kanto');
    const fireRed = !game.id || game.id === 'pokemon-firered';
    const progress = {...(current.progress || {}),...(spectator.progress || {})};
    const number = (value) => Math.max(0,Math.floor(finite(value) ?? 0));
    const format = (value) => number(value).toLocaleString('en-US');
    const freshParty = Array.isArray(spectator.party) ? spectator.party : [];
    const team = freshParty.slice(0,6).map((mon,index) => {
      const name = String(mon.speciesName || mon.name || 'Unknown');
      const hp = number(mon.hp);
      const maxHp = number(mon.maxHp);
      const ratio = maxHp ? Math.max(0,Math.min(1,hp / maxHp)) : 0;
      const experienceRatio = Math.max(0,Math.min(1,finite(mon.experience?.ratio) ?? (number(mon.level)>=100?1:0)));
      return {position:Number.isInteger(mon.slot)?mon.slot+1:index+1,heldItem:finite(mon.heldItem),experienceKnown:finite(mon.experience?.ratio)!==null||number(mon.level)>=100,lead:Boolean(mon.lead),shiny:Boolean(mon.shiny),name,level:number(mon.level),hp:`${hp} / ${maxHp}`,
        hpPercent:Math.round(ratio * 100),status:String(mon.status || 'OK'),
        experience:mon.experience ? `${format(mon.experience.remaining)} XP`
          : number(mon.level) >= 100 ? 'MAX LEVEL' : 'EXP —',
        experiencePercent:Math.round(experienceRatio * 100),
        sprite:`./api/rom-art/${encodeURIComponent(String(game.id || 'pokemon-firered').replace(/^pokemon-/,''))}/pokemon/${spriteSlug(name)}.png${mon.shiny?'?shiny=1':''}`};
    });
    const hasPlayTime = trainer.playTime && typeof trainer.playTime === 'object';
    const playTime = hasPlayTime ? trainer.playTime : {};
    const gameId=game.id || 'pokemon-firered';
    const stableTeam = team.length ? team : previous?.gameId===gameId && Array.isArray(previous?.team) ? previous.team : [];
    const researchProfile = research.runProfile || {};
    const researchActivity = projectResearchActivity(emulator,spectator);
    const trainerName = String(
      trainer.name || emulator.masterRedV3?.playerName || researchProfile.playerName
        || (fireRed ? 'RED' : 'TRAINER'),
    );
    const trainerGender = ['GIRL','FEMALE','1'].includes(String(
      trainer.gender || emulator.masterRedV3?.gender || researchProfile.gender || '',
    ).toUpperCase())
      ? 'GIRL' : 'BOY';
    const femaleTrainer = trainerGender === 'GIRL';
    return {
      gameId,region,
      trainerCard:{name:trainerName,
        id:trainer.id === null || trainer.id === undefined || trainer.id === ''
          ? '—' : String(trainer.id).padStart(5,'0').slice(-5),
        money:finite(trainer.money)===null?'—':`₽${format(trainer.money)}`,
        playTime:hasPlayTime
          ? `${format(playTime.hours)}:${String(number(playTime.minutes)).padStart(2,'0')}` : '—',
        pokedex:trainer.pokedex?`${format(trainer.pokedex.owned)} caught / ${format(trainer.pokedex.seen)} seen`:'—',
        location:[spectator.map?.name,spectator.map?.region || region].filter(Boolean).join(' · ')
          || region,
        goal:String(suite?.localEvolution && suite.localEvolution.phase!=='complete' ? 'Paired evolution' : current.goal || spectator.strategy?.activeStoryGoal || 'Awaiting campaign state'),
        ...(researchActivity ? {activity:researchActivity} : {}),
        gender:trainerGender,
        portrait:`./api/rom-art/${encodeURIComponent(gameId.replace(/^pokemon-/,''))}/trainer/${femaleTrainer?'female':'male'}.png`,
        portraitAlt:`${trainerName} ${femaleTrainer ? 'female' : 'male'} trainer sprite`},
      team:stableTeam,
      badges:(Array.isArray(spectator.badges) ? spectator.badges : []).slice(0,8)
        .map((badge,index) => ({id:String(badge.id || '').toLowerCase(),
          label:String(badge.label || badge.id || 'Badge'),
          earned:Boolean(badge.earned),offset:index})),
      stats:[
        {label:'POKÉDEX',value:finite(progress.species)===null?'—':`${format(progress.species)} / ${format(progress.targetSpecies
          || game.pokedexSize || (gameId==='pokemon-crystal'?251:151))}`},
        {label:emulator.pokemonSuite?'LEAGUE':`${region.toUpperCase()} MAPS`,value:emulator.pokemonSuite ? ((progress.leagueComplete??emulator.pokemonSuite.gameProgress?.leagueComplete)===true?'Complete':(progress.leagueComplete??emulator.pokemonSuite.gameProgress?.leagueComplete)===false?'In progress':'—') : finite(progress.maps)===null?'—':`${format(progress.maps)} / ${format(progress.targetMaps || (fireRed ? 389 : 0))}`},
        {label:'BADGES',value:Array.isArray(spectator.badges)?`${spectator.badges.filter(b=>b.earned).length} / 8`:'—'},
        ...(finite(progress.trades)!==null ? [{label:'TRADES',value:format(progress.trades)}] : finite(progress.objectives)!==null ? [{label:'OBJECTIVES',value:progress.targetObjectives ? `${format(progress.objectives)} / ${format(progress.targetObjectives)}` : format(progress.objectives)}] : []),
        {label:'BATTLES',description:'Total battles entered in this cartridge save',value:finite(progress.battles)===null?'—':format(progress.battles)},
        {label:'CAPTURES',description:'Total successful captures recorded by this cartridge',value:finite(progress.captures)===null?'—':format(progress.captures)},
      ],
    };
  }

  globalThis.SuiteLivePanel = Object.freeze({
    createActivityPresenter,isDecisionChannel,projectBotTelemetry,projectDecisionFeed,
    projectProgressDeck,projectTelemetry,shouldFollowDecisionFeed,
  });
})();
