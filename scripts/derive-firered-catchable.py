"""Derive the species a FireRed player can register without another game or an event.

Reads a local pret/pokefirered checkout (commit c75f3523) and writes
engine/firered/src/suite/firered-catchable.json. The goal set is the closure of:

- FireRed wild tables (src/data/wild_encounters.json, `_FireRed` tables), except
  Altering Cave tables 2-9: only the Mystery Event script changes
  VAR_ALTERING_CAVE_WILD_SET (data/mystery_event_msg.s), so they are events;
- the cartridge's gifts, static encounters, fossils, starters, roaming beasts and
  FireRed in-game trades (cited below);
- evolution by methods FireRed can perform: level, friendship, stat-branch level,
  items the cartridge provides (item balls, hidden items, marts, gifts, held items
  of FireRed wild species), and trades (a FireRed-to-FireRed trade). Day/night
  friendship is compiled out (src/pokemon.c GetEvolutionTargetSpecies), and Beauty
  cannot be raised in FireRed;
- Day Care breeding (src/daycare.c GetEggSpecies; Wynaut and Azurill need the
  incense held, AlterEggSpeciesWithIncenseItem).

One-per-save choices (the starters, the two Mt. Moon fossils, the roaming beasts,
the Dojo gift) are all catchable in FireRed; a single save gets one of each, the
others need another FireRed save. Excluded: event tickets (Lugia, Ho-Oh, Deoxys),
Mew, Celebi, Jirachi and everything only in other games.
"""
import argparse, json, pathlib, re

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('source', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('engine/firered/src/suite/firered-catchable.json'))
args = parser.parse_args()
root = args.source
text = lambda p: (root / p).read_text()

national = {}
for i, name in enumerate(re.findall(r'^\s*NATIONAL_DEX_(\w+),', text('include/constants/pokedex.h'), re.M)):
    if 1 <= i <= 386:
        national[name] = i  # NATIONAL_DEX_NONE is 0; OLD_UNOWN_* follow Deoxys
assert national['BULBASAUR'] == 1 and national['DEOXYS'] == 386, 'national order'

evolutions = {}
for species, body in re.findall(r'\[SPECIES_(\w+)\]\s*=\s*\{(\{.*?\})\},', text('src/data/pokemon/evolution.h'), re.S):
    evolutions[species] = [(m, p, t) for m, p, t in re.findall(r'\{\s*(EVO_\w+)\s*,\s*(\w+)\s*,\s*SPECIES_(\w+)\s*\}', body)]

info = {}
for species, body in re.findall(r'\[SPECIES_(\w+)\]\s*=\s*\{(.*?)\n    \}', text('src/data/pokemon/species_info.h'), re.S):
    groups = re.search(r'\.eggGroups\s*=\s*\{\s*(EGG_GROUP_\w+)\s*,\s*(EGG_GROUP_\w+)\s*\}', body)
    items = [m for m in re.findall(r'\.item(?:Common|Rare)\s*=\s*ITEM_(\w+)', body) if m != 'NONE']
    info[species] = {'eggGroups': list(groups.groups()) if groups else [], 'items': items}

wild = {}
for group in json.loads(text('src/data/wild_encounters.json'))['wild_encounter_groups']:
    for table in group['encounters']:
        label = table.get('base_label', '')
        if not label.endswith('_FireRed'):
            continue
        cave = re.search(r'AlteringCave_(\d+)_FireRed$', label)
        if cave:
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
    body = path.read_text()
    items.update(re.findall(r'\b(?:giveitem|additem|giveitem_msg\s+\w+,)\s*ITEM_(\w+)', body))
    for mart in re.findall(r'pokemart\s+(\w+)', body):
        block = re.search(re.escape(mart) + r':(.*?)(?:\n\n|\Z)', body, re.S)
        if block:
            items.update(re.findall(r'\.2byte ITEM_(\w+)', block.group(1)))
for species in wild:
    items.update(info.get(species, {}).get('items', []))

# Non-wild FireRed sources.
SOURCES = {
    'starter': (['BULBASAUR', 'CHARMANDER', 'SQUIRTLE'], 'data/maps/PalletTown_ProfessorOaksLab/scripts.inc (one per save)'),
    'fossil': (['OMANYTE', 'KABUTO'], 'data/maps/MtMoon_B2F/scripts.inc (one of the two per save), CinnabarIsland_PokemonLab_ExperimentRoom'),
    'amber': (['AERODACTYL'], 'data/maps/PewterCity_Museum_1F/scripts.inc (Old Amber)'),
    'roamer': (['RAIKOU', 'ENTEI', 'SUICUNE'], 'src/roamer.c (one per save, chosen by the starter)'),
    'dojo': (['HITMONLEE', 'HITMONCHAN'], 'data/maps/SaffronCity_Dojo/scripts.inc (one per save)'),
    'gift': (['LAPRAS', 'EEVEE', 'MAGIKARP', 'TOGEPI'], 'SilphCo_7F, CeladonCity_Condominiums_RoofRoom, MtMoon Pokemon Center salesman, FiveIsland_WaterLabyrinth'),
    'prize': (['ABRA', 'CLEFAIRY', 'DRATINI', 'SCYTHER', 'PORYGON'], 'data/maps/CeladonCity_GameCorner_PrizeRoom/scripts.inc (FIRERED)'),
    'static': (['SNORLAX', 'MEWTWO', 'ARTICUNO', 'ZAPDOS', 'MOLTRES', 'ELECTRODE', 'HYPNO'], 'setwildbattle in data/maps/*/scripts.inc'),
    'trade': (['MR_MIME', 'JYNX', 'NIDORAN_F', 'FARFETCHD', 'NIDORINA', 'LICKITUNG', 'ELECTRODE', 'TANGELA', 'SEEL'], 'src/data/ingame_trades.h (FIRERED)'),
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
            # Wynaut and Azurill hatch only while a parent holds the incense;
            # otherwise the Egg is Wobbuffet or Marill (AlterEggSpeciesWithIncenseItem).
            if egg in INCENSE and INCENSE[egg] not in items:
                egg = next(t for _, _, t in evolutions[egg])
            if 'breeding' not in via.get(egg, []):
                add(egg, 'breeding'); changed = True

species = sorted(({'id': national[s], 'name': s, 'via': sorted(v), **({'onePerSave': sorted(k for k in ONE_PER_SAVE if s in SOURCES[k][0])} if any(s in SOURCES[k][0] for k in ONE_PER_SAVE) else {})}
                  for s, v in via.items()), key=lambda x: x['id'])
doc = {'schema': 'pokemon-suite/firered-catchable/v1',
       'source': {'repository': 'pret/pokefirered', 'commit': 'c75f352304d529f6ba92d4f74b9cf8b5c3810788',
                  'files': ['src/data/wild_encounters.json', 'src/data/pokemon/evolution.h', 'src/data/pokemon/species_info.h',
                            'src/data/ingame_trades.h', 'src/daycare.c', 'src/pokemon.c', 'data/scripts/item_ball_scripts.inc', 'data/maps'],
                  'sources': {k: v[1] for k, v in SOURCES.items()}},
       'excluded': 'Event tickets (Lugia, Ho-Oh, Deoxys), Mew, Celebi, Jirachi, Altering Cave tables 2-9, day/night friendship, Beauty and other-game species.',
       'total': len(species), 'species': species}
args.output.write_text(json.dumps(doc, indent=1) + '\n')
print(json.dumps({'total': len(species), 'onePerSave': sum(1 for s in species if 'onePerSave' in s)}))
