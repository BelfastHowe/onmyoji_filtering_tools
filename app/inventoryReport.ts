import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import type {Soul} from './domain.ts';
import {dimensions,indicators,analysisVersion} from './analysis.ts';
import {soulSets} from './soulSets.ts';

export const inventoryFields=['yield','输出','孔雀','季','速度','治疗','命中','防御输出'] as const;
export type InventoryField=(typeof inventoryFields)[number];
export const inventoryLabels:Record<InventoryField,string>={yield:'速攻暴伤收益次数',输出:'输出',孔雀:'孔雀',季:'季',速度:'速度',治疗:'治疗',命中:'命中',防御输出:'防御输出'};
export function customYield(s:Soul){
  return ['速度','攻击加成','暴击','暴击伤害'].reduce((n,k)=>n+Math.ceil((s.sub[k]??0)/(k==='暴击伤害'?4:3)),0);
}
export function effectGain(souls:Soul[],effect:'效果命中'|'效果抵抗'){
  const counts=new Map<number,number>();let total=0;
  for(const s of souls){
    total+=(s.sub[effect]??0)+(s.main[0]===effect?parseFloat(String(s.main[1])):0)+(s.fixed?.[0]===effect?parseFloat(String(s.fixed[1])):0);
    counts.set(s.suitId,(counts.get(s.suitId)??0)+1);
  }
  for(const [id,count] of counts)if(count>=2 && soulSets[id]?.two===effect+'15%')total+=15;
  return total;
}
export function createInventoryTables(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_piece(
    snapshot_id INTEGER NOT NULL,uuid TEXT NOT NULL,main TEXT NOT NULL,special INTEGER NOT NULL,
    yield INTEGER NOT NULL,输出 INTEGER,孔雀 INTEGER,季 INTEGER,速度 INTEGER,治疗 INTEGER,命中 INTEGER,防御输出 INTEGER,
    PRIMARY KEY(snapshot_id,uuid),FOREIGN KEY(snapshot_id,uuid) REFERENCES soul(snapshot_id,uuid)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS inventory_ready(snapshot_id INTEGER PRIMARY KEY REFERENCES snapshot(id));
`);
}
export function indexInventory(db:DatabaseSync,id:number){
  if(db.prepare('SELECT 1 FROM inventory_ready WHERE snapshot_id=?').get(id))return;
  const insert=db.prepare('INSERT INTO inventory_piece VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const gear=new Map<string,Soul>();
  for(const r of db.prepare('SELECT data FROM soul WHERE snapshot_id=?').iterate(id)){
    const s:Soul=JSON.parse(String(r.data));gear.set(s.id,s);
    insert.run(id,s.id,s.main[0],Number(!!s.fixed),customYield(s),...Object.values(indicators(s)));
  }
  const metric=db.prepare('INSERT OR REPLACE INTO metric VALUES(?,?,?,?,?,?)');
  for(const m of db.prepare("SELECT * FROM metric WHERE snapshot_id=? AND version=? AND (key LIKE 'speed/hit/%' OR key LIKE 'speed/resist/%' OR key LIKE 'speed/hit-set/%')").all(id,analysisVersion)){
    const souls=(JSON.parse(String(m.ids)) as string[]).map(uuid=>gear.get(uuid)!);
    const attr=String(m.key).startsWith('speed/resist/')?'效果抵抗':'效果命中';
    metric.run(id,analysisVersion,'secondary/'+m.key,String(m.label)+' · '+attr+' (%)',souls.length===6?effectGain(souls,attr):null,m.ids);
  }
  db.prepare("INSERT OR REPLACE INTO metric SELECT ?,?, 'inventory/yield', '速攻暴伤总收益（≥5）', coalesce(sum(yield),0),'[]' FROM inventory_piece WHERE snapshot_id=? AND yield>=5").run(id,analysisVersion,id);
  const existing=db.prepare('SELECT stats FROM analysis WHERE snapshot_id=? AND version=?').get(id,analysisVersion);
  if(existing)for(const s of JSON.parse(String(existing.stats))){
    for(let i=0;i<6;i++)metric.run(id,analysisVersion,'inventory/fullspeed/'+s.name+'/'+(i+1),s.name+' '+(i+1)+'号位满速件数',s.fullSpeed[i],'[]');
  }
  db.prepare('INSERT INTO inventory_ready VALUES(?)').run(id);
}
export function inventoryReport(db:DatabaseSync,id:number,q:URLSearchParams){
  const field=q.get('field')||'yield';
  if(!inventoryFields.includes(field as InventoryField))throw Error('库存指标无效');
  const where=['s.snapshot_id=?'];const args:SQLInputValue[]=[id];
  for(const [param,column] of [['suit','s.suit'],['pos','s.pos'],['special','r.special'],['main','r.main']]){
    const val=q.get(param);if(val){where.push(column+'=?');args.push(val);}
  }
  for(const pos of [2,4,6]){
    const attrs=q.getAll('main'+pos);
    if(attrs.length){where.push('(s.pos<>? OR r.main IN ('+attrs.map(()=>'?').join(',')+'))');args.push(pos,...attrs);}
  }
  for(const [key,operator] of [['min','>='],['max','<=']]){
    if(q.get(key)){const val=Number(q.get(key));if(!Number.isFinite(val))throw Error('指标范围无效');where.push('r.'+field+operator+'?');args.push(val);}
  }
  const from=' FROM soul s JOIN inventory_piece r USING(snapshot_id,uuid) WHERE '+where.join(' AND ');
  const value='r.'+field;
  const bins=db.prepare('SELECT '+value+' value,s.pos,count(*) n'+from+' GROUP BY '+value+',s.pos ORDER BY value,s.pos').all(...args);
  const totals=db.prepare('SELECT s.suit,s.pos,sum(CASE WHEN r.yield>=5 THEN r.yield ELSE 0 END) points'+from+' GROUP BY s.suit,s.pos').all(...args);
  const offset=Math.max(0,Number.parseInt(q.get('offset')||'0')||0);
  const rows=db.prepare('SELECT s.data,'+value+' value'+from+' ORDER BY '+value+' IS NULL,'+value+(q.get('dir')==='asc'?' ASC':' DESC')+',s.uuid LIMIT 50 OFFSET ?').all(...args,offset)
    .map(r=>({soul:JSON.parse(String(r.data)),value:r.value}));
  return {rows,bins,totals,total:bins.reduce((n,r)=>n+Number(r.n),0),dimensions};
}
