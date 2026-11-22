import type { DatabaseSync } from 'node:sqlite';
import { analysisVersion } from './analysis.ts';
import { createTeamEngine } from './teamEngine.ts';
import { rulesVersion } from './rules.ts';
import { fourSets } from './pve.ts';

export async function fillQuickPreviews(db:DatabaseSync, progress?:(s:string)=>void){
  const prefix='pve-fast/'+rulesVersion+'/';
  const missing=db.prepare(`SELECT DISTINCT current_snapshot id FROM current_member c
    WHERE NOT EXISTS(SELECT 1 FROM metric WHERE snapshot_id=c.current_snapshot AND version=? AND key=?)`)
    .all(analysisVersion,prefix+'yue/defense');
  if(!missing.length)return;
  const engine=createTeamEngine();
  const insert=db.prepare('INSERT OR REPLACE INTO metric VALUES(?,?,?,?,?,?)');
  const generation=db.prepare('SELECT generation FROM library_state WHERE id=1'),epoch=generation.get()!.generation;
  for(const [i,{id}] of missing.entries()){
    progress?.(`计算魔方快速 PVE ${i+1}/${missing.length}`);
    const souls=db.prepare('SELECT data FROM soul WHERE snapshot_id=? ORDER BY uuid').all(id);
    engine.setInventory(souls.map(s=>JSON.parse(String(s.data))));
    const rows=await engine.pvePreview();
    const sums=new Map<string,number>();
    db.exec('BEGIN IMMEDIATE');
    try{
      if(generation.get()!.generation!==epoch)throw Error('账号库已重置');
      for(const r of rows){
        const [four,boss]=r.sets.split(' + ');
        const key=r.hero==='不见岳'?'yue/defense':r.hero==='因幡辉夜姬'?'inaba/'+(four==='火灵'?'fire':'loose'):[r.hero,four,boss].join('/');
        if(r.hero==='须佐之男')sums.set(four,(sums.get(four)??0)+(r.value??0));
        insert.run(id,analysisVersion,prefix+key,'魔方快速 · '+r.hero+' · '+r.sets,r.value,JSON.stringify(r.ids));
      }
      for(const set of fourSets)insert.run(id,analysisVersion,prefix+'mean/'+set,'魔方快速 · '+set+' · 三首领均值',(sums.get(set)??0)/3,'[]');
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
}
