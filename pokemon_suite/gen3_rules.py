"""Generation III rules shared by the competitive builder and the legality checker.

Clean-room implementations of the cartridge's documented behavior, each cited
to pret/pokefirered c75f352304d529f6ba92d4f74b9cf8b5c3810788. Read-only: nothing
here writes a Pokémon record, a save or game memory.
"""
from functools import lru_cache

PRET = 'https://github.com/pret/pokefirered/blob/c75f352304d529f6ba92d4f74b9cf8b5c3810788/'
# Inventory and IV-word order (include/pokemon.h): HP, Atk, Def, Spe, SpA, SpD.
STATS = ('hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense')
DEX_KEYS = {'hp': 'hp', 'attack': 'attack', 'defense': 'defense', 'speed': 'speed',
            'spAttack': 'specialAttack', 'spDefense': 'specialDefense'}
STAT_LABELS = {'hp': 'HP', 'attack': 'Attack', 'defense': 'Defense', 'speed': 'Speed',
               'spAttack': 'Sp. Atk', 'spDefense': 'Sp. Def'}
NATURE_NAMES = ('Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
                'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
                'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky')
# gNatureStatTable order: nature = 5 * raised + lowered over these five stats.
NATURE_STATS = ('attack', 'defense', 'speed', 'spAttack', 'spDefense')
HIDDEN_POWER_TYPES = ('fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'fire', 'water',
                      'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark')
# Gen III decides physical or special by the move's type (src/battle_util.c, IS_TYPE_PHYSICAL).
PHYSICAL_TYPES = frozenset({'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel'})
GAMES = {1: 'Sapphire', 2: 'Ruby', 3: 'Emerald', 4: 'FireRed', 5: 'LeafGreen', 15: 'Colosseum/XD'}
LANGUAGES = {1: 'Japanese', 2: 'English', 3: 'French', 4: 'Italian', 5: 'German', 7: 'Spanish'}
BALLS = {1: 'Master Ball', 2: 'Ultra Ball', 3: 'Great Ball', 4: 'Poké Ball', 5: 'Safari Ball', 6: 'Net Ball',
         7: 'Dive Ball', 8: 'Nest Ball', 9: 'Repeat Ball', 10: 'Timer Ball', 11: 'Luxury Ball', 12: 'Premier Ball'}
MAX_EVS, MAX_STAT_EVS, VITAMIN_LIMIT = 510, 255, 100  # include/constants/pokemon.h


def nature(personality):
    """{'id', 'name', 'raised', 'lowered'} for a PID (GetNature: personality % 25)."""
    index = personality % 25
    raised, lowered = NATURE_STATS[index // 5], NATURE_STATS[index % 5]
    neutral = raised == lowered
    return {'id': index, 'name': NATURE_NAMES[index], 'raised': None if neutral else raised, 'lowered': None if neutral else lowered}


def nature_by_name(name):
    lowered = str(name).lower()
    for index, candidate in enumerate(NATURE_NAMES):
        if candidate.lower() == lowered:
            return {**nature(index), 'id': index}
    raise ValueError(f'Unknown nature {name!r}.')


def nature_multiplier(nature_value, stat):
    if nature_value.get('raised') == stat:
        return 110
    if nature_value.get('lowered') == stat:
        return 90
    return 100


def shiny_value(personality, ot_id):
    """GET_SHINY_VALUE (include/pokemon.h): shiny when below 8."""
    return (ot_id >> 16) ^ (ot_id & 0xFFFF) ^ (personality >> 16) ^ (personality & 0xFFFF)


def gender_threshold(gender_rate):
    """PokéAPI female-eighths rate to the Gen III gender byte (PERCENT_FEMALE)."""
    if gender_rate < 0:
        return 255
    if gender_rate == 0:
        return 0
    if gender_rate >= 8:
        return 254
    return min(254, int(gender_rate * 12.5 * 255 / 100))


def gender(personality, gender_rate):
    threshold = gender_threshold(gender_rate)
    if threshold == 255:
        return 'genderless'
    if threshold == 0:
        return 'male'
    if threshold == 254:
        return 'female'
    return 'female' if (personality & 0xFF) < threshold else 'male'


def unown_letter(personality):
    """GET_UNOWN_LETTER: 0 = A … 25 = Z, 26 = !, 27 = ?."""
    return (((personality & 0x03000000) >> 18) | ((personality & 0x00030000) >> 12) |
            ((personality & 0x00000300) >> 6) | (personality & 0x3)) % 28


def unown_letter_name(letter):
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?'[letter]


def wurmple_branch(personality):
    """EVO_LEVEL_SILCOON when (personality >> 16) % 10 <= 4, else Cascoon (src/pokemon.c)."""
    return 266 if (personality >> 16) % 10 <= 4 else 268


def hidden_power(ivs):
    """Cmd_hiddenpowercalc: type from each IV's lowest bit, power from the second (30–70)."""
    order = ('hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense')
    type_bits = sum(((ivs[s] & 1) << i) for i, s in enumerate(order))
    power_bits = sum((((ivs[s] >> 1) & 1) << i) for i, s in enumerate(order))
    return {'type': HIDDEN_POWER_TYPES[15 * type_bits // 63], 'power': 40 * power_bits // 63 + 30}


def hidden_power_parities(type_name):
    """Every set of IV parities (lowest bits) that gives this Hidden Power type."""
    order = ('hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense')
    target = HIDDEN_POWER_TYPES.index(type_name)
    return [{s: (bits >> i) & 1 for i, s in enumerate(order)} for bits in range(64) if 15 * bits // 63 == target]


def experience(growth, level):
    """gExperienceTables (src/data/pokemon/experience_tables.h), C integer division."""
    n = level
    if n <= 0:
        return 0
    if n == 1:
        return 1
    cube = n * n * n
    if growth == 'medium-fast':
        return cube
    if growth == 'fast':
        return 4 * cube // 5
    if growth == 'slow':
        return 5 * cube // 4
    if growth == 'medium-slow':
        return 6 * cube // 5 - 15 * n * n + 100 * n - 140
    if growth == 'erratic':
        if n <= 50:
            return cube * (100 - n) // 50
        if n <= 68:
            return cube * (150 - n) // 100
        if n <= 98:
            return cube * ((1911 - 10 * n) // 3) // 500
        return cube * (160 - n) // 100
    if growth == 'fluctuating':
        if n <= 15:
            return cube * ((n + 1) // 3 + 24) // 50
        if n <= 36:
            return cube * (n + 14) // 50
        return cube * (n // 2 + 32) // 50
    raise ValueError(f'Unknown growth rate {growth!r}.')


def level_for_experience(growth, points):
    level = 1
    while level < 100 and experience(growth, level + 1) <= points:
        level += 1
    return level


def stat_value(stat, base, iv, ev, level, nature_value, shedinja=False):
    """CalculateMonStats (src/pokemon.c)."""
    core = (2 * base + iv + ev // 4) * level // 100
    if stat == 'hp':
        return 1 if shedinja else core + level + 10
    return (core + 5) * nature_multiplier(nature_value, stat) // 100


# Gen III LCRNG (include/random.h, src/random.c): state = state * 0x41C64E6D + 0x6073;
# Random() returns the new state's upper 16 bits.
MULT, ADD, MASK = 0x41C64E6D, 0x6073, 0xFFFFFFFF
REVERSE_MULT, REVERSE_ADD = 0xEEB9EB65, 0x0A3561A1


def next_state(state):
    return (state * MULT + ADD) & MASK


def previous_state(state):
    return (state * REVERSE_MULT + REVERSE_ADD) & MASK


@lru_cache(maxsize=8)
def _jump(steps):
    multiplier, increment = 1, 0
    for _ in range(steps):
        multiplier, increment = (multiplier * MULT) & MASK, (increment * MULT + ADD) & MASK
    return multiplier, increment


def _first_in_window(a, m, low, high):
    """Smallest x >= 0 with low <= (a * x) mod m <= high (0 <= low <= high < m), or None."""
    a %= m
    if low == 0:
        return 0
    if a == 0:
        return None
    x = -(-low // a)
    if a * x <= high:
        return x
    y = _first_in_window(m % a, a, (-high) % a, (-low) % a)
    if y is None:
        return None
    x = -(-(m * y + low) // a)
    return x if a * x - m * y <= high else None


def _solutions(a, offset, limit):
    """All x < limit with (a * x - offset) mod 2**32 < 65536."""
    m, found, start = 1 << 32, [], 0
    while start < limit:
        base = (offset - a * start) % m
        top = base + 0xFFFF
        windows = [(base, top)] if top < m else [(base, m - 1), (0, top - m)]
        candidates = [x for x in (_first_in_window(a, m, lo, hi) for lo, hi in windows) if x is not None]
        if not candidates:
            break
        x = start + min(candidates)
        if x >= limit:
            break
        found.append(x)
        start = x + 1
    return found


def states_for_outputs(first, second, steps=1):
    """Every state s with s >> 16 == first and the state `steps` calls later >> 16 == second."""
    multiplier, increment = _jump(steps)
    offset = ((second << 16) - multiplier * (first << 16) - increment) & MASK
    return [(first << 16) | low for low in _solutions(multiplier, offset, 0x10000)]


def _iv_words(ivs):
    return (ivs['hp'] | ivs['attack'] << 5 | ivs['defense'] << 10,
            ivs['speed'] | ivs['spAttack'] << 5 | ivs['spDefense'] << 10)


def _out(state):
    return state >> 16


def pid_iv_correlations(personality, ivs):
    """PID/IV method correlation (Smogon PID/IV creation; PKHeX MethodFinder categories).

    Method 1: [PID low][PID high][IV1][IV2]. Method 2: [PID][PID][skip][IV1][IV2].
    Method 4: [PID][PID][IV1][skip][IV2]. Method 3: [PID low][skip][PID high][IV1][IV2].
    Unown in FireRed/LeafGreen draws the high half first (GenerateUnownPersonalityByLetter).
    Roamers keep only the IV word's low eight bits (SetMonData MON_DATA_IVS bug).
    Each result carries `pidState`, the state that produced the first PID half.
    """
    low, high = personality & 0xFFFF, personality >> 16
    iv1, iv2 = _iv_words(ivs)
    found = []

    def check(first_state, halves, family):
        s = [first_state]
        for _ in range(5):
            s.append(next_state(s[-1]))
        # s[0] made the first PID half, s[1] the second (or the skip for Method 3).
        out = [_out(x) & 0x7FFF for x in s]
        if halves == 'adjacent':
            if out[2] == iv1 and out[3] == iv2:
                found.append({'method': 'Method 1', 'family': family, 'pidState': first_state})
            if out[3] == iv1 and out[4] == iv2:
                found.append({'method': 'Method 2', 'family': family, 'pidState': first_state})
            if out[2] == iv1 and out[4] == iv2:
                found.append({'method': 'Method 4', 'family': family, 'pidState': first_state})
            roamer = ivs['defense'] == ivs['speed'] == ivs['spAttack'] == ivs['spDefense'] == 0 and ivs['attack'] < 8
            if family == 'standard' and roamer and (_out(s[2]) & 0xFF) == iv1:
                found.append({'method': 'Method 1 (roamer)', 'family': 'roamer', 'pidState': first_state})
        elif out[3] == iv1 and out[4] == iv2:
            found.append({'method': 'Method 3', 'family': family, 'pidState': first_state})

    for family, (a, b) in (('standard', (low, high)), ('unown', (high, low))):
        for state in states_for_outputs(a, b, 1):
            check(state, 'adjacent', family)
        for state in states_for_outputs(a, b, 2):
            check(state, 'split', family)
    unique = {}
    for entry in found:
        unique.setdefault((entry['method'], entry['family'], entry['pidState']), entry)
    return list(unique.values())


def wild_frames(pid_state, personality, *, unown=False, limit=600):
    """Walk back from the first PID call to candidate slot/level calls (Method H).

    FireRed wild generation (src/wild_encounter.c): slot = Random() % 100,
    level = lo + Random() % (hi - lo + 1), then, except for Unown, the nature
    Random() % 25 and PID pairs rerolled until PID % 25 matches. Unown instead
    rerolls (high, low) PID pairs until the letter matches its slot. Yields
    (slot_roll, level_roll, interrupts, rerolls) where slot_roll is the raw
    16-bit output; `interrupts` counts one tolerated extra call (VBlank).
    """
    target = personality % 25
    letter = unown_letter(personality)
    state = previous_state(pid_state)  # the call before the first PID half
    for rerolls in range(limit):
        if unown:
            # `state` is the level call, or the low half of a rejected pair.
            level_state = state
            for gap in (0, 1):
                slot_state = previous_state(level_state)
                if gap:
                    slot_state = previous_state(slot_state)
                yield _out(slot_state), _out(level_state), gap, rerolls
            skip_level = previous_state(level_state)  # one interrupt between the level call and the PID
            yield _out(previous_state(skip_level)), _out(skip_level), 1, rerolls
            rejected = (_out(previous_state(state)) << 16) | _out(state)
            if unown_letter(rejected) == letter:
                return
            state = previous_state(previous_state(state))
            continue
        for skip_before in (0, 1):
            nature_state = previous_state(state) if skip_before else state
            if _out(nature_state) % 25 != target:
                continue
            level_state = previous_state(nature_state)
            yield _out(previous_state(level_state)), _out(level_state), skip_before, rerolls
            if not skip_before:
                gap_level = previous_state(level_state)
                yield _out(previous_state(gap_level)), _out(gap_level), 1, rerolls
                yield _out(previous_state(previous_state(level_state))), _out(level_state), 1, rerolls
        rejected = (_out(state) << 16) | _out(previous_state(state))
        if rejected % 25 == target:
            return
        state = previous_state(previous_state(state))
