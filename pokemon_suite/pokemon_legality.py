"""Read-only Generation III legality checker for owned FireRed Pokémon.

It reads the inventory records the engine decodes from the save and never
writes a Pokémon, a save or game memory. The checks and their categories follow
PKHeX's legality analysis (CheckIdentifier and Severity); the rules themselves
are clean-room implementations of the cartridge behavior in pret/pokefirered,
checked against the bundled knowledge pack. PKHeX is GPL and is not linked or
copied; it is cited as the reference for which checks exist.
"""
from . import gen3_rules as rules
from .pokemon_builder_knowledge import ULTIMATE_MOVES, knowledge

SCHEMA = 'pokemon-suite/legality/v1'
VALID, FISHY, INVALID, UNKNOWN = 'valid', 'fishy', 'invalid', 'unknown'
VERDICTS = {'legal': 'Legal', 'suspicious': 'Suspicious', 'illegal': 'Illegal', 'unknown': 'Can’t tell'}
PKHEX = 'https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/'
CITATIONS = {
    'categories': PKHEX + 'Legality/Structures/CheckIdentifier.cs',
    'severity': PKHEX + 'Legality/Structures/Severity.cs',
    'methods': PKHEX + 'Legality/RNG/MethodFinder.cs',
    'wild': PKHEX + 'Legality/Encounters/Templates/Gen3/EncounterSlot3.cs',
    'static': PKHEX + 'Legality/Encounters/Templates/Gen3/EncounterStatic3.cs',
    'egg': PKHEX + 'Legality/Encounters/Templates/Gen3/EncounterEgg3.cs',
    'trade': PKHEX + 'Legality/Encounters/Templates/Gen3/EncounterTrade3.cs',
    'evs': PKHEX + 'Legality/Verifiers/EffortValueVerifier.cs',
    'ball': PKHEX + 'Legality/Verifiers/Ball/BallUseLegality.cs',
    'egg-discussion': 'https://github.com/kwsch/PKHeX/discussions/3895',
    'pid-iv': 'https://www.smogon.com/ingame/rng/pid_iv_creation',
    'wild-generation': rules.PRET + 'src/wild_encounter.c',
    'roamer': rules.PRET + 'src/pokemon.c',
    'daycare': rules.PRET + 'src/daycare.c',
    'trades': rules.PRET + 'src/data/ingame_trades.h',
    'experience': rules.PRET + 'src/data/pokemon/experience_tables.h',
    'structure': rules.PRET + 'include/pokemon.h',
}
FRLG_SECTIONS = range(0x58, 0xC5)  # MAPSEC_PALLET_TOWN … MAPSEC_SPECIAL_AREA
SAFARI_ZONE = 0x88
# Wild and static catches take any Gen III ball except the Safari Ball, which
# only the Safari Zone uses (PKHeX WildPokeBalls3).
TRADE_ONLY_BALLS = {7, 12}  # Dive and Premier: no FireRed/LeafGreen source; arrive by trade from R/S/E
CONTEST = ('Cool', 'Beauty', 'Cute', 'Smart', 'Tough')
SINGLE_RIBBONS = {15: 'Champion', 16: 'Winning', 17: 'Victory', 18: 'Artist', 19: 'Effort', 20: 'Marine', 21: 'Land',
                  22: 'Sky', 23: 'Country', 24: 'National', 25: 'Earth', 26: 'World'}
EVENT_RIBBONS = {'Marine', 'Land', 'Sky', 'Country', 'World'}
HOENN_RIBBONS = {'Winning', 'Victory', 'Artist', 'Effort'}
SMEARGLE, STRUGGLE = 235, 165


def _result(check_id, category, severity, message, cite=None):
    entry = {'id': check_id, 'category': category, 'severity': severity, 'message': message}
    if cite:
        entry['cite'] = CITATIONS[cite]
    return entry


def _game_key(met_game):
    return {4: 'firered', 5: 'leafgreen'}.get(met_game)


def _location_name(k, mapsec):
    return k.met_location(mapsec) or f'map section {mapsec}'


class _Subject:
    """The fields of one inventory record the checks use."""

    def __init__(self, record, k):
        self.record = record
        self.species = record.get('nationalSpeciesId')
        self.name = k.name(self.species)
        self.pid = record['personality']
        self.ot = record['otId']
        self.ivs = record['ivs']
        self.evs = record['evs']
        self.moves = list(record.get('moves') or [])
        self.pp = list(record.get('pp') or [])
        self.met_level = record.get('metLevel')
        self.detailed = 'metLocation' in record and 'metGame' in record
        self.met_location = record.get('metLocation')
        self.met_game = record.get('metGame')
        self.ball = record.get('ball')
        self.growth = k.growth(self.species)
        self.level = rules.level_for_experience(self.growth, record['experience']) if self.growth else record.get('level')
        self.line = k.line(self.species) if self.species else []
        self.hatched = self.met_level == 0


def _encounters(subject, k):
    """Candidate encounters that could have produced this individual."""
    s, facts = subject, k.facts
    found = []
    game = _game_key(s.met_game) if s.detailed else 'firered'
    if s.hatched:
        hatch, breedable = k.hatch_species(s.species)
        if not breedable:
            return [{'kind': 'impossible', 'label': f'{k.name(k.base(s.species))} cannot hatch from an Egg',
                     'reason': f'{s.name} has met level 0 (hatched), but its evolution line never comes from an Egg.'}]
        if s.detailed and s.met_game in (4, 5) and s.met_location not in FRLG_SECTIONS:
            return [{'kind': 'impossible', 'label': 'hatch location',
                     'reason': f'A FireRed/LeafGreen Egg hatches on a Kanto or Sevii map, not at location {s.met_location}.'}]
        for species in hatch:
            found.append({'kind': 'hatched', 'species': species, 'rule': 'egg', 'ball': 'poke', 'fateful': False,
                          'label': f'hatched from an Egg as {k.name(species)}'})
        if 175 in s.line:  # Togepi gift Egg, Water Labyrinth (CreateEgg with a Method 1 PID)
            found.append({'kind': 'gift-egg', 'species': 175, 'rule': 'gift-egg', 'ball': 'poke', 'fateful': False,
                          'label': 'hatched from the Water Labyrinth gift Egg'})
        return found
    if s.detailed and s.met_game not in (4, 5):
        if s.met_game in (1, 2, 3):
            origin = rules.GAMES[s.met_game]
            levels = facts['emeraldSpecies'] if s.met_game == 3 else {}
            seen = [row for member in s.line for row in levels.get(str(member), []) if row[0] <= s.met_level <= row[1]]
            return [{'kind': 'other-game', 'species': s.species, 'rule': 'any-gba', 'ball': 'any', 'fateful': None,
                     'partial': True, 'seen': bool(seen),
                     'label': f'met in {origin} at level {s.met_level}'}]
        return [{'kind': 'unsupported', 'label': f'origin game {rules.GAMES.get(s.met_game, s.met_game)}'}]
    location = s.met_location if s.detailed else None
    if location == 253:
        return [{'kind': 'impossible', 'label': 'unhatched Egg location',
                 'reason': 'The met location says “Egg”, but the Pokémon is not an Egg and has a met level.'}]
    if location == 255:
        return [{'kind': 'fateful-event', 'species': s.species, 'rule': None, 'ball': 'any', 'fateful': None, 'partial': True,
                 'label': 'fateful encounter (event distribution)'}]
    trades = [t for t in facts['trades'] if t['species'] in s.line and game in t['games']]
    for trade in trades:
        if location in (None, 254) and (location == 254 or (s.pid == trade['personality'] and s.ot == trade['otId'])):
            found.append({'kind': 'trade', 'species': trade['species'], 'rule': 'trade', 'ball': 'poke', 'fateful': False,
                          'trade': trade, 'label': f'in-game trade {k.name(trade["species"])}', 'partial': location is None})
    if location == 254:
        return found or [{'kind': 'impossible', 'label': 'in-game trade',
                          'reason': f'No {rules.GAMES.get(s.met_game, "FireRed")} in-game trade gives {s.name} or its pre-evolutions.'}]
    fixed = facts['fixed'] if game == 'firered' else facts['leafgreen']['fixed']
    for entry in fixed:
        if entry['kind'] == 'egg' or entry['species'] not in s.line or entry['level'] != s.met_level:
            continue
        if location is not None and entry['mapsec'] != location:
            continue
        kind = entry['kind']
        found.append({'kind': kind, 'species': entry['species'], 'rule': 'static', 'mapsec': entry['mapsec'],
                      'ball': 'poke' if entry['ball'] == 'poke-ball' else 'wild', 'fateful': entry['fateful'],
                      'partial': location is None,
                      'label': f'{kind} {k.name(entry["species"])} at {_location_name(k, entry["mapsec"])}, level {entry["level"]}'})
    roam = facts['roamers']
    for species in s.line:
        if species in roam['species'] and s.met_level == roam['level'] and (location is None or location in roam['mapsecs']):
            found.append({'kind': 'roamer', 'species': species, 'rule': 'roamer', 'ball': 'wild', 'fateful': False,
                          'partial': location is None, 'mapsec': location,
                          'label': f'roaming {k.name(species)} at level 50'})
    if game == 'firered':
        tables = [t for t in k.tables if (location is None or t['mapsec'] == location) and
                  any(slot[0] in s.line and slot[1] <= s.met_level <= slot[2] for slot in t['slots'])]
        by_species = {}
        for table in tables:
            for slot in table['slots']:
                if slot[0] in s.line and slot[1] <= s.met_level <= slot[2]:
                    by_species.setdefault(slot[0], []).append(table)
        for species, species_tables in by_species.items():
            unique = {id(t): t for t in species_tables}.values()
            mapsecs = sorted({t['mapsec'] for t in unique})
            place = _location_name(k, mapsecs[0]) if len(mapsecs) == 1 else f'{len(mapsecs)} FireRed locations'
            found.append({'kind': 'wild', 'species': species, 'rule': 'wild-unown' if species == 201 else 'wild',
                          'tables': list(unique), 'ball': 'safari' if mapsecs == [SAFARI_ZONE] else 'wild-any' if SAFARI_ZONE in mapsecs else 'wild',
                          'fateful': False, 'partial': location is None, 'mapsec': location,
                          'label': f'wild {k.name(species)} at {place}, level {s.met_level}'})
    else:
        rows = [w for w in facts['leafgreen']['wild'] if w['species'] in s.line and w['minLevel'] <= s.met_level <= w['maxLevel']
                and (location is None or w['mapsec'] == location)]
        for species in sorted({w['species'] for w in rows}):
            mine = [w for w in rows if w['species'] == species]
            safari = all(w['safari'] for w in mine)
            found.append({'kind': 'wild', 'species': species, 'rule': 'wild-unown' if species == 201 else 'wild', 'tables': [],
                          'ball': 'safari' if safari else 'wild-any' if any(w['safari'] for w in mine) else 'wild',
                          'fateful': False, 'partial': location is None, 'mapsec': location,
                          'label': f'wild {k.name(species)} in LeafGreen at {_location_name(k, mine[0]["mapsec"])}, level {s.met_level}'})
    if not found:
        where = f' at {_location_name(k, location)}' if location is not None else ' anywhere'
        origin = 'LeafGreen' if game == 'leafgreen' else 'FireRed'
        found.append({'kind': 'impossible', 'label': 'no matching encounter',
                      'reason': f'{origin} has no {s.name} (or pre-evolution) encounter at level {s.met_level}{where}.'})
    return found


def _slot_index(bounds, roll):
    return next(i for i, bound in enumerate(bounds) if roll % 100 < bound)


def _frame(subject, k, candidate, correlations):
    """Reproduce the wild slot and level from the RNG state before the PID (Method H)."""
    s, facts = subject, k.facts
    unown = candidate['species'] == 201
    tables = candidate.get('tables') or []
    if not tables:
        return None
    thresholds = facts['slotThresholds']
    letter = rules.unown_letter(s.pid)
    best = None
    for corr in correlations:
        if corr['family'] != ('unown' if unown else 'standard'):
            continue
        for slot_roll, level_roll, interrupts, rerolls in rules.wild_frames(corr['pidState'], s.pid, unown=unown):
            for table in tables:
                options = []
                if table['area'] == 'fishing':
                    for rod, spec in thresholds['fishing'].items():
                        options.append((rod, spec['slots'][_slot_index(spec['bounds'], slot_roll)]))
                else:
                    options.append((table['area'], _slot_index(thresholds[table['area']], slot_roll)))
                for area, index in options:
                    species, low, high = table['slots'][index]
                    if species != candidate['species'] or low + level_roll % (high - low + 1) != s.met_level:
                        continue
                    if unown and facts['unownLetterSlots'][table['unownChamber']][index] != letter:
                        continue
                    match = {'map': table['map'], 'mapsec': table['mapsec'], 'area': area, 'slot': index,
                             'interrupts': interrupts, 'rerolls': rerolls, 'method': corr['method']}
                    if best is None or (interrupts, rerolls) < (best['interrupts'], best['rerolls']):
                        best = match
                    if interrupts == 0:
                        return best
    return best


def _pid_checks(subject, k, candidate, correlations):
    s = subject
    rule = candidate.get('rule')
    standard = [c for c in correlations if c['family'] == 'standard']
    names = sorted({c['method'] for c in correlations})
    described = ', '.join(names) if names else 'no correlation'
    out = []
    if rule == 'wild':
        if standard:
            out.append(_result('pid-iv', 'PID', VALID, f'PID and IVs correlate ({", ".join(sorted({c["method"] for c in standard}))}), as FireRed/LeafGreen wild generation produces.', 'wild'))
            frame = _frame(s, k, candidate, standard)
            if frame:
                note = ' with one interrupting call' if frame['interrupts'] else ''
                out.append(_result('rng-frame', 'Encounter', VALID,
                                   f'The RNG state before the PID reproduces {_location_name(k, frame["mapsec"])} {frame["area"]} slot {frame["slot"] + 1} at level {s.met_level}{note}.', 'wild-generation'))
                candidate['frame'] = frame
            elif candidate.get('tables'):
                if candidate.get('partial'):
                    out.append(_result('rng-frame', 'Encounter', UNKNOWN, 'The wild slot could not be reproduced without the met location.', 'wild'))
                else:
                    out.append(_result('rng-frame', 'Encounter', FISHY,
                                       'No RNG frame before the PID reproduces this slot and level (PKHeX: RNG frame not found, Fishy by default).', 'wild'))
        else:
            out.append(_result('pid-iv', 'PID', INVALID, f'PID and IVs do not come from any Gen III wild method ({described}).', 'methods'))
    elif rule == 'wild-unown':
        unown = [c for c in correlations if c['family'] == 'unown']
        if unown:
            out.append(_result('pid-iv', 'PID', VALID, f'Unown PID and IVs correlate ({", ".join(sorted({c["method"] for c in unown}))}).', 'wild'))
            frame = _frame(s, k, candidate, unown)
            letter = rules.unown_letter_name(rules.unown_letter(s.pid))
            if frame:
                out.append(_result('rng-frame', 'Encounter', VALID, f'The RNG reproduces the Tanoby chamber slot for letter {letter}.', 'wild-generation'))
                candidate['frame'] = frame
            elif not candidate.get('partial'):
                chambers = [t for t in candidate.get('tables', []) if 'unownChamber' in t]
                letters = {k.facts['unownLetterSlots'][t['unownChamber']][i] for t in chambers for i in range(12)}
                severity = FISHY if rules.unown_letter(s.pid) in letters else INVALID
                out.append(_result('rng-frame', 'Form', severity, f'Unown {letter} does not match a reproducible slot of this chamber.', 'wild'))
        else:
            out.append(_result('pid-iv', 'PID', INVALID, f'Unown PID and IVs do not match the FireRed Unown method ({described}).', 'wild'))
    elif rule == 'static':
        if any(c['method'] == 'Method 1' for c in standard):
            out.append(_result('pid-iv', 'PID', VALID, 'PID and IVs correlate with Method 1, as FireRed gifts and static encounters produce.', 'static'))
        else:
            out.append(_result('pid-iv', 'PID', INVALID, f'FireRed gifts and static encounters use Method 1 only ({described}).', 'static'))
    elif rule == 'gift-egg':
        methods = {c['method'] for c in standard}
        if 'Method 1' in methods or 'Method 4' in methods:
            out.append(_result('pid-iv', 'PID', VALID, f'PID and IVs correlate ({", ".join(sorted(methods))}) as the Togepi gift Egg is created.', 'static'))
        else:
            out.append(_result('pid-iv', 'PID', INVALID, 'The gift Egg is created with a Method 1 PID and IVs.', 'static'))
    elif rule == 'roamer':
        ok = any(c['method'] == 'Method 1 (roamer)' for c in correlations) or any(
            c['method'] == 'Method 1' and c['family'] == 'standard' for c in correlations) and s.ivs['attack'] < 8 and not any(
            s.ivs[x] for x in ('defense', 'speed', 'spAttack', 'spDefense'))
        if ok:
            out.append(_result('pid-iv', 'PID', VALID, 'Method 1 roamer: only the HP IV and three bits of Attack survive, as the cartridge stores them.', 'roamer'))
        else:
            out.append(_result('pid-iv', 'IVs', INVALID, 'FireRed/LeafGreen roamers keep only the HP IV and the low three bits of Attack; the other IVs must be 0.', 'roamer'))
    elif rule == 'egg':
        if s.pid & 0xFFFF == 0:
            out.append(_result('pid-iv', 'PID', INVALID, 'A bred Egg’s PID low half is never 0 (daycare.c: Random() % 0xFFFE + 1).', 'daycare'))
        elif any(c['method'] in ('Method 1', 'Method 2', 'Method 4') for c in standard):
            out.append(_result('pid-iv', 'PID', FISHY,
                               'This hatched Pokémon’s PID and IVs correlate like a wild or static encounter. PKHeX marks this Invalid for Gen III Eggs; '
                               'the game can produce it, so it is reported as suspicious.', 'egg-discussion'))
        else:
            out.append(_result('pid-iv', 'PID', VALID, 'No PID/IV correlation, as expected: an Egg’s IVs are drawn apart from its PID.', 'egg'))
    elif rule == 'trade':
        trade = candidate['trade']
        wanted = dict(zip(rules.STATS, trade['ivs']))
        problems = []
        if s.pid != trade['personality']:
            problems.append('PID')
        if s.ivs != wanted:
            problems.append('IVs')
        if s.ot != trade['otId']:
            problems.append('trainer ID')
        if subject.record.get('abilityNum') != trade['abilityNum']:
            problems.append('ability slot')
        if problems:
            out.append(_result('pid-iv', 'PID', INVALID, f'In-game trade Pokémon have fixed values; this one differs in {", ".join(problems)}.', 'trades'))
        else:
            out.append(_result('pid-iv', 'PID', VALID, 'PID, IVs, trainer ID and ability match the fixed in-game trade.', 'trades'))
    elif rule == 'any-gba':
        if standard:
            out.append(_result('pid-iv', 'PID', VALID, f'PID and IVs correlate ({", ".join(sorted({c["method"] for c in standard}))}).', 'methods'))
        else:
            out.append(_result('pid-iv', 'PID', UNKNOWN, 'No wild or static correlation; this origin may use a method this checker does not model (events, trades).', 'methods'))
    else:
        out.append(_result('pid-iv', 'PID', UNKNOWN, 'This origin’s PID method is not modeled (event, Colosseum/XD).', 'methods'))
    return out


def _encounter_checks(subject, k, candidate, correlations, save_ot_id):
    s = subject
    out = []
    kind = candidate['kind']
    if kind == 'impossible':
        return [_result('encounter', 'Encounter', INVALID, candidate['reason'])]
    if kind in ('unsupported', 'fateful-event'):
        return [_result('encounter', 'Encounter', UNKNOWN, f'{candidate["label"].capitalize()}: the event and GameCube encounter data are not bundled.')]
    if kind == 'other-game':
        severity = VALID if candidate.get('seen') else UNKNOWN
        message = (f'Met in {rules.GAMES[s.met_game]} at level {s.met_level}; Emerald has {s.name} or a pre-evolution at that level (location not checked).'
                   if candidate.get('seen') else f'Met in {rules.GAMES[s.met_game]}; its encounter tables are not bundled, so the encounter was not checked.')
        out.append(_result('encounter', 'Encounter', severity, message))
    else:
        partial = ' (met location not in this record; matched by species and level)' if candidate.get('partial') else ''
        out.append(_result('encounter', 'Encounter', VALID, candidate['label'][0].upper() + candidate['label'][1:] + partial + '.'))
    out.extend(_pid_checks(s, k, candidate, correlations))
    # Ability slot (CreateBoxMon: abilityNum = personality & 1 only when the species has two abilities).
    origin = candidate.get('species', s.species)
    ability_num = s.record.get('abilityNum', 0)
    if kind != 'trade' and kind not in ('unsupported', 'fateful-event') and s.met_game != 15:
        two = k.ability_count(origin) > 1
        expected = s.pid & 1 if two else 0
        if ability_num == expected:
            out.append(_result('ability', 'Ability', VALID, f'Ability slot {ability_num + 1} ({k.ability_name(s.species, ability_num)}) matches the PID.'))
        else:
            reason = 'the PID’s lowest bit' if two else f'{k.name(origin)} having one ability'
            out.append(_result('ability', 'Ability', INVALID, f'Ability slot {ability_num + 1} does not match {reason}.'))
    # Ball.
    ball = s.ball
    if ball is not None:
        name = rules.BALLS.get(ball, f'ball {ball}')
        rule = candidate.get('ball')
        if ball not in rules.BALLS:
            out.append(_result('ball', 'Ball', INVALID, f'{name} is not a Gen III Poké Ball.', 'ball'))
        elif rule == 'poke':
            severity = VALID if ball == 4 else INVALID
            what = 'Hatched Pokémon, gifts and in-game trades' if kind != 'hatched' else 'Hatched Pokémon'
            out.append(_result('ball', 'Ball', severity, f'{name}. {what} are always in a Poké Ball.' if severity == INVALID else f'{name}, as expected.', 'ball'))
        elif rule == 'safari':
            out.append(_result('ball', 'Ball', VALID if ball == 5 else INVALID,
                               f'{name}. Safari Zone Pokémon are caught in Safari Balls.' if ball != 5 else 'Safari Ball, as the Safari Zone requires.', 'ball'))
        elif rule in ('wild', 'wild-any'):
            if ball == 5 and rule == 'wild':
                out.append(_result('ball', 'Ball', INVALID, 'Safari Balls work only in the Safari Zone.', 'ball'))
            elif ball in TRADE_ONLY_BALLS:
                out.append(_result('ball', 'Ball', VALID, f'{name}: not sold in FireRed/LeafGreen, but it can arrive by trade from Ruby, Sapphire or Emerald.', 'ball'))
            else:
                out.append(_result('ball', 'Ball', VALID, f'{name}.', 'ball'))
    # Fateful encounter flag (bit 31 of the ribbon word).
    fateful = s.record.get('fatefulEncounter')
    if fateful is not None and candidate.get('fateful') is not None:
        if bool(fateful) != candidate['fateful']:
            if candidate['fateful']:
                out.append(_result('fateful', 'Fateful', INVALID, 'Event-island legendaries carry the fateful-encounter flag; this one does not.'))
            else:
                out.append(_result('fateful', 'Fateful', INVALID, 'The fateful-encounter flag is set on an encounter that never sets it.'))
        elif candidate['fateful']:
            out.append(_result('fateful', 'Fateful', VALID, 'Fateful-encounter flag set, as the event islands set it.'))
    # Levels: met level, and level-up evolutions from the encounter species.
    level = s.level
    if level is not None:
        start = candidate.get('species')
        if s.hatched and level < 5:
            out.append(_result('level', 'Level', INVALID, 'Hatched Pokémon start at level 5.'))
        path = k.evolution_path(start, s.species) if start else []
        if start and path is None:
            out.append(_result('evolution', 'Evolution', INVALID, f'{k.name(start)} does not evolve into {s.name}.'))
        for rule in path or []:
            need = rule.get('level') if rule.get('trigger') == 'level-up' else None
            if need and level < need:
                out.append(_result('evolution', 'Evolution', INVALID,
                                   f'{k.name(rule["speciesId"])} evolves at level {need}, but this Pokémon is level {level}.'))
            if rule.get('personalityRemainders') is not None and start == rule['fromSpecies']:
                if (s.pid >> rule['personalityShift']) % rule['personalityModulus'] not in rule['personalityRemainders']:
                    out.append(_result('evolution', 'Evolution', INVALID,
                                       f'Wurmple with this PID evolves into {k.name(rules.wurmple_branch(s.pid))}, not {k.name(rule["speciesId"])}.'))
    # Trainer.
    if save_ot_id is not None:
        tid, sid = s.ot & 0xFFFF, s.ot >> 16
        if kind == 'trade':
            if s.ot == save_ot_id:
                out.append(_result('trainer', 'Trainer', INVALID, 'An in-game trade Pokémon cannot carry this save’s trainer ID.'))
        elif s.ot == save_ot_id:
            if s.detailed and s.met_game not in (4, 5):
                out.append(_result('trainer', 'Trainer', FISHY, f'Met in {rules.GAMES.get(s.met_game, "another game")} but carries this FireRed save’s trainer ID.'))
            else:
                out.append(_result('trainer', 'Trainer', VALID, f'Original trainer is this save (TID {tid:05d}).'))
        else:
            out.append(_result('trainer', 'Trainer', VALID, f'Received in a trade: original trainer TID {tid:05d}, SID {sid:05d}.'))
    return out


def _move_checks(subject, k, hatched):
    s = subject
    out = []
    ids = s.moves + [0] * (4 - len(s.moves))
    if not any(ids):
        return [_result('moves', 'CurrentMove', INVALID, 'The Pokémon knows no moves.')]
    if any(a == 0 and b != 0 for a, b in zip(ids, ids[1:])):
        out.append(_result('moves', 'CurrentMove', INVALID, 'Empty move slots come before a known move; the cartridge keeps moves packed.'))
    known = [m for m in ids if m]
    if len(set(known)) != len(known):
        out.append(_result('moves', 'CurrentMove', INVALID, 'The same move is known twice.'))
    sources = k.learn_sources(s.species)
    level = s.level or 100
    for slot, move in enumerate(ids):
        if not move:
            continue
        name = k.move_name(move)
        if k.move(move) is None:
            out.append(_result(f'move-{slot + 1}', 'CurrentMove', INVALID, f'Move {move} does not exist in Gen III.'))
            continue
        if s.species == SMEARGLE and move != STRUGGLE:
            out.append(_result(f'move-{slot + 1}', 'CurrentMove', VALID, f'{name}: Smeargle can Sketch it.'))
            continue
        if move in ULTIMATE_MOVES:
            ok = ULTIMATE_MOVES[move] == s.species
            out.append(_result(f'move-{slot + 1}', 'CurrentMove', VALID if ok else INVALID,
                               f'{name}: taught only to {k.name(ULTIMATE_MOVES[move])} at Cape Brink.' if not ok else f'{name}: Cape Brink tutor.'))
            continue
        options = sources.get(move, [])
        usable = [o for o in options if o['method'] in ('machine', 'tutor') or (o['method'] == 'level-up' and (o['level'] or 0) <= level)
                  or (o['method'] == 'egg' and hatched)]
        if usable:
            best = min(usable, key=lambda o: (o['game'] != 'firered', o['game'] != 'leafgreen', o['method'] != 'level-up'))
            how = {'machine': best['machine'] or 'TM/HM', 'tutor': 'move tutor', 'egg': 'Egg move (breeding)',
                   'level-up': f'level {best["level"]}' if best['level'] else 'starting move'}[best['method']]
            where = '' if best['game'] == 'firered' else f' in {best["game"].capitalize()}'
            by = '' if best['species'] == s.species else f' as {k.name(best["species"])}'
            out.append(_result(f'move-{slot + 1}', 'CurrentMove', VALID, f'{name}: {how}{by}{where}.'))
            continue
        if any(o['method'] == 'egg' for o in options):
            reason = f'{name} is an Egg move, but this Pokémon did not hatch.'
        elif any(o['method'] == 'level-up' for o in options):
            lowest = min(o['level'] for o in options if o['method'] == 'level-up')
            reason = f'{name} is learned at level {lowest}, above level {level}.'
        else:
            reason = f'{s.name} cannot learn {name} in Gen III.'
        severity = UNKNOWN if s.detailed and s.met_game == 15 else INVALID
        out.append(_result(f'move-{slot + 1}', 'CurrentMove', severity, reason))
    bonuses = s.record.get('ppBonuses', 0) or 0
    for slot, move in enumerate(ids):
        if move and slot < len(s.pp) and k.move(move):
            maximum = k.max_pp(move, (bonuses >> (2 * slot)) & 3)
            if s.pp[slot] > maximum:
                out.append(_result(f'pp-{slot + 1}', 'CurrentMove', INVALID, f'{k.move_name(move)} has {s.pp[slot]} PP, above its maximum of {maximum}.'))
    return out


def _fixed_checks(subject, k, save_ot_id):
    """Checks that do not depend on the encounter."""
    s, r = subject, subject.record
    out = []
    if s.detailed:
        if s.met_game in rules.GAMES:
            out.append(_result('origin', 'GameOrigin', VALID, f'Origin game: {rules.GAMES[s.met_game]}.'))
        else:
            out.append(_result('origin', 'GameOrigin', INVALID, f'Origin game {s.met_game} is not a Gen III game.'))
        language = r.get('language')
        if language is not None:
            out.append(_result('language', 'Language', VALID if language in rules.LANGUAGES else INVALID,
                               f'Language: {rules.LANGUAGES[language]}.' if language in rules.LANGUAGES else f'Language {language} does not exist.'))
    nature = rules.nature(s.pid)
    if (r.get('nature') or {}).get('id', nature['id']) != nature['id']:
        out.append(_result('nature', 'Nature', INVALID, 'The nature does not match the PID.'))
    shiny = rules.shiny_value(s.pid, s.ot) < 8
    if r.get('shiny') is not None and bool(r['shiny']) != shiny:
        out.append(_result('shiny', 'Shiny', INVALID, 'The shiny flag does not match the PID and trainer ID.'))
    else:
        out.append(_result('shiny', 'Shiny', VALID, f'{"Shiny" if shiny else "Not shiny"}: PID and trainer ID give shiny value {rules.shiny_value(s.pid, s.ot)}.', 'structure'))
    if any(not 0 <= s.ivs[x] <= 31 for x in rules.STATS):
        out.append(_result('ivs', 'IVs', INVALID, 'IVs must be 0 to 31.'))
    # EVs (PKHeX EffortValueVerifier, Gen III/IV rules).
    total = sum(s.evs[x] for x in rules.STATS)
    if total > rules.MAX_EVS or any(s.evs[x] > rules.MAX_STAT_EVS for x in rules.STATS):
        out.append(_result('evs', 'EVs', INVALID, f'EVs total {total}; the limits are 510 in total and 255 per stat.', 'evs'))
    else:
        vitamins = all(s.evs[x] <= rules.VITAMIN_LIMIT and s.evs[x] % 10 == 0 for x in rules.STATS)
        base = rules.experience(s.growth, 5 if s.hatched else s.met_level) if s.growth and s.met_level is not None else None
        if total and not vitamins and base is not None and r['experience'] <= base and (s.level or 0) < 100:
            out.append(_result('evs', 'EVs', INVALID, 'EVs above what vitamins give, but the Pokémon has never gained experience.', 'evs'))
        elif total and len({s.evs[x] for x in rules.STATS}) == 1:
            out.append(_result('evs', 'EVs', FISHY, f'All six EVs are {s.evs["hp"]}.', 'evs'))
        else:
            out.append(_result('evs', 'EVs', VALID, f'EVs total {total} of 510, none above 255.', 'evs'))
    # Level and experience.
    if s.growth:
        top = rules.experience(s.growth, 100)
        if r['experience'] > top:
            out.append(_result('level', 'Level', INVALID, f'Experience {r["experience"]} is above the level-100 total of {top}.', 'experience'))
        elif r.get('level') is not None and r['level'] != s.level:
            out.append(_result('level', 'Level', INVALID, f'Level {r["level"]} does not match {r["experience"]} experience (level {s.level}).', 'experience'))
        elif s.met_level and s.level < s.met_level:
            out.append(_result('level', 'Level', INVALID, f'Level {s.level} is below the met level {s.met_level}.', 'experience'))
        else:
            out.append(_result('level', 'Level', VALID, f'Level {s.level} matches its experience ({s.growth.replace("-", " ")} growth).', 'experience'))
    # Pokérus: strain in the high nibble, days left in the low nibble ((strain & 3) + 1 at most).
    pokerus = r.get('pokerus') or 0
    strain, days = pokerus >> 4, pokerus & 15
    if pokerus and ((strain == 0 and days) or days > (strain & 3) + 1):
        out.append(_result('pokerus', 'Misc', INVALID, 'The Pokérus strain and days do not fit together.'))
    item = r.get('heldItem') or 0
    if item:
        if item in k.item_names and not k.item_names[item].startswith('?'):
            out.append(_result('held-item', 'HeldItem', VALID, f'Holding {k.item_name(item)}.'))
        else:
            out.append(_result('held-item', 'HeldItem', INVALID, f'Held item {item} does not exist in FireRed.'))
    ribbons = r.get('ribbons')
    if ribbons:
        names, problem = [], None
        for index, contest in enumerate(CONTEST):
            rank = (ribbons >> (3 * index)) & 7
            if rank > 4:
                problem = f'{contest} contest ribbon rank {rank} does not exist.'
            elif rank:
                names.append(f'{contest} ({("Normal", "Super", "Hyper", "Master")[rank - 1]})')
        names += [label for bit, label in SINGLE_RIBBONS.items() if ribbons >> bit & 1]
        if problem:
            out.append(_result('ribbons', 'Ribbon', INVALID, problem))
        elif 'National' in names and s.detailed and s.met_game != 15:
            out.append(_result('ribbons', 'Ribbon', INVALID, 'The National Ribbon is given only to purified Shadow Pokémon from Colosseum/XD.'))
        elif EVENT_RIBBONS & set(names):
            out.append(_result('ribbons', 'Ribbon', FISHY, f'Event-only ribbons ({", ".join(sorted(EVENT_RIBBONS & set(names)))}) cannot be verified.'))
        else:
            hoenn = (HOENN_RIBBONS | set(CONTEST)) & {n.split(' ')[0] for n in names}
            note = ' Contest, Battle Tower, Artist and Effort ribbons come from Ruby, Sapphire or Emerald.' if hoenn and s.met_game in (4, 5) else ''
            out.append(_result('ribbons', 'Ribbon', VALID, 'Ribbons: ' + ', '.join(names) + '.' + note))
    return out


def _score(checks):
    return (sum(c['severity'] == INVALID for c in checks), sum(c['severity'] == FISHY for c in checks),
            sum(c['severity'] == UNKNOWN for c in checks))


def check(record, save_ot_id=None, k=None):
    """Legality verdict and reasons for one inventory record."""
    k = k or knowledge()
    base = {'schema': SCHEMA, 'pokemonId': record.get('id'), 'fingerprint': record.get('fingerprint'),
            'species': {'id': record.get('nationalSpeciesId'), 'name': k.name(record.get('nationalSpeciesId'))},
            'readOnly': True, 'citations': {'categories': CITATIONS['categories'], 'severity': CITATIONS['severity']}}
    if record.get('validity') != 'valid' or not isinstance(record.get('personality'), int) or not record.get('ivs'):
        return {**base, 'verdict': 'unknown', 'label': VERDICTS['unknown'], 'summary': 'The record could not be read.', 'checks': [], 'limits': []}
    if record.get('isEgg'):
        return {**base, 'verdict': 'unknown', 'label': VERDICTS['unknown'],
                'summary': 'Eggs are checked after they hatch.', 'checks': [], 'limits': ['Egg records are not analysed.']}
    subject = _Subject(record, k)
    correlations = rules.pid_iv_correlations(subject.pid, subject.ivs)
    evaluated = []
    for candidate in _encounters(subject, k):
        checks = _encounter_checks(subject, k, candidate, correlations, save_ot_id)
        checks += _move_checks(subject, k, candidate['kind'] in ('hatched', 'gift-egg'))
        evaluated.append((_score(checks), 'frame' not in candidate, candidate, checks))
    evaluated.sort(key=lambda item: (item[0], item[1]))
    _, _, candidate, checks = evaluated[0]
    checks = _fixed_checks(subject, k, save_ot_id) + checks
    order = ['GameOrigin', 'Encounter', 'PID', 'IVs', 'Ability', 'Nature', 'Shiny', 'Level', 'Evolution', 'EVs', 'Ball',
             'CurrentMove', 'Trainer', 'Fateful', 'Ribbon', 'Form', 'Language', 'HeldItem', 'Misc']
    checks.sort(key=lambda c: order.index(c['category']) if c['category'] in order else len(order))
    invalid, fishy, unknown = _score(checks)
    core_unknown = any(c['severity'] == UNKNOWN and c['category'] in ('Encounter', 'PID') and c['id'] != 'rng-frame' for c in checks)
    verdict = 'illegal' if invalid else 'suspicious' if fishy else 'unknown' if core_unknown else 'legal'
    limits = ['Nicknames and original-trainer names are not decoded, so name checks are not run.']
    if not subject.detailed:
        limits.insert(0, 'This record has no met location, origin game, ball, fateful flag or ribbons (the engine that read it '
                         'predates the builder update). The encounter was matched by species and met level only.')
    if subject.detailed and subject.met_game in (1, 2, 3, 15):
        limits.insert(0, f'{rules.GAMES[subject.met_game]} encounter tables are not bundled; only generic checks ran for the encounter.')
    problems = [c['message'] for c in checks if c['severity'] in (INVALID, FISHY)]
    if verdict == 'legal':
        summary = f'{candidate["label"][0].upper()}{candidate["label"][1:]}; every check passed.'
    elif verdict == 'unknown':
        summary = next(c['message'] for c in checks if c['severity'] == UNKNOWN)
    else:
        summary = problems[0] + (f' (+{len(problems) - 1} more)' if len(problems) > 1 else '')
    encounter = {key: candidate[key] for key in ('kind', 'species', 'label', 'mapsec', 'partial') if key in candidate}
    if 'frame' in candidate:
        encounter['frame'] = candidate['frame']
    methods = sorted({c['method'] for c in correlations})
    return {**base, 'verdict': verdict, 'label': VERDICTS[verdict], 'summary': summary, 'encounter': encounter,
            'pidMethods': methods, 'checks': checks, 'counts': {'invalid': invalid, 'fishy': fishy, 'unknown': unknown}, 'limits': limits}


def check_inventory(inventory):
    """Verdicts for every Pokémon of an inventory snapshot, with counts."""
    ot, k = save_ot_id(inventory), knowledge()
    results = [check(p, ot, k) for p in inventory.get('pokemon', [])]
    counts = {v: sum(r['verdict'] == v for r in results) for v in VERDICTS}
    return {'schema': SCHEMA, 'game': inventory.get('game'), 'counts': counts, 'results': results, 'readOnly': True}


def save_ot_id(inventory):
    """The save trainer's OT ID.

    Inventory snapshots carry no separate trainer ID; the most common OT among
    the party and PC records is the save's own trainer in practice."""
    if isinstance(inventory.get('trainerOtId'), int):
        return inventory['trainerOtId']
    counts = {}
    for p in inventory.get('pokemon', []):
        if isinstance(p.get('otId'), int):
            counts[p['otId']] = counts.get(p['otId'], 0) + 1
    return max(counts, key=counts.get) if counts else None
