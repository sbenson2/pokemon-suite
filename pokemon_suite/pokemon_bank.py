"""The Bank: every FireRed species, how FireRed obtains it, and the owned
individuals in every save the app knows (the current save plus preserved and
linked saves, read through trading.py and inventory_sources.py).

Read-only. It never loads, activates, edits or writes a save. Getting a species
goes through the request interpreter and goal supervisor (pokemon_requests
Interpreter.select); sending an owned individual uses the existing trade flow.
"""
from __future__ import annotations

import copy
from pathlib import Path
import threading
import weakref

from .pokemon_evolution import evolution_rules
from .pokemon_farming import catalog

SCHEMA = 'pokemon-suite/bank/v1'
GAME = 'firered'
WILD = {'walk': 'Walking', 'surf': 'Surfing', 'old-rod': 'Old Rod', 'good-rod': 'Good Rod', 'super-rod': 'Super Rod', 'rock-smash': 'Rock Smash'}
GIFT_METHODS = ('gift', 'gift-egg', 'npc-trade')
STATIC_METHODS = ('static', 'pokeflute', 'roaming-grass')
# The engine's national-dex source rules (engine/firered/src/suite/national-dex-agenda.js,
# nationalDexSources): the same species lists and the same reasons.
EXTERNAL = {151: 'Requires a legitimately acquired Pokémon from a compatible external source.',
            251: 'Requires a legitimately acquired Pokémon from a compatible external source.',
            385: 'Requires a legitimately acquired Pokémon from a compatible external source.',
            249: 'Requires the appropriate legitimate event ticket and encounter, or a compatible trade.',
            250: 'Requires the appropriate legitimate event ticket and encounter, or a compatible trade.',
            386: 'Requires the appropriate legitimate event ticket and encounter, or a compatible trade.'}
GIFT_IDS = {131, 133, 142, 138, 140, 175}
STATIC_IDS = {144, 145, 146, 150, 143, 243, 244, 245}
TRADE_EVOLUTION = 'Reserve the original individual, trade with a compatible independent save, verify evolution, and trade it back.'
PARTNER_EVOLUTION = 'Evolve in a compatible partner game and return the same individual.'
PARTNER_SOURCE = 'Requires another starter, version, generation III game, native breeding source, or compatible trade.'
LABELS = {'wild': 'Wild', 'gift': 'Gift', 'static': 'Static encounter', 'evolution': 'Evolution', 'breeding': 'Breeding',
          'partner-trade': 'Partner trade', 'external': 'External'}
_ROUTES = {}  # (game, catalog revision) -> routes
_LEVELS = {}
_LOCK = threading.Lock()
# Per TradingLibrary: a preserved save's inventory by source id, with the stamp of the files it was read from.
_SAVED = weakref.WeakKeyDictionary()


def _places(encounters, limit=3):
    places = []
    for e in encounters:
        if e['location'] not in places:
            places.append(e['location'])
    return ', '.join(places[:limit]) + (f' and {len(places) - limit} more' if len(places) > limit else '')


def _direct(mon):
    """A native FireRed source: wild tables, gifts and in-game trades, static and roaming encounters."""
    from .pokemon_requests import _event_only
    encounters = [e for e in mon['encounters'] if not _event_only(e)]
    wild = [e for e in encounters if e['method'] in WILD]
    if wild:
        safari = all(e.get('safari') for e in wild)
        how = 'Safari Zone' if safari else ' / '.join(dict.fromkeys(WILD[e['method']] for e in wild))
        return {'category': 'wild', 'method': 'safari-land' if safari else wild[0]['method'], 'detail': f'{how}: {_places(wild)}'}
    gifts = [e for e in encounters if e['method'] in GIFT_METHODS]
    if gifts:
        e = gifts[0]
        conditions = '; '.join(e.get('conditions') or [])
        return {'category': 'gift', 'method': e['method'], 'label': {'npc-trade': 'In-game trade', 'gift-egg': 'Egg gift'}.get(e['method'], 'Gift'),
                'detail': e['location'] + (f' ({conditions})' if conditions else '')}
    statics = [e for e in encounters if e['method'] in STATIC_METHODS]
    if statics:
        e = statics[0]
        conditions = '; '.join(e.get('conditions') or [])
        roams = e['method'] == 'roaming-grass'
        where = 'Across Kanto' if roams else ('Wake it with the Poké Flute: ' if e['method'] == 'pokeflute' else '') + _places(statics)
        return {'category': 'static', 'method': 'roamer' if roams else 'static', 'label': 'Roaming' if roams else 'Static encounter',
                'detail': where + (f' ({conditions})' if conditions else '')}
    if mon['id'] in GIFT_IDS:
        return {'category': 'gift', 'method': 'gift', 'detail': 'A native gift or fossil revival.'}
    if mon['id'] in STATIC_IDS:
        return {'category': 'static', 'method': 'static', 'detail': 'A one-time or roaming encounter in this save.'}
    return None


def _hunts():
    """Species the bot's own executors can start directly (land routes, the legendary statics, Snorlax, the Eevee gift)."""
    from .pokemon_goals import static_target
    from .pokemon_requests import _land_species
    return set(_land_species()) | {sid for sid in range(1, 387) if static_target(sid)} | {133}


def routes(game=GAME, dex=None):
    """{speciesId: route} for every species: how FireRed obtains it, and whether it can without another game.
    dex: the game's catalog when the caller already read it (reading it parses a 1.6 MB file)."""
    if game != GAME:
        raise ValueError('The Bank is available for FireRed.')
    dex = dex or catalog(game)
    key = (game, dex.get('revision') or dex.get('sha256'))
    with _LOCK:
        if key in _ROUTES:
            return _ROUTES[key]
    species = {p['id']: p for p in dex['species']}
    rules = evolution_rules(game)['games'].get(game, [])
    parent = {r['speciesId']: r for r in rules}
    direct = {sid: route for sid, mon in species.items() if (route := _direct(mon))}
    # Obtainable: a native source, then evolving an obtainable form, or breeding it from an obtainable evolved form.
    obtainable = set(direct)
    changed = True
    while changed:
        changed = False
        for r in rules:
            for gained, needed in ((r['speciesId'], r['fromSpecies']), (r['fromSpecies'], r['speciesId'])):
                if needed in obtainable and gained not in obtainable and gained not in EXTERNAL:
                    obtainable.add(gained)
                    changed = True
    hunts = _hunts()
    result = {}
    for sid, mon in species.items():
        route = direct.get(sid)
        if route is None and sid in EXTERNAL:
            route = {'category': 'external', 'method': 'event-source', 'detail': EXTERNAL[sid]}
        elif route is None and sid in parent:
            rule = parent[sid]
            base = species[rule['fromSpecies']]
            condition = next((e['condition'] for e in base['evolutions'] if e['speciesId'] == sid), '')
            if rule['fromSpecies'] not in obtainable:
                route = {'category': 'external', 'method': 'partner-source',
                         'detail': f"Evolves from {base['name']}, which FireRed can’t obtain on its own. {PARTNER_SOURCE}"}
            elif rule['trigger'] == 'trade':
                route = {'category': 'partner-trade', 'method': 'trade-evolution', 'detail': f"Evolves from {base['name']} by trade. {TRADE_EVOLUTION}"}
            elif rule.get('evolutionGame') or rule.get('beauty'):
                other = 'Emerald' if 'emerald' in (rule.get('evolutionGame'), rule.get('preparationGame')) else 'another game'
                route = {'category': 'partner-trade', 'method': 'partner-evolution', 'detail': f"Evolves from {base['name']} in {other}. {PARTNER_EVOLUTION}"}
            else:
                route = {'category': 'evolution', 'method': 'evolution', 'detail': f"Evolves from {base['name']}" + (f' ({condition})' if condition else '') + '.'}
        elif route is None and sid in obtainable:
            family = [species[r['speciesId']]['name'] for r in rules if r['fromSpecies'] == sid and r['speciesId'] in obtainable]
            route = {'category': 'breeding', 'method': 'breeding', 'detail': f"Breed a native Egg from {' or '.join(family)}."}
        elif route is None:
            route = {'category': 'external', 'method': 'partner-source', 'detail': PARTNER_SOURCE}
        result[sid] = {'label': LABELS[route['category']], **route, 'obtainable': route['category'] != 'external', 'hunt': sid in hunts}
    with _LOCK:
        _ROUTES.clear()
        _ROUTES[key] = result
    return result


def _stamp(game, source, revision):
    """What a preserved save's inventory was read from: its checkpoint, profile record and library config, by
    (path, mtime, size, inode). A changed or replaced file changes the stamp. None: not cacheable (the current
    game, whose trade state is live, or a save whose files can't be read)."""
    if source.get('kind') != 'saved' or not source.get('library') or not source.get('profileId') or not source.get('recordPath'):
        return None
    library = Path(source['library'])
    files = (library/game/'save-profiles'/source['profileId']/'current.json', Path(source['recordPath']), library/'config.json')
    try:
        stats = [(str(path), path.stat()) for path in files]
    except OSError:
        return None
    return (revision,) + tuple((path, st.st_mtime_ns, st.st_size, st.st_ino) for path, st in stats)


def _inventory(trading, game, source, revision):
    """The source's inventory; a preserved save's is reused until its files change (reading one runs the engine's reader)."""
    stamp = _stamp(game, source, revision)
    with _LOCK:
        cache = _SAVED.setdefault(trading, {})
        hit = cache.get(source['id'])
    if stamp is not None and hit and hit[0] == stamp:
        return copy.deepcopy(hit[1])
    inventory = trading.inventory(game, source['id'])
    with _LOCK:
        if stamp is not None and inventory.get('validity') == 'valid' and _stamp(game, source, revision) == stamp:  # unchanged while it was read
            cache[source['id']] = (stamp, copy.deepcopy(inventory))
        else:
            cache.pop(source['id'], None)
    return inventory


def _read(trading, game, revision):
    """Every known save's verified party and PC (the current save first), read-only."""
    saves = []
    for source in trading.sources.list(game):
        entry = {'id': source['id'], 'label': source.get('label') or 'Saved game', 'kind': source.get('kind'), 'active': source.get('kind') == 'current'}
        if source.get('error'):
            saves.append((dict(entry, status='unavailable', reason=source['error']), None))
            continue
        try:
            inventory = _inventory(trading, game, source, revision)
        except (ValueError, OSError, KeyError) as error:  # the save vanished between listing and reading it
            saves.append((dict(entry, status='unavailable', reason=str(error)), None))
            continue
        if inventory.get('validity') != 'valid':
            saves.append((dict(entry, status='unavailable', reason=inventory.get('reason') or 'This save could not be read.'), None))
            continue
        saves.append((dict(entry, status='valid'), inventory))
    return saves


def _owned(record):
    return not record.get('isEgg') and isinstance(record.get('nationalSpeciesId'), int)


def _experience_levels():
    """{speciesId: [experience needed for level 1..100]} from the bundled Pokédex (PC records carry experience, not level)."""
    with _LOCK:
        if 'levels' in _LEVELS:
            return _LEVELS['levels']
    from .pokedex_database import Pokedex
    dex = Pokedex()
    table = {}
    for row in dex.rows('SELECT growth_rate_id,level,experience FROM experience ORDER BY growth_rate_id,level'):
        table.setdefault(row['growth_rate_id'], []).append(row['experience'])
    levels = {row['id']: table[row['growth_rate_id']] for row in dex.rows('SELECT id,growth_rate_id FROM pokemon_species WHERE id<=386')
              if len(table.get(row['growth_rate_id'], [])) == 100}
    with _LOCK:
        _LEVELS['levels'] = levels
    return levels


def level_of(record):
    """The party's own level, else the level its experience gives (how the game shows a PC Pokémon's level)."""
    if isinstance(record.get('level'), int) and record['level'] > 0:
        return record['level']
    thresholds = _experience_levels().get(record.get('nationalSpeciesId'))
    if not thresholds or type(record.get('experience')) is not int or record.get('isEgg'):
        return None
    return max(level for level, needed in enumerate(thresholds, 1) if needed <= record['experience'])


def overview(trading, game=GAME, dex=None):
    """Every species with its owned counts across all saves and how FireRed obtains it."""
    dex = dex or catalog(game)
    table = routes(game, dex)
    saves, counts = [], {}
    for entry, inventory in _read(trading, game, dex.get('revision')):
        records = [p for p in (inventory or {}).get('pokemon', []) if _owned(p)]
        if inventory is not None:
            entry.update(count=len(records), shiny=sum(1 for p in records if p.get('shiny')))
        saves.append(entry)
        for p in records:
            tally = counts.setdefault(p['nationalSpeciesId'], {'individuals': set(), 'shiny': set(), 'copies': 0, 'current': 0, 'saves': set()})
            tally['individuals'].add(p.get('fingerprint') or p['id'])
            if p.get('shiny'):
                tally['shiny'].add(p.get('fingerprint') or p['id'])
            tally['copies'] += 1
            tally['current'] += entry['active']
            tally['saves'].add(entry['id'])
    species = []
    for sid, route in sorted(table.items()):
        tally = counts.get(sid)
        species.append({'id': sid, 'owned': len(tally['individuals']) if tally else 0, 'shiny': len(tally['shiny']) if tally else 0,
                        'copies': tally['copies'] if tally else 0, 'current': tally['current'] if tally else 0,
                        'saves': len(tally['saves']) if tally else 0, 'route': route})
    return {'schema': SCHEMA, 'game': game, 'saves': saves, 'species': species,
            'totals': {'species': len(species), 'owned': sum(1 for s in species if s['owned']), 'shiny': sum(1 for s in species if s['shiny']),
                       'obtainable': sum(1 for s in species if s['route']['obtainable'])}}


def owned(trading, game, species_id, dex=None):
    """One species' individuals in every save, as the inventory reports them, with its save and trade availability.

    Only the active save's individuals can be sent: the others keep the inventory's
    reason ("Load this collection as the active game before preparing a trade")."""
    dex = dex or catalog(game)
    table = routes(game, dex)
    if type(species_id) is not int or species_id not in table:
        raise ValueError('Choose a Pokédex number from 1 to 386.')
    saves, pokemon, active = [], [], None
    for entry, inventory in _read(trading, game, dex.get('revision')):
        if inventory is not None:
            entry['count'] = sum(1 for p in inventory.get('pokemon', []) if p.get('nationalSpeciesId') == species_id and not p.get('isEgg'))
        saves.append(entry)
        if inventory is None:
            continue
        if entry['active']:
            active = inventory
        for p in inventory.get('pokemon', []):
            if p.get('nationalSpeciesId') != species_id:
                continue
            record = dict(p, sourceId=entry['id'], saveLabel=entry['label'], isActiveSave=entry['active'], level=level_of(p))
            if not entry['active']:
                record.update(canPrepare=False, canTrade=False)
            pokemon.append(record)
    copies = {}
    for p in pokemon:
        copies[p.get('fingerprint')] = copies.get(p.get('fingerprint'), 0) + 1
    for p in pokemon:
        p['copies'] = copies.get(p.get('fingerprint'), 1)
    active = active or {}
    return {'schema': SCHEMA, 'game': game, 'speciesId': species_id, 'route': table[species_id], 'saves': saves, 'pokemon': pokemon,
            'sessionId': active.get('sessionId'), 'radio': active.get('radio'), 'tradeReason': active.get('tradeReason'),
            'trade': active.get('trade'), 'preparation': active.get('preparation')}


def bank(trading, game=GAME, species_id=None):
    if game != GAME:
        raise ValueError('The Bank is available for FireRed.')
    result = overview(trading, game) if species_id is None else owned(trading, game, species_id)
    # extra-saves: families that need another FireRed save name that route (extra_saves.py).
    from .extra_saves import annotate_bank
    return annotate_bank(trading, result)
