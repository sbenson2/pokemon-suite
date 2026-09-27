"""Build an indexed, offline factual Pokédex from a hash-pinned PokéAPI snapshot."""
import argparse,csv,hashlib,json,re,sqlite3,tempfile,os
from pathlib import Path

REQUIRED={'pokemon_species','pokemon','pokemon_stats','pokemon_types','pokemon_abilities','pokemon_moves','pokemon_evolution','items','moves','type_efficacy','type_efficacy_past','versions','version_groups','encounters'}

def build(source,output):
    manifest=json.loads((source/'source.json').read_text())
    files=[f for f in manifest['files'] if not any(s in f['name'] for s in ('prose','flavor','_text'))]
    names={Path(f['name']).stem for f in files}
    if not REQUIRED<=names:raise ValueError('Missing factual tables: '+', '.join(sorted(REQUIRED-names)))
    output.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(dir=output.parent,suffix='.sqlite3');os.close(fd)
    counts={}
    try:
        with sqlite3.connect(temp) as db:
            db.execute('PRAGMA journal_mode=OFF');db.execute('PRAGMA synchronous=OFF');db.execute('PRAGMA user_version=1')
            for entry in sorted(files,key=lambda x:x['name']):
                raw=(source/entry['name']).read_bytes()
                if hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Source fingerprint mismatch: '+entry['name'])
                reader=csv.DictReader(raw.decode('utf-8-sig').splitlines());cols=reader.fieldnames;table=Path(entry['name']).stem
                if not re.fullmatch('[a-z_][a-z0-9_]*',table) or any(not re.fullmatch('[a-z_][a-z0-9_]*',c) for c in cols):raise ValueError('Invalid identifier')
                rows=[[None if not r[c] else int(r[c]) if re.fullmatch('-?[0-9]+',r[c]) else r[c] for c in cols] for r in reader]
                schema=','.join('"'+c+'" '+('INTEGER' if all(r[i] is None or isinstance(r[i],int) for r in rows) else 'TEXT') for i,c in enumerate(cols))
                db.execute(f'CREATE TABLE "{table}" ({schema})');db.executemany(f'INSERT INTO "{table}" VALUES ({",".join("?" for _ in cols)})',rows)
                counts[table]=len(rows)
                # Composite indexes keep million-row learnsets compact and avoid loading them into RAM per query.
                keys=[['pokemon_id','version_group_id'],['pokemon_id','generation_id'],['damage_type_id','target_type_id'],['evolved_species_id'],['species_id'],['item_id'],['id'],['identifier']]
                if table=='pokemon_moves':keys=keys[:1]
                for fields in keys:
                    if all(c in cols for c in fields):db.execute(f'CREATE INDEX "idx_{table}__{"_".join(fields)}" ON "{table}" ({",".join(fields)})')
            for table,col,target in [('pokemon','species_id','pokemon_species'),('pokemon_stats','pokemon_id','pokemon'),('pokemon_types','pokemon_id','pokemon'),('pokemon_abilities','ability_id','abilities'),('pokemon_moves','move_id','moves'),('pokemon_evolution','evolved_species_id','pokemon_species')]:
                n=db.execute(f'SELECT COUNT(*) FROM {table} s LEFT JOIN {target} t ON s.{col}=t.id WHERE s.{col} IS NOT NULL AND t.id IS NULL').fetchone()[0]
                if n:raise ValueError(f'Dangling reference: {table}.{col}: {n}')
            if counts['pokemon_species']<1025 or counts['pokemon']<1351:raise ValueError('Incomplete species/form snapshot.')
            db.execute('CREATE VIRTUAL TABLE search USING fts5(kind UNINDEXED, entity_id UNINDEXED, identifier)')
            for table,kind in [('pokemon_species','species'),('pokemon','pokemon'),('items','item'),('moves','move'),('abilities','ability')]:
                db.execute(f'INSERT INTO search SELECT ?,id,identifier FROM {table}',(kind,))
            db.execute('CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            metadata={'schema':'pokemon-suite/pokedex/v1','source':{**manifest,'files':files},'tables':counts,'integrity':'ok'}
            db.executemany('INSERT INTO metadata VALUES (?,?)',[(k,json.dumps(v,separators=(',',':'))) for k,v in metadata.items()])
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('SQLite integrity check failed')
            db.commit();db.execute('VACUUM')
        os.replace(temp,output)
    finally:
        if os.path.exists(temp):os.unlink(temp)
    return {'path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'tables':counts}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(build(a.source,a.output)))
