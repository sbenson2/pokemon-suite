"""Build signed engine or data packages from the reviewed, sanitized source tree."""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from pokemon_suite.package_builder import build_package
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['keygen','engine','planner','data'])
    parser.add_argument('--key',type=Path,required=True)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--version',default='0.1.0')
    parser.add_argument('--verification',type=Path)
    args=parser.parse_args();keypath=args.key.resolve()
    if keypath.is_relative_to(ROOT) and not keypath.is_relative_to(ROOT/'.private'):raise ValueError('Keep private release keys outside the source tree or in .private.')
    if args.action=='keygen':
        key=Ed25519PrivateKey.generate();keypath.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        fd=os.open(keypath,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as f:f.write(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        public=base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)).decode()
        keypath.with_suffix('.pub').write_text(public+'\n');print(json.dumps({'publicKeyPath':str(keypath.with_suffix('.pub'))}));return
    if args.output is None:raise ValueError('Choose an output package path.')
    key=serialization.load_pem_private_key(keypath.read_bytes(),password=None)
    if not isinstance(key,Ed25519PrivateKey):raise ValueError('Choose an Ed25519 release key.')
    spec=importlib.util.spec_from_file_location('reviewed_export',ROOT/'scripts/package-source.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    reviewed=module.reviewed_files(ROOT)
    if args.action in {'engine','planner'}:
        files={p:b for p,b in reviewed.items() if p.startswith(('engine/firered/src/','engine/shared/')) or p in {'engine/firered/package.json'}}
        entries={'worker':'engine/firered/src/suite/session-worker.js','researchBots':'engine/shared','campaignPlanner':'engine/firered/src/suite/campaign-run.js'}
        games=['firered','emerald','crystal']
        if args.action=='planner':entries={'campaignPlanner':entries['campaignPlanner']};games=['firered']
    else:
        files={p.removeprefix('pokemon_suite/static/'):b for p,b in reviewed.items() if p.startswith('pokemon_suite/static/data/')};entries={'data':'data'};games=['firered','leafgreen','emerald','crystal']
    proof=None
    if args.action in {'engine','planner'}:
        from pokemon_suite.bot_verification import verified_payload
        if args.verification is None:raise ValueError('Run scripts/verify-bot.py and supply --verification before packaging a bot update.')
        proof=verified_payload(files,reviewed,json.loads(args.verification.read_text()))
    result=build_package(files,args.output,identifier='suite-'+args.action,version=args.version,kind=args.action,games=games,entrypoints=entries,key=key,verification=proof)
    print(json.dumps({k:v for k,v in result.items() if k!='manifest'},indent=2))

if __name__=='__main__':main()
