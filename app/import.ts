import { isMainThread, parentPort } from 'node:worker_threads';
import { openLibrary, scan } from './library.ts';
import {fillQuickPreviews} from './previewJobs.ts';

const db = openLibrary();
try {
  const report = scan(db,undefined,message => parentPort?.postMessage({message}));
  await fillQuickPreviews(db,message=>parentPort?.postMessage({message}));
  if (isMainThread) {
    console.log(JSON.stringify(report,null,2));
    if (report.errors.length) process.exitCode=1;
  } else parentPort?.postMessage({report});
} finally { db.close(); }
