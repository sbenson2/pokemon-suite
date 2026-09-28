"""L1.1 stop triage: why the bot stopped, and a supported next step when code proves it safe.

Outside the regression gate's gameplay path. This module only reads the owner's published
status and its retained files (recovery-report.json, recovery.json, the active hunt
checkpoint, partner-availability.json). It never writes game data and never sends a command.
A suggested action runs only when the owner taps it: the client posts the existing
player-tasks action with the suggestion's token and confirm() re-derives the same safe
suggestion from fresh state first.

Deterministic rules decide everything. Laya (optional, shadow only) is consulted in the
background once per stop (game, session, reason; not per frame) and logged next to the rules'
answer; it never changes a result and the endpoint never waits for it.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import threading
import time

SCHEMA = 'pokemon-suite/stop-triage/v1'
FACTS_SCHEMA = 'pokemon-suite/stop-facts/v1'
BUCKETS = ('transient-retry', 'known-bug-family', 'needs-code-fix', 'needs-owner')
ACTIONS = ('resume', 'postgame-checklist', 'retry-hunt', 'archive-hunt', 'none')
# Three-way cause used to score stops whose family is not registered.
CAUSE = {'transient-retry': 'transient', 'known-bug-family': 'code-bug', 'needs-code-fix': 'code-bug', 'needs-owner': 'owner'}
# The only one-tap actions, and the existing player-tasks action each one posts.
PLAYER_TASK = {'resume': 'resume', 'postgame-checklist': 'postgame'}
STOP_STATES = {'blocked', 'recovering', 'failed', 'stopped-for-review'}
BUCKET_LABELS = {'transient-retry': 'Temporary — the bot retries on its own',
                 'known-bug-family': 'Known bug',
                 'needs-code-fix': 'Needs a code fix',
                 'needs-owner': 'Needs you'}

# Registered bug families: diagnosed live stops with a shipped fix and its native regression case.
FAMILIES = {
    'party-menu-move-prompt': {
        'title': 'Unrecognised prompt in the party menu', 'fixedIn': 108, 'case': 'postgame-rare-candy-move-learn',
        'explain': 'The game is showing a prompt in the party menu that this engine does not recognise (on Sept 24 it was '
                   'the move-learning question "Stop trying to teach …?" after a Rare Candy). The bot waits for the screen '
                   'to change, so every resume returns to the same prompt until the 120-second recovery deadline stops it.'},
    'mt-ember-ruby-path': {
        'title': 'No route into Mt. Ember’s Ruby Path', 'fixedIn': 105, 'case': 'postgame-national-ember-hunt',
        'explain': 'A Pokédex hunt targets Mt. Ember’s Ruby Path. The route planner had no entrance for it, so the bot '
                   'circles One Island Harbor until navigation recovery gives up; the checklist then defers the hunt '
                   'and continues with other objectives.'},
    'league-menu-settle': {
        'title': 'League battle menu ignored early presses', 'fixedIn': 99, 'case': 'postgame-league-menu-settle',
        'explain': 'In a League battle the game ignores directional input for about 12 frames after a menu reopens. '
                   'Menu recovery counted those ignored presses as failed moves and stopped.'},
    'cycling-road-pull': {
        'title': 'Cycling Road slope pulled the bot off its task', 'fixedIn': 95, 'case': None,
        'explain': 'On the Cycling Road the downhill pull carried the character away from the training spot, so the '
                   'owned task never reached a safe boundary before its 120-second recovery deadline.'},
    'victory-road-first-floor': {
        'title': 'No northbound route through Victory Road 1F', 'fixedIn': 92, 'case': None,
        'explain': 'Travelling north through Victory Road, the planner had no route through the first-floor boulder '
                   'gate, so navigation had no executable action.'},
    'released-hunt-holds-checklist': {
        'title': 'A released hunt kept the checklist paused', 'fixedIn': 102, 'case': 'postgame-released-hunt-resume',
        'explain': 'The postgame checklist had already released a failed, unprotected hunt and deferred its objective, '
                   'but the hunt’s old stop still held the checklist after a pause (such as a trade exchange).'},
    'evolution-step-source-lookup': {
        'title': 'Held-item evolution route stopped at its first step', 'fixedIn': 103, 'case': 'postgame-held-item-partner',
        'explain': 'An evolution route that starts by equipping an item looked for its source Pokémon with no species, '
                   'so it stopped at the first step before anything was changed.'},
    'league-intermission-save': {
        'title': 'League intermission counted a second save', 'fixedIn': 106, 'case': 'postgame-league-exp-share',
        'explain': 'Between League battles a menu opened after the verified save made the intermission look unsaved, '
                   'so the bot saved again and the save-counter check stopped it.'},
}
GENERIC = {
    'navigation-cycle': 'Route kept repeating', 'no-executable-route': 'No usable route',
    'menu-transaction': 'A menu kept repeating', 'menu-prompt-deadline': 'Unrecognised menu or prompt',
    'transition-deadline': 'A transition did not finish', 'no-progress': 'No progress',
    'unexpected-menu': 'Unexpected battle menu', 'evolution-step-stop': 'Evolution step stopped',
    'supply-budget': 'Supplies exceed the spending limit', 'league-supplies': 'Not enough League supplies',
    'trade-outcome-unresolved': 'Trade result not verified', 'wireless-overflow': 'Wireless link overflowed',
    'partner-trade-wait': 'Waiting for the trade partner', 'hunt-budget': 'Hunt limit reached',
    'capture-supplies': 'Out of Poké Balls', 'protected-encounter': 'Protected encounter needs review',
    'static-timing': 'Encounter timing not calibrated', 'unclassified': 'Stop not recognised',
    'pc-release': 'PC release stopped for review', 'pc-space': 'The PC is full',
}

# Plain-language explanations of the generic families (the raw stop reason stays in the evidence).
GENERIC_EXPLAIN = {
    'navigation-cycle': 'The bot kept walking the same route without getting closer to its target.',
    'no-executable-route': 'The route planner found no usable path to the destination.',
    'menu-transaction': 'The bot kept repeating the same menu steps without the game accepting them.',
    'menu-prompt-deadline': 'A menu or prompt the bot does not recognise stayed on screen until the recovery deadline stopped it.',
    'transition-deadline': 'A screen transition or interaction did not finish before the 120-second recovery deadline.',
    'no-progress': 'The task made no measurable progress for several minutes.',
    'unexpected-menu': 'The bot found a battle menu it could not safely handle during a hunt.',
    'evolution-step-stop': 'An evolution step could not be verified, so the bot stopped before changing anything else.',
    'supply-budget': 'The planned supplies cost more than the spending limit or cash reserve allows.',
    'league-supplies': 'The team cannot be fully restored between League battles with the items in the Bag.',
    'trade-outcome-unresolved': 'A trade’s result could not be verified, so both saves were kept for review.',
    'wireless-overflow': 'The emulated wireless link dropped packets during a trade.',
    'partner-trade-wait': 'The evolution needs a partner game to complete a trade.',
    'hunt-budget': 'The hunt reached its encounter or time limit.',
    'capture-supplies': 'The hunt ran out of Poké Balls.',
    'protected-encounter': 'A protected (shiny or requested) encounter could not be verified, so the bot stopped to keep it safe.',
    'static-timing': 'The timing for a one-time encounter could not be calibrated.',
    'unclassified': 'The bot stopped for a reason no rule recognises.',
    'pc-release': 'While releasing Egg-sticker hatchlings to free PC space, the game did not show exactly the expected '
                  'change, so the bot stopped before releasing anything else. Only non-shiny, unreserved Egg-sticker '
                  'hatchlings are ever released; the save is kept for review.',
    'pc-space': 'The PC is full down to the 30 spaces kept for unexpected shinies and transfers, and no Egg-sticker '
                'hatchling can be released safely. Free some PC space to let new catches continue.',
}
BUCKET_SENTENCE = {'transient-retry': 'It is temporary: the bot retries on its own.',
                   'needs-owner': 'It needs your decision before the bot continues.',
                   'needs-code-fix': 'No known fix matches; the report and save are preserved for review.'}

DEADLINE = 'could not finish the transition within its 120-second active deadline'
STEP0 = 'The source Pokémon is missing, duplicated, or evolved outside the expected step.'
EXHAUSTED = 'Current task list is exhausted'
MENU_MODES = {'party', 'bag', 'start-menu', 'storage', 'summary', 'mart', 'pc'}
CYCLING_MAPS = {'MAP_ROUTE16', 'MAP_ROUTE17', 'MAP_ROUTE18'}
MAX_FILE = 16 * 1024 * 1024
_ID = re.compile(r'^[A-Za-z0-9_-]{1,100}$')


# ---------------------------------------------------------------------------- facts

def _d(value):
    return value if isinstance(value, dict) else {}


def _l(value):
    return value if isinstance(value, list) else []


def _t(value, limit=400):
    return value[:limit] if isinstance(value, str) and value else None


def _i(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def engine_build(version):
    match = re.search(r'build\.(\d+)', version or '') if isinstance(version, str) else None
    return int(match.group(1)) if match else None


def _objective_map(objective):
    match = re.search(r'"map":"(MAP_[A-Z0-9_]+)"', objective or '') if isinstance(objective, str) else None
    return match.group(1) if match else None


def _recovery(value):
    r = _d(value)
    if not r:
        return None
    cycle = _d(r.get('cycle'))
    return {'action': _t(r.get('action')), 'reason': _t(r.get('reason')), 'status': _t(r.get('status')),
            'attempt': _i(r.get('attempt')), 'huntId': _t(r.get('huntId')), 'detail': _t(r.get('detail')), 'startedFrame': _i(r.get('startedFrame')),
            'cycleType': _t(cycle.get('type')), 'cycleObjectiveMap': _objective_map(cycle.get('objective')),
            'cyclePattern': [p for p in _l(cycle.get('pattern')) if isinstance(p, str)][:6]}


def _mission(value, objective=None):
    m = _d(value)
    if not m:
        return None
    route = m.get('route')
    status = _t(m.get('status')) or _t(m.get('state'))
    return {'id': _t(m.get('id')), 'status': status, 'phase': _t(m.get('phase')), 'protected': m.get('protected') is True,
            'postgameObjective': _t(m.get('postgameObjective')) or objective, 'reason': _t(m.get('reason')),
            'method': _t(m.get('method')),
            'routeMap': _t(route) if isinstance(route, str) else _t(_d(route).get('map')),
            'watchObjectiveMap': _objective_map(_d(m.get('navigationWatch')).get('objective'))}


def _agenda(value):
    a = _d(value)
    if not a:
        return {}
    failures = {k: {'reason': _t(_d(v).get('reason')), 'attempts': _i(_d(v).get('attempts')),
                    'requiresStateChange': _d(v).get('requiresStateChange') is True}
                for k, v in _d(a.get('failures')).items() if isinstance(k, str)}
    return {'agendaEnabled': a.get('enabled') is True if 'enabled' in a else None, 'agendaActive': _t(a.get('active')),
            'failures': failures, 'heldHunts': sorted(k for k in _d(a.get('hunts')) if isinstance(k, str))}


def _evolution(controller):
    for kind in ('dexEvolution', 'evolution'):
        e = _d(controller.get(kind))
        if not e:
            continue
        steps = _l(e.get('steps'))
        index = _i(e.get('index'))
        step = _d(steps[index]) if index is not None and 0 <= index < len(steps) else {}
        return {'kind': kind, 'requestId': _t(e.get('requestId')), 'index': index, 'phase': _t(e.get('phase')),
                'reason': _t(e.get('reason')), 'receipts': len(_l(e.get('receipts'))),
                'currentFingerprint': bool(e.get('currentFingerprint')), 'baseline': e.get('baseline') is not None,
                'dirty': e.get('dirty') is True, 'expShareUsed': e.get('expShareUsed') is True,
                'stepKind': _t(step.get('kind'))}
    return None


def _controller(value):
    """The postgame controller state (recovery report or retained checkpoint)."""
    pg = _d(value)
    if not pg:
        return {}
    capture = _d(_d(_d(pg.get('player')).get('encounterSafety')).get('capture'))
    return {'status': _t(pg.get('status')), 'reason': _t(pg.get('reason')),
            'healthStatus': _t(_d(pg.get('health')).get('status')), 'watchdogReason': _t(_d(pg.get('watchdog')).get('reason')),
            'playerTaskPhase': _t(_d(pg.get('playerTask')).get('phase')),
            'qmmDirty': _d(pg.get('qmm')).get('dirty') is True, 'acquisitionDirty': _d(pg.get('acquisition')).get('dirty') is True,
            'savePending': pg.get('save') is not None,
            'captureUnsaved': bool(capture) and capture.get('nativeSaveVerified') is not True,
            'evolution': _evolution(pg), **_agenda(pg.get('agenda'))}


def _trade(value):
    t = _d(value)
    if not t:
        return None
    phase = _t(t.get('phase'))
    completion = _d(t.get('completion'))
    finished = phase == 'complete' and (not completion or (completion.get('nativeSaveVerified') is True and completion.get('handshakeVerified') is True))
    return {'phase': phase, 'exchangeStarted': t.get('exchangeStarted') is True, 'reason': _t(t.get('reason')), 'finished': finished}


def _decisions(feed):
    rows = []
    for entry in _l(_d(feed).get('entries'))[-8:]:
        e = _d(entry)
        decision = _d(e.get('decision'))
        rows.append({'kind': _t(decision.get('kind')), 'reason': _t(decision.get('reason'), 200), 'mode': _t(e.get('mode')),
                     'map': _t(e.get('map')), 'repeats': _i(e.get('repeats')) or 1})
    return rows


def stop_facts(live=None, report=None, recovery=None, checkpoint=None, partners=None, build=None):
    """Normalise what is known about a stop. Live status first; retained files only when they belong to it."""
    live, report, recovery, checkpoint = _d(live), _d(report), _d(recovery), _d(checkpoint)
    bot = _d(live.get('bot')) if live else {}
    meta = _d(checkpoint.get('metadata'))
    session = _d(meta.get('session'))
    source = 'live' if live else 'report' if report else 'none'
    frame = _i(live.get('frame')) if live else _i(report.get('frame'))
    # A retained file describes this stop only if it was written for this session and frame.
    report_state = 'absent' if not report else ('current' if not live or (report.get('sessionId') == live.get('sessionId')
                                                                          and _i(report.get('frame')) == frame) else 'stale')
    run_id = live.get('runId') if live else None
    checkpoint_state = 'absent' if not checkpoint else ('current' if live and _i(meta.get('frame')) == frame
                                                        and session.get('id') == run_id else 'stale')
    controller = {}
    if report_state == 'current':
        controller = _controller(report.get('postgame'))
    if checkpoint_state == 'current':
        controller = {**controller, **{k: v for k, v in _controller(session.get('postgame')).items() if v not in (None, {}, [])}}
    screen_map = _t(live.get('map')) if live else _t(_d(report.get('map')).get('id')) if isinstance(report.get('map'), dict) else _t(report.get('map'))
    position = _d(live.get('position')) if live else _d(report.get('map'))
    mission_source = live.get('mission') if live else report.get('mission')
    objective = (_d(session.get('mission')).get('postgameObjective') if checkpoint_state == 'current' else None) \
        or (_d(report.get('mission')).get('postgameObjective') if report_state == 'current' else None)
    mission = _mission(mission_source, objective)
    if mission and not mission['postgameObjective'] and (mission['id'] or '').startswith('postgame-national-collection-'):
        mission['postgameObjective'] = 'national-collection'
    agenda = _agenda(live.get('postgame')) if live and isinstance(_d(live.get('postgame')).get('failures'), dict) else {}
    for key in ('agendaEnabled', 'agendaActive', 'failures', 'heldHunts'):
        if key in agenda:
            controller[key] = agenda[key]
    history = [{'reason': _t(h.get('reason')), 'status': _t(h.get('status')), 'attempt': _i(h.get('attempt')), 'huntId': _t(h.get('huntId'))}
               for h in (_d(x) for x in _l(recovery.get('history'))[-6:])]
    package = next((p for p in _l(_d(_d(live.get('runtime')).get('lock')).get('packages')) if _d(p).get('kind') in (None, 'engine')), {}) if live else {}
    control = _d(live.get('control'))
    partner_list = [p.get('owner') for p in _l(_d(partners).get('partners')) if isinstance(_d(p).get('owner'), str)] if partners else None
    preparation = _d(bot.get('preparation'))
    return {
        'schema': FACTS_SCHEMA, 'game': _t(live.get('game')) or _t(report.get('game')), 'source': source,
        'sessionId': _t(live.get('sessionId')) or _t(report.get('sessionId')), 'frame': frame,
        'state': _t(live.get('state')),
        'engineBuild': engine_build(_d(package).get('version')) if live else build,
        'reason': None if live else _t(report.get('reason')),
        'bot': {'status': _t(bot.get('status')), 'reason': _t(bot.get('reason')), 'enabled': bot.get('enabled') is True,
                'awaitingCommand': bot.get('awaitingCommand') is True, 'runScope': _t(bot.get('runScope')), 'activity': _t(bot.get('activity')),
                'progressStatus': _t(_d(bot.get('progress')).get('status')),
                'preparation': {'kind': _t(preparation.get('kind')), 'phase': _t(preparation.get('phase')),
                                'requestId': _t(preparation.get('requestId')), 'reason': _t(preparation.get('reason')),
                                'automatic': preparation.get('automatic') is True}},
        'screen': {'mode': _t(live.get('mode')), 'callback2': _t(live.get('callback2')), 'map': screen_map,
                   'x': _i(position.get('x')), 'y': _i(position.get('y'))},
        'decision': {'kind': _t(_d(live.get('decision')).get('kind')), 'reason': _t(_d(live.get('decision')).get('reason'))},
        'decisions': _decisions(live.get('decisionFeed')),
        'mission': mission,
        'recovery': _recovery(live.get('recovery') if live else report.get('recovery')) or _recovery(recovery.get('current')),
        'recoveryHistory': history,
        'postgame': controller,
        'localEvolution': ({'phase': _t(_d(live.get('localEvolution')).get('phase')), 'reason': _t(_d(live.get('localEvolution')).get('reason'))}
                           if _d(live.get('localEvolution')) else None),
        'nativeTrade': _trade(live.get('nativeTrade')),
        'control': {'mode': _t(control.get('mode')), 'paused': control.get('paused') is True},
        'commandError': _t(live.get('commandError')) or _t(_d(live.get('commandError')).get('message')),
        'partners': partner_list,
        'evidence': {'report': report_state, 'checkpoint': checkpoint_state},
    }


# ---------------------------------------------------------------------------- rules

def _norm(reason):
    """'Automatic resume-mission: X' -> X; the phase is read separately."""
    if not isinstance(reason, str):
        return None
    match = re.match(r'^Automatic [a-z-]+: (.+)$', reason)
    return match.group(1) if match else reason


def _recovery_current(f):
    r, m = f.get('recovery') or {}, f.get('mission') or {}
    return bool(r.get('huntId')) and r.get('huntId') == m.get('id')


def _reasons(f):
    """The stop's reasons, the owner's own first. The first rule pass sees only the owner's own reasons, so a
    retained hunt or recovery record never outranks what actually stopped the owner."""
    bot, decision, mission, pg = f['bot'], f['decision'], f.get('mission') or {}, f.get('postgame') or {}
    own = [f.get('reason'), bot.get('reason'), decision.get('reason') if decision.get('kind') == 'blocked' else None,
           (f.get('localEvolution') or {}).get('reason'), (f.get('nativeTrade') or {}).get('reason'), f.get('commandError')]
    values = own if f.get('_primary') else own + [
        mission.get('reason') if mission.get('status') in STOP_STATES else None, pg.get('reason'),
        (f.get('recovery') or {}).get('reason') if _recovery_current(f) else None, bot['preparation'].get('reason')]
    seen = []
    for value in values:
        value = _norm(value)
        if value and value not in seen:
            seen.append(value)
    return seen


def _has(f, *needles):
    text = ' | '.join(_reasons(f)).lower()
    return any(n.lower() in text for n in needles)


def _phase(f):
    """recovering: automatic recovery is still retrying; stopped: the owner waits for review."""
    r = f.get('recovery') or {}
    if f['bot']['status'] == 'recovering' or f.get('state') == 'recovering':
        return 'recovering'
    if f['source'] == 'report':
        reason = f.get('reason') or ''
        if reason.startswith('Automatic ') and 'limit reached' not in reason:
            return 'recovering'
        if _recovery_current(f) and r.get('status') in ('failed', 'recovering') and (r.get('attempt') or 0) < 3:
            return 'recovering'
    return 'stopped'


def is_stop(f):
    if f['source'] == 'report':
        return True
    if f['source'] != 'live' or f.get('state') in ('offline', 'closed', 'reconnecting'):
        return False
    # The owner's own status decides; a blocked decision counts only when no bot status is published.
    return f.get('state') in STOP_STATES or f['bot']['status'] in STOP_STATES or (f['bot']['status'] is None and f['decision'].get('kind') == 'blocked')


def _map(f):
    return f['screen'].get('map') or ''


def _menu_screen(f):
    """The screen is a menu: the published mode, or the recent decisions made in one."""
    mode = f['screen'].get('mode')
    if mode in MENU_MODES or (f['screen'].get('callback2') or '').startswith('CB2_UpdatePartyMenu'):
        return mode or 'party'
    recent = [d for d in f.get('decisions') or [] if d.get('mode')]
    menu = [d for d in recent if d['mode'] in MENU_MODES]
    return menu[-1]['mode'] if recent and len(menu) * 2 > len(recent) else None


def _exhausted_decisions(f):
    return sum(d.get('repeats') or 1 for d in f.get('decisions') or [] if d.get('reason') and EXHAUSTED in d['reason'])


def _retained(f, reason):
    """Only an exhausted recovery record of this owner's hunt carries the reason; the owner itself is not stopped by it
    (for example the checklist released the hunt, or an update restarted the owner past the old stop)."""
    r = f.get('recovery') or {}
    own = [f.get('reason'), f['bot'].get('reason'), f['decision'].get('reason') if f['decision'].get('kind') == 'blocked' else None]
    return (f['source'] == 'live' and _recovery_current(f) and r.get('status') == 'needs-review' and r.get('reason') == reason
            and f['bot']['status'] != 'blocked' and not any(reason in (x or '') for x in own))


def _hit(family, bucket, evidence, action='none', **extra):
    return {'family': family, 'bucket': bucket, 'evidence': [e for e in evidence if e], 'action': action, **extra}


def _screen_evidence(f):
    s = f['screen']
    where = s.get('map') and s['map'].replace('MAP_', '').replace('_', ' ').title()
    if not s.get('mode'):
        return f'Location: {where}' if where else None
    return f"Screen: {s['mode']}{' (' + s['callback2'] + ')' if s.get('callback2') else ''}{' at ' + where if where else ''}"


def _rule_protected(f):
    m = f.get('mission') or {}
    if _has(f, 'protected-encounter-lost-or-unverified') or (m.get('protected') and m.get('status') in STOP_STATES):
        return _hit('protected-encounter', 'needs-owner', ['A protected (shiny or requested) encounter is retained for review.',
                                                          f"Mission: {m.get('phase') or 'unknown phase'}, {m.get('reason') or 'no reason published'}"],
                    note='The bot never discards or resets a protected encounter on its own. Review it in Farming.')


def _rule_trade(f):
    t = f.get('nativeTrade') or {}
    if _has(f, 'final link handshake or normal exit is not verified') or any(w in (t.get('phase') or '') for w in ('unresolved', 'mismatch', 'incomplete', 'unknown')):
        return _hit('trade-outcome-unresolved', 'needs-owner', [f"Trade stage: {t.get('phase') or 'unknown'}", 'Both saves are preserved.'],
                    note='The trade’s result must be checked before anything else runs.')


def _rule_wireless(f):
    if not _has(f, 'wireless queue overflowed'):
        return None
    started = (f.get('nativeTrade') or {}).get('exchangeStarted')
    return _hit('wireless-overflow', 'needs-owner' if started else 'transient-retry',
                ['The emulated wireless adapter dropped packets.', 'The exchange had started.' if started else 'No Pokémon had been exchanged yet.'],
                note='Build 106 paces both games and retries before the exchange; after an exchange starts, the saves are kept for review.')


def _rule_evolution(f):
    evo = (f.get('postgame') or {}).get('evolution') or {}
    if _has(f, STEP0):
        equip = (evo.get('stepKind') or '').startswith('equip') if evo else None
        family = 'evolution-step-source-lookup' if equip is not False else 'evolution-step-stop'
        evidence = [f"Stop: {STEP0}"]
        if evo:
            evidence.append(f"Evolution step {evo.get('index')} ({evo.get('stepKind') or 'unknown kind'}); {evo.get('receipts')} steps completed")
        if f['bot']['preparation'].get('requestId'):
            evidence.append(f"Route: {f['bot']['preparation']['requestId']}")
        return _hit(family, 'known-bug-family' if family in FAMILIES else 'needs-code-fix', evidence, action='postgame-checklist')
    if _has(f, 'Evolution item consumption is not verified', 'evolution native save failed', 'held item required for this trade evolution',
            'native Ninjask and Shedinja pair', 'final native evolution save has not been verified'):
        return _hit('evolution-step-stop', 'needs-code-fix', [f"Stop: {_reasons(f)[0]}"])
    if _has(f, 'cannot trigger a level-up evolution at level 100', 'fixed personality produces the other branch', 'no longer verifies as shiny'):
        return _hit('evolution-step-stop', 'needs-owner', [f"Stop: {_reasons(f)[0]}"], note='This Pokémon cannot finish the planned evolution; choose another source.')


def _rule_deadline(f):
    if not _has(f, DEADLINE, 'Progress timeout: finish the owned transaction'):
        return None
    menu = _menu_screen(f)
    exhausted = _exhausted_decisions(f)
    evidence = [_screen_evidence(f), f'{exhausted} recent decisions: "{EXHAUSTED}"' if exhausted else None, f"Stop: {_reasons(f)[0]}"]
    if menu == 'party' and (f['screen'].get('mode') == 'party' or exhausted):
        return _hit('party-menu-move-prompt', 'known-bug-family', evidence)
    if menu:
        return _hit('menu-prompt-deadline', 'needs-code-fix', evidence)
    if _map(f) in CYCLING_MAPS and f['screen'].get('mode') in (None, 'overworld'):
        return _hit('cycling-road-pull', 'known-bug-family', evidence)
    if _phase(f) == 'recovering':
        return _hit('transition-deadline', 'transient-retry', evidence)
    return _hit('transition-deadline', 'needs-code-fix', evidence)


def _rule_league(f):
    if _has(f, 'league-save-counter-changed-unexpectedly'):
        return _hit('league-intermission-save', 'known-bug-family', [_screen_evidence(f), 'Stop: league-save-counter-changed-unexpectedly'])
    if _has(f, 'league-recovery-supplies-exhausted', 'league-pp-restoration-unavailable'):
        return _hit('league-supplies', 'needs-owner', [_screen_evidence(f), f"Stop: {_reasons(f)[0]}"],
                    note='The team cannot be fully restored between League battles with the items in the Bag.')
    if _has(f, 'repeated-menu-transaction') and _map(f).startswith('MAP_POKEMON_LEAGUE_') and f['screen'].get('mode') in (None, 'battle'):
        return _hit('league-menu-settle', 'known-bug-family', [_screen_evidence(f), 'Stop: repeated-menu-transaction'],
                    retained=_retained(f, 'repeated-menu-transaction'))


def _rule_released(f):
    m, pg, r = f.get('mission') or {}, f.get('postgame') or {}, f.get('recovery') or {}
    objective = m.get('postgameObjective')
    released = (m.get('status') == 'blocked' and not m.get('protected') and objective and pg.get('agendaEnabled') is True
                and objective not in (pg.get('heldHunts') or []) and objective in (pg.get('failures') or {}) and r.get('status') != 'recovering')
    if released and f['bot']['status'] == 'blocked' and _has(f, 'Three recovery attempts failed', 'Automatic recovery attempt limit reached'):
        failure = pg['failures'][objective]
        # Before the fix a resume cannot pass the held checklist, so nothing is suggested but the update.
        fixed = f.get('engineBuild') is not None and f['engineBuild'] >= FAMILIES['released-hunt-holds-checklist']['fixedIn']
        return _hit('released-hunt-holds-checklist', 'known-bug-family',
                    [f"Hunt {m.get('id')} is blocked and unprotected.", f"The checklist deferred '{objective}' after {failure.get('attempts')} attempts ({failure.get('reason')})."],
                    action='resume' if fixed else 'none')


def _rule_navigation(f):
    if not _has(f, 'repeated-navigation-cycle'):
        return None
    r, m = f.get('recovery') or {}, f.get('mission') or {}
    current = _recovery_current(f)
    target = (r.get('cycleObjectiveMap') if current else None) or m.get('watchObjectiveMap') or m.get('routeMap')
    pattern = (r.get('cyclePattern') if current else None) or []
    retained = _retained(f, 'repeated-navigation-cycle')
    evidence = [f"Navigation looped at {', '.join(pattern) or _map(f) or 'an unknown map'}" + (f" while heading for {target}" if target else ''),
                f"Recovery attempt {r.get('attempt')} ({r.get('status')})" if current and r.get('status') else None]
    if (target or '').startswith('MAP_MT_EMBER_RUBY_PATH'):
        return _hit('mt-ember-ruby-path', 'known-bug-family', evidence, retained=retained)
    if _phase(f) == 'recovering' and not retained:
        return _hit('navigation-cycle', 'transient-retry', evidence)
    return _hit('navigation-cycle', 'needs-code-fix', evidence, retained=retained)


def _rule_route(f):
    if not _has(f, 'No executable route'):
        return None
    evidence = [_screen_evidence(f), 'Stop: No executable route to the selected destination.']
    if _map(f) == 'MAP_VICTORY_ROAD_1F':
        return _hit('victory-road-first-floor', 'known-bug-family', evidence)
    return _hit('no-executable-route', 'transient-retry' if _phase(f) == 'recovering' else 'needs-code-fix', evidence)


def _rule_owner(f):
    if _has(f, 'PC release: '):
        return _hit('pc-release', 'needs-code-fix', [_screen_evidence(f), f"Stop: {_reasons(f)[0]}"])
    if _has(f, 'Free PC space while preserving the shiny reserve'):
        return _hit('pc-space', 'needs-owner', [f"Stop: {_reasons(f)[0]}"])
    if _has(f, 'supply basket exceeds the remaining spending limit or cash reserve'):
        return _hit('supply-budget', 'needs-owner', [f"Stop: {_reasons(f)[0]}"],
                    note='Build 106 re-plans a stale basket when nothing was bought; a stop after that means money or the spending limit is really short.')
    if _has(f, 'hunt budget reached'):
        return _hit('hunt-budget', 'needs-owner', [f"Stop: {_reasons(f)[0]}"], action='retry-hunt',
                    note='The remaining encounter is preserved. Retry the hunt from Farming to continue.')
    if _has(f, 'capture-balls-exhausted'):
        return _hit('capture-supplies', 'transient-retry' if _phase(f) == 'recovering' else 'needs-owner', ['The hunt ran out of Poké Balls.'])
    if _has(f, 'A separate compatible game must complete the native trade', 'Waiting for the paired'):
        partners = f.get('partners')
        waiting = f['bot']['status'] in ('trading', 'running', 'recovering') or bool(partners)
        return _hit('partner-trade-wait', 'transient-retry' if waiting or partners is None else 'needs-owner',
                    ['Partners ready: ' + (', '.join(partners) if partners else 'none') if partners is not None else 'Partner availability unknown.'],
                    note='The evolution continues when a partner game completes the trade.')


def _rule_generic(f):
    recovering = _phase(f) == 'recovering'
    if _has(f, 'Static RNG timing could not be calibrated'):
        return _hit('static-timing', 'needs-code-fix', ['The encounter is preserved.'])
    if _has(f, 'unexpected-hunt-battle-menu'):
        return _hit('unexpected-menu', 'transient-retry' if recovering else 'needs-code-fix', [_screen_evidence(f)])
    if _has(f, 'repeated-menu-transaction'):
        return _hit('menu-transaction', 'transient-retry' if recovering else 'needs-code-fix', [_screen_evidence(f), 'Stop: repeated-menu-transaction'])
    if _has(f, 'no-meaningful-progress', 'No progress for five active minutes', 'Progress timeout'):
        return _hit('no-progress', 'transient-retry' if recovering else 'needs-code-fix', [_screen_evidence(f), f"Stop: {_reasons(f)[0]}"])


RULES = (_rule_protected, _rule_trade, _rule_wireless, _rule_evolution, _rule_deadline, _rule_league, _rule_released,
         _rule_navigation, _rule_route, _rule_owner, _rule_generic)


# ---------------------------------------------------------------------------- safety

def _common_unsafe(f):
    """Why no one-tap action may run now (None when the stop is quiet and owned by nobody else)."""
    if f['source'] != 'live' or not f.get('sessionId') or f.get('frame') is None:
        return 'Only a live, retained stop can be acted on.'
    if f.get('game') != 'firered':
        return 'One-tap fixes are implemented for FireRed postgame only.'
    if f.get('state') != 'blocked' or f['bot']['status'] != 'blocked':
        return 'The bot is not stopped; automatic recovery may still be running.'
    if f['control'].get('mode') == 'manual':
        return 'You have manual control of the game.'
    if f.get('commandError'):
        return 'The last command reported an error.'
    if (f.get('localEvolution') or {}).get('phase') not in (None, 'complete'):
        return 'A linked evolution exchange is in progress.'
    if f.get('nativeTrade') and not f['nativeTrade']['finished']:
        return 'A trade is in progress or unverified.'
    m, pg = f.get('mission') or {}, f.get('postgame') or {}
    if m.get('protected') and m.get('status') != 'complete':
        return 'A protected encounter is not saved yet.'
    if pg.get('captureUnsaved') or pg.get('qmmDirty') or pg.get('acquisitionDirty') or pg.get('savePending'):
        return 'The owner holds an unfinished capture, supply or save.'
    return None


def _checklist_owned(f):
    """The postgame checklist owned the stopped work, so restarting the checklist returns it to the same owner."""
    return f['bot'].get('runScope') == 'postgame' and f['bot']['preparation'].get('kind') == 'postgame'


def _checklist_unsafe(f):
    if not _has(f, STEP0):
        return 'Only an evolution that stopped at its first step can be restarted this way.'
    if not _checklist_owned(f):
        return 'This evolution is not the postgame checklist’s own step; restarting the checklist would replace your task.'
    if f['evidence']['checkpoint'] != 'current':
        return 'The retained checkpoint for this stop could not be read, so it is not proven that nothing changed.'
    e = (f.get('postgame') or {}).get('evolution')
    if not e:
        return 'The stopped evolution was not found in the retained checkpoint.'
    if e.get('index') != 0 or e.get('receipts') or e.get('currentFingerprint') or e.get('baseline') or e.get('dirty') or e.get('expShareUsed'):
        return 'The evolution had already started changing a Pokémon or item.'
    return None


def _resume_unsafe(f):
    if f.get('engineBuild') is None or f['engineBuild'] < FAMILIES['released-hunt-holds-checklist']['fixedIn']:
        return 'This engine keeps a released hunt holding the checklist; resuming cannot continue until build 102 is installed.'
    if f['bot'].get('runScope') != 'postgame':
        return 'Only the postgame checklist continues past a released hunt.'
    if _rule_released(f) is None:
        return 'The hunt is no longer a released, unprotected hunt.'
    return None


COPY = {
    'postgame-checklist': ('Restart the postgame checklist',
                           'Restarts the postgame checklist from this save. Nothing was changed at the stopped step, so the '
                           'checklist picks its next objective again. The save and every Pokémon stay as they are.'),
    'resume': ('Resume the bot',
               'Turns the bot back on. The released hunt stays deferred and the postgame checklist continues with its '
               'other objectives. The save stays as it is.'),
}


def _token(f, family, action):
    evo = (f.get('postgame') or {}).get('evolution') or {}
    key = [f.get('game'), f.get('sessionId'), f.get('frame'), _reasons(f)[:1], family, action,
           [evo.get(k) for k in ('requestId', 'index', 'receipts', 'currentFingerprint', 'dirty')]]
    return hashlib.sha256(json.dumps(key, sort_keys=True, default=str).encode()).hexdigest()[:24]


def _suggest(f, hit):
    action = hit.get('action', 'none')
    fixed = FAMILIES.get(hit['family'], {}).get('fixedIn')
    build = f.get('engineBuild')
    if action == 'none':
        why = ('Nothing to do: this is an earlier stop’s record and the bot continues.' if hit.get('retained') else
               'Automatic recovery is still running.' if _phase(f) == 'recovering' else
               f'Install engine build {fixed} or later; its installer restarts the task.' if fixed and (build is None or build < fixed) else
               hit.get('note') or 'No supported action is proven safe for this stop. Its report and save are preserved for review.')
        return {'action': 'none', 'safe': False, 'why': why}
    if action not in PLAYER_TASK:
        return {'action': action, 'safe': False, 'why': hit.get('note') or 'Available from Farming; not offered as a one-tap fix.'}
    unsafe = _common_unsafe(f) or (_checklist_unsafe(f) if action == 'postgame-checklist' else _resume_unsafe(f))
    if unsafe:
        return {'action': action, 'safe': False, 'why': unsafe}
    label, confirm = COPY[action]
    why = ('Nothing was changed at the stopped step (step 0, no Pokémon or item changed, checkpoint verified), so restarting the checklist is safe.'
           if action == 'postgame-checklist' else 'The hunt is released: blocked, unprotected, deferred by the checklist and not held by it.')
    if fixed and build is not None and build < fixed:
        why += f' Until engine build {fixed} is installed the same step may stop again.'
    return {'action': action, 'safe': True, 'why': why, 'label': label, 'confirm': confirm,
            'playerTask': PLAYER_TASK[action], 'token': _token(f, hit['family'], action)}


def classify(f):
    """Deterministic triage of one stop, or None when the owner is not stopped or recovering."""
    if not isinstance(f, dict) or f.get('schema') != FACTS_SCHEMA or not is_stop(f):
        return None
    hit = None
    for primary in (True, False):
        view = {**f, '_primary': True} if primary else f
        hit = next((h for h in (rule(view) for rule in RULES) if h), None)
        if hit:
            break
    if hit is None:
        reason = (_reasons(f) or ['no reason published'])[0]
        hit = _hit('unclassified', 'needs-code-fix', [f'Stop: {reason}'])
    # While the engine's own automatic recovery is running, an unregistered stop is temporary until it gives up.
    if _phase(f) == 'recovering' and hit['family'] not in FAMILIES and not hit.get('retained'):
        hit = {**hit, 'bucket': 'transient-retry'}
    family = FAMILIES.get(hit['family'])
    build = f.get('engineBuild')
    result = {'schema': SCHEMA, 'game': f.get('game'), 'bucket': hit['bucket'], 'family': hit['family'],
              'title': family['title'] if family else GENERIC.get(hit['family'], hit['family'])}
    explanation = family['explain'] if family else None
    if family:
        result['fixedIn'] = family['fixedIn']
        if family.get('case'):
            result['case'] = family['case']
        # A retained record of an earlier stop (released before this engine was installed) is not a new case.
        regression = build is not None and build >= family['fixedIn'] and not hit.get('retained')
        result['regression'] = regression
        if hit.get('retained'):
            explanation += (f' Fixed in engine build {family["fixedIn"]}. This is the retained record of an earlier stop: the '
                            'checklist released that hunt and continues with other objectives.')
        elif regression:
            result['bucket'] = 'needs-code-fix'
            explanation += (f' This engine (build {build}) already includes the build {family["fixedIn"]} fix, so this is a new case '
                            'of the same problem and needs a code fix.')
        else:
            explanation += f' Fixed in engine build {family["fixedIn"]}' + (f'; this game runs build {build}.' if build else '.')
    else:
        explanation = ' '.join(x for x in (GENERIC_EXPLAIN.get(hit['family']), BUCKET_SENTENCE.get(hit['bucket']), hit.get('note')) if x)
    if hit.get('retained'):
        result['retained'] = True
        if not family:
            explanation += ' The checklist released that hunt and continues with other objectives.'
    elif _phase(f) == 'recovering' and result['bucket'] != 'transient-retry':
        explanation += ' Automatic recovery is still retrying, but retries do not fix this.'
    result['explanation'] = explanation
    result['evidence'] = hit['evidence'] + ([f'Engine build {build}'] if build else [])
    result['suggestedAction'] = _suggest(f, hit)
    result['stop'] = {'reason': (_reasons(f) or [None])[0], 'state': f.get('state') or f['bot']['status'], 'phase': _phase(f),
                      'map': f['screen'].get('map'), 'mode': f['screen'].get('mode'), 'frame': f.get('frame')}
    return result


def compact(result):
    """The sessions payload's card: no Laya, no raw stop details."""
    if not result:
        return None
    keep = {k: result[k] for k in ('schema', 'bucket', 'family', 'title', 'explanation', 'fixedIn', 'regression') if k in result}
    return {**keep, 'evidence': result['evidence'][:4], 'suggestedAction': result['suggestedAction']}


# ---------------------------------------------------------------------------- runtime files

_CACHE = {}
_CACHE_LOCK = threading.Lock()


def _read(path, limit=MAX_FILE):
    """A retained JSON object; symbolic links, non-regular files and oversized files are ignored."""
    try:
        with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)), 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                return None
            key = str(path)
            with _CACHE_LOCK:
                cached = _CACHE.get(key)
                if cached and cached[0] == (info.st_mtime_ns, info.st_size):
                    return cached[1]
            value = json.loads(stream.read(limit + 1))
        value = value if isinstance(value, dict) else None
        with _CACHE_LOCK:
            if len(_CACHE) > 32:
                _CACHE.clear()
            _CACHE[key] = ((info.st_mtime_ns, info.st_size), value)
        return value
    except (OSError, ValueError, RecursionError):
        return None


def runtime_facts(directory, game, live):
    folder = Path(directory) / game
    active = _read(folder / 'active-hunt.json', 65536) or {}
    checkpoint = None
    if isinstance(active.get('id'), str) and _ID.match(active['id']) and live and active['id'] == live.get('runId'):
        parts = ('native-radio', 'saves') if active.get('nativeRadio') is True else ('saves',)
        checkpoint = _read(folder / 'hunts' / active['id'] / Path(*parts) / 'current.json')
    return stop_facts(live=live, report=_read(folder / 'recovery-report.json'), recovery=_read(folder / 'recovery.json'),
                      checkpoint=checkpoint, partners=_read(folder / 'partner-availability.json', 65536))


def attach(directory, game, live):
    """Compact triage for the sessions payload when the owner is stopped or recovering; never raises."""
    try:
        if not isinstance(live, dict) or live.get('state') == 'reconnecting' or _d(live.get('connection')).get('state') == 'reconnecting':
            return None
        bot = live.get('bot')
        if not isinstance(bot, dict) or not (live.get('state') in STOP_STATES or bot.get('status') in STOP_STATES):
            return None
        result = classify(runtime_facts(directory, game, live))
        # A running checklist that only carries a released hunt's old record needs no card.
        if result and result.get('retained') and result['stop']['phase'] == 'recovering':
            return None
        # Routine automatic recovery (battles, menu settles) with no recognised cause is not a stop.
        if result and result['family'] == 'unclassified' and result['stop']['phase'] == 'recovering' \
                and live.get('state') not in STOP_STATES - {'recovering'} and bot.get('status') == 'recovering':
            return None
        return compact(result)
    except Exception:  # presentation only: a triage failure must never break the sessions payload
        return None


class TriageChanged(ValueError):
    """The stop changed since the suggestion was shown (HTTP 409)."""


class StopTriage:
    """Endpoint and one-tap confirmation over the live owner; Laya only in shadow."""

    def __init__(self, sessions, classifier=None, log_path=None):
        self.sessions = sessions
        self.directory = Path(sessions.directory)
        self.classifier = classifier
        self.log_path = Path(log_path) if log_path else None
        self._consulted = {}  # stop key -> (Laya's last record, or None when Laya was off; monotonic time of that attempt)
        self._running = set()
        self._lock = threading.Lock()

    def facts(self, game, live=None):
        return runtime_facts(self.directory, game, live if live is not None else self.sessions._live(game))

    def triage(self, game, live=None, consult=False):
        facts = self.facts(game, live)
        result = classify(facts)
        if result is not None and consult:
            self._shadow(facts, result)
        return result

    def shadow_async(self, game, live):
        """Consult Laya in the background once per distinct live stop (sessions polling); never blocks or raises."""
        try:
            bot = _d(_d(live).get('bot'))
            if not (live.get('state') in STOP_STATES or bot.get('status') in STOP_STATES):
                return None
            live = copy.deepcopy(live)
            return self._schedule(_stop_key(stop_facts(live=live)), lambda classifier: self._consult_live(game, live, classifier))
        except Exception:
            return None

    def _consult_live(self, game, live, classifier):
        facts = self.facts(game, live)
        result = classify(facts)
        return self._consult(facts, result, classifier) if result is not None else None

    def confirm(self, game, player_action, token):
        """Re-derive the suggestion from fresh state; refuse unless it is the same safe action."""
        action = (self.triage(game) or {}).get('suggestedAction') or {}
        if not action.get('safe') or action.get('playerTask') != player_action or action.get('token') != token:
            raise TriageChanged('The stop changed since this suggestion was shown. Refresh the bot activity and review it again.')
        return action

    # A stop is consulted once while it lasts; a skipped consult (Laya loading, busy or failing) or Laya off is looked
    # at again only after this many seconds, so sessions polling never queues a consult per frame.
    RETRY_SKIPPED = 60.0

    def _shadow(self, facts, result):
        """The endpoint: attach this stop's last Laya record and consult in the background when due; never waits for Laya."""
        key = _stop_key(facts)
        with self._lock:
            record = (self._consulted.get(key) or (None,))[0]
        if record is not None:
            result['laya'] = _agreement(record, result)
        self._schedule(key, lambda classifier: self._consult(facts, result, classifier))

    def _schedule(self, key, consult):
        """Start one background consult for this stop unless it was answered, is running, or was tried moments ago."""
        now = time.monotonic()
        with self._lock:
            record, at = self._consulted.get(key) or (None, None)
            if key in self._running or (record and 'skipped' not in record) or (at is not None and now - at < self.RETRY_SKIPPED):
                return None
            self._running.add(key)
        try:
            classifier = self.classifier() if callable(self.classifier) else self.classifier
        except Exception:
            classifier = None
        if classifier is None or getattr(classifier, 'mode', 'off') not in ('shadow', 'on'):
            self._settle(key, None)
            return None
        thread = threading.Thread(target=self._run, args=(key, consult, classifier), daemon=True, name='stop-triage-shadow')
        thread.start()
        return thread

    def _run(self, key, consult, classifier):
        record = None
        try:
            record = consult(classifier)
        except Exception:  # a background consult never raises; the stop is looked at again after the cool-down
            pass
        self._settle(key, record)

    def _settle(self, key, record):
        with self._lock:
            self._running.discard(key)
            if len(self._consulted) > 256:
                self._consulted.clear()
            self._consulted[key] = (record, time.monotonic())

    # Laya shadow consult: the choice over buckets and supported actions, recorded and never applied.
    BUCKET_CRITERIA = {'transient-retry': 'temporary: automatic recovery or a simple retry will clear it',
                       'known-bug-family': 'a known bug that a released or pending engine update fixes',
                       'needs-code-fix': 'a new bug: the bot cannot handle this situation and the code must change',
                       'needs-owner': 'the owner must decide or act (supplies, partner game, protected Pokémon, limits)'}
    ACTION_CRITERIA = {'resume': 'turn the bot back on', 'postgame-checklist': 'restart the postgame checklist',
                       'retry-hunt': 'retry the stopped hunt', 'archive-hunt': 'archive the stopped hunt',
                       'none': 'do nothing now; review or update first'}

    def _consult(self, facts, result, classifier):
        """One Laya consult for this stop, logged next to the rules' answer; the record (answered or skipped)."""
        # Compact, code-computed facts (HANDOFF §3.4): Laya weighs labels, it never parses raw state.
        recovery, mission = facts.get('recovery') or {}, facts.get('mission') or {}
        state = {'game': 'Pokémon FireRed, played by a bot with controller inputs only',
                 'stop reason': result['stop']['reason'], 'bot state': result['stop']['state'],
                 'automatic recovery': 'running' if result['stop']['phase'] == 'recovering' else 'stopped',
                 'screen': result['stop']['mode'], 'map': result['stop']['map'],
                 'recovery attempts': recovery.get('attempt') if _recovery_current(facts) else None,
                 'protected encounter': mission.get('protected') and mission.get('status') != 'complete',
                 'recent decisions': list(dict.fromkeys(d.get('reason') for d in (facts.get('decisions') or [])[-3:] if d.get('reason')))}
        state = {k: v for k, v in state.items() if v not in (None, [], '')}
        questions = {'bucket': {'type': 'choice', 'instructions': 'What kind of stop is this?', 'criteria': self.BUCKET_CRITERIA},
                     'action': {'type': 'choice', 'instructions': 'What should the owner do now?', 'criteria': self.ACTION_CRITERIA}}
        started = time.monotonic()
        try:
            answers = classifier.predict(json.dumps(state, ensure_ascii=False), questions) or {}
            bucket, action = _d(answers.get('bucket')), _d(answers.get('action'))
            record = {'mode': 'shadow', 'asset': getattr(classifier, 'asset_id', None),
                      'bucket': bucket.get('choice'), 'bucketConfidence': bucket.get('confidence'),
                      'action': action.get('choice'), 'actionConfidence': action.get('confidence'),
                      'ms': round((time.monotonic() - started) * 1000)}
        except Exception as error:  # LayaUnavailable/Timeout/WarmingUp or a crashed sidecar: rules stand alone
            record = {'mode': 'shadow', 'asset': getattr(classifier, 'asset_id', None), 'skipped': str(error)[:200]}
        record = _agreement(record, result)
        self._log(facts, result, record)
        return record

    def _log(self, facts, result, record):
        if self.log_path is None:
            return
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            line = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'game': facts.get('game'), 'frame': facts.get('frame'),
                    'reason': result['stop']['reason'],
                    'rules': {'bucket': result['bucket'], 'family': result['family'], 'action': result['suggestedAction']['action']},
                    'laya': record}
            with self.log_path.open('a', encoding='utf-8') as out:
                out.write(json.dumps(line, ensure_ascii=False) + '\n')
        except OSError:
            pass


def _stop_key(f):
    """One stop: its game, session and the owner's own first reason. The frame keeps moving while the owner stays
    stopped, so it is not part of the key; 'Automatic resume-mission: X' is the same stop as X."""
    return f.get('game'), f.get('sessionId'), next(iter(_reasons({**f, '_primary': True})), None)


def _agreement(record, result):
    """A Laya record scored against the rules' current answer (the stop's phase may have moved on since)."""
    if not record or 'skipped' in record:
        return record
    record = {**record, 'agreesBucket': record.get('bucket') == result['bucket'],
              'agreesAction': record.get('action') == result['suggestedAction']['action']}
    return {**record, 'agrees': record['agreesBucket'] and record['agreesAction']}


_SERVICE_LOCK = threading.Lock()


def _request_classifier(server):
    """The request interpreter's Laya classifier when request-interpreter.json turns it on (shared sidecar)."""
    from .pokemon_requests import load_config, service
    directory = getattr(server, 'directory', None)
    section = (load_config(directory) if directory else {}).get('laya')
    if not isinstance(section, dict) or section.get('mode') not in ('shadow', 'on'):
        return None
    return getattr(getattr(service(server), 'interpreter', None), 'classifier', None)


def service(server):
    existing = getattr(server, 'stop_triage', None)
    if existing is not None:
        return existing
    with _SERVICE_LOCK:
        existing = getattr(server, 'stop_triage', None)
        if existing is None:
            directory = getattr(server, 'directory', None)
            existing = StopTriage(server.pokemon_sessions, classifier=lambda: _request_classifier(server),
                                  log_path=(Path(directory) / 'requests' / 'stop-triage.ndjson') if directory else None)
            setattr(server, 'stop_triage', existing)
        return existing


def shadow_sessions(server, sessions):
    """Schedule the background Laya shadow consult for each stopped owner in a sessions payload; never raises."""
    try:
        if not any(isinstance(live, dict) and live.get('triage') for live in sessions or []):
            return
        triage = service(server)
        for live in sessions:
            if isinstance(live, dict) and live.get('triage') and isinstance(live.get('game'), str):
                triage.shadow_async(live['game'], {k: v for k, v in live.items() if k != 'triage'})
    except Exception:
        pass
