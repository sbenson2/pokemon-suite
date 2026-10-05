"""Extract Six Island Ruin Valley's object events from pokefirered.

Writes engine/firered/test-support/ruin-valley-map.json, the fixture the Ruin
Valley Sun Stone route test checks its boulder and item-ball positions
against. Run it on the pinned pokefirered source:

    python3 scripts/extract-ruin-valley-map.py <pokefirered-source-root> [<revision>]
"""
import json, pathlib, sys

root = pathlib.Path(sys.argv[1])
revision = sys.argv[2] if len(sys.argv) > 2 else 'c75f352304d529f6ba92d4f74b9cf8b5c3810788'
source = 'data/maps/SixIsland_RuinValley/map.json'
data = json.loads((root/source).read_text())
out = {'source': {'repository': 'pret/pokefirered', 'revision': revision, 'file': source}, 'id': data['id'],
       'object_events': [{k: o.get(k) for k in ('graphics_id', 'x', 'y', 'elevation', 'script', 'flag')} for o in data['object_events']]}
target = pathlib.Path(__file__).resolve().parents[1]/'engine/firered/test-support/ruin-valley-map.json'
target.write_text(json.dumps(out, indent=1) + '\n')
print(f'wrote {target} ({len(out["object_events"])} object events)')
