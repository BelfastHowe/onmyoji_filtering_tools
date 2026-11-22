import type {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {canonical,conversionVersion,hash} from './domain.ts';
import type {Soul} from './domain.ts';

// Called inside the library schema transaction. Preserve historical snapshot IDs and their results.
export function migrateInventoryRatings(db:DatabaseSync) {
  db.exec(`
    INSERT INTO inventory_piece SELECT snapshot_id,uuid,main,special,yield,输出,孔雀,季,速度,治疗,命中,防御输出 FROM piece_rating;
    INSERT INTO inventory_ready SELECT snapshot_id FROM rating_ready;
    DELETE FROM metric WHERE key IN ('inventory/points','inventory/matched-points','inventory/rated','inventory/zmax');
    DROP TABLE rating_reference;
    DROP TABLE rating_ready;
    DROP TABLE piece_rating;
  `);
  const hasRating = "json_type(data,'$.score') IS NOT NULL OR json_type(data,'$.zscore') IS NOT NULL";
  const affected = db.prepare('SELECT DISTINCT snapshot_id FROM soul WHERE '+hasRating).all();
  for (const {snapshot_id} of affected) {
    db.prepare("UPDATE soul SET data=json_remove(data,'$.score','$.zscore') WHERE snapshot_id=? AND ("+hasRating+')').run(snapshot_id);
    const souls:Soul[] = db.prepare('SELECT data FROM soul WHERE snapshot_id=?').all(snapshot_id)
      .map(row=>JSON.parse(String(row.data))).sort((a,b)=>a.id.localeCompare(b.id,'en'));
    const row = db.prepare('SELECT hero_data FROM snapshot WHERE id=?').get(snapshot_id)!;
    const heroes = JSON.parse(gunzipSync(row.hero_data as Uint8Array).toString('utf8'));
    // If older snapshots differ only by their ratings, keep both IDs for batch history.
    db.prepare('UPDATE OR IGNORE snapshot SET fingerprint=? WHERE id=?')
      .run(hash(canonical([conversionVersion,souls,heroes])),snapshot_id);
  }
}
