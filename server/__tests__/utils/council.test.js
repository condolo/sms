/* ============================================================
   server/utils/council.js — Student Council pure rules

   These pin the policies that must never drift into a route:
     - safeguarding detection (a safety disclosure can never sit only
       in a student's queue)
     - the case state machine
     - election phase derived from dates
     - nomination / vote eligibility
     - seat tallying, where a tie is a runoff and never a coin toss
   ============================================================ */
'use strict';

const {
  isSafeguarding, canTransition, caseRef, effectiveElectionPhase,
  canNominate, canVote, tallySeats,
} = require('../../utils/council');

describe('safeguarding', () => {
  test('a safety category always escalates', () => {
    expect(isSafeguarding({ category: 'safety', title: 'Locks', body: 'door broken' })).toBe(true);
  });

  test('a disclosure inside an ordinary category escalates too', () => {
    expect(isSafeguarding({ category: 'welfare', title: 'Need help', body: 'someone is bullying me' })).toBe(true);
    expect(isSafeguarding({ category: 'other', title: 'x', body: 'I am thinking about suicide' })).toBe(true);
  });

  test('an ordinary case does not', () => {
    expect(isSafeguarding({ category: 'facilities', title: 'Broken taps', body: 'the washrooms need repair' })).toBe(false);
  });
});

describe('case state machine', () => {
  test('an open case can move forward', () => {
    expect(canTransition('open', 'under_review')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(true);
    expect(canTransition('under_review', 'escalated')).toBe(true);
  });

  test('a merged or withdrawn case is terminal', () => {
    expect(canTransition('merged', 'open')).toBe(false);
    expect(canTransition('withdrawn', 'under_review')).toBe(false);
  });

  test('a closed case may be reopened by a new reply', () => {
    expect(canTransition('resolved', 'under_review')).toBe(true);
    expect(canTransition('rejected', 'under_review')).toBe(true);
  });
});

describe('case reference', () => {
  test('is zero-padded and year-scoped', () => {
    expect(caseRef(7, 2026)).toBe('SC-2026-0007');
    expect(caseRef(1234, 2026)).toBe('SC-2026-1234');
  });
});

describe('election phases', () => {
  const election = {
    nominationStart: '2026-11-01T00:00:00.000Z',
    nominationEnd:   '2026-11-08T00:00:00.000Z',
    votingStart:     '2026-11-10T00:00:00.000Z',
    votingEnd:       '2026-11-17T00:00:00.000Z',
  };

  test('before nominations opens', () => {
    expect(effectiveElectionPhase(election, new Date('2026-10-20T00:00:00Z'))).toBe('upcoming');
  });

  test('nominations window', () => {
    expect(effectiveElectionPhase(election, new Date('2026-11-03T00:00:00Z'))).toBe('nominations');
  });

  test('vetting between nominations and voting', () => {
    expect(effectiveElectionPhase(election, new Date('2026-11-09T00:00:00Z'))).toBe('vetting');
  });

  test('voting window', () => {
    expect(effectiveElectionPhase(election, new Date('2026-11-12T00:00:00Z'))).toBe('voting');
  });

  test('after voting ends it closes on its own', () => {
    expect(effectiveElectionPhase(election, new Date('2026-11-20T00:00:00Z'))).toBe('closed');
  });

  test('an explicitly closed election stays closed', () => {
    expect(effectiveElectionPhase({ ...election, phase: 'closed' }, new Date('2026-11-03T00:00:00Z'))).toBe('closed');
  });
});

describe('nominations', () => {
  const position = { id: 'pos_chair', title: 'Chairperson', seats: 1 };
  const student = { status: 'active', classId: 'cls_3a', attendancePct: 92 };

  test('a student in the window may stand', () => {
    expect(canNominate({ phase: 'nominations', position, student }).ok).toBe(true);
  });

  test('outside the window they may not', () => {
    expect(canNominate({ phase: 'voting', position, student }).ok).toBe(false);
  });

  test('one candidacy per election', () => {
    expect(canNominate({ phase: 'nominations', position, student, alreadyCandidate: true }).ok).toBe(false);
  });

  test('class restriction is honoured', () => {
    const restricted = { ...position, eligibleClassIds: ['cls_4b'] };
    expect(canNominate({ phase: 'nominations', position: restricted, student }).ok).toBe(false);
  });

  test('attendance floor is honoured', () => {
    const strict = { ...position, minAttendancePct: 95 };
    expect(canNominate({ phase: 'nominations', position: strict, student }).ok).toBe(false);
  });
});

describe('voting', () => {
  const position = { id: 'pos_chair' };

  test('one vote per seat', () => {
    expect(canVote({ phase: 'voting', position, voterStudentId: 's1', candidateStudentId: 's2', alreadyVoted: false }).ok).toBe(true);
    expect(canVote({ phase: 'voting', position, voterStudentId: 's1', candidateStudentId: 's2', alreadyVoted: true }).ok).toBe(false);
  });

  test('self-voting is refused unless allowed', () => {
    expect(canVote({ phase: 'voting', position, voterStudentId: 's1', candidateStudentId: 's1' }).ok).toBe(false);
    expect(canVote({ phase: 'voting', position, voterStudentId: 's1', candidateStudentId: 's1', allowSelfVote: true }).ok).toBe(true);
  });

  test('voting outside the window is refused', () => {
    expect(canVote({ phase: 'vetting', position, voterStudentId: 's1', candidateStudentId: 's2' }).ok).toBe(false);
  });
});

describe('seat tally', () => {
  const candidates = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

  test('the highest vote count wins a single seat', () => {
    const out = tallySeats({
      candidates, seats: 1,
      votes: [{ candidateId: 'c1' }, { candidateId: 'c1' }, { candidateId: 'c2' }],
    });
    expect(out.winnerIds).toEqual(['c1']);
    expect(out.runoffRequired).toBe(false);
  });

  test('a tie for the last seat is a runoff, never a coin toss', () => {
    const out = tallySeats({
      candidates, seats: 1,
      votes: [{ candidateId: 'c1' }, { candidateId: 'c2' }],
    });
    expect(out.runoffRequired).toBe(true);
    expect(out.winnerIds).toEqual([]);
  });

  test('multiple seats fill in order', () => {
    const out = tallySeats({
      candidates, seats: 2,
      votes: [
        { candidateId: 'c1' }, { candidateId: 'c1' },
        { candidateId: 'c2' }, { candidateId: 'c3' }, { candidateId: 'c3' },
      ],
    });
    expect(out.winnerIds).toEqual(['c1', 'c3']);
  });

  test('zero votes leaves the seat open rather than seating someone', () => {
    const out = tallySeats({ candidates, seats: 1, votes: [] });
    expect(out.winnerIds).toEqual([]);
    expect(out.runoffRequired).toBe(true);
  });
});
