import type { DatabaseSync } from 'node:sqlite';
import { bossSets, fourSets } from './pve.ts';

const combinations = fourSets.flatMap(set => bossSets.map(boss => '须佐之男/'+set+'/'+boss));

// One row per complete snapshot/version/mode. NULL represents a calculated, infeasible preset.
export function saveSusanoMeans(db: DatabaseSync, prefix: string, snapshot?: number, version?: string) {
  const keys = combinations.map(combo => prefix+combo);
  const label = '须佐之男 · 21项平均分（'+(prefix==='pve/'?'本地最优':'魔方快速')+'）';
  db.prepare(`INSERT OR REPLACE INTO metric(snapshot_id,version,key,label,value,ids)
    SELECT snapshot_id,version,?,?,total(value)/?,'[]' FROM metric
    WHERE key IN (${keys.map(()=>'?').join(',')}) ${snapshot===undefined?'':'AND snapshot_id=? AND version=?'}
    GROUP BY snapshot_id,version HAVING count(*)=?`)
    .run(prefix+'mean/须佐之男',label,keys.length,...keys,...(snapshot===undefined?[]:[snapshot,version!]),keys.length);
}

export function backfillSusanoMeans(db: DatabaseSync) {
  if (db.prepare('PRAGMA user_version').get()?.user_version !== 0) return;
  saveSusanoMeans(db,'pve/');
  const prefixes = db.prepare(`SELECT DISTINCT substr(key,1,instr(substr(key,10),'/')+9) AS prefix
    FROM metric WHERE key GLOB 'pve-fast/*/须佐之男/*'`).all();
  for (const {prefix} of prefixes) saveSusanoMeans(db,String(prefix));
  db.exec('PRAGMA user_version=1');
}
