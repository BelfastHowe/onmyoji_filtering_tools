import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSnapshot, openLibrary } from './library.ts';
import { claimSnapshots } from './parallelism.ts';

const {database,ids,cursor,epoch}=workerData;
const db=openLibrary(database);
try {
  for(const id of claimSnapshots(ids,cursor)) parentPort!.postMessage(analyzeSnapshot(db,id,epoch));
} finally { db.close(); }
