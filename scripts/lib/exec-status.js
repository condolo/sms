/* ============================================================
   exec-status.js — run a child process and judge it by EXIT STATUS.

   WHY THIS EXISTS
   The release gate used to decide whether the security scan passed by
   matching words in its output:

       pass = !out.includes('fail') && !out.includes('found')

   That could never pass. security-scan.js's own success line is

       "Security scan passed - no dangerous patterns found."

   which contains "found" — so a completely clean scan was reported as a
   FAILED check, and `npm run platform:release-gate` always ended in
   "RELEASE BLOCKED". The heuristic was broken in the other direction too:
   a genuine violation only tripped it if the violation's own wording
   happened to contain one of those two substrings.

   The script documents its real contract at the top of the file:

       Exit 0 = clean. Exit 1 = violations found (CI fails).

   So the contract is the exit status, and that is what we check. Prose is
   for humans; the status is for machines.

   Two states matter and are kept distinct:
     - status === 0      -> passed
     - status !== 0      -> failed (the command ran and said no)
     - status === null   -> could not be started at all -> FAILED CLOSED
       (a gate that cannot run its check must not report success)
   ============================================================ */
'use strict';

const { execSync } = require('child_process');

/**
 * Run a command, capturing its output and exit status.
 * @returns {{ status: number|null, output: string }}
 *   status === null means the process could not be started.
 */
function runForStatus(cmd, opts = {}) {
  try {
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
    return { status: 0, output };
  } catch (e) {
    if (e && typeof e.status === 'number') {
      return { status: e.status, output: `${e.stdout || ''}${e.stderr || ''}` };
    }
    return { status: null, output: '' };
  }
}

/**
 * Judge a command result by exit status.
 * @param {{ status: number|null, output?: string }} result
 * @returns {{ pass: boolean, reason: string, output: string }}
 */
function judgeByExitStatus(result) {
  const status = result && typeof result.status === 'number' ? result.status : null;
  const output = String((result && result.output) || '').trim();

  if (status === null) {
    return { pass: false, reason: 'unrunnable', output: 'Could not run' };
  }
  if (status === 0) {
    return { pass: true, reason: 'exit-0', output: output.slice(0, 200) };
  }
  return { pass: false, reason: `exit-${status}`, output: output.slice(0, 200) };
}

/** Convenience: run a command and judge it in one step. */
function runAndJudge(cmd, opts = {}) {
  return judgeByExitStatus(runForStatus(cmd, opts));
}

module.exports = { runForStatus, judgeByExitStatus, runAndJudge };
