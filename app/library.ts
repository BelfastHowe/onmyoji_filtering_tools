import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { decode, hash, type Listing, type Soul } from './domain.ts';
import { analysisVersion, inventoryStats, speedAnalysis, type SpeedResult, type SetStats } from './analysis.ts';
import { pveAnalysis } from './pve.ts';
import { backfillSusanoMeans, saveSusanoMeans } from './pveMean.ts';
import {createInventoryTables,indexInventory} from './inventoryReport.ts';
import {migrateInventoryRatings} from './migrateInventory.ts';
import {invalidateOldDamageResults} from './damageSets.ts';

export const defaultDir = resolve(import.meta.dirname, '../account_data');
export const defaultDB = resolve(import.meta.dirname, '../local_data/accounts.sqlite');
export function openLibrary(path = defaultDB) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout=15000;
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS library_state(id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL);
    INSERT OR IGNORE INTO library_state VALUES(1,0);
    CREATE TABLE IF NOT EXISTS listing(
      id INTEGER PRIMARY KEY, server TEXT NOT NULL, ordersn TEXT NOT NULL, role TEXT, name TEXT NOT NULL,
      server_name TEXT NOT NULL, url TEXT NOT NULL, price INTEGER, captured INTEGER NOT NULL,
      current_snapshot INTEGER REFERENCES snapshot(id), UNIQUE(server,ordersn));
    CREATE TABLE IF NOT EXISTS snapshot(
      id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listing(id), fingerprint TEXT NOT NULL,
      souls INTEGER NOT NULL, full_souls INTEGER NOT NULL, heroes INTEGER NOT NULL, hero_data BLOB NOT NULL,
      UNIQUE(listing_id,fingerprint));
    CREATE TABLE IF NOT EXISTS source(
      hash TEXT PRIMARY KEY, snapshot_id INTEGER NOT NULL REFERENCES snapshot(id), raw_gz BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS soul(
      snapshot_id INTEGER NOT NULL REFERENCES snapshot(id), uuid TEXT NOT NULL, suit TEXT NOT NULL,
      pos INTEGER NOT NULL, level INTEGER NOT NULL, quality INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(snapshot_id,uuid)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS soul_group ON soul(snapshot_id,suit,pos);
    CREATE TABLE IF NOT EXISTS analysis(
      snapshot_id INTEGER NOT NULL REFERENCES snapshot(id), version TEXT NOT NULL, stats TEXT NOT NULL,
      PRIMARY KEY(snapshot_id,version));
    CREATE TABLE IF NOT EXISTS metric(
      snapshot_id INTEGER NOT NULL REFERENCES snapshot(id), version TEXT NOT NULL,
      key TEXT NOT NULL, label TEXT NOT NULL, value REAL, ids TEXT NOT NULL,
      PRIMARY KEY(snapshot_id,version,key));
    CREATE INDEX IF NOT EXISTS metric_rank ON metric(version,key,value DESC);
    CREATE TABLE IF NOT EXISTS team_job(
      id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL REFERENCES snapshot(id), rules TEXT NOT NULL,
      version TEXT NOT NULL, mode TEXT NOT NULL, scene TEXT NOT NULL, template INTEGER NOT NULL,
      config TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待算', owner TEXT, result TEXT, error TEXT, elapsed INTEGER,
      UNIQUE(snapshot_id,rules,version,mode,scene,template));
    CREATE INDEX IF NOT EXISTS team_queue ON team_job(rules,version,mode,status,snapshot_id,id);
    CREATE TABLE IF NOT EXISTS team_control(mode TEXT PRIMARY KEY, paused INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS team_cache(snapshot_id INTEGER NOT NULL REFERENCES snapshot(id),rules TEXT NOT NULL,
      key TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(snapshot_id,rules,key)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS batch(
      id INTEGER PRIMARY KEY, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS member(
      batch_id INTEGER NOT NULL REFERENCES batch(id), account_key TEXT NOT NULL, snapshot_id INTEGER NOT NULL REFERENCES snapshot(id),
      name TEXT NOT NULL, server_name TEXT NOT NULL, url TEXT NOT NULL, price INTEGER,
      PRIMARY KEY(batch_id,account_key));
    CREATE VIEW IF NOT EXISTS current_member AS
      SELECT * FROM (SELECT l.*, CASE WHEN role IS NULL THEN 'listing:'||id ELSE 'role:'||server||':'||role END AS account_key,
        row_number() OVER (PARTITION BY server,coalesce('r:'||role,'l:'||ordersn) ORDER BY captured DESC,id DESC) AS rownum
        FROM listing l WHERE current_snapshot IS NOT NULL) WHERE rownum=1;
  `);
  atomic(db, () => {
    createInventoryTables(db);
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='piece_rating'").get()) migrateInventoryRatings(db);
    backfillSusanoMeans(db);
    if(db.prepare('PRAGMA user_version').get()?.user_version===1){
      db.exec("UPDATE team_control SET paused=1; UPDATE team_job SET status='已暂停' WHERE status='待算'; PRAGMA user_version=2");
    }
    if(db.prepare('PRAGMA user_version').get()?.user_version===2){
      invalidateOldDamageResults(db);
      db.exec('PRAGMA user_version=3');
    }
  });
  return db;
}
function atomic<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}
export function resetLibrary(db: DatabaseSync) {
  atomic(db, () => db.exec(`
    UPDATE library_state SET generation=generation+1 WHERE id=1;
    DELETE FROM member;
    DELETE FROM team_job;
    DELETE FROM team_control;
    DELETE FROM team_cache;
    DELETE FROM inventory_ready;
    DELETE FROM inventory_piece;
    DELETE FROM batch;
    DELETE FROM metric;
    DELETE FROM analysis;
    DELETE FROM source;
    DELETE FROM soul;
    UPDATE listing SET current_snapshot=NULL;
    DELETE FROM snapshot;
    DELETE FROM listing;
  `));
}
function saveAnalysis(db: DatabaseSync, snapshot: number, stats: SetStats[], speeds: SpeedResult[]) {
  const insert = db.prepare('INSERT INTO metric VALUES(?,?,?,?,?,?)');
  for (const m of speeds) insert.run(snapshot, analysisVersion, m.key, m.name, m.value, JSON.stringify(m.ids));
  saveSusanoMeans(db,'pve/',snapshot,analysisVersion);
  db.prepare('INSERT INTO analysis VALUES(?,?,?)').run(snapshot, analysisVersion, JSON.stringify(stats));
}
function writeListing(db: DatabaseSync, data: Listing, raw: Buffer, digest: string) {
  const old = db.prepare('SELECT * FROM listing WHERE server=? AND ordersn=?').get(data.server,data.order);
  const listingId = old ? Number(old.id) : Number(db.prepare(
    'INSERT INTO listing(server,ordersn,role,name,server_name,url,price,captured) VALUES(?,?,?,?,?,?,?,?)'
  ).run(data.server,data.order,data.role,data.name,data.serverName,data.url,data.price,data.captured).lastInsertRowid);
  const oldSnapshot = db.prepare('SELECT id FROM snapshot WHERE listing_id=? AND fingerprint=?').get(listingId,data.fingerprint);
  let snapshotId = Number(oldSnapshot?.id);
  if (!oldSnapshot) {
    snapshotId = Number(db.prepare('INSERT INTO snapshot(listing_id,fingerprint,souls,full_souls,heroes,hero_data) VALUES(?,?,?,?,?,?)')
      .run(listingId,data.fingerprint,data.souls.length,data.souls.filter(s => s.level === 15 && s.quality === 6).length,
        Object.keys(data.heroes).length,gzipSync(JSON.stringify(data.heroes))).lastInsertRowid);
    const insert = db.prepare('INSERT INTO soul VALUES(?,?,?,?,?,?,?)');
    for (const s of data.souls) insert.run(snapshotId,s.id,s.suit,s.pos,s.level,s.quality,JSON.stringify(s));
  }
  if (!old || data.captured >= Number(old.captured)) {
    db.prepare('UPDATE listing SET role=coalesce(?,role),name=?,server_name=?,price=?,captured=?,current_snapshot=? WHERE id=?')
      .run(data.role,data.name,data.serverName,data.price,data.captured,snapshotId,listingId);
  }
  db.prepare('INSERT INTO source VALUES(?,?,?)').run(digest,snapshotId,gzipSync(raw,{level:1}));
  return !old ? 'added' : oldSnapshot ? 'duplicates' : 'updated';
}
export interface ImportReport {
  added: number; updated: number; duplicates: number; calculated: number; batch: number;
  errors: {file: string; message: string}[];
}
class LibraryReset extends Error {}
function writeAtGeneration<T>(db:DatabaseSync,epoch:number,fn:()=>T) {
  return atomic(db,()=>{
    if(db.prepare('SELECT generation FROM library_state WHERE id=1').get()!.generation!==epoch)
      throw new LibraryReset('账号库已清空，本次扫描已停止');
    return fn();
  });
}
export function scanSources(db: DatabaseSync, dir = defaultDir, progress?: (value: string) => void) {
  const epoch=Number(db.prepare('SELECT generation FROM library_state WHERE id=1').get()!.generation);
  const report: ImportReport = { added:0, updated:0, duplicates:0, calculated:0, batch:0, errors:[] };
  const files = readdirSync(dir,{withFileTypes:true}).filter(f=>f.isFile() && /\.json$/i.test(f.name)).map(f=>f.name).sort();
  const known = db.prepare('SELECT 1 FROM source WHERE hash=?');
  for (const [i,file] of files.entries()) {
    progress?.(`读取 ${i+1}/${files.length} · ${file}`);
    try {
      const path = join(dir,file), raw = readFileSync(path), digest = hash(raw);
      if (known.get(digest)) { report.duplicates++; continue; }
      if(raw.includes('"hero_equips"') && Array.isArray(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')).data?.hero_equips)){
        continue; // Reference exports are read only by the comparison CLI.
      }
      const data = decode(raw,statSync(path).mtimeMs);
      const result = writeAtGeneration(db,epoch,() => known.get(digest) ? 'duplicates' : writeListing(db,data,raw,digest));
      report[result]++;
    } catch (e) { if (e instanceof LibraryReset) throw e; report.errors.push({file,message: e instanceof Error ? e.message : String(e)}); }
  }
  // Persist membership before computing: after interruption, the missing analysis rows resume on rescan.
  report.batch = writeAtGeneration(db,epoch,() => {
    const id = Number(db.prepare('INSERT INTO batch(version) VALUES(?)').run(analysisVersion).lastInsertRowid);
    db.prepare('INSERT INTO member SELECT ?,account_key,current_snapshot,name,server_name,url,price FROM current_member').run(id);
    return id;
  });
  const missing = db.prepare(`SELECT DISTINCT m.snapshot_id FROM member m LEFT JOIN analysis a
    ON a.snapshot_id=m.snapshot_id AND a.version=? WHERE m.batch_id=? AND a.snapshot_id IS NULL`).all(analysisVersion,report.batch);
  return {report,epoch,ids:missing.map(row=>Number(row.snapshot_id))};
}

export function analyzeSnapshot(db:DatabaseSync,snapshot:number,epoch:number) {
  try {
    const souls: Soul[] = db.prepare('SELECT data FROM soul WHERE snapshot_id=? ORDER BY uuid').all(snapshot).map(r=>JSON.parse(String(r.data)));
    const stats = inventoryStats(souls), speeds = [...speedAnalysis(souls),...pveAnalysis(souls)];
    const calculated=writeAtGeneration(db,epoch,()=>{
      if (db.prepare('SELECT 1 FROM analysis WHERE snapshot_id=? AND version=?').get(snapshot,analysisVersion)) return 0;
      saveAnalysis(db,snapshot,stats,speeds); return 1;
    });
    return {calculated};
  } catch(e) {
    if(e instanceof LibraryReset)throw e;
    return {calculated:0,error:{file:'快照 '+snapshot,message:e instanceof Error?e.message:String(e)}};
  }
}

export function indexPending(db:DatabaseSync,epoch:number) {
  const unindexed=db.prepare('SELECT s.id FROM snapshot s JOIN analysis a ON a.snapshot_id=s.id AND a.version=? LEFT JOIN inventory_ready r ON r.snapshot_id=s.id WHERE r.snapshot_id IS NULL').all(analysisVersion);
  for(const row of unindexed)writeAtGeneration(db,epoch,()=>indexInventory(db,Number(row.id)));
}

export function scan(db: DatabaseSync, dir = defaultDir, progress?: (value: string) => void): ImportReport {
  const {report,epoch,ids}=scanSources(db,dir,progress);
  for(const [i,id] of ids.entries()){
    progress?.(`计算库存、一速和 PVE 预设 ${i+1}/${ids.length}`);
    const result=analyzeSnapshot(db,id,epoch);
    report.calculated+=result.calculated;
    if(result.error)report.errors.push(result.error);
  }
  indexPending(db,epoch);
  return report;
}
