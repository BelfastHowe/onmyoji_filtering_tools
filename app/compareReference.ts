import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {defaultDB} from './library.ts';
import {analysisVersion} from './analysis.ts';
import type {Soul} from './domain.ts';
import {engineSoul,createTeamEngine} from './teamEngine.ts';
import {rulesVersion} from './rules.ts';

function sameAttributes(expected:{type:string;value:number}[],actual:{type:string;value:number}[]){
  if(!Array.isArray(actual)||expected.length!==actual.length)return false;
  return expected.every(a=>actual.some(b=>b.type===a.type && Number.isFinite(b.value) &&
    Math.abs(a.value-b.value)<=(['Speed','Hp','Defense','Attack'].includes(a.type)?0.005001:0.00005001)));
}
function matchSnapshot(db:DatabaseSync,gear:ReturnType<typeof engineSoul>[],sourceSnapshot?:number){
  if(!gear.length || new Set(gear.map(s=>s.id)).size!==gear.length)throw Error('参考库存为空或包含重复御魂 ID');
  const candidates=sourceSnapshot ? [{snapshot_id:sourceSnapshot}] : db.prepare('SELECT snapshot_id FROM soul WHERE uuid=?').all(gear[0].id);
  const matches=candidates.flatMap(row=>{
    const items=new Map(db.prepare('SELECT uuid,data FROM soul WHERE snapshot_id=?').all(row.snapshot_id).map(s=>[s.uuid,s.data]));
    const matched=gear.filter(ref=>{
      const value=items.get(ref.id);if(!value)return false;
      const item=engineSoul(JSON.parse(String(value)) as Soul);
      return ref.suit_id===item.suit_id && ref.pos===item.pos && ref.level===item.level && ref.quality===item.quality &&
        sameAttributes([item.base_attr],[ref.base_attr]) && sameAttributes(item.random_attrs,ref.random_attrs) && sameAttributes(item.single_attrs,ref.single_attrs);
    });
    const fullIdentity=items.size===gear.length&&gear.every(s=>items.has(s.id));
    if(!matched.length || (matched.length!==gear.length&&!fullIdentity))return [];
    return [Number(row.snapshot_id)];
  });
  if(matches.length!==1)throw Error(matches.length?'多个快照匹配此参考文件，请使用可区分快照的完整参考文件':'未找到属性和 UUID 均匹配的库存快照');
  return matches[0];
}

const input=process.argv[2];
if(!input)throw Error('请指定魔方参考 JSON 或包含 ref-*.json 的目录');
const path=resolve(input),original=process.argv.includes('--original');
const files=statSync(path).isDirectory()?readdirSync(path).filter(s=>/^ref-.*\.json$/i.test(s)).sort().map(s=>join(path,s)):[path];
const db=new DatabaseSync(defaultDB,{readOnly:true}),engine=createTeamEngine(original);
try{
  for(const file of files){
    const bytes=readFileSync(file);
    const gear=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')).data.hero_equips;
    const digest=/^ref-([0-9a-f]{64})\.json$/i.exec(basename(file))?.[1];
    const linked=digest && db.prepare('SELECT snapshot_id FROM source WHERE hash=?').get(digest)?.snapshot_id;
    const snapshot=matchSnapshot(db,gear,linked?Number(linked):undefined);
    engine.setStandardInventory(gear);
    const metrics=new Map(db.prepare('SELECT key,value,ids FROM metric WHERE snapshot_id=? AND version=?').all(snapshot,analysisVersion)
      .map(r=>[String(r.key),{value:r.value===null?null:Number(r.value),ids:JSON.parse(String(r.ids)) as string[]}]));
    const differences:{key:string;local:number|null|undefined;reference:number|null}[]=[];
    let pve=0,speed=0,identicalGear=0;
    function compare(key:string,reference:number|null,ids:string[]){
      const local=metrics.get(key);
      if(!local || (local.value===null)!==(reference===null) ||
        Math.abs((local.value??0)-(reference??0))>0.00001)differences.push({key,local:local?.value,reference});
      if(local&&JSON.stringify([...local.ids].sort())===JSON.stringify([...ids].sort()))identicalGear++;
    }
    for(const row of await engine.pvePreview()){
      const key=row.hero==='不见岳'?'yue/defense':row.hero==='因幡辉夜姬'?'inaba/'+(row.sets==='火灵'?'fire':'loose'):
        [row.hero,...row.sets.split(' + ')].join('/');
      compare('pve-fast/'+rulesVersion+'/'+key,row.value,row.ids);pve++;
    }
    const used=new Map<string,string[]>();
    for(const key of [...metrics.keys()].filter(k=>k.startsWith('speed/')).sort()){
      const [,kind,set]=key.split('/'),ranked=['loose','hit','resist'].includes(kind);
      const excludes=ranked?(used.get(kind)??[]):[];
      const result=await engine.referenceSpeed(ranked?'':set,kind.startsWith('hit')?'EffectHitRate':kind==='resist'?'EffectResistRate':'',
        kind==='hit-set'?'HpRate':'',excludes);
      if(ranked)used.set(kind,[...excludes,...result.ids]);
      compare(key,result.value,result.ids);speed++;
    }
    console.log(JSON.stringify({snapshot,original,pve,speed,identicalGear,differences,referencePieces:gear.length}));
  }
}finally{db.close();}
