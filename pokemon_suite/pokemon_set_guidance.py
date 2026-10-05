"""Per-species competitive set guidance, derived only from each species' own data.

The inputs are the bundled FireRed facts: base stats, types, abilities, the
FireRed/LeafGreen level-up, TM/HM, tutor and Egg movepool, the Gen III type
chart and native move data, and which held items FireRed can supply. No
community set data is bundled (DATA_SOURCES.md); every choice below comes from
a stated rule so the reasons can be shown next to it.

Gen III facts the rules rely on: a move's type decides whether it is physical
or special; at level 100 each 4 EVs add one stat point, so 252/252/4 (508 of
510) spends every useful point; natures raise one stat by 10% and lower another.
"""
from . import gen3_rules as rules
from .pokemon_builder_knowledge import ULTIMATE_MOVES, knowledge

SCHEMA = 'pokemon-suite/set-guidance/v1'
# Damage-rate factors for move effects, with the reason shown to the user.
EFFECT_FACTORS = {
    'EFFECT_EXPLOSION': (0.15, 'faints the user'),
    'EFFECT_RECHARGE': (0.7, 'the user must recharge afterwards'),
    'EFFECT_SOLAR_BEAM': (0.6, 'charges for a turn outside sun'),
    'EFFECT_SEMI_INVULNERABLE': (0.7, 'takes two turns'),
    'EFFECT_TWO_TURNS_ATTACK': (0.6, 'takes two turns'),
    'EFFECT_RAZOR_WIND': (0.6, 'takes two turns'),
    'EFFECT_SKULL_BASH': (0.6, 'takes two turns'),
    'EFFECT_SKY_ATTACK': (0.6, 'takes two turns'),
    'EFFECT_FOCUS_PUNCH': (0.6, 'fails if the user is hit first'),
    'EFFECT_DREAM_EATER': (0.2, 'works only on a sleeping target'),
    'EFFECT_SNORE': (0.1, 'works only while asleep'),
    'EFFECT_FUTURE_SIGHT': (0.6, 'hits two turns later'),
    'EFFECT_ROLLOUT': (0.5, 'weak until it builds up'),
    'EFFECT_RAMPAGE': (0.85, 'locks the user in, then confuses it'),
    'EFFECT_OVERHEAT': (0.7, 'sharply lowers the user’s Sp. Atk after each use'),
    'EFFECT_SUPERPOWER': (0.95, 'lowers the user’s Attack and Defense'),
    'EFFECT_DOUBLE_EDGE': (0.9, 'recoil'),
    'EFFECT_RECOIL': (0.9, 'recoil'),
    'EFFECT_FAKE_OUT': (0.3, 'works only on the first turn'),
    'EFFECT_TRAP': (0.8, 'weak binding damage'),
    'EFFECT_FALSE_SWIPE': (0.6, 'cannot knock out'),
    'EFFECT_ERUPTION': (0.9, 'weaker as the user’s HP falls'),
    'EFFECT_THIEF': (0.9, None),
}
MULTI_HIT = {'EFFECT_MULTI_HIT': 3.0, 'EFFECT_DOUBLE_HIT': 2.0, 'EFFECT_TWINEEDLE': 2.0, 'EFFECT_TRIPLE_KICK': 2.35}
# Variable-power moves with a sensible rating; others (Flail, Low Kick, Present, Counter…) are not rated as attacks.
VARIABLE_POWER = {'EFFECT_RETURN': (102, 'at maximum friendship'), 'EFFECT_HIDDEN_POWER': (70, 'with the right IVs'),
                  'EFFECT_MAGNITUDE': (71, 'average power')}
EXCLUDED_ATTACKS = {'EFFECT_OHKO', 'EFFECT_LEVEL_DAMAGE', 'EFFECT_COUNTER', 'EFFECT_MIRROR_COAT', 'EFFECT_FLAIL', 'EFFECT_LOW_KICK',
                    'EFFECT_PRESENT', 'EFFECT_PSYWAVE', 'EFFECT_SUPER_FANG', 'EFFECT_ENDEAVOR', 'EFFECT_SONICBOOM', 'EFFECT_DRAGON_RAGE',
                    'EFFECT_BIDE', 'EFFECT_SPIT_UP', 'EFFECT_FRUSTRATION', 'EFFECT_REVENGE', 'EFFECT_BEAT_UP', 'EFFECT_STRUGGLE'}
SETUP = {
    'EFFECT_ATTACK_UP_2': ('physical', 3, 'doubles Attack in one turn'),
    'EFFECT_DRAGON_DANCE': ('physical', 4, 'raises Attack and Speed'),
    'EFFECT_BULK_UP': ('physical', 3, 'raises Attack and Defense'),
    'EFFECT_CURSE': ('physical-slow', 3, 'raises Attack and Defense at the cost of Speed'),
    'EFFECT_CALM_MIND': ('special', 4, 'raises Sp. Atk and Sp. Def'),
    'EFFECT_SPECIAL_ATTACK_UP_2': ('special', 3, 'sharply raises Sp. Atk'),
    'EFFECT_SPEED_UP_2': ('any', 2, 'doubles Speed'),
}
RECOVERY = {'EFFECT_RESTORE_HP', 'EFFECT_SOFTBOILED', 'EFFECT_MORNING_SUN', 'EFFECT_SYNTHESIS', 'EFFECT_MOONLIGHT', 'EFFECT_WISH', 'EFFECT_REST'}
STATUS = [('EFFECT_WILL_O_WISP', 'burns the target, halving its Attack'), ('EFFECT_TOXIC', 'badly poisons the target'),
          ('EFFECT_PARALYZE', 'paralyzes the target, quartering its Speed'), ('EFFECT_LEECH_SEED', 'drains HP every turn'),
          ('EFFECT_SLEEP', 'puts the target to sleep')]
UTILITY = [('EFFECT_SPIKES', 'damages foes that switch in'), ('EFFECT_RAPID_SPIN', 'clears Spikes and binding moves'),
           ('EFFECT_HEAL_BELL', 'cures the team’s status'), ('EFFECT_REFLECT', 'halves physical damage for five turns'),
           ('EFFECT_LIGHT_SCREEN', 'halves special damage for five turns'), ('EFFECT_ROAR', 'forces the foe to switch'),
           ('EFFECT_HAZE', 'removes every stat change'), ('EFFECT_BATON_PASS', 'passes boosts to a teammate'),
           ('EFFECT_PROTECT', 'blocks a turn of attacks'), ('EFFECT_SUBSTITUTE', 'blocks status behind a decoy'),
           ('EFFECT_ENCORE', 'locks the foe into its last move')]
ABILITY_NOTES = {
    'Huge Power': (5, 'doubles Attack'), 'Pure Power': (5, 'doubles Attack'), 'Wonder Guard': (5, 'only super-effective moves hit'),
    'Shadow Tag': (4, 'foes cannot switch out'), 'Speed Boost': (4, 'raises Speed every turn'), 'Levitate': (4, 'immune to Ground moves'),
    'Intimidate': (4, 'lowers the foe’s Attack on entry'), 'Drought': (4, 'summons sun'), 'Drizzle': (4, 'summons rain'),
    'Sand Stream': (4, 'summons a sandstorm'), 'Arena Trap': (3, 'grounded foes cannot switch out'), 'Swift Swim': (3, 'doubles Speed in rain'),
    'Chlorophyll': (3, 'doubles Speed in sun'), 'Thick Fat': (3, 'halves Fire and Ice damage'), 'Natural Cure': (3, 'cures status on switching out'),
    'Serene Grace': (3, 'doubles added-effect chances'), 'Flash Fire': (3, 'immune to Fire moves'), 'Water Absorb': (3, 'heals from Water moves'),
    'Volt Absorb': (3, 'heals from Electric moves'), 'Guts': (3, 'Attack rises when statused'), 'Marvel Scale': (2, 'Defense rises when statused'),
    'Shed Skin': (2, 'may cure its status each turn'), 'Clear Body': (2, 'blocks stat drops'), 'White Smoke': (2, 'blocks stat drops'),
    'Inner Focus': (2, 'cannot flinch'), 'Pressure': (2, 'foes use extra PP'), 'Rough Skin': (2, 'hurts contact attackers'),
    'Static': (2, 'may paralyze contact attackers'), 'Flame Body': (2, 'may burn contact attackers'), 'Effect Spore': (2, 'may afflict contact attackers'),
    'Poison Point': (2, 'may poison contact attackers'), 'Synchronize': (2, 'passes burn, poison or paralysis back'),
    'Trace': (2, 'copies the foe’s ability'), 'Magnet Pull': (2, 'Steel foes cannot switch out'), 'Compound Eyes': (2, 'raises accuracy by 30%'),
    'Soundproof': (2, 'immune to sound moves'), 'Insomnia': (2, 'cannot fall asleep'), 'Vital Spirit': (2, 'cannot fall asleep'),
    'Limber': (2, 'cannot be paralyzed'), 'Immunity': (2, 'cannot be poisoned'), 'Water Veil': (2, 'cannot be burned'),
    'Cloud Nine': (2, 'negates weather'), 'Air Lock': (2, 'negates weather'), 'Sturdy': (1, 'immune to one-hit KO moves'),
    'Battle Armor': (1, 'blocks critical hits'), 'Shell Armor': (1, 'blocks critical hits'), 'Hustle': (1, 'more Attack, less accuracy'),
    'Truant': (0, 'acts only every other turn'), 'Run Away': (0, 'no battle effect'), 'Pickup': (0, 'no battle effect'),
    'Illuminate': (0, 'no battle effect'), 'Honey Gather': (0, 'no battle effect'), 'Stench': (0, 'no battle effect'),
}
TYPE_BOOSTERS = {'normal': 217, 'fighting': 207, 'flying': 210, 'poison': 211, 'ground': 203, 'rock': 204, 'bug': 188, 'ghost': 213,
                 'steel': 199, 'fire': 215, 'water': 209, 'grass': 205, 'electric': 208, 'psychic': 214, 'ice': 212, 'dragon': 216,
                 'dark': 206}
SPECIES_ITEMS = {25: (202, 'doubles Pikachu’s Sp. Atk'), 104: (224, 'doubles Cubone’s Attack'), 105: (224, 'doubles Marowak’s Attack'),
                 113: (222, 'raises Chansey’s critical-hit ratio'), 83: (225, 'raises Farfetch’d’s critical-hit ratio'),
                 132: (223, 'raises Ditto’s Defense'), 366: (192, 'doubles Clamperl’s Sp. Atk'), 380: (191, 'raises Latias’s Sp. Atk and Sp. Def'),
                 381: (191, 'raises Latios’s Sp. Atk and Sp. Def')}
LEFTOVERS, LUM_BERRY, CHOICE_BAND, WHITE_HERB = 200, 141, 186, 180
TUTOR_LOCATIONS = {5: 'Route 4', 25: 'Route 4', 14: 'Seven Island', 34: 'Four Island', 38: 'Victory Road', 68: 'Celadon Dept. Store',
                   69: 'Pewter Museum', 102: 'Saffron City (costs a Poké Doll)', 118: 'Cinnabar Pokémon Lab', 135: 'Celadon City',
                   138: 'Viridian City', 86: 'Silph Co.', 153: 'Mt. Ember', 157: 'Rock Tunnel', 164: 'Fuchsia City',
                   307: 'Cape Brink (Charizard, max friendship)', 308: 'Cape Brink (Blastoise, max friendship)',
                   338: 'Cape Brink (Venusaur, max friendship)'}
STAT_ORDER = rules.STATS


def _stats(species):
    return {s: species['stats'][rules.DEX_KEYS[s]] for s in STAT_ORDER}


def _source_label(k, entry, species_id):
    method = entry['method']
    by = '' if entry['species'] == species_id else f' as {k.name(entry["species"])}'
    if method == 'level-up':
        level = entry['level'] or 1
        if entry['species'] == species_id:
            return f'Level {level} (or the Two Island move reminder once past it)'
        return f'Level {level}{by}, before it evolves'
    if method == 'machine':
        return entry['machine'] or 'TM/HM'
    if method == 'tutor':
        return 'Move tutor, ' + TUTOR_LOCATIONS.get(entry.get('moveId'), 'Kanto') + ' (once per save)'
    if method == 'egg':
        return f'Egg move: breed{by} with a father that knows it'
    return method


def movepool(species_id, k):
    """FireRed-obtainable moves for the species: move id -> the most convenient source."""
    rank = {'machine': 0, 'level-up': 1, 'tutor': 2, 'egg': 3}
    pool = {}
    for move_id, entries in k.learn_sources(species_id).items():
        usable = [dict(e, moveId=move_id) for e in entries if e['game'] in ('firered', 'leafgreen')]
        if move_id in ULTIMATE_MOVES and ULTIMATE_MOVES[move_id] != species_id:
            continue
        if not usable or k.move(move_id) is None:
            continue
        own = [e for e in usable if e['species'] == species_id]
        best = min(own or usable, key=lambda e: (rank.get(e['method'], 9), e['level'] or 0))
        pool[move_id] = {**best, 'label': _source_label(k, best, species_id), 'needsNewIndividual': best['method'] == 'egg' or (
            best['method'] == 'level-up' and best['species'] != species_id)}
    return pool


def _attack_rating(move, species_types, attack_stat):
    """Expected damage rate of an attacking move for this species, or None."""
    effect = move['effect']
    if effect in EXCLUDED_ATTACKS or move['category'] == 'status':
        return None
    power = move['power']
    note = None
    if effect in VARIABLE_POWER:
        power, note = VARIABLE_POWER[effect]
    elif power <= 1:
        return None
    accuracy = (move['accuracy'] or 100) / 100
    factor, reason = EFFECT_FACTORS.get(effect, (1.0, None))
    hits = MULTI_HIT.get(effect, 1.0)
    stab = 1.5 if move['type'] in species_types else 1.0
    return {'rate': power * hits * accuracy * factor * stab * attack_stat, 'power': power * hits, 'stab': stab > 1,
            'note': reason or note}


def _coverage(k, chosen):
    """Sum over single defending types of the best multiplier times rating."""
    total = 0.0
    for defend in k.types:
        best = 0.0
        for move in chosen:
            best = max(best, k.multiplier(move['type'], [defend]) * move['rating'])
        total += best
    return total


def _hidden_power_options(k, pool, species_types, attack_stat):
    if 237 not in pool:
        return []
    options = []
    for kind in rules.HIDDEN_POWER_TYPES:
        move = {**k.move(237), 'type': kind, 'category': 'physical' if kind in rules.PHYSICAL_TYPES else 'special'}
        rating = _attack_rating(move, species_types, attack_stat[move['category']])
        # Ranked 10% lower than an ordinary move of the same strength: it needs particular IVs.
        options.append({'id': 237, 'name': f'Hidden Power {kind.capitalize()}', 'type': kind, 'category': move['category'],
                        'rating': rating['rate'] * 0.9, 'power': 70, 'stab': rating['stab'], 'hiddenPower': kind,
                        'note': 'needs IVs that give this type and 70 power', 'source': pool[237]})
    return options


def _attackers(k, pool, species, category, allow_new):
    types = species['types']
    stats = _stats(species)
    attack_stat = {'physical': stats['attack'], 'special': stats['spAttack']}
    found = []
    for move_id, source in pool.items():
        if source['needsNewIndividual'] and not allow_new:
            continue
        move = k.move(move_id)
        if move_id == 237 or move['category'] == 'status':
            continue
        rating = _attack_rating(move, types, attack_stat[move['category']])
        if rating and (category is None or move['category'] == category):
            found.append({'id': move_id, 'name': move['name'], 'type': move['type'], 'category': move['category'],
                          'rating': rating['rate'], 'power': rating['power'], 'stab': rating['stab'], 'note': rating['note'],
                          'source': source})
    for option in _hidden_power_options(k, pool, types, attack_stat):
        if category is None or option['category'] == category:
            found.append(option)
    return found


def _pick_attacks(k, candidates, count):
    """Best STAB first, then greedy type coverage (explained per move)."""
    chosen = []
    stab = sorted([c for c in candidates if c['stab']], key=lambda c: -c['rating'])
    if stab:
        first = stab[0]
        chosen.append({**first, 'why': f'Strongest same-type attack ({first["type"].capitalize()}, {first["category"]} in Gen III, '
                                         f'{first["power"]:g} power{"; " + first["note"] if first.get("note") else ""}).'})
        other = [c for c in stab if c['type'] != first['type'] and not (c.get('hiddenPower') and first.get('hiddenPower'))]
        if other and other[0]['rating'] >= 0.6 * first['rating'] and count > 1:
            second = other[0]
            chosen.append({**second, 'why': f'Second same-type attack ({second["type"].capitalize()}, {second["power"]:g} power).'})
    while len(chosen) < count:
        base = _coverage(k, chosen)
        best, gain = None, 0.0
        for c in candidates:
            if any(c['id'] == x['id'] and c.get('hiddenPower') == x.get('hiddenPower') for x in chosen):
                continue
            if c.get('hiddenPower') and any(x.get('hiddenPower') for x in chosen):
                continue
            if any(c['type'] == x['type'] for x in chosen):
                continue
            value = _coverage(k, chosen + [c]) - base
            if value > gain:
                best, gain = c, value
        if best is None or gain < 0.02 * max(base, 1):
            break
        hits = [t for t in k.types if k.multiplier(best['type'], [t]) > 1 and all(k.multiplier(x['type'], [t]) <= 1 for x in chosen)]
        reason = (f'Coverage: super effective against {", ".join(t.capitalize() for t in hits[:5])}' if hits
                  else 'Coverage: widens neutral damage') + f' ({best["power"]:g} power{"; " + best["note"] if best.get("note") else ""}).'
        chosen.append({**best, 'why': reason})
    return chosen


def _utility(k, pool, effects, allow_new, exclude):
    for effect, reason in effects:
        options = [(i, s) for i, s in pool.items() if k.move(i)['effect'] == effect and i not in exclude
                   and (allow_new or not s['needsNewIndividual'])]
        if options:
            move_id, source = min(options, key=lambda item: (item[1]['needsNewIndividual'], -(k.move(item[0])['accuracy'] or 100)))
            move = k.move(move_id)
            return {'id': move_id, 'name': move['name'], 'type': move['type'], 'category': 'status', 'source': source,
                    'why': f'{move["name"]} {reason}.'}
    return None


FALLBACK = ('EFFECT_TRANSFORM', 'EFFECT_SKETCH', 'EFFECT_COUNTER', 'EFFECT_MIRROR_COAT', 'EFFECT_DESTINY_BOND', 'EFFECT_SAFEGUARD',
            'EFFECT_LEVEL_DAMAGE', 'EFFECT_FLAIL', 'EFFECT_SPLASH')


def _fill(k, pool, species, moves, allow_new):
    """Complete a set with the best remaining attacks, then any remaining move the species has."""
    taken = {m['id'] for m in moves}
    remaining = sorted([c for c in _attackers(k, pool, species, None, allow_new) if c['id'] not in taken and not c.get('hiddenPower')],
                       key=lambda c: -c['rating'])
    for option in remaining:
        if len(moves) >= 4:
            break
        if option['type'] in {m.get('type') for m in moves if m.get('category') != 'status'}:
            continue
        moves.append({**option, 'why': f'Extra attack ({option["type"].capitalize()}, {option["power"]:g} power).'})
        taken.add(option['id'])
    for effect in FALLBACK:
        if len(moves) >= 4:
            break
        for move_id, source in sorted(pool.items()):
            move = k.move(move_id)
            if move['effect'] == effect and move_id not in taken and (allow_new or not source['needsNewIndividual']):
                moves.append({'id': move_id, 'name': move['name'], 'type': move['type'], 'category': move['category'],
                              'source': source, 'why': f'One of the few remaining moves {k.name(source["species"])} can use.'})
                taken.add(move_id)
                break
    return moves


def _matchups(k, species):
    types = species['types']
    abilities = {a['name'] for a in species['abilities']}
    result = {'weak': [], 'resist': [], 'immune': []}
    for attack in k.types:
        value = k.multiplier(attack, types)
        if attack == 'ground' and 'Levitate' in abilities and len(abilities) == 1:
            value = 0
        if (attack == 'water' and 'Water Absorb' in abilities or attack == 'electric' and 'Volt Absorb' in abilities or
                attack == 'fire' and 'Flash Fire' in abilities) and len(abilities) == 1:
            value = 0
        if attack in ('fire', 'ice') and 'Thick Fat' in abilities and len(abilities) == 1:
            value /= 2
        if value == 0:
            result['immune'].append({'type': attack, 'multiplier': 0})
        elif value > 1:
            result['weak'].append({'type': attack, 'multiplier': value})
        elif value < 1:
            result['resist'].append({'type': attack, 'multiplier': value})
    result['weak'].sort(key=lambda x: -x['multiplier'])
    return result


def _ability(species):
    abilities = [a for a in species['abilities'] if not a.get('hidden')]
    ranked = sorted(abilities, key=lambda a: -ABILITY_NOTES.get(a['name'], (1, None))[0])
    best = ranked[0]
    score, note = ABILITY_NOTES.get(best['name'], (1, 'no major battle effect noted'))
    why = f'{best["name"]}: {note}.' if note else best['name']
    if len(abilities) > 1:
        other = ranked[1]
        why += f' The other ability, {other["name"]}, ' + (ABILITY_NOTES.get(other['name'], (1, 'has no major battle effect noted'))[1]) + '.'
        why += ' In Gen III the slot is fixed by the PID, so a different ability means a different individual.'
    return {'id': best['id'], 'name': best['name'], 'slot': abilities.index(best), 'why': why, 'choices': len(abilities)}


def _item(k, species_id, role, primary_type, moves):
    obtainable = lambda item: str(item) in k.facts['items']
    def entry(item, why):
        available = obtainable(item)
        return {'nativeId': item, 'name': k.item_name(item), 'obtainableInFireRed': available,
                'why': why + ('' if available else ' Not obtainable in FireRed; it can arrive by trade from Ruby, Sapphire or Emerald.')}
    if species_id in SPECIES_ITEMS:
        item, why = SPECIES_ITEMS[species_id]
        return entry(item, f'{k.item_name(item)} {why}.'), [entry(LEFTOVERS, 'Leftovers restores 1/16 of max HP each turn.')]
    alternatives = []
    if any(m['id'] in (315, 276) for m in moves):  # Overheat, Superpower
        alternatives.append(entry(WHITE_HERB, 'White Herb restores the stats Overheat or Superpower lowered, once.'))
    if role in ('wall', 'tank'):
        return entry(LEFTOVERS, 'Leftovers restores 1/16 of max HP each turn, which suits a Pokémon that stays in.'), alternatives + [
            entry(LUM_BERRY, 'Lum Berry cures one status condition.')]
    booster = TYPE_BOOSTERS.get(primary_type)
    choices = []
    if role == 'physical':
        choices.append(entry(CHOICE_BAND, 'Choice Band raises Attack by 50% but locks the holder into one move.'))
    if booster:
        choices.append(entry(booster, f'{k.item_name(booster)} raises {primary_type.capitalize()} moves by 10%.'))
    choices += [entry(LUM_BERRY, 'Lum Berry cures one status condition, so a sleep or paralysis does not stop the sweep.'),
                entry(LEFTOVERS, 'Leftovers restores 1/16 of max HP each turn.')]
    available = [c for c in choices if c['obtainableInFireRed']]
    first = available[0] if available else choices[0]
    return first, alternatives + [c for c in choices if c is not first]


def _nature(name, why):
    value = rules.nature_by_name(name)
    return {'id': name.lower(), 'name': name, 'raised': value['raised'], 'lowered': value['lowered'], 'why': why}


def _spread(**values):
    evs = {s: 0 for s in STAT_ORDER}
    evs.update(values)
    return evs


def _set(k, species, species_id, role, pool, allow_new):
    stats = _stats(species)
    physical = role in ('physical', 'physical-tank')
    special = role in ('special', 'special-tank')
    fast = stats['speed'] >= 80
    why = []
    if role in ('physical', 'special', 'physical-tank', 'special-tank', 'mixed'):
        category = 'physical' if physical else 'special' if special else None
        candidates = _attackers(k, pool, species, category, allow_new)
        setup = None
        if role in ('physical', 'special', 'physical-tank', 'special-tank'):
            for effect, (kind, _, reason) in sorted(SETUP.items(), key=lambda e: -e[1][1]):
                fits = kind == category or kind == 'any' and stats['speed'] < 100 or kind == 'physical-slow' and physical and not fast
                if not fits:
                    continue
                option = _utility(k, pool, [(effect, reason)], allow_new, set())
                if option:
                    setup = option
                    break
        attacks = _pick_attacks(k, candidates, 3 if setup else 4)
        moves = attacks + ([setup] if setup else [])
        while len(moves) < 4:
            extra = _utility(k, pool, STATUS + UTILITY, allow_new, {m['id'] for m in moves})
            if not extra:
                break
            moves.append(extra)
        moves = _fill(k, pool, species, moves, allow_new)
        primary = attacks[0]['type'] if attacks else species['types'][0]
        if role == 'physical':
            nature = _nature('Jolly', 'Raises Speed and lowers Sp. Atk, which a physical attacker does not use.') if fast else \
                _nature('Adamant', 'Raises Attack and lowers Sp. Atk, which a physical attacker does not use.')
            alt = 'Adamant' if fast else 'Jolly'
            evs = _spread(attack=252, speed=252, hp=4)
            name = 'Physical sweeper' if fast else 'Physical attacker'
            why.append(f'Base Attack {stats["attack"]} is its better attacking stat, and its best same-type attack is physical in Gen III.')
        elif role == 'special':
            nature = _nature('Timid', 'Raises Speed and lowers Attack, which a special attacker does not use.') if fast else \
                _nature('Modest', 'Raises Sp. Atk and lowers Attack, which a special attacker does not use.')
            alt = 'Modest' if fast else 'Timid'
            evs = _spread(spAttack=252, speed=252, hp=4)
            name = 'Special sweeper' if fast else 'Special attacker'
            why.append(f'Base Sp. Atk {stats["spAttack"]} is its better attacking stat, and its best same-type attack is special in Gen III.')
        elif role == 'physical-tank':
            nature, alt = _nature('Adamant', 'Raises Attack and lowers Sp. Atk; Speed is too low to be worth raising.'), 'Brave'
            evs = _spread(hp=252, attack=252, defense=4)
            name = 'Bulky physical attacker'
            why.append(f'Base Speed {stats["speed"]} is low, so HP investment keeps it attacking longer.')
        elif role == 'special-tank':
            nature, alt = _nature('Modest', 'Raises Sp. Atk and lowers Attack; Speed is too low to be worth raising.'), 'Quiet'
            evs = _spread(hp=252, spAttack=252, spDefense=4)
            name = 'Bulky special attacker'
            why.append(f'Base Speed {stats["speed"]} is low, so HP investment keeps it attacking longer.')
        else:
            lower = 'spDefense' if stats['defense'] >= stats['spDefense'] else 'defense'
            nature_name = ('Naive' if lower == 'spDefense' else 'Hasty') if fast else ('Lonely' if lower == 'defense' else 'Naughty')
            nature = _nature(nature_name, f'Raises {"Speed" if fast else "Attack"} and lowers {rules.STAT_LABELS[lower]}, its weaker defense, '
                                          'because both attacking stats are used.')
            alt = None
            evs = _spread(speed=252, attack=128, spAttack=128) if fast else _spread(hp=252, attack=128, spAttack=128)
            name = 'Mixed attacker'
            why.append(f'Base Attack {stats["attack"]} and Sp. Atk {stats["spAttack"]} are close, and both categories have good moves.')
        item, alternatives = _item(k, species_id, role if role in ('physical', 'special') else 'tank', primary, moves)
    else:
        defense_stat = 'defense' if role == 'physical-wall' else 'spDefense'
        other = 'spDefense' if defense_stat == 'defense' else 'defense'
        uses = 'attack' if stats['attack'] >= stats['spAttack'] else 'spAttack'
        unused = 'spAttack' if uses == 'attack' else 'attack'
        names = {('defense', 'attack'): 'Impish', ('defense', 'spAttack'): 'Bold', ('spDefense', 'attack'): 'Careful',
                 ('spDefense', 'spAttack'): 'Calm'}
        nature_name = names[(defense_stat, unused)]
        nature = _nature(nature_name, f'Raises {rules.STAT_LABELS[defense_stat]} and lowers {rules.STAT_LABELS[unused]}, the attacking stat it does not use.')
        alt = None
        evs = _spread(hp=252, **{defense_stat: 252, other: 4})
        name = 'Physical wall' if role == 'physical-wall' else 'Special wall'
        why.append(f'Base HP {stats["hp"]} with {rules.STAT_LABELS[defense_stat]} {stats[defense_stat]} makes it hard to knock out.')
        moves = []
        recovery = _utility(k, pool, [(e, 'restores HP') for e in sorted(RECOVERY - {'EFFECT_REST'})] + [('EFFECT_REST', 'fully restores HP and cures status, then sleeps two turns')], allow_new, set())
        if recovery:
            moves.append(recovery)
        attacks = _pick_attacks(k, _attackers(k, pool, species, 'physical' if uses == 'attack' else 'special', allow_new), 1)
        moves += attacks
        for effects in (STATUS, UTILITY):
            extra = _utility(k, pool, effects, allow_new, {m['id'] for m in moves})
            if extra and len(moves) < 4:
                moves.append(extra)
        while len(moves) < 4:
            extra = _utility(k, pool, UTILITY, allow_new, {m['id'] for m in moves})
            if not extra:
                more = _pick_attacks(k, [c for c in _attackers(k, pool, species, None, allow_new) if c['id'] not in {m['id'] for m in moves}], 1)
                if not more:
                    break
                extra = more[0]
            moves.append(extra)
        moves = _fill(k, pool, species, moves, allow_new)
        primary = species['types'][0]
        item, alternatives = _item(k, species_id, 'wall', primary, moves)
    hidden = next((m['hiddenPower'] for m in moves if m.get('hiddenPower')), None)
    focus = [s for s, v in evs.items() if v >= 128]
    return {
        'id': f'{role}', 'role': role, 'name': name, 'summary': why[0] if why else '',
        'nature': nature, 'natureAlternative': alt, 'evs': evs,
        'evsWhy': 'Each 4 EVs add one stat point at level 100; 252 is the useful maximum per stat and 510 the total, so '
                  f'{" / ".join(f"{v} {rules.STAT_LABELS[s]}" for s, v in evs.items() if v)} uses every useful point.',
        'ivs': {}, 'ivPriority': focus, 'hiddenPower': {'type': hidden} if hidden else None,
        'moves': [{**{key: m.get(key) for key in ('id', 'name', 'type', 'category', 'why', 'hiddenPower')},
                   'source': m['source']['label'], 'needsNewIndividual': m['source']['needsNewIndividual']} for m in moves[:4]],
        'item': item, 'itemAlternatives': alternatives[:3], 'level': 100,
        'why': why,
    }


def _roles(stats, pool, species, k):
    physical = _attackers(k, pool, species, 'physical', True)
    special = _attackers(k, pool, species, 'special', True)
    best_physical = max((c['rating'] for c in physical if c['stab'] or not c.get('hiddenPower')), default=0)
    best_special = max((c['rating'] for c in special if c['stab'] or not c.get('hiddenPower')), default=0)
    stab_physical = max((c['rating'] for c in physical if c['stab']), default=0)
    stab_special = max((c['rating'] for c in special if c['stab']), default=0)
    offense = {'physical': max(best_physical, stab_physical), 'special': max(best_special, stab_special)}
    lead = max(offense, key=offense.get)
    roles = []
    slow = stats['speed'] < 60
    if lead == 'physical':
        roles.append('physical-tank' if slow else 'physical')
    else:
        roles.append('special-tank' if slow else 'special')
    low, high = sorted(offense.values())
    if high and low >= 0.85 * high and min(stats['attack'], stats['spAttack']) >= 80:
        roles.append('mixed')
    physical_bulk = stats['hp'] + stats['defense']
    special_bulk = stats['hp'] + stats['spDefense']
    bulk, power = max(physical_bulk, special_bulk), max(stats['attack'], stats['spAttack'])
    if bulk >= 180 or power < 70 and bulk >= 150:
        wall = 'physical-wall' if physical_bulk >= special_bulk else 'special-wall'
        if power < 60:
            roles = [wall]
        elif bulk / 2 >= power + 20:
            roles.insert(0, wall)
        else:
            roles.append(wall)
    return roles, offense


def guidance(species_id, k=None):
    """Explained set guidance for one National Dex species (1–386)."""
    k = k or knowledge()
    species = k.species(species_id)
    stats = _stats(species)
    pool = movepool(species_id, k)
    roles, offense = _roles(stats, pool, species, k)
    sets = [_set(k, species, species_id, role, pool, allow_new=True) for role in roles]
    evolutions = [r['speciesId'] for r in k.children.get(species_id, [])]
    notes = []
    if evolutions:
        notes.append(f'{species["name"]} evolves into {", ".join(k.name(e) for e in evolutions)}; the evolved form has higher base stats.')
    if any(m['needsNewIndividual'] for s in sets for m in s['moves']):
        notes.append('Moves marked as Egg moves or pre-evolution moves have to be learned by a new individual.')
    bst = sum(stats.values())
    speed = stats['speed']
    tier = 'fast' if speed >= 100 else 'medium' if speed >= 70 else 'slow'
    return {
        'schema': SCHEMA, 'speciesId': species_id, 'name': species['name'], 'types': species['types'],
        'stats': stats, 'baseStatTotal': bst, 'speedTier': tier,
        'abilities': [{'id': a['id'], 'name': a['name'], 'note': ABILITY_NOTES.get(a['name'], (1, None))[1]} for a in species['abilities'] if not a.get('hidden')],
        'ability': _ability(species), 'matchups': _matchups(k, species),
        'offense': {'physical': round(offense['physical']), 'special': round(offense['special'])},
        'fullyEvolved': not evolutions, 'evolvesInto': [{'id': e, 'name': k.name(e)} for e in evolutions],
        'sets': sets, 'notes': notes,
        'method': ('Derived from this species’ base stats, types, abilities, FireRed/LeafGreen movepool and the Gen III type chart. '
                   'No community set data is used; each choice lists its reason.'),
    }
