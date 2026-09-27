import { sections } from './region-map-facts.js';

// The Town Map's landmark coordinates and route exceptions. Rendering only;
// these values must never enter navigation or mutate a save/game state.
const fixed = {
  MAPSEC_KANTO_SAFARI_ZONE:[12,12], MAPSEC_SILPH_CO:[14,6], MAPSEC_POKEMON_MANSION:[4,14],
  MAPSEC_POKEMON_TOWER:[18,6], MAPSEC_POWER_PLANT:[18,4], MAPSEC_S_S_ANNE:[14,9],
  MAPSEC_POKEMON_LEAGUE:[2,3], MAPSEC_ROCKET_HIDEOUT:[11,6], MAPSEC_BIRTH_ISLAND:[18,13],
  MAPSEC_NAVEL_ROCK:[10,8], MAPSEC_TRAINER_TOWER_2:[5,6], MAPSEC_MT_EMBER:[2,3],
  MAPSEC_BERRY_FOREST:[14,12], MAPSEC_PATTERN_BUSH:[17,3], MAPSEC_ROCKET_WAREHOUSE:[17,11],
  MAPSEC_DILFORD_CHAMBER:[9,12], MAPSEC_LIPTOO_CHAMBER:[9,12], MAPSEC_MONEAN_CHAMBER:[9,12],
  MAPSEC_RIXY_CHAMBER:[9,12], MAPSEC_SCUFIB_CHAMBER:[9,12], MAPSEC_TANOBY_CHAMBERS:[9,12],
  MAPSEC_VIAPOIS_CHAMBER:[9,12], MAPSEC_WEEPTH_CHAMBER:[9,12], MAPSEC_DOTTED_HOLE:[16,8],
  MAPSEC_VIRIDIAN_FOREST:[4,6],
};
const numericExceptions = {MAPSEC_ROUTE_2:{0:[4,7],3:[4,5]},MAPSEC_ROUTE_5:{1:[14,5]},
  MAPSEC_ROUTE_6:{0:[14,7]},MAPSEC_ROUTE_7:{0:[13,6]},MAPSEC_ROUTE_8:{0:[15,6]}};

export function readTownMapPosition({map,position,save,fields,resolveMap}) {
  const section=map?.properties?.region_map_section, spec=sections[section];
  if(!spec)return null;
  const region=spec[4];
  let cell=fixed[section]??numericExceptions[section]?.[map.number];
  if(section==='MAPSEC_ROUTE_21')cell=map.id==='MAP_ROUTE21_NORTH'?[4,12]:map.id==='MAP_ROUTE21_SOUTH'?[4,13]:null;
  if(section==='MAPSEC_UNDERGROUND_PATH')cell=map.id==='MAP_UNDERGROUND_PATH_NORTH_ENTRANCE'?[14,5]:[14,7];
  if(section==='MAPSEC_UNDERGROUND_PATH_2')cell=map.id==='MAP_UNDERGROUND_PATH_EAST_ENTRANCE'?[15,6]:[12,6];
  if(cell)return {region,x:cell[0],y:cell[1]};
  let source=map,dimensions=spec,point=position;
  const type=map.properties.map_type;
  if(['MAP_TYPE_UNDERGROUND','MAP_TYPE_UNKNOWN','MAP_TYPE_SECRET_BASE','MAP_TYPE_INDOOR'].includes(type)){
    const dynamic=type==='MAP_TYPE_SECRET_BASE'||section==='MAPSEC_SPECIAL_AREA';
    const offset=fields?.[dynamic?'dynamicWarp':'escapeWarp']?.offset;
    if(!Number.isSafeInteger(offset)||offset<0||offset+8>save.length)return null;
    source=resolveMap(save[offset],save[offset+1]);
    if(!source)return null;
    const bytes=new DataView(save.buffer,save.byteOffset,save.byteLength);
    point={x:bytes.getInt16(offset+4,true),y:bytes.getInt16(offset+6,true)};
    if(type!=='MAP_TYPE_INDOOR'||dynamic)dimensions=sections[source.properties?.region_map_section];
  }
  const width=source.layout?.width,height=source.layout?.height;
  if(!dimensions||![width,height,dimensions[2],dimensions[3]].every(v=>Number.isSafeInteger(v)&&v>0)||
     ![point?.x,point?.y].every(v=>Number.isSafeInteger(v)&&v>=0))return null;
  const x=dimensions[0]+Math.min(dimensions[2]-1,Math.floor(point.x/Math.max(1,Math.floor(width/dimensions[2]))));
  const y=dimensions[1]+Math.min(dimensions[3]-1,Math.floor(point.y/Math.max(1,Math.floor(height/dimensions[3]))));
  return x>=0&&x<22&&y>=0&&y<15?{region,x,y}:null;
}
