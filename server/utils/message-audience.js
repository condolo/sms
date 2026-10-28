/* ============================================================
   Msingi — Message audience helpers

   One definition of "who is a named person on this message, and did it
   go to more than one of them".

   `recipients` is a mixed list: real userIds for a direct or group send,
   and audience keys ('all', 'teachers', 'parents', 'students', 'staff')
   for a broadcast. Only the userIds are recipients in the sense a reader
   cares about, and every surface that labels a message has to make that
   same cut — so the cut lives here. messages.js owned the list first; the
   portal inbox and thread reads need it too, and a second copy that can
   drift is how an inbox ends up showing a four-person send as a private
   conversation with whichever recipient the grouping happened to pick.
   ============================================================ */

/* ── Role → recipient group mapping ─────────────────────── */
const ROLE_GROUPS = {
  teachers: ['teacher', 'section_head', 'deputy_principal'],
  parents:  ['parent', 'guardian'],
  students: ['student'],
  staff:    ['teacher', 'section_head', 'deputy_principal', 'principal', 'hr',
             'admissions_officer', 'finance', 'exams_officer', 'timetabler',
             'discipline_committee'],
};

/* Anything in `recipients` that is not one of these is a user id. */
const AUDIENCE_KEYS = new Set(['all', ...Object.keys(ROLE_GROUPS)]);

/** The real people a message was addressed to — never 'all', never a role group. */
function namedRecipients(msg) {
  const list = Array.isArray(msg?.recipients) ? msg.recipients : [];
  return list.filter(r => typeof r === 'string' && r && !AUDIENCE_KEYS.has(r));
}

/**
 * How a message should be labelled wherever a human reads it. `groupId` is
 * checked as well as the count: a saved group send to one remaining member is
 * still a group send, and a plain multi-select (a parent writing to the whole
 * Discipline Office) is a multi-person message with no group behind it.
 */
function recipientSummary(msg) {
  const ids = namedRecipients(msg);
  const groupId = msg?.groupId || null;
  return {
    recipientCount: ids.length,
    groupId,
    groupName: msg?.groupName || null,
    multiRecipient: Boolean(groupId) || ids.length > 1,
  };
}

module.exports = { ROLE_GROUPS, AUDIENCE_KEYS, namedRecipients, recipientSummary };
