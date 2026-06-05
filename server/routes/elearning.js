/* ============================================================
   eLearning — Google Classroom + Zoom Live Sessions
   All academic content lives in Google Classroom / Google Drive.
   Live sessions are created via Zoom Server-to-Server OAuth.
   Msingi stores: OAuth tokens, course links, coursework IDs,
   grade cache, and live session records.

   Google Classroom routes:
   GET  /api/elearning/auth/connect       — start GC OAuth flow
   GET  /api/elearning/auth/callback      — OAuth callback, store tokens
   GET  /api/elearning/auth/status        — check connection + whoami
   DELETE /api/elearning/auth/disconnect  — revoke + delete tokens
   GET  /api/elearning/gc/courses         — list teacher's GC courses
   GET  /api/elearning/courses            — list linked courses
   POST /api/elearning/courses/link       — link GC course to class/subject
   DELETE /api/elearning/courses/:id      — unlink course
   GET/POST/DELETE /api/elearning/courses/:id/coursework
   POST /api/elearning/gc-webhook         — Google Pub/Sub grade push

   Zoom Live Session routes:
   GET  /api/elearning/zoom/status                    — Zoom configured?
   GET  /api/elearning/courses/:id/sessions           — list sessions
   POST /api/elearning/courses/:id/sessions           — schedule meeting
   GET  /api/elearning/sessions/:sessionId            — session detail
   PATCH /api/elearning/sessions/:sessionId           — update session
   DELETE /api/elearning/sessions/:sessionId          — cancel meeting
   POST /api/elearning/zoom-webhook                   — Zoom event webhooks
   ============================================================ */
const express        = require('express');
const crypto         = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');

const router = express.Router();

/* ── Google OAuth constants ─────────────────────────────────── */
const GC_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events',  // for Google Meet session creation
].join(' ');

function _gcRedirectUri() {
  const base = process.env.PUBLIC_URL || 'http://localhost:3005';
  return `${base}/api/elearning/auth/callback`;
}

/* ── Token helpers ──────────────────────────────────────────── */
async function _getToken(userId) {
  const Tokens = _model('elearning_tokens');
  return Tokens.findOne({ userId }).lean();
}

async function _refreshIfNeeded(tokenDoc) {
  if (!tokenDoc) return null;
  const expiresAt = new Date(tokenDoc.expiresAt).getTime();
  // Refresh if expiring within 5 minutes
  if (Date.now() < expiresAt - 5 * 60_000) return tokenDoc;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokenDoc.googleRefreshToken,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  });
  const json = await res.json();
  if (!json.access_token) return null;

  const updated = {
    googleAccessToken: json.access_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
  const Tokens = _model('elearning_tokens');
  await Tokens.updateOne({ userId: tokenDoc.userId }, { $set: updated });
  return { ...tokenDoc, ...updated };
}

async function _gcFetch(tokenDoc, path, opts = {}) {
  const fresh = await _refreshIfNeeded(tokenDoc);
  if (!fresh) throw new Error('Google token expired. Please reconnect your account.');
  const res = await fetch(`https://classroom.googleapis.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${fresh.googleAccessToken}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Google Classroom API error ${res.status}`);
  }
  return res.json();
}

async function _driveFetch(tokenDoc, path, opts = {}) {
  const fresh = await _refreshIfNeeded(tokenDoc);
  if (!fresh) throw new Error('Google token expired. Please reconnect your account.');
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${fresh.googleAccessToken}`,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Google Drive API error ${res.status}`);
  }
  return res.json();
}

/* ══════════════════════════════════════════════════════════════
   OAUTH FLOW
   ══════════════════════════════════════════════════════════════ */

/* GET /api/elearning/auth/connect — redirect teacher to Google */
router.get('/auth/connect', authMiddleware, (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'Google OAuth not configured.' });

  const state = Buffer.from(JSON.stringify({
    userId:   req.jwtUser.userId,
    schoolId: req.jwtUser.schoolId,
  })).toString('base64');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',     clientId);
  url.searchParams.set('redirect_uri',  _gcRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope',         GC_SCOPES);
  url.searchParams.set('access_type',   'offline');
  url.searchParams.set('prompt',        'consent');   // always get refresh_token
  url.searchParams.set('state',         state);

  res.redirect(url.toString());
});

/* GET /api/elearning/auth/callback — exchange code, store tokens */
router.get('/auth/callback', async (req, res) => {
  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5173';
  const { code, state, error: oauthError } = req.query;

  if (oauthError || !code) {
    return res.redirect(`${publicUrl}/elearning?gc_error=denied`);
  }

  let stateData;
  try { stateData = JSON.parse(Buffer.from(state, 'base64').toString()); }
  catch { return res.redirect(`${publicUrl}/elearning?gc_error=invalid_state`); }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  _gcRedirectUri(),
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token');

    // Fetch user's Google profile to confirm it's a Workspace account
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    const Tokens = _model('elearning_tokens');
    await Tokens.updateOne(
      { userId: stateData.userId },
      {
        $set: {
          userId:              stateData.userId,
          schoolId:            stateData.schoolId,
          googleAccessToken:   tokens.access_token,
          googleRefreshToken:  tokens.refresh_token,
          googleEmail:         profile.email,
          googleName:          profile.name,
          expiresAt:           new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
          connectedAt:         new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    res.redirect(`${publicUrl}/elearning?gc_connected=1`);
  } catch (err) {
    console.error('[elearning/auth/callback]', err);
    res.redirect(`${publicUrl}/elearning?gc_error=failed`);
  }
});

/* GET /api/elearning/auth/status */
router.get('/auth/status', authMiddleware, async (req, res) => {
  try {
    const tok = await _getToken(req.jwtUser.userId);
    if (!tok) return res.json({ connected: false });
    res.json({
      connected:   true,
      googleEmail: tok.googleEmail,
      googleName:  tok.googleName,
      connectedAt: tok.connectedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/elearning/auth/disconnect */
router.delete('/auth/disconnect', authMiddleware, async (req, res) => {
  try {
    const Tokens = _model('elearning_tokens');
    await Tokens.deleteOne({ userId: req.jwtUser.userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   GOOGLE CLASSROOM — COURSE LISTING & LINKING
   ══════════════════════════════════════════════════════════════ */

/* GET /api/elearning/gc/courses — fetch courses from Google Classroom */
router.get('/gc/courses', authMiddleware, async (req, res) => {
  try {
    const tok = await _getToken(req.jwtUser.userId);
    if (!tok) return res.status(403).json({ error: 'Google Classroom not connected.' });

    const data = await _gcFetch(tok, '/v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=50');
    res.json({ courses: data.courses || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/elearning/courses — list courses linked in Msingi */
router.get('/courses', authMiddleware, async (req, res) => {
  try {
    const Links = _model('elearning_course_links');
    const links = await Links.find({
      schoolId: req.jwtUser.schoolId,
      teacherId: req.jwtUser.userId,
    }).lean();
    res.json({ courses: links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/elearning/courses/link — link a GC course to a Msingi class + subject */
router.post('/courses/link', authMiddleware, async (req, res) => {
  try {
    const { gcCourseId, gcCourseName, subjectId, classId, className, subjectName } = req.body;
    if (!gcCourseId || !subjectId || !classId) {
      return res.status(400).json({ error: 'gcCourseId, subjectId, classId required.' });
    }

    const Links = _model('elearning_course_links');
    await Links.updateOne(
      { schoolId: req.jwtUser.schoolId, gcCourseId },
      {
        $set: {
          schoolId:    req.jwtUser.schoolId,
          teacherId:   req.jwtUser.userId,
          gcCourseId,
          gcCourseName,
          subjectId,
          subjectName,
          classId,
          className,
          linkedAt:    new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    const doc = await Links.findOne({ schoolId: req.jwtUser.schoolId, gcCourseId }).lean();
    res.json({ success: true, course: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/elearning/courses/:id — unlink a course */
router.delete('/courses/:id', authMiddleware, async (req, res) => {
  try {
    const Links = _model('elearning_course_links');
    await Links.deleteOne({ _id: req.params.id, schoolId: req.jwtUser.schoolId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   CLASSWORK — CREATE / LIST / DELETE
   ══════════════════════════════════════════════════════════════ */

/* GET /api/elearning/courses/:id/coursework — list coursework from GC */
router.get('/courses/:id/coursework', authMiddleware, async (req, res) => {
  try {
    const tok = await _getToken(req.jwtUser.userId);
    if (!tok) return res.status(403).json({ error: 'Google Classroom not connected.' });

    const data = await _gcFetch(tok, `/v1/courses/${req.params.id}/courseWork?orderBy=updateTime%20desc&pageSize=50`);
    res.json({ coursework: data.courseWork || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/elearning/courses/:id/coursework — create assignment / material in GC
   Body:
   {
     type: 'ASSIGNMENT' | 'SHORT_ANSWER_QUESTION' | 'MATERIAL',
     title: string,
     description: string,
     dueDate: 'YYYY-MM-DD',        // optional
     dueTime: 'HH:MM',             // optional
     scheduledTime: ISO string,    // optional — when to publish
     maxPoints: number,            // optional
     assigneeMode: 'ALL_STUDENTS' | 'INDIVIDUAL_STUDENTS',
     individualStudentsIds: [gcStudentId, ...],  // if INDIVIDUAL_STUDENTS
     driveFileId: string,          // optional — pre-uploaded Drive file ID
     driveFileName: string,
   }
*/
router.post('/courses/:id/coursework', authMiddleware, async (req, res) => {
  try {
    const tok = await _getToken(req.jwtUser.userId);
    if (!tok) return res.status(403).json({ error: 'Google Classroom not connected.' });

    const {
      type = 'ASSIGNMENT',
      title,
      description,
      dueDate,
      dueTime,
      scheduledTime,
      maxPoints,
      assigneeMode = 'ALL_STUDENTS',
      individualStudentIds = [],
      driveFileId,
      driveFileName,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'title is required.' });

    const body = {
      title,
      description,
      workType: type,
      state: scheduledTime ? 'DRAFT' : 'PUBLISHED',
    };

    if (scheduledTime) body.scheduledTime = scheduledTime;
    if (maxPoints)     body.maxPoints = Number(maxPoints);

    if (dueDate) {
      const [year, month, day] = dueDate.split('-').map(Number);
      body.dueDate = { year, month, day };
      if (dueTime) {
        const [hours, minutes] = dueTime.split(':').map(Number);
        body.dueTime = { hours, minutes, seconds: 0, nanos: 0 };
      }
    }

    if (assigneeMode === 'INDIVIDUAL_STUDENTS' && individualStudentIds.length) {
      body.assigneeMode = 'INDIVIDUAL_STUDENTS';
      body.individualStudentsOptions = { studentIds: individualStudentIds };
    }

    if (driveFileId) {
      body.materials = [{
        driveFile: {
          driveFile: { id: driveFileId, title: driveFileName || 'Attachment' },
          shareMode: 'VIEW',
        },
      }];
    }

    const cw = await _gcFetch(tok, `/v1/courses/${req.params.id}/courseWork`, {
      method: 'POST',
      body,
    });

    // Store link in Msingi so grade webhook can resolve it
    const CwLinks = _model('elearning_coursework_links');
    await CwLinks.insertOne({
      schoolId:        req.jwtUser.schoolId,
      gcCourseId:      req.params.id,
      gcCourseWorkId:  cw.id,
      gcCourseWorkTitle: cw.title,
      type:            cw.workType,
      dueDate:         dueDate || null,
      maxScore:        maxPoints || cw.maxPoints || null,
      createdBy:       req.jwtUser.userId,
      createdAt:       new Date().toISOString(),
    });

    res.json({ success: true, coursework: cw });
  } catch (err) {
    console.error('[elearning/coursework POST]', err);
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/elearning/courses/:id/coursework/:cwId */
router.delete('/courses/:id/coursework/:cwId', authMiddleware, async (req, res) => {
  try {
    const tok = await _getToken(req.jwtUser.userId);
    if (!tok) return res.status(403).json({ error: 'Google Classroom not connected.' });

    await _gcFetch(tok, `/v1/courses/${req.params.id}/courseWork/${req.params.cwId}`, {
      method: 'DELETE',
    });

    const CwLinks = _model('elearning_coursework_links');
    await CwLinks.deleteOne({ gcCourseId: req.params.id, gcCourseWorkId: req.params.cwId });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   DRIVE — upload file, return Drive file ID
   Teacher uploads PDF → Msingi streams to Drive → returns fileId
   fileId is then attached to coursework creation above
   ══════════════════════════════════════════════════════════════ */

/* POST /api/elearning/drive/upload
   Body: multipart — field "file" (the raw file)
   Returns: { fileId, fileName, webViewLink }
*/
router.post('/drive/upload', authMiddleware, async (req, res) => {
  try {
    const tok = await _getToken(req.jwtUser.userId);
    if (!tok) return res.status(403).json({ error: 'Google Classroom not connected.' });

    const fresh = await _refreshIfNeeded(tok);
    if (!fresh) return res.status(403).json({ error: 'Google token expired. Please reconnect.' });

    // Collect raw body (file sent as base64 JSON for simplicity)
    const { fileBase64, fileName, mimeType } = req.body;
    if (!fileBase64 || !fileName) return res.status(400).json({ error: 'fileBase64 and fileName required.' });

    const fileBuffer = Buffer.from(fileBase64.split(',').pop(), 'base64');
    const fileMime   = mimeType || 'application/octet-stream';

    // Multipart upload to Google Drive
    const boundary = 'msingi_upload_boundary';
    const metaPart = JSON.stringify({ name: fileName });
    const body     = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metaPart}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${fileMime}\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${fresh.googleAccessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
        body,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Drive upload failed ${uploadRes.status}`);
    }

    const file = await uploadRes.json();
    res.json({ success: true, fileId: file.id, fileName: file.name, webViewLink: file.webViewLink });
  } catch (err) {
    console.error('[elearning/drive/upload]', err);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   STUDENT SUBMISSIONS & GRADES (read from GC)
   ══════════════════════════════════════════════════════════════ */

/* GET /api/elearning/courses/:id/coursework/:cwId/submissions */
router.get('/courses/:id/coursework/:cwId/submissions', authMiddleware, async (req, res) => {
  try {
    const tok = await _getToken(req.jwtUser.userId);
    if (!tok) return res.status(403).json({ error: 'Google Classroom not connected.' });

    const data = await _gcFetch(
      tok,
      `/v1/courses/${req.params.id}/courseWork/${req.params.cwId}/studentSubmissions?pageSize=100`
    );
    res.json({ submissions: data.studentSubmissions || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   GRADE WEBHOOK — Google Pub/Sub push
   Google posts here when a submission is graded in GC.
   We extract the grade and write it to the Msingi Grades module.
   ══════════════════════════════════════════════════════════════ */

/* POST /api/elearning/gc-webhook */
router.post('/gc-webhook', async (req, res) => {
  try {
    // Google Pub/Sub sends: { message: { data: base64, messageId, publishTime } }
    const rawData = req.body?.message?.data;
    if (!rawData) return res.sendStatus(204);

    let notification;
    try {
      notification = JSON.parse(Buffer.from(rawData, 'base64').toString());
    } catch {
      return res.sendStatus(204);
    }

    // Notification shape: { courseId, courseWorkId, userId, changeType }
    const { courseId, courseWorkId, userId: gcStudentId } = notification;
    if (!courseId || !courseWorkId || !gcStudentId) return res.sendStatus(204);

    // Find the coursework link to get schoolId + maxScore
    const CwLinks = _model('elearning_coursework_links');
    const cwLink  = await CwLinks.findOne({ gcCourseId: courseId, gcCourseWorkId: courseWorkId }).lean();
    if (!cwLink) return res.sendStatus(204);

    // Find the school's token to query submission details
    const Tokens  = _model('elearning_tokens');
    const tok     = await Tokens.findOne({ schoolId: cwLink.schoolId }).lean();
    if (!tok) return res.sendStatus(204);

    // Fetch submission to get the grade
    const fresh = await _refreshIfNeeded(tok);
    if (!fresh) return res.sendStatus(204);

    const subRes = await fetch(
      `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?userId=${gcStudentId}`,
      { headers: { Authorization: `Bearer ${fresh.googleAccessToken}` } }
    );
    const subData = await subRes.json();
    const sub = subData?.studentSubmissions?.[0];
    if (!sub?.assignedGrade && sub?.assignedGrade !== 0) return res.sendStatus(204);

    // Resolve Msingi student by Google email
    const Users   = _model('users');
    const student = await Users.findOne({ schoolId: cwLink.schoolId, googleId: gcStudentId }).lean();
    if (!student) return res.sendStatus(204);

    // Find course link to get subjectId + classId
    const CourseLinks = _model('elearning_course_links');
    const courseLink  = await CourseLinks.findOne({ gcCourseId: courseId, schoolId: cwLink.schoolId }).lean();

    // Write / update grade in Msingi Grades module
    const Grades = _model('grades');
    await Grades.updateOne(
      {
        schoolId:       cwLink.schoolId,
        studentId:      student.id,
        gcCourseWorkId: courseWorkId,
      },
      {
        $set: {
          schoolId:       cwLink.schoolId,
          studentId:      student.id,
          subjectId:      courseLink?.subjectId || null,
          classId:        courseLink?.classId   || null,
          gcCourseId:     courseId,
          gcCourseWorkId: courseWorkId,
          title:          cwLink.gcCourseWorkTitle,
          type:           'elearning_assignment',
          score:          sub.assignedGrade,
          maxScore:       cwLink.maxScore || sub.maxPoints,
          source:         'google_classroom',
          autoSynced:     true,
          gradedAt:       new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    res.sendStatus(204);
  } catch (err) {
    console.error('[elearning/gc-webhook]', err);
    res.sendStatus(204); // always 204 to Google so it doesn't retry
  }
});

/* GET /api/elearning/gc/students/:courseId — list students in a GC course */
router.get('/gc/students/:courseId', authMiddleware, async (req, res) => {
  try {
    const tok = await _getToken(req.jwtUser.userId);
    if (!tok) return res.status(403).json({ error: 'Google Classroom not connected.' });

    const data = await _gcFetch(tok, `/v1/courses/${req.params.courseId}/students?pageSize=100`);
    res.json({ students: data.students || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   GOOGLE MEET — via Google Calendar API
   Uses the teacher's existing GC OAuth token (calendar.events scope).
   Creates a calendar event with conferenceData → Google generates
   the Meet link automatically. Same link for teacher + students.
   ══════════════════════════════════════════════════════════════ */

async function _createMeetSession({ tok, title, agenda, scheduledAt, duration, teacherEmail, attendeeEmails = [] }) {
  const fresh = await _refreshIfNeeded(tok);
  if (!fresh) throw new Error('Google token expired. Please reconnect your account.');

  const startDt = new Date(scheduledAt);
  const endDt   = new Date(startDt.getTime() + duration * 60_000);

  // ISO with timezone offset for East Africa (UTC+3)
  function toCalDt(d) {
    return { dateTime: d.toISOString(), timeZone: 'Africa/Nairobi' };
  }

  const body = {
    summary:     title,
    description: agenda || '',
    start:       toCalDt(startDt),
    end:         toCalDt(endDt),
    conferenceData: {
      createRequest: {
        requestId:            `msingi-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    attendees: [
      { email: teacherEmail, organizer: true },
      ...attendeeEmails.map(e => ({ email: e })),
    ],
  };

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none',
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${fresh.googleAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `Google Calendar API error ${res.status}`;
    if (res.status === 403 && msg.toLowerCase().includes('insufficient')) {
      throw new Error('Calendar permission missing. Please disconnect and reconnect your Google account to grant Calendar access.');
    }
    throw new Error(msg);
  }

  const event = await res.json();
  const meetLink = event.hangoutLink ||
    event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;

  if (!meetLink) throw new Error('Google did not return a Meet link. Make sure your Workspace plan supports Google Meet.');

  return { eventId: event.id, meetLink };
}

async function _deleteMeetSession({ tok, eventId }) {
  const fresh = await _refreshIfNeeded(tok);
  if (!fresh) return; // best-effort
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=none`,
    {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${fresh.googleAccessToken}` },
    }
  );
}

/* ══════════════════════════════════════════════════════════════
   ZOOM — SERVER-TO-SERVER OAUTH + LIVE SESSIONS
   Env vars required:
     ZOOM_ACCOUNT_ID     — from Zoom Marketplace app
     ZOOM_CLIENT_ID      — Server-to-Server OAuth client ID
     ZOOM_CLIENT_SECRET  — Server-to-Server OAuth client secret
     ZOOM_WEBHOOK_SECRET — from Zoom Webhook configuration (for verification)
   ══════════════════════════════════════════════════════════════ */

/* ── In-memory Zoom token cache (1-hour TTL) ─────────────────── */
let _zoomToken     = null;
let _zoomTokenExp  = 0;

async function _getZoomToken() {
  if (_zoomToken && Date.now() < _zoomTokenExp - 60_000) return _zoomToken;

  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('Zoom is not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET.');
  }

  const creds = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  const res   = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    { method: 'POST', headers: { Authorization: `Basic ${creds}` } }
  );
  const json = await res.json();
  if (!json.access_token) throw new Error('Failed to get Zoom access token.');

  _zoomToken    = json.access_token;
  _zoomTokenExp = Date.now() + (json.expires_in ?? 3600) * 1000;
  return _zoomToken;
}

async function _zoomFetch(path, opts = {}) {
  const token = await _getZoomToken();
  const res   = await fetch(`https://api.zoom.us/v2${path}`, {
    ...opts,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204 || res.status === 200 && opts.method === 'DELETE') return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Zoom API error ${res.status}`);
  return json;
}

/* Verify Zoom webhook signature */
function _verifyZoomWebhook(req) {
  const secret    = process.env.ZOOM_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev
  const ts        = req.headers['x-zm-request-timestamp'] || '';
  const sig       = req.headers['x-zm-signature']          || '';
  const rawBody   = JSON.stringify(req.body);
  const message   = `v0:${ts}:${rawBody}`;
  const expected  = `v0=${crypto.createHmac('sha256', secret).update(message).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/* ── Zoom status ─────────────────────────────────────────────── */
router.get('/zoom/status', authMiddleware, (req, res) => {
  const configured = !!(
    process.env.ZOOM_ACCOUNT_ID &&
    process.env.ZOOM_CLIENT_ID  &&
    process.env.ZOOM_CLIENT_SECRET
  );
  res.json({ configured });
});

/* ── List sessions for a course ──────────────────────────────── */
router.get('/courses/:id/sessions', authMiddleware, async (req, res) => {
  try {
    const Sessions = _model('elearning_sessions');
    const sessions = await Sessions.find({
      schoolId:  req.jwtUser.schoolId,
      gcCourseId: req.params.id,
    }).sort({ scheduledAt: -1 }).lean();
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Schedule a session (Zoom or Google Meet) ────────────────── */
/* POST /api/elearning/courses/:id/sessions
   Body: { platform: 'zoom'|'meet', title, scheduledAt, duration, agenda }
*/
router.post('/courses/:id/sessions', authMiddleware, async (req, res) => {
  try {
    const { platform = 'zoom', title, scheduledAt, duration = 60, agenda = '' } = req.body;
    if (!title || !scheduledAt) {
      return res.status(400).json({ error: 'title and scheduledAt are required.' });
    }

    const Users   = _model('users');
    const teacher = await Users.findOne({ id: req.jwtUser.userId }).lean();

    const CourseLinks = _model('elearning_course_links');
    const courseLink  = await CourseLinks.findOne({
      gcCourseId: req.params.id, schoolId: req.jwtUser.schoolId,
    }).lean();

    const id  = `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const doc = {
      id,
      schoolId:   req.jwtUser.schoolId,
      gcCourseId: req.params.id,
      teacherId:  req.jwtUser.userId,
      subjectId:  courseLink?.subjectId || null,
      classId:    courseLink?.classId   || null,
      title,
      agenda,
      scheduledAt,
      duration:   Number(duration),
      platform,
      status:     'scheduled',
      attendees:  [],
      recordingUrl: null,
      createdAt:  new Date().toISOString(),
    };

    if (platform === 'meet') {
      /* ── Google Meet via Calendar API ── */
      const tok = await _getToken(req.jwtUser.userId);
      if (!tok) return res.status(403).json({ error: 'Google account not connected.' });

      const { eventId, meetLink } = await _createMeetSession({
        tok,
        title,
        agenda,
        scheduledAt,
        duration: Number(duration),
        teacherEmail: teacher?.email || tok.googleEmail,
      });

      doc.meetEventId = eventId;
      doc.meetLink    = meetLink;   // same link for teacher + students

    } else {
      /* ── Zoom via Server-to-Server OAuth ── */
      const hostEmail = teacher?.email || 'me';
      const meeting   = await _zoomFetch(`/users/${encodeURIComponent(hostEmail)}/meetings`, {
        method: 'POST',
        body: {
          topic:      title,
          type:       2,
          start_time: new Date(scheduledAt).toISOString().replace('.000Z', 'Z'),
          duration:   Number(duration),
          timezone:   'Africa/Nairobi',
          agenda,
          settings: {
            host_video:        true,
            participant_video: true,
            join_before_host:  false,
            waiting_room:      true,
            mute_upon_entry:   true,
            auto_recording:    'cloud',
          },
        },
      });

      doc.zoomMeetingId = String(meeting.id);
      doc.zoomHostUrl   = meeting.start_url;
      doc.zoomJoinUrl   = meeting.join_url;
      doc.zoomPassword  = meeting.password;
    }

    const Sessions = _model('elearning_sessions');
    await Sessions.insertOne(doc);

    res.json({ success: true, session: doc });
  } catch (err) {
    console.error('[elearning/sessions POST]', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── Get single session ──────────────────────────────────────── */
router.get('/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const Sessions = _model('elearning_sessions');
    const session  = await Sessions.findOne({
      id:       req.params.sessionId,
      schoolId: req.jwtUser.schoolId,
    }).lean();
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Update session (reschedule) ─────────────────────────────── */
router.patch('/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const Sessions = _model('elearning_sessions');
    const session  = await Sessions.findOne({
      id: req.params.sessionId, schoolId: req.jwtUser.schoolId,
    }).lean();
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const { title, scheduledAt, duration, agenda } = req.body;
    const update = {};
    if (title)       update.title       = title;
    if (scheduledAt) update.scheduledAt = scheduledAt;
    if (duration)    update.duration    = Number(duration);
    if (agenda)      update.agenda      = agenda;

    // Sync with Zoom
    if (Object.keys(update).length) {
      await _zoomFetch(`/meetings/${session.zoomMeetingId}`, {
        method: 'PATCH',
        body: {
          topic:      update.title      || session.title,
          start_time: update.scheduledAt ? new Date(update.scheduledAt).toISOString().replace('.000Z', 'Z') : undefined,
          duration:   update.duration   || session.duration,
          agenda:     update.agenda     || session.agenda,
        },
      });
    }

    update.updatedAt = new Date().toISOString();
    await Sessions.updateOne({ id: req.params.sessionId }, { $set: update });
    const fresh = await Sessions.findOne({ id: req.params.sessionId }).lean();
    res.json({ success: true, session: fresh });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Cancel / delete session ─────────────────────────────────── */
router.delete('/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const Sessions = _model('elearning_sessions');
    const session  = await Sessions.findOne({
      id: req.params.sessionId, schoolId: req.jwtUser.schoolId,
    }).lean();
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    if (session.platform === 'meet' && session.meetEventId) {
      const tok = await _getToken(req.jwtUser.userId);
      if (tok) await _deleteMeetSession({ tok, eventId: session.meetEventId });
    } else if (session.zoomMeetingId) {
      await _zoomFetch(`/meetings/${session.zoomMeetingId}`, { method: 'DELETE' });
    }

    await Sessions.updateOne(
      { id: req.params.sessionId },
      { $set: { status: 'cancelled', updatedAt: new Date().toISOString() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Student join tracking for Google Meet ───────────────────── */
/* POST /api/elearning/sessions/:sessionId/attend
   Called when a student clicks "Join" for a Meet session.
   Records attendance since Meet has no join webhook.
*/
router.post('/sessions/:sessionId/attend', authMiddleware, async (req, res) => {
  try {
    const Sessions = _model('elearning_sessions');
    const session  = await Sessions.findOne({
      id: req.params.sessionId, schoolId: req.jwtUser.schoolId,
    }).lean();
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const Users   = _model('users');
    const student = await Users.findOne({ id: req.jwtUser.userId }).lean();
    if (!student) return res.status(404).json({ error: 'User not found.' });

    const already = session.attendees?.some(a => a.studentId === student.id);
    if (!already) {
      await Sessions.updateOne(
        { id: req.params.sessionId },
        {
          $push: {
            attendees: {
              studentId:   student.id,
              studentName: student.name,
              email:       student.email,
              joinedAt:    new Date().toISOString(),
              leftAt:      null,
              durationMins: null,
              source:      'self_reported',
            },
          },
        }
      );

      // Write to Attendance module immediately (present — they clicked Join)
      if (session.classId) {
        const Attendance = _model('attendance');
        const date       = new Date(session.scheduledAt).toISOString().split('T')[0];
        await Attendance.updateOne(
          { schoolId: session.schoolId, studentId: student.id, date, type: 'virtual_class', sessionId: session.id },
          {
            $set: {
              schoolId:     session.schoolId,
              studentId:    student.id,
              classId:      session.classId,
              subjectId:    session.subjectId || null,
              date,
              type:         'virtual_class',
              sessionId:    session.id,
              sessionTitle: session.title,
              status:       'present',
              source:       'meet_join',
              markedAt:     new Date().toISOString(),
            },
          },
          { upsert: true }
        );
      }
    }

    res.json({ success: true, meetLink: session.meetLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   ZOOM WEBHOOK — attendance + recording auto-sync
   Events handled:
     meeting.participant_joined → mark attendance started
     meeting.participant_left   → update attendance duration
     meeting.ended              → close session, calculate durations
     recording.completed        → store recording URL
   ══════════════════════════════════════════════════════════════ */
router.post('/zoom-webhook', async (req, res) => {
  // URL validation challenge (Zoom sends this once when you set up the endpoint)
  if (req.body?.event === 'endpoint.url_validation') {
    const hash = crypto
      .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET || '')
      .update(req.body.payload?.plainToken || '')
      .digest('hex');
    return res.json({ plainToken: req.body.payload?.plainToken, encryptedToken: hash });
  }

  // Signature verification
  if (!_verifyZoomWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.sendStatus(200); // ack immediately

  try {
    const { event, payload } = req.body;
    const zoomMeetingId = String(payload?.object?.id || '');
    if (!zoomMeetingId) return;

    const Sessions = _model('elearning_sessions');
    const session  = await Sessions.findOne({ zoomMeetingId }).lean();
    if (!session) return;

    const Users = _model('users');

    if (event === 'meeting.started') {
      await Sessions.updateOne({ zoomMeetingId }, { $set: { status: 'live', startedAt: new Date().toISOString() } });
    }

    if (event === 'meeting.participant_joined') {
      const participant = payload.object.participant;
      const email       = participant?.email?.toLowerCase();
      if (!email) return;

      const student = await Users.findOne({ schoolId: session.schoolId, email }).lean();
      if (!student) return;

      // Add attendee record (or update if re-joining)
      await Sessions.updateOne(
        { zoomMeetingId },
        {
          $pull: { attendees: { studentId: student.id } }, // remove stale entry
        }
      );
      await Sessions.updateOne(
        { zoomMeetingId },
        {
          $push: {
            attendees: {
              studentId:   student.id,
              studentName: student.name,
              email,
              joinedAt:    new Date().toISOString(),
              leftAt:      null,
              durationMins: 0,
            },
          },
        }
      );
    }

    if (event === 'meeting.participant_left') {
      const participant = payload.object.participant;
      const email       = participant?.email?.toLowerCase();
      if (!email) return;

      const student = await Users.findOne({ schoolId: session.schoolId, email }).lean();
      if (!student) return;

      const leftAt  = new Date().toISOString();
      const sess    = await Sessions.findOne({ zoomMeetingId }).lean();
      const rec     = sess?.attendees?.find(a => a.studentId === student.id);
      const joinMs  = rec?.joinedAt ? new Date(rec.joinedAt).getTime() : Date.now();
      const durMins = Math.round((Date.now() - joinMs) / 60_000);

      await Sessions.updateOne(
        { zoomMeetingId, 'attendees.studentId': student.id },
        { $set: { 'attendees.$.leftAt': leftAt, 'attendees.$.durationMins': durMins } }
      );
    }

    if (event === 'meeting.ended') {
      const sess = await Sessions.findOne({ zoomMeetingId }).lean();
      await Sessions.updateOne(
        { zoomMeetingId },
        { $set: { status: 'ended', endedAt: new Date().toISOString() } }
      );

      // Write attendance to the Attendance module for each attendee
      if (sess?.attendees?.length && sess.classId) {
        const Attendance = _model('attendance');
        const date       = new Date(sess.scheduledAt).toISOString().split('T')[0];
        for (const att of sess.attendees) {
          if (!att.studentId) continue;
          await Attendance.updateOne(
            { schoolId: sess.schoolId, studentId: att.studentId, date, type: 'virtual_class', sessionId: sess.id },
            {
              $set: {
                schoolId:     sess.schoolId,
                studentId:    att.studentId,
                classId:      sess.classId,
                subjectId:    sess.subjectId || null,
                date,
                type:         'virtual_class',
                sessionId:    sess.id,
                sessionTitle: sess.title,
                status:       att.durationMins >= Math.floor(sess.duration * 0.5) ? 'present' : 'partial',
                durationMins: att.durationMins,
                source:       'zoom_webhook',
                markedAt:     new Date().toISOString(),
              },
            },
            { upsert: true }
          );
        }
      }
    }

    if (event === 'recording.completed') {
      const recordings = payload.object?.recording_files || [];
      const mp4        = recordings.find(r => r.file_type === 'MP4' && r.status === 'completed');
      if (mp4?.play_url) {
        await Sessions.updateOne(
          { zoomMeetingId },
          { $set: { recordingUrl: mp4.play_url } }
        );
      }
    }
  } catch (err) {
    console.error('[elearning/zoom-webhook]', err);
  }
});

module.exports = router;
