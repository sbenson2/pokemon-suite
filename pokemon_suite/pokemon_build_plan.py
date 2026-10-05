"""Compare a target set with one owned FireRed Pokémon and plan the in-game steps.

Read-only: it reads the inventory record and returns a plan. Steps the bot can
already run carry the exact request for an existing endpoint (EV training and
item collection through /api/pokemon-suite/player-tasks, a new individual
through the goal path); every other step says plainly that it is done by hand.
Nothing here edits a save or game memory.
"""
from . import gen3_rules as rules
from .pokemon_builder_knowledge import knowledge
from .pokemon_legality import check as legality_check
from .pokemon_set_guidance import TUTOR_LOCATIONS, movepool

SCHEMA = 'pokemon-suite/build-plan/v1'
GAME = 'firered'
VITAMINS = {'hp': 63, 'attack': 64, 'defense': 65, 'speed': 66, 'spAttack': 67, 'spDefense': 70}  # native item ids
TM_BASE, HM_BASE = 288, 338  # TM01 = 289, HM01 = 339 (include/constants/items.h)
MOVE_DELETER = 'the Move Deleter in Fuchsia City'
MOVE_REMINDER = 'the Move Reminder on Two Island (one Big Mushroom or two Tiny Mushrooms)'
HM_MOVES = {15, 19, 57, 70, 127, 148, 249, 291}  # Cut, Fly, Surf, Strength, Waterfall, Flash, Rock Smash, Dive
DEFAULT_LIMITS = {'maxEncounters': 1000, 'maxMinutes': 240, 'minBalls': 10, 'maxSpend': 5000}


class PlanError(ValueError):
    pass


def _ev_map(value, label):
    if not isinstance(value, dict) or set(value) != set(rules.STATS):
        raise PlanError(f'{label} needs all six stats.')
    for stat, n in value.items():
        if type(n) is not int or not 0 <= n <= rules.MAX_STAT_EVS:
            raise PlanError(f'{label}: {rules.STAT_LABELS[stat]} must be 0 to 255.')
    if sum(value.values()) > rules.MAX_EVS:
        raise PlanError(f'{label} cannot exceed 510 in total.')
    return dict(value)


def normalize_target(target, k=None):
    """Validate a target set. Keys: speciesId, nature, abilitySlot, ivs, hiddenPower, evs, moves, heldItem, level, shiny."""
    k = k or knowledge()
    allowed = {'speciesId', 'nature', 'abilitySlot', 'ivs', 'hiddenPower', 'evs', 'moves', 'heldItem', 'level', 'shiny'}
    if not isinstance(target, dict) or not set(target) <= allowed or 'speciesId' not in target:
        raise PlanError('Send a target set with speciesId and the traits to build.')
    species_id = target['speciesId']
    if type(species_id) is not int or not 1 <= species_id <= 386:
        raise PlanError('Choose a National Pokédex species from 1 to 386.')
    species = k.species(species_id)
    nature = target.get('nature')
    if nature is not None:
        if not isinstance(nature, str):
            raise PlanError('Choose a nature by name.')
        try:
            nature = rules.nature_by_name(nature)['name'].lower()
        except ValueError as error:
            raise PlanError(str(error)) from error
    slot = target.get('abilitySlot')
    abilities = [a for a in species['abilities'] if not a.get('hidden')]
    if slot is not None and (type(slot) is not int or not 0 <= slot < len(abilities)):
        raise PlanError(f'{species["name"]} has {len(abilities)} ability slot(s).')
    if len(abilities) == 1:
        slot = None
    ivs = target.get('ivs') or {}
    if not isinstance(ivs, dict) or not set(ivs) <= set(rules.STATS):
        raise PlanError('IV ranges use the stats hp, attack, defense, speed, spAttack and spDefense.')
    ranges = {}
    for stat, bounds in ivs.items():
        if not isinstance(bounds, dict) or not set(bounds) <= {'min', 'max'}:
            raise PlanError('Each IV range has a min and/or max.')
        low, high = bounds.get('min', 0), bounds.get('max', 31)
        if type(low) is not int or type(high) is not int or not 0 <= low <= high <= 31:
            raise PlanError(f'{rules.STAT_LABELS[stat]} IVs must be a range within 0–31.')
        if (low, high) != (0, 31):
            ranges[stat] = {'min': low, 'max': high}
    hidden = target.get('hiddenPower')
    if hidden is not None:
        if not isinstance(hidden, dict) or hidden.get('type') not in rules.HIDDEN_POWER_TYPES or not set(hidden) <= {'type', 'minPower'}:
            raise PlanError('Choose a Hidden Power type (not Normal), with an optional minimum power.')
        if hidden.get('minPower') is not None and (type(hidden['minPower']) is not int or not 30 <= hidden['minPower'] <= 70):
            raise PlanError('Minimum Hidden Power is 30 to 70.')
        hidden = {'type': hidden['type'], **({'minPower': hidden['minPower']} if hidden.get('minPower') else {})}
    evs = _ev_map(target.get('evs') or {s: 0 for s in rules.STATS}, 'EV targets')
    moves = target.get('moves') or []
    if not isinstance(moves, list) or len(moves) > 4 or any(type(m) is not int for m in moves) or len(set(moves)) != len(moves):
        raise PlanError('Choose up to four different moves.')
    pool = movepool(species_id, k)
    for move in moves:
        if move not in pool and not (species_id == 235 and k.move(move)):
            raise PlanError(f'{species["name"]} cannot learn {k.move_name(move)} in FireRed or LeafGreen.')
    item = target.get('heldItem')
    if item is not None and (type(item) is not int or item not in k.item_names):
        raise PlanError('Choose a FireRed held item.')
    level = target.get('level', 100)
    if type(level) is not int or not 1 <= level <= 100:
        raise PlanError('Choose a target level from 1 to 100.')
    shiny = target.get('shiny', 'any')
    if shiny not in ('any', 'required'):
        raise PlanError('Shiny is any or required.')
    return {'speciesId': species_id, 'nature': nature, 'abilitySlot': slot, 'ivs': ranges, 'hiddenPower': hidden, 'evs': evs,
            'moves': moves, 'heldItem': item, 'level': level, 'shiny': shiny}


def target_from_guidance(guidance_set, species_id):
    """A target set prefilled from one guidance set."""
    return {'speciesId': species_id, 'nature': guidance_set['nature']['id'], 'abilitySlot': None, 'ivs': {},
            'hiddenPower': guidance_set.get('hiddenPower'), 'evs': dict(guidance_set['evs']),
            'moves': [m['id'] for m in guidance_set['moves']], 'heldItem': (guidance_set.get('item') or {}).get('nativeId'),
            'level': guidance_set.get('level', 100), 'shiny': 'any'}


def _level(record, k):
    growth = k.growth(record['nationalSpeciesId'])
    return rules.level_for_experience(growth, record['experience']) if growth else record.get('level') or 1


def describe(record, k=None, save_ot_id=None):
    """Fixed and changeable traits of one owned individual, with its legality verdict."""
    k = k or knowledge()
    species_id = record['nationalSpeciesId']
    species = k.species(species_id)
    nature = rules.nature(record['personality'])
    level = _level(record, k)
    ivs = record['ivs']
    hidden = rules.hidden_power(ivs)
    shiny = rules.shiny_value(record['personality'], record['otId']) < 8
    legality = legality_check(record, save_ot_id, k)
    met = {'level': record.get('metLevel'), 'location': k.met_location(record['metLocation']) if 'metLocation' in record else None,
           'game': rules.GAMES.get(record.get('metGame')), 'ball': rules.BALLS.get(record.get('ball')),
           'encounter': (legality.get('encounter') or {}).get('label')}
    ot = record['otId']
    ability_num = record.get('abilityNum', 0)
    fixed = [
        {'id': 'species-line', 'label': 'Species line', 'value': ' → '.join(k.name(s) for s in reversed(k.line(species_id))),
         'note': 'Evolution can move it forward; it can never become an earlier stage or another line.'},
        {'id': 'nature', 'label': 'Nature', 'value': nature['name'],
         'note': (f'+{rules.STAT_LABELS[nature["raised"]]}, −{rules.STAT_LABELS[nature["lowered"]]}' if nature['raised'] else 'Neutral')
                 + '. Set by the PID; it never changes.'},
        {'id': 'ivs', 'label': 'IVs', 'value': dict(ivs), 'note': 'Fixed at creation (0–31 each).'},
        {'id': 'hidden-power', 'label': 'Hidden Power', 'value': f'{hidden["type"].capitalize()} {hidden["power"]}',
         'note': 'Follows from the IVs, so it is fixed too.'},
        {'id': 'ability', 'label': 'Ability', 'value': k.ability_name(species_id, ability_num),
         'note': f'Slot {ability_num + 1}, set by the PID in Gen III.'},
        {'id': 'shiny', 'label': 'Shiny', 'value': 'Yes' if shiny else 'No', 'note': 'Set by the PID and the trainer ID.'},
        {'id': 'gender', 'label': 'Gender', 'value': rules.gender(record['personality'], species['genderRate']).capitalize(),
         'note': 'Set by the PID.'},
        {'id': 'trainer', 'label': 'Original trainer', 'value': f'TID {ot & 0xFFFF:05d} · SID {ot >> 16:05d}',
         'note': 'This save' if save_ot_id is not None and ot == save_ot_id else 'Traded in' if save_ot_id is not None else ''},
        {'id': 'met', 'label': 'Met', 'value': met, 'note': 'Location, level, ball and game are recorded once.'},
    ]
    evs = record['evs']
    known = [m for m in record.get('moves') or [] if m]
    changeable = [
        {'id': 'evs', 'label': 'EVs', 'value': dict(evs), 'total': sum(evs.values()),
         'note': 'Raised by battles and vitamins (up to 100 each from vitamins). FireRed cannot lower them.'},
        {'id': 'level', 'label': 'Level', 'value': level, 'note': 'Raised by battles or Rare Candy; it never goes down.'},
        {'id': 'moves', 'label': 'Moves', 'value': [{'id': m, 'name': k.move_name(m)} for m in known],
         'note': f'Level-up, TMs, tutors, {MOVE_REMINDER}, or breeding for Egg moves.'},
        {'id': 'held-item', 'label': 'Held item', 'value': k.item_name(record['heldItem']) if record.get('heldItem') else None,
         'note': 'Given or taken from the Bag at any time.'},
        {'id': 'evolution', 'label': 'Evolution', 'value': [{'id': r['speciesId'], 'name': k.name(r['speciesId']), 'how': _evolution_how(k, r)}
                                                            for r in k.children.get(species_id, [])],
         'note': 'Forward only.'},
        {'id': 'nickname', 'label': 'Nickname', 'value': None,
         'note': 'The Name Rater in Lavender Town renames Pokémon whose original trainer is this save.'},
    ]
    return {'pokemon': _summary(record, k, level), 'fixed': fixed, 'changeable': changeable, 'legality': legality}


def _summary(record, k, level):
    return {'id': record.get('id'), 'fingerprint': record.get('fingerprint'), 'speciesId': record['nationalSpeciesId'],
            'name': k.name(record['nationalSpeciesId']), 'level': level, 'location': record.get('location'),
            'slotId': record.get('slotId'), 'shiny': bool(record.get('shiny'))}


def _evolution_how(k, rule):
    trigger = rule.get('trigger')
    if rule.get('evolutionGame') == 'emerald':
        return 'Level up with high friendship in Emerald (' + ('day' if rule.get('hours') == [12, 24] else 'night') + '), then trade back'
    if rule.get('nativeMethod', '').startswith('EVO_FRIENDSHIP'):
        return 'Level up with friendship 220 or more'
    if trigger == 'level-up':
        extra = {'EVO_LEVEL_ATK_GT_DEF': ' with Attack above Defense', 'EVO_LEVEL_ATK_LT_DEF': ' with Attack below Defense',
                 'EVO_LEVEL_ATK_EQ_DEF': ' with Attack equal to Defense', 'EVO_LEVEL_SILCOON': ' (PID decides Silcoon)',
                 'EVO_LEVEL_CASCOON': ' (PID decides Cascoon)', 'EVO_LEVEL_SHEDINJA': ' with a free party slot'}.get(rule.get('nativeMethod'), '')
        return f'Level {rule.get("level")}{extra}'
    if trigger == 'use-item':
        return 'Use a ' + ((rule.get('item') or {}).get('name') or 'evolution item')
    if trigger == 'trade':
        item = rule.get('heldItem')
        return 'Trade' + (f' while holding {item.get("name")}' if isinstance(item, dict) and item.get('name') else '')
    return trigger or 'Evolution'


def _step(step_id, kind, title, detail, executable=False, task=None, reason=None, optional=False):
    step = {'id': step_id, 'kind': kind, 'title': title, 'detail': detail, 'executable': executable, 'optional': optional}
    if executable:
        step['action'] = {'method': 'POST', 'path': '/api/pokemon-suite/player-tasks', 'body': {'game': GAME, 'action': 'start', 'task': task}}
    else:
        step['manual'] = reason or 'The bot cannot do this step for an existing Pokémon yet; do it in the game.'
    return step


def _move_plan(k, record, target, level_now, species_now):
    """(steps, blockers) for the target moves."""
    steps, blockers = [], []
    known = [m for m in record.get('moves') or [] if m]
    target_species = target['speciesId']
    hatched = record.get('metLevel') == 0
    missing = [m for m in target['moves'] if m not in known]
    now_sources = k.learn_sources(species_now)
    target_sources = k.learn_sources(target_species)
    items = k.facts['items']
    for move in missing:
        name = k.move_name(move)
        options = [o for o in target_sources.get(move, []) if o['game'] in ('firered', 'leafgreen')]
        if target_species == 235 and not options:
            steps.append(_step(f'move-{move}', 'move', f'Sketch {name}', 'Smeargle copies a move it sees with Sketch; the bot does not do this.'))
            continue
        machine = next((o for o in options if o['method'] == 'machine'), None)
        tutor = next((o for o in options if o['method'] == 'tutor'), None)
        own_level = [o for o in options if o['method'] == 'level-up' and o['species'] in (species_now, target_species)]
        pre_level = [o for o in options if o['method'] == 'level-up' and o['species'] not in (species_now, target_species)]
        egg = next((o for o in options if o['method'] == 'egg'), None)
        if machine:
            label = machine['machine'] or 'TM'
            number = int(label[2:]) if label[2:].isdigit() else None
            native = (TM_BASE if label.startswith('TM') else HM_BASE) + number if number else None
            if native and str(native) in items:
                steps.append(_step(f'get-{label.lower()}', 'item', f'Get {label}', f'{label} teaches {name}. TMs are used up in Gen III.',
                                   executable=True, task={'kind': 'item', 'itemId': native, 'quantity': 1}, optional=True))
            steps.append(_step(f'move-{move}', 'move', f'Teach {name} with {label}', f'Use {label} from the Bag on it.'))
            continue
        if tutor:
            where = TUTOR_LOCATIONS.get(move, 'the Kanto move tutor')
            steps.append(_step(f'move-{move}', 'move', f'Learn {name} from the move tutor', f'{where}; each tutor teaches once per save.'))
            continue
        if own_level:
            learn_at = min(o['level'] or 1 for o in own_level)
            stage = next(o['species'] for o in own_level if (o['level'] or 1) == learn_at)
            if stage == species_now and learn_at <= level_now:
                steps.append(_step(f'move-{move}', 'move', f'Relearn {name}', f'It learned or skipped {name} at level {learn_at}; ask {MOVE_REMINDER}.'))
            else:
                who = '' if stage == species_now else f' after evolving into {k.name(stage)}'
                steps.append(_step(f'move-{move}', 'move', f'Learn {name} at level {learn_at}{who}',
                                   'Accept the move when it is offered while leveling, or use the Move Reminder later.'))
            continue
        if pre_level:
            first = min(pre_level, key=lambda o: o['level'] or 1)
            stage, learn_at = first['species'], first['level'] or 1
            if stage in k.descendants(species_now):
                steps.append(_step(f'move-{move}', 'move', f'Learn {name} at level {learn_at} before evolving',
                                   f'Only {k.name(stage)} learns it; evolve into {k.name(stage)} and wait until level {learn_at} before evolving further.'))
            else:
                blockers.append(f'{name} is learned only by {k.name(stage)} (level {learn_at}); this individual has already evolved past it.')
            continue
        if egg:
            if hatched:
                blockers.append(f'{name} is an Egg move; an Egg move is only passed on when the Egg is made, not learned afterwards.')
            else:
                blockers.append(f'{name} is an Egg move; only a bred individual can know it.')
            continue
        blockers.append(f'{name} is not learnable in FireRed.')
    extra = len(known) + len(missing) - 4
    if extra > 0:
        forget = [m for m in known if m not in target['moves']]
        hm = [k.move_name(m) for m in forget if m in HM_MOVES]
        detail = 'Replace ' + ', '.join(k.move_name(m) for m in forget) + ' when learning the new moves.'
        if hm:
            detail += f' HM moves ({", ".join(hm)}) can only be removed by {MOVE_DELETER}.'
        steps.insert(0, _step('forget-moves', 'move', 'Make room for the new moves', detail))
    return steps, blockers


def plan(record, target, k=None, save_ot_id=None, source_id='current'):
    """Fixed vs changeable comparison and ordered in-game steps."""
    k = k or knowledge()
    target = normalize_target(target, k)
    base = describe(record, k, save_ot_id)
    species_now = record['nationalSpeciesId']
    level_now = base['pokemon']['level']
    nature = rules.nature(record['personality'])
    ivs = record['ivs']
    fixed, blockers = [], []

    def compare(check_id, label, current, wanted, ok, blocker=None):
        fixed.append({'id': check_id, 'label': label, 'current': current, 'target': wanted, 'matches': ok})
        if not ok and blocker:
            blockers.append(blocker)

    path = k.evolution_path(species_now, target['speciesId'])
    compare('species-line', 'Species', k.name(species_now), k.name(target['speciesId']), path is not None,
            f'{k.name(species_now)} cannot become {k.name(target["speciesId"])}.')
    if target['nature']:
        compare('nature', 'Nature', nature['name'], target['nature'].capitalize(), nature['name'].lower() == target['nature'],
                f'Nature is {nature["name"]}, not {target["nature"].capitalize()}.')
    if target['abilitySlot'] is not None and path is not None:
        slot = record.get('abilityNum', 0)
        wanted = k.ability_name(target['speciesId'], target['abilitySlot'])
        compare('ability', 'Ability', k.ability_name(target['speciesId'], slot), wanted, slot == target['abilitySlot'],
                f'Ability slot {slot + 1} gives {k.ability_name(target["speciesId"], slot)}, not {wanted}.')
    for stat, bounds in target['ivs'].items():
        ok = bounds['min'] <= ivs[stat] <= bounds['max']
        compare(f'iv-{stat}', f'{rules.STAT_LABELS[stat]} IV', ivs[stat], f'{bounds["min"]}–{bounds["max"]}', ok,
                f'{rules.STAT_LABELS[stat]} IV is {ivs[stat]}, outside {bounds["min"]}–{bounds["max"]}.')
    if target['hiddenPower']:
        hidden = rules.hidden_power(ivs)
        wanted = target['hiddenPower']
        ok = hidden['type'] == wanted['type'] and hidden['power'] >= wanted.get('minPower', 30)
        compare('hidden-power', 'Hidden Power', f'{hidden["type"].capitalize()} {hidden["power"]}',
                f'{wanted["type"].capitalize()}' + (f' {wanted["minPower"]}+' if wanted.get('minPower') else ''), ok,
                f'Hidden Power is {hidden["type"].capitalize()} {hidden["power"]}; the IVs decide it.')
    if target['shiny'] == 'required':
        compare('shiny', 'Shiny', 'Yes' if record.get('shiny') else 'No', 'Yes', bool(record.get('shiny')), 'It is not shiny.')

    steps = []
    evs = record['evs']
    over = [s for s in rules.STATS if evs[s] > target['evs'][s]]
    if over:
        blockers.append('EVs above the target (' + ', '.join(f'{rules.STAT_LABELS[s]} {evs[s]} > {target["evs"][s]}' for s in over) +
                        '). FireRed cannot lower EVs; Emerald’s EV-reducing berries can (trade there and back), or use a new individual.')
    # Items the bot can collect (existing item player task), then the hand steps.
    if path:
        for rule in path:
            how = _evolution_how(k, rule)
            item = rule.get('item') or {}
            if item.get('nativeId') and str(item['nativeId']) in k.facts['items']:
                steps.append(_step(f'get-evolution-item-{item["nativeId"]}', 'item', f'Get a {item["name"]}', f'{how}.', executable=True,
                                   task={'kind': 'item', 'itemId': item['nativeId'], 'quantity': 1}, optional=True))
    move_steps, move_blockers = _move_plan(k, record, target, level_now, species_now)
    blockers += move_blockers
    before = [s for s in move_steps if 'before evolving' in s['title']]
    steps += [s for s in move_steps if s['kind'] == 'item']
    steps += before
    for rule in path or []:
        steps.append(_step(f'evolve-{rule["speciesId"]}', 'evolve', f'Evolve into {k.name(rule["speciesId"])}', _evolution_how(k, rule) + '.',
                           reason='The bot evolves Pokémon only for its own requests and the Pokédex; start this evolution in the game.'))
    ev_needed = [s for s in rules.STATS if target['evs'][s] > evs[s]]
    identity = record.get('fingerprint')
    blockers_now = bool(over)
    if ev_needed:
        detail = ('Trains on wild Pokémon whose EV yield fits the remaining spread, uses owned vitamins, Macho Brace and Pokérus, '
                  'and saves when done. Battles also give experience, so it may level up and learn level-up moves; evolution is cancelled.')
        reason = None
        if source_id != 'current':
            reason = 'Load this save as the current game first; EV training runs in the current save.'
        elif level_now >= 100:
            reason = 'Level 100 Pokémon gain no EVs from battles; only vitamins (up to 100 per stat) remain, used by hand.'
        elif record.get('isEgg') or record.get('identityConflict') or not identity:
            reason = 'This individual cannot be selected for EV training.'
        elif blockers_now:
            reason = 'Some EVs are already above the target.'
        for stat in ev_needed:
            if evs[stat] < 100 and target['evs'][stat] >= evs[stat] + 10:
                count = (min(target['evs'][stat], 100) - evs[stat]) // 10
                if count:
                    steps.append(_step(f'get-vitamin-{stat}', 'item', f'Get {count} {k.item_name(VITAMINS[stat])}',
                                       'Vitamins add 10 EVs each up to 100; EV training uses owned vitamins first.', executable=reason is None,
                                       task={'kind': 'item', 'itemId': VITAMINS[stat], 'quantity': count}, reason=reason, optional=True))
        task = {'kind': 'ev-training', 'fingerprint': identity, 'evs': dict(target['evs']), 'ivRanges': {}}
        spread = ', '.join(f'{rules.STAT_LABELS[s]} {evs[s]}→{target["evs"][s]}' for s in ev_needed)
        steps.append(_step('ev-training', 'ev-training', 'Train EVs', f'{spread}. {detail}', executable=reason is None, task=task, reason=reason))
    if target['level'] > level_now:
        steps.append(_step('level', 'level', f'Raise to level {target["level"]}', f'From level {level_now}: battles or Rare Candies.',
                           reason='The bot has no task that levels a chosen Pokémon; train it in the game (EV training also adds levels).'))
    elif target['level'] < level_now:
        fixed.append({'id': 'level', 'label': 'Level', 'current': level_now, 'target': target['level'], 'matches': False,
                      'note': 'Levels cannot go down; battle facilities scale or cap levels themselves.'})
    steps += [s for s in move_steps if s['kind'] == 'move' and s not in before]
    item = target['heldItem']
    if item and item != record.get('heldItem'):
        name = k.item_name(item)
        if str(item) in k.facts['items']:
            steps.append(_step(f'get-held-{item}', 'item', f'Get {name}', 'Collected or bought where FireRed supplies it.', executable=source_id == 'current',
                               task={'kind': 'item', 'itemId': item, 'quantity': 1},
                               reason=None if source_id == 'current' else 'Load this save as the current game first.', optional=True))
        steps.append(_step(f'hold-{item}', 'held-item', f'Give it {name}', 'Give the item from the Bag.' + (
            '' if str(item) in k.facts['items'] else ' FireRed has no source for it; it has to come by trade from Ruby, Sapphire or Emerald.'),
            reason='The bot does not change held items on a chosen Pokémon; give it in the game.'))
    new_individual_goal = new_individual(k, target, blockers) if blockers else None
    executable = [s for s in steps if s['executable']]
    status = 'ready' if not steps and not blockers else 'new-individual' if blockers else 'changes'
    summary = ('It already matches the target.' if status == 'ready' else
               f'Fixed traits or moves do not match: {blockers[0]}' if blockers else
               f'{len(steps)} step(s); the bot can start {len(executable)}.')
    return {'schema': SCHEMA, 'status': status, 'summary': summary, 'target': target, 'pokemon': base['pokemon'],
            'fixed': fixed, 'traits': {'fixed': base['fixed'], 'changeable': base['changeable']}, 'legality': base['legality'],
            'steps': steps, 'blockers': blockers, 'newIndividual': new_individual_goal,
            'counts': {'steps': len(steps), 'executable': len(executable), 'manual': len(steps) - len(executable)},
            'readOnly': True}


def new_individual(k, target, reasons):
    """A goal for a fresh individual with the fixed traits, through the shared request/goal path."""
    species = k.species(target['speciesId'])
    abilities = [a for a in species['abilities'] if not a.get('hidden')]
    dex_key = rules.DEX_KEYS
    minimum = {dex_key[s]: r['min'] for s, r in target['ivs'].items() if r['min'] > 0}
    maximum = {dex_key[s]: r['max'] for s, r in target['ivs'].items() if r['max'] < 31}
    request = {'schema': 'pokemon-suite/farming-request/v1', 'game': GAME, 'speciesId': target['speciesId'], 'quantity': 1,
               'locationId': 'any', 'shiny': target['shiny'], 'natures': [target['nature']] if target['nature'] else [],
               'gender': 'any', 'abilityId': abilities[target['abilitySlot']]['id'] if target['abilitySlot'] is not None else None,
               'ball': {'id': 'any', 'requirement': 'preferred'}, 'minIvs': minimum, 'minDvs': {},
               'encounterLevel': {'min': 1, 'max': 100}, 'finalLevel': None, 'moves': [], 'heldItemId': None,
               'limits': dict(DEFAULT_LIMITS), 'afterCompletion': 'stop-save'}
    if maximum:
        request['maxIvs'] = maximum
    if target['hiddenPower']:
        request['hiddenPower'] = dict(target['hiddenPower'])
    steps = [{'kind': 'farming', 'request': request}]
    if any(target['evs'].values()):
        steps.append({'kind': 'player-task', 'action': 'start',
                      'task': {'kind': 'ev-training', 'fingerprint': {'$ref': 'steps[0].result.fingerprint'}, 'evs': dict(target['evs']), 'ivRanges': {}}})
    traits = [t for t in [target['nature'].capitalize() if target['nature'] else None,
                          f'Hidden Power {target["hiddenPower"]["type"].capitalize()}' if target['hiddenPower'] else None,
                          'shiny' if target['shiny'] == 'required' else None] if t]
    text = f'Competitive builder: {" ".join(traits + [species["name"]])}'.strip()
    goal = {'schema': 'pokemon-suite/goal/v1', 'game': GAME, 'save': {'mode': 'current-if-able'},
            'source': {'text': text, 'via': 'ui'}, 'steps': steps}
    moves = [k.move_name(m) for m in target['moves']]
    notes = ['The hunt filters the game’s own random outcomes for the nature, IVs, Hidden Power and ability; it never edits the Pokémon.',
             'Moves, level and held item are planned again once it is caught' + (f' ({", ".join(moves)}).' if moves else '.')]
    pool = movepool(target['speciesId'], k)
    bred = [k.move_name(m) for m in target['moves'] if (pool.get(m) or {}).get('method') == 'egg']
    if bred:
        notes.append(f'{", ".join(bred)} {"is an Egg move" if len(bred) == 1 else "are Egg moves"}: the hunt catches a Pokémon, '
                     'so breeding one with the move is a separate step the bot does not plan.')
    return {'reasons': reasons, 'goal': goal, 'preview': {'path': '/api/pokemon-farming/preview', 'body': request},
            'commit': {'path': '/api/pokemon-suite/requests/commit', 'body': {'goal': goal}}, 'notes': notes}

