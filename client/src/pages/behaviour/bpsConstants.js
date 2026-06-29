/* ============================================================
   BPS Constants — Behaviour Point System
   Adapted from SAA BPS v2 — school-agnostic, no houses/KS
   ============================================================ */

/* ── Behaviour Matrix ─────────────────────────────────────── */
export const MATRIX = [
  {
    category: 'Classroom & Academic',
    items: [
      { id: 'ca_m1',  label: 'Outstanding contribution to class discussion',           merit: 2,   demerit: null },
      { id: 'ca_m2',  label: 'Full and focused engagement throughout lesson',          merit: 1,   demerit: null },
      { id: 'ca_m3',  label: 'Exceptional quality of written or practical work',       merit: 3,   demerit: null },
      { id: 'ca_m4',  label: 'Consistent homework completion over a full week',        merit: 2,   demerit: null },
      { id: 'ca_m5',  label: 'Helping a peer understand a concept unprompted',         merit: 2,   demerit: null },
      { id: 'ca_m6',  label: 'Creative or innovative approach to a task',              merit: 3,   demerit: null },
      { id: 'ca_m7',  label: 'Taking an intellectual risk — challenge question',       merit: 2,   demerit: null },
      { id: 'ca_m8',  label: 'Outstanding independent research project',               merit: 4,   demerit: null },
      { id: 'ca_m9',  label: 'Achieving a personal best in an assessment',             merit: 3,   demerit: null },
      { id: 'ca_m10', label: 'Demonstrating strong learning attributes consistently',  merit: 2,   demerit: null },
      { id: 'ca_m11', label: 'Submitting work ahead of deadline, well-presented',      merit: 1,   demerit: null },
      { id: 'ca_m12', label: 'Asking a deep enquiry-based question',                  merit: 1,   demerit: null },
      { id: 'ca_d1',  label: 'Arriving late to class without valid reason',            merit: null, demerit: -1  },
      { id: 'ca_d2',  label: 'Unprepared for lesson (no books or equipment)',          merit: null, demerit: -1  },
      { id: 'ca_d3',  label: 'Off-task, disengaged, or disrupting others',            merit: null, demerit: -2  },
      { id: 'ca_d4',  label: 'Eating or drinking in class without permission',         merit: null, demerit: -1  },
      { id: 'ca_d5',  label: 'Leaving class without permission',                       merit: null, demerit: -2  },
      { id: 'ca_d6',  label: 'Incomplete homework (first instance)',                   merit: null, demerit: -1  },
      { id: 'ca_d7',  label: 'Persistent refusal to engage in learning',              merit: null, demerit: -3  },
      { id: 'ca_d8',  label: 'Writing on or defacing school materials',               merit: null, demerit: -2  },
      { id: 'ca_d9',  label: 'Academic dishonesty (copying or plagiarism)',            merit: null, demerit: -5  },
      { id: 'ca_d10', label: 'Cheating in a formal test or exam',                     merit: null, demerit: -8  },
    ],
  },
  {
    category: 'Corridors & Common Areas',
    items: [
      { id: 'co_m1', label: 'Holding door open or assisting staff unprompted',         merit: 2,   demerit: null },
      { id: 'co_m2', label: 'Picking up litter without being asked',                   merit: 2,   demerit: null },
      { id: 'co_m3', label: 'Representing the school with pride to a visitor',         merit: 3,   demerit: null },
      { id: 'co_m4', label: 'Calm, purposeful movement between lessons',               merit: 1,   demerit: null },
      { id: 'co_m5', label: 'Supporting a peer who appears upset or lost',             merit: 3,   demerit: null },
      { id: 'co_m6', label: 'Reporting a safety hazard to a staff member',             merit: 2,   demerit: null },
      { id: 'co_d1', label: 'Running in corridors or stairwells',                      merit: null, demerit: -1  },
      { id: 'co_d2', label: 'Shouting or excessive noise in corridors',                merit: null, demerit: -1  },
      { id: 'co_d3', label: 'Pushing, jostling, or rough play in corridors',           merit: null, demerit: -2  },
      { id: 'co_d4', label: 'Loitering in restricted areas without permission',        merit: null, demerit: -1  },
      { id: 'co_d5', label: 'Littering in corridors or open areas',                    merit: null, demerit: -2  },
      { id: 'co_d6', label: 'Defacing walls, doors or noticeboards',                   merit: null, demerit: -4  },
      { id: 'co_d7', label: 'Vandalism of school property',                            merit: null, demerit: -8  },
      { id: 'co_d8', label: 'Entering out-of-bounds areas',                            merit: null, demerit: -2  },
    ],
  },
  {
    category: 'Sports, PE & Extracurricular',
    items: [
      { id: 'sp_m1', label: 'Demonstrating sportsmanship and fair play',               merit: 3,   demerit: null },
      { id: 'sp_m2', label: 'Outstanding effort in PE',                                merit: 2,   demerit: null },
      { id: 'sp_m3', label: 'Representing school in a sports competition',             merit: 5,   demerit: null },
      { id: 'sp_m4', label: 'Notable achievement in inter-school competition',         merit: 4,   demerit: null },
      { id: 'sp_m5', label: 'Leading a warm-up or drill when invited',                 merit: 2,   demerit: null },
      { id: 'sp_m6', label: 'Consistent ECA or club attendance (per term)',            merit: 2,   demerit: null },
      { id: 'sp_m7', label: 'Organising or helping run a school event',                merit: 4,   demerit: null },
      { id: 'sp_m8', label: 'Supporting a struggling teammate',                        merit: 2,   demerit: null },
      { id: 'sp_m9', label: 'Mentoring a junior student in sport',                     merit: 4,   demerit: null },
      { id: 'sp_d1', label: 'Repeated failure to bring PE kit',                        merit: null, demerit: -2  },
      { id: 'sp_d2', label: 'Unsportsmanlike conduct — taunting or mocking',           merit: null, demerit: -3  },
      { id: 'sp_d3', label: 'Dangerous play — deliberate fouling',                     merit: null, demerit: -4  },
      { id: 'sp_d4', label: 'Refusing to follow coach instructions',                   merit: null, demerit: -3  },
      { id: 'sp_d5', label: 'Causing deliberate injury during activity',               merit: null, demerit: -8  },
      { id: 'sp_d6', label: 'Leaving premises during activity without permission',     merit: null, demerit: -5  },
      { id: 'sp_d7', label: 'Using sports equipment dangerously unsupervised',         merit: null, demerit: -2  },
      { id: 'sp_d8', label: 'Abusing or damaging sports equipment',                    merit: null, demerit: -4  },
    ],
  },
  {
    category: 'Interpersonal Relationships',
    items: [
      { id: 'ip_m1',  label: 'Resolving a disagreement calmly without staff',          merit: 3,   demerit: null },
      { id: 'ip_m2',  label: 'Standing up for a peer being excluded unfairly',         merit: 4,   demerit: null },
      { id: 'ip_m3',  label: 'Welcoming and supporting a new student',                 merit: 3,   demerit: null },
      { id: 'ip_m4',  label: 'Consistent kindness and consideration over time',        merit: 2,   demerit: null },
      { id: 'ip_m5',  label: 'Proactively reporting a safeguarding concern',           merit: 3,   demerit: null },
      { id: 'ip_m6',  label: 'Acting as peer mentor or academic tutor',                merit: 4,   demerit: null },
      { id: 'ip_m7',  label: 'Treating all staff and visitors with courtesy',          merit: 2,   demerit: null },
      { id: 'ip_m8',  label: 'Contributing positively to a group project',             merit: 2,   demerit: null },
      { id: 'ip_m9',  label: 'Demonstrating empathy during a difficult situation',     merit: 3,   demerit: null },
      { id: 'ip_d1',  label: 'Rude or disrespectful language to a peer',               merit: null, demerit: -2  },
      { id: 'ip_d2',  label: 'Rude or disrespectful language to a staff member',       merit: null, demerit: -4  },
      { id: 'ip_d3',  label: 'Deliberate exclusion or social isolation of a peer',     merit: null, demerit: -3  },
      { id: 'ip_d4',  label: 'Low-level verbal bullying (name-calling)',                merit: null, demerit: -4  },
      { id: 'ip_d5',  label: 'Sustained or repeated bullying',                         merit: null, demerit: -10 },
      { id: 'ip_d6',  label: 'Physical aggression — pushing or shoving (no injury)',   merit: null, demerit: -5  },
      { id: 'ip_d7',  label: 'Physical assault causing injury',                        merit: null, demerit: -15 },
      { id: 'ip_d8',  label: 'Threatening behaviour or intimidation',                  merit: null, demerit: -10 },
      { id: 'ip_d9',  label: 'Cyberbullying or online harassment',                     merit: null, demerit: -10 },
      { id: 'ip_d10', label: 'Discrimination based on race, gender, or religion',      merit: null, demerit: -15 },
      { id: 'ip_d11', label: 'Theft from a peer or the school',                        merit: null, demerit: -10 },
    ],
  },
  {
    category: 'School Rules, Safety & Property',
    items: [
      { id: 'sr_m1',  label: 'Full term of 100% punctuality',                          merit: 5,   demerit: null },
      { id: 'sr_m2',  label: 'Consistently exemplary uniform or dress standard',       merit: 3,   demerit: null },
      { id: 'sr_m3',  label: 'Reporting a safety hazard immediately',                  merit: 2,   demerit: null },
      { id: 'sr_m4',  label: 'Returning borrowed equipment in excellent condition',     merit: 2,   demerit: null },
      { id: 'sr_m5',  label: 'Perfect attendance for a full term',                     merit: 5,   demerit: null },
      { id: 'sr_m6',  label: 'Outstanding conduct on an off-site trip',                merit: 4,   demerit: null },
      { id: 'sr_m7',  label: 'Caring for shared spaces unprompted',                    merit: 1,   demerit: null },
      { id: 'sr_m8',  label: 'Helping set up or clear away for a school event',        merit: 3,   demerit: null },
      { id: 'sr_d1',  label: 'Arriving late to school without valid reason',            merit: null, demerit: -1  },
      { id: 'sr_d2',  label: 'Unauthorised absence from school',                        merit: null, demerit: -3  },
      { id: 'sr_d3',  label: 'Uniform or dress non-compliance (minor)',                 merit: null, demerit: -1  },
      { id: 'sr_d4',  label: 'Persistent uniform non-compliance after warnings',        merit: null, demerit: -3  },
      { id: 'sr_d5',  label: 'Chewing gum on school premises',                         merit: null, demerit: -1  },
      { id: 'sr_d6',  label: 'Littering on school grounds',                            merit: null, demerit: -2  },
      { id: 'sr_d7',  label: 'Using mobile phone in class without permission',          merit: null, demerit: -2  },
      { id: 'sr_d8',  label: 'Bringing a prohibited item to school',                   merit: null, demerit: -4  },
      { id: 'sr_d9',  label: 'Misuse of school digital platforms',                     merit: null, demerit: -4  },
      { id: 'sr_d10', label: 'Leaving premises without authorised exit pass',           merit: null, demerit: -3  },
      { id: 'sr_d11', label: 'Running in or around the school building',               merit: null, demerit: -1  },
      { id: 'sr_d12', label: 'Substance use on premises',                              merit: null, demerit: -15 },
      { id: 'sr_d13', label: 'Possession of dangerous items or weapons',               merit: null, demerit: -15 },
    ],
  },
  {
    category: 'Dining Hall & Shared Spaces',
    items: [
      { id: 'di_m1', label: 'Queuing patiently, allowing younger students first',      merit: 2,   demerit: null },
      { id: 'di_m2', label: 'Clearing table and leaving dining area tidy',             merit: 2,   demerit: null },
      { id: 'di_m3', label: 'Polite and patient with dining or support staff',         merit: 1,   demerit: null },
      { id: 'di_m4', label: 'Assisting a student with difficulty in the queue',        merit: 2,   demerit: null },
      { id: 'di_d1', label: 'Queue jumping or aggressive queuing',                     merit: null, demerit: -2  },
      { id: 'di_d2', label: 'Eating or drinking in class or corridors',                merit: null, demerit: -1  },
      { id: 'di_d3', label: 'Leaving dining area untidy deliberately',                 merit: null, demerit: -2  },
      { id: 'di_d4', label: 'Wasting food deliberately',                               merit: null, demerit: -1  },
      { id: 'di_d5', label: 'Talking to unauthorised strangers at the gate',           merit: null, demerit: -3  },
    ],
  },
  {
    category: 'Digital Citizenship & Technology',
    items: [
      { id: 'dt_m1', label: 'Using school platforms responsibly and helping peers',    merit: 2,   demerit: null },
      { id: 'dt_m2', label: 'Citing AI tools or online sources correctly',             merit: 2,   demerit: null },
      { id: 'dt_m3', label: 'Reporting inappropriate digital content to staff',        merit: 3,   demerit: null },
      { id: 'dt_m4', label: 'Producing a creative digital project beyond minimum',     merit: 3,   demerit: null },
      { id: 'dt_m5', label: 'Responsible use of technology in a class project',        merit: 2,   demerit: null },
      { id: 'dt_d1', label: 'Using device for non-academic purposes in lessons',       merit: null, demerit: -2  },
      { id: 'dt_d2', label: 'Accessing inappropriate websites on school network',      merit: null, demerit: -4  },
      { id: 'dt_d3', label: 'Recording staff or students without consent',             merit: null, demerit: -5  },
      { id: 'dt_d4', label: 'Sharing another student\'s image without consent',        merit: null, demerit: -8  },
      { id: 'dt_d5', label: 'Cyberbullying (digital)',                                 merit: null, demerit: -10 },
      { id: 'dt_d6', label: 'Bypassing school internet filter or firewall',            merit: null, demerit: -5  },
      { id: 'dt_d7', label: 'Submitting unacknowledged AI-generated work',             merit: null, demerit: -5  },
    ],
  },
  {
    category: 'Leadership & Community Service',
    items: [
      { id: 'lc_m1', label: 'Holding a school leadership role (per term)',             merit: 10,  demerit: null },
      { id: 'lc_m2', label: 'Organising or leading a school event or charity drive',  merit: 6,   demerit: null },
      { id: 'lc_m3', label: 'Completing a structured community service project',       merit: 8,   demerit: null },
      { id: 'lc_m4', label: 'Leading a presentation at assembly',                     merit: 4,   demerit: null },
      { id: 'lc_m5', label: 'Serving as Student Ambassador or school tour guide',     merit: 4,   demerit: null },
      { id: 'lc_m6', label: 'Contributing to the school newsletter or magazine',       merit: 3,   demerit: null },
      { id: 'lc_m7', label: 'Notable result in a national or international competition', merit: 8, demerit: null },
      { id: 'lc_m8', label: 'Senior Year Peer Mentor (per term)',                     merit: 6,   demerit: null },
      { id: 'lc_m9', label: 'Initiating an environmental or sustainability project',   merit: 6,   demerit: null },
    ],
  },
];

/* ── Intervention Stages (demerit pts in rolling 90-day window) ── */
export const STAGES = [
  { pts: 5,  stage: 1, label: 'Stage 1 — Verbal Check-in',        color: '#f59e0b', bg: '#fffbeb', who: 'Class Teacher'         },
  { pts: 10, stage: 2, label: 'Stage 2 — Formal Review',          color: '#f97316', bg: '#fff7ed', who: 'Head of Year / Coordinator' },
  { pts: 20, stage: 3, label: 'Stage 3 — Behaviour Support Plan', color: '#ef4444', bg: '#fef2f2', who: 'Senior Staff'           },
  { pts: 35, stage: 4, label: 'Stage 4 — Leadership Referral',    color: '#dc2626', bg: '#fef2f2', who: 'Deputy / Principal'     },
  { pts: 50, stage: 5, label: 'Stage 5 — Disciplinary Panel',     color: '#7f1d1d', bg: '#fef2f2', who: 'Principal / Committee'  },
];

/* ── Merit Milestones (all-time cumulative merit pts) ─────────── */
export const MILESTONES = [
  { pts: 25,  badge: 'Bronze',            color: '#92400e', ring: '#d97706' },
  { pts: 50,  badge: 'Silver',            color: '#475569', ring: '#94a3b8' },
  { pts: 100, badge: 'Gold',              color: '#b45309', ring: '#fbbf24' },
  { pts: 200, badge: 'Principal\'s Award',color: '#7c3aed', ring: '#a78bfa' },
  { pts: 300, badge: 'Platinum',          color: '#0e7490', ring: '#22d3ee' },
];

/* ── Helpers ───────────────────────────────────────────────────── */

/** Sum all-time merit points for a student (overturned excluded) */
export function meritTotal(logs, sid) {
  return logs
    .filter(l => l.studentId === sid && l.type === 'merit' && l.status !== 'overturned')
    .reduce((s, l) => s + (l.points ?? 0), 0);
}

/** Sum demerit points (absolute value) in the last 90 days */
export function demeritTotal(logs, sid) {
  const since = Date.now() - 90 * 24 * 60 * 60 * 1000;
  return Math.abs(
    logs
      .filter(l =>
        l.studentId === sid &&
        l.type === 'demerit' &&
        l.status !== 'overturned' &&
        l.status !== 'appealing' &&
        new Date(l.date || l.createdAt || 0).getTime() >= since
      )
      .reduce((s, l) => s + (l.points ?? 0), 0)
  );
}

/** Current intervention stage for a student (null if none) */
export function studentStage(logs, sid) {
  const d = demeritTotal(logs, sid);
  return [...STAGES].reverse().find(s => d >= s.pts) ?? null;
}

/** Current milestone for a student (null if below Bronze) */
export function studentMilestone(logs, sid) {
  const m = meritTotal(logs, sid);
  return [...MILESTONES].reverse().find(ms => m >= ms.pts) ?? null;
}

/** Next milestone target (null if at Platinum) */
export function nextMilestone(logs, sid) {
  const m = meritTotal(logs, sid);
  return MILESTONES.find(ms => ms.pts > m) ?? null;
}

/** Look up matrix item label by ID */
export function matrixLabel(id) {
  for (const cat of MATRIX) {
    const item = cat.items.find(i => i.id === id);
    if (item) return item.label;
  }
  return id ?? '—';
}

/** Look up full matrix item by ID */
export function matrixItem(id) {
  for (const cat of MATRIX) {
    const item = cat.items.find(i => i.id === id);
    if (item) return item;
  }
  return null;
}

/** Determine if an incident requires a mandatory note (serious = |pts| >= 5) */
export function isSerious(pts) {
  return pts !== null && Math.abs(pts) >= 5;
}
