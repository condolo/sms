/* ============================================================
   Student Council — pure rules (no DB, no Express)

   Everything that decides *what a case or election may do next* lives
   here so the routes stay thin and the rules can be tested without a
   database. The routes own persistence; this file owns policy:

     - grievance/suggestion categories and the state machine
     - safeguarding detection (a safety disclosure must never be closed
       by students alone)
     - election phase derived from dates (staff can also force-close)
     - who may nominate / vote, and how a seat is tallied
     - the reference printed on every case ("SC-2026-0007")
   ============================================================ */
'use strict';

const KINDS      = ['grievance', 'suggestion'];
const CATEGORIES = ['welfare', 'academics', 'facilities', 'safety', 'other'];
const OPEN_STATUSES = ['open', 'under_review', 'escalated'];

/* Deliberately small and high-signal: each pattern names a disclosure
   that must reach an adult. False positives are acceptable here (a
   patron reviews an escalated case); a miss is not. */
const SAFEGUARDING_PATTERNS = [
  /\bsuicid/i,
  /\bself[-\s]?harm/i,
  /\bself[-\s]?hate/i,
  /\babus(e|ed|ing|ive)\b/i,
  /\bassault/i,
  /\brape\b/i,
  /\bmolest/i,
  /\bbeat(en|ing)?\b/i,
  /\bthreat(en|ened|ening)?\b/i,
  /\bbull(y|ied|ying)\b/i,
  /\bharass/i,
  /\bkill (my|him|her)self/i,
  /\bcutting my ?self/i,
];

/** True when a case must be escalated to the patron immediately. */
function isSafeguarding({ category, title, body } = {}) {
  if (category === 'safety') return true;
  const text = `${title || ''} ${body || ''}`;
  return SAFEGUARDING_PATTERNS.some((re) => re.test(text));
}

/**
 * The case lifecycle. A merged/withered case is terminal; a rejected or
 * resolved case may be reopened by a new reply from the reporter.
 */
const TRANSITIONS = {
  open:         ['under_review', 'escalated', 'resolved', 'rejected', 'withdrawn', 'merged'],
  under_review: ['open', 'escalated', 'resolved', 'rejected', 'withdrawn', 'merged'],
  escalated:    ['under_review', 'resolved', 'rejected', 'withdrawn', 'merged'],
  resolved:     ['under_review', 'open'],
  rejected:     ['under_review', 'open'],
  merged:       [],
  withdrawn:    [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

/** "SC-2026-0007" — stable, printable, one per school per year. */
function caseRef(sequence, year = new Date().getFullYear()) {
  return `SC-${year}-${String(sequence).padStart(4, '0')}`;
}

function positionKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The election's live phase, derived from its dates so a forgotten
 * "advance" click can never leave a school stuck:
 *   draft → upcoming → nominations → vetting → voting → closed
 * An explicitly closed election stays closed.
 */
function effectiveElectionPhase(election, now = new Date()) {
  if (!election) return 'draft';
  if (election.phase === 'draft') return 'draft';
  if (election.phase === 'closed') return 'closed';
  const t = now.getTime();
  const at = (v) => (v ? new Date(v).getTime() : null);
  const nominationStart = at(election.nominationStart);
  const nominationEnd   = at(election.nominationEnd);
  const votingStart     = at(election.votingStart);
  const votingEnd       = at(election.votingEnd);

  if (votingStart && votingEnd && t > votingEnd) return 'closed';
  if (votingStart && t >= votingStart) return 'voting';
  if (nominationEnd && t > nominationEnd) return 'vetting';
  if (nominationStart && t >= nominationStart) return 'nominations';
  if (election.phase && election.phase !== 'draft') return election.phase;
  return 'upcoming';
}

/**
 * May this student stand for this seat?
 * One candidacy per election; eligibility is attendance/class based only
 * where the position says so. Vetting is a separate, staff-only step.
 */
function canNominate({ phase, position, student, existingCandidateIds, alreadyCandidate }) {
  if (phase !== 'nominations') return { ok: false, reason: 'Nominations are not open.' };
  if (!position) return { ok: false, reason: 'Pick a position to stand for.' };
  if (alreadyCandidate) return { ok: false, reason: 'You are already standing in this election.' };
  if (!student || (student.status && student.status !== 'active')) {
    return { ok: false, reason: 'Only active students may stand for the council.' };
  }
  const allowedClasses = Array.isArray(position.eligibleClassIds) ? position.eligibleClassIds : [];
  if (allowedClasses.length && !allowedClasses.includes(student.classId)) {
    return { ok: false, reason: 'This seat is not open to your class.' };
  }
  const minAttendance = Number(position.minAttendancePct);
  if (Number.isFinite(minAttendance) && minAttendance > 0) {
    const pct = Number(student.attendancePct);
    if (!Number.isFinite(pct) || pct < minAttendance) {
      return { ok: false, reason: `This seat needs at least ${minAttendance}% attendance.` };
    }
  }
  return { ok: true };
}

/**
 * May this student vote in this seat? Secret ballot: one vote per
 * position per student. Self-voting is off unless the school opts in.
 */
function canVote({ phase, position, voterStudentId, candidateStudentId, alreadyVoted, allowSelfVote }) {
  if (phase !== 'voting') return { ok: false, reason: 'Voting is not open.' };
  if (!position) return { ok: false, reason: 'Pick a position.' };
  if (alreadyVoted) return { ok: false, reason: 'You have already voted for this seat.' };
  if (!voterStudentId || !candidateStudentId) {
    return { ok: false, reason: 'Pick a candidate.' };
  }
  if (!allowSelfVote && voterStudentId === candidateStudentId) {
    return { ok: false, reason: 'You cannot vote for yourself.' };
  }
  return { ok: true };
}

/**
 * Seat tally. Winners are the top N by votes; a tie only blocks a seat
 * when the tied group CROSSES the cutoff (a group that fits inside the
 * remaining seats is seated whole). Ties are never broken here — the
 * caller opens a runoff or the patron appoints. A seat nobody voted for
 * stays open rather than being handed to a zero-vote candidate.
 */
function tallySeats({ candidates = [], votes = [], seats = 1 }) {
  const counts = new Map(candidates.map((c) => [c.id, 0]));
  for (const v of votes) {
    if (counts.has(v.candidateId)) counts.set(v.candidateId, counts.get(v.candidateId) + 1);
  }
  const ranked = [...counts.entries()]
    .map(([candidateId, votes]) => ({ candidateId, votes }))
    .sort((a, b) => b.votes - a.votes || String(a.candidateId).localeCompare(String(b.candidateId)));

  const winnerIds = [];
  let runoffRequired = false;

  // Everybody on zero: nobody earned a seat; leave it open (runoff/appointment).
  if (ranked.length && ranked[0].votes === 0) {
    return { ranked, winnerIds: [], runoffRequired: true };
  }

  for (let i = 0; i < ranked.length && winnerIds.length < seats; i += 1) {
    const seat = ranked[i];
    const next = ranked[i + 1];
    const remainingSeats = seats - winnerIds.length;

    if (next && next.votes === seat.votes) {
      const group = ranked.filter((r) => r.votes === seat.votes);
      if (group.length > remainingSeats) {
        // The tied group does not fit in what is left — the school decides.
        runoffRequired = true;
        break;
      }
      for (const member of group) {
        if (winnerIds.length < seats) winnerIds.push(member.candidateId);
      }
      i += group.length - 1;
      continue;
    }

    winnerIds.push(seat.candidateId);
  }

  return { ranked, winnerIds, runoffRequired };
}

module.exports = {
  KINDS,
  CATEGORIES,
  OPEN_STATUSES,
  isSafeguarding,
  canTransition,
  caseRef,
  positionKey,
  effectiveElectionPhase,
  canNominate,
  canVote,
  tallySeats,
  TRANSITIONS,
  SAFEGUARDING_PATTERNS,
};
