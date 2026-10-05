"""Derive the species a LeafGreen player can register without another game or an event.

Build 124. The same derivation as scripts/derive-firered-catchable.py (the
FireRed goal from the collection work), applied to pret's LeafGreen build of the
same pokefirered checkout (commit c75f3523). The version-specific inputs are
read from the source with the version's own preprocessor branch, never typed in:

- wild tables: src/data/wild_encounters.json labels ending _LeafGreen, except
  Altering Cave tables 2-9 (only the Mystery Event script changes
  VAR_ALTERING_CAVE_WILD_SET, data/mystery_event_msg.s);
- Game Corner prizes: data/maps/CeladonCity_GameCorner_PrizeRoom/scripts.inc,
  `.ifdef LEAFGREEN` branch (Abra, Clefairy, Pinsir, Dratini, Porygon);
- in-game trades: src/data/ingame_trades.h, `#elif defined(LEAFGREEN)` branch;
- the sources both versions share (starters, fossils, Old Amber, roaming
  beasts, Dojo, gifts, static encounters) exactly as the FireRed derivation;
- evolution by methods the cartridge performs (level, friendship, stat-branch
  level, items the cartridge provides, a same-version trade), and Day Care
  breeding with the incense rule.

`--version firered` runs the same code on FireRed's branches; it must reproduce
the FireRed goal file, which cross-checks this derivation.
"""
import argparse, json, pathlib, re

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('source', type=pathlib.Path)
parser.add_argument('--version', choices=('leafgreen', 'firered'), default='leafgreen')
parser.add_argument('--output', type=pathlib.Path)
args = parser.parse_args()
VERSION = args.version
TITLE = {'leafgreen': 'LeafGreen', 'firered': 'FireRed'}[VERSION]
SYMBOL = VERSION.upper()
output = args.output or pathlib.Path(f'engine/firered/src/suite/{VERSION}-catchable.json')
root = args.source
text = lambda p: (root / p).read_text()


def c_branch(source):
    """Keep one version's lines of `#if defined(FIRERED)`/`#elif defined(LEAFGREEN)` blocks."""
    kept, stack = [], []
    for line in source.splitlines():
        s = line.strip()
        m = re.match(r'#\s*(if|elif)\s+defined\((FIRERED|LEAFGREEN)\)', s)
        if m and m.group(1) == 'if':stack.append(m.group(2) == SYMBOL);continue
        if m:stack[-1] = m.group(2) == SYMBOL;continue
        if stack and re.match(r'#\s*else\b', s):stack[-1] = not stack[-1];continue
        if stack and re.match(r'#\s*endif\b', s):stack.pop();continue
        if all(stack):kept.append(line)
    return '\n'.join(kept)


def asm_branch(source):
    """Keep one version's lines of `.ifdef FIRERED`/`.else`/`.ifdef LEAFGREEN` blocks."""
    kept, stack = [], []
    for line in source.splitlines():
        s = line.strip()
        m = re.match(r'\.ifdef\s+(\w+)', s)
        if m:stack.append(m.group(1) == SYMBOL);continue
        if s == '.else':stack[-1] = not stack[-1];continue
        if s == '.endif':stack.pop();continue
        if all(stack):kept.append(line)
    return '\n'.join(kept)


national = {}
for i, name in enumerate(re.findall(r'^\s*NATIONAL_DEX_(\w+),', text('include/constants/pokedex.h'), re.M)):
    if 1 <= i <= 386:
        national[name] = i  # NATIONAL_DEX_NONE is 0; OLD_UNOWN_* follow Deoxys
assert national['BULBASAUR'] == 1 and national['DEOXYS'] == 386, 'national order'

evolutions = {}
for species, body in re.findall(r'\[SPECIES_(\w+)\]\s*=\s*\{(\{.*?\})\},', c_branch(text('src/data/pokemon/evolution.h')), re.S):
    evolutions[species] = [(m, p, t) for m, p, t in re.findall(r'\{\s*(EVO_\w+)\s*,\s*(\w+)\s*,\s*SPECIES_(\w+)\s*\}', body)]

info = {}
for species, body in re.findall(r'\[SPECIES_(\w+)\]\s*=\s*\{(.*?)\n    \}', c_branch(text('src/data/pokemon/species_info.h')), re.S):
    groups = re.search(r'\.eggGroups\s*=\s*\{\s*(EGG_GROUP_\w+)\s*,\s*(EGG_GROUP_\w+)\s*\}', body)
    items = [m for m in re.findall(r'\.item(?:Common|Rare)\s*=\s*ITEM_(\w+)', body) if m != 'NONE']
    info[species] = {'eggGroups': list(groups.groups()) if groups else [], 'items': items}

suffix = '_' + TITLE
wild = {}
for group in json.loads(text('src/data/wild_encounters.json'))['wild_encounter_groups']:
    for table in group['encounters']:
        label = table.get('base_label', '')
        if not label.endswith(suffix):
            continue
        if re.search(r'AlteringCave_(\d+)' + suffix + '$', label):
            continue  # tables 2-9: Mystery Event only
        for key in ('land_mons', 'water_mons', 'fishing_mons', 'rock_smash_mons'):
            for mon in (table.get(key) or {}).get('mons', []):
                wild.setdefault(mon['species'].removeprefix('SPECIES_'), set()).add(key.removesuffix('_mons'))

# Items the cartridge provides (for item and held-item evolutions, and incense).
items = set()
ball_items = dict(re.findall(r'(\w+)::\s*\n\s*finditem ITEM_(\w+)', text('data/scripts/item_ball_scripts.inc')))
for path in sorted((root / 'data/maps').glob('*/map.json')):
    m = json.loads(path.read_text())
    for e in m.get('object_events', []):
        if e.get('script') in ball_items:
            items.add(ball_items[e['script']])
    for e in m.get('bg_events', []):
        if e.get('type') == 'hidden_item':
            items.add(e['item'].removeprefix('ITEM_'))
for path in sorted((root / 'data/maps').glob('*/scripts.inc')):
    body = asm_branch(path.read_text())
    items.update(re.findall(r'\b(?:giveitem|additem|giveitem_msg\s+\w+,)\s*ITEM_(\w+)', body))
    for mart in re.findall(r'pokemart\s+(\w+)', body):
        block = re.search(re.escape(mart) + r':(.*?)(?:\n\n|\Z)', body, re.S)
        if block:
            items.update(re.findall(r'\.2byte ITEM_(\w+)', block.group(1)))
for species in wild:
    items.update(info.get(species, {}).get('items', []))

# The version's own Game Corner prizes and in-game trades (received species).
prize_script = asm_branch(text('data/maps/CeladonCity_GameCorner_PrizeRoom/scripts.inc'))
prizes = list(dict.fromkeys(re.findall(r'setvar VAR_TEMP_1, SPECIES_(\w+)', prize_script)))
trades = re.findall(r'\.species\s*=\s*SPECIES_(\w+)', c_branch(text('src/data/ingame_trades.h')))
assert len(prizes) == 5 and len(trades) == 9, (prizes, trades)

SOURCES = {
    'starter': (['BULBASAUR', 'CHARMANDER', 'SQUIRTLE'], 'data/maps/PalletTown_ProfessorOaksLab/scripts.inc (one per save)'),
    'fossil': (['OMANYTE', 'KABUTO'], 'data/maps/MtMoon_B2F/scripts.inc (one of the two per save), CinnabarIsland_PokemonLab_ExperimentRoom'),
    'amber': (['AERODACTYL'], 'data/maps/PewterCity_Museum_1F/scripts.inc (Old Amber)'),
    'roamer': (['RAIKOU', 'ENTEI', 'SUICUNE'], 'src/roamer.c (one per save, chosen by the starter)'),
    'dojo': (['HITMONLEE', 'HITMONCHAN'], 'data/maps/SaffronCity_Dojo/scripts.inc (one per save)'),
    'gift': (['LAPRAS', 'EEVEE', 'MAGIKARP', 'TOGEPI'], 'SilphCo_7F, CeladonCity_Condominiums_RoofRoom, MtMoon Pokemon Center salesman, FiveIsland_WaterLabyrinth'),
    'prize': (prizes, f'data/maps/CeladonCity_GameCorner_PrizeRoom/scripts.inc ({SYMBOL})'),
    'static': (['SNORLAX', 'MEWTWO', 'ARTICUNO', 'ZAPDOS', 'MOLTRES', 'ELECTRODE', 'HYPNO'], 'setwildbattle in data/maps/*/scripts.inc'),
    'trade': (trades, f'src/data/ingame_trades.h ({SYMBOL})'),
}
ONE_PER_SAVE = {'starter', 'fossil', 'roamer', 'dojo'}
via = {}
def add(species, how):
    if species in national and how not in via.setdefault(species, []):
        via[species].append(how)
for species, methods in wild.items():
    for method in sorted(methods):
        add(species, 'wild-' + method)
for kind, (names, _) in SOURCES.items():
    for species in names:
        add(species, kind)

FEASIBLE = {'EVO_LEVEL', 'EVO_FRIENDSHIP', 'EVO_TRADE', 'EVO_LEVEL_ATK_GT_DEF', 'EVO_LEVEL_ATK_EQ_DEF', 'EVO_LEVEL_ATK_LT_DEF',
            'EVO_LEVEL_SILCOON', 'EVO_LEVEL_CASCOON', 'EVO_LEVEL_NINJASK', 'EVO_LEVEL_SHEDINJA'}
def base(species):
    for _ in range(5):
        parent = next((s for s, evos in evolutions.items() if any(t == species for _, _, t in evos)), None)
        if not parent:
            break
        species = parent
    return species
INCENSE = {'WYNAUT': 'LAX_INCENSE', 'AZURILL': 'SEA_INCENSE'}
changed = True
while changed:
    changed = False
    for species in list(via):
        for method, param, target in evolutions.get(species, []):
            ok = method in FEASIBLE or method in ('EVO_ITEM', 'EVO_TRADE_ITEM') and param.removeprefix('ITEM_') in items
            if ok and target in national and 'evolution' not in via.get(target, []):
                add(target, 'evolution'); changed = True
        groups = info.get(species, {}).get('eggGroups', [])
        if groups and 'EGG_GROUP_UNDISCOVERED' not in groups:
            egg = base(species)
            if egg in INCENSE and INCENSE[egg] not in items:
                egg = next(t for _, _, t in evolutions[egg])
            if 'breeding' not in via.get(egg, []):
                add(egg, 'breeding'); changed = True

species = sorted(({'id': national[s], 'name': s, 'via': sorted(v), **({'onePerSave': sorted(k for k in ONE_PER_SAVE if s in SOURCES[k][0])} if any(s in SOURCES[k][0] for k in ONE_PER_SAVE) else {})}
                  for s, v in via.items()), key=lambda x: x['id'])
doc = {'schema': f'pokemon-suite/{VERSION}-catchable/v1',
       'source': {'repository': 'pret/pokefirered', 'commit': 'c75f352304d529f6ba92d4f74b9cf8b5c3810788',
                  'files': ['src/data/wild_encounters.json', 'src/data/pokemon/evolution.h', 'src/data/pokemon/species_info.h',
                            'src/data/ingame_trades.h', 'src/daycare.c', 'src/pokemon.c', 'data/scripts/item_ball_scripts.inc', 'data/maps'],
                  'sources': {k: v[1] for k, v in SOURCES.items()}},
       'excluded': 'Event tickets (Lugia, Ho-Oh, Deoxys), Mew, Celebi, Jirachi, Altering Cave tables 2-9, day/night friendship, Beauty and other-game species.',
       'total': len(species), 'species': species}
output.write_text(json.dumps(doc, indent=1) + '\n')
print(json.dumps({'version': VERSION, 'total': len(species), 'onePerSave': sum(1 for s in species if 'onePerSave' in s),
                  'prizes': prizes, 'trades': trades}))
