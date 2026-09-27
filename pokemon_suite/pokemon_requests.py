"""Natural-language requests -> Goal v1 drafts (G3).

Interpreting never starts a game, sends input or writes a save. It reads the
live sessions payload it is given, the bundled vocabularies and (optionally)
the farming preview, and returns a draft with a human summary. Committing
hands the draft to the goal supervisor (G2, ``server.goals``); settings go
through the existing bot-settings contract.

Pipeline
  normalize (case, accents, number words, contractions, speech-to-text quirks)
  -> split into ordered clauses ("heal then go to Cinnabar and save")
  -> code entity recognition: exact aliases, difflib fuzzy and a phonetic
     fallback over species, items, balls, held items, moves, natures, places,
     stats, genders and the owner's party names
  -> intent per clause: deterministic anchor/coverage/template scoring over
     the action catalog; an optional pinned Laya model (a sidecar process,
     laya_runtime.py) with calibrated parameters per reviewed model (G4):
     either it only re-ranks intents the code layer already found viable, or,
     for a calibration with a primary rule, Laya decides the intent when it is
     confident and the code layer's decision is the fallback
  -> slot filling and builders that emit existing contracts only
  -> policy: clarify (ambiguous entity, missing slot, low confidence),
     confirm (destructive steps), reject (nonsense or unsupported) with the
     nearest supported actions.
"""
from __future__ import annotations

import copy
import difflib
import hashlib
import importlib
import json
import math
import os
import re
import threading
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .laya_runtime import LayaUnavailable, SidecarAgent, read_asset_id

GOAL_SCHEMA = 'pokemon-suite/goal/v1'
DATA = Path(__file__).parent / 'static' / 'data'
VIA = ('typed', 'voice', 'ui')
MAX_TEXT = 1000
KEY = re.compile(r'[A-Za-z0-9_-]{8,100}\Z')
ACCEPT = 0.5          # intent score needed to act on a clause
CLARIFY = 0.4         # below ACCEPT but at least this: ask instead of rejecting
CONFIRM_BELOW = 0.55  # accepted but less certain: ask the owner to confirm
STATS = ('hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed')
EV_KEYS = {'hp': 'hp', 'attack': 'attack', 'defense': 'defense', 'specialAttack': 'spAttack', 'specialDefense': 'spDefense', 'speed': 'speed'}
STARTERS = {1: 'bulbasaur', 4: 'charmander', 7: 'squirtle'}


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------
UNITS = {'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
         'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19}
TENS = {'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90}
CONTRACTIONS = {
    "what's": 'what is', "where's": 'where is', "who's": 'who is', "how's": 'how is', "it's": 'it is', "that's": 'that is', "there's": 'there is',
    "let's": 'let us', "i'm": 'i am', "i'd": 'i would', "i'll": 'i will', "i've": 'i have', "you're": 'you are', "you've": 'you have',
    "we're": 'we are', "they're": 'they are', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'can not',
    "won't": 'will not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "shouldn't": 'should not', "wouldn't": 'would not',
    "couldn't": 'could not', "y'all": 'you all',
}
SLANG = {'whats': 'what is', 'wheres': 'where is', 'hows': 'how is', 'whos': 'who is', 'dont': 'do not', 'doesnt': 'does not', 'didnt': 'did not',
         'cant': 'can not', 'isnt': 'is not', 'im': 'i am', 'youre': 'you are', 'thats': 'that is', 'u': 'you', 'ur': 'your', 'ya': 'you',
         'pls': 'please', 'plz': 'please', 'plez': 'please', 'gimme': 'give me', 'lemme': 'let me', 'wanna': 'want to', 'gonna': 'going to',
         'gotta': 'got to', 'thx': 'thanks', 'rn': 'right now', 'lvl': 'level', 'lv': 'level', 'mister': 'mr', 'em': 'them', 'nevermind': 'never mind',
         'dept': 'department', 'pls.': 'please', 'r': 'are', 'nvm': 'never mind', 'idk': 'i do not know', 'ty': 'thanks', 'tho': 'though',
         'bout': 'about', 'plss': 'please', 'thanx': 'thanks', 'gf': 'friend', 'bf': 'friend', 'lol': '', 'lmao': '', 'pls': 'please', 'kinda': 'kind of', 'lemmie': 'let me', 'cuz': 'because', 'bc': 'because'}
POLITE = [r'\bif (you|u) (can|could)( manage( it)?| do (it|that))?\b', r'\bwhen(ever)? (you|u) (get|have) (a )?(chance|minute|moment|time)\b',
          r'\bif (that is|thats|its) (ok|okay|alright|fine)\b', r'\bif possible\b', r'\bthank (you|u)\b', r'\bthanks\b', r'\bfor me\b$',
          r'\bwould (you|u) mind\b', r'\bi would appreciate it\b', r'\bno rush\b', r'\byou know\b', r'\bwhatever works\b',
          r'\bdoes not matter\b', r'\bno preference\b', r'\bi was hoping (you|u) (could|would|can)\b', r'\bwould it be possible to\b',
          r'\bis it possible to\b', r'\bi want (you|u) to\b', r'\bi need (you|u) to\b', r'\bi would like (you|u) to\b']
# Token-sequence fixes (speech-to-text and common spellings); applied after number words.
PHRASES = [
    (('pokey', 'mon'), ('pokemon',)), (('pokey', 'mons'), ('pokemon',)), (('poke', 'mon'), ('pokemon',)), (('poke', 'mons'), ('pokemon',)),
    (('pokeman',), ('pokemon',)), (('pokemans',), ('pokemon',)), (('pokemons',), ('pokemon',)), (('pokeys',), ('pokemon',)),
    (('pokeball',), ('poke', 'ball')), (('pokeballs',), ('poke', 'balls')), (('ultraball',), ('ultra', 'ball')), (('ultraballs',), ('ultra', 'balls')),
    (('greatball',), ('great', 'ball')), (('greatballs',), ('great', 'balls')), (('masterball',), ('master', 'ball')), (('masterballs',), ('master', 'balls')),
    (('shiney',), ('shiny',)), (('shinny',), ('shiny',)), (('shinie',), ('shiny',)), (('shiniy',), ('shiny',)), (('shinee',), ('shiny',)),
    (('shyny',), ('shiny',)), (('sparkly',), ('shiny',)), (('sparkling',), ('shiny',)), (('shine', 'e'), ('shiny',)),
    (('post', 'game'), ('postgame',)), (('mew', '2'), ('mewtwo',)), (('e', '4'), ('elite', '4')),
    (('go', 'ahead', 'and'), ()), (('go', 'ahead'), ()), (('let', 'us'), ()), (('um',), ()), (('umm',), ()), (('uh',), ()), (('uhh',), ()),
    (('er',), ()), (('erm',), ()), (('heel',), ('heal',)), (('heels',), ('heal',)), (('fire', 'red'), ('firered',)), (('leaf', 'green'), ('leafgreen',)),
    (('poke', 'dollars'), ('pokedollars',)), (('roll', 'back'), ('rollback',)),
]
# Inflected command verbs -> the base form the anchors use (a fixed list; nouns like "saves" are left alone).
LEMMAS = {'heading': 'head', 'flying': 'fly', 'traveling': 'travel', 'travelling': 'travel', 'healing': 'heal', 'healed': 'heal', 'heals': 'heal',
          'buying': 'buy', 'grabbing': 'grab', 'bringing': 'bring', 'finding': 'find', 'fetching': 'fetch', 'walking': 'walk', 'visiting': 'visit',
          'collecting': 'collect', 'starting': 'start', 'loading': 'load', 'cancelling': 'cancel', 'canceling': 'cancel', 'pausing': 'pause',
          'stopping': 'stop', 'restoring': 'restore', 'capturing': 'capture', 'purchasing': 'purchase', 'closing': 'close', 'quitting': 'quit',
          'exiting': 'exit', 'booting': 'boot', 'launching': 'launch', 'finishing': 'finish', 'completing': 'complete', 'releasing': 'release',
          'evolving': 'evolve', 'teaching': 'teach', 'resuming': 'resume', 'continuing': 'continue'}
PRONOUN_ONE_BEFORE = {'the', 'a', 'an', 'that', 'this', 'which', 'another', 'each', 'every', 'any', 'no', 'some', 'shiny', 'other', 'wants', 'want',
                      'good', 'new', 'right', 'same', 'last', 'first', 'next', 'only', 'little', 'big', 'cool', 'nice'}
NUMBER_NOUNS = {'route', 'road', 'level', 'lvl', 'lv', 'box', 'slot', 'tm', 'hm', 'number', 'floor', 'x', 'gen', 'generation', 'island', 'badge', 'page'}
PRONOUN_ONE_AFTER = {None, ',', 'of', 'i', 'you', 'that', 'which', 'who', 'is', 'was', 'with', 'too', 'please', 'pls', 'for', 'as', 'or'}
QUESTION = {'what', 'where', 'how', 'who', 'which', 'why', 'is', 'are', 'any', 'did', 'show', 'list', 'tell', 'display'}
QUESTION_CUES = QUESTION | {'do', 'does', 'am', 'check', 'give', 'report', 'whats', 'wheres', 'hows', 'see'}
STRONG_CUES = QUESTION_CUES - {'is', 'are', 'do', 'does', 'am', 'did', 'give', 'see'}


def fold(text):
    text = unicodedata.normalize('NFKC', str(text)).replace('♀', ' female ').replace('♂', ' male ').replace('’', "'").replace('‘', "'")
    text = ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c))
    return text


def _numbers(tokens):
    out = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        if t == 'a' and nxt == 'dozen':
            out.append('12'); i += 2; continue
        if t == 'a' and nxt == 'couple':
            out.append('2'); i += 3 if i + 2 < len(tokens) and tokens[i + 2] == 'of' else 2; continue
        if t == 'a' and nxt == 'pair' and i + 2 < len(tokens) and tokens[i + 2] == 'of':
            out.append('2'); i += 3; continue
        if t == 'a' and nxt == 'hundred':
            out.append('100'); i += 2; continue
        if t == 'dozen':
            out.append('12'); i += 1; continue
        if t == 'one' and not (out and out[-1] in NUMBER_NOUNS) and ((out and out[-1] in PRONOUN_ONE_BEFORE) or nxt in PRONOUN_ONE_AFTER):
            out.append(t)  # "the one I was talking about", "wants one", "a shiny one"
            i += 1
            continue
        if t in UNITS or t in TENS:
            j = i
            value = 0
            if t in TENS:
                value = TENS[t]; j += 1
                if j < len(tokens) and tokens[j] in UNITS and UNITS[tokens[j]] < 10:
                    value += UNITS[tokens[j]]; j += 1
            else:
                value = UNITS[t]; j += 1
            if j < len(tokens) and tokens[j] == 'hundred' and value < 10:
                value *= 100; j += 1
                if j < len(tokens) and tokens[j] == 'and' and j + 1 < len(tokens) and (tokens[j + 1] in UNITS or tokens[j + 1] in TENS):
                    j += 1
                if j < len(tokens) and tokens[j] in TENS:
                    value += TENS[tokens[j]]; j += 1
                    if j < len(tokens) and tokens[j] in UNITS and UNITS[tokens[j]] < 10:
                        value += UNITS[tokens[j]]; j += 1
                elif j < len(tokens) and tokens[j] in UNITS:
                    value += UNITS[tokens[j]]; j += 1
            out.append(str(value))
            i = j
            continue
        out.append(t)
        i += 1
    return out


def _phrases(tokens):
    out = []
    i = 0
    while i < len(tokens):
        for source, target in PHRASES:
            if tuple(tokens[i:i + len(source)]) == source:
                if not target and len(tokens) == len(source):
                    continue  # "hmm"/"uh" alone stays as it is
                out.extend(target)
                i += len(source)
                break
        else:
            if tokens[i] == 'like' and i + 1 < len(tokens) and tokens[i + 1].isdigit():
                i += 1
                continue
            if tokens[i] == 'bye' and i + 1 < len(tokens) and (tokens[i + 1].isdigit() or tokens[i + 1] in ('a', 'an', 'some', 'more')):
                out.append('buy')
                i += 1
                continue
            out.append(LEMMAS.get(tokens[i], tokens[i]))
            i += 1
    return out


def _tokens(text):
    text = fold(text).lower()
    text = re.sub(r'\b(mr|mt|st|dr|sp|lt|exp)\.', r'\1 ', text)  # "Mt. Moon", dictated "Exp. Share": a period inside a name ends no step
    text = re.sub(r'\bs\.s\.', 'ss ', text)
    text = re.sub(r'\bw/o\b', ' without ', text)
    text = re.sub(r'\bw/(?=\s|$)', ' with ', text)
    text = re.sub(r'(\d)\s*\+', r'\1 or more ', text)
    text = re.sub(r'(?<=[a-z0-9])\s*/\s*(?=\d)', ' ', text)  # EV/IV lists: "252 atk / 252 spe"
    text = text.replace('&', ' and ').replace('+', ' and ').replace('/', ' or ')
    words = []
    for raw in re.split(r'\s+', text):
        if not raw:
            continue
        word = raw.strip('"()[]{}<>*_~`#')
        punct = re.search(r'[,;.!?]+$', word)
        tail = ',' if punct and punct.group() else None
        word = re.sub(r'[,;.!?]+$', '', word)
        word = re.sub(r'(?<=[a-z0-9])[,;!?]+(?=[a-z])', ' , ', word)  # "bot,save"
        word = re.sub(r'([a-z])\1{2,}', r'\1', word)  # "sooo" -> "so", "pleeease" -> "please"
        if word in CONTRACTIONS:
            words.extend(CONTRACTIONS[word].split())
        elif word:
            word = re.sub(r"'s$", '', word).replace("'", '')
            word = re.sub(r'[^a-z0-9\-,;.!?:]', ' ', word)
            for part in re.split(r'[\s\-:]+', word):
                if part and set(part) <= set(',;!?'):
                    words.append(',')  # "bot,save"
                    continue
                part = part.strip(',;.!?')
                if not part:
                    continue
                if part in SLANG:
                    words.extend(SLANG[part].split())
                else:
                    words.extend(re.sub(r'(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])', ' ', part).split())
        if tail:
            words.append(',')
    # Spelled-out letters from speech ("e v train", "p p up") become one word.
    joined = []
    letters = False  # the previous token is a run of spelled letters
    for w in words:
        single = len(w) == 1 and w.isalpha() and w not in ('a', 'i')
        if single and joined and (letters or (len(joined[-1]) == 1 and joined[-1].isalpha() and joined[-1] not in ('a', 'i'))):
            joined[-1] += w
            letters = True
            continue
        joined.append(w)
        letters = False
    words = _phrases(_numbers(joined))
    text = ' '.join(words)
    for pattern in POLITE:
        text = re.sub(pattern, ' ', text)
    words = text.split()
    # "go out and catch" / "come and heal": the verb that follows is the action.
    cleaned = []
    for i, w in enumerate(words):
        if w in ('go', 'come') and i + 2 < len(words) and words[i + 1] == 'and' and words[i + 2] in ACTION_START:
            continue
        if w == 'out' and cleaned and cleaned[-1] == 'go' and i + 2 < len(words) and words[i + 1] == 'and' and words[i + 2] in ACTION_START:
            cleaned.pop()
            continue
        if w == 'and' and cleaned == [] :
            continue
        cleaned.append(w)
    words = [w for i, w in enumerate(cleaned) if not (w == ',' and (i == 0 or cleaned[i - 1] == ','))]
    while words and words[-1] == ',':
        words.pop()
    return words


def _dl1(a, b):
    """True when a and b differ by one edit (insert, delete, substitute or swap)."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        return len(diff) == 1 or (len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]])
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


COMMAND_WORDS = sorted({'catch', 'capture', 'hunt', 'farm', 'snag', 'grab', 'bring', 'fetch', 'find', 'buy', 'purchase', 'travel', 'head', 'walk',
                         'visit', 'teleport', 'heal', 'restore', 'save', 'stop', 'pause', 'halt', 'freeze', 'resume', 'continue', 'unpause', 'start',
                         'boot', 'load', 'launch', 'trade', 'send', 'train', 'evolve', 'release', 'teach', 'close', 'quit', 'exit', 'shut', 'cancel',
                         'collect', 'complete', 'finish', 'postgame', 'shiny', 'shinies', 'pokemon', 'team', 'party', 'where', 'what', 'show', 'list',
                         'default', 'always', 'enable', 'disable', 'limit', 'badges', 'progress', 'help', 'settings', 'please', 'can', 'you', 'the',
                         'for', 'get', 'and', 'then'} - {'shiny', 'team', 'party'})


def _exact_cover(tokens, vocab):
    """Token indexes inside exact vocabulary matches (never "corrected")."""
    covered = set()
    for i in range(len(tokens)):
        for L in range(1, min(5, len(tokens) - i) + 1):
            words = tokens[i:i + L]
            if vocab.index.get(' '.join(words)) or vocab.joined.get(''.join(words)) or vocab.singular(words):
                covered |= set(range(i, i + L))
    return covered


def correct_commands(tokens, protected=()):
    """Fix one-edit typos of command words ("cna" -> "can", "savee" -> "save").

    Only unknown tokens are corrected, toward the catalog's own vocabulary; a
    3-letter word is corrected only for a swapped pair ("cna"), never a
    substitution ("bus" stays "bus").
    """
    out = []
    for k, t in enumerate(tokens):
        if k in protected or not t.isalpha() or len(t) < 3 or t in KNOWN_WORDS:
            out.append(t)
            continue
        choices = [w for w in COMMAND_WORDS if w[0] == t[0] or sorted(w) == sorted(t)]
        # Insertions, deletions and swaps; a substitution only for longer words ("smart" is not "start").
        hits = [w for w in choices if _dl1(t, w) and (sorted(w) == sorted(t) or (len(t) >= 4 and len(t) != len(w)) or len(t) >= 6)]
        out.append(hits[0] if len(hits) == 1 else t)
    return out


def normalize(text):
    """Lowercase, accent-free, digits for number words, speech quirks fixed; ',' marks clause breaks."""
    return ' '.join(_tokens(text))


def case_map(text):
    """Original spelling of each word (for trainer names, nicknames and labels)."""
    result = {}
    for word in re.findall(r"[A-Za-z][A-Za-z']*", fold(text)):
        result.setdefault(word.lower().replace("'", ''), word.replace("'", ''))
    return result


def phonetic(word):
    s = re.sub(r'[^a-z]', '', word.lower())
    if not s:
        return ''
    s = s.replace('ph', 'f').replace('ck', 'k').replace('kh', 'k').replace('gh', 'g').replace('th', 't').replace('qu', 'k').replace('x', 'ks')
    s = re.sub(r'c(?=[eiy])', 's', s).replace('c', 'k').replace('q', 'k').replace('z', 's').replace('w', 'u').replace('y', 'i')
    head, rest = s[0], re.sub(r'[aeiou]', '', s[1:])
    return re.sub(r'(.)\1+', r'\1', head + rest)


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------
@dataclass
class Hit:
    kind: str
    value: object
    label: str


@dataclass
class Span:
    start: int
    end: int
    hits: list
    score: float = 1.0
    how: str = 'exact'
    text: str = ''

    def kinds(self):
        return {h.kind for h in self.hits}

    def values(self, kind):
        seen = []
        for h in self.hits:
            if h.kind == kind and h.value not in [v for v, _ in seen]:
                seen.append((h.value, h.label))
        return seen


SPECIES_ALIASES = {'nidoran': [29, 32], 'nidoran f': [29], 'nidoran m': [32], 'mr mime': [122], 'farfetched': [83], 'farfetch d': [83],
                   'ho oh': [250], 'porygon two': [233]}
STAT_ALIASES = {'hp': ['hp', 'health', 'hit points'], 'attack': ['attack', 'atk', 'att'], 'defense': ['defense', 'def', 'defence'],
                'specialAttack': ['special attack', 'sp attack', 'sp atk', 'spatk', 'spa', 'special atk', 'sp att', 'special attacks'],
                'specialDefense': ['special defense', 'sp defense', 'sp def', 'spdef', 'special def', 'special defence'],
                'speed': ['speed', 'spe']}
GENDERS = {'male': 'male', 'boy': 'male', 'guy': 'male', 'female': 'female', 'girl': 'female', 'lady': 'female', 'genderless': 'genderless'}
GAMES = {'emerald': 'Emerald', 'crystal': 'Crystal', 'leafgreen': 'LeafGreen', 'leaf green': 'LeafGreen', 'ruby': 'Ruby', 'sapphire': 'Sapphire',
         'gold': 'Gold', 'silver': 'Silver', 'diamond': 'Diamond', 'platinum': 'Platinum', 'heartgold': 'HeartGold', 'soulsilver': 'SoulSilver'}
FUZZY_KINDS = ('species', 'place', 'item', 'ball', 'held', 'nature', 'ability')
ABILITY_CUES = {'with', 'has', 'having', 'ability', 'abilities', 'that', 'its', 'and', 'or', 'the'}
MOVE_CUES = {'with', 'knowing', 'knows', 'know', 'has', 'having', 'learn', 'learned', 'learns', 'teach', 'forget', 'unlearn', 'move', 'moves',
             'and', 'using', 'plus'}


def key(text):
    return ' '.join(w for w in _tokens(text) if w != ',')


class Vocabulary:
    """Species, items, balls, held items, moves, natures, places, stats and genders."""
    _default = None
    _lock = threading.Lock()

    def __init__(self, dex, items, places, national=(), national_abilities=()):
        self.dex = dex
        self.species = {s['id']: s for s in dex['species']}
        self.names = {s['id']: s['name'] for s in dex['species']}
        self.national = dict(national)
        self.items = {i['id']: i['name'] for i in items}
        self.moves = {m['id']: m['name'] for m in dex['moves']}
        self.places = {p['id']: p['name'] for p in places}
        self.index = {}
        self.joined = {}
        self.phon = {'species': {}, 'place': {}}
        for s in dex['species']:
            self._add('species', s['name'], s['id'], s['name'])
        for alias, ids in SPECIES_ALIASES.items():
            for sid in ids:
                self._add('species', alias, sid, self.names[sid])
        for sid, name in self.national.items():
            if sid not in self.names:
                self._add('other', name, sid, name, fuzzy=False)
        for b in dex['balls']:
            self._add('ball', b['name'], b['id'], b['name'])
        for i in items:
            if re.fullmatch(r'[0-9A-Fa-f?]{2,4}', i['name']) or not i['name'].strip():
                continue
            self._add('item', i['name'], i['id'], i['name'])
        for h in dex.get('heldItems', []):
            self._add('held', h['name'], h['id'], h['name'])
        for m in dex['moves']:
            self._add('move', m['name'], m['id'], m['name'], fuzzy=False)
        self.abilities = {}
        self.ability_species = {}
        for sp in dex['species']:
            for a in sp['abilities']:
                self.abilities.setdefault(a['id'], a['name'])
                self.ability_species.setdefault(a['id'], []).append(sp['id'])
        for aid, name in self.abilities.items():
            self._add('ability', name, aid, name)
        self.later_abilities = {aid: name for aid, name in dict(national_abilities).items() if aid not in self.abilities}
        for aid, name in self.later_abilities.items():
            self._add('other-ability', name, aid, name, fuzzy=False)
        for n in dex['natures']:
            self._add('nature', n['name'], n['id'], n['name'])
        for p in places:
            for alias in [p['name'], *p.get('aliases', [])]:
                alias = re.sub(r'^(the|a) ', '', alias.lower())
                self._add('place', alias, p['id'], p['name'])
            if p['id'].endswith('_GYM'):
                self._add('place', 'gym', p['id'], p['name'])
        for canonical, aliases in STAT_ALIASES.items():
            for alias in aliases:
                self._add('stat', alias, canonical, canonical, fuzzy=False)
        for word, value in GENDERS.items():
            self._add('gender', word, value, value, fuzzy=False)
        self.fuzzy_single = {k: sorted({w for w, hits in self.index.items() if ' ' not in w and any(h.kind == k for h in hits)}) for k in FUZZY_KINDS}
        self.fuzzy_multi = {k: sorted({w for w, hits in self.index.items() if ' ' in w and any(h.kind == k for h in hits)}) for k in FUZZY_KINDS}
        self.fuzzy_joined = {k: sorted({w for w, hits in self.joined.items() if any(h.kind == k for h in hits)}) for k in FUZZY_KINDS}

    def _add(self, kind, text, value, label, fuzzy=True):
        k = key(text)
        if not k:
            return
        hit = Hit(kind, value, label)
        self.index.setdefault(k, [])
        if hit not in self.index[k]:
            self.index[k].append(hit)
        joined = k.replace(' ', '')
        if ' ' in k:
            self.joined.setdefault(joined, [])
            if hit not in self.joined[joined]:
                self.joined[joined].append(hit)
        if kind in self.phon and fuzzy:
            p = phonetic(joined)
            if len(p) >= 3:
                self.phon[kind].setdefault(p, [])
                if hit not in self.phon[kind][p]:
                    self.phon[kind][p].append(hit)

    @classmethod
    def default(cls):
        with cls._lock:
            if cls._default is None:
                cls._default = cls.load()
            return cls._default

    @classmethod
    def load(cls):
        from .pokemon_farming import catalog
        dex = catalog('firered')
        items = json.loads((DATA / 'pokedex' / 'firered-items.json').read_text())['items']
        places = json.loads((DATA / 'requests' / 'firered-places.json').read_text())['places']
        national, abilities = {}, {}
        try:
            import sqlite3
            db = sqlite3.connect((DATA / 'pokedex' / 'master.sqlite3').resolve().as_uri() + '?mode=ro', uri=True)
            try:
                national = dict(db.execute('SELECT pokemon_species_id, name FROM pokemon_species_names WHERE local_language_id=9'))
                abilities = dict(db.execute('SELECT ability_id, name FROM ability_names WHERE local_language_id=9'))
            finally:
                db.close()
        except Exception:
            national, abilities = {}, {}
        return cls(dex, items, places, national, abilities)

    def name(self, sid):
        return self.names.get(sid) or self.national.get(sid) or f'#{sid}'

    def exact(self, k, extra=None):
        hits = list(self.index.get(k, []))
        if extra:
            hits += [h for h in extra.get(k, []) if h not in hits]
        return hits

    def singular(self, words, extra=None):
        last = words[-1]
        forms = []
        if len(last) > 4 and last.endswith('ies'):
            forms += [last[:-3] + 'y', last[:-1]]
        if len(last) > 3 and last.endswith('es'):
            forms.append(last[:-2])
        if len(last) >= 3 and last.endswith('s') and not last.endswith('ss'):
            forms.append(last[:-1])
        for form in forms:
            hits = [h for h in self.exact(' '.join(words[:-1] + [form]), extra) if h.kind in ('species', 'item', 'ball', 'held', 'other')]
            if hits:
                return hits
            if len(words) > 1:
                hits = [h for h in self.joined.get(''.join(words[:-1]) + form, []) if h.kind in ('species', 'item', 'ball', 'held')]
                if hits:
                    return hits
        return []

    def fuzzy(self, words, kinds=FUZZY_KINDS, extra_keys=None):
        """Close vocabulary entries for a 1-3 token window: [(Hit, score)]."""
        spaced = ' '.join(words)
        joined = ''.join(words)
        results = []
        for kind in kinds:
            pools = []
            if len(words) == 1:
                cutoff = 0.8 if len(joined) >= 4 else 1.1
                pools.append((self.fuzzy_single[kind], spaced, cutoff, self.index))
                pools.append((self.fuzzy_joined[kind], joined, max(cutoff, 0.82), self.joined))
            else:
                pools.append((self.fuzzy_multi[kind], spaced, 0.82, self.index))
                pools.append((self.fuzzy_joined[kind] + self.fuzzy_single[kind], joined, 0.84, None))
            for pool, probe, cutoff, table in pools:
                if cutoff > 1:
                    continue
                for match in difflib.get_close_matches(probe, pool, n=4, cutoff=cutoff):
                    score = difflib.SequenceMatcher(None, probe, match).ratio()
                    source = table if table is not None else (self.joined if match in self.joined else self.index)
                    for hit in source.get(match, []):
                        if hit.kind == kind:
                            results.append((hit, score))
            if kind in self.phon and len(joined) >= 5:
                p = phonetic(joined)
                hits = self.phon[kind].get(p, [])
                if len({h.value for h in hits}) == 1:
                    results += [(h, 0.8) for h in hits]
        if extra_keys:
            for match in difflib.get_close_matches(spaced, list(extra_keys), n=3, cutoff=0.84):
                for hit in extra_keys[match]:
                    results.append((hit, difflib.SequenceMatcher(None, spaced, match).ratio()))
        best = {}
        for hit, score in results:
            k = (hit.kind, hit.value)
            if k not in best or best[k][1] < score:
                best[k] = (hit, score)
        return sorted(best.values(), key=lambda x: -x[1])

    def overlay(self, locations=None, extra=()):
        """Per-request additions: live travel locations and owned Pokémon names."""
        table = {}
        for loc in locations or []:
            if isinstance(loc, dict) and loc.get('id') and loc['id'] not in self.places:
                k = key(loc.get('name') or loc['id'].removeprefix('MAP_').replace('_', ' '))
                if k:
                    table.setdefault(k, []).append(Hit('place', loc['id'], loc.get('name') or k.title()))
        for k, hit in extra:
            if k:
                table.setdefault(k, []).append(hit)
        return table


# ---------------------------------------------------------------------------
# Clause splitting
# ---------------------------------------------------------------------------
ACTION_START = {
    'catch', 'capture', 'hunt', 'farm', 'snag', 'nab', 'get', 'find', 'grab', 'bring', 'fetch', 'buy', 'purchase', 'shop', 'stock', 'go', 'fly',
    'travel', 'head', 'walk', 'take', 'visit', 'return', 'teleport', 'heal', 'restore', 'save', 'stop', 'pause', 'halt', 'freeze', 'resume',
    'continue', 'unpause', 'keep', 'carry', 'start', 'begin', 'boot', 'load', 'launch', 'play', 'restart', 'trade', 'send', 'give', 'ev',
    'train', 'level', 'evolve', 'release', 'teach', 'close', 'quit', 'shut', 'exit', 'turn', 'set', 'change', 'enable', 'disable', 'make',
    'create', 'open', 'complete', 'finish', 'collect', 'fill', 'work', 'run', 'do', 'switch', 'cancel', 'tell', 'show', 'list', 'what', 'where',
    'how', 'who', 'which', 'is', 'are', 'any', 'did', 'shiny', 'please', 'can', 'could', 'would', 'lets', 'rest', 'visit', 'pick', 'forget',
    'rename', 'battle', 'fight', 'challenge', 'beat', 'wait', 'hold', 'resume'}
SEPARATORS = [('and', 'then'), ('and', 'after', 'that'), ('after', 'that'), ('afterwards',), ('afterward',), ('then',), ('followed', 'by'),
              ('once', 'you', 'are', 'done'), ('when', 'you', 'are', 'done'), ('when', 'done'), ('once', 'done'), (',',), ('also',)]
DETERMINERS = {'a', 'an', 'some', 'another', 'more', 'the'}
BARE = {'heal', 'save', 'stop', 'pause', 'resume', 'continue', 'quit'}
AUXILIARY = {'you', 'we', 'i', 'have', 'had', 'are', 'were', 'is', 'did', 'do', 've', 'it', 'they'}


def _starts_action(words):
    if not words:
        return False
    if words[0] == 'i':
        return len(words) > 1 and words[1] in {'want', 'need', 'would', 'wanna', 'like'}
    return words[0] in ACTION_START


SCOPE_ONLY = {('by', 'default'), ('from', 'now', 'on'), ('always',), ('going', 'forward'), ('in', 'the', 'future'), ('for', 'future', 'hunts'),
              ('for', 'new', 'requests'), ('as', 'a', 'default'), ('ok', 'so'), ('so',), ('alright',), ('hey',), ('okay',)}


SLOT_WORDS = {'shiny', 'shinies', 'non', 'regular', 'normal', 'named', 'called', 'nickname', 'name', 'starter', 'trainer', 'level', 'ivs', 'iv',
              'evs', 'ev', 'perfect', 'max', 'male', 'female', 'preferably', 'ideally', 'random', 'colors', 'colours', 'color', 'stage', 'stages'}


def _slot_words(words):
    return bool(set(words) & SLOT_WORDS or any(w.isdigit() for w in words))


def _attaches_forward(words):
    """A fragment that only scopes or conditions the next one ("by default,", "when a hunt is done,")."""
    if tuple(words) in SCOPE_ONLY:
        return True
    return bool(words) and words[0] in ('when', 'whenever', 'once', 'if', 'while', 'until') and not _starts_action(words[1:])


def _verb_phrase(words, vocab):
    out = []
    for i, w in enumerate(words):
        if w in DETERMINERS or w.isdigit() or w == 'shiny' or vocab.exact(w) or vocab.exact(' '.join(words[i:i + 2])):
            break
        out.append(w)
    return out


def _entity_kinds(words, vocab):
    kinds = set()
    for i in range(len(words)):
        for L in (3, 2, 1):
            chunk = words[i:i + L]
            if len(chunk) < L:
                continue
            hits = vocab.exact(' '.join(chunk)) or vocab.singular(chunk)
            kinds |= {h.kind for h in hits}
    return kinds


RUN_ON = 0.6  # each piece of an unpunctuated run-on must score this on its own (above CONFIRM_BELOW)
RUN_ON_WORDS = 24  # and be one step long (bounds the search on a 1000-character ramble)
INVERSIONS = {'is', 'are', 'do', 'did'}  # mid-clause these belong to a question ("what goals are queued"), not a new step
# Never after a spoken correction ("catch a pikachu actually go to cinnabar") or a word that needs what follows ("catch a pikachu new save").
NO_SPLIT_AFTER = DETERMINERS | {'actually', 'wait', 'no', 'nah', 'oops', 'sorry', 'instead', 'rather', 'mean', 'new', 'fresh', 'brand', 'current', 'my',
                                'your', 'our', 'to', 'of', 'for', 'with', 'on', 'in', 'at', 'from', 'into', 'and', 'or'}
STOP_OBJECT = re.compile(r'\b(bot|game|emulator|console|everything|\w+ing)\b')  # "stop the bot", "stop hunting": a step; a bare "stop"/"wait" is not


def _alone(words, vocab, overlay, memo):
    """(top intent, score, a confident step on its own, one that only lacks what "it" points back to) for a fragment, by the code layer."""
    k = tuple(words)
    if k not in memo:
        c = Clause(0, list(words))
        c.spans = find_spans(c.tokens, vocab, overlay)
        top_id, top, details = score_clause(c, vocab)[0]
        sure = top >= RUN_ON and c.anchored and BY_ID[top_id].kind != 'unsupported'
        met = details['requirement'] == 1.0
        memo[k] = (top_id, top, sure and met, sure and not met and bool({'it', 'them'} & set(words)))
    return memo[k]


def _run_on(words, vocab, overlay=None, memo=None):
    """"heal my team go to cinnabar": dictation adds no commas, so a clause splits at a verb when every piece is a confident
    step on its own (a later one may point back: "catch a timid abra ev train it in speed") and the two sides of the verb
    read worse joined ("restore my main" + "save" do not). Never inside an entity ("buy 5 full restores"), never at an
    auxiliary, never a question before an action ("is my team healed", "should i heal go to cinnabar") and never a take-back:
    no piece is a cancel (it would cancel the goal already running: "catch a pikachu cancel that", "never mind go to cinnabar")
    or a bare stop ("catch a pikachu wait go to cinnabar"), and nothing splits after "actually", "no" or "wait"."""
    memo = {} if memo is None else memo
    words = list(words)
    done = (None,) + tuple(words)
    if done in memo:
        return memo[done]
    inside = {t for s in find_spans(words, vocab, overlay) for t in range(s.start, s.end)} if len(words) > 1 else set()
    found = {}

    def pieces(i):
        if i in found:
            return found[i]
        found[i] = [words[i:]]
        for k in range(i + 1, min(len(words), i + RUN_ON_WORDS + 1)):
            if k in inside or words[k] in INVERSIONS or words[k - 1] in NO_SPLIT_AFTER or not _starts_action(words[k:]):
                continue
            head = _alone(words[i:k], vocab, overlay, memo)
            if not (head[2] or (i and head[3])):
                continue
            out = [words[i:k]] + pieces(k)
            if len(out[-1]) > RUN_ON_WORDS:
                continue
            reads = [_alone(p, vocab, overlay, memo) for p in out]
            if any(r[0] == 'goal-cancel' or r[0] in ('bot-stop', 'game-stop') and not STOP_OBJECT.search(' '.join(p)) for r, p in zip(reads, out)):
                continue
            asks = [BY_ID[r[0]].kind in ('status', 'help') or _idle_question(p) for r, p in zip(reads, out)]
            joined, score = _alone(out[0] + out[1], vocab, overlay, memo)[:2]
            if all(r[2] or r[3] for r in reads[1:]) and not any(x and not y for x, y in zip(asks, asks[1:])) \
                    and (score < ACCEPT or any(r[0] == joined and r[1] > score for r in reads[:2])):
                found[i] = out
                break
        return found[i]
    memo[done] = pieces(0)
    return memo[done]


def split_clauses(text, vocab=None, overlay=None):
    """Ordered clauses from a normalized request."""
    vocab = vocab or Vocabulary.default()
    memo = {}
    words = text.split() if isinstance(text, str) else list(text)
    parts = [[]]
    i = 0
    while i < len(words):
        for sep in SEPARATORS:
            if tuple(words[i:i + len(sep)]) == sep:
                parts.append([])
                i += len(sep)
                break
        else:
            parts[-1].append(words[i])
            i += 1
    clauses = []
    for part in parts:
        while part and part[0] in ('and', 'also', 'plus', 'first', 'then'):
            part = part[1:]
        if not part:
            continue
        if clauses and not _starts_action(part) and (part[0] in DETERMINERS or part[0].isdigit() or len(part) <= 3) \
                and {'species', 'item', 'ball'} & _entity_kinds(part, vocab) & _entity_kinds(clauses[-1], vocab):
            verb = _verb_phrase(_run_on(clauses[-1], vocab, overlay, memo)[-1], vocab)
            if verb and _starts_action(verb):
                part = list(verb) + part
        # "heal save": two bare commands in a row.
        bare = []
        for w in part:
            if bare and bare[-1] and bare[-1][-1] in BARE and w in BARE and len(bare[-1]) == 1:
                bare.append([w])
            else:
                if not bare:
                    bare.append([])
                bare[-1].append(w)
        if len(bare) > 1:
            clauses += bare[:-1]
            part = bare[-1]
        # "X and Y": split when Y is an action, or an elided repeat ("buy 5 potions and 10 ultra balls").
        current = []
        j = 0
        while j < len(part):
            w = part[j]
            rest = part[j + 1:]
            if w == 'and' and current and rest:
                if _starts_action(rest):
                    clauses.append(current); current = []; j += 1; continue
                if (rest[0] in DETERMINERS or rest[0].isdigit()) and {'species', 'item', 'ball'} & _entity_kinds(rest, vocab) \
                        and {'species', 'item', 'ball'} & _entity_kinds(current, vocab):
                    verb = _verb_phrase(_run_on(current, vocab, overlay, memo)[-1], vocab)  # "go to celadon buy 5 potions and 10 ultra balls"
                    if verb:
                        clauses.append(current); current = list(verb); j += 1; continue
            current.append(w)
            j += 1
        if current:
            clauses.append(current)
    # Reorder "X after (you) Y" -> Y, X and "X before (you) Y" -> X, Y.
    ordered = []
    for clause in clauses:
        lead = [w for w in clause[1:] if w not in AUXILIARY and w not in ('your', 'done', 'finished', 'finish', 'with', 'are', 're')]
        if clause[0] in ('after', 'before') and len(clause) > 1 and _starts_action(lead[:1]):
            body = clause[1:]
            while body and (body[0] in AUXILIARY or body[0] in ('your', 'done', 'finished', 'finish', 'with', 'are', 're')):
                body = body[1:]
            second = next((k for k in range(1, len(body)) if _starts_action(body[k:])), None)
            if second:
                first_part, other = body[:second], body[second:]
                ordered += [first_part, other] if clause[0] == 'after' else [other, first_part]
                continue
            ordered.append(('after' if clause[0] == 'after' else 'before', body))
            continue
        k = next((k for k in range(1, len(clause)) if clause[k] in ('after', 'before', 'once')
                  and _starts_action([w for w in clause[k + 1:] if w not in AUXILIARY])), None)
        if k:
            head, tail = clause[:k], [w for w in clause[k + 1:]]
            while tail and tail[0] in AUXILIARY:
                tail = tail[1:]
            ordered += [head, tail] if clause[k] == 'before' else [tail, head]
            continue
        ordered.append(clause)
    result = []
    pending = None
    for item in ordered:
        if isinstance(item, tuple):
            pending = item
            continue
        if pending:
            kind, body = pending
            result += [body, item] if kind == 'after' else [item, body]
            pending = None
        else:
            result.append(item)
    if pending:
        result.append(pending[1])
    return [' '.join(p) for c in result if c for p in _run_on(c, vocab, overlay, memo)]


# ---------------------------------------------------------------------------
# Action catalog
# ---------------------------------------------------------------------------
FILLERS = {'a', 'an', 'the', 'my', 'me', 'i', 'you', 'your', 'we', 'us', 'our', 'it', 'its', 'them', 'they', 'please', 'can', 'could', 'would',
           'will', 'shall', 'should', 'just', 'now', 'right', 'real', 'quick', 'quickly', 'asap', 'for', 'to', 'of', 'some', 'any', 'hey', 'hi',
           'yo', 'okay', 'ok', 'so', 'bot', 'do', 'does', 'really', 'also', 'too', 'then', 'and', 'kindly', 'pretty', 'this', 'that', 'there',
           'here', 'thanks', 'thank', 'mind', 'if', 'possible', 'sure', 'am', 'be', 'is', 'are', 'was', 'ahead', 'let', 'lets', 'yeah', 'yes',
           'maybe', 'well', 'actually', 'id', 'myself', 'yourself', 'while', 'again', 'at', 'on', 'in', 'by', 'with', 'from', 'up', 'one', 'ones',
           'got', 'has', 'had', 'dear', 'buddy', 'mate', 'bro', 'dude', 'alright', 'first', 'finally', 'lastly', 'tonight', 'today', 'later',
           'bit', 'while', 'probably', 'think', 'guess', 'hoping', 'hope', 'wondering', 'know', 'basically', 'literally', 'totally', 'even', 'still',
           'anyway', 'anyways', 'though', 'instead', 'honestly', 'but', 'yesterday', 'earlier', 'like', 'just', 'kind', 'sort', 'quite'}


def A(pattern, weight):
    return (re.compile(pattern), weight)


@dataclass
class Intent:
    id: str
    kind: str
    description: str
    examples: list
    slots: dict
    anchors: list
    words: set = field(default_factory=set)
    requires: tuple = ()
    build: object = None
    verbless: float = 0.0
    message: str = ''
    penalty: float = 2.0
    numbers: bool = False
    bonus: float = 0.0
    entities: frozenset = None
    _templates: list = field(default=None, repr=False)
    _anchor_words: set = field(default=None, repr=False)


SHINY_WORDS = {'shiny', 'non', 'not', 'regular', 'normal', 'colored', 'colour', 'color', 'coloured', 'does', 'need', 'needs', 'be', 'any', 'old',
               'shinies'}
CATCH_WORDS = {'catch', 'capture', 'hunt', 'farm', 'snag', 'nab', 'get', 'find', 'grab', 'bring', 'obtain', 'acquire', 'fetch', 'give', 'want', 'need',
               'have', 'like', 'look', 'looking', 'search', 'after', 'named', 'called', 'nickname', 'nicknamed', 'name', 'perfect', 'max', 'maxed',
               'ivs', 'iv', 'stat', 'stats', 'every', 'all', 'each', 'least', 'level', 'trained', 'train', 'leveled', 'levelled', 'raised', 'holding',
               'holds', 'hold', 'held', 'knows', 'knowing', 'know', 'that', 'move', 'moves', 'nature', 'ball', 'balls', 'preferably', 'ideally',
               'prefer', 'preferred', 'if', 'possible', 'one', 'ones', 'pokemon', 'x', 'times', 'between', 'flawless', 'good', 'wild', 'new', 'another',
               'more', 'extra', 'something', 'anything', 'mon', 'couple', 'pair', 'dozen', 'caught', 'go', 'out', 'and', 'or', 'up', 'using', 'use',
               'wit', 'please', 'catches', 'from', 'on', 'at', 'in', 'lots', 'of', 'bunch', 'few', 'several', 'many', 'fast', 'asap', 'hurry',
               'right', 'away', 'minimum', 'above', 'over', 'plus', 'shiny', 'it', 'ivd', 'perfectly', 'high', 'best', 'possible', 'learned',
               'has', 'having', 'which', 'with', 'x', 'hunting', 'catching', 'farming', 'me', 'pokemon', 'down', 'track', 'until', 'soft', 'reset',
               'resetting', 'sr', 'encounter', 'hatch', 'go', 'get', 'out', 'try', 'attempt', 'some', 'colors', 'colours', 'fine', 'whatever',
               'matter', 'either', 'without', 'ability', 'abilities', 'its', 'min', 'minimum', 'low', 'lowest', 'zero', 'bad', 'worst', 'poor',
               'high', 'most', 'under', 'below', 'less', 'lower', 'fewer', 'exactly', 'ev', 'evs', 'effort', 'values', 'trained', 'training', 'spread',
               'full', 'then', 'hidden', 'power', 'type'} | SHINY_WORDS | {g for g in GAMES if ' ' not in g}
ITEM_WORDS = {'buy', 'purchase', 'shop', 'shopping', 'stock', 'up', 'on', 'pick', 'get', 'find', 'grab', 'fetch', 'obtain', 'need', 'want', 'more',
              'some', 'extra', 'couple', 'of', 'x', 'times', 'units', 'stuff', 'things', 'items', 'item', 'supplies', 'go', 'we', 'dozen', 'few',
              'bunch', 'lots', 'several', 'many', 'another', 'additional', 'a', 'me', 'us', 'mart', 'shop', 'store', 'pokemart', 'from', 'them',
              'at', 'least', 'total', 'in', 'bag', 'my'}
TRAVEL_WORDS = {'go', 'travel', 'fly', 'head', 'walk', 'move', 'return', 'teleport', 'take', 'get', 'run', 'bike', 'visit', 'trip', 'over', 'on',
                'back', 'there', 'down', 'somewhere', 'place', 'location', 'town', 'city', 'area', 'route', 'let', 'us', 'lets', 'bring', 'want',
                'into', 'inside', 'toward', 'towards', 'straight', 'directly', 'quickly', 'right', 'away', 'now', 'home', 'fast', 'way', 'in',
                'at', 'near', 'by', 'next', 'the', 'up', 'out', 'make', 'your', 'our', 'hop', 'pop', 'swing', 'zip', 'warp', 'navigate', 'somewhere',
                'anywhere', 'else'} - {'away'}
HEAL_WORDS = {'heal', 'healed', 'healing', 'restore', 'patch', 'fix', 'recover', 'rest', 'up', 'team', 'party', 'pokemon', 'everyone', 'everybody',
              'them', 'center', 'centre', 'health', 'hp', 'pp', 'status', 'all', 'hurt', 'injured', 'tired', 'fainted', 'go', 'get', 'visit',
              'full', 'back', 'nurse', 'joy', 'pokecenter', 'guys', 'squad', 'whole', 'our', 'their', 'low', 'is', 'are', 'my', 'up', 'and',
              'health', 'pp', 'hp', 'status', 'conditions', 'condition', 'restore', 'refill', 'top', 'off', 'pokemons'}
SAVE_WORDS = {'save', 'game', 'progress', 'now', 'it', 'your', 'in', 'ingame', 'quick', 'make', 'sure', 'write', 'cartridge', 'first', 'real',
              'quickly', 'file', 'state', 'everything', 'please', 'remember', 'to', 'the', 'go', 'ahead', 'current', 'properly'}
BOT_WORDS = {'bot', 'game', 'emulator', 'console', 'up', 'the', 'please', 'on', 'ready', 'start', 'boot', 'power', 'fire', 'wake', 'load',
             'launch', 'turn', 'get', 'pokemon', 'firered', 'again', 'back', 'playing'}
RESUME_WORDS = {'resume', 'unpause', 'continue', 'keep', 'carry', 'going', 'on', 'pick', 'up', 'where', 'left', 'off', 'what', 'were', 'doing',
                'hunt', 'bot', 'task', 'now', 'can', 'ok', 'okay', 'go', 'back', 'playing', 'it', 'again', 'working', 'with', 'hunting', 'run',
                'running', 'yourself', 'you'}
STOP_WORDS = {'stop', 'pause', 'halt', 'freeze', 'hold', 'on', 'break', 'take', 'wait', 'whoa', 'woah', 'bot', 'hunt', 'what', 'you', 'are',
              'doing', 'youre', 'sec', 'second', 'moment', 'minute', 'playing', 'everything', 'right', 'now', 'hunting', 'it', 'there', 'task',
              'the', 'please', 'immediately'}
GAME_STOP_WORDS = {'close', 'quit', 'exit', 'shut', 'turn', 'off', 'power', 'kill', 'down', 'game', 'emulator', 'console', 'the', 'it', 'everything',
                   'done', 'finished', 'night', 'am', 'got', 'go', 'have', 'bed'}
CANCEL_WORDS = {'cancel', 'never', 'mind', 'nevermind', 'forget', 'about', 'goal', 'goals', 'request', 'requests', 'that', 'current', 'last',
                'hunt', 'it', 'order', 'plan', 'the', 'my', 'previous', 'latest', 'call', 'off', 'abort', 'scrap', 'drop', 'this', 'one', 'search',
                'task', 'whatever', 'running', 'active', 'currently', 'is', 'on', 'anymore', 'not', 'want', 'no', 'longer', 'do'}
POSTGAME_WORDS = {'postgame', 'do', 'work', 'on', 'checklist', 'finish', 'complete', 'stuff', 'continue', 'goals', 'objectives', 'go', 'run',
                  'through', 'list', 'tasks', 'start', 'resume', 'keep', 'working', 'the', 'rest', 'of', 'remaining', 'agenda', 'knock', 'out',
                  'wrap', 'up', 'handle', 'tackle', 'clear', 'take', 'care', 'things', 'content', 'everything'}
COLLECTION_WORDS = {'collect', 'collection', 'catch', 'get', 'every', 'all', 'shiny', 'shinies', 'national', 'dex', 'pokedex', 'complete',
                    'fill', 'out', 'finish', 'work', 'on', 'living', 'including', 'evolution', 'evolutions', 'stage', 'stages', 'each', 'you',
                    'can', 'go', 'pokemon', 'the', 'of', 'entire', 'whole', 'full', 'forms', 'base', 'starting', 'start', 'begin', 'keep'}
NEWGAME_WORDS = {'start', 'begin', 'new', 'game', 'as', 'pick', 'choose', 'starter', 'name', 'trainer', 'called', 'named', 'random', 'from',
                 'scratch', 'over', 'again', 'whole', 'play', 'through', 'beat', 'run', 'adventure', 'fresh', 'brand', 'campaign', 'playthrough',
                 'restart', 'use', 'player', 'call', 'is', 'titled', 'story', 'league', 'then', 'wait', 'after', 'beginning', 'start',
                 'with', 'and', 'the', 'my', 'me', 'a', 'save', 'file', 'as', 'reset', 'entire', 'journey', 'kanto', 'very', 'first', 'go', 'up',
                 'character', 'boy', 'girl', 'totally', 'completely', 'all', 'way', 'through', 'which', 'ask', 'yet', 'sure', 'decide', 'do',
                 'not', 'know', 'dunno', 'undecided', 'first'}
SAVE_NEW_WORDS = {'new', 'save', 'file', 'profile', 'slot', 'manual', 'called', 'named', 'label', 'labeled', 'labelled', 'titled', 'open', 'create',
                  'make', 'start', 'blank', 'fresh', 'empty', 'so', 'can', 'play', 'myself', 'manually', 'myself', 'own', 'separate', 'another',
                  'second', 'different', 'extra', 'additional', 'spin', 'up', 'set'}
RESTORE_WORDS = {'restore', 'load', 'reload', 'switch', 'back', 'go', 'revert', 'return', 'open', 'save', 'backup', 'backups', 'profile', 'file',
                 'old', 'previous', 'older', 'earlier', 'other', 'main', 'to', 'my', 'the', 'use', 'slot', 'game'}
TRADE_WORDS = {'trade', 'trading', 'send', 'away', 'over', 'shiny', 'pc', 'box', 'put', 'up', 'for', 'wanna', 'want', 'partner', 'give', 'offer',
               'emerald', 'leafgreen', 'firered', 'game', 'the', 'my', 'in', 'from', 'to', 'one', 'off', 'transfer', 'regular', 'normal', 'non',
               'not', 'slot', 'party', 'number'}
SETTINGS_WORDS = {'default', 'defaults', 'by', 'always', 'from', 'now', 'on', 'set', 'change', 'make', 'turn', 'off', 'enable', 'disable',
                  'limit', 'limits', 'prefer', 'preferred', 'ball', 'balls', 'pokeball', 'nature', 'natures', 'shiny', 'shinies', 'required',
                  'require', 'optional', 'only', 'catch', 'use', 'should', 'be', 'setting', 'settings', 'rare', 'candy', 'candies', 'supply',
                  'glitch', 'mail', 'qmm', 'question', 'mark', 'after', 'catching', 'something', 'prepare', 'trade', 'trades', 'collect', 'every',
                  'each', 'evolution', 'stage', 'stages', 'base', 'forms', 'hunts', 'hunt', 'minutes', 'minute', 'hours', 'hour', 'max', 'maximum',
                  'encounters', 'encounter', 'spend', 'money', 'budget', 'keep', 'reserve', 'at', 'least', 'most', 'my', 'the', 'to', 'pokemon',
                  'gender', 'all', 'catches', 'stop', 'and', 'it', 'up', 'favorite', 'save', 'saving', 'new', 'requests', 'female', 'male',
                  'something', 'anything', 'catch', 'caught', 'i', 'when', 'time', 'per', 'cap', 'capped', 'must', 'have', 'has', 'need', 'needs',
                  'done', 'finished', 'finishes', 'prep', 'prepped', 'ready', 'so', 'request', 'is', 'a', 'mode', 'option', 'preference',
                  'preferences', 'forward', 'onward', 'onwards', 'future', 'collection', 'include', 'includes', 'including', 'collections', 'grab',
                  'not', 'just', 'only', 'instead', 'of'}
EV_WORDS = {'ev', 'evs', 'train', 'training', 'effort', 'value', 'values', 'max', 'out', 'maxed', 'on', 'in', 'for', 'and', 'give', 'my',
            'full', 'all', 'points', 'put', 'into', 'stat', 'stats', 'the', 'of', 'to', 'pokemon', 'team', 'party', 'start', 'begin', 'do',
            'some', 'work', 'something', 'anything', 'someone'}
STATUS_WORDS = {'looking', 'look', 'queue', 'pending', 'shape', 'holding', 'own', 'owned', 'got', 'collected', 'currently', 'kind', 'kinds', 'sort', 'sorts', 'type', 'types', 'this', 'that', 'these',
                'those', 'playthrough', 'game', 'run', 'save', 'adventure', 'story', 'campaign', 'there', 'much',
                'what', 'whats', 'who', 'where', 'how', 'show', 'list', 'tell', 'any', 'is', 'are', 'my', 'the', 'you', 'we', 'do', 'i', 'have',
                'with', 'me', 'many', 'much', 'so', 'far', 'going', 'doing', 'right', 'now', 'at', 'yet', 'anything', 'currently', 'current',
                'player', 'of', 'in', 'latest', 'newest', 'recent', 'am', 'did', 'display', 'give', 'status', 'about', 'all', 'there', 'see',
                'look', 'check', 'which', 'long', 'report', 'update', 'am', 'got', 'along', 'its'}
UNSUPPORTED_WORDS = {'my', 'the', 'all', 'of', 'into', 'wild', 'please', 'make', 'it', 'to', 'up', 'on', 'in', 'a', 'team', 'go', 'with',
                     'and', 'can', 'you', 'for', 'me', 'some', 'every', 'pokemon', 'level', 'them', 'him', 'her', 'set', 'let', 'loose', 'at',
                     'game', 'run'}

Q = r'(\b(what|who|where|how|show|list|tell|any|did|which|display|give|check)\b|^(is|are|do|does|did|am)\b)'


def _intents():
    return [
        Intent('catch', 'farming', 'Catch or hunt a specific Pokémon species (shiny, nature, gender, ball, IVs, quantity, nickname, level, moves, held item).',
               ['get me a shiny mewtwo', 'catch 3 adamant abras in ultra balls', 'shiny hunt a female eevee named vee', 'i want a jolly scyther with perfect ivs'],
               {'species': 'Pokémon species (FireRed #1-386)', 'shiny': 'required|any', 'quantity': '1-99', 'natures': 'nature ids', 'gender': 'male|female|genderless',
                'ball': 'ball id', 'ballRequirement': 'required|preferred', 'minIvs': 'stat -> 0..31', 'nickname': 'up to 10 letters',
                'finalLevel': 'level', 'encounterLevel': '{min,max}', 'moves': 'move ids', 'heldItem': 'held item id', 'location': 'encounter location'},
               [A(r'\b(catch|capture|hunt|farm|snag|nab)\b', 1.0), A(r'\bshiny hunt\b', 1.0), A(r'\b(soft )?reset\b( \w+){0,3} (until|for)\b|\bsoft reset\b', 1.0),
                A(r'\btrack down\b', 1.0), A(r'\b(get|find|grab|bring|obtain|acquire|fetch|give)\b', 0.72),
                A(r'\b(want|need|have)\b|\bwould like\b', 0.62), A(r'\blook(ing)? for\b|\bsearch for\b|\bgo after\b', 0.75)],
               CATCH_WORDS, ('species', 'other'), verbless=0.66, numbers=True),
        Intent('travel', 'player-task', 'Travel to a town, route or building and save there.',
               ['go to cinnabar', 'fly to the indigo plateau', 'take me to cerulean cave', 'head over to route 24'],
               {'place': 'map id'},
               [A(r'\b(go|travel|fly|head|walk|move|return|teleport|run|bike|surf|drive|get|take|bring)\b( \w+){0,3} to\b', 1.0),
                A(r'\b(visit|trip to)\b', 0.9), A(r'\bgo home\b', 1.0), A(r'\b(go|fly|travel|head|walk)\b', 0.6)],
               TRAVEL_WORDS, ('place',), numbers=True),
        Intent('item', 'player-task', 'Find or buy a quantity of an item from reachable pickups or shops.',
               ['buy 10 ultra balls', 'get 5 rare candies', 'find a fire stone', 'stock up on 20 potions'],
               {'item': 'item id', 'quantity': '1-99'},
               [A(r'\b(buy|purchase|shop|shopping)\b', 1.0), A(r'\bstock up\b', 1.0), A(r'\bpick( me)? up\b', 0.85),
                A(r'\b(get|find|grab|fetch|obtain)\b', 0.72), A(r'\b(need|want)\b', 0.62)],
               ITEM_WORDS, ('item', 'ball', 'held'), numbers=True),
        Intent('heal', 'player-task', 'Heal the party (HP, status and PP) at a reachable healing spot, then save.',
               ['heal', 'heal the team', 'go to a pokemon center', 'restore my pokemon'],
               {}, [A(r'\bheal(ed|ing)?\b', 1.0), A(r'\bnurse joy\b', 1.0), A(r'\b(pokemon cent(er|re)|pokecenter)\b', 0.85),
                    A(r'\b(restore|patch|fix|recover|refill|top off)\b', 0.72), A(r'\brest\b', 0.6)],
               HEAL_WORDS),
        Intent('save-game', 'player-task', 'Save the current game through the in-game menu.',
               ['save', 'save the game', 'save your progress'],
               {}, [A(r'\bsave\b', 1.0)], SAVE_WORDS),
        Intent('ev-training', 'player-task', 'EV-train a party Pokémon to exact effort values.',
               ['ev train my alakazam in special attack and speed', 'give my dragonite 252 attack and 252 speed evs'],
               {'target': 'party Pokémon', 'evs': 'stat -> 0..252'},
               [A(r'\bev(s)?( ?train(ing)?)?\b', 1.0), A(r'\beffort values?\b', 1.0)],
               EV_WORDS, ('species', 'party'), numbers=True),
        Intent('bot-start', 'control', 'Start the bot: load the current save and wait for a command.',
               ['start the bot', 'boot up the game', 'load the game'],
               {}, [A(r'\b(start|boot|fire|wake|load|launch|open)( \w+)?( up| on)?( \w+){0,2} (bot|game|emulator|console|firered|pokemon)\b', 1.0),
                    A(r'\b(turn|power|switch) (on|up)( \w+){0,2} (bot|game|emulator|console)\b|\b(turn|power|switch)( the)? (bot|game|emulator|console) (on|up)\b', 1.0),
                    A(r'\bget (the )?game ready\b', 1.0), A(r'\b(start|boot|fire|wake) up\b', 0.8)],
               BOT_WORDS),
        Intent('bot-resume', 'control', 'Resume the paused task with its saved progress.',
               ['resume', 'keep going', 'continue'],
               {}, [A(r'\b(resume|unpause|continue)\b', 1.0), A(r'\b(keep|carry) (going|on|hunting|playing|working)\b', 1.0),
                    A(r'\bpick up where\b', 1.0), A(r'\bgo back to what\b', 1.0)],
               RESUME_WORDS),
        Intent('bot-stop', 'control', 'Stop or pause the bot; manual control returns when the game is unlinked.',
               ['stop the bot', 'pause', 'hold on'],
               {}, [A(r'\b(stop|pause|halt|freeze)\b', 1.0), A(r'\bhold on\b', 1.0), A(r'\btake a break\b', 1.0), A(r'\bwait\b', 0.8), A(r'\bwhoa\b', 0.6)],
               STOP_WORDS),
        Intent('game-stop', 'control', 'Close the game session entirely.',
               ['close the game', 'quit the game', 'shut down the emulator'],
               {}, [A(r'\b(close|quit|exit|kill)\b', 0.9), A(r'\b(shut|turn|power)( \w+){0,2} (down|off)\b', 1.0),
                    A(r'\b(close|quit|exit|shut|turn off|power off|kill)\b( \w+){0,2} (game|emulator|console)\b', 1.0)],
               GAME_STOP_WORDS),
        Intent('goal-cancel', 'goal-cancel', 'Cancel the current or last queued goal.',
               ['cancel that goal', 'never mind the mewtwo', 'forget the last request'],
               {'species': 'optional target'},
               [A(r'\bcancel\b', 1.0), A(r'\bnever ?mind\b', 1.0), A(r'\bcall off\b|\babort\b|\bscrap\b', 1.0), A(r'\bforget\b( \w+){0,2} (request|goal|hunt|order|plan)\b', 1.0), A(r'\bforget\b', 0.4)],
               CANCEL_WORDS),
        Intent('new-game', 'campaign', 'Start a new save from New Game and let the bot play the story (optional trainer name, starter).',
               ['start a new game as nova with squirtle', 'begin a fresh run with bulbasaur', 'play through the game from the start'],
               {'starter': 'bulbasaur|charmander|squirtle|random', 'trainerName': 'up to 7 letters', 'label': 'run name'},
               [A(r'\bnew (game|playthrough|run|adventure|campaign|journey)\b', 1.0), A(r'\b(start|begin|play|restart)( \w+){0,3} (over|from (the )?(start|scratch|beginning))\b', 1.0),
                A(r'\b(start|begin) over\b', 1.0), A(r'\b(play|beat)( through)?( the)?( whole| entire)? game\b', 0.95), A(r'\bfresh (run|game|start|playthrough|adventure)\b', 1.0),
                A(r'\brestart( the)? game\b', 0.9), A(r'\bplay( the)?( whole| entire)? game again\b', 1.0)],
               NEWGAME_WORDS),
        Intent('save-new', 'save', 'Back up the current game and open a fresh manual save profile.',
               ['make a new save called nuzlocke', 'create a new save file', 'open a blank save so i can play myself'],
               {'label': 'save name'},
               [A(r'\bnew (manual )?save( file| profile| slot)?\b', 1.0), A(r'\b(fresh|blank|empty) save( profile| file)?\b', 1.0),
                A(r'\b(create|make|start|open|begin|set up|spin up)\b( \w+){0,3} save( file| profile| slot)?\b', 0.9), A(r'\bnew profile\b|\bsave (profile|slot)\b', 0.9)],
               SAVE_NEW_WORDS),
        Intent('save-restore', 'save', 'Back up the current game and reopen a saved backup.',
               ['restore my main save', 'load the speedrun backup', 'switch back to my old save'],
               {'profile': 'save backup id'},
               [A(r'\b(restore|load|reload|revert|rollback|switch|go back|return|open)\b( \w+){0,4} (save|backup|profile|file)\b', 1.0), A(r'\brestore\b|\brollback\b', 0.85)],
               RESTORE_WORDS),
        Intent('trade-shiny', 'trade', 'Trade away a saved shiny Pokémon (native trade).',
               ['trade my shiny charizard', 'send my shiny eevee over'],
               {'species': 'shiny species', 'shiny': 'saved shiny id'},
               [A(r'\btrad(e|ing)\b', 1.0), A(r'\bsend\b.*\b(to|over)\b', 0.8)],
               TRADE_WORDS, ('species', 'party'), numbers=True),
        Intent('trade-pokemon', 'trade', 'Trade a Pokémon from the current save.',
               ['trade my kadabra', 'send my kadabra to emerald'],
               {'species': 'species', 'pokemon': 'PC/party individual id'},
               [A(r'\btrad(e|ing)\b', 1.0), A(r'\bsend\b.*\b(to|over)\b', 0.8)],
               TRADE_WORDS, ('species', 'party'), numbers=True),
        Intent('settings', 'settings', 'Change default capture preferences for new requests (ball, shiny, nature, gender, limits, Rare Candy supply, after a catch).',
               ['set the default ball to ultra ball', 'always use great balls', 'turn on the rare candy supply'],
               {'preferences': 'bot-settings fields'},
               [A(r'\bby default\b|\bdefaults?\b', 1.0), A(r'\balways\b', 0.9), A(r'\bfrom now on\b', 1.0),
                A(r'\b(turn|switch) (on|off)\b.*\b(supply|glitch|candy|candies|qmm|mail)\b|\b(supply|glitch|candy|qmm)\b.*\b(on|off)\b', 1.0),
                A(r'\b(enable|disable)\b', 0.9), A(r'\b(limit|cap)\b', 0.9), A(r'\bset (max|maximum|the max)\b', 0.95), A(r'\b(set|change)\b', 0.6),
                A(r'\bafter (catching|a catch|each catch|every catch|it catches)\b', 0.95)],
               SETTINGS_WORDS, numbers=True),
        Intent('postgame', 'postgame', 'Work through the postgame checklist from this save.',
               ['do the postgame', 'finish the postgame checklist'],
               {}, [A(r'\bpostgame\b', 1.0)], POSTGAME_WORDS),
        Intent('collection', 'collection', 'Collect shinies: every supported shiny or the full shiny National Pokédex.',
               ['complete the shiny national dex', 'catch every shiny', 'work on the shiny collection'],
               {'goal': 'supported|national-dex', 'collectionStages': 'base-forms|each-stage'},
               [A(r'\b(complete|fill|finish|work on|do)\b( \w+){0,3} (dex|pokedex)\b', 1.0), A(r'\bliving( shiny)? dex\b', 1.0),
                A(r'\b(collect|catch|get|hunt)\b( \w+){0,2} (every|all)( the)? shin(y|ies)\b', 1.0), A(r'\bshiny collection\b', 1.0), A(r'\bcollect shin(y|ies)\b', 1.0)],
               COLLECTION_WORDS),
        Intent('status-team', 'status', 'Answer: what is in the party right now.',
               ["what's my team", "who's in my party", 'show me my pokemon'],
               {}, [A(Q + r'.*\b(team|party|lineup)\b', 1.0), A(r'\b(team|party) (status|info)\b', 1.0), A(r'\bwhat pokemon do i have\b', 1.0),
                    A(r'\bshow me my pokemon\b', 1.0), A(Q + r'.*\bmy pokemon\b', 0.8)],
               STATUS_WORDS | {'team', 'party', 'lineup', 'pokemon', 'doing', 'info'}),
        Intent('status-hunt', 'status', 'Answer: how the current hunt is going.',
               ["how's the hunt going", 'what are you hunting', 'how many encounters so far'],
               {}, [A(Q + r'.*\b(hunt|hunting|encounters?|luck|found)\b', 1.0), A(r'\bhunt status\b', 1.0), A(r'\bfound anything\b', 1.0)],
               STATUS_WORDS | {'hunt', 'hunting', 'encounter', 'encounters', 'luck', 'found', 'going', 'catch', 'caught', 'resets', 'progress'}),
        Intent('status-location', 'status', 'Answer: where the player is.',
               ['where are you', "what's your location"],
               {}, [A(r'\bwhere\b', 0.9), A(r'\blocation\b', 0.9), A(r'\bwhat (map|town|city|route)\b', 0.9)],
               STATUS_WORDS | {'location', 'map', 'town', 'city', 'route', 'player', 'standing'}),
        Intent('status-progress', 'status', 'Answer: story/postgame progress, badges and Pokédex counts.',
               ['how far along are you', 'how many badges do i have', "what's my progress"],
               {}, [A(r'\b(progress|badges?|how far)\b', 1.0), A(r'\bhow many pokemon\b.*\b(caught|owned|registered)\b', 1.0),
                    A(r'\b(how|what)\b.*\b(pokedex|dex)\b', 0.95), A(r'\bpostgame going\b|\bhow is the postgame\b', 1.0), A(r'\bplay ?time\b', 0.9)],
               STATUS_WORDS | {'progress', 'badges', 'badge', 'along', 'pokedex', 'dex', 'complete', 'caught', 'owned', 'pokemon', 'postgame', 'story',
                               'play', 'time', 'playtime', 'far', 'going'}),
        Intent('status-shinies', 'status', 'Answer: saved shinies (count, latest).',
               ['how many shinies do i have', 'show my shinies'],
               {}, [A(r'\bshinies\b', 1.0), A(Q + r'.*\bshiny pokemon\b', 0.95), A(r'\b(latest|newest|last|recent) shiny\b', 1.0)],
               STATUS_WORDS | {'shinies', 'shiny', 'pokemon', 'latest', 'newest', 'last', 'recent', 'caught'}),
        Intent('status-bot', 'status', 'Answer: what the bot is doing right now.',
               ['is the bot running', "what's the bot doing", 'bot status'],
               {}, [A(r'\b(is|are) (the bot|you)( \w+)? (running|paused|working|on|stopped|active|busy|idle)\b', 1.0), A(r'\bbot status\b', 1.0),
                    A(r'\bwhat (is )?(the bot|you) doing\b|\bwhat are you doing\b|\bwhat is the bot doing\b', 1.0), A(r'^status$', 1.0),
                    A(r'\bwhat (is|are) (the bot|it|you) up to\b', 1.0)],
               STATUS_WORDS | {'bot', 'running', 'paused', 'working', 'stopped', 'active', 'busy', 'idle', 'doing', 'up', 'to'}),
        Intent('status-money', 'status', 'Answer: the trainer’s money.',
               ['how much money do i have', 'how rich am i'],
               {}, [A(r'\b(money|cash|funds|rich|pokedollars|balance|dollars|bucks)\b', 1.0)],
               STATUS_WORDS | {'money', 'cash', 'funds', 'rich', 'balance', 'pokedollars', 'dollars', 'bucks', 'many'}),
        Intent('status-saves', 'status', 'Answer: the save backups that can be restored.',
               ['list my saves', 'what saves do i have'],
               {}, [A(Q + r'.*\b(saves|backups|save files|profiles)\b', 1.0), A(r'\bsaves\b', 0.8)],
               STATUS_WORDS | {'saves', 'save', 'backups', 'backup', 'files', 'profiles'}),
        Intent('status-requests', 'status', 'Answer: saved Pokémon requests and queued hunts.',
               ['what hunts are queued', 'show my saved requests'],
               {}, [A(r'\brequests?\b', 0.95), A(r'\bqueued\b', 0.8), A(r'\bwhat hunts\b', 0.95)],
               STATUS_WORDS | {'requests', 'request', 'queued', 'hunts', 'saved', 'pokemon', 'pending'}),
        Intent('status-goals', 'status', 'Answer: goals the supervisor is running or has queued.',
               ['what are my goals', 'show my goals'],
               {}, [A(r'\bgoals?\b', 0.95), A(r'\bwhat are you working on\b', 1.0)],
               STATUS_WORDS | {'goals', 'goal', 'queued', 'working', 'on', 'active', 'pending'}),
        Intent('help', 'help', 'Answer: what the bot understands, with examples.',
               ['help', 'what can you do', 'what commands do you understand'],
               {}, [A(r'^help$|\bhelp me\b|\bhelp$', 1.0), A(r'\bwhat can (you|i)\b', 1.0), A(r'\b(what|which)( \w+){0,3} commands\b|\bwhat (can|do) you (understand|know|do)\b', 1.0), A(r'\bhow do i use\b', 0.9)],
               STATUS_WORDS | {'help', 'commands', 'command', 'understand', 'ask', 'say', 'use', 'can', 'do', 'things', 'stuff', 'know', 'able'}),
        # Known but unsupported requests: explained honestly instead of guessed.
        Intent('release', 'unsupported', 'Release a Pokémon (never done automatically).', ['release my magikarp', 'let go of my rattata'], {},
               [A(r'\b(release|free)\b', 1.0), A(r'\blet go of\b|\bget rid of\b|\blet\b( \w+){1,3} go\b', 1.0)], UNSUPPORTED_WORDS,
               message='Pokémon are never released automatically. Every catch is kept; move or trade Pokémon yourself if you need space.', penalty=1.0),
        Intent('evolve', 'unsupported', 'Evolve a specific Pokémon on demand.', ['evolve my kadabra', 'make my pikachu evolve'], {},
               [A(r'\bevolve\b', 1.0), A(r'\bstone\b(?: \w+){0,2} (?:on|to) (?:my|the|your|our)\b', 1.0)], UNSUPPORTED_WORDS | {'evolve', 'into', 'stone'},
               message='Evolving a specific Pokémon on request isn’t supported yet. Ask for the evolved species instead (for example “get me an Alakazam”) and the planner uses its evolution or trade route.',
               penalty=1.0),
        Intent('level-up', 'unsupported', 'Level up or grind a Pokémon to a level.', ['level up my charizard', 'train my pikachu to level 100'], {},
               [A(r'\blevel (it )?up\b', 1.0), A(r'\b(train|grind|raise)\b.*\blevel\b', 1.0), A(r'\bgrind\b', 0.9), A(r'\b(exp|experience|xp)\b', 0.9)],
               UNSUPPORTED_WORDS | {'train', 'grind', 'raise', 'more', 'get', 'give', 'exp', 'experience', 'xp'},
               message='Leveling an existing Pokémon to a target isn’t a supported task yet. New catches can include a final level (“catch a Bulbasaur trained to level 50”).',
               penalty=1.0, numbers=True),
        Intent('teach-move', 'unsupported', 'Teach or forget a move.', ['teach my lapras surf', 'make my charizard learn fly'], {},
               [A(r'\b(teach|learn|unlearn)\b', 1.0), A(r'\bforget\b', 0.9)], UNSUPPORTED_WORDS | {'learn', 'teach', 'forget', 'move'},
               message='Teaching or forgetting moves on request isn’t supported yet. New catches can ask for moves (“catch a Lapras that knows Surf”).', penalty=1.0),
        Intent('battle', 'unsupported', 'Battle a specific trainer.', ['battle the elite four', 'fight brock'], {},
               [A(r'\b(battle|fight|challenge|rematch)\b', 1.0), A(r'\b(beat|defeat)\b', 0.7)],
               UNSUPPORTED_WORDS | {'gym', 'leader', 'leaders', 'elite', 'four', 'champion', 'rival', 'trainer', 'trainers', 'brock', 'misty', 'surge',
                                    'erika', 'koga', 'sabrina', 'blaine', 'giovanni', 'lorelei', 'bruno', 'agatha', 'lance', 'gary', 'blue', 'lt'},
               message='Battling a chosen trainer on request isn’t supported. The story campaign and the postgame checklist fight the battles they need.',
               penalty=1.0),
        Intent('speed', 'unsupported', 'Change the emulation speed.', ['speed up the game', 'go faster'], {},
               [A(r'\bspeed (it )?up\b|\bfaster\b|\bslow (it )?down\b|\bslower\b|\bemulation speed\b|\bfast forward\b|\bturbo\b', 1.0),
                A(r'\b(double|triple|quadruple|twice|\d+ x) (the )?speed\b|\bgame speed\b', 1.0)],
               UNSUPPORTED_WORDS | {'game', 'emulation', 'speed', 'set', 'x', 'times', 'double', 'triple', 'twice', 'run'},
               message='Emulation speed isn’t controlled from requests.', penalty=1.0, numbers=True),
        Intent('rename', 'unsupported', 'Rename an existing Pokémon.', ['rename my pikachu to sparky', 'change the nickname of my dragonite'], {},
               [A(r'\brename\b|\bchange\b.*\bnickname\b', 1.0),
                A(r'\b(?:give|call) (?:my|the|your|our) \w+(?: \w+){0,3} nick ?name\b|\bnick ?name (?:my|the|your|our)\b|\bname my\b', 1.0)],
               UNSUPPORTED_WORDS | {'nickname', 'name', 'change', 'give', 'call', 'new'},
               message='Renaming Pokémon you already have isn’t supported. New catches can get a nickname (“catch a Pikachu named Sparky”).', penalty=0.5),
        Intent('cheat', 'unsupported', 'Cheat, hack or edit the game.', ['give me infinite rare candies', 'hack in a shiny mewtwo'], {},
               [A(r'\b(hack|hacks|hacked|hacking|cheat|cheats|cheating|gameshark|codebreaker|spawn|spawned|infinite|unlimited|inject|clone)\b', 1.0),
                A(r'\bgame shark\b|\baction replay\b|\bedit (my|the)\b|\bmodify\b|\bmake (every|all)( \w+)? shiny\b', 1.0),
                A(r'\bset (my|the) money\b|\b(max|infinite|unlimited) (money|cash)\b', 1.0)],
               UNSUPPORTED_WORDS | {'code', 'codes', 'money', 'give', 'in', 'cheat', 'some', 'every', 'use', 'shiny', 'edit', 'set', 'cash'},
               message='Only legitimate play is supported: no memory edits, cheat codes or ROM changes.', penalty=0.5, numbers=True, bonus=0.15),
    ]


STOP_WORDING = r'(stop|stopped|stops|stuck|pause|paused|quit|fail|failed|halt|halted|freeze|froze|frozen|block|blocked|break|broke|broken|crash|crashed|die|died|stall|stalled|give up|gave up|not (working|moving|hunting|playing))'
# The new answers' anchors open the clause (after lead-in and polite words): a comma fragment such as "…, store it in the pc" keeps
# belonging to its neighbour's action instead of becoming a question of its own. No loose word cues: any anchor match switches off catch's
# verbless reading ("shiny pikachu with perfect ivs"). A higher coverage penalty keeps them to the words they explain.
ASK = r'^(?:(?:please|just|and|but|so|ok|okay|hey|yo|bot|now|then|oh|also|um) )*(?:(?:can|could|would) you (?:please )?)?'
HAVE = ASK + r'(?:(?:do|did) (?:i|we|you) (?:still )?(?:have|own|got)|(?:have|has) (?:i|we|you) (?:still )?got)\b(?! to\b)'


def _answers():
    """Answer-only questions added after Laya's fine-tune (laya-nl-20260925 stage 5). The code layer alone reads them: they are not
    among Laya's options (LAYA_OPTIONS: the 38 trained intents, text and order unchanged) and a clause the code layer reads as one of
    them is never sent to Laya. Retraining Laya on them needs a new asset, calibration and blind set."""
    return [
        Intent('status-stop', 'status', 'Answer: why the bot stopped, with the one-tap fix when code proved it safe.',
               ['why did it stop', 'what happened', 'why is the bot stuck'],
               {}, [A(r'\bwhy\b.*\b' + STOP_WORDING + r'\b', 1.0), A(ASK + r'(?:tell me )?what (happened|went wrong|is wrong|broke)\b', 1.0),
                    A(ASK + r'(is|are|was|has|did) (the bot|it|you|the game|the hunt)( \w+)? (stuck|frozen|crashed|broken)\b', 1.0)],
               STATUS_WORDS | {'why', 'stop', 'stopped', 'stops', 'stuck', 'happened', 'happen', 'wrong', 'went', 'pause', 'paused', 'quit', 'fail', 'failed',
                               'halt', 'halted', 'freeze', 'froze', 'frozen', 'block', 'blocked', 'break', 'broke', 'broken', 'crash', 'crashed', 'die',
                               'died', 'stall', 'stalled', 'give', 'gave', 'up', 'not', 'working', 'moving', 'hunting', 'playing', 'bot', 'hunt', 'checklist',
                               'postgame', 'task', 'again', 'it', 'has', 'had'}, penalty=3.0),
        Intent('status-owned', 'status', 'Answer: whether a Pokémon species is in the party or PC, and where.',
               ['do i have a kadabra', 'is there a pikachu in my pc', 'where is my alakazam'],
               {'species': 'species'}, [A(HAVE, 1.0), A(ASK + r'(is|are|was|were|what|which|who|show|list|check|tell)\b.*\b(in|inside) (my|the|your|our) (pc|box|boxes|storage|computer)\b', 1.0),
                                        A(ASK + r'where (is|are)\b', 0.9), A(ASK + r'how many\b.*\b(do|have) (i|we|you) (have|got|own)\b', 0.9)],
               STATUS_WORDS | {'have', 'own', 'owned', 'got', 'pc', 'box', 'boxes', 'storage', 'computer', 'still', 'somewhere', 'stored', 'kept', 'in', 'inside', 'there'},
               ('species', 'party'), penalty=3.0),
        Intent('status-stats', 'status', 'Answer: an owned Pokémon’s level, IVs or EVs.',
               ['what level is my alakazam', 'show my dragonite ivs', 'what are my charizard evs'],
               {'species': 'species'}, [A(ASK + r'(what|which|show|tell|check|list|display|how many|how much)\b.*\b(levels?|ivs?|evs?|stats|individual values?|effort values?)\b', 1.0),
                                        A(ASK + r'how (strong|high)\b', 0.9)],
               STATUS_WORDS | {'level', 'levels', 'iv', 'ivs', 'ev', 'evs', 'stats', 'individual', 'effort', 'value', 'values', 'strong', 'high', 'spread',
                               'both', 'does', 'have'},
               ('species', 'party'), numbers=True, penalty=3.0),
        Intent('status-missing', 'status', 'Answer: Pokédex species still missing, or postgame checklist entries still open.',
               ['what pokemon am i missing', 'how many pokedex entries are left', 'what is left on the postgame checklist'],
               {}, [A(ASK + r'(what|which|how many|how much)\b.*\b(missing|remaining|left|to go|remain|still need|(have not|not yet|never) (caught|registered|gotten|got))\b', 1.0),
                    A(ASK + r'(am|are) (i|we) (still )?missing\b', 1.0)],
               STATUS_WORDS | {'missing', 'remaining', 'remain', 'left', 'to', 'go', 'still', 'need', 'pokemon', 'pokedex', 'dex', 'entries', 'entry', 'species',
                               'caught', 'registered', 'checklist', 'postgame', 'objectives', 'objective', 'national', 'kanto', 'more', 'catch', 'get',
                               'complete', 'completion', 'not', 'yet', 'gotten', 'never', 'finish', 'ones', 'things'}, penalty=3.0),
        Intent('status-bag', 'status', 'Answer: how many of an item are in the bag.',
               ['how many rare candies do i have', 'how many ultra balls have i got', 'what is in my bag'],
               {'item': 'item id'}, [A(ASK + r'how (many|much)\b', 0.9), A(HAVE, 0.9),
                                     A(ASK + r'(what|which|show|list|check|tell)\b.*\b(bag|backpack|pack|inventory)\b', 1.0)],
               STATUS_WORDS | {'bag', 'backpack', 'pack', 'inventory', 'have', 'got', 'left', 'still', 'enough', 'carrying', 'carry', 'items', 'item', 'own', 'in'},
               ('item', 'ball', 'held'), penalty=3.0),
    ]


# Entity kinds that can explain words for each intent (others count as unexplained).
ENTITY_KINDS = {
    'catch': {'species', 'other', 'ball', 'nature', 'gender', 'move', 'held', 'stat', 'place', 'ability', 'other-ability'},
    'travel': {'place'}, 'item': {'item', 'ball', 'held'}, 'heal': {'place'}, 'save-game': {'place'},
    'ev-training': {'species', 'party', 'stat'}, 'new-game': {'species'}, 'trade-shiny': {'species', 'party', 'other'},
    'trade-pokemon': {'species', 'party', 'other'}, 'settings': {'ball', 'nature', 'gender', 'item', 'stat'}, 'goal-cancel': {'species', 'other'},
    'collection': {'species'}, 'status-hunt': {'species', 'place'}, 'status-team': {'species', 'party'}, 'status-location': {'place'},
    'status-progress': {'place'}, 'status-shinies': {'species'},
    'status-owned': {'species', 'party'}, 'status-stats': {'species', 'party', 'stat'}, 'status-bag': {'item', 'ball', 'held'},
}
UNSUPPORTED_KINDS = {'species', 'other', 'party', 'move', 'place', 'item', 'ball', 'held', 'stat', 'nature', 'gender'}
_TRAINED = _intents()
# Laya's intent question: exactly the options the fine-tuned asset was trained and calibrated on (ids, descriptions, order).
LAYA_OPTIONS = {intent.id: intent.description for intent in _TRAINED}
CATALOG = _TRAINED + _answers()
for _intent in CATALOG:
    _intent.entities = frozenset(ENTITY_KINDS.get(_intent.id, UNSUPPORTED_KINDS if _intent.kind == 'unsupported' else set()))
BY_ID = {intent.id: intent for intent in CATALOG}
KNOWN_WORDS = set(FILLERS)
for _intent in CATALOG:
    KNOWN_WORDS |= set(_intent.words)
    for _pattern, _ in _intent.anchors:
        KNOWN_WORDS |= {w for w in re.findall(r'[a-z]{3,}', _pattern.pattern)}
KNOWN_WORDS |= {'what', 'where', 'how', 'who', 'which', 'shiny', 'and', 'or', 'not', 'no', 'yes', 'then', 'after', 'before', 'first', 'next'}
SUGGESTIONS = ['get me a shiny Mewtwo', 'heal then go to Cinnabar and save', 'catch 3 adamant Abra in Ultra Balls', 'buy 10 Ultra Balls',
               'do the postgame', "what's my team", 'stop the bot']


# ---------------------------------------------------------------------------
# Clauses: entities and deterministic scoring
# ---------------------------------------------------------------------------
@dataclass
class Clause:
    index: int
    tokens: list
    spans: list = field(default_factory=list)
    ranking: list = field(default_factory=list)
    intent: str = None
    score: float = 0.0
    status: str = 'rejected'
    slots: dict = field(default_factory=dict)
    clarify: dict = None
    message: str = ''
    steps: list = field(default_factory=list)
    direct: list = field(default_factory=list)
    answer: str = None
    summary: str = ''
    confirm: list = field(default_factory=list)
    certainty: float = 1.0
    anchored: bool = False
    question: bool = False
    partial: list = field(default_factory=list)
    save: dict = field(default_factory=dict)
    request_for_preview: list = field(default_factory=list)
    offer: dict = None  # a one-tap fix an answer offers (the stop triage's proven-safe player task)
    laya: bool = False  # Laya-primary decided its intent (not the owner's answer)

    @property
    def text(self):
        return ' '.join(self.tokens)


def find_spans(tokens, vocab, overlay=None):
    overlay = overlay or {}
    found = []
    n = len(tokens)
    for i in range(n):
        if tokens[i] == ',':
            continue
        for L in range(min(5, n - i), 0, -1):
            words = tokens[i:i + L]
            if ',' in words:
                continue
            k = ' '.join(words)
            hits = vocab.exact(k, overlay)
            how = 'exact'
            if not hits:
                hits = vocab.singular(words, overlay)
            if not hits and L > 1:
                hits = [h for h in vocab.joined.get(''.join(words), []) if h.kind in ('species', 'place', 'item', 'ball', 'held')]
                how = 'joined'
            if hits:
                found.append(Span(i, i + L, hits, 1.0 if how == 'exact' else 0.97, how, k))
    found = _resolve(found, tokens)
    # "full heal the team": the verb, not the item.
    found = [s for s in found if not (s.start == 0 and s.text in ('full heal', 'full restore') and s.end < n
                                      and tokens[s.end] in ('the', 'my', 'your', 'team', 'party', 'pokemon', 'everyone', 'them', 'us', 'all'))]
    covered = {t for s in found for t in range(s.start, s.end)} | name_tokens(tokens)

    def open_token(t):
        return t.isalpha() and t not in KNOWN_WORDS and t not in covered_words and len(t) >= 3

    covered_words = {tokens[t] for t in covered}
    fuzzy = []
    for i in range(n):
        for L in (1, 2, 3):
            window = list(range(i, i + L))
            if window[-1] >= n or any(t in covered or tokens[t] == ',' for t in window):
                continue
            words = tokens[i:i + L]
            if not any(open_token(w) for w in words):
                continue
            if L == 1 and (len(words[0]) < 4 or not words[0].isalpha()):
                continue
            if L > 1 and any(w.isdigit() for w in words):
                continue
            if L > 1 and any(w in KNOWN_WORDS and w not in ('a',) for w in words):
                continue
            if L > 1 and (words[0] == 'a' or words[-1] == 'a'):
                continue
            last = words[-1]
            probes = [words]
            if len(last) > 4 and last.endswith('s'):
                probes.append(words[:-1] + [last[:-1]])
            best = []
            for probe in probes:
                best += vocab.fuzzy(probe)
            if overlay:
                for match in difflib.get_close_matches(' '.join(words), list(overlay), n=2, cutoff=0.84):
                    best += [(h, difflib.SequenceMatcher(None, ' '.join(words), match).ratio()) for h in overlay[match]]
            if not best:
                continue
            best.sort(key=lambda x: -x[1])
            top = best[0][1]
            close = [(h, s) for h, s in best if s >= top - 0.06]
            hits = []
            for h, s in close:
                if h not in hits:
                    hits.append(h)
            fuzzy.append(Span(i, i + L, hits, top, 'fuzzy', ' '.join(words)))
    spans = _resolve(found + fuzzy, tokens)
    # Moves only count after a move cue ("with surf", "that knows thunderbolt").
    kept = []
    for s in spans:
        if s.kinds() == {'move'}:
            before = tokens[max(0, s.start - 3):s.start]
            if not (set(before) & MOVE_CUES):
                continue
        if s.kinds() <= {'nature'} and s.how != 'exact' and len(s.text) < 6:
            continue
        if s.kinds() <= {'ability', 'other-ability'}:
            before = tokens[max(0, s.start - 3):s.start]
            after = tokens[s.end:s.end + 1]
            next_species = any(o.start == s.end and o.kinds() & {'species', 'other'} for o in spans)
            if not (set(before) & ABILITY_CUES or after[:1] in (['ability'], ['abilities']) or next_species):
                continue
        kept.append(s)
    return kept


def _resolve(spans, tokens):
    spans = sorted(spans, key=lambda s: (-(s.end - s.start) * (1 if s.how != 'fuzzy' else 0.9), -s.score, s.start))
    taken = set()
    out = []
    for s in spans:
        rng = set(range(s.start, s.end))
        if rng & taken:
            same = next((o for o in out if o.start == s.start and o.end == s.end), None)
            if same and s.score == same.score:
                same.hits += [h for h in s.hits if h not in same.hits]
            continue
        taken |= rng
        out.append(s)
    return sorted(out, key=lambda s: s.start)


NAME_CUES = {'named', 'called', 'nicknamed', 'titled', 'labeled', 'labelled'}
RESTORE_VERBS = {'restore', 'load', 'reload', 'revert', 'rollback', 'switch', 'open', 'return'}
PROFILE_NOUNS = {'save', 'saves', 'backup', 'backups', 'profile', 'profiles', 'file'}
NAME_STOP = {'with', 'and', 'then', 'in', 'as', 'holding', 'that', 'who', 'which', 'at', 'on', 'using', 'for', 'please', 'of', 'the', 'my',
             'a', 'an', 'to', 'from', 'starter', 'trainer', 'pick', 'choose', ','}


HP_TYPES = ('fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost',
            'dragon', 'dark', 'steel')
HIDDEN_POWER = re.compile(r'\b(hidden power|hp) (type )?(' + '|'.join(HP_TYPES) + r')\b|\b(' + '|'.join(HP_TYPES) + r') (type )?hidden power\b')


def hidden_power_type(tokens):
    """The Hidden Power type a catch asks for ("hidden power fire", "an ice hidden power"), or None."""
    m = HIDDEN_POWER.search(' '.join(tokens))
    return m and (m.group(3) or m.group(4))


def hidden_power_tokens(tokens):
    """Token indexes of a Hidden Power type request ("hidden power fire"), kept out of species and move parsing."""
    text = ' '.join(tokens)
    out = set()
    for m in HIDDEN_POWER.finditer(text):
        first = len(text[:m.start()].split())
        out |= set(range(first, first + len(m.group(0).split())))
    return out


def name_tokens(tokens):
    """Token indexes that are names (nickname, trainer name, save label), not vocabulary."""
    out = set()
    for k, t in enumerate(tokens):
        start, limit = None, 1
        if t in NAME_CUES:
            start, limit = k + 1, 3
        elif t in ('nickname', 'name', 'call'):
            j = k + 1
            while j < len(tokens) and tokens[j] in ('it', 'him', 'her', 'them', 'me', 'is', 'the', 'my', 'trainer', 'player', 'character', 'as'):
                j += 1
            start = j
        elif t == 'as' and k + 1 < len(tokens) and tokens[k + 1].isalpha() and tokens[k + 1] not in KNOWN_WORDS:
            start = k + 1
        elif t in RESTORE_VERBS:
            # "restore my speedrun backup": the words before save/backup name the profile.
            end = next((j for j in range(k + 1, min(len(tokens), k + 7)) if tokens[j] in PROFILE_NOUNS), None)
            if end is not None:
                out |= {j for j in range(k + 1, end) if tokens[j] not in FILLERS}
            continue
        if start is None:
            continue
        j = start
        while j < len(tokens) and j < start + limit and tokens[j] not in NAME_STOP:
            out.add(j)
            j += 1
    return out


PRIMARY = ('species', 'other', 'party', 'place', 'ball', 'item', 'held', 'nature', 'move', 'gender', 'stat')


def masked(tokens, spans):
    out = []
    i = 0
    by_start = {s.start: s for s in spans}
    while i < len(tokens):
        s = by_start.get(i)
        if s:
            kinds = s.kinds()
            out.append(next((k.upper() for k in PRIMARY if k in kinds), 'ENTITY'))
            i = s.end
        else:
            out.append('NUM' if tokens[i].isdigit() else tokens[i])
            i += 1
    return out


def _anchor_words(intent):
    if intent._anchor_words is None:
        intent._anchor_words = {w for pattern, _ in intent.anchors for w in re.findall(r'[a-z]+', pattern.pattern)}
    return intent._anchor_words


def _anchor_hits(intent, tokens, spans):
    """Anchor matches outside entity spans: (weight, token indexes of the anchor's own words)."""
    text = ' '.join(tokens)
    starts = []
    pos = 0
    for t in tokens:
        starts.append(pos)
        pos += len(t) + 1
    inside = {t for s in spans for t in range(s.start, s.end)}
    best = 0.0
    used = set()
    for pattern, weight in intent.anchors:
        for m in pattern.finditer(text):
            idx = [k for k, st in enumerate(starts) if st < m.end() and st + len(tokens[k]) > m.start()]
            if idx and all(k in inside for k in idx):
                continue
            best = max(best, weight)
            literal = _anchor_words(intent)
            used |= {k for k in idx if tokens[k] in literal}  # words inside a wide match (".*") are not explained by it
    return best, used


def _templates(intent, vocab):
    if intent._templates is None:
        intent._templates = []
        for example in intent.examples:
            toks = [t for t in _tokens(example) if t != ',']
            intent._templates.append(masked(toks, find_spans(toks, vocab)))
    return intent._templates


def _code_acts(top_id, top):
    """The code layer's own intent is an action it accepts (not below ACCEPT, a refusal or an answer): Laya changing it is an override, else a rescue."""
    return top >= ACCEPT and BY_ID[top_id].kind not in ('unsupported', 'status', 'help')


def _requirement_met(intent, spans):
    if not intent.requires:
        return True
    kinds = set()
    for s in spans:
        kinds |= s.kinds()
    return bool(kinds & set(intent.requires))


def _explained_by_entities(intent, spans):
    return {t for s in spans if s.kinds() & intent.entities for t in range(s.start, s.end)}


def score_clause(clause, vocab, global_anchor=None):
    """Deterministic ranking [(intent id, score)] with per-intent diagnostics."""
    tokens = [t for t in clause.tokens]
    spans = clause.spans
    names = name_tokens(tokens) | hidden_power_tokens(tokens)
    content = [k for k, t in enumerate(tokens) if t != ',' and t not in FILLERS]
    mask = masked(tokens, spans)
    anchors = {intent.id: _anchor_hits(intent, tokens, spans) for intent in CATALOG}
    any_anchor = any(w > 0 for w, _ in anchors.values())
    strongest = max(w for w, _ in anchors.values())
    clause.anchored = strongest >= 0.7 or (strongest >= 0.6 and bool(spans))
    ranking = []
    for intent in CATALOG:
        a, used = anchors[intent.id]
        if a == 0 and intent.verbless and not any_anchor and _requirement_met(intent, spans):
            a = intent.verbless
        t = max((difflib.SequenceMatcher(None, mask, tpl).ratio() for tpl in _templates(intent, vocab)), default=0.0)
        base = 0.75 * a + 0.25 * t if a else min(0.3, 0.25 * t)
        explained = set(used) | names | _explained_by_entities(intent, spans)
        for k in content:
            w = tokens[k]
            if w in intent.words or (intent.numbers and w.isdigit()):
                explained.add(k)
        unexplained = [k for k in content if k not in explained]
        u = len(unexplained)
        if u == 0:
            f = 1.0
        elif u > 2:
            f = 0.0
        else:
            f = max(0.0, 1.0 - intent.penalty * u / max(1, len(content)))
        if intent.kind == 'unsupported' and a >= 0.9:
            f = max(f, 0.7)  # "turn on the walk through walls cheat": the family is clear even with odd words
        req = 1.0 if _requirement_met(intent, spans) else 0.7
        score = min(1.0, base * req * f + (intent.bonus if a >= 0.9 else 0.0))
        cue = set(tokens) & STRONG_CUES or (tokens and tokens[0] in QUESTION_CUES) or clause.question or re.search(r'\b(status|so far|yet)\b', ' '.join(tokens))
        if intent.kind == 'status' and not cue:
            score *= 0.5  # "save money" is not a money question
        ranking.append((intent.id, round(score, 4), {'anchor': a, 'template': round(t, 3), 'coverage': round(f, 3), 'requirement': req,
                                                       'unexplained': [tokens[k] for k in unexplained]}))
    ranking.sort(key=lambda r: -r[1])
    return ranking


# ---------------------------------------------------------------------------
# Laya adapter (optional; deterministic parser remains the fallback)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class LayaCalibration:
    """How Laya's answers may change a clause decision (fitted per reviewed model).

    intent_temperature  rescales Laya's intent probabilities (log p / T)
    weight              combined = (1 - weight) * code score + weight * Laya probability
                        (renormalized over the intents the code layer scored >= CLARIFY)
    switch_margin       another viable intent replaces the code layer's top one only if its
                        own code score is >= ACCEPT and it leads by this margin
    promote             a clause the code layer would ask about (top in [CLARIFY, ACCEPT))
                        is accepted, with the owner's confirmation, when Laya's calibrated
                        probability of one of the offered choices reaches this value
    reject              an uncertain clause (top < ACCEPT) is rejected when Laya's
                        "actionable" probability is below this value
    entity_threshold    an ambiguous species is resolved when Laya's calibrated top
                        probability reaches this value (else the owner is asked)
    primary             Laya primary (owner decision, Sept 25 2026): a clause takes Laya's
    primary_actionable  intent when its calibrated probability is >= primary and Laya's
                        "is this a request for the bot" probability is >= primary_actionable,
                        even when the code layer scored it low or rejected it; otherwise the
                        rules above decide (the deterministic fallback). Entities and slots
                        still come from the code layer, the builders, validators and the
                        farming preview still decide feasibility, missing or ambiguous slots
                        are still asked about and destructive steps still need confirmation.
                        A step Laya decided is confirmed by the owner ("I read … as …"), an
                        accepted code decision stands when Laya's intent lacks the entity it
                        requires, and negated clauses are decided by the code layer alone.
    None switches a rule off. Without a primary rule Laya can never accept a clause the
    code layer rejects (top < CLARIFY) and never picks an intent the code layer scored
    below CLARIFY.
    """
    intent_temperature: float = 1.0
    weight: float = 0.5
    switch_margin: float = 0.0
    promote: float | None = None
    reject: float | None = 0.3
    entity_temperature: float = 1.0
    entity_threshold: float | None = 0.75
    legacy_entity_confidence: bool = False
    primary: float | None = None
    primary_actionable: float | None = None

    @property
    def is_primary(self):
        return self.primary is not None and self.primary_actionable is not None


# G3's untuned rule, kept for directly constructed classifiers (tests, fakes).
G3_COMBINATION = LayaCalibration(legacy_entity_confidence=True)
# Calibrations fitted per reviewed asset (laya_runtime.LAYA_ASSETS). An installed asset
# without an entry is consulted in shadow mode only: it can never change a decision.
# The zero-shot English checkpoint did not improve the deterministic parser on the tuning
# splits (see the G4 notes), so no calibration ships for it.
LAYA_CALIBRATIONS: dict = {
    # L0.6 fine-tune (multilingual Laya, mmBERT-base): temperatures and the species tie-break
    # threshold fitted on the DEV splits (holdout + blind2-b); the combination rules stay off.
    # Laya primary thresholds chosen on DEV/TRAIN only (tau / rho grid, 0 false accepts).
    'laya-ml-ft-l06-0762007a-onnx-q8': LayaCalibration(
        intent_temperature=0.9, weight=0.0, switch_margin=0.0, promote=None, reject=None,
        entity_temperature=1.0, entity_threshold=0.9, primary=0.98, primary_actionable=0.9),  # amendment A1 (NOTES): DEV 184/203, FA 0 DEV+TRAIN
}
LAYA_MODES = ('off', 'shadow', 'on')


def calibrate(probabilities, temperature):
    """Temperature-scaled probabilities: softmax(log p / T) (T = 1 returns them unchanged)."""
    probabilities = dict(probabilities or {})
    if not probabilities or temperature in (None, 1, 1.0):
        return probabilities
    logs = {k: math.log(max(float(v), 1e-12)) / float(temperature) for k, v in probabilities.items()}
    top = max(logs.values())
    e = {k: math.exp(v - top) for k, v in logs.items()}
    total = sum(e.values())
    return {k: v / total for k, v in e.items()}


class LayaClassifier:
    """Laya (Jev-style System 1 model) behind a narrow interface.

    choice over <= 50 intent options (two stages above that), choice among
    top-k entity candidates, and noul for "actionable?" and yes/no answers.
    The model is pinned like a cartridge. Two ways to reach it:
      - asset (G4): a reviewed ONNX asset run by a sidecar process
        (laya_runtime.SidecarAgent; verified before it starts, lazy, timeouts);
      - model + files (G3): a laya checkpoint loaded in-process after every
        configured file matched its sha256.
    Missing package, weights or pins -> unavailable and callers stay
    deterministic. mode: 'on' (calibrated combination), 'shadow' (consulted
    and reported, never changes a decision) or 'off' (not constructed).
    """
    name = 'laya'

    def __init__(self, model=None, files=None, device=None, snapshot=None, agent_factory=None, max_options=50,
                 calibration=G3_COMBINATION, mode='on', timeout=None, asset_id=None):
        self.model = model
        self.files = dict(files or {})
        self.device = device
        self.snapshot = snapshot
        self.agent_factory = agent_factory
        self.max_options = max_options
        self.calibration = calibration
        self.mode = mode if mode in LAYA_MODES else 'off'
        self.timeout = timeout
        self.asset_id = asset_id
        self.reason = None
        self._agent = None
        self._checked = False
        self._closed = False
        self._lock = threading.Lock()

    @classmethod
    def from_config(cls, config, known=None, log_path=None):
        section = (config or {}).get('laya') if isinstance(config, dict) else None
        if not isinstance(section, dict):
            return None
        if 'asset' in section:
            mode = section.get('mode', 'off')
            if mode not in ('shadow', 'on') or not isinstance(section.get('asset'), str):
                return None
            asset = os.path.expanduser(section['asset'])
            timeout = _bounded(section.get('timeoutMs'), 1500, 200, 10000) / 1000
            idle = int(_bounded(section.get('idleExitSeconds'), 600, 30, 86400))
            threads = int(_bounded(section.get('threads'), 4, 1, 16))
            asset_id = read_asset_id(asset)
            return cls(agent_factory=lambda: SidecarAgent(asset, known=known, timeout=timeout, idle_exit=idle, threads=threads, log_path=log_path),
                       calibration=LAYA_CALIBRATIONS.get(asset_id), mode=mode, timeout=timeout, asset_id=asset_id)
        return cls(model=section.get('model'), files=section.get('files'), device=section.get('device'), snapshot=section.get('snapshot'))

    def verify(self):
        """Refuse unpinned or mismatched model files (sha256 per configured file)."""
        if self.model is None:
            if self.agent_factory is None:
                raise LayaUnavailable('No Laya model is configured.')
            return
        root = Path(self.model)
        if not root.is_dir():
            raise LayaUnavailable(f'Laya model directory not found: {root}')
        if not self.files:
            raise LayaUnavailable('The Laya model is not pinned: configure the sha256 of each model file.')
        for rel, expected in sorted(self.files.items()):
            name = Path(rel)
            path = root / name
            # Hugging Face snapshots link their files into ../../blobs; the pin names the snapshot path and hashes its content.
            if name.is_absolute() or '..' in name.parts or not path.is_file():
                raise LayaUnavailable(f'Pinned Laya file is missing: {rel}')
            with path.open('rb') as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            if actual != str(expected).lower():
                raise LayaUnavailable(f'Laya model file {rel} does not match its pinned sha256.')

    def _load(self):
        if self.agent_factory is not None:
            return self.agent_factory()
        laya = importlib.import_module('laya')
        return laya.load(self.model, device=self.device)

    def available(self):
        with self._lock:
            if self._closed:  # closed with the host: a late warm-up or request starts nothing
                self.reason = 'Laya was closed with the host.'
                return False
            if self._checked:
                return self._agent is not None
            self._checked = True
            try:
                self.verify()
                self._agent = self._load()
            except LayaUnavailable as error:
                self.reason = str(error)
            except Exception as error:  # ImportError, missing torch, bad weights
                self.reason = f'Laya is unavailable: {error}'
            return self._agent is not None

    def agent_failed(self):
        failed = getattr(self._agent, 'failed', None)
        return bool(failed()) if callable(failed) else self._checked and self._agent is None

    def agent_reason(self):
        return getattr(self._agent, 'reason', None) or self.reason

    def close(self):
        with self._lock:
            self._closed = True
        close = getattr(self._agent, 'close', None)
        if callable(close):
            close()

    def warm(self):
        """Start a sidecar Laya in the background and return at once: 'ready', 'loading', 'unavailable' or 'off'.

        An in-process (G3) model is never loaded here; it still loads on its first consult."""
        if self.mode == 'off' or self.agent_factory is None:
            return 'off'
        if not self.available():
            return 'unavailable'
        agent = self._agent
        if callable(getattr(agent, 'ready', None)) and agent.ready() and callable(getattr(agent, 'touch', None)):
            agent.touch()  # already up: restart its idle exit, so the request this warm-up announces still finds it
        elif callable(getattr(agent, 'start', None)):
            agent.start()
        if self.agent_failed():
            return 'unavailable'
        ready = getattr(agent, 'ready', None)
        return 'ready' if not callable(ready) or ready() else 'loading'

    def wait_ready(self, seconds):
        """Give a sidecar that is still starting up to `seconds` to finish loading (starting it if needed); True when ready."""
        if self.mode == 'off' or self.agent_factory is None or not self.available():
            return False
        wait = getattr(self._agent, 'wait_ready', None)
        return bool(wait(seconds)) if callable(wait) else True

    def active_calibration(self):
        """The calibration that may change decisions (None in shadow mode or when uncalibrated)."""
        return self.calibration if self.mode == 'on' else None

    def predict(self, state, questions):
        if not self.available():
            raise LayaUnavailable(self.reason or 'Laya is unavailable.')
        result = self._agent.predict(state, questions)
        return (result or {}).get('answers', {})

    @staticmethod
    def _state(text, note):
        return {'request': text, 'game': 'Pokémon FireRed, automated by a bot that plays it with controller inputs only', 'note': note}

    def classify_intent(self, text, options):
        options = dict(options)
        keys = list(options)
        if len(keys) <= self.max_options:
            return self._choice(text, 'intent', 'Which action is the owner asking the bot to perform?', options)
        groups = [keys[i:i + self.max_options - 1] for i in range(0, len(keys), self.max_options - 1)]
        while len(groups) > self.max_options:
            groups = [sum(groups[i:i + 2], []) for i in range(0, len(groups), 2)]
        summary = {f'group-{g}': '; '.join(options[k] for k in grp)[:1500] for g, grp in enumerate(groups)}
        first = self._choice(text, 'group', 'Which group contains the action the owner is asking for?', summary)
        chosen = groups[int(first['choice'].split('-')[1])]
        second = self._choice(text, 'intent', 'Which action is the owner asking the bot to perform?', {k: options[k] for k in chosen[:self.max_options]})
        second['confidence'] = round(second['confidence'] * first['confidence'], 4)
        return second

    def _choice(self, text, qid, instructions, criteria):
        answers = self.predict(self._state(text, instructions), {qid: {'type': 'choice', 'instructions': instructions, 'criteria': criteria}})
        answer = answers.get(qid) or {}
        return {'choice': answer.get('choice'), 'probabilities': answer.get('probabilities') or {}, 'confidence': float(answer.get('confidence') or 0.0)}

    def choose_entity(self, text, slot, candidates):
        criteria = {str(c['id']): c.get('label') or str(c['id']) for c in candidates[:self.max_options]}
        return self._choice(text, 'entity', f'Which {slot} does the owner mean?', criteria)

    def _noul(self, text, qid, instructions):
        answers = self.predict(self._state(text, instructions), {qid: {'type': 'noul', 'instructions': instructions}})
        return float((answers.get(qid) or {}).get('noul') or 0.0)

    # The English checkpoint's noul tends to follow its true/false labels (laya model card, issue #156); on the
    # G4 tuning splits noul separated requests from nonsense at chance (AUC .50), this two-option choice at .73.
    ACTIONABLE = {'type': 'choice', 'instructions': 'Is the message a request or question for the Pokémon game bot?',
                  'criteria': {'A': 'yes: it asks the bot to do something in the game or asks about the game state',
                               'B': 'no: it is unrelated chatter or nonsense'}}

    def actionable(self, text):
        """P(the text is a request for the bot)."""
        answers = self.predict(self._state(text, self.ACTIONABLE['instructions']), {'actionable': self.ACTIONABLE})
        return float(((answers.get('actionable') or {}).get('probabilities') or {}).get('A') or 0.0)

    def yes_no(self, text, question):
        return self._noul(text, 'answer', f'Does the reply mean yes to: {question}')


def _bounded(value, default, low, high):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    return min(high, max(low, value)) if value == value else default


class LayaSession:
    """One request's Laya consults: calibrated combination plus a record of every consult.

    A consult that fails (loading, timeout, crash, bad answer) is recorded and the
    deterministic decision stands; after one failure the rest of the request skips Laya.
    """

    def __init__(self, classifier):
        self.classifier = classifier
        self.calibration = classifier.active_calibration()
        self.primary = self.calibration is not None and self.calibration.is_primary
        self.consults = []
        self.decided = []
        self.vetoed = []
        self.used = False
        self.skipped = None

    def report(self):
        return {'mode': 'on' if self.calibration is not None else 'shadow',
                'asset': self.classifier.asset_id, 'calibrated': self.calibration is not None,
                'consults': self.consults, **({'primary': self.decided} if self.primary else {}),
                **({'vetoed': self.vetoed} if self.vetoed else {}), **({'skipped': self.skipped} if self.skipped else {})}

    def _intent(self, clause):
        return self._ask(clause, 'intent', lambda: self.classifier.classify_intent(clause.text, LAYA_OPTIONS))

    def primary_intent(self, clause, top_id, top):
        """Laya primary: ((intent, score) | None, Laya's intent answer).

        (intent, calibrated probability) when Laya is confident the clause asks for that
        intent (>= primary) and that it is a request for the bot (>= primary_actionable) and
        this changes the code layer's decision; None keeps the deterministic decision. An
        accepted code decision also stands when Laya's intent lacks the entity it requires
        ("find a master ball" is no catch without a Pokémon): the entity veto.
        """
        cal = self.calibration
        pick = self._intent(clause)
        if pick is None:
            return None, None
        q = calibrate(pick.get('probabilities') or {}, cal.intent_temperature)
        q = {k: v for k, v in q.items() if k in LAYA_OPTIONS}
        if not q:
            return None, pick
        best = max(q, key=q.get)
        if q[best] < cal.primary or (best == top_id and top >= ACCEPT):
            return None, pick  # unsure, or it agrees with what the code layer does anyway
        if top >= ACCEPT and not _requirement_met(BY_ID[best], clause.spans):
            self.vetoed.append({'clause': clause.index, 'intent': best, 'p': round(q[best], 4), 'code': [top_id, round(top, 4)]})
            return None, pick
        p = self._ask(clause, 'actionable', lambda: self.classifier.actionable(clause.text))
        if p is None or p < cal.primary_actionable:
            return None, pick
        score = round(q[best], 4)
        self.decided.append({'clause': clause.index, 'intent': best, 'p': score, 'actionable': round(float(p), 4),
                             'code': [top_id if top >= CLARIFY else None, round(top, 4)], 'rescue': not _code_acts(top_id, top)})
        return (best, score), pick

    def _ask(self, clause, question, call):
        if self.skipped:
            return None
        started = time.monotonic()
        try:
            answer = call()
        except Exception as error:  # a model failure never blocks the deterministic path
            self.skipped = f'{type(error).__name__}: {error}'[:300]
            self.consults.append({'clause': clause.index, 'question': question, 'error': self.skipped, 'ms': round((time.monotonic() - started) * 1000)})
            return None
        record = {'clause': clause.index, 'question': question, 'ms': round((time.monotonic() - started) * 1000)}
        if isinstance(answer, dict):
            top = sorted((answer.get('probabilities') or {}).items(), key=lambda kv: -kv[1])[:3]
            record.update({'choice': answer.get('choice'), 'top': [[k, round(float(v), 4)] for k, v in top]})
        else:
            record['p'] = round(float(answer), 4)
        self.consults.append(record)
        if self.calibration is not None:
            self.used = True
        return answer

    def combine_intent(self, clause, viable, top_id, top, pick=None):
        """(intent, score, promoted) for a clause whose code-layer candidates are `viable` (score >= CLARIFY)."""
        if pick is None:
            pick = self._intent(clause)
        cal = self.calibration
        if pick is None or not viable and cal is not None:
            return top_id, top, False
        if cal is None:
            if top < ACCEPT:
                self._ask(clause, 'actionable', lambda: self.classifier.actionable(clause.text))  # shadow data only
            return top_id, top, False
        q = calibrate(pick.get('probabilities') or {}, cal.intent_temperature)
        total = sum(q.get(i, 0.0) for i, _ in viable) or 1.0
        share = {i: q.get(i, 0.0) / total for i, _ in viable}
        score = dict(viable)
        combined = {i: (1.0 - cal.weight) * s + cal.weight * share[i] for i, s in viable}
        best = max(combined, key=combined.get)
        if best != top_id and score[best] >= ACCEPT and combined[best] - combined.get(top_id, 0.0) >= cal.switch_margin:
            top_id, top = best, score[best]
        promoted = False
        if top < ACCEPT and cal.promote is not None:
            # Only actions (always confirmed by the owner); questions are answered only when the code layer is sure.
            offered = [i for i, s in viable[:3] if BY_ID[i].kind not in ('unsupported', 'status', 'help')]
            if offered:
                candidate = max(offered, key=lambda i: share[i])
                if share[candidate] >= cal.promote:
                    top_id, top, promoted = candidate, ACCEPT, True
        if top < ACCEPT and cal.reject is not None:
            p = self._ask(clause, 'actionable', lambda: self.classifier.actionable(clause.text))
            if p is not None and p < cal.reject:
                top = 0.0
        return top_id, top, promoted

    def choose_species(self, clause, candidates, vocab):
        """A species id Laya resolves among ambiguous candidates, or None (the owner is asked)."""
        pick = self._ask(clause, 'entity', lambda: self.classifier.choose_entity(clause.text, 'Pokémon', _choices_species(candidates, vocab)))
        cal = self.calibration
        if pick is None or cal is None or cal.entity_threshold is None:
            return None
        choice = pick.get('choice')
        if not (isinstance(choice, str) and choice.isdigit() and int(choice) in candidates):
            return None
        if cal.legacy_entity_confidence:
            return int(choice) if pick.get('confidence', 0.0) >= cal.entity_threshold else None
        q = calibrate(pick.get('probabilities') or {}, cal.entity_temperature)
        return int(choice) if q.get(choice, 0.0) >= cal.entity_threshold else None


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------
class Lazy:
    """A context value computed on first use (e.g. a local HTTP or save read)."""
    def __init__(self, function):
        self.function = function


class Context:
    def __init__(self, value):
        self.value = dict(value or {})
        self.cache = {}

    def get(self, name, default=None):
        if name in self.cache:
            return self.cache[name]
        value = self.value.get(name, default)
        if isinstance(value, Lazy) or (callable(value) and not isinstance(value, (dict, list, str))):
            try:
                value = (value.function if isinstance(value, Lazy) else value)()
            except Exception:
                value = default
        self.cache[name] = value
        return value

    def peek(self, name):
        """A value that is already available (never triggers a lazy read)."""
        if name in self.cache:
            return self.cache[name]
        value = self.value.get(name)
        return None if isinstance(value, Lazy) or callable(value) else value

    def session(self):
        s = self.get('session')
        return s if isinstance(s, dict) else None

    def running(self):
        s = self.session()
        return bool(s) and s.get('state') not in (None, 'offline', 'closed', 'reconnecting')

    def party(self):
        s = self.session() or {}
        party = (s.get('spectator') or {}).get('party')
        if isinstance(party, list) and party:
            return party
        observed = (s.get('observation') or {}).get('party') or []
        return [{'speciesId': p.get('species'), 'level': p.get('level'), 'hp': p.get('hp'), 'maxHp': p.get('maxHp')} for p in observed if isinstance(p, dict)]


# ---------------------------------------------------------------------------
# Slot helpers
# ---------------------------------------------------------------------------
def _num(tokens, k):
    return int(tokens[k]) if 0 <= k < len(tokens) and tokens[k].isdigit() else None


def _span_at(spans, k):
    return next((s for s in spans if s.start <= k < s.end), None)


def _stat_spans(clause):
    return [s for s in clause.spans if 'stat' in s.kinds()]


def _choices_species(values, vocab):
    return [{'id': str(v), 'label': vocab.name(v)} for v in values]


def _clarify(clause, slot, question, choices, free=True):
    clause.status = 'clarify'
    clause.clarify = {'id': f'{clause.index}:{slot}', 'slot': slot, 'clause': clause.index, 'question': question, 'choices': choices, 'freeText': free}


def _answer_for(clause, slot, answers):
    return (answers or {}).get(f'{clause.index}:{slot}')


def _resolve_answer(value, kind, vocab, choices=None):
    """A clarification answer: a choice id, or free text resolved like the request."""
    if value is None:
        return None
    text = str(value).strip()
    for c in choices or []:
        if text == str(c['id']):
            return c['id']
    if kind == 'species' and text.isdigit() and int(text) in vocab.names:
        return int(text)
    toks = [t for t in _tokens(text) if t != ',']
    spans = find_spans(toks, vocab)
    for s in spans:
        values = s.values(kind)
        if len(values) == 1:
            return values[0][0]
    return None


def _species(clause, vocab, answers, laya=None, ctx=None):
    """(species id | None, other-game id | None); clarifies when ambiguous."""
    values = []
    other = []
    for s in clause.spans:
        sv = s.values('species')
        if sv:
            values.append((s, [v for v, _ in sv]))
        elif s.values('other'):
            other.append(s.values('other')[0][0])
    answer = _answer_for(clause, 'species', answers)
    if answer is not None:
        resolved = _resolve_answer(answer, 'species', vocab)
        if isinstance(resolved, str) and resolved.isdigit():
            resolved = int(resolved)
        if resolved in vocab.names:
            clause.certainty = min(clause.certainty, 1.0)
            return resolved, None
    if not values:
        return None, (other[0] if other else None)
    candidates = []
    for span, ids in values:
        candidates += [i for i in ids if i not in candidates]
    if len(candidates) > 1:
        genders = {v for s in clause.spans for v, _ in s.values('gender')}
        if set(candidates) == {29, 32} and len(genders) == 1:
            return (29 if 'female' in genders else 32), None
        if laya is not None:
            chosen = laya.choose_species(clause, candidates, vocab)
            if chosen is not None:
                return chosen, None
        _clarify(clause, 'species', 'Which Pokémon do you mean?', _choices_species(candidates, vocab))
        return None, None
    span = values[0][0]
    clause.certainty = min(clause.certainty, span.score)
    if candidates[0] in (29, 32) and 'gender' not in clause.slots:
        clause.slots['gender'] = 'female' if candidates[0] == 29 else 'male'
    return candidates[0], None


def _hedged(tokens):
    text = ' '.join(tokens)
    return bool(re.search(r'\b(preferably|ideally|prefer|preferred|if possible|if you can|would be nice|optional)\b', text))


def _shiny(tokens):
    text = ' '.join(tokens)
    if re.search(r'\b(non|not|no) shiny\b|\b(does|do) not (need|have) to be shiny\b|\bnot (need|needed) (to be )?shiny\b|\b(regular|normal)( colou?red)?\b(?!.*\bshiny\b)|\bany colou?r\b', text):
        return 'any'
    if 'shiny' in tokens:
        return 'required'
    return None


LOW_IV = {'min': 0, 'minimum': 0, 'zero': 0, 'no': 0, 'worst': 0, 'lowest': 0, 'low': 5, 'bad': 5, 'poor': 5}
HIGH_IV = {'perfect': 31, 'max': 31, 'maxed': 31, 'flawless': 31, 'full': 31, 'best': 31, 'high': 25}


def _iv_rule(before, after):
    """('min'|'max'|'range', ...) for one stat from the words around it, or None."""
    b = ' '.join(before)
    for pattern, kind, shift in [(r'(at most|no more than|up to|max|maximum) (\d+)$', 'max', 0), (r'(under|below|less than) (\d+)$', 'max', -1),
                                 (r'(at least|min|minimum) (\d+)$', 'min', 0), (r'(over|above|more than) (\d+)$', 'min', 1),
                                 (r'(\d+) or (more|higher|better|above)$', 'min', 0), (r'(\d+) or (less|lower|below|fewer)$', 'max', 0)]:
        m = re.search(pattern, b)
        if m:
            n = int(next(g for g in m.groups() if g and g.isdigit())) + shift
            return (kind, n) if 0 <= n <= 31 else None
    m = re.search(r'between (\d+) and (\d+)$', b)
    if m and int(m.group(2)) <= 31:
        return ('range', min(int(m.group(1)), int(m.group(2))), max(int(m.group(1)), int(m.group(2))))
    if before and before[-1].isdigit():
        n = int(before[-1])
        return None if n > 31 else ('max', 0) if n == 0 else ('min', n)
    if before and before[-1] in LOW_IV:
        return ('max', LOW_IV[before[-1]])
    if before and before[-1] in HIGH_IV:
        return ('min', HIGH_IV[before[-1]])
    a = after[1:] if after[:1] in (['iv'], ['ivs']) else after
    t = ' '.join(a)
    for pattern, kind, shift in [(r'^(of |at |= )?(at most|no more than|up to|max|maximum) (\d+)', 'max', 0), (r'^(under|below|less than) (\d+)', 'max', -1),
                                 (r'^(at least|min|minimum) (\d+)', 'min', 0), (r'^(over|above|more than) (\d+)', 'min', 1),
                                 (r'^(of |= )?(\d+) or (less|lower|below|fewer)', 'max', 0), (r'^(of |= )?(\d+)( or (more|higher|better|above))?\b', 'min', 0)]:
        m = re.search(pattern, t)
        if m and (after[:1] in (['iv'], ['ivs']) or kind == 'max' or m.group(0).split()[0] not in ('of',)):
            n = int(next(g for g in m.groups() if g and g.isdigit())) + shift
            if not 0 <= n <= 31:
                return None
            return ('max', 0) if kind == 'min' and n == 0 else (kind, n)
    m = re.search(r'^between (\d+) and (\d+)', t)
    if m and int(m.group(2)) <= 31:
        return ('range', min(int(m.group(1)), int(m.group(2))), max(int(m.group(1)), int(m.group(2))))
    return None


def _iv_ranges(tokens, clause, skip=frozenset()):
    """(minIvs, maxIvs) per stat: "31 speed and 30+ special attack", "0 attack", "min speed", "speed iv at most 10"."""
    kept = [t for k, t in enumerate(tokens) if k not in skip]
    text = ' '.join(kept)
    mins, maxs = {}, {}
    m = re.search(r'\b(at least|minimum|above|over|min) (\d+) (in )?(ivs?|iv) (in )?(every|all|each)( stats?)?\b|\b(all|every) ivs? (above|over|at least) (\d+)\b|\b(\d+) (or more )?ivs? in (every|all|each)', text)
    if m:
        n = next(int(g) for g in m.groups() if g and g.isdigit())
        if n <= 31:
            return {s: n for s in STATS}, {}
    stats = [s for s in _stat_spans(clause) if s.start not in skip]
    if re.search(r'\b(perfect|max|maxed|flawless|31|6|six) ivs?\b|\bivs? (all )?31\b|\b6 x 31\b|\bperfectly ivd\b', text) and not stats:
        return {s: 31 for s in STATS}, {}
    previous = None
    for s in stats:
        stat = s.values('stat')[0][0]
        before = [t for k, t in enumerate(tokens[max(0, s.start - 4):s.start], max(0, s.start - 4)) if k not in skip]
        after = [t for k, t in enumerate(tokens[s.end:s.end + 5], s.end) if k not in skip]
        rule = _iv_rule(before, after)
        if rule is None and previous and previous[1] is not None and all(t in ('and', ',', 'or') for t in tokens[previous[0].end:s.start]):
            rule = previous[1]  # "0 attack and speed"
        if rule:
            if rule[0] == 'min':
                mins[stat] = rule[1]
            elif rule[0] == 'max':
                maxs[stat] = rule[1]
            else:
                mins[stat], maxs[stat] = rule[1], rule[2]
        previous = (s, rule)
    if not mins and not maxs and re.search(r'\b(perfect|max|maxed|flawless) ivs?\b', text):
        return {s: 31 for s in STATS}, {}
    return mins, maxs


def _ivs(tokens, clause):
    text = ' '.join(tokens)
    ivs = {}
    m = re.search(r'\b(at least|minimum|above|over|min) (\d+) (in )?(ivs?|iv) (in )?(every|all|each)( stats?)?\b|\b(all|every) ivs? (above|over|at least) (\d+)\b|\b(\d+) (or more )?ivs? in (every|all|each)', text)
    if m:
        n = next(int(g) for g in m.groups() if g and g.isdigit())
        if n <= 31:
            return {s: n for s in STATS}
    if re.search(r'\b(perfect|max|maxed|flawless|31|6|six) ivs?\b|\bivs? (all )?31\b|\b6 x 31\b|\bperfectly ivd\b', text) and not _stat_spans(clause):
        return {s: 31 for s in STATS}
    for s in _stat_spans(clause):
        stat = s.values('stat')[0][0]
        before = tokens[max(0, s.start - 2):s.start]
        after = tokens[s.end:s.end + 3]
        value = None
        if before and before[-1] in ('perfect', 'max', 'maxed', 'flawless', 'full'):
            value = 31
        elif before and before[-1].isdigit():
            value = int(before[-1])
        elif len(before) > 1 and before[-2].isdigit() and before[-1] in ('in', 'for'):
            value = int(before[-2])
        elif after and after[0] in ('iv', 'ivs') and len(after) > 1 and after[1].isdigit():
            value = int(after[1])
        if value is not None and value <= 31:
            ivs[stat] = value
    if not ivs and re.search(r'\b(perfect|max|maxed|flawless) ivs?\b', text):
        return {s: 31 for s in STATS}
    return ivs


EV_CUES = {'ev', 'evs', 'effort'}
EV_LINK = {'and', 'or', ',', 'max', 'maxed', 'full', 'in', 'on', 'of', 'with', 'out', 'spread', 'values', 'value', 'its', 'the'}


def _ev_segment(tokens, spans):
    """Token indexes of an EV phrase inside a catch request ("with 252 attack and 252 speed evs")."""
    stat_at = {k for s in spans if 'stat' in s.kinds() for k in range(s.start, s.end)}
    seg = set()
    for c in [k for k, t in enumerate(tokens) if t in EV_CUES]:
        seg.add(c)
        k = c - 1
        while k >= 0 and (k in stat_at or tokens[k].isdigit() or tokens[k] in EV_LINK):
            seg.add(k)
            k -= 1
        k = c + 1
        while k < len(tokens) and (k in stat_at or tokens[k].isdigit() or tokens[k] in EV_LINK | {'train', 'training', 'trained', 'it', 'them'}):
            seg.add(k)
            k += 1
    return seg


def _ev_values(tokens, spans, within=None):
    """EV targets from stats and numbers: "252 atk 252 spe 4 hp", "attack 252 speed 252", "max attack and speed".

    Returns (evs, error). Stats without a number share what is left of 510, up to 252 each.
    """
    stats = [s for s in spans if 'stat' in s.kinds() and (within is None or s.start in within)]
    if not stats:
        return {}, None
    first = stats[0]
    number_first = first.start > 0 and tokens[first.start - 1].isdigit()
    evs = {}
    for s in stats:
        stat = EV_KEYS[s.values('stat')[0][0]]
        before = tokens[s.start - 1] if s.start > 0 else ''
        after = tokens[s.end] if s.end < len(tokens) else ''
        if number_first and before.isdigit():
            evs[stat] = int(before)
        elif not number_first and after.isdigit():
            evs[stat] = int(after)
        elif before in ('max', 'maxed', 'full'):
            evs[stat] = 252
        else:
            evs[stat] = None
    budget = 510 - sum(v for v in evs.values() if v)
    for k in [k for k, v in evs.items() if v is None]:
        evs[k] = max(0, min(252, budget))
        budget -= evs[k]
    if any(v > 255 for v in evs.values()):
        return evs, 'EV targets are 0 to 255 per stat (252 is the useful maximum).'
    if sum(evs.values()) > 510:
        return evs, f'EV targets add up to {sum(evs.values())}; the total cannot exceed 510.'
    return evs, None


SIX_EVS = ('hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed')


def _levels(tokens):
    text = ' '.join(tokens)
    final = None
    encounter = None
    m = re.search(r'\b(trained|train|leveled|levelled|level|raised|raise|grown|grow|grind|grinded|ground)( it| them)?( up)? to (level )?(\d+)\b|\bfinal level (\d+)\b|\bto level (\d+)\b', text)
    if m:
        final = int(next(g for g in reversed(m.groups()) if g and g.isdigit()))
    m = re.search(r'\bbetween (level )?(\d+) and (\d+)\b|\blevels? (\d+) (to )?(\d+)\b', text)
    if m:
        nums = [int(g) for g in m.groups() if g and g.isdigit()]
        encounter = {'min': min(nums[:2]), 'max': max(nums[:2])}
    else:
        for m in re.finditer(r'\blevel (\d+)\b', text):
            pre = text[:m.start()].split()[-1:] if text[:m.start()].split() else []
            if pre and pre[0] in ('to', 'final'):
                continue
            n = int(m.group(1))
            if final is not None and n == final:
                continue
            encounter = {'min': n, 'max': n}
    return final, encounter


def _nickname(tokens, case, vocab, spans):
    for k, t in enumerate(tokens):
        if t in ('named', 'called', 'nicknamed', 'nickname') or (t in ('name', 'call') and k + 1 < len(tokens) and tokens[k + 1] in ('it', 'him', 'her', 'them')):
            j = k + 1
            while j < len(tokens) and tokens[j] in ('it', 'him', 'her', 'them', 'as'):
                j += 1
            if j >= len(tokens):
                return None
            if _span_at(spans, j) and _span_at(spans, j).kinds() & {'species', 'other'}:
                return None
            word = tokens[j]
            if re.fullmatch(r'[a-z]{1,10}', word):
                original = case.get(word, word)
                return original if not original.islower() else original.capitalize()
    return None


def _ball(clause):
    for s in clause.spans:
        balls = s.values('ball')
        if balls:
            return balls[0][0]
    return None


def _encounter(mon, clause, vocab):
    """Match a mentioned place against the species' own encounter locations."""
    places = [s for s in clause.spans if 'place' in s.kinds() and 'ball' not in s.kinds()]
    if not places:
        return None, None
    words = [w for w in places[0].text.split() if w not in ('the', 'a')]
    alternatives = [words, ['road' if w == 'route' else w for w in words]]
    for e in sorted(mon.get('encounters', []), key=lambda e: -(e.get('chance') or 0)):
        name = key(e['location'])
        tokens = name.split()
        if any(all(w in tokens for w in alt) for alt in alternatives):
            return e, places[0]
    return False, places[0]


def _party_spans(clause):
    return [s for s in clause.spans if 'party' in s.kinds()]


# ---------------------------------------------------------------------------
# Builders (existing contracts only)
# ---------------------------------------------------------------------------
class Builder:
    def __init__(self, interpreter, ctx, answers, case, original='', prior=(), laya=None):
        self.original = original
        self.prior = list(prior)
        self.vocab = interpreter.vocab
        self.interpreter = interpreter
        self.ctx = ctx
        self.answers = answers or {}
        self.case = case
        self.laya = laya  # this request's LayaSession (None: deterministic only)

    def defaults(self):
        from .pokemon_bot_settings import defaults
        value = self.ctx.get('botSettings')
        if isinstance(value, dict) and 'preferences' in value and isinstance(value['preferences'], dict):
            value = value['preferences']
        base = defaults()
        if isinstance(value, dict):
            base.update({k: copy.deepcopy(v) for k, v in value.items() if k in base})
        return base

    # -- catch ---------------------------------------------------------------
    def catch(self, clause):
        vocab = self.vocab
        tokens = clause.tokens
        text = ' '.join(tokens)
        game = re.search(r'\b(in|on|for|from) (pokemon )?(' + '|'.join(sorted(GAMES, key=len, reverse=True)) + r')\b', text)
        if game:
            clause.status = 'unsupported'
            clause.slots['unsupported'] = 'other-game'
            clause.message = f'Automatic hunts run in FireRed. {GAMES[game.group(3)]} takes part only in trades and evolutions.'
            return
        hp_tokens = hidden_power_tokens(tokens)
        hp_type = hidden_power_type(tokens)
        sid, other = _species(clause, vocab, self.answers, self.laya, self.ctx)
        if clause.status == 'clarify':
            return
        abilities = [(v, label, kind) for s in clause.spans for kind in ('ability', 'other-ability') for v, label in s.values(kind)]
        if sid is None and not other and abilities:
            self.ability_search(clause, abilities[0])
            return
        if sid is None and other:
            clause.status = 'unsupported'
            clause.slots['unsupported'] = 'species-not-in-game'
            clause.message = f'{vocab.name(other)} (#{other}) isn’t in FireRed; it has Pokémon #1–386.'
            return
        if sid is None:
            m = re.search(r'\b(catch|get|find|grab|hunt|capture)( \w+)? (me|us|you|him|her|them)\b( (\w+))?', text)
            if m and (m.group(5) or '') not in ('a', 'an', 'some', 'shiny', 'something', 'one', 'another', 'more', 'that', 'this', 'the', 'any') \
                    and not (m.group(5) or '').isdigit():
                clause.status = 'rejected'
                return
            _clarify(clause, 'species', 'Which Pokémon should the bot catch?', [])
            return
        slots = clause.slots
        slots['species'] = sid
        if hp_type:
            slots['hiddenPower'] = {'type': hp_type}
        shiny = _shiny(tokens)
        if shiny:
            slots['shiny'] = shiny
        natures = []
        for s in clause.spans:
            natures += [v for v, _ in s.values('nature') if v not in natures and not (s.kinds() & {'species', 'item', 'ball', 'place'})]
        if natures:
            slots['natures'] = natures
        genders = [v for s in clause.spans for v, _ in s.values('gender')]
        if genders:
            slots['gender'] = genders[0]
        ball = _ball(clause)
        if ball:
            slots['ball'] = ball
            slots['ballRequirement'] = 'preferred' if _hedged(tokens) else 'required'
        chosen_ball = _answer_for(clause, 'ball', self.answers)
        if chosen_ball in ('safari-ball', 'any'):
            slots['ball'] = chosen_ball
            slots['ballRequirement'] = 'required' if chosen_ball == 'safari-ball' else 'preferred'
        ev_seg = _ev_segment(tokens, clause.spans)
        mins, maxs = _iv_ranges(tokens, clause, skip=ev_seg)
        if mins:
            slots['minIvs'] = mins
        if maxs:
            slots['maxIvs'] = maxs
        mon = vocab.species[sid]
        if abilities:
            aid, label, kind = abilities[0]
            own = [(a['id'], a['name']) for a in mon['abilities']]
            answer = _answer_for(clause, 'ability', self.answers)
            if answer == 'any':
                pass
            elif answer is not None and str(answer).isdigit() and int(answer) in [i for i, _ in own]:
                slots['ability'] = int(answer)
            elif aid in [i for i, _ in own] and kind == 'ability':
                slots['ability'] = aid
            else:
                names = ', '.join(n for _, n in own)
                why = f'{label} isn’t available in FireRed (it arrived in a later generation)' if kind == 'other-ability' else f"{mon['name']} can’t have {label} in FireRed"
                _clarify(clause, 'ability', f"{why}. Its abilit{'y is' if len(own) == 1 else 'ies are'} {names}. Which should it have?",
                         [{'id': str(i), 'label': n} for i, n in own] + [{'id': 'any', 'label': 'Any ability'}], free=False)
                return
        final, encounter = _levels(tokens)
        if final is not None:
            slots['finalLevel'] = final
        if encounter:
            slots['encounterLevel'] = encounter
        nick = _nickname(tokens, self.case, vocab, clause.spans)
        if nick:
            slots['nickname'] = nick
        moves = [v for s in clause.spans for v, _ in s.values('move') if (s.kinds() == {'move'} or 'move' in s.kinds() and not (s.kinds() & {'species', 'item', 'ball', 'held', 'place'}))
                 and not set(range(s.start, s.end)) & hp_tokens]
        if moves:
            slots['moves'] = moves[:4]
        for s in clause.spans:
            held = s.values('held')
            if held and set(tokens[max(0, s.start - 3):s.start]) & {'holding', 'holds', 'hold', 'held', 'carrying', 'carries'}:
                slots['heldItem'] = held[0][0]
        consumed = set()
        for k, t in enumerate(tokens):
            if not t.isdigit():
                continue
            nxt = tokens[k + 1] if k + 1 < len(tokens) else ''
            prev = tokens[k - 1] if k else ''
            if k in ev_seg or prev in ('level', 'to', 'final', 'least', 'and', 'minimum', 'above', 'over', 'most', 'under', 'below', 'max', 'maximum', 'iv', 'ivs') \
                    or nxt in ('iv', 'ivs', 'in', 'or', 'x') or (_span_at(clause.spans, k + 1) and 'stat' in _span_at(clause.spans, k + 1).kinds()) \
                    or (_span_at(clause.spans, k - 1) and 'stat' in _span_at(clause.spans, k - 1).kinds()):
                consumed.add(k)
                continue
            if 'quantity' not in slots:
                slots['quantity'] = int(t)
        static = sid in _static_ids()
        if not static:
            encounter_hit, place = _encounter(mon, clause, vocab)
            answer = _answer_for(clause, 'location', self.answers)
            if answer is not None:
                chosen = next((e for e in mon['encounters'] if e['id'] == answer), None)
                encounter_hit = chosen if chosen else (None if answer == 'any' else encounter_hit)
            if encounter_hit is False:
                choices = [{'id': 'any', 'label': 'Anywhere it appears'}]
                for e in mon['encounters']:
                    if e['location'] not in [c['label'] for c in choices]:
                        choices.append({'id': e['id'], 'label': e['location']})
                _clarify(clause, 'location', f"{mon['name']} isn’t found at {place.hits[0].label}. Where should the bot look?", choices[:12], free=False)
                return
            if encounter_hit:
                slots['location'] = encounter_hit['location']
                slots['locationId'] = encounter_hit['id']
        request = self.farming_request(slots, mon, static)
        if isinstance(request, str):
            clause.status = 'invalid'
            clause.message = request
            return
        clause.steps.append({'kind': 'farming', 'request': request})
        clause.request_for_preview.append(request)
        inline = [k for k in ev_seg if k < len(tokens) and _span_at(clause.spans, k) and 'stat' in _span_at(clause.spans, k).kinds()]
        if inline:
            evs, error = _ev_values(tokens, clause.spans, within=ev_seg)
            if error or request['quantity'] != 1:
                clause.status = 'invalid'
                clause.message = error or 'EV training right after a hunt works on one Pokémon. Ask for one at a time.'
                return
            clause.slots['evs'] = evs
            clause.steps.append({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'ev-training', 'fingerprint': {'$ref': ('clause', clause.index)},
                                 'evs': {k: evs.get(k, 0) for k in SIX_EVS}, 'ivRanges': {}}})
        bits = []
        if request['quantity'] != 1:
            bits.append(str(request['quantity']))
        if request['shiny'] == 'required':
            bits.append('shiny')
        bits += [n.capitalize() for n in request['natures'][:2]]
        if request['gender'] != 'any' and 'gender' in slots:
            bits.append(request['gender'])
        extras = []
        if 'ball' in slots:
            extras.append(f"{'preferably ' if request['ball']['requirement'] == 'preferred' else ''}in a {_ball_name(request['ball']['id'], vocab)}")
        if slots.get('ability'):
            extras.append(f"with {vocab.abilities.get(slots['ability'], 'its ability')}")
        if slots.get('minIvs') or slots.get('maxIvs'):
            parts = [f'{k} ≥ {v}' for k, v in slots.get('minIvs', {}).items()] if len(slots.get('minIvs', {})) < 6 else ['all ≥ %d' % min(slots['minIvs'].values())]
            parts += [f'{k} ≤ {v}' for k, v in slots.get('maxIvs', {}).items()]
            extras.append('IVs ' + ', '.join(parts))
        if slots.get('hiddenPower'):
            extras.append('with Hidden Power ' + slots['hiddenPower']['type'].capitalize())
        if slots.get('evs'):
            extras.append('then EV-train it (' + ', '.join(f'{v} {k}' for k, v in slots['evs'].items()) + ')')
        if slots.get('nickname'):
            extras.append(f"named {slots['nickname']}")
        if slots.get('location'):
            extras.append(f"at {slots['location']}")
        if slots.get('finalLevel'):
            extras.append(f"raised to level {slots['finalLevel']}")
        if slots.get('moves'):
            extras.append('knowing ' + ', '.join(vocab.moves.get(m, str(m)) for m in slots['moves']))
        if slots.get('heldItem'):
            extras.append('holding ' + next((h['name'] for h in vocab.dex.get('heldItems', []) if h['id'] == slots['heldItem']), 'an item'))
        what = ' '.join(bits + [mon['name']])
        clause.summary = f"Catch {what}" + (' ' + ', '.join(extras) if extras else '') + (' (priority legendary target)' if static else '')

    def farming_request(self, slots, mon, static):
        d = self.defaults()
        sid = mon['id']
        gender = slots.get('gender')
        rate = mon.get('genderRate')
        if gender:
            if (rate == -1 and gender != 'genderless') or (rate != -1 and gender == 'genderless') or (rate == 0 and gender == 'female') or (rate == 8 and gender == 'male'):
                return 'That gender is not possible for this Pokémon.'
        else:
            gender = d['gender']
            if (rate == -1 and gender != 'genderless') or (rate != -1 and gender == 'genderless') or (rate == 0 and gender == 'female') or (rate == 8 and gender == 'male'):
                gender = 'any'
        if 'ball' in slots:
            ball = {'id': slots['ball'], 'requirement': slots.get('ballRequirement', 'required')}
        else:
            ball = dict(d['ball'])
            if static and ball['id'] not in _static_balls(sid):
                ball = {'id': 'any', 'requirement': 'preferred'}
        request = {'schema': 'pokemon-suite/farming-request/v1', 'game': 'firered', 'speciesId': sid, 'quantity': slots.get('quantity', 1),
                   'locationId': 'any' if static else slots.get('locationId', 'any'), 'shiny': slots.get('shiny', d['shiny']),
                   'natures': list(slots.get('natures', d['natures'])), 'gender': gender, 'abilityId': slots.get('ability'), 'ball': ball,
                   'minIvs': dict(slots.get('minIvs', d['minIvs'])), 'minDvs': {}, 'encounterLevel': dict(slots.get('encounterLevel', {'min': 1, 'max': 100})),
                   'finalLevel': slots.get('finalLevel'), 'moves': list(slots.get('moves', [])), 'heldItemId': slots.get('heldItem'),
                   'limits': dict(d['limits']), 'afterCompletion': d['afterCompletion']}
        if not 1 <= request['quantity'] <= 99:
            return 'Choose a quantity from 1 to 99.'
        if slots.get('nickname'):
            request['nickname'] = slots['nickname']
        if slots.get('maxIvs'):
            if any(v < request['minIvs'].get(k, 0) for k, v in slots['maxIvs'].items()):
                return 'Each maximum IV must be at least its minimum.'
            request['maxIvs'] = dict(slots['maxIvs'])
        if slots.get('hiddenPower'):
            request['hiddenPower'] = dict(slots['hiddenPower'])
        return request

    def ability_search(self, clause, ability):
        """'Find a Pokémon with Intimidate': offer the FireRed species that can have it, most available first."""
        aid, label, kind = ability
        if kind == 'other-ability':
            clause.status = 'invalid'
            clause.message = f'{label} isn’t in FireRed (it arrived in a later generation), so no FireRed Pokémon has it.'
            return
        ranked = sorted((r for r in (_availability(self.vocab, sid) for sid in self.vocab.ability_species.get(aid, [])) if r), key=lambda r: (r[0], r[1]))
        if not ranked:
            clause.status = 'invalid'
            clause.message = f'No Pokémon you can get in FireRed has {label}.'
            return
        _clarify(clause, 'species', f'These FireRed Pokémon can have {label}. Which one should the bot catch?',
                 [{'id': str(sid), 'label': f'{self.vocab.name(sid)} · {how}'} for _, sid, how in ranked[:12]])

    # -- player tasks ----------------------------------------------------------
    def _options(self):
        value = self.ctx.get('taskOptions')
        return value if isinstance(value, dict) and value.get('supported') else None

    def travel(self, clause):
        places = []
        for s in clause.spans:
            for v, label in s.values('place'):
                if (v, label) not in places:
                    places.append((v, label))
        answer = _answer_for(clause, 'place', self.answers)
        if answer is not None:
            resolved = _resolve_answer(answer, 'place', self.vocab, [{'id': v} for v, _ in places])
            if resolved:
                places = [(resolved, self.vocab.places.get(resolved, resolved))]
        if not places:
            _clarify(clause, 'place', 'Where should the bot go?', [{'id': p, 'label': self.vocab.places[p]} for p in
                                                                   ('MAP_PALLET_TOWN', 'MAP_CERULEAN_CITY', 'MAP_CELADON_CITY', 'MAP_CINNABAR_ISLAND', 'MAP_INDIGO_PLATEAU_EXTERIOR', 'MAP_ONE_ISLAND')])
            return
        if len(places) > 1:
            ids = [v for v, _ in places]
            specific = [(v, label) for v, label in places if any(v != o and v.startswith(o + '_') for o in ids)]
            if len(specific) == 1:
                places = specific
        if len(places) > 1:
            _clarify(clause, 'place', 'Which place do you mean?', [{'id': v, 'label': label} for v, label in places[:12]], free=False)
            return
        place, label = places[0]
        options = self._options()
        if options and place not in {m['id'] for m in options.get('locations', [])}:
            clause.status = 'invalid'
            clause.message = f'{label} isn’t in this game’s travel list.'
            return
        clause.slots['place'] = place
        clause.steps.append({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'travel', 'map': place}})
        clause.summary = f'Travel to {label} and save'

    def item(self, clause):
        found = None
        for s in clause.spans:
            for kind in ('item', 'ball', 'held'):
                values = s.values(kind)
                if values:
                    found = (values[0], kind)
                    break
            if found:
                break
        if not found:
            _clarify(clause, 'item', 'Which item should the bot get?', [])
            return
        (value, label), kind = found
        name_key = key(label)
        item_id = value if kind == 'item' else next((i for i, n in self.vocab.items.items() if key(n) == name_key), None)
        options = self._options()
        if options:
            match = next((i for i in options.get('items', []) if key(i.get('name', '')) == name_key), None)
            if match is None:
                clause.status = 'invalid'
                clause.message = f'{label} isn’t in this game’s item list.'
                return
            item_id = match['id']
        if item_id is None:
            clause.status = 'invalid'
            clause.message = f'{label} isn’t an item the bot can collect.'
            return
        quantity = next((int(t) for t in clause.tokens if t.isdigit()), 1)
        if not 1 <= quantity <= 99:
            clause.status = 'invalid'
            clause.message = 'Choose an item quantity from 1 to 99.'
            return
        clause.slots['item'] = item_id
        if quantity != 1:
            clause.slots['quantity'] = quantity
        clause.steps.append({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'item', 'itemId': item_id, 'quantity': quantity}})
        clause.summary = f'Get {quantity} × {label}' if quantity != 1 else f'Get a {label}'

    def heal(self, clause):
        clause.steps.append({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'heal'}})
        clause.summary = 'Heal the team'

    def save_game(self, clause):
        if re.search(r'\bsave (me|us|him|her|them|yourself|myself|the world|money|time|energy|lives?)\b', clause.text):
            clause.status = 'rejected'
            return
        clause.steps.append({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'save'}})
        clause.summary = 'Save the game'

    def ev_training(self, clause):
        text = clause.text
        pronoun = re.search(r'\b(it|them|its|that 1|that one|the new 1|the new one|the one you catch)\b', text)
        caught = next((c for c in reversed(self.prior) if c.intent == 'catch' and any(st['kind'] == 'farming' for st in c.steps)), None)
        named = any(s.values('party') or s.values('species') for s in clause.spans)
        if pronoun and caught is not None and not named:
            farm = next(st for st in caught.steps if st['kind'] == 'farming')
            if farm['request']['quantity'] != 1:
                clause.status = 'invalid'
                clause.message = 'EV training right after a hunt works on one Pokémon. Ask for one at a time.'
                return
            evs, error = _ev_values(clause.tokens, clause.spans)
            if error:
                clause.status = 'invalid'
                clause.message = error
                return
            if not evs:
                _clarify(clause, 'evs', 'Which stats should get effort values (for example “252 attack and 252 speed”)?', [], free=True)
                return
            name = self.vocab.name(farm['request']['speciesId'])
            clause.slots['target'] = farm['request']['speciesId']
            clause.slots['evs'] = evs
            clause.steps.append({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'ev-training', 'fingerprint': {'$ref': ('clause', caught.index)},
                                 'evs': {k: evs.get(k, 0) for k in SIX_EVS}, 'ivRanges': {}}})
            clause.summary = f'EV-train the new {name}: ' + ', '.join(f'{v} {k}' for k, v in evs.items())
            return
        roster = self.ctx.get('trainingPokemon')
        if isinstance(roster, dict):
            roster = roster.get('pokemon')
        roster = roster if isinstance(roster, list) else []
        target = None
        for s in clause.spans:
            party = s.values('party')
            if party:
                target = party[0][0]
                break
        if target is None:
            for s in clause.spans:
                species = s.values('species')
                if species:
                    target = {'speciesId': species[0][0]}
                    break
        answer = _answer_for(clause, 'target', self.answers)
        chosen = None
        if answer is not None:
            chosen = next((p for p in roster if p.get('fingerprint') == answer), None)
        elif target is not None:
            if target.get('fingerprint'):
                chosen = next((p for p in roster if p.get('fingerprint') == target['fingerprint']), None)
            matches = [p for p in roster if p.get('nationalSpeciesId') == target.get('speciesId')] if not chosen else [chosen]
            if len(matches) > 1:
                _clarify(clause, 'target', 'Which Pokémon should be EV-trained?', [{'id': p['fingerprint'], 'label': _individual(p)} for p in matches], free=False)
                return
            chosen = matches[0] if matches else None
        if chosen is None:
            if not roster:
                clause.status = 'invalid'
                clause.message = 'No Pokémon from the current save is available for EV training right now.'
                return
            _clarify(clause, 'target', 'Which Pokémon should be EV-trained?', [{'id': p['fingerprint'], 'label': _individual(p)} for p in roster[:12]], free=False)
            return
        evs, error = _ev_values(clause.tokens, clause.spans)
        if not evs:
            _clarify(clause, 'evs', 'Which stats should get effort values (for example “252 attack and 252 speed”)?', [], free=True)
            return
        if error:
            clause.status = 'invalid'
            clause.message = error
            return
        clause.slots['target'] = chosen.get('nationalSpeciesId')
        clause.slots['evs'] = evs
        full = {stat: evs.get(stat, 0) for stat in SIX_EVS}  # validate_effort_task wants all six
        clause.steps.append({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'ev-training', 'fingerprint': chosen['fingerprint'], 'evs': full, 'ivRanges': {}}})
        clause.summary = f"EV-train {_individual(chosen)}: " + ', '.join(f'{v} {k}' for k, v in evs.items())

    def control(self, clause, action, summary):
        clause.steps.append({'kind': 'player-task', 'action': action})
        clause.summary = summary

    def postgame(self, clause):
        clause.steps.append({'kind': 'postgame'})
        clause.summary = 'Work through the postgame checklist'

    def collection(self, clause):
        text = clause.text
        goal = 'national-dex' if re.search(r'\b(national|living|dex|pokedex)\b', text) else 'supported'
        step = {'kind': 'collection', 'goal': goal}
        if re.search(r'\b(every|each|all)( \w+)? (evolution )?stages?\b|\bincluding evolutions?\b|\bevery evolution\b', text):
            step['collectionStages'] = 'each-stage'
            clause.slots['collectionStages'] = 'each-stage'
        clause.slots['goal'] = goal
        clause.steps.append(step)
        clause.summary = 'Complete the shiny National Pokédex' if goal == 'national-dex' else 'Collect every supported shiny'

    def goal_cancel(self, clause):
        sid, _ = _species(clause, self.vocab, self.answers)
        clause.direct.append({'kind': 'cancel-goal', **({'speciesId': sid} if sid else {})})
        clause.summary = 'Cancel the ' + (f'{self.vocab.name(sid)} goal' if sid else 'current goal')

    # -- campaign / saves -------------------------------------------------------
    def new_game(self, clause):
        tokens = clause.tokens
        text = ' '.join(tokens)
        starter = None
        for s in clause.spans:
            for v, _ in s.values('species'):
                if v in STARTERS:
                    starter = STARTERS[v]
                elif starter is None and not s.values('party'):
                    starter = False
        answer = _answer_for(clause, 'starter', self.answers)
        if answer in ('bulbasaur', 'charmander', 'squirtle', 'random'):
            starter = answer
        if starter is None and re.search(r'\b(random|any|surprise)( \w+)? starter\b|\brandom\b', text):
            starter = 'random'
        if starter is None and re.search(r'\bstarter\b', text) and re.search(r'\b(ask me|which starter|not sure|do not know|dunno|undecided|decide)\b', text):
            _clarify(clause, 'starter', 'Which starter should the new game use?',
                     [{'id': s, 'label': s.capitalize()} for s in ('bulbasaur', 'charmander', 'squirtle', 'random')], free=False)
            return
        if starter is False:
            _clarify(clause, 'starter', 'FireRed starts with Bulbasaur, Charmander or Squirtle. Which one?',
                     [{'id': s, 'label': s.capitalize()} for s in ('bulbasaur', 'charmander', 'squirtle', 'random')], free=False)
            return
        name, label = _trainer_and_label(tokens, self.case, clause.spans, self.original)
        if name == '':
            clause.status = 'invalid'
            clause.message = 'FireRed trainer names have up to 7 letters. Choose a shorter name.'
            return
        after = 'wait' if re.search(r'\b(then|and) wait\b|\bstop after\b|\bwait after\b', text) else 'postgame'
        settings = {'starter': starter or 'random', 'afterCampaign': after}
        if name:
            settings['trainerName'] = name
            clause.slots['trainerName'] = name
        if label:
            settings['label'] = label
            clause.slots['label'] = label
        if starter:
            clause.slots['starter'] = starter
        clause.save = {'mode': 'new', 'trainerName': name, 'starter': starter or None, 'label': label}
        clause.steps.append({'kind': 'campaign', 'settings': settings})
        who = f' as {name}' if name else ''
        clause.summary = f"New save{who} with {(starter or 'a random starter').capitalize() if starter != 'random' else 'a random starter'} → play the story to the Hall of Fame"
        clause.confirm.append('Starts a new save from New Game (the current save is backed up first).')

    def save_new(self, clause):
        label = _free_label(clause.tokens, self.case, self.original) or 'New FireRed save'
        if label != 'New FireRed save':
            clause.slots['label'] = label
        clause.steps.append({'kind': 'player-task', 'action': 'new-save', 'task': {'label': label[:50]}})
        clause.summary = f'Back up the current game and open a new manual save “{label[:50]}”'
        clause.confirm.append('Opens a new manual save (the current save is backed up first).')

    def save_restore(self, clause):
        profiles = self.ctx.get('profiles')
        if profiles is None:
            options = self._options() or {}
            profiles = options.get('profiles')
        profiles = [p for p in profiles or [] if isinstance(p, dict) and p.get('id')]
        answer = _answer_for(clause, 'profile', self.answers)
        chosen = next((p for p in profiles if p['id'] == answer), None) if answer else None
        if not chosen:
            generic = {'save', 'backup', 'file', 'profile', 'my', 'the', 'game', 'a', 'old', 'restore', 'load'}
            words = (set(clause.tokens) | {a + b for a, b in zip(clause.tokens, clause.tokens[1:])}) - generic
            scored = []
            for p in profiles:
                label_words = set(key(p.get('label', '')).split()) - generic
                overlap = len(words & label_words)
                if not overlap and label_words:
                    close = [w for w in words if difflib.get_close_matches(w, list(label_words), n=1, cutoff=0.85)]
                    overlap = 0.8 * len(close)
                if overlap:
                    scored.append((overlap, p))
            scored.sort(key=lambda x: -x[0])
            if scored and (len(scored) == 1 or scored[0][0] > scored[1][0]):
                chosen = scored[0][1]
        if not chosen:
            if not profiles:
                clause.status = 'invalid'
                clause.message = 'There are no save backups to restore yet.'
                return
            _clarify(clause, 'profile', 'Which save backup should be restored?', [{'id': p['id'], 'label': p.get('label') or p['id']} for p in profiles[:12]], free=False)
            return
        clause.slots['profile'] = chosen['id']
        clause.steps.append({'kind': 'player-task', 'action': 'restore-save', 'task': {'profileId': chosen['id']}})
        clause.summary = f"Back up the current game and restore “{chosen.get('label') or chosen['id']}”"
        clause.confirm.append(f"Switches to the save backup “{chosen.get('label') or chosen['id']}” (the current save is backed up first).")

    # -- trades -------------------------------------------------------------
    def trade(self, clause, shiny_first):
        sid, _ = _species(clause, self.vocab, self.answers, self.laya)
        if clause.status == 'clarify':
            return
        party = next((s.values('party')[0][0] for s in clause.spans if s.values('party')), None)
        if sid is None and party:
            sid = party.get('speciesId')
        if sid is None:
            _clarify(clause, 'species', 'Which Pokémon should be traded?', [])
            return
        name = self.vocab.name(sid)
        clause.slots['species'] = sid
        shinies = [r for r in (self.ctx.get('shinies') or []) if isinstance(r, dict) and (r.get('nationalSpeciesId') or (r.get('pokemon') or {}).get('species')) == sid
                   and r.get('game', 'firered') == 'firered']
        inventory = self.ctx.get('inventory')
        if isinstance(inventory, dict):
            inventory = inventory.get('pokemon')
        owned = [p for p in inventory or [] if isinstance(p, dict) and p.get('nationalSpeciesId') == sid]
        wants = _shiny(clause.tokens)
        use_shiny = wants == 'required' or (wants is None and bool(shinies) and (shiny_first or not owned))
        if use_shiny:
            clause.intent = 'trade-shiny'
            answer = _answer_for(clause, 'shiny', self.answers)
            if answer:
                shinies = [r for r in shinies if r.get('id') == answer] or shinies
            if not shinies:
                clause.status = 'invalid'
                clause.message = f'No saved shiny {name} was found in FireRed.'
                return
            if len(shinies) > 1:
                _clarify(clause, 'shiny', f'Which shiny {name}?', [{'id': r['id'], 'label': _shiny_label(r, name)} for r in shinies], free=False)
                return
            record = shinies[0]
            if record.get('canTrade') is False:
                clause.status = 'invalid'
                clause.message = f'That shiny {name} can’t be traded right now. Open its game and finish or stop the current task first.'
                return
            clause.slots['shinyId'] = record['id']
            clause.steps.append({'kind': 'trade', 'via': 'trade-shiny', 'payload': {'shinyId': record['id']}})
            clause.summary = f'Trade away your shiny {name} ({_shiny_label(record, name)})'
            clause.confirm.append(f'Trades away your shiny {name}.')
            return
        clause.intent = 'trade-pokemon'
        answer = _answer_for(clause, 'pokemon', self.answers)
        if answer:
            owned = [p for p in owned if p.get('id') == answer] or owned
        if not owned:
            clause.status = 'invalid'
            clause.message = f'No {name} was found in the current save’s party or PC.'
            return
        if len(owned) > 1:
            _clarify(clause, 'pokemon', f'Which {name}?', [{'id': p['id'], 'label': f"{name} · {p.get('location', '')}".strip(' ·')} for p in owned[:12]], free=False)
            return
        pokemon = owned[0]
        clause.slots['pokemonId'] = pokemon['id']
        # The supervisor supplies the game and its live session when the step runs.
        clause.steps.append({'kind': 'trade', 'via': 'trade-pokemon', 'payload': {'pokemonId': pokemon['id'], 'sourceId': 'current'}})
        clause.summary = f"Trade {name} ({pokemon.get('location', 'current save')})"
        clause.confirm.append(f'Trades away your {name}.')

    # -- settings -------------------------------------------------------------
    def settings(self, clause):
        tokens = clause.tokens
        text = ' '.join(tokens)
        prefs = {}
        flat = {}
        ball = _ball(clause)
        if ball:
            requirement = 'preferred' if re.search(r'\bprefer', text) else 'required'
            prefs['ball'] = {'id': ball, 'requirement': requirement}
            flat['ball'] = ball
        if re.search(r'\b(only|always)( catch)? shin(y|ies)\b|\bshiny (is |should be )?(required|mandatory)\b|\brequire shin(y|ies)\b'
                     r'|\b(have|has|need|needs|must) (to )?be shiny\b|\bshiny only\b', text):
            prefs['shiny'] = flat['shiny'] = 'required'
        elif re.search(r'\bshiny (is |should be )?optional\b|\b(do not|dont) require shiny\b|\bany colou?r\b', text):
            prefs['shiny'] = flat['shiny'] = 'any'
        natures = [v for s in clause.spans for v, _ in s.values('nature')]
        if natures:
            prefs['natures'] = flat['natures'] = natures
        genders = [v for s in clause.spans for v, _ in s.values('gender')]
        if genders:
            prefs['gender'] = flat['gender'] = genders[0]
        if re.search(r'\b(rare candy|rare candies|candy|candies|qmm|mail)\b', text) and re.search(r'\b(supply|glitch|qmm|mail|candy|candies)\b', text):
            on = not re.search(r'\b(off|disable|stop|no more|turn off)\b', text)
            prefs['qmmRareCandySupply'] = flat['qmmRareCandySupply'] = on
        if re.search(r'\bprep(are|ped)?\b( \w+){0,3} (for )?(a )?trades?\b|\bready for (a )?trade\b', text):
            prefs['afterCompletion'] = flat['afterCompletion'] = 'prepare-trade'
        elif re.search(r'\b(stop and save|just save|save and stop)\b', text):
            prefs['afterCompletion'] = flat['afterCompletion'] = 'stop-save'
        if re.search(r'\b(every|each|all)( \w+)? (evolution )?stages?\b|\bevery evolution\b', text):
            prefs['collectionStages'] = flat['collectionStages'] = 'each-stage'
        elif re.search(r'\b(base|starting) forms?\b', text):
            prefs['collectionStages'] = flat['collectionStages'] = 'base-forms'
        limits = {}
        for pattern, name, scale in [(r'(\d+) (minutes?|mins?)\b', 'maxMinutes', 1), (r'(\d+) (hours?|hrs?)\b', 'maxMinutes', 60),
                                     (r'(\d+) encounters?\b|\bencounters? (to |at |of )?(\d+)\b', 'maxEncounters', 1),
                                     (r'\b(keep|reserve|at least) (\d+) (poke )?balls?\b', 'minBalls', 1),
                                     (r'\bspend (at most |up to |no more than )?(\d+)\b|\bbudget (of |to )?(\d+)\b', 'maxSpend', 1)]:
            m = re.search(pattern, text)
            if m:
                limits[name] = int(next(g for g in m.groups() if g and g.isdigit())) * scale
        if limits:
            prefs['limits'] = limits
            for k, v in limits.items():
                flat['limits.' + k] = v
        if 'ball' in prefs and not re.search(r'\b(default|always|by default|from now on|pokeball|ball)\b', text):
            pass
        if not prefs:
            clause.status = 'rejected'
            return
        clause.slots.update(flat)
        clause.direct.append({'kind': 'settings', 'preferences': prefs})
        clause.summary = 'Change default capture settings: ' + ', '.join(_describe_pref(k, v, self.vocab) for k, v in prefs.items())

    # -- status -----------------------------------------------------------------
    def status(self, clause):
        answer = ANSWERS.get(clause.intent)
        clause.answer = answer(self, clause) if answer else status_answer(clause.intent, self.ctx, self.vocab)
        clause.summary = clause.answer or ''


def _describe_pref(k, v, vocab):
    if k == 'ball':
        return f"{'prefer' if v['requirement'] == 'preferred' else 'require'} {_ball_name(v['id'], vocab)}"
    if k == 'limits':
        return ', '.join(f'{n} {m}' for n, m in v.items())
    if k == 'qmmRareCandySupply':
        return 'Rare Candy supply ' + ('on' if v else 'off')
    return f'{k} {v}'


def _ball_name(ball_id, vocab):
    return next((b['name'] for b in vocab.dex['balls'] if b['id'] == ball_id), ball_id.replace('-', ' ').title())


def _individual(p):
    name = p.get('name') or f"#{p.get('nationalSpeciesId')}"
    nick = p.get('nickname')
    where = p.get('location')
    return f"{nick + ' (' + name + ')' if nick else name}" + (f' · {where}' if where else '')


def _shiny_label(record, name):
    nature = ((record.get('pokemon') or {}).get('nature') or {}).get('name')
    caught = str(record.get('caughtAt') or '')[:10]
    return ' · '.join(x for x in (name, nature, f'caught {caught}' if caught else '') if x)


STOP_NAME = {'a', 'an', 'the', 'my', 'me', 'with', 'and', 'random', 'new', 'game', 'starter', 'is', 'as', 'called', 'named', 'save', 'run',
             'then', 'to', 'start', 'pick', 'choose', 'using', 'use', 'trainer', 'player', 'name', 'from', 'scratch', 'over', 'again', 'please'}


def _original_label(original, words):
    """The label as typed ("speedrun two", "Test run"), found after its cue in the original text."""
    for m in re.finditer(r"\b(called|named|titled|labell?ed|label)\s+[\"']?(.+?)[\"']?(?=\s+(?:with|and|then|as|using|starter)\b|[,.;!?]|$)", fold(original), re.I):
        label = m.group(2).strip()
        if not words or key(label).split()[:1] == words[:1]:
            return label[:50]
    return None


def _trainer_and_label(tokens, case, spans, original=''):
    name = None
    label = None
    text = ' '.join(tokens)
    for m in re.finditer(r'\b(as|trainer name( is)?|player name( is)?|my name is|call me|name me|name (?:the |my )?(?:trainer|player|character)(?: as)?|named|called|name)\s+([a-z]+(?: [a-z]+)*)', text):
        words = m.group(m.lastindex).split()
        run = []
        for w in words:
            if w in STOP_NAME or w in ('with', 'and', 'then'):
                break
            run.append(w)
        if not run:
            continue
        start_token = len(text[:m.start(m.lastindex)].split())
        span = _span_at(spans, start_token)
        if span and span.kinds() & {'species'}:
            continue
        cue = m.group(1)
        if cue in ('named', 'called') and len(run) > 1:
            label = _original_label(original, run) or ' '.join(case.get(w, w) for w in run)[:50]
            continue
        word = run[0]
        if re.fullmatch(r'[a-z]{1,7}', word) and name is None:
            original = case.get(word, word)
            name = original if not original.islower() else original.capitalize()
        elif name is None and cue not in ('named', 'called') and re.fullmatch(r'[a-z]{8,}', word):
            name = ''  # a name the game can't take
    return name, label


def _free_label(tokens, case, original=''):
    text = ' '.join(tokens)
    m = re.search(r'\b(called|named|labell?ed|titled|label)\s+(.+)$', text)
    if not m:
        return None
    words = []
    for w in m.group(2).split():
        if w in ('then', 'and', ','):
            break
        words.append(w)
    return _original_label(original, words) or ' '.join(case.get(w, w) for w in words).strip() or None


_LAND_CACHE = {}


def _land_species():
    if 'value' not in _LAND_CACHE:
        try:
            from .pokemon_hunt_routes import land_routes
            _LAND_CACHE['value'] = {r['speciesId']: r for r in land_routes()}
        except Exception:
            _LAND_CACHE['value'] = {}
    return _LAND_CACHE['value']


def _event_only(encounter):
    """Encounters that need a distribution event: Mystery Gift Altering Cave variants, the Japanese
    Colosseum bonus disc and the ticket islands (Navel Rock, Birth Island)."""
    location = str(encounter.get('location') or '')
    return (encounter.get('method') == 'colosseum-bonus-disc-jpn' or bool(re.match(r'Altering Cave \([B-I]\)', location))
            or location.startswith(('Navel Rock', 'Birth Island')))


def _availability(vocab, sid):
    """(rank, speciesId, how) for a FireRed-obtainable species, else None. 0 = the wild hunt executor
    has a route, 1 = another encounter (fishing, gift, static), 2 = only by evolving something obtainable."""
    mon = vocab.species.get(sid)
    if not mon:
        return None
    land = _land_species().get(sid)
    if land:
        return (0, sid, 'wild' + (f" ({land.get('location') or land.get('map', '')})" if land.get('location') or land.get('map') else ''))
    regular = [e for e in mon['encounters'] if not _event_only(e)]
    if regular:
        e = regular[0]
        return (1, sid, f"{e['method'].replace('-', ' ')} ({e['location']})")
    seen = set()
    parent = mon.get('evolvesFrom')
    while parent and parent not in seen:
        seen.add(parent)
        base = vocab.species.get(parent)
        if base and any(not _event_only(e) for e in base['encounters']):
            return (2, sid, f"evolves from {base['name']}")
        parent = base.get('evolvesFrom') if base else None
    return None


_STATIC_CACHE = {}


def _static_projection():
    if 'value' not in _STATIC_CACHE:
        try:
            from .pokemon_hunt_routes import static_encounters
            _STATIC_CACHE['value'] = static_encounters()
        except Exception:
            _STATIC_CACHE['value'] = []
    return _STATIC_CACHE['value']


def _static_ids():
    return {e['speciesId'] for e in _static_projection()}


def _static_balls(sid):
    return next((e.get('balls', []) for e in _static_projection() if e['speciesId'] == sid), [])


# ---------------------------------------------------------------------------
# Status answers (templates over the live payload)
# ---------------------------------------------------------------------------
OFFLINE = 'FireRed is not running right now, so there is no live state to report. Start the bot or open the game first.'


def status_answer(intent, ctx, vocab):
    s = ctx.session() or {}
    live = ctx.running()
    if intent == 'help':
        return ('I can catch or hunt any FireRed Pokémon (shiny, nature, gender, ball, IVs, quantity, nickname), travel, get items, heal, save, '
                'EV-train, start a new game with a trainer name and starter, manage save backups, trade saved shinies, run the postgame checklist '
                'or the shiny collection, start, stop or resume the bot, change default capture settings and answer questions about the team, hunt, '
                'location, progress, shinies and money, why the bot stopped, which Pokémon you have and where, their levels, IVs and EVs, '
                'and missing Pokédex entries. Try “get me a shiny Mewtwo” or “heal then go to Cinnabar and save”.')
    if intent == 'status-saves':
        profiles = ctx.get('profiles')
        if profiles is None:
            profiles = ((ctx.get('taskOptions') or {}) if isinstance(ctx.get('taskOptions'), dict) else {}).get('profiles')
        profiles = [p for p in profiles or [] if isinstance(p, dict)]
        if not profiles:
            return 'There are no save backups yet.'
        return f'{len(profiles)} save backup{"s" if len(profiles) != 1 else ""}: ' + ', '.join(f"{p.get('label')} ({str(p.get('createdAt', ''))[:10]})" for p in profiles) + '.'
    if intent == 'status-requests':
        records = ctx.get('requests')
        records = [r for r in records or [] if isinstance(r, dict)]
        if not records:
            return 'There are no saved Pokémon requests.'
        parts = []
        for r in records[:8]:
            req = r.get('request') or {}
            name = ((r.get('plan') or {}).get('pokemon') or {}).get('name') or vocab.name(req.get('speciesId'))
            parts.append(f"{name}{' (shiny)' if req.get('shiny') == 'required' else ''} — {r.get('state', 'saved')}")
        return f'{len(records)} saved request{"s" if len(records) != 1 else ""}: ' + '; '.join(parts) + '.'
    if intent == 'status-goals':
        goals = ctx.get('goals')
        if goals is None:
            return 'The goal supervisor isn’t available in this build, so no goals are tracked.'
        goals = [g for g in goals if isinstance(g, dict)]
        active = [g for g in goals if g.get('status') in ('queued', 'running', 'waiting')]
        if not active:
            return 'No goals are queued or running.'
        return '; '.join(f"{(g.get('source') or {}).get('text') or g.get('id')} — {g.get('status')}" + (f" ({(g.get('progress') or {}).get('detail')})" if (g.get('progress') or {}).get('detail') else '') for g in active[:6]) + '.'
    if intent == 'status-shinies':
        records = ctx.get('shinies')
        if records is None:
            records = s.get('collection')
        records = [r for r in records or [] if isinstance(r, dict)]
        if not records:
            return 'No saved shinies yet.'
        latest = max(records, key=lambda r: str(r.get('caughtAt') or ''))
        name = latest.get('name') or vocab.name(latest.get('nationalSpeciesId') or (latest.get('pokemon') or {}).get('species'))
        tradable = sum(1 for r in records if r.get('canTrade'))
        return f'{len(records)} saved shin{"ies" if len(records) != 1 else "y"} ({tradable} tradable now). Latest: {_shiny_label(latest, name)}.'
    if not live:
        return OFFLINE
    spectator = s.get('spectator') or {}
    trainer = spectator.get('trainer') or {}
    if intent == 'status-team':
        party = ctx.party()
        if not party:
            return 'The team isn’t visible right now.'
        parts = []
        for p in party:
            name = p.get('speciesName') or vocab.name(p.get('speciesId'))
            nick = p.get('nickname')
            label = f'{nick} ({name})' if nick and nick.lower() != str(name).lower() else name
            hp = f", {p['hp']}/{p['maxHp']} HP" if isinstance(p.get('hp'), int) and isinstance(p.get('maxHp'), int) else ''
            extra = ', shiny' if p.get('shiny') else ''
            status = f", {p['status']}" if p.get('status') not in (None, 'OK', '') else ''
            parts.append(f"{label} Lv{p.get('level', '?')}{hp}{extra}{status}")
        return 'Team: ' + '; '.join(parts) + '.'
    if intent == 'status-location':
        where = (spectator.get('map') or {}).get('name') or str(s.get('map') or '').removeprefix('MAP_').replace('_', ' ').title() or 'an unknown place'
        region = (spectator.get('map') or {}).get('region')
        return f'The player is in {where}' + (f' ({region})' if region else '') + '.'
    if intent == 'status-hunt':
        mission = s.get('mission') or s.get('pendingHunt')
        if not mission:
            active = (s.get('postgame') or {}).get('active')
            return 'No hunt is running.' + (f' The postgame checklist is on “{active}”.' if active else '')
        name = vocab.name(mission.get('speciesId')) if mission.get('speciesId') else str(mission.get('name', 'a Pokémon')).capitalize()
        phase = str(mission.get('phase') or mission.get('state') or '').replace('-', ' ')
        caught = mission.get('caught', 0)
        quantity = mission.get('quantity', 1)
        seconds = int((mission.get('elapsedMs') or 0) / 1000)
        took = f', {seconds // 60} min {seconds % 60} s' if seconds else ''
        return (f"Hunting {'shiny ' if mission.get('shiny') == 'required' else ''}{name} ({str(mission.get('method') or 'hunt').replace('-', ' ')}) — {phase}; "
                f"{mission.get('encounters', 0)} encounters, {caught} of {quantity} caught{took}." + (f" {mission['reason']}" if mission.get('reason') else ''))
    if intent == 'status-progress':
        badges = [b for b in spectator.get('badges') or [] if b.get('earned')]
        dex = trainer.get('pokedex') or {}
        parts = [f'{len(badges)}/8 badges']
        if dex:
            parts.append(f"Pokédex {dex.get('owned', '?')} owned / {dex.get('seen', '?')} seen")
        campaign = s.get('campaign') or {}
        if campaign:
            parts.append(f"campaign “{campaign.get('label', 'adventure')}” {campaign.get('status', '')}".strip())
        progress = (s.get('postgame') or {}).get('progress') or {}
        if progress.get('total'):
            parts.append(f"postgame {progress.get('completed', 0)}/{progress['total']} objectives")
        play = trainer.get('playTime') or {}
        if play:
            parts.append(f"{play.get('hours', 0)} h {play.get('minutes', 0)} min played")
        return 'Progress: ' + ', '.join(parts) + '.'
    if intent == 'status-bot':
        bot = s.get('bot') or {}
        if not bot.get('enabled'):
            return 'The bot is stopped; the game is under manual control.'
        state = bot.get('status') or s.get('state')
        doing = (s.get('mission') or {}).get('name')
        return f"The bot is {state}" + (f" ({bot.get('mode')})" if bot.get('mode') else '') + (f', hunting {str(doing).capitalize()}' if doing else '') + (f". {bot['reason']}" if bot.get('reason') else '.')
    if intent == 'status-money':
        money = trainer.get('money')
        return f'The trainer has ₽{money:,}.' if isinstance(money, int) else 'The trainer’s money isn’t visible right now.'
    return 'I can’t answer that yet.'


# Stage 5 answers (laya-nl-20260925): the stop triage, owned Pokémon, the Pokédex and the bag. Read-only, from data the host already has.
STAT_SHORT = (('hp', 'HP'), ('attack', 'Atk'), ('defense', 'Def'), ('spAttack', 'SpA'), ('spDefense', 'SpD'), ('speed', 'Spe'))
UNREADABLE = 'I can’t read the party or PC right now.'
NO_BAG = 'The bag isn’t readable yet: the save reader returns the party and PC, not the bag.'


def _stop_answer(b, clause):
    """Why the FireRed owner stopped: its stop triage (the sessions payload's card), and the one-tap fix only when code proved it safe."""
    from .pokemon_stop_triage import STOP_STATES
    s = b.ctx.session() or {}
    bot = s.get('bot') if isinstance(s.get('bot'), dict) else {}
    state = bot.get('status') or s.get('state')
    triage = s.get('triage') if isinstance(s.get('triage'), dict) else None
    if triage:
        action = triage.get('suggestedAction') if isinstance(triage.get('suggestedAction'), dict) else {}
        text = f"{'Recovering' if state == 'recovering' else 'Stopped'}: {triage.get('title') or 'no known cause'}. {triage.get('explanation') or ''}".rstrip()
        if action.get('safe') and action.get('token') and action.get('playerTask') and action.get('label'):
            # The existing one-tap path: POST player-tasks {game, action, triage}; confirm() re-derives the same safe action from fresh state.
            clause.offer = {'label': action['label'], 'confirm': action.get('confirm'), 'playerTask': {'game': 'firered', 'action': action['playerTask'], 'triage': action['token']}}
            return f"{text} The stop card offers a one-tap fix: {action['label']}. {action.get('why') or ''}".rstrip()  # Ask shows no button
        return f"{text} {action.get('why') or ''}".rstrip()
    if not b.ctx.running():
        return OFFLINE
    if state in STOP_STATES or s.get('state') in STOP_STATES:
        return f'The bot is {state}' + (f": {bot['reason']}" if bot.get('reason') else '.') + ' Its stop explanation isn’t available yet.'
    if not bot.get('enabled'):
        return 'The bot is off and the game is under manual control; no task is stopped.'
    return 'The bot is not stopped. ' + status_answer('status-bot', b.ctx, b.vocab)


def _where(p):
    """"party slot 3" or "Box 2, slot 3" from a PC-read record's location (the inventory's 0-based dict, or a label)."""
    loc = p.get('location')
    if isinstance(loc, dict):
        slot = loc.get('slot') if isinstance(loc.get('slot'), int) else None
        if loc.get('kind') == 'party':
            return f'party slot {slot + 1}' if slot is not None else 'the party'
        return (f"Box {loc['box'] + 1}" + (f', slot {slot + 1}' if slot is not None else '')) if isinstance(loc.get('box'), int) else 'the PC'
    loc = str(loc or '').strip()
    return loc[0].lower() + loc[1:] if loc.lower().startswith('party') else loc or 'the PC'


def _owned(ctx):
    """(individuals, live party read, PC read): the current save's Pokémon, one per place. The live party is the fresh one; the PC read
    (the last save's party and boxes) adds the boxes and fills in IVs and EVs. A PC-read party member the live party no longer has is dropped."""
    out = {}
    live = {f"party slot {(p['slot'] if isinstance(p.get('slot'), int) else i) + 1}": p for i, p in enumerate(ctx.party() if ctx.running() else [])}
    for where, p in live.items():
        if isinstance(p.get('speciesId'), int):
            out[(p['speciesId'], where)] = {'speciesId': p['speciesId'], 'where': where, 'level': p.get('level'), 'nickname': p.get('nickname')}
    read = False
    for name in ('inventory', 'trainingPokemon'):
        records = ctx.get(name)
        for p in (records.get('pokemon') if isinstance(records, dict) else records) or []:
            if not isinstance(p, dict) or p.get('isEgg') or not isinstance(p.get('nationalSpeciesId'), int):
                continue
            read = True
            where = _where(p)
            k = (p['nationalSpeciesId'], where.lower())
            if k not in out and live and k[1].startswith('party') and isinstance((live.get(k[1]) or {'speciesId': 0}).get('speciesId'), int):
                continue  # the live party has another Pokémon there, or no longer has that slot
            entry = out.setdefault(k, {'speciesId': p['nationalSpeciesId'], 'where': where})
            for f in ('level', 'nickname', 'ivs', 'evs'):
                if entry.get(f) is None and p.get(f) is not None:
                    entry[f] = p[f]
    return list(out.values()), bool(live), read


def _named(p, vocab):
    name = vocab.name(p['speciesId'])
    nick = p.get('nickname')
    return f"{nick} ({name}, {p['where']})" if nick and str(nick).lower() != name.lower() else f"{name} ({p['where']})"


def _asked(b, clause):
    """((species id, nickname) | None, individuals of it, live, pc) for the Pokémon a clause names; None species: none named."""
    target = next((s.values('party')[0][0] for s in clause.spans if s.values('party')), None)
    sid, nick = (target.get('speciesId'), target.get('nickname')) if isinstance(target, dict) else (_species(clause, b.vocab, b.answers)[0], None)
    owned, live, pc = _owned(b.ctx)
    if sid is None:
        return None, owned, live, pc
    clause.slots['species'] = sid
    hits = [p for p in owned if p['speciesId'] == sid]
    return (sid, nick), [p for p in hits if nick and str(p.get('nickname') or '').lower() == nick.lower()] or hits, live, pc


def _none_owned(name, live, pc):
    return f'No {name} in the party or PC.' if pc else f'No {name} in the party; I can’t read the PC right now.' if live else UNREADABLE


def _owned_answer(b, clause):
    if re.match(ASK + r'where (is|are)\b', clause.text) and not re.search(r'\b(my|our|your|i|we|you|pc|box|boxes|party|team)\b', clause.text) \
            and not any(s.values('party') for s in clause.spans):
        return None  # "where is mewtwo" asks where to find one; only a nickname ("where is drake") or "my" asks where yours is
    target, hits, live, pc = _asked(b, clause)
    if clause.status == 'clarify':
        return None
    if target is None:  # "what's in my pc": the boxes (the party is the team answer)
        boxed = [p for p in hits if not p['where'].lower().startswith('party')]
        if not pc:
            return UNREADABLE
        return (f'PC: {len(boxed)} Pokémon — ' + ', '.join(_named(p, b.vocab) for p in boxed[:12]) + (f' and {len(boxed) - 12} more' if len(boxed) > 12 else '') + '.'
                if boxed else 'The PC boxes are empty.')
    sid, name = target[0], b.vocab.name(target[0])
    shinies = b.ctx.get('shinies')
    shinies = [r for r in (shinies if shinies is not None else (b.ctx.session() or {}).get('collection')) or []
               if isinstance(r, dict) and r.get('game', 'firered') == 'firered' and (r.get('nationalSpeciesId') or (r.get('pokemon') or {}).get('species')) == sid]
    saved = f' The shiny collection {"also " if hits else ""}has {len(shinies)} saved shiny {name}.' if shinies else ''
    if not hits:
        return _none_owned(name, live, pc) + saved
    return ('Yes: ' + (_named(hits[0], b.vocab) if len(hits) == 1 else f'{len(hits)} {name} — ' + '; '.join(p['where'] for p in hits[:8])) + '.' + saved)


def _stats_answer(b, clause):
    target, hits, live, pc = _asked(b, clause)
    if clause.status == 'clarify':
        return None
    if target is None and re.search(r'\b(it|its|them|their)\b', clause.text) and any(c.steps for c in b.prior):
        return 'Its level, IVs and EVs are read from the save once the earlier step is done; ask again then.'  # "catch a timid abra and tell me its ivs"
    if target is None:
        _clarify(clause, 'species', 'Which Pokémon?', [])
        return None
    if not hits:
        return _none_owned(b.vocab.name(target[0]), live, pc)
    words = set(clause.tokens)
    want = [k for k, cues in (('level', {'level', 'levels', 'strong', 'high'}), ('ivs', {'iv', 'ivs', 'individual'}), ('evs', {'ev', 'evs', 'effort'})) if words & cues]
    want = ['level', 'ivs', 'evs'] if 'stats' in words else want or ['level']
    parts = []
    for p in hits[:4]:
        facts = []
        if 'level' in want:
            facts.append(f"Lv{p['level']}" if isinstance(p.get('level'), int) and p['level'] > 0 else
                         'level unknown in the PC' if not p['where'].lower().startswith('party') else 'level not visible')
        for k in ('ivs', 'evs'):
            if k in want:
                v = p.get(k) if isinstance(p.get(k), dict) else None
                facts.append(f'{k[:2].upper()}s ' + ' / '.join(f'{v.get(stat, "?")} {short}' for stat, short in STAT_SHORT)
                             + (f' ({sum(n for n in v.values() if isinstance(n, int))} total)' if k == 'evs' else '') if v else f'{k[:2].upper()}s not readable')
        parts.append(f'{_named(p, b.vocab)}: ' + '; '.join(facts))
    return '. '.join(parts) + '.'


def _missing_answer(b, clause):
    if re.search(r'\bshin(y|ies)\b', clause.text):
        return None  # the shiny collection is not the Pokédex (status-shinies answers its count)
    s = b.ctx.session() or {}
    postgame = s.get('postgame') if isinstance(s.get('postgame'), dict) else {}
    if re.search(r'\b(checklist|postgame|objectives?|tasks?|to do)\b', clause.text) and not re.search(r'\b(pokemon|pokedex|dex|species)\b', clause.text):
        entries = [e for e in postgame.get('entries') or [] if isinstance(e, dict)]
        if not entries:
            return 'The postgame checklist isn’t visible right now.' if b.ctx.running() else OFFLINE
        left = [str(e.get('label') or e.get('id')) for e in entries if e.get('status') != 'complete']
        return (f"{len(left)} postgame checklist entr{'y' if len(left) == 1 else 'ies'} still open: " + ', '.join(left[:10])
                + (f' and {len(left) - 10} more' if len(left) > 10 else '') + '.' if left else 'Every postgame checklist entry is complete.')
    progress = postgame.get('progress') if isinstance(postgame.get('progress'), dict) else {}
    dex = progress.get('dex') if isinstance(progress.get('dex'), dict) else {}
    if dex.get('known') and isinstance(dex.get('caught'), int):
        missing = [i for i in dex.get('missing') or [] if isinstance(i, int)]
        total = dex.get('total') or 386
        if not missing:
            return f"The National Pokédex is complete: {dex['caught']}/{total}."
        text = (f"Pokédex: {dex['caught']}/{total} caught, {len(missing)} missing: " + ', '.join(b.vocab.name(i) for i in missing[:10])
                + (f' and {len(missing) - 10} more' if len(missing) > 10 else '') + '.')
        kanto = dex.get('kanto') if isinstance(dex.get('kanto'), dict) else {}
        if isinstance(kanto.get('caught'), int) and not kanto.get('complete'):
            text += f" Kanto {kanto['caught']}/{kanto.get('total') or 150}."
        rows = [r for r in postgame.get('collection') or progress.get('species') or [] if isinstance(r, dict)]  # the agenda's per-species sources
        if rows:
            wanted = set(missing)
            text += f" {sum(1 for r in rows if r.get('status') == 'local' and r.get('speciesId') in wanted)} of them can be caught or evolved on this cartridge."
        return text
    if not b.ctx.running():
        return OFFLINE
    owned = (((s.get('spectator') or {}).get('trainer') or {}).get('pokedex') or {}).get('owned')
    if not isinstance(owned, int):
        return 'The Pokédex isn’t visible right now.'
    total = 386 if (s.get('gameProgress') or {}).get('nationalDex') else 151
    return f'Pokédex: {owned}/{total} caught, {total - owned} left. The list of missing species isn’t visible right now.'


def _item_of(clause, vocab):
    """(native item id, name) of the first item, ball or held-item name in the clause, or None."""
    for s in clause.spans:
        for kind in ('item', 'ball', 'held'):
            values = s.values(kind)
            if values:
                value, label = values[0]
                item_id = value if kind == 'item' else next((i for i, n in vocab.items.items() if key(n) == key(label)), None)
                return (item_id, label) if item_id is not None else None
    return None


def _bag_answer(b, clause):
    """Bag counts from the trainer's bag pockets ({pocket: [{itemId, quantity}]}, native item ids)."""
    item = _item_of(clause, b.vocab)
    if item:
        clause.slots['item'] = item[0]
    bag = b.ctx.get('bag')
    if not isinstance(bag, dict):
        return NO_BAG
    counts = {}
    for pocket in bag.values():
        for e in pocket if isinstance(pocket, list) else []:
            if isinstance(e, dict) and isinstance(e.get('itemId'), int) and e['itemId'] > 0 and isinstance(e.get('quantity'), int):
                counts[e['itemId']] = counts.get(e['itemId'], 0) + e['quantity']
    if item:
        n = counts.get(item[0], 0)
        return f'{n} × {item[1]} in the bag.' if n else f'No {item[1]} in the bag.'
    if not counts:
        return 'The bag is empty.'
    listed = [f"{b.vocab.items.get(i, f'item {i}')} ×{n}" for i, n in counts.items()]
    return 'Bag: ' + ', '.join(listed[:15]) + (f' and {len(listed) - 15} more' if len(listed) > 15 else '') + '.'


ANSWERS = {'status-stop': _stop_answer, 'status-owned': _owned_answer, 'status-stats': _stats_answer, 'status-missing': _missing_answer, 'status-bag': _bag_answer}


# ---------------------------------------------------------------------------
# Interpreter
# ---------------------------------------------------------------------------
SCOPE_NEW = [('on', 'a', 'new', 'save'), ('on', 'a', 'fresh', 'save'), ('in', 'a', 'new', 'game'), ('on', 'a', 'new', 'game'), ('from', 'a', 'new', 'save'),
             ('with', 'a', 'new', 'save'), ('on', 'a', 'new', 'file'), ('in', 'a', 'new', 'save'), ('using', 'a', 'new', 'save'), ('on', 'a', 'new', 'playthrough'),
             ('on', 'a', 'brand', 'new', 'save'), ('in', 'a', 'fresh', 'game'), ('on', 'new', 'save')]
SCOPE_CURRENT = [('on', 'my', 'current', 'save'), ('on', 'the', 'current', 'save'), ('on', 'this', 'save'), ('in', 'my', 'current', 'game'),
                 ('on', 'my', 'existing', 'save'), ('with', 'my', 'current', 'save'), ('using', 'my', 'current', 'save'), ('in', 'this', 'game'),
                 ('on', 'the', 'current', 'game'), ('in', 'the', 'current', 'game'), ('on', 'my', 'current', 'game')]
SINGLETONS = {'new-game', 'save-new', 'save-restore', 'settings', 'postgame', 'collection', 'ev-training'}
THEN_WAIT = re.compile(r'\b(then|and) (wait|wait for me|stop there|hand it back|give me control)\b')
THEN_CONTINUE = re.compile(r'\b(then|and) (keep working on|continue with|go back to) (your|my|the) (goals|checklist|postgame)\b')
# Questions and negations are not requests. Speech has no '?', so a question is told by how the clause starts;
# "can/could/would you …" stays a polite request.
LEAD = r'^(?:(?:please|just|and|but|so|ok|okay|hey|yo|bot|now|then|oh|no|nah|wait|actually|um|uh) )*'
NEGATION_HEAD = LEAD + (r'(?:(?:i|we|you|lets|youd|wed) )?(?:do not|does not|did not|should not|never|no need to|there is no need to|(?:had |would )?better not'
                        r'|(?:would )?rather not|not)(?: (?:want|need)(?: you)? to| bother| ever| even)?')
NEGATION = re.compile(NEGATION_HEAD + r' (\w+)')
NEGATION_ONLY = re.compile(NEGATION_HEAD + r'$')  # "Don't, uh, catch a Pikachu.": dictation's comma parts the negation from its verb
NEGATED_VERBS = (ACTION_START | {'want', 'need', 'use', 'abort', 'scrap', 'drop', 'end', 'call', 'kill', 'remove', 'delete'}) \
    - {'forget', 'what', 'where', 'how', 'who', 'which', 'is', 'are', 'any', 'did', 'please', 'can', 'could', 'would', 'lets', 'do', 'tell', 'show', 'list', 'shiny'}
PERSIST = re.compile(r'(?:stop|quit|give up|rest|pause|halt)(?: \w+){0,2} (?:until|till|unless|before)\b')  # "don't stop until you catch …" asks for the hunt
IDLE_QUESTION = re.compile(LEAD + r'(?:(?:is|are|was|were|am|does|did|has)\b(?! (?:you|u) able to\b| it (?:ok|okay|alright|fine) (?:to|if)\b)|(?:do|have) (?:i|we|you)\b|what (?:is|are)\b'
                                  r'|how (?:many|much|do|does|can)\b|where (?:is|are|can|do|does)\b|should (?:i|we)\b|why\b)')
NEGATED_REPLY = 'That asks the bot not to do something, so nothing was queued. To stop a goal that is already running, say “cancel that goal”.'
DECLINED_REPLY = 'Okay, nothing was queued.'
VERB_SUMMARY = re.compile(r'(Catch|Travel|Get|Heal|Save|Start|Resume|Stop|Close|Cancel|Work|Complete|Collect|Change|Trade|Back) ')
SAVE_BOUND_GIFTS = {133}  # the Celadon Eevee: like the one-time statics, the goal supervisor checks it against the save and can offer a new save


def _negated(tokens):
    """The negated verb when the clause asks the bot not to act ("don't catch a pikachu", "i don't want a pikachu"), else None
    ("never mind", "don't forget to", "don't stop until you catch …" ask for something)."""
    text = ' '.join(tokens)
    m = NEGATION.match(text)
    return m.group(1) if m and m.group(1) in NEGATED_VERBS and not PERSIST.match(text, m.start(1)) else None


OTHER_PLAYERS = re.compile(LEAD + r'(?:do|does|did|has|have|would|will|is|are|was|were) (?:anyone|anybody|people|someone|somebody|everyone|everybody|nobody|no one|folks|other people|other players)\b')


def _about_other_players(tokens):
    """"does anyone even use master balls on zubats": a question about other players, never a request or a status answer."""
    return bool(OTHER_PLAYERS.match(' '.join(tokens)))


def _idle_question(tokens):
    """"is there a shiny mewtwo", "do i have a kadabra": asks about the game rather than asking the bot to act."""
    return bool(IDLE_QUESTION.match(' '.join(tokens)))


def _to_do(summary):
    """"Catch Pikachu" -> "catch Pikachu", for "Do you want the bot to …?"."""
    return summary[0].lower() + summary[1:] if VERB_SUMMARY.match(summary) else f'do this: {summary}'
BUILD = {
    'catch': lambda b, c: b.catch(c), 'travel': lambda b, c: b.travel(c), 'item': lambda b, c: b.item(c), 'heal': lambda b, c: b.heal(c),
    'save-game': lambda b, c: b.save_game(c), 'ev-training': lambda b, c: b.ev_training(c),
    'bot-start': lambda b, c: b.control(c, 'ready', 'Start the bot and wait for a command'),
    'bot-resume': lambda b, c: b.control(c, 'resume', 'Resume the paused task'),
    'bot-stop': lambda b, c: b.control(c, 'stop', 'Stop the bot'),
    'game-stop': lambda b, c: b.control(c, 'stop-game', 'Close the game'),
    'goal-cancel': lambda b, c: b.goal_cancel(c), 'new-game': lambda b, c: b.new_game(c), 'save-new': lambda b, c: b.save_new(c),
    'save-restore': lambda b, c: b.save_restore(c), 'trade-shiny': lambda b, c: b.trade(c, True), 'trade-pokemon': lambda b, c: b.trade(c, False),
    'settings': lambda b, c: b.settings(c), 'postgame': lambda b, c: b.postgame(c), 'collection': lambda b, c: b.collection(c),
}
for _intent in CATALOG:
    if _intent.kind == 'status' or _intent.kind == 'help':
        BUILD[_intent.id] = lambda b, c: b.status(c)
    _intent.build = BUILD.get(_intent.id)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


class Interpreter:
    """Text -> {understood, confidence, summary, clarification?, confirmation, goal, ...}."""

    def __init__(self, vocabulary=None, classifier=None, preview=None, validate_task=None):
        self.vocab = vocabulary or Vocabulary.default()
        self.classifier = classifier
        self.preview = preview
        self.validate_task = validate_task

    def _laya_ready(self):
        c = self.classifier
        return c if c is not None and hasattr(c, 'available') and c.available() else None

    # -- pipeline -------------------------------------------------------------
    def _overlay(self, ctx):
        extra = []
        for p in ctx.party():
            nick = p.get('nickname')
            if nick:
                extra.append((key(nick), Hit('party', {'speciesId': p.get('speciesId'), 'nickname': nick}, nick)))
        roster = ctx.get('trainingPokemon')
        if isinstance(roster, dict):
            roster = roster.get('pokemon')
        for p in roster if isinstance(roster, list) else []:
            if isinstance(p, dict) and p.get('nickname'):
                extra.append((key(p['nickname']), Hit('party', {'speciesId': p.get('nationalSpeciesId'), 'fingerprint': p.get('fingerprint'), 'nickname': p['nickname']}, p['nickname'])))
        options = ctx.peek('taskOptions')  # the live list is 90 MB of world data; only reuse it when already loaded
        locations = options.get('locations') if isinstance(options, dict) else None
        return self.vocab.overlay(locations, extra)

    def _clause(self, index, tokens, overlay, question=False):
        clause = Clause(index, tokens, question=question)
        clause.spans = find_spans(tokens, self.vocab, overlay)
        clause.ranking = score_clause(clause, self.vocab)
        return clause

    def interpret(self, text, via='typed', context=None, answers=None):
        ctx = context if isinstance(context, Context) else Context(context)
        answers = {str(k): v for k, v in (answers or {}).items()} if isinstance(answers, dict) else {}
        text = str(text or '')
        classifier = self._laya_ready()
        laya = LayaSession(classifier) if classifier is not None else None
        parser = 'deterministic'
        base = {'understood': False, 'confidence': 0.0, 'parser': parser, 'summary': '', 'message': '', 'clarification': None,
                'confirmation': {'required': False, 'reasons': []}, 'goal': None, 'direct': [], 'answer': None, 'preview': [],
                'suggestions': [], 'unsupported': None, 'clauses': [], 'warnings': []}
        if not text.strip():
            return {**base, 'message': 'Say or type what the bot should do, for example “get me a shiny Mewtwo”.', 'suggestions': SUGGESTIONS[:3]}
        tokens = _tokens(text)
        vocab = self.vocab
        protected = _exact_cover(tokens, vocab)
        tokens = correct_commands(tokens, protected)
        case = case_map(text)
        question = text.rstrip().endswith('?')
        # Whole-request save scope ("... on a new save").
        mode = None
        for scope, value in [(s, 'new') for s in SCOPE_NEW] + [(s, 'current') for s in SCOPE_CURRENT]:
            for i in range(len(tokens) - len(scope) + 1):
                if tuple(tokens[i:i + len(scope)]) == scope:
                    tokens = tokens[:i] + tokens[i + len(scope):]
                    mode = value
                    break
        then_override = 'await-command' if THEN_WAIT.search(' '.join(tokens)) else 'standing-goals' if THEN_CONTINUE.search(' '.join(tokens)) else None
        if then_override:
            joined = THEN_CONTINUE.sub('', THEN_WAIT.sub('', ' '.join(tokens)))
            tokens = joined.split()
        overlay = self._overlay(ctx)
        parts = [p.split() for p in split_clauses(tokens, self.vocab, overlay)]
        # Scope-only, subordinate and bare negation fragments ("Don't, uh, catch a Pikachu.") belong to the clause after them.
        forward, pending = [], []
        for part in parts:
            if _attaches_forward(part) or NEGATION_ONLY.match(' '.join(pending + part)) or NEGATION_ONLY.match(' '.join(part)):
                pending += part
                continue
            forward.append(pending + part)
            pending = []
        if pending and forward and NEGATION_ONLY.match(' '.join(pending)):  # "Catch a Pikachu. No, don't.": taken back
            return {**base, 'unsupported': 'negated', 'message': NEGATED_REPLY, 'suggestions': [BY_ID['goal-cancel'].examples[0], BY_ID['bot-stop'].examples[0]]}
        if pending:
            forward.append(pending)
        parts = forward
        clauses = [self._clause(i, p, overlay, question) for i, p in enumerate(parts)]
        # Fragments with no action of their own belong to a neighbour ("new game, trainer name MISTY, starter bulbasaur").
        # Punctuation-delimited chatter with nothing to act on ("my little brother keeps asking, lol") is dropped.
        if len(clauses) > 1:
            kept = [c for c in clauses if c.anchored or c.spans or _slot_words(c.tokens)]
            clauses = kept or clauses
        merged = []
        for c in clauses:
            if not c.anchored and merged and len(clauses) > 1:
                prev = merged.pop()
                merged.append(self._clause(prev.index, prev.tokens + c.tokens, overlay, question))
            else:
                merged.append(c)
        if len(merged) > 1 and not merged[0].anchored:
            first = merged.pop(0)
            nxt = merged.pop(0)
            merged.insert(0, self._clause(0, first.tokens + nxt.tokens, overlay, question))
        clauses = [self._clause(i, c.tokens, overlay, question) if c.index != i else c for i, c in enumerate(merged)]
        for k, c in enumerate(clauses):
            self._decide(c, laya, ctx, answers, case, text, [x for x in clauses[:k] if x.status == 'accepted'])
        clauses = self._fold(clauses, overlay, laya, ctx, answers, case, text)
        if laya is not None and laya.used:
            parser = base['parser'] = 'laya'
        result = self._assemble(text, via, ctx, answers, clauses, mode, then_override, parser, base)
        if laya is not None:
            result['laya'] = laya.report()
        return result

    def _decide(self, clause, laya, ctx, answers, case, original='', prior=()):
        ranking = clause.ranking
        top_id, top, info = ranking[0]
        viable = [(i, s) for i, s, _ in ranking if s >= CLARIFY]
        negated = _negated(clause.tokens)
        if _about_other_players(clause.tokens) and answers.get(f'{clause.index}:intent') not in BY_ID:
            clause.status = 'rejected'  # "does anyone even use master balls on zubats": chatter, and Laya is not asked
            return
        # Decided by the code layer alone, Laya is not asked: a negation, or a clause it reads as an answer Laya was never trained on.
        alone = negated is not None or (top_id not in LAYA_OPTIONS and top >= CLARIFY)
        decided = pick = None
        if laya is not None and laya.primary and not alone:
            # Laya primary: a confident Laya decides the intent; otherwise the code layer does.
            decided, pick = laya.primary_intent(clause, top_id, top)
        if decided is not None:
            top_id, top = decided
        elif laya is not None and not alone and (viable or laya.calibration is None):
            # Calibrated combination (LayaCalibration); failures keep the deterministic pair.
            # Shadow mode consults every clause (offline evaluation data) and changes nothing.
            top_id, top, _ = laya.combine_intent(clause, viable, top_id, top, pick)
        clause.intent = top_id
        clause.score = top
        intent = BY_ID[top_id]
        details = next(d for i, s, d in ranking if i == top_id)
        answer_intent = answers.get(f'{clause.index}:intent')
        if answer_intent in BY_ID:
            clause.intent, intent, top = answer_intent, BY_ID[answer_intent], max(top, ACCEPT)
        elif answer_intent == 'none':
            clause.status = 'rejected'
            return
        clause.laya = decided is not None and answer_intent is None
        if negated is not None and intent.kind not in ('status', 'help'):
            clause.status = 'unsupported'  # "don't catch a pikachu", "don't cancel my goal": nothing to run, and said so
            clause.slots['unsupported'] = 'negated'
            clause.message = NEGATED_REPLY
            return
        requirement = details['requirement'] == 1.0
        missing_only = not requirement and details['coverage'] == 1.0 and details['anchor'] >= 0.6
        if top < CLARIFY and not missing_only:
            clause.status = 'rejected'
            return
        if top < ACCEPT and not missing_only:
            second = [(i, s) for i, s, _ in ranking[:3] if s >= CLARIFY and BY_ID[i].kind != 'unsupported']
            if len(second) >= 1 and answer_intent is None:
                clause.status = 'clarify'
                clause.clarify = {'id': f'{clause.index}:intent', 'slot': 'intent', 'clause': clause.index,
                                  'question': f'I’m not sure what “{clause.text}” means. Did you mean one of these?',
                                  'choices': [{'id': i, 'label': BY_ID[i].description} for i, _ in second] + [{'id': 'none', 'label': 'Something else'}], 'freeText': False}
                return
            clause.status = 'rejected'
            return
        if intent.kind == 'unsupported':
            clause.status = 'unsupported'
            clause.slots['unsupported'] = intent.id
            clause.message = intent.message
            return
        clause.status = 'accepted'
        try:
            intent.build(Builder(self, ctx, answers, case, original, prior, laya), clause)
        except ValueError as error:
            clause.status = 'invalid'
            clause.message = str(error)
        if clause.status == 'accepted' and not (clause.steps or clause.direct or clause.answer):
            clause.status = 'rejected'
        clause.certainty = min(clause.certainty, 1.0)
        if clause.status != 'accepted' or not (clause.steps or clause.direct):
            return
        if intent.kind not in ('status', 'help') and _idle_question(clause.tokens):
            asked = answers.get(f'{clause.index}:question')
            if asked == 'no':
                clause.status = 'unsupported'
                clause.slots['unsupported'] = 'declined'
                clause.message = DECLINED_REPLY
            elif asked != f'yes:{clause.intent}':  # "is there a shiny mewtwo": ask; a yes to this action is the confirmation
                _clarify(clause, 'question', f'Do you want the bot to {_to_do(clause.summary)}?',
                         [{'id': f'yes:{clause.intent}', 'label': 'Yes: ' + clause.summary}, {'id': 'no', 'label': 'No, nothing to do'}], free=False)
            return
        if clause.laya:
            # Only Laya reads it as this action (a rescue, or an override the code layer's builder may have refused: "get me a garchomp").
            clause.confirm.append(f'I read “{clause.text}” as “{clause.summary}”. Confirm?')

    def _fold(self, clauses, overlay, laya, ctx, answers, case, original=''):
        """Ellipsis and pronoun follow-ups: "we need more potions, grab 10"; "catch a bulbasaur and train it to level 50"."""
        out = []
        for k, c in enumerate(clauses):
            prev = out[-1] if out else None
            later = clauses[k + 1] if k + 1 < len(clauses) else None
            if re.fullmatch(r'((can|could) (you|u) )?((back ?up|backup)( (this|my|the))?( current)?( (save|game)( file)?)?|back (this|it|that) up)( first)?', c.text) and later is not None \
                    and later.intent in ('save-new', 'new-game', 'save-restore') and later.status in ('accepted', 'clarify'):
                c.status = 'merged'  # the new save / restore backs the current game up anyway
                continue
            if prev and prev.status == c.status == 'accepted' and prev.intent == c.intent and prev.steps == c.steps and prev.direct == c.direct:
                prev.confirm += [r for r in c.confirm if r not in prev.confirm]  # Laya's reading of the dropped repeat is still confirmed
                c.status = 'merged'
                continue
            if prev and prev.intent == c.intent and c.intent in SINGLETONS and prev.status in ('accepted', 'clarify') and c.status in ('accepted', 'clarify'):
                combined = self._clause(prev.index, prev.tokens + list(c.tokens), overlay)
                self._decide(combined, laya, ctx, answers, case, original, [x for x in out[:-1] if x.status == 'accepted'])
                if combined.status in ('accepted', 'clarify'):
                    if (prev.laya or c.laya) and not combined.laya and (combined.steps or combined.direct):  # joined only because Laya read a part
                        combined.confirm.append(f'I read “{combined.text}” as “{combined.summary}”. Confirm?')
                    out[-1] = combined
                    continue
            if prev and prev.status == 'accepted' and prev.intent == 'catch' and c.intent in ('level-up', 'catch') \
                    and re.search(r'\b(it|them)\b', c.text) and re.search(r'\blevel (\d+)\b', c.text) and not any(s.values('species') for s in c.spans):
                level = int(re.search(r'\blevel (\d+)\b', c.text).group(1))
                prev.slots['finalLevel'] = level
                for step in prev.steps:
                    if step['kind'] == 'farming':
                        step['request']['finalLevel'] = level
                prev.summary += f', raised to level {level}'
                if c.intent != c.ranking[0][0] and f'{c.index}:intent' not in answers:  # only Laya reads it as a level: the owner confirms
                    prev.confirm.append(f'I read “{c.text}” as “raised to level {level}”. Confirm?')
                c.status = 'merged'
                continue
            if prev and prev.status == 'accepted' and c.status in ('clarify', 'rejected') and c.intent in ('item', 'catch') \
                    and prev.intent == c.intent and not any(s.kinds() & {'item', 'ball', 'held', 'species'} for s in c.spans) \
                    and any(t.isdigit() for t in c.tokens):
                combined = self._clause(prev.index, prev.tokens + list(c.tokens), overlay)
                self._decide(combined, laya, ctx, answers, case, original, [x for x in out[:-1] if x.status == 'accepted'])
                if combined.status == 'accepted':
                    if (prev.laya or c.laya) and not combined.laya:
                        combined.confirm.append(f'I read “{combined.text}” as “{combined.summary}”. Confirm?')
                    out[-1] = combined
                    continue
            out.append(c)
        return out

    def _assemble(self, text, via, ctx, answers, clauses, mode, then_override, parser, base):
        result = dict(base)
        result['clauses'] = [{'index': c.index, 'text': c.text, 'intent': c.intent if c.status in ('accepted', 'clarify', 'invalid', 'unsupported') else None,
                              'score': c.score, 'status': c.status, 'slots': {k: v for k, v in c.slots.items() if k not in ('locationId', 'unsupported')}}
                             for c in clauses if c.status != 'merged']
        accepted = [c for c in clauses if c.status == 'accepted']
        pending = [c for c in clauses if c.status == 'clarify']
        unsupported = [c for c in clauses if c.status == 'unsupported']
        invalid = [c for c in clauses if c.status == 'invalid']
        rejected = [c for c in clauses if c.status == 'rejected']
        # The accepted clauses keep only their accepted entries in "clauses" for metrics/UIs.
        result['clauses'] = [r for r in result['clauses'] if r['status'] == 'accepted'] + [r for r in result['clauses'] if r['status'] != 'accepted']
        result['clauses'].sort(key=lambda r: r['index'])
        if invalid:
            c = invalid[0]
            return {**result, 'message': c.message, 'suggestions': self._nearest(c)}
        if unsupported and not accepted and not pending:
            c = unsupported[0]
            return {**result, 'unsupported': c.slots.get('unsupported'), 'message': c.message, 'suggestions': self._nearest(c)}
        if pending:
            c = pending[0]
            return {**result, 'clarification': c.clarify, 'summary': ' → '.join(x.summary for x in accepted if x.summary),
                    'message': c.clarify['question'], 'confidence': round(min([x.score for x in accepted] or [c.score]), 3)}
        dropped = unsupported + rejected
        notes = [n for c in accepted for n in c.partial]
        if (dropped or notes) and accepted and answers.get('partial') != 'continue':
            if answers.get('partial') == 'cancel':
                return {**result, 'message': 'Cancelled.'}
            if dropped:
                names = ', '.join(f'“{c.text}”' for c in dropped)
                reason = ' ' + dropped[0].message if dropped[0].message else ''
                question = f'I can’t do {names}.{reason}' + (' ' + ' '.join(notes) if notes else '') + ' Continue with the rest?'
            else:
                question = ' '.join(notes) + ' Continue without it?'
            return {**result, 'message': question, 'summary': ' → '.join(x.summary for x in accepted if x.summary),
                    'clarification': {'id': 'partial', 'slot': 'partial', 'clause': (dropped or accepted)[0].index, 'question': question, 'freeText': False,
                                      'choices': [{'id': 'continue', 'label': 'Continue: ' + ' → '.join(x.summary for x in accepted if x.summary)},
                                                  {'id': 'cancel', 'label': 'Cancel'}]}}
        if not accepted:
            nearest = self._nearest(clauses[0] if clauses else None)
            quoted = text.strip()
            if len(quoted) > 80:
                quoted = quoted[:77] + '…'
            return {**result, 'message': f'I can’t turn “{quoted}” into a bot action. Try one of these:', 'suggestions': nearest}
        steps = [s for c in accepted for s in c.steps]
        # "EV train it": the fingerprint of the Pokémon caught by an earlier farming step.
        farming_index = {}
        position = 0
        for c in accepted:
            for step in c.steps:
                if step['kind'] == 'farming':
                    farming_index.setdefault(c.index, position)
                position += 1
        for step in steps:
            ref = (step.get('task') or {}).get('fingerprint')
            if isinstance(ref, dict) and isinstance(ref.get('$ref'), tuple):
                step['task']['fingerprint'] = {'$ref': f"steps[{farming_index[ref['$ref'][1]]}].result.fingerprint"}
        direct = [d for c in accepted for d in c.direct]
        answers_text = [c.answer for c in accepted if c.answer]
        save = {'mode': mode or 'current-if-able', 'trainerName': None, 'starter': None, 'label': None}
        for c in accepted:
            if c.save:
                save.update({k: v for k, v in c.save.items() if v is not None or k == 'mode'})
        if mode == 'current' and save['mode'] == 'new':
            save['mode'] = 'new'
        confirm = [r for c in accepted for r in c.confirm]
        if len(accepted) > 1:  # "Catch a Pikachu. Cancel that.": commit applies the cancel to what already runs, before this goal starts
            confirm += [f'“{c.text}” cancels a goal that is already running or queued, not a step of this request.' for c in accepted if c.intent == 'goal-cancel']
        if save['mode'] == 'new' and not any('new save' in r.lower() for r in confirm):
            confirm.insert(0, 'Uses a new save from New Game when the goal starts (the current save is backed up first).')
        confidence = round(min(min(c.score, 1.0) * c.certainty for c in accepted), 3)
        if confidence < CONFIRM_BELOW and (steps or direct):
            confirm.append('I’m not completely sure I understood; please check the summary.')
        goal = None
        if steps:
            last = steps[-1]
            then = 'standing-goals' if last['kind'] in ('farming', 'postgame', 'collection', 'campaign') or (last['kind'] == 'player-task' and last.get('action') == 'resume') else 'await-command'
            goal = {'schema': GOAL_SCHEMA, 'id': str(uuid.uuid4()), 'createdAt': _now(), 'status': 'draft',
                    'source': {'text': text[:2000], 'via': via, 'interpreter': {'parser': parser, 'confidence': confidence}},
                    'game': 'firered', 'save': save, 'steps': steps, 'then': then_override or then,
                    'progress': {'step': 0, 'phase': None, 'detail': None, 'updatedAt': None}, 'idempotencyKey': None}
        previews = []
        stuck = []  # first limitation of each hunt no executor can start (as the goal supervisor's feasibility check sees it)
        for c in accepted:
            for request in c.request_for_preview:
                if not self.preview:
                    continue
                try:
                    plan = self.preview(copy.deepcopy(request))
                    previews.append({'clause': c.index, 'speciesId': request['speciesId'], 'canStart': plan.get('canStart'), 'state': plan.get('state'),
                                     'limitations': list(plan.get('limitations') or [])[:4], 'prerequisites': plan.get('prerequisites'),
                                     'pokemon': (plan.get('pokemon') or {}).get('name')})
                    # An evolution/trade route runs its first stage; a one-time encounter or the Eevee gift is the supervisor's call on the save.
                    if plan.get('canStart') is False and not plan.get('canStartSource') and request['speciesId'] not in _static_ids() | SAVE_BOUND_GIFTS:
                        stuck.append((plan.get('limitations') or ['No executable acquisition route is available.'])[0])
                except ValueError as error:
                    if 'Safari Ball' in str(error) and f'{c.index}:ball' not in answers:
                        name = self.vocab.name(request['speciesId'])
                        question = f'{name} is only found in the Safari Zone, where only Safari Balls work. Use Safari Balls?'
                        return {**result, 'message': question, 'clarification': {'id': f'{c.index}:ball', 'slot': 'ball', 'clause': c.index, 'question': question,
                                'freeText': False, 'choices': [{'id': 'safari-ball', 'label': 'Use Safari Balls'}, {'id': 'any', 'label': 'Any suitable ball'}]}}
                    return {**result, 'message': str(error), 'suggestions': self._nearest(c)}
                except Exception as error:
                    result['warnings'].append(f'Preview unavailable: {error}')
        summary_parts = []
        if save['mode'] == 'new' and not any(c.intent == 'new-game' for c in accepted):
            summary_parts.append('New save' + (f" as {save['trainerName']}" if save['trainerName'] else ''))
        summary_parts += [c.summary for c in accepted if c.summary and not c.answer]
        summary = ' → '.join(summary_parts)
        if save['mode'] == 'current' and steps:
            summary += ' (current save)'
        elif save['mode'] == 'current-if-able' and any(s['kind'] == 'farming' for s in steps):
            summary += ' (current save if it can reach it, else it asks)'
        if answers_text:
            summary = (summary + ' · ' if summary else '') + ' '.join(answers_text)
        if stuck and len(stuck) == sum(len(c.request_for_preview) for c in accepted):
            reply = f'Understood, but the bot can’t run this yet: {stuck[0]}'  # nothing to Run: every hunt in it would fail at once
            return {**result, 'understood': True, 'confidence': confidence, 'summary': summary, 'answer': ' '.join(answers_text + [reply]), 'preview': previews,
                    'message': reply}
        offers = [c.offer for c in accepted if c.offer]  # for a client that renders it (Ask does not yet); never part of the goal or of commit
        return {**result, 'understood': True, 'confidence': confidence, 'summary': summary, 'goal': goal, 'direct': direct,
                'answer': ' '.join(answers_text) if answers_text else None, 'preview': previews,
                'confirmation': {'required': bool(confirm), 'reasons': confirm}, 'message': '', **({'offer': offers[0]} if offers else {})}

    def _nearest(self, clause):
        if clause is None or not clause.ranking:
            return SUGGESTIONS[:3]
        if clause.slots.get('unsupported') in ('negated', 'declined'):
            return [BY_ID['goal-cancel'].examples[0], BY_ID['bot-stop'].examples[0]] if clause.slots['unsupported'] == 'negated' else []
        out = []
        for intent_id, score, details in clause.ranking:
            intent = BY_ID[intent_id]
            if intent.kind in ('unsupported',) or (details['anchor'] == 0 and details['template'] < 0.5):
                continue
            example = intent.examples[0]
            if example not in out:
                out.append(example)
            if len(out) == 3:
                break
        for example in SUGGESTIONS:
            if len(out) >= 3:
                break
            if example not in out:
                out.append(example)
        return out


# ---------------------------------------------------------------------------
# Corpus metrics (tests, NOTES and future Laya calibration)
# ---------------------------------------------------------------------------
def _slot_equal(name, expected, actual):
    if name == 'location':
        return isinstance(actual, str) and str(expected).lower() in actual.lower()
    return expected == actual


def corpus_metrics(rows, interpret):
    intent_total = intent_ok = slot_total = slot_ok = 0
    negatives = false_accepts = negative_clarified = unsupported_total = unsupported_ok = 0
    clarify_total = clarify_ok = 0
    failures = []
    fa = []
    for row in rows:
        expect = row['expect']
        result = interpret(row['text'])
        accepted = [c for c in result['clauses'] if c['status'] == 'accepted']
        if 'clarify' in expect:
            clarify_total += 1
            clar = result.get('clarification') or {}
            good = clar.get('slot') == expect['clarify'] and not result['understood']
            if good and expect.get('choices'):
                good = {str(x) for x in expect['choices']} <= {str(c['id']) for c in clar.get('choices', [])}
            clarify_ok += good
            if not good:
                failures.append({'id': row['id'], 'text': row['text'], 'expected': expect, 'got': {'understood': result['understood'], 'clarification': clar.get('slot'), 'intents': [c['intent'] for c in accepted]}})
            continue
        if expect.get('understood') is False:
            negatives += 1
            accepted_it = bool(result['understood'])
            false_accepts += accepted_it
            negative_clarified += bool(result.get('clarification')) and not accepted_it
            if accepted_it:
                fa.append({'id': row['id'], 'text': row['text'], 'intents': [c['intent'] for c in accepted]})
            if expect.get('unsupported'):
                unsupported_total += 1
                unsupported_ok += result.get('unsupported') == expect['unsupported']
            continue
        intent_total += 1
        intents = [c['intent'] for c in accepted]
        good_intent = bool(result['understood']) and intents == expect['intents']
        intent_ok += good_intent
        if not good_intent:
            failures.append({'id': row['id'], 'text': row['text'], 'expected': expect['intents'], 'got': intents, 'message': result.get('message'),
                             'clarification': (result.get('clarification') or {}).get('slot')})
            continue
        checks = []
        for exp, got in zip(expect.get('slots', []), accepted):
            for name, value in exp.items():
                checks.append((name, _slot_equal(name, value, got['slots'].get(name)), got['slots'].get(name), value))
        goal = result.get('goal') or {}
        for name, value in (expect.get('save') or {}).items():
            checks.append(('save.' + name, (goal.get('save') or {}).get(name) == value, (goal.get('save') or {}).get(name), value))
        if 'steps' in expect:
            got_steps = [s['kind'] for s in goal.get('steps', [])]
            checks.append(('steps', got_steps == expect['steps'], got_steps, expect['steps']))
        if 'confirm' in expect:
            checks.append(('confirm', result['confirmation']['required'] == expect['confirm'], result['confirmation']['required'], expect['confirm']))
        for name, good, got, value in checks:
            slot_total += 1
            slot_ok += good
            if not good:
                failures.append({'id': row['id'], 'text': row['text'], 'slot': name, 'expected': value, 'got': got})
    return {'rows': len(rows), 'positives': intent_total, 'intent_accuracy': round(intent_ok / max(1, intent_total), 4),
            'slot_checks': slot_total, 'slot_accuracy': round(slot_ok / max(1, slot_total), 4),
            'negatives': negatives, 'false_accept_rate': round(false_accepts / max(1, negatives), 4),
            'negative_clarified_rate': round(negative_clarified / max(1, negatives), 4),
            'unsupported_accuracy': round(unsupported_ok / max(1, unsupported_total), 4), 'unsupported_rows': unsupported_total,
            'clarify_rows': clarify_total, 'clarify_accuracy': round(clarify_ok / max(1, clarify_total), 4),
            'failures': failures, 'false_accepts': fa}


# ---------------------------------------------------------------------------
# Drafts, commit and the HTTP-facing service
# ---------------------------------------------------------------------------
class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class DraftStore:
    """In-memory drafts with expiry (a draft is only a proposal)."""
    def __init__(self, ttl=15 * 60, limit=256, clock=time.monotonic):
        self.ttl, self.limit, self.clock = ttl, limit, clock
        self.items = {}
        self.lock = threading.Lock()
        self.on_expire = None  # callback(draftId, 'ttl' | 'evicted'), called outside the lock (the request log's outcomes)

    def put(self, value):
        with self.lock:
            now = self.clock()
            gone = self._expire(now)
            while len(self.items) >= self.limit:
                oldest = next(iter(self.items))
                self.items.pop(oldest)
                gone.append((oldest, 'evicted'))
            draft_id = uuid.uuid4().hex
            self.items[draft_id] = (now, value)
        self._gone(gone)
        return draft_id

    def get(self, draft_id):
        with self.lock:
            gone = self._expire(self.clock())
            item = self.items.get(draft_id) if isinstance(draft_id, str) else None
            value = copy.deepcopy(item[1]) if item else None
        self._gone(gone)
        return value

    def pop(self, draft_id):
        """Drop a draft (the owner cancelled it); True when it was still there."""
        with self.lock:
            gone = self._expire(self.clock())
            found = isinstance(draft_id, str) and self.items.pop(draft_id, None) is not None
        self._gone(gone)
        return found

    def _expire(self, now):
        gone = [k for k, (t, _) in self.items.items() if now - t > self.ttl]
        for k in gone:
            self.items.pop(k, None)
        return [(k, 'ttl') for k in gone]

    def _gone(self, gone):
        if self.on_expire is None:
            return
        for draft_id, reason in gone:
            try:
                self.on_expire(draft_id, reason)
            except Exception:  # logging an outcome never fails a request
                pass


OPTIONS_TTL = 600
STEP_KINDS = {'farming', 'postgame', 'player-task', 'collection', 'trade', 'campaign', 'status'}
SUBMIT_FIELDS = ('schema', 'source', 'game', 'save', 'steps', 'then', 'idempotencyKey')


def submit_goal(server, goal):
    """Hand a Goal v1 to the G2 supervisor (in-process; the same object behind POST /api/pokemon-suite/goals)."""
    supervisor = getattr(server, 'goals', None)
    if supervisor is None or not callable(getattr(supervisor, 'submit', None)):
        raise RequestError(503, 'Cannot run this request: goal supervisor unavailable in this installation.')
    try:
        return supervisor.submit({k: copy.deepcopy(goal[k]) for k in SUBMIT_FIELDS if k in goal})
    except ValueError as error:
        raise RequestError(400, str(error)) from error
    except Exception as error:
        raise RequestError(500, f'The goal supervisor failed: {error}') from error


def cancel_goal(server, species=None):
    supervisor = getattr(server, 'goals', None)
    if supervisor is None or not callable(getattr(supervisor, 'cancel', None)):
        raise RequestError(503, 'Cannot cancel: goal supervisor unavailable in this installation.')
    goals = [g for g in (supervisor.goals() or {}).get('goals', []) if g.get('status') in ('queued', 'running', 'waiting')]
    if species:
        goals = [g for g in goals if any((s.get('request') or {}).get('speciesId') == species or (s.get('priorityTarget') or {}).get('speciesId') == species for s in g.get('steps', []))]
    if not goals:
        raise RequestError(409, 'There is no queued or running goal to cancel.')
    target = max(goals, key=lambda g: str(g.get('createdAt') or ''))
    try:
        return supervisor.cancel(target['id'])
    except ValueError as error:
        raise RequestError(400, str(error)) from error


def validate_goal_shape(goal):
    if not isinstance(goal, dict) or goal.get('schema') != GOAL_SCHEMA or not isinstance(goal.get('steps'), list) or not goal['steps'] \
            or any(not isinstance(s, dict) or s.get('kind') not in STEP_KINDS for s in goal['steps']) \
            or (goal.get('save') or {}).get('mode') not in ('current-if-able', 'current', 'new'):
        raise RequestError(400, 'Choose a Goal v1 document (schema pokemon-suite/goal/v1 with supported steps).')


def destructive_reasons(goal):
    reasons = []
    if (goal.get('save') or {}).get('mode') == 'new':
        reasons.append('Starts a new save (the current save is backed up first).')
    for s in goal.get('steps', []):
        if s.get('kind') == 'trade':
            reasons.append('Trades a Pokémon away.')
        if s.get('kind') == 'player-task' and s.get('action') in ('new-save', 'restore-save'):
            reasons.append('Switches the save (the current save is backed up first).')
    return reasons


def _merge(base, patch):
    out = copy.deepcopy(base)
    for k, v in patch.items():
        out[k] = {**out.get(k, {}), **v} if isinstance(v, dict) and isinstance(out.get(k), dict) and k == 'limits' else copy.deepcopy(v)
    return out


def load_config(directory):
    try:
        value = json.loads((Path(directory) / 'request-interpreter.json').read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _profiles(sessions, game='firered'):
    """Save backups exactly as player_task_options() lists them, without its world-data read."""
    result = []
    for path in sorted((Path(sessions.directory) / game / 'save-profiles').glob('*.json')):
        try:
            record = json.loads(path.read_text())
            result.append({k: record[k] for k in ('id', 'label', 'createdAt')})
        except (ValueError, KeyError, OSError):
            continue
    return sorted(result, key=lambda p: p['createdAt'], reverse=True)


def live_context(server, cache=None):
    """Lazily read the live sessions payload and related lists for one request.

    player_task_options() parses the full world data (tens of MB), so its
    locations/items are cached for OPTIONS_TTL seconds and loaded only when a
    clause needs them (travel, item).
    """
    sessions = getattr(server, 'pokemon_sessions', None)
    if sessions is None:
        return {}
    cache = cache if cache is not None else {}

    def snapshot():
        for s in sessions.snapshots():
            if isinstance(s, dict) and s.get('game') == 'firered':
                return s
        return None

    def options():
        hit = cache.get('taskOptions')
        if hit and time.monotonic() - hit[0] < OPTIONS_TTL:
            return hit[1]
        value = sessions.player_task_options('firered')
        cache['taskOptions'] = (time.monotonic(), value)
        return value

    def training():
        from .pokemon_player_tasks import effort_inventory
        return effort_inventory(server.trading, 'firered')['pokemon']

    read = {}

    def pc():
        """The current save's PC read, once per request (party and boxes; its "bag" pockets once the reader returns them)."""
        if 'value' not in read:
            value = server.trading.inventory('firered')
            read['value'] = value if isinstance(value, dict) else {}
        return read['value']

    def inventory():
        return pc().get('pokemon')

    def bag():
        value = pc().get('bag')
        return value if isinstance(value, dict) else None

    def goals():
        supervisor = getattr(server, 'goals', None)
        return supervisor.goals()['goals'] if supervisor is not None else None

    fresh = cache.get('taskOptions')
    task_options = fresh[1] if fresh and time.monotonic() - fresh[0] < OPTIONS_TTL else Lazy(options)
    return {'session': Lazy(snapshot), 'shinies': Lazy(sessions.shinies), 'taskOptions': task_options,
            'profiles': Lazy(lambda: _profiles(sessions)),
            'botSettings': Lazy(lambda: sessions.bot_settings('firered')['preferences']),
            'trainingPokemon': Lazy(training), 'inventory': Lazy(inventory), 'bag': Lazy(bag),
            'requests': Lazy(lambda: server.pokemon_farming.list_requests()), 'goals': Lazy(goals)}


class RequestService:
    """interpret/commit/cancel/warm for the HTTP routes; drafts live in memory with expiry."""
    # A spoken request, and the first request after startup, wait this long for a Laya that is still
    # loading (about 1.3-1.7 s from cold) instead of falling back at once; typed requests never wait.
    laya_wait = 3.0
    # A new request from the same client this soon after one still awaiting the owner is logged as its rephrase.
    rephrase_within = 60

    def __init__(self, server, interpreter=None, context_provider=None, drafts=None, config=None):
        self.server = server
        directory = getattr(server, 'directory', None)
        self.config = config if config is not None else (load_config(directory) if directory else {})
        if interpreter is None:
            farming = getattr(server, 'pokemon_farming', None)
            sidecar_log = (Path(directory) / 'requests' / 'laya-sidecar.log') if directory else None
            if sidecar_log is not None and isinstance(self.config.get('laya'), dict) and self.config['laya'].get('mode') in ('shadow', 'on'):
                try:
                    sidecar_log.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                except OSError:
                    sidecar_log = None
            interpreter = Interpreter(classifier=LayaClassifier.from_config(self.config, log_path=sidecar_log),
                                      preview=(lambda request: farming.preview(request)) if farming is not None else None)
        self.interpreter = interpreter
        self.cache = {}
        self.context_provider = context_provider or (lambda: live_context(server, self.cache))
        self.drafts = drafts or DraftStore()
        self.committed = {}
        self.lock = threading.Lock()
        self._first = True
        self.log_path = (Path(directory) / 'requests' / 'requests.ndjson') if directory and self.config.get('log') is True else None
        # Outcome tracking for the opt-in log: draftId -> {at, client, open (awaiting the owner), text, answers, clarification, suggestions}.
        self.tracks, self.latest, self.log_lock = {}, {}, threading.Lock()
        if self.log_path:
            self.drafts.on_expire = self._expired
            supervisor = getattr(server, 'goals', None)
            if callable(getattr(supervisor, 'on_finish', None)):
                supervisor.on_finish(self._goal_finished)

    def warm(self, payload=None):
        """Start the Laya sidecar, if one is configured, without waiting for it (host startup, Ask opened, mic tapped)."""
        if payload:
            raise RequestError(400, 'Warm-up takes no parameters.')
        warm = getattr(getattr(self.interpreter, 'classifier', None), 'warm', None)
        return {'laya': warm() if callable(warm) else 'off'}

    def _wait_for_laya(self, via):
        """ms spent waiting for a loading Laya (None when this request does not wait)."""
        with self.lock:
            first, self._first = self._first, False
        classifier = getattr(self.interpreter, 'classifier', None)
        if via != 'voice' and not first or classifier is None or not callable(getattr(classifier, 'wait_ready', None)) \
                or classifier.active_calibration() is None:  # shadow-only Laya cannot change the decision: not worth a wait
            return None
        started = time.monotonic()
        classifier.wait_ready(self.laya_wait)
        return round((time.monotonic() - started) * 1000)

    def interpret(self, payload, client=''):
        """client: who asked (the route passes the User-Agent, else Origin); logged only as a short hash, to tell rephrases apart."""
        if not isinstance(payload, dict) or set(payload) - {'text', 'via', 'answers'} or not isinstance(payload.get('text'), str):
            raise RequestError(400, 'Send the request text (and optionally via and answers).')
        via = payload.get('via', 'typed')
        if via not in VIA:
            raise RequestError(400, 'Choose via: typed, voice or ui.')
        if len(payload['text']) > MAX_TEXT:
            raise RequestError(400, f'The request is too long; keep it under {MAX_TEXT} characters.')
        answers = payload.get('answers') or {}
        if not isinstance(answers, dict) or any(not isinstance(k, str) or not isinstance(v, (str, int)) for k, v in answers.items()):
            raise RequestError(400, 'Answers map a clarification id to a choice.')
        answers = {k: str(v) for k, v in answers.items()}
        waited = self._wait_for_laya(via)
        result = self.interpreter.interpret(payload['text'], via=via, context=self.context_provider(), answers=answers)
        if waited is not None and isinstance(result.get('laya'), dict):
            result['laya']['waitMs'] = waited
        draft_id = self.drafts.put({'text': payload['text'], 'via': via, 'answers': answers, 'result': result})
        if self.log_path:
            key = hashlib.sha256(client.encode()).hexdigest()[:8] if isinstance(client, str) and client else ''
            self._log(payload['text'], via, result, draftId=draft_id, **({'client': key} if key else {}), **({'answers': answers} if answers else {}))
            self._follow(key, draft_id, payload['text'], answers, result)
        return {**result, 'draftId': draft_id}

    def commit(self, payload):
        if not isinstance(payload, dict) or set(payload) - {'draftId', 'goal', 'answers', 'idempotencyKey'} or ('draftId' in payload) == ('goal' in payload):
            raise RequestError(400, 'Commit a draftId or a goal, with an idempotencyKey.')
        key_value = payload.get('idempotencyKey')
        if not isinstance(key_value, str) or not KEY.fullmatch(key_value):
            raise RequestError(400, 'A valid idempotencyKey is required (8-100 letters, digits, - or _).')
        answers = payload.get('answers') or {}
        if not isinstance(answers, dict):
            raise RequestError(400, 'Answers map a clarification id to a choice.')
        answers = {str(k): str(v) for k, v in answers.items()}
        fingerprint = payload.get('draftId') or hashlib.sha256(json.dumps(payload.get('goal'), sort_keys=True, default=str).encode()).hexdigest()
        with self.lock:
            prior = self.committed.get(key_value)
            if prior:
                if prior[0] != fingerprint:
                    raise RequestError(409, 'This idempotencyKey was already used for a different request.')
                return copy.deepcopy(prior[1])
        confirmed = answers.pop('confirm', '').lower() in ('yes', 'true', 'confirm', 'confirmed', 'ok')
        draft_id, draft, extra = payload.get('draftId'), None, {}
        try:
            if 'draftId' in payload:
                draft = self.drafts.get(draft_id)
                if draft is None:
                    raise RequestError(404, 'This draft expired or was not found. Interpret the request again.')
                result = draft['result']
                extra = {k: v for k, v in answers.items()}
                if extra:
                    merged = {**draft['answers'], **extra}
                    result = self.interpreter.interpret(draft['text'], via=draft['via'], context=self.context_provider(), answers=merged)
                if not result['understood'] or result.get('clarification'):
                    raise RequestError(409, 'The request is not understood yet: ' + (result.get('message') or 'answer the clarification first.'))
                goal = result.get('goal')
                direct = result.get('direct') or []
                reasons = result['confirmation']['reasons'] if result['confirmation']['required'] else []
            else:
                goal = copy.deepcopy(payload['goal'])
                validate_goal_shape(goal)
                direct = []
                reasons = destructive_reasons(goal)
            if reasons and not confirmed:
                raise RequestError(409, 'Please confirm first: ' + ' '.join(reasons) + ' Send answers.confirm = "yes".')
            if not goal and not direct:
                raise RequestError(400, 'Nothing to run: this request only asked a question.')
            out = {'applied': []}
            for action in direct:
                if action['kind'] == 'settings':
                    out['applied'].append({'kind': 'settings', 'preferences': self._apply_settings(action['preferences'])})
                elif action['kind'] == 'cancel-goal':
                    out['applied'].append({'kind': 'cancel-goal', 'goal': cancel_goal(self.server, action.get('speciesId'))})
            if goal:
                goal = copy.deepcopy(goal)
                goal['idempotencyKey'] = key_value
                if draft is not None:  # the supervisor keeps it, so the goal's final status joins this request's log row
                    goal['source'] = {**(goal.get('source') or {}), 'draftId': draft_id}
                out['goal'] = submit_goal(self.server, goal)
        except RequestError as error:
            if draft is not None:
                self._outcome(draft_id, 'commit-refused', keep_open=True, status=error.status, error=str(error)[:200])
            raise
        if draft is not None:
            if extra and draft['result'].get('clarification'):
                self._clarified(draft_id, draft['result']['clarification'], draft['answers'], extra)
            self._outcome(draft_id, 'committed', **({'goalId': out['goal'].get('id')} if out.get('goal') else {}),
                          applied=[a['kind'] for a in out['applied']], intents=[c['intent'] for c in result['clauses'] if c['status'] == 'accepted'],
                          confirmed=confirmed, **({'answers': extra} if extra else {}))
        with self.lock:
            self.committed[key_value] = (fingerprint, copy.deepcopy(out))
            if len(self.committed) > 512:
                self.committed.pop(next(iter(self.committed)))
        return out

    def cancel(self, payload):
        """The owner's Cancel on a proposed request: the draft can no longer be committed, and the "no" is a logged outcome."""
        if not isinstance(payload, dict) or set(payload) != {'draftId'} or not isinstance(payload['draftId'], str):
            raise RequestError(400, 'Cancel a draftId.')
        draft_id = payload['draftId']
        with self.lock:
            if any(fingerprint == draft_id for fingerprint, _ in self.committed.values()):
                return {'cancelled': False}
        if not self.drafts.pop(draft_id):
            return {'cancelled': False}
        self._outcome(draft_id, 'cancelled')
        with self.lock:
            self.tracks.pop(draft_id, None)
        return {'cancelled': True}

    def close(self):
        """Stop the Laya sidecar, if one was started; drafts still awaiting the owner are logged as expired."""
        if self.log_path:
            now = self.drafts.clock()
            with self.lock:
                pending = [(k, t) for k, t in self.tracks.items() if t['open']]
                for _, track in pending:
                    track['open'] = False
            for draft_id, track in pending:
                self._event('expired', draft_id, track, now, reason='ttl' if now - track['at'] > self.drafts.ttl else 'shutdown')
        classifier = getattr(self.interpreter, 'classifier', None)
        if classifier is not None and callable(getattr(classifier, 'close', None)):
            classifier.close()

    def _apply_settings(self, patch):
        sessions = getattr(self.server, 'pokemon_sessions', None)
        if sessions is None:
            raise RequestError(503, 'Bot settings are unavailable in this installation.')
        current = sessions.bot_settings('firered')['preferences']
        try:
            return sessions.save_bot_settings('firered', _merge(current, patch))['preferences']
        except ValueError as error:
            raise RequestError(400, str(error)) from error

    def _log(self, text, via, result, **extra):
        """Opt-in (config "log": true) request log to grow the phrasing corpus: one row per interpret (no "event"), then
        event rows for its draft's outcome (committed, commit-refused, cancelled, clarified, rephrased, superseded, expired, goal)."""
        entry = {'at': _now(), 'text': text, 'via': via, 'understood': result['understood'], 'parser': result['parser'], 'confidence': result['confidence'],
                 'intents': [c['intent'] for c in result['clauses'] if c['status'] == 'accepted'], 'clarify': (result.get('clarification') or {}).get('slot'),
                 'unsupported': result.get('unsupported')}
        if result.get('laya'):
            entry['laya'] = result['laya']
        self._append({**entry, **extra})

    def _append(self, entry):
        if not self.log_path:
            return
        try:
            with self.log_lock:
                self.log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if self.log_path.exists() and self.log_path.stat().st_size > 5 * 1024 * 1024:
                    self.log_path.replace(self.log_path.with_suffix('.ndjson.1'))
                with self.log_path.open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(entry, ensure_ascii=False) + '\n')
        except OSError:
            pass

    def _event(self, event, draft_id, track=None, now=None, **fields):
        """One outcome row; never the transcript (the interpret row with the same draftId has it)."""
        entry = {'at': _now(), 'event': event, 'draftId': draft_id}
        if track is not None:
            entry['afterSeconds'] = round(max(0.0, (self.drafts.clock() if now is None else now) - track['at']), 1)
        self._append({**entry, **fields})

    def _outcome(self, draft_id, event, keep_open=False, **fields):
        """A draft's outcome; unless keep_open, the draft no longer awaits the owner (no rephrase or expiry follows)."""
        if not self.log_path:
            return
        now = self.drafts.clock()
        with self.lock:
            track = self.tracks.get(draft_id)
            if track is not None and not keep_open:
                track['open'] = False
        self._event(event, draft_id, track, now, **fields)

    def _follow(self, client, draft_id, text, answers, result):
        """Track a new draft; the same client's previous draft, if it still awaited the owner, was clarified, rephrased or superseded."""
        now = self.drafts.clock()
        waits = bool(result.get('clarification') or result.get('goal') or result.get('direct')) or not result['understood'] and answers.get('partial') != 'cancel'
        with self.lock:
            prior_id = self.latest.get(client)
            prior = self.tracks.get(prior_id)
            prior = prior if prior is not None and prior['open'] else None
            self.latest[client] = draft_id
            self.tracks[draft_id] = {'at': now, 'client': client, 'open': waits, 'text': text, 'answers': answers,
                                     'clarification': result.get('clarification'), 'suggestions': result.get('suggestions') or []}
            while len(self.tracks) > 2 * self.drafts.limit:
                self.tracks.pop(next(iter(self.tracks)))
        if prior is None:
            return
        if text == prior['text'] and answers != prior['answers'] and prior['clarification']:
            return self._clarified(prior_id, prior['clarification'], prior['answers'], answers, next=draft_id)
        same = ' '.join(text.lower().split()) == ' '.join(prior['text'].lower().split())
        self._outcome(prior_id, 'rephrased' if not same and now - prior['at'] <= self.rephrase_within else 'superseded', next=draft_id,
                      **({'suggestion': True} if text in prior['suggestions'] else {}))

    def _clarified(self, draft_id, question, before, answers, **extra):
        """Which clarification choice the owner picked (by chip, typed answer or with the commit)."""
        changed = {k: v for k, v in answers.items() if before.get(k) != v}
        choice = changed.get(question.get('id'))
        label = next((c['label'] for c in question.get('choices') or [] if str(c['id']) == choice), None)
        self._outcome(draft_id, 'clarified', **extra, slot=question.get('slot'), choice=choice, **({'label': label} if label else {}),
                      **({'answers': changed} if set(changed) != {question.get('id')} else {}))

    def _expired(self, draft_id, reason):
        with self.lock:
            track = self.tracks.pop(draft_id, None)
        if track is not None and track['open']:
            self._event('expired', draft_id, track, reason=reason)

    def _goal_finished(self, goal):
        """The supervisor finished a goal: a request goal's final status joins its draft's rows."""
        draft_id = (goal.get('source') or {}).get('draftId')
        if draft_id:
            summary = str((goal.get('result') or {}).get('summary') or '')[:200]
            self._event('goal', draft_id, goalId=goal.get('id'), status=goal.get('status'), **({'summary': summary} if summary else {}))


_SERVICE_LOCK = threading.Lock()


def prewarm(server):
    """Host startup (off the startup thread): create the request service and start its Laya sidecar. Never raises."""
    try:
        return service(server).warm()
    except Exception:  # a failed warm-up only means the first request starts Laya itself
        return None


def service(server):
    """The per-server RequestService (created at host startup by prewarm, else on first use)."""
    existing = getattr(server, 'pokemon_requests', None)
    if existing is not None:
        return existing
    with _SERVICE_LOCK:
        existing = getattr(server, 'pokemon_requests', None)
        if existing is None:
            existing = RequestService(server)
            setattr(server, 'pokemon_requests', existing)
        return existing
