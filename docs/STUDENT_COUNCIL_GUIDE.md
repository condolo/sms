# Msingi — Student Council Guide

**Audience:** School administrators setting up the Student Council, the staff patron overseeing it, teachers with the read-only feed, and student council members. Student feedback can contain sensitive personal information; handle it within your school responsibility and follow the school's safeguarding process for anything urgent.

## 1. What the module is

The Student Council is a feedback desk run by students and overseen by a staff patron:

- **Students** file suggestions and grievances, upvote each other's ideas, follow the council's replies, and stand and vote in council elections.
- **Council members** (students) triage cases: claim, reply (including internal notes), resolve, close, escalate, and merge duplicates.
- **The patron** (school staff) sees every case with identities, handles safeguarding cases, appoints members, and runs elections.
- **Teachers** (non-patron staff with view permission) get a read-only staff feed with identities masked.

Students do **not** set the council up. The school enables the module, forms the council, and grants access.

## 2. Setup checklist (school admin)

1. **Enable the module.** Settings → Modules → Student Council. It is enabled by default; a school can switch it off, which removes the nav entry and 403s the API.
2. **Choose the patron.** The Admin, Principal and Deputy Principal roles are patrons automatically. No extra grant is needed for them.
3. **Grant role permissions.** Settings → Roles & Permissions → Student Council:
   - **View Cases & Council Queue** — non-patron staff get the read-only staff feed; patrons also need it for the console's read side.
   - **Triage, Resolve or Escalate Cases** — the patron console and case decisions. For a non-patron role (e.g. a counselor), this sub-grant opens the full console.
   - **Run Elections & Vet Candidates** — create elections, approve/reject candidates, close and publish results.
   - **Appoint Council Members** — appoint or remove members directly.
4. **Form the council** — appoint members (Section 3) or run an election (Section 4).

## 3. Appoint council members

1. Open **Student Council → Members**.
2. Click **Appoint**, search for an active student by name or admission number, and confirm the right student.
3. Enter the position title (e.g. "Chairperson", "Class Representative") and save.
4. Appointed members immediately get the council queue on their own Student Council page.

Remove a member from the same tab when their term ends. Appointments and removals are audited.

## 4. Run an election

1. Open **Student Council → Elections → New Election**.
2. Set a title, term label, nomination dates, voting dates, and each position with its number of seats. Optionally restrict positions to eligible classes and a minimum attendance percentage.
3. During **nominations**, students stand for a position from their own Student Council page.
4. During **vetting**, the patron approves or rejects each candidacy from the election panel.
5. During **voting**, each student casts one secret ballot per seat. Votes are unique per student per position.
6. **Close** the election. Msingi tallies the votes, publishes the results, and seats the winners as council members automatically. A runoff is flagged where required.

## 5. How students use it

Students open **Student Council** from their dashboard (megaphone icon) or `/student-council`:

- **Have your say** — file a Suggestion or Grievance: category, title, details. Two flags:
  - **Post anonymously** — hides the student's name *and class* from other students and from council members. School staff (the patron) always see who filed it; this is what makes safety follow-ups possible.
  - **This involves a council member or the council patron** — keeps the case with staff only until the patron decides who handles it.
- **My cases** — the thread with the council's replies; reply (which reopens a resolved case) or withdraw while the case is still open, under review or escalated.
- **Suggestions** — the school-wide ideas wall, ranked by upvotes; one vote per student per suggestion, and students cannot upvote their own.
- **Elections** — stand for a seat and vote when the school opens an election.

## 6. Safeguarding rules

- Filing under the **Safety** category, or any message containing disclosure keywords (abuse, assault, bullying, threats, self-harm and similar), escalates the case to the patron immediately.
- Council members cannot close or merge a safeguarding case; only school staff can decide it.
- Safeguarding and patron-held (sensitive) cases never appear in the student queue or the teacher feed.
- Anonymous cases are still fully visible to the patron with the reporter's identity. The anonymity promise applies to students and council members, not to staff.

## 7. What teachers see (read-only feed)

Teachers granted only **View Cases & Council Queue** see a read-only staff feed at `/council`:

- Every non-sensitive, non-safeguarding case with its status, category, upvotes and public replies.
- Reporter names are masked ("Student" / "Anonymous"); an anonymous case does not even reveal the class.
- Internal council notes are never included.
- No actions: no replies, no status changes, no assignments.

The full patron console (identities, triage, elections, members) requires a patron role or the **Triage, Resolve or Escalate Cases** grant. Case identity reads and decisions are guarded accordingly.

## 8. FAQ

**Where is the council set up?**
In the web console, as a school admin (Section 2). Students only use it.

**Do students need a separate app or login?**
No. Students use the same school login; the council appears as a page on the web and in the mobile app.

**Can a teacher reply to a case?**
Not from the read-only feed. Give the role the **Triage, Resolve or Escalate Cases** permission (or use a patron role) if a teacher should work cases.

**Can a student take back a case?**
Yes — they can withdraw their own case while it is open, under review or escalated. Merged and withdrawn cases are final.

**Are anonymous cases truly anonymous?**
To other students and to the student council, yes — name and class are hidden. The staff patron can always see the reporter; this is deliberate and is explained to students in the form.

**What happens to old cases?**
Merged cases point to the case they were folded into. Resolved, closed and withdrawn cases stay readable in the reporter's "My cases" and in the patron console.
