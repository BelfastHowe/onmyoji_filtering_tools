import { parentPort, workerData } from 'node:worker_threads';
import { openLibrary } from './library.ts';
import { runQuickPreviews } from './previewJobs.ts';

const {database,ids,cursor,epoch}=workerData;
const db=openLibrary(database);
try { await runQuickPreviews(db,ids,cursor,epoch,()=>parentPort!.postMessage('done')); }
finally { db.close(); }
