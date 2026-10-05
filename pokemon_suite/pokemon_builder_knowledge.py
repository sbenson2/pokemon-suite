"""Indexed game facts for the competitive builder and the legality checker.

Everything comes from bundled data: the FireRed, LeafGreen and Emerald Pokédex
projections (stats, types, abilities, learnsets, encounters), the pret
evolution rules, the FireRed item table and `firered-builder.json`, which
scripts/build-builder-facts.py derives from the pinned bot knowledge pack.
No third-party set data is used (DATA_SOURCES.md).
"""
import json
import threading

from .data_provider import BUNDLED, CURRENT, validate_data
from . import gen3_rules as rules

GAMES = ('firered', 'leafgreen', 'emerald')
# Baby species that hatch from Eggs although their egg group is Undiscovered.
BABIES = frozenset({172, 173, 174, 175, 236, 238, 239, 240, 298, 360})
# Azurill and Wynaut hatch only with an incense in Gen III; without one the
# Egg hatches as Marill or Wobbuffet.
INCENSE_BABIES = {298: 183, 360: 202}
ULTIMATE_MOVES = {338: 3, 307: 6, 308: 9}  # Frenzy Plant, Blast Burn, Hydro Cannon (Cape Brink tutor)
FILES = [('pokedex/firered.json', 'firered'), ('pokedex/leafgreen.json', 'leafgreen'), ('pokedex/emerald.json', 'emerald'),
         ('pokedex/firered-builder.json', 'firered'), ('pokedex/evolution-rules.json', 'firered'), ('pokedex/firered-items.json', 'firered')]
_lock = threading.Lock()
_cache = {}


class Knowledge:
    def __init__(self, dex, facts, evolution, items):
        self.dex = dex
        self.facts = facts
        self.species_by_id = {g: {s['id']: s for s in dex[g]['species']} for g in dex}
        names = {m['id']: m['name'] for m in dex['firered']['moves']}
        self.moves = {}
        for key, (kind, power, accuracy, pp, effect, priority, chance, target) in facts['moves'].items():
            move_id = int(key)
            self.moves[move_id] = {'id': move_id, 'name': names.get(move_id, f'Move {move_id}'), 'type': kind, 'power': power,
                                   'accuracy': accuracy, 'pp': pp, 'effect': effect, 'priority': priority, 'chance': chance,
                                   'target': target, 'category': 'status' if not power else
                                   'physical' if kind in rules.PHYSICAL_TYPES else 'special'}
        self.natures = dex['firered']['natures']
        self.held_items = {h['nativeId']: h for h in dex['firered'].get('heldItems', [])}
        self.item_names = {i['id']: i['name'] for i in items}
        self.evolution = evolution
        self.children = {}
        for rule in evolution:
            self.children.setdefault(rule['fromSpecies'], []).append(rule)
        chart = {}
        for attack, defend, multiplier in facts['typeChart']:
            chart[(attack, defend)] = multiplier
        self.chart = chart
        self.types = facts['types']
        self.tables = facts['wildTables']
        self.met_names = facts['metLocations']
        self._learn = {}

    # Species and evolution lines.
    def species(self, species_id, game='firered'):
        record = self.species_by_id[game].get(species_id)
        if record is None:
            raise ValueError(f'Species {species_id} is not in the {game} Pokédex.')
        return record

    def name(self, species_id):
        return self.species_by_id['firered'].get(species_id, {}).get('name', f'Species {species_id}')

    def parent(self, species_id):
        parent = self.species_by_id['firered'].get(species_id, {}).get('evolvesFrom')
        return parent if parent in self.species_by_id['firered'] else None

    def pre_evolutions(self, species_id):
        chain, current = [], self.parent(species_id)
        while current is not None:
            chain.append(current)
            current = self.parent(current)
        return chain

    def line(self, species_id):
        """The species and its pre-evolutions, oldest last."""
        return [species_id, *self.pre_evolutions(species_id)]

    def base(self, species_id):
        return self.line(species_id)[-1]

    def descendants(self, species_id):
        found, pending = [], [species_id]
        while pending:
            current = pending.pop()
            for rule in self.children.get(current, []):
                if rule['speciesId'] not in found:
                    found.append(rule['speciesId'])
                    pending.append(rule['speciesId'])
        return found

    def evolution_rule(self, parent, child):
        return next((r for r in self.children.get(parent, []) if r['speciesId'] == child), None)

    def evolution_path(self, start, end):
        """Rules from `start` to `end` (a descendant), or None."""
        if start == end:
            return []
        for rule in self.children.get(start, []):
            rest = self.evolution_path(rule['speciesId'], end)
            if rest is not None:
                return [rule, *rest]
        return None

    def hatch_species(self, species_id):
        """(species this line can hatch as, whether any Egg of the line exists).

        The first stage hatches; baby species hatch although Undiscovered;
        Ditto (egg group Ditto) and Undiscovered lines never hatch."""
        base = self.base(species_id)
        options = [base, INCENSE_BABIES[base]] if base in INCENSE_BABIES else [base]
        groups = self.species(base)['eggGroups']
        breedable = base != 132 and (base in BABIES or 'Undiscovered' not in groups)
        return [s for s in options if s in self.line(species_id)], breedable

    def growth(self, species_id):
        return self.facts['growth'].get(str(species_id))

    def ability_count(self, species_id, game='firered'):
        record = self.species_by_id[game].get(species_id) or self.species(species_id)
        return len([a for a in record['abilities'] if not a.get('hidden')])

    def ability_name(self, species_id, ability_num):
        abilities = [a for a in self.species(species_id)['abilities'] if not a.get('hidden')]
        if not abilities:
            return None
        return abilities[min(ability_num, len(abilities) - 1)]['name']

    # Moves.
    def learn_sources(self, species_id):
        """move id -> [{game, species, method, level, machine}] for the species' line in Gen III."""
        if species_id in self._learn:
            return self._learn[species_id]
        sources = {}
        for member in self.line(species_id):
            for game in GAMES:
                record = self.species_by_id[game].get(member)
                if not record:
                    continue
                for entry in record['learnset']:
                    sources.setdefault(entry['moveId'], []).append(
                        {'game': game, 'species': member, 'method': entry['method'], 'level': entry['level'],
                         'machine': entry['machine']})
        self._learn[species_id] = sources
        return sources

    def move(self, move_id):
        return self.moves.get(move_id)

    def move_name(self, move_id):
        return (self.moves.get(move_id) or {}).get('name', f'Move {move_id}')

    def max_pp(self, move_id, bonus):
        base = (self.moves.get(move_id) or {}).get('pp') or 0
        return base + base * 20 * bonus // 100

    # Types.
    def multiplier(self, attack_type, defend_types):
        value = 1.0
        for defend in dict.fromkeys(defend_types):
            value *= self.chart.get((attack_type, defend), 1.0)
        return value

    def item_name(self, native_id):
        return self.item_names.get(native_id, f'Item {native_id}')

    def item_sources(self, native_id):
        entry = self.facts['items'].get(str(native_id))
        return entry['sources'] if entry else []

    def met_location(self, mapsec):
        entry = self.met_names.get(str(mapsec))
        return entry['name'] if entry else None


def knowledge():
    """The current Knowledge, parsed and indexed only when a data file changes.

    Inside a DataProvider snapshot the files are pinned by digest (the same
    package and cache rules as read_data); outside one the bundled files are used.
    """
    snapshot = CURRENT.get()
    if snapshot is None:
        paths = [BUNDLED / name for name, _ in FILES]
        key = tuple((str(p), p.stat().st_mtime_ns, p.stat().st_size) for p in paths)
    else:
        paths = [snapshot.resource_path(name, game) for name, game in FILES]
        key = tuple(p.name for p in paths)
    with _lock:
        if key not in _cache:
            loaded = [validate_data(name, json.loads(path.read_text()), game) for (name, game), path in zip(FILES, paths)]
            dex = dict(zip(GAMES, loaded[:3]))
            facts, evolution, items = loaded[3], loaded[4]['games']['firered'], loaded[5]['items']
            if facts.get('schema') != 'pokemon-suite/builder-facts/v1':
                raise ValueError('The competitive builder facts are missing or use another format.')
            _cache.clear()
            _cache[key] = Knowledge(dex, facts, evolution, items)
        return _cache[key]
