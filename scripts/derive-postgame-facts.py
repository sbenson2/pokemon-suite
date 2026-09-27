import argparse,json,re,pathlib
parser=argparse.ArgumentParser(description="Derive FireRed postgame facts from a local pret/pokefirered checkout.")
parser.add_argument("source", type=pathlib.Path)
parser.add_argument("--output",type=pathlib.Path,default=pathlib.Path("engine/firered/src/suite"))
args=parser.parse_args()
root=args.source
people={k:int(v) for k,v in re.findall(r'#define\s+(FAMECHECKER_\w+)\s+(\d+)',(root/'include/constants/fame_checker.h').read_text())}
scripts={}
for p in sorted((root/'data').rglob('*.inc')):
    if 'text' in p.parts:continue
    name=None
    for line in p.read_text().splitlines():
        label=re.match(r'^(\w+)::?\s*(?:@.*)?$',line)
        if label:
            if name and scripts[name] and not re.match(r'^(end|return|returnram|endram|goto|jumpstd|gotostd|trainerbattle_end|endtrainerbattle)\b',scripts[name][-1]):scripts[name].append('goto '+label[1])
            name=label[1];scripts.setdefault(name,[])
        elif name and line.strip() and not line.lstrip().startswith('@'):scripts[name].append(line.split('@')[0].strip())
def facts(start):
    seen=set();found=set();todo=[start]
    while todo:
        key=todo.pop()
        if key in seen:continue
        seen.add(key)
        for line in scripts.get(key,[]):
            m=re.match(r'famechecker\s+(\w+),\s*(\d+)',line)
            if m and m[1] in people:found.add((people[m[1]],int(m[2])))
            if re.match(r'(call|goto|jump|case|map_script|trainerbattle)\w*\s',line):
                args=re.findall(r'\b\w+\b',line)[1:]
                todo.extend(x for x in args if x in scripts)
    return sorted(found)
targets=[]
for p in sorted((root/'data/maps').glob('*/map.json')):
    m=json.loads(p.read_text())
    startup=p.parent.name+'_MapScripts';found=facts(startup)
    if found:targets.append({'map':m['id'],'kind':'map-arrival','script':startup,'entries':found})
    for key,kind in [('object_events','object'),('bg_events','background'),('coord_events','trigger')]:
        for index,e in enumerate(m.get(key,[])):
            found=facts(e.get('script'))
            if found:targets.append({'map':m['id'],'kind':kind,'index':index,'script':e['script'],'entries':found})
doc={'schema':'pokemon-suite/fame-checker-facts/v1','source':{'commit':'c75f352304d529f6ba92d4f74b9cf8b5c3810788','table':'https://github.com/pret/pokefirered/tree/c75f352304d529f6ba92d4f74b9cf8b5c3810788/data','derivation':'Map event identity and reachable famechecker instructions; no artwork or dialogue.'},'people':[k.removeprefix('FAMECHECKER_') for k,v in sorted(people.items(),key=lambda x:x[1])],'targets':targets}
(args.output/'postgame-fame-facts.json').write_text(json.dumps(doc,indent=2)+'\n')
print({'targets':len(targets),'facts':len({tuple(x) for t in targets for x in t['entries']})})

native={k:int(v) for k,v in re.findall(r"#define\s+(SPECIES_\w+)\s+(\d+)",(root/'include/constants/species.h').read_text())}
learners={}
for species,body in re.findall(r"\[(SPECIES_\w+)\]\s*=\s*TMHM_LEARNSET\((.*?)\),",(root/'src/data/pokemon/tmhm_learnsets.h').read_text(),re.S):
    for move in re.findall(r"TMHM\((HM\d+_\w+)\)",body):
        if species in native:learners.setdefault(move,[]).append(native[species])
(args.output/'firered-hm-learners.json').write_text(json.dumps({'source':doc['source']['commit'],'learners':learners},indent=2)+'\n')
