/* ============================================================
   Msingi — timetable generator worker thread (v5.268.0)
   Runs solver.solve() off the main event loop so generating a big
   school's timetable (seconds of CPU) never stalls other requests.
   runSolver() is what callers use; under Jest it runs inline.
   ============================================================ */
'use strict';

const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { solve } = require('./solver');

if (!isMainThread && parentPort && workerData?.__timetableSolver) {
  try {
    parentPort.postMessage({ ok: true, result: solve(workerData.problem, workerData.options) });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
  }
}

/** Solve in a worker thread; resolves with solve()'s result. */
function runSolver(problem, options = {}) {
  if (process.env.JEST_WORKER_ID || process.env.TIMETABLE_SOLVER_INLINE === '1') {
    return Promise.resolve(solve(problem, options));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { __timetableSolver: true, problem, options } });
    const killAfter = setTimeout(() => { worker.terminate(); reject(new Error('The generator took too long.')); }, (options.budgetMs ?? 8000) + 30000);
    worker.once('message', (msg) => {
      clearTimeout(killAfter);
      worker.terminate();
      if (msg.ok) resolve(msg.result); else reject(new Error(msg.error));
    });
    worker.once('error', (err) => { clearTimeout(killAfter); reject(err); });
  });
}

module.exports = { runSolver };
