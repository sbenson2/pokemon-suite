"""Derive the competitive builder's compact FireRed facts from the bot knowledge pack.

Reads the pinned knowledge pack (world.json, story.json, battle.json; see
pokemon_suite/game_resources.py), the engine's Town Map section order and Gen
III species map, and the bundled PokéAPI projections. Writes one JSON file of
functional facts (numbers and identifiers only, no text or ROM data):

- met-location (MAPSEC) numbers and plain names for FireRed/LeafGreen;
- FireRed wild tables per map section, slot by slot, from world.json;
- gift, static and event encounters from story.json scripts;
- the in-game trade table and Tanoby Unown letter slots from pret source;
- growth rates, obtainable items and Poké Balls, the Gen III type chart and
  native move data (type, power, accuracy, PP, effect);
- LeafGreen and Emerald encounter summaries from the PokéAPI projections.

Usage: build-builder-facts.py --resources <GameResources/firered> [--output ...]
"""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'pokemon_suite/static/data/pokedex'
OUTPUT = DATA / 'firered-builder.json'
PRET = 'c75f352304d529f6ba92d4f74b9cf8b5c3810788'
PRET_URL = f'https://github.com/pret/pokefirered/blob/{PRET}/'
KANTO_MAPSEC_START = 0x58
SPECIAL_METLOCS = {253: 'Egg (not yet hatched)', 254: 'In-game trade', 255: 'Fateful encounter'}

# pret src/data/ingame_trades.h (numbers only; nicknames and OT names are
# game text and are not copied). IVs are in stat order HP, Atk, Def, Spe, SpA,
# SpD (CreateInGameTradePokemonInternal sets MON_DATA_HP_IV + i). OT ID is a
# 16-bit trainer ID with secret ID 0. Met location 254, Poké Ball, and the
# level of the Pokémon given in exchange.
IN_GAME_TRADES = [
    {'species': 122, 'requested': {'firered': 63, 'leafgreen': 63}, 'ivs': [20, 15, 17, 24, 23, 22], 'abilityNum': 0, 'otId': 1985, 'personality': 0x00009CAE, 'games': ['firered', 'leafgreen']},
    {'species': 124, 'requested': {'firered': 61, 'leafgreen': 61}, 'ivs': [18, 17, 18, 22, 25, 21], 'abilityNum': 0, 'otId': 36728, 'personality': 0x498A2E1D, 'games': ['firered', 'leafgreen']},
    {'species': 29, 'requested': {'firered': 32}, 'ivs': [22, 18, 25, 19, 15, 22], 'abilityNum': 0, 'otId': 63184, 'personality': 0x4C970B89, 'games': ['firered']},
    {'species': 32, 'requested': {'leafgreen': 29}, 'ivs': [19, 25, 18, 22, 22, 15], 'abilityNum': 0, 'otId': 63184, 'personality': 0x4C970B9E, 'games': ['leafgreen']},
    {'species': 83, 'requested': {'firered': 21, 'leafgreen': 21}, 'ivs': [20, 25, 21, 24, 15, 20], 'abilityNum': 0, 'otId': 8810, 'personality': 0x151943D7, 'games': ['firered', 'leafgreen']},
    {'species': 30, 'requested': {'firered': 33}, 'ivs': [22, 25, 18, 19, 22, 15], 'abilityNum': 0, 'otId': 13637, 'personality': 0x00EECA15, 'games': ['firered']},
    {'species': 33, 'requested': {'leafgreen': 30}, 'ivs': [19, 18, 25, 22, 15, 22], 'abilityNum': 0, 'otId': 13637, 'personality': 0x00EECA19, 'games': ['leafgreen']},
    {'species': 108, 'requested': {'firered': 55, 'leafgreen': 80}, 'ivs': [24, 19, 21, 15, 23, 21], 'abilityNum': 0, 'otId': 1239, 'personality': 0x451308AB, 'games': ['firered', 'leafgreen']},
    {'species': 101, 'requested': {'firered': 26, 'leafgreen': 26}, 'ivs': [19, 16, 18, 25, 25, 19], 'abilityNum': 1, 'otId': 50298, 'personality': 0x06341016, 'games': ['firered', 'leafgreen']},
    {'species': 114, 'requested': {'firered': 48, 'leafgreen': 48}, 'ivs': [22, 17, 25, 16, 23, 20], 'abilityNum': 0, 'otId': 60042, 'personality': 0x5C77ECFA, 'games': ['firered', 'leafgreen']},
    {'species': 86, 'requested': {'firered': 77, 'leafgreen': 77}, 'ivs': [24, 15, 22, 16, 23, 22], 'abilityNum': 0, 'otId': 9853, 'personality': 0x482CAC89, 'games': ['firered', 'leafgreen']},
]

# pret src/wild_encounter.c sUnownLetterSlots: the letter (0 = A … 25 = Z,
# 26 = !, 27 = ?) of each of the 12 land slots, per chamber in map order
# starting at MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER.
UNOWN_LETTER_SLOTS = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 27],
    [2, 2, 2, 3, 3, 3, 7, 7, 7, 20, 20, 14],
    [13, 13, 13, 13, 18, 18, 18, 18, 8, 8, 4, 4],
    [15, 15, 11, 11, 9, 9, 17, 17, 17, 16, 16, 16],
    [24, 24, 19, 19, 6, 6, 6, 5, 5, 5, 10, 10],
    [21, 21, 21, 22, 22, 22, 23, 23, 12, 12, 1, 1],
    [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 26],
]

# Items given by native code rather than a script reference (pret src/).
SPECIAL_ITEMS = {
    'ITEM_SAFARI_BALL': 'Safari Zone entry (src/safari_zone.c)',
    'ITEM_LUXURY_BALL': 'Resort Gorgeous reward (src/field_specials.c SampleResortGorgeousReward)',
}
BALLS = {1: 'Master Ball', 2: 'Ultra Ball', 3: 'Great Ball', 4: 'Poké Ball', 5: 'Safari Ball', 6: 'Net Ball', 7: 'Dive Ball',
         8: 'Nest Ball', 9: 'Repeat Ball', 10: 'Timer Ball', 11: 'Luxury Ball', 12: 'Premier Ball'}
ITEM_OPS = {'finditem', 'giveitem', 'giveitem_msg', 'additem', '.2byte'}
GROWTH = {'GROWTH_MEDIUM_FAST': 'medium-fast', 'GROWTH_ERRATIC': 'erratic', 'GROWTH_FLUCTUATING': 'fluctuating',
          'GROWTH_MEDIUM_SLOW': 'medium-slow', 'GROWTH_FAST': 'fast', 'GROWTH_SLOW': 'slow'}
SMALL_WORDS = {'OF', 'THE'}
NAME_FIXES = {'MAPSEC_S_S_ANNE': 'S.S. Anne', 'MAPSEC_MT_MOON': 'Mt. Moon', 'MAPSEC_MT_EMBER': 'Mt. Ember',
              'MAPSEC_KANTO_VICTORY_ROAD': 'Victory Road', 'MAPSEC_KANTO_SAFARI_ZONE': 'Safari Zone',
              'MAPSEC_POKEMON_MANSION': 'Pokémon Mansion', 'MAPSEC_POKEMON_LEAGUE': 'Pokémon League',
              'MAPSEC_POKEMON_TOWER': 'Pokémon Tower', 'MAPSEC_ROUTE_4_POKECENTER': 'Route 4 Pokémon Center',
              'MAPSEC_ROUTE_10_POKECENTER': 'Route 10 Pokémon Center', 'MAPSEC_DIGLETTS_CAVE': 'Diglett’s Cave',
              'MAPSEC_UNDERGROUND_PATH_2': 'Underground Path (east–west)', 'MAPSEC_TRAINER_TOWER_2': 'Trainer Tower (inside)',
              'MAPSEC_SPECIAL_AREA': 'Celadon Dept.'}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    value = json.loads(Path(path).read_text())
    return value.get('data', value)


def mapsec_names():
    text = (ROOT / 'engine/firered/src/presentation/region-map-facts.js').read_text()
    body = text[text.index('export const sections'):]
    body = body[:body.index('});')]
    names = re.findall(r'^\s*(MAPSEC_[A-Z0-9_]+)\s*:', body, re.M)
    if names[0] != 'MAPSEC_PALLET_TOWN' or names[-1] != 'MAPSEC_SPECIAL_AREA' or KANTO_MAPSEC_START + len(names) - 1 != 0xC4:
        raise ValueError('The Town Map section order no longer matches MAPSEC_PALLET_TOWN 0x58 … MAPSEC_SPECIAL_AREA 0xC4.')
    return {name: KANTO_MAPSEC_START + index for index, name in enumerate(names)}


def plain(name):
    if name in NAME_FIXES:
        return NAME_FIXES[name]
    words = name.removeprefix('MAPSEC_').split('_')
    return ' '.join(w.capitalize() if w not in SMALL_WORDS else w.lower() for w in words)


def national_map():
    text = (ROOT / 'engine/firered/src/evidence/gen3-national-species.js').read_text()
    array = re.search(r'Object\.freeze\((\[.*?\])\)', text, re.S).group(1)
    return json.loads(array)


def build(resources, output=OUTPUT):
    resources = Path(resources)
    world, story, battle = (load(resources / f'{k}.json') for k in ('world', 'story', 'battle'))
    national = national_map()
    sections = mapsec_names()
    dex = {g: json.loads((DATA / f'{g}.json').read_text()) for g in ('firered', 'leafgreen', 'emerald')}
    species_ids = {s['name'].removeprefix('SPECIES_'): national[s['id']] for s in battle['species'] if s.get('id') and national[s['id']]}

    def species_id(constant):
        value = species_ids.get(constant.removeprefix('SPECIES_'))
        if value is None:
            raise ValueError('Unknown species constant ' + constant)
        return value

    maps = {m['id']: m for m in world['maps']}
    by_name = {m['name']: m for m in world['maps']}

    def section_of(map_record):
        name = (map_record.get('properties') or {}).get('region_map_section')
        if name not in sections:
            raise ValueError(f'{map_record["id"]} has no Kanto region map section ({name}).')
        return sections[name]

    # FireRed wild tables, slot by slot (world.json wildEncounters, *_FireRed).
    monean = maps['MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER']['number']
    tables = []
    for entry in world['wildEncounters']:
        record = maps[entry['map']]
        mapsec = section_of(record)
        groups = {'land': 'land_mons', 'water': 'water_mons', 'rock-smash': 'rock_smash_mons'}
        for area, key in groups.items():
            if key in entry:
                slots = [[species_id(m['species']), m['min_level'], m['max_level']] for m in entry[key]['mons']]
                table = {'mapsec': mapsec, 'map': entry['map'], 'area': area, 'slots': slots}
                if area == 'land' and all(s[0] == 201 for s in slots):
                    table['unownChamber'] = record['number'] - monean
                    if not 0 <= table['unownChamber'] < len(UNOWN_LETTER_SLOTS):
                        raise ValueError('Unexpected Tanoby chamber ' + entry['map'])
                tables.append(table)
        if 'fishing_mons' in entry:
            slots = [[species_id(m['species']), m['min_level'], m['max_level']] for m in entry['fishing_mons']['mons']]
            tables.append({'mapsec': mapsec, 'map': entry['map'], 'area': 'fishing', 'slots': slots})
    rates = {r['type']: r for r in world['wildEncounterRates']}
    thresholds = {}
    for area, key in (('land', 'land_mons'), ('water', 'water_mons'), ('rock-smash', 'rock_smash_mons')):
        total, bounds = 0, []
        for rate in rates[key]['encounter_rates']:
            total += rate
            bounds.append(total)
        thresholds[area] = bounds
    fishing = rates['fishing_mons']
    thresholds['fishing'] = {}
    for rod, indexes in fishing['groups'].items():
        total, bounds = 0, []
        for index in indexes:
            total += fishing['encounter_rates'][index]
            bounds.append(total)
        thresholds['fishing'][rod.replace('_', '-')] = {'slots': indexes, 'bounds': bounds}

    # Gifts, statics and event encounters from story.json scripts.
    pokedex_fixed = collections.defaultdict(list)
    for s in dex['firered']['species']:
        for e in s['encounters']:
            if e['method'] in {'gift', 'static', 'pokeflute', 'gift-egg'}:
                pokedex_fixed[s['id']].append(e)
    fixed = []
    for script in story['scripts']:
        parts = script['file'].split('/')
        if len(parts) < 3 or parts[1] != 'maps':
            continue
        record = by_name.get(parts[2])
        for step in script['instructions']:
            op, args = step['op'], step['args']
            if op not in {'givemon', 'setwildbattle', 'seteventmon', 'giveegg'}:
                continue
            level = int(args[1]) if len(args) > 1 and args[1].isdigit() else 5
            if args[0].startswith('SPECIES_'):
                candidates = [species_id(args[0])]
            else:  # starter choice, prize corner and Dojo variables
                candidates = [sid for sid, rows in pokedex_fixed.items() if any(e['method'] == 'gift' and e['minLevel'] == level for e in rows)]
                area = parts[2]
                candidates = [sid for sid in candidates if any(e['method'] == 'gift' and e['minLevel'] == level and (
                    ('Oak' in area and e['locationId'].startswith('pallet-town')) or ('Prize' in area and 'prize-corner' in e['locationId']) or
                    ('Dojo' in area and 'fighting-dojo' in e['locationId'])) for e in pokedex_fixed[sid])]
            for sid in candidates:
                if op != 'giveegg' and not pokedex_fixed.get(sid):
                    continue  # not catchable (the Pokémon Tower Marowak ghost)
                if op == 'givemon' and not any(e['minLevel'] == level for e in pokedex_fixed[sid]):
                    continue  # LeafGreen prize corner variants
                kind = {'givemon': 'gift', 'setwildbattle': 'static', 'seteventmon': 'event', 'giveegg': 'egg'}[op]
                fixed.append({'species': sid, 'level': level, 'mapsec': section_of(record), 'map': record['id'], 'kind': kind,
                              'fateful': op == 'seteventmon', 'ball': 'poke-ball' if kind in {'gift', 'egg'} else 'any',
                              'source': f'{script["file"]}:{script["label"]}'})
    fixed = sorted({(f['species'], f['level'], f['mapsec'], f['kind']): f for f in fixed}.values(), key=lambda f: (f['species'], f['mapsec']))
    missing = [sid for sid in pokedex_fixed if not any(f['species'] == sid for f in fixed)]
    if missing:
        raise ValueError(f'Pokédex gifts or statics without a script source: {missing}')

    # LeafGreen: PokéAPI encounters, mapped to sections through FireRed.
    slug_sections = collections.defaultdict(collections.Counter)
    table_species = collections.defaultdict(set)
    for t in tables:
        for sid, lo, hi in t['slots']:
            table_species[(t['mapsec'], sid)].add((lo, hi))
    for s in dex['firered']['species']:
        for e in s['encounters']:
            if e['method'] in {'walk', 'surf', 'old-rod', 'good-rod', 'super-rod', 'rock-smash'}:
                for (mapsec, sid), levels in table_species.items():
                    if sid == s['id'] and any(lo <= e['maxLevel'] and hi >= e['minLevel'] for lo, hi in levels):
                        slug_sections[e['locationId']][mapsec] += 1
    slug_map = {slug: counts.most_common(1)[0][0] for slug, counts in slug_sections.items()}
    leafgreen = {'wild': [], 'fixed': [], 'unmapped': []}
    for s in dex['leafgreen']['species']:
        for e in s['encounters']:
            if e['method'] in {'walk', 'surf', 'old-rod', 'good-rod', 'super-rod', 'rock-smash'}:
                mapsec = slug_map.get(e['locationId'])
                if mapsec is None:
                    leafgreen['unmapped'].append(e['locationId'])
                    continue
                leafgreen['wild'].append({'species': s['id'], 'mapsec': mapsec, 'method': e['method'], 'minLevel': e['minLevel'],
                                          'maxLevel': e['maxLevel'], 'safari': e['safari']})
            elif e['method'] in {'gift', 'static', 'pokeflute', 'gift-egg'}:
                same = [f for f in fixed if f['species'] == s['id']]
                mapsecs = sorted({f['mapsec'] for f in same}) or sorted({f['mapsec'] for f in fixed if f['source'].split(':')[0].endswith('CeladonCity_GameCorner_PrizeRoom/scripts.inc')})
                for mapsec in mapsecs:
                    leafgreen['fixed'].append({'species': s['id'], 'level': e['minLevel'], 'mapsec': mapsec,
                                               'kind': 'egg' if e['method'] == 'gift-egg' else 'gift' if e['method'] == 'gift' else 'static',
                                               'fateful': any(f['fateful'] for f in same), 'ball': 'poke-ball' if e['method'] in {'gift', 'gift-egg'} else 'any'})
    leafgreen['unmapped'] = sorted(set(leafgreen['unmapped']))

    # Emerald has no section map here; keep species levels for a partial check.
    emerald = collections.defaultdict(list)
    for s in dex['emerald']['species']:
        for e in s['encounters']:
            emerald[str(s['id'])].append([e['minLevel'], e['maxLevel'], e['method']])

    growth = {}
    for s in battle['species']:
        if s.get('id') and national[s['id']] and s.get('growthRate'):
            growth[str(national[s['id']])] = GROWTH[s['growthRate']]

    # Items the FireRed player can obtain, from scripts, hidden items, wild
    # held items and the native special cases above.
    symbols = {k: v['value'] for k, v in story['symbols']['items'].items()}
    sources = collections.defaultdict(set)
    for constant, refs in story['references']['items'].items():
        for ref in refs:
            if ref['op'] in ITEM_OPS:
                where = ref['file'].split('/')[2] if ref['file'].startswith('data/maps/') else Path(ref['file']).stem
                sources[constant].add({'.2byte': 'shop or prize list', 'finditem': 'item ball'}.get(ref['op'], 'gift') + ': ' + where)
    for m in world['maps']:
        for bg in m.get('backgroundEvents', []):
            if bg.get('type') == 'hidden_item':
                sources[bg['item']].add('hidden item: ' + m['id'])
    for s in battle['species']:
        for key in ('itemCommon', 'itemRare'):
            if s.get(key) and s[key] != 'ITEM_NONE' and s.get('id') and national[s['id']]:
                sources[s[key]].add('held by wild ' + s['name'].removeprefix('SPECIES_').replace('_', ' ').title())
    for constant, where in SPECIAL_ITEMS.items():
        sources[constant].add(where)
    items = {}
    for constant, where in sources.items():
        if constant in symbols and symbols[constant] > 0:
            items[str(symbols[constant])] = {'constant': constant, 'sources': sorted(where)[:6]}
    balls = {str(i): {'name': name, 'firered': str(i) in items} for i, name in BALLS.items()}

    types = sorted({t for s in dex['firered']['species'] for t in s['types']})
    chart = []
    for entry in battle['typeChart']:
        attack, defend = entry['attackingType'], entry['defendingType']
        if attack.startswith('TYPE_') and defend.startswith('TYPE_') and attack not in {'TYPE_FORESIGHT', 'TYPE_ENDTABLE'}:
            a, d = attack.removeprefix('TYPE_').lower(), defend.removeprefix('TYPE_').lower()
            if a in types and d in types:
                chart.append([a, d, entry['multiplier'] / 10])
    tutors = sorted({k.removeprefix('MOVETUTOR_') for k in battle['constants']['moves'] if k.startswith('MOVETUTOR_')})
    # Native move data (battle.json gBattleMoves): later-generation PP and power
    # changes in the PokéAPI projection must not leak into Gen III rules.
    moves = {}
    for m in battle['moves']:
        if m['id']:
            moves[str(m['id'])] = [m['type'].removeprefix('TYPE_').lower(), m['power'], m['accuracy'], m['pp'], m['effect'],
                                   m['priority'], m['secondaryEffectChance'], m['target']]

    facts = {
        'schema': 'pokemon-suite/builder-facts/v1', 'game': 'firered',
        'source': {'pret': f'pret/pokefirered@{PRET}', 'world': sha256(resources / 'world.json'), 'story': sha256(resources / 'story.json'),
                   'battle': sha256(resources / 'battle.json'),
                   'regionMap': sha256(ROOT / 'engine/firered/src/presentation/region-map-facts.js'),
                   'pokedex': {g: dex[g]['revision'] for g in dex},
                   'inGameTrades': PRET_URL + 'src/data/ingame_trades.h', 'unownLetterSlots': PRET_URL + 'src/wild_encounter.c',
                   'specialMetLocations': PRET_URL + 'src/data/region_map/region_map_sections.constants.json.txt'},
        'metLocations': {**{str(v): {'id': k, 'name': plain(k)} for k, v in sections.items()},
                         **{str(k): {'id': None, 'name': v} for k, v in SPECIAL_METLOCS.items()}},
        'wildTables': tables, 'slotThresholds': thresholds, 'unownLetterSlots': UNOWN_LETTER_SLOTS,
        'fixed': fixed, 'trades': IN_GAME_TRADES,
        'roamers': {'species': [243, 244, 245], 'level': 50, 'mapsecs': list(range(0x65, 0x7E))},
        'leafgreen': leafgreen, 'emeraldSpecies': dict(emerald), 'growth': growth,
        'items': items, 'balls': balls, 'typeChart': chart, 'types': types, 'tutorMoves': tutors, 'moves': moves,
    }
    body = json.dumps(facts, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    facts['revision'] = hashlib.sha256(body.encode()).hexdigest()
    Path(output).write_text(json.dumps(facts, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n')
    return {'output': str(output), 'wildTables': len(tables), 'fixed': len(fixed), 'items': len(items),
            'leafgreenWild': len(leafgreen['wild']), 'leafgreenUnmapped': leafgreen['unmapped'], 'revision': facts['revision']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--resources', type=Path, required=True, help='GameResources/firered knowledge pack folder')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    print(json.dumps(build(args.resources, args.output), indent=1))
