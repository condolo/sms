/* ============================================================
   eLearning — Google Classroom Integration
   All academic content lives in Google Classroom / Google Drive.
   Msingi stores only: OAuth tokens, course links, coursework IDs,
   and a grade cache (synced from GC webhooks).

   Auth model: per-teacher Google OAuth with Classroom + Drive scopes.
   Teachers must connect their Google Workspace account once.

   Routes:
   GET  /api/elearning/auth/connect       — start GC OAuth flow
   GET  /api/elearning/auth/callback      — OAuth callback, store tokens
   GET  /api/elearning/auth/status        — check connection + whoami
   DELETE /api/elearning/auth/disconnect  — revoke + delete tokens

   GET  /api/elearning/gc/courses         — list teacher's GC courses
   GET  /api/elearning/courses            — list linked courses (Msingi side)
   POST /api/elearning/courses/link       — link GC course to class/subject
   DELETE /api/elearning/courses/:id      — unlink course

   GET  /api/elearning/courses/:id/coursework        — list GC coursework
   POST /api/elearning/courses/:id/coursework        — create assignment in GC
   DELETE /api/elearning/courses/:id/coursework/:cwId — delete coursework in GC

   POST /api/elearning/gc-webhook         — receive grade push from Google Pub/Sub
   ============================================================ */
const express        = require('express');
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

module.exports = router;
