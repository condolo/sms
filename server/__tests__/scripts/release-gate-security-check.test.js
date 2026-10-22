/* ============================================================
   scripts/lib/exec-status.js — the release gate's security-pattern check

   THE BUG THIS PINS
   `npm run platform:release-gate` was unconditionally red. It judged the
   security scan by matching words in the scan's output:

       pass = !out.includes('fail') && !out.includes('found')

   security-scan.js's own success line is

       "Security scan passed - no dangerous patterns found."

   which contains "found" — so a completely clean scan was reported as a
   FAILED check, and the gate always ended in "RELEASE BLOCKED". The
   heuristic was broken in the other direction too: a real violation only
   tripped it if the violation's own wording happened to contain one of
   those two substrings.

   The fix judges the scan by its documented contract ("Exit 0 = clean.
   Exit 1 = violations found"). These tests pin that contract so it cannot
   silently regress into prose-matching again, and so the "fails closed
   when the check could not run" property is protected too.
   ============================================================ */
'use strict';

const path = require('path');
const { execSync } = require('child_process');

const {
  runForStatus,
  judgeByExitStatus,
  runAndJudge,
} = require('../../../scripts/lib/exec-status');

const REPO_ROOT = path.join(__dirname, '../../..');

/* The EXACT success line scripts/security-scan.js prints. This is the
   string that broke the old heuristic — it is the regression's trigger. */
const CLEAN_SCAN_LINE = '✅  Security scan passed — no dangerous patterns found.';

describe('judgeByExitStatus()', () => {
  test('REGRESSION: a clean scan whose success line contains "found" now PASSES', () => {
    // Under the old heuristic this was false, which is why the gate was
    // permanently red on a clean tree.
    const oldHeuristic = !CLEAN_SCAN_LINE.toLowerCase().includes('fail')
                      && !CLEAN_SCAN_LINE.toLowerCase().includes('found');
    expect(oldHeuristic).toBe(false);              // documents the old bug

    const judged = judgeByExitStatus({ status: 0, output: CLEAN_SCAN_LINE });
    expect(judged.pass).toBe(true);                 // the fix
    expect(judged.reason).toBe('exit-0');
  });

  test('a scan that found violations and exited 1 FAILS', () => {
    const judged = judgeByExitStatus({
      status: 1,
      output: '❌  Security scan FAILED - 2 violation(s) found',
    });
    expect(judged.pass).toBe(false);
    expect(judged.reason).toBe('exit-1');
  });

  test('a violation whose wording contains neither "fail" nor "found" still FAILS', () => {
    // The other half of the old bug: prose matching could not see this.
    const judged = judgeByExitStatus({ status: 1, output: '⚠  2 risky pattern(s) detected' });
    expect(judged.pass).toBe(false);
  });

  test('a scan that could not be run at all FAILS CLOSED', () => {
    const judged = judgeByExitStatus({ status: null, output: '' });
    expect(judged.pass).toBe(false);
    expect(judged.reason).toBe('unrunnable');
    expect(judged.output).toBe('Could not run');
  });

  test('a missing result object is treated as unrunnable, not as a pass', () => {
    expect(judgeByExitStatus(undefined).pass).toBe(false);
    expect(judgeByExitStatus(null).pass).toBe(false);
    expect(judgeByExitStatus({}).pass).toBe(false);
  });

  test('the output is trimmed and capped so the gate report stays readable', () => {
    const judged = judgeByExitStatus({ status: 0, output: `  ${'x'.repeat(500)}  ` });
    expect(judged.output.length).toBe(200);
  });
});

describe('runForStatus()', () => {
  test('a command that succeeds reports status 0', () => {
    const r = runForStatus('node -e "process.stdout.write(\'ok\')"');
    expect(r.status).toBe(0);
    expect(r.output).toContain('ok');
  });

  test('a command that exits non-zero reports that status AND its output', () => {
    const r = runForStatus('node -e "console.error(\'boom\'); process.exit(3)"');
    expect(r.status).toBe(3);
    expect(r.output).toContain('boom');
  });

  test('a command that does not exist never reports success', () => {
    // Platform note: on Windows an unknown command is still spawned by
    // cmd.exe, which exits 1 ("is not recognized as an internal or
    // external command"). On POSIX the spawn itself fails and status is
    // null. Either way the gate must not treat it as a pass.
    const r = runForStatus('definitely-not-a-real-command-xyz');
    expect(judgeByExitStatus(r).pass).toBe(false);
  });
});

describe('runAndJudge()', () => {
  test('combines running and judging', () => {
    expect(runAndJudge('node -e "process.exit(0)"').pass).toBe(true);
    expect(runAndJudge('node -e "process.exit(1)"').pass).toBe(false);
  });
});

describe('the real security scan, end to end', () => {
  test('the repository as it stands scans clean, and the gate therefore passes', () => {
    // This is the assertion that would have caught the original bug: on a
    // clean tree the gate's security check must report PASS.
    const judged = runAndJudge('node scripts/security-scan.js 2>&1', { cwd: REPO_ROOT });
    expect(judged.output).toMatch(/Security scan passed/i);
    expect(judged.pass).toBe(true);
  });

  test('the scan exits 0 when clean — the contract the gate now relies on', () => {
    const r = runForStatus('node scripts/security-scan.js 2>&1', { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
  });
});
