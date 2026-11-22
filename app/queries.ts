import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { analysisVersion } from './analysis.ts';

export function catalogue(db: DatabaseSync) {
  return {
    batches: db.prepare('SELECT b.*,count(m.snapshot_id) AS accounts FROM batch b LEFT JOIN member m ON m.batch_id=b.id GROUP BY b.id ORDER BY b.id DESC').all(),
    metrics: db.prepare("SELECT key,min(label) AS label FROM metric GROUP BY key ORDER BY (key LIKE '%/mean/须佐之男') DESC,key").all(),
    counts: db.prepare(`SELECT count(*) AS accounts,coalesce(sum(s.souls),0) AS souls,coalesce(sum(s.full_souls),0) AS full
      FROM current_member l JOIN snapshot s ON s.id=l.current_snapshot`).get()
  };
}
export function accounts(db: DatabaseSync, q: URLSearchParams) {
  const bid = Number(q.get('batch') || 0);
  const run = bid ? db.prepare('SELECT version FROM batch WHERE id=?').get(bid) : null;
  if (bid && !run) return [];
  const version = String(run?.version ?? analysisVersion);
  const base = bid ? 'SELECT snapshot_id,name,server_name,url,price,account_key FROM member WHERE batch_id=?'
    : 'SELECT current_snapshot AS snapshot_id,name,server_name,url,price,account_key FROM current_member';
  const args: SQLInputValue[] = bid ? [bid] : [];
  const metric = q.get('metric') || 'speed/loose/1';
  args.push(version,metric);
  const joins:string[]=[],sorts:string[]=[];
  for(const [i,raw] of q.getAll('then').slice(0,2).entries()){
    const [key,dir]=JSON.parse(raw);
    if(typeof key!=='string'||!['asc','desc'].includes(dir))throw Error('排序参数无效');
    const alias='sort'+i;
    joins.push(`LEFT JOIN metric ${alias} ON ${alias}.snapshot_id=b.snapshot_id AND ${alias}.version=? AND ${alias}.key=?`);
    args.push(version,key);sorts.push(alias+'.value IS NULL,'+alias+'.value '+(dir==='asc'?'ASC':'DESC'));
  }
  const where: string[] = [];
  if (q.get('q')) { where.push("instr(lower(b.name||' '||b.server_name||' '||b.url),lower(?))>0"); args.push(q.get('q')!); }
  for (const raw of q.getAll('filter').slice(0,12)) {
    const [key, min, max] = JSON.parse(raw);
    if (typeof key !== 'string' || ![min,max].every(v=>v === null || (typeof v === 'number' && Number.isFinite(v)))) throw new Error('筛选参数无效');
    where.push('EXISTS(SELECT 1 FROM metric f WHERE f.snapshot_id=b.snapshot_id AND f.version=? AND f.key=? AND f.value IS NOT NULL AND (? IS NULL OR f.value>=?) AND (? IS NULL OR f.value<=?))');
    args.push(version,key,min,min,max,max);
  }
  const direction = q.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const templates=[...new Set(q.getAll('template'))];
  if(templates.length){
    if(templates.length>120||templates.some(k=>!k.startsWith('team/')))throw Error('模板条件无效');
    const flags=templates.map(()=>'?').join(',');
    const needed=q.get('match')==='any'?1:templates.length;
    where.push(`(SELECT count(*) FROM metric f WHERE f.snapshot_id=b.snapshot_id AND f.version=? AND f.key IN (${flags}) AND f.value=?)>=?`);
    args.push(version,...templates,q.get('pass')==='0'?0:1,needed);
  }
  return db.prepare(`WITH b AS (${base}) SELECT b.*,s.souls,s.full_souls,s.heroes,m.value,
    CASE WHEN m.key IS NULL THEN '未计算' WHEN m.value IS NULL THEN '无可用组合' ELSE '已完成' END AS state
    FROM b JOIN snapshot s ON s.id=b.snapshot_id LEFT JOIN metric m ON m.snapshot_id=b.snapshot_id AND m.version=? AND m.key=?
    ${joins.join(' ')} ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY ${['m.value IS NULL,m.value '+direction,...sorts,'b.account_key'].join(',')}`).all(...args);
}
export function snapshotDetail(db: DatabaseSync,id: number,version=analysisVersion) {
  const stats = db.prepare('SELECT stats FROM analysis WHERE snapshot_id=? AND version=?').get(id,version);
  return {
    stats: stats ? JSON.parse(String(stats.stats)) : [],
    metrics: db.prepare('SELECT key,label,value,ids FROM metric WHERE snapshot_id=? AND version=? ORDER BY key').all(id,version)
      .map(row=>({...row,ids:JSON.parse(String(row.ids))})),
  };
}
export function inventory(db: DatabaseSync, id: number, q: URLSearchParams) {
  const where=['snapshot_id=?']; const args: SQLInputValue[]=[id];
  if(q.has('id')) {
    const ids=q.getAll('id').slice(0,6);
    where.push('uuid IN ('+ids.map(()=>'?').join(',')+')'); args.push(...ids);
  }
  if(q.get('suit')) { where.push('suit=?');args.push(q.get('suit')!); }
  if(q.get('pos')) { where.push('pos=?');args.push(Number(q.get('pos'))); }
  const from=' FROM soul WHERE '+where.join(' AND ');
  const offset=Math.max(0,Number.parseInt(q.get('offset') || '0',10)||0);
  return { total:Number(db.prepare('SELECT count(*) AS n'+from).get(...args)!.n),
    rows:db.prepare('SELECT data'+from+' ORDER BY pos,suit,uuid LIMIT 50 OFFSET ?').all(...args,offset).map(r=>JSON.parse(String(r.data))) };
}
