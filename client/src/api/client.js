/**
 * Msingi React API client
 * Adapted from js/api.js — same contract, React-compatible.
 */
import { detectSchool } from '@/utils/schoolDetect.js';

const BASE = '/api';

// ─── Error class ──────────────────────────────────────────────────────────────

export class APIError extends Error {
  constructor(code, message, status = 500, extra = {}) {
    super(message);
    this.name    = 'APIError';
    this.code    = code;
    this.status  = status;
    this.extra   = extra;
  }
}

// ─── Token helper ─────────────────────────────────────────────────────────────

function getToken() {
  try {
    const raw = localStorage.getItem('msingi_session');
    if (!raw) return null;
    return JSON.parse(raw)?.token ?? null;
  } catch {
    return null;
  }
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function _req(method, path, body = null, params = null) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Auto-send the school slug on every request so the server can resolve
  // the tenant without the user typing it. Detected from subdomain first,
  // then ?school= query param, then localStorage.
  const { slug } = detectSchool();
  if (slug) headers['X-School-Slug'] = slug;

  let url = `${BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')),
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => null);

  if (res.status === 401) {
    // Only treat as session expiry if the request was made with a token.
    // Unauthenticated requests (login, OTP verify, etc.) should show the
    // actual server error ("Invalid email or password") — not "Session expired".
    if (token) {
      localStorage.removeItem('msingi_session');
      window.dispatchEvent(new CustomEvent('api:unauthorized'));
      throw new APIError('UNAUTHORIZED', 'Session expired. Please log in again.', 401);
    }
    // No token — pass through the actual server error message
    const msg = typeof json?.error === 'string' ? json.error
              : json?.error?.message ?? json?.message ?? 'Invalid credentials.';
    throw new APIError('UNAUTHORIZED', msg, 401, json ?? {});
  }

  if (!res.ok) {
    // Handle both { error: 'string' } and { error: { code, message } } shapes
    const errBody = json?.error;
    const code    = typeof errBody === 'object' ? (errBody?.code ?? 'SERVER_ERROR') : 'SERVER_ERROR';
    const message = typeof errBody === 'string'  ? errBody
                  : errBody?.message ?? json?.message ?? 'An error occurred';
    throw new APIError(code, message, res.status, json ?? {});
  }

  return json;
}

// ─── Method helpers ───────────────────────────────────────────────────────────

const _get    = (path, params)       => _req('GET',    path, null, params);
const _post   = (path, body)         => _req('POST',   path, body);
const _put    = (path, body)         => _req('PUT',    path, body);
const _patch  = (path, body)         => _req('PATCH',  path, body);
const _delete = (path, body)         => _req('DELETE', path, body);

// Generic CRUD factory
function _resource(base) {
  return {
    list:   (params)     => _get(`/${base}`, params),
    get:    (id)         => _get(`/${base}/${id}`),
    create: (data)       => _post(`/${base}`, data),
    update: (id, data)   => _put(`/${base}/${id}`, data),
    remove: (id)         => _delete(`/${base}/${id}`),
  };
}

// ─── Named modules ────────────────────────────────────────────────────────────

export const publicApi = {
  /** Fetch school branding — no auth required */
  schoolInfo: (slug) => _get(`/public/school-info${slug ? `?slug=${slug}` : ''}`),
};

export const auth = {
  login:           (credentials)  => _post('/auth/login', credentials),
  verifyOtp:       (data)         => _post('/auth/verify-otp', data),
  forceChange:     (data)         => _post('/auth/force-change', data),
  logout:          ()             => _post('/auth/logout'),
  ping:            ()             => _post('/auth/ping'),
  me:              ()             => _get('/auth/me'),
  changePassword:  (data)         => _post('/auth/change-password', data),
  permissions:     ()             => _get('/auth/permissions'),
  sessions:        ()             => _get('/auth/sessions'),
  terminateSession:(id)           => _delete(`/auth/sessions/${id}`),
  revokeAllSessions:(userId)      => _post('/auth/sessions/revoke-all', { userId }),
};

export const profile = {
  get:                ()       => _get('/users/me'),
  update:             (data)   => _put('/users/me', data),
  uploadPhoto:        (data)   => _put('/users/me/photo', data),
  removePhoto:        ()       => _delete('/users/me/photo'),
  photoUrl:           (userId, schoolId) => schoolId ? `/api/users/${userId}/photo?schoolId=${encodeURIComponent(schoolId)}` : `/api/users/${userId}/photo`,
  staffRecord:        ()       => _get('/teachers/me'),
  updateStaffRecord:  (data)   => _put('/teachers/me', data),
  saveMeetingLinks:   (data)   => _put('/users/me/meeting-links', data),
};

export const students = {
  ..._resource('students'),
  stats:              ()           => _get('/students/stats'),
  bulkImport:         (data)       => _post('/students/bulk', data),
  purge:              (ids)        => _req('DELETE', '/students/purge', { ids }),
  bulkPortalAccounts: (ids)        => _post('/students/bulk-portal-accounts', { studentIds: ids }),
  deactivate:         (id, data)   => _req('PATCH', `/students/${id}/deactivate`, data),
  reactivate:         (id)         => _req('PATCH', `/students/${id}/reactivate`, {}),
  promote:            (data)       => _post('/students/promote', data),
};

export const teachers = {
  ..._resource('teachers'),
  bulkRemove: (ids) => _delete('/teachers/bulk', { ids }),
};

export const classes = {
  ..._resource('classes'),
  students: (classId, params) => _get(`/classes/${classId}/students`, params),
};

export const streams = {
  ..._resource('streams'),
  students: (streamId, params) => _get(`/streams/${streamId}/students`, params),
};

export const attendance = {
  list:      (params) => _get('/attendance', params),
  summary:   (params) => _get('/attendance/summary', params),
  upsert:    (data)   => _post('/attendance', data),
  bulkMark:  (data)   => _post('/attendance/bulk', data),
};

export const finance = {
  invoices: {
    ..._resource('finance/invoices'),
    void: (id) => _patch(`/finance/invoices/${id}/void`),
  },
  payments: {
    list:   (params) => _get('/finance/payments', params),
    record: (data)   => _post('/finance/payments', data),
  },
  feeStructures: {
    list:     ()           => _get('/finance/fee-structures'),
    create:   (data)       => _post('/finance/fee-structures', data),
    update:   (id, data)   => _put(`/finance/fee-structures/${id}`, data),
    remove:   (id)         => _delete(`/finance/fee-structures/${id}`),
    generate: (id)         => _post(`/finance/fee-structures/${id}/generate`),
  },
  summary: (params) => _get('/finance/summary', params),
};

export const behaviour = {
  incidents: {
    ..._resource('behaviour/incidents'),
    summary: (params) => _get('/behaviour/incidents/summary', params),
  },
  appeals: {
    list:    (params)       => _get('/behaviour/appeals', params),
    create:  (data)         => _post('/behaviour/appeals', data),
    resolve: (id, data)     => _patch(`/behaviour/appeals/${id}/resolve`, data),
  },
  categories: _resource('behaviour/categories'),
};

export const exams = {
  ..._resource('exams'),
  results: {
    list:       (examId, params) => _get(`/exams/${examId}/results`, params),
    bulkUpsert: (examId, data)   => _post(`/exams/${examId}/results`, data),
  },
  announceSitting: (data) => _post('/exams/announce', data),
};

export const grades = {
  report: (params) => _get('/grades/report', params),
};

export const assessment = {
  // Config
  getConfig:    (params)     => _get('/assessment/config', params),
  updateConfig: (data)       => _patch('/assessment/config', data),

  // Assessment Types (full CRUD — deep DB)
  getTypes:    ()            => _get('/assessment/types'),
  addType:     (data)        => _post('/assessment/types', data),
  saveTypes:   (data)        => _put('/assessment/types', data),          // bulk replace
  deleteType:  (key)         => _delete(`/assessment/types/${encodeURIComponent(key)}`),

  // Schedule
  getSchedule:    (params)   => _get('/assessment/schedule', params),
  upsertSchedule: (data)     => _put('/assessment/schedule', data),
  deleteSchedule: (id)       => _delete(`/assessment/schedule/${id}`),
  lockSchedule:   (id, data) => _post(`/assessment/schedule/${id}/lock`, data ?? {}),
  unlockSchedule: (id, data) => _post(`/assessment/schedule/${id}/unlock`, data ?? {}),

  // Marks
  getMarks:     (params)     => _get('/assessment/marks', params),
  marksSummary: (params)     => _get('/assessment/marks/summary', params),
  enterMark:    (data)       => _post('/assessment/marks', data),
  bulkMarks:    (data)       => _post('/assessment/marks/bulk', data),
  deleteMark:   (id)         => _delete(`/assessment/marks/${id}`),

  // Report
  report:       (params)     => _get('/assessment/report', params),

  // Reminders
  reminders:    (params)     => _get('/assessment/reminders', params),
  notify:       (data)       => _post('/assessment/reminders/notify', data),

  // Grade Scales (full CRUD — grade_boundaries collection)
  getGradeScales:    (params)  => _get('/assessment/grade-scales', params),
  createGradeScale:  (data)    => _post('/assessment/grade-scales', data),
  updateGradeScale:  (id, data) => _put(`/assessment/grade-scales/${id}`, data),
  deleteGradeScale:  (id)      => _delete(`/assessment/grade-scales/${id}`),
};

export const admissions = {
  ..._resource('admissions'),
  changeStage: (id, data) => _patch(`/admissions/${id}/stage`, data),
  stats:       (params)   => _get('/admissions/stats', params),
};

export const timetable = {
  list:        (params)     => _get('/timetable', params),
  byClass:     (classId, p) => _get(`/timetable/class/${classId}`, p),
  byTeacher:   (id, p)      => _get(`/timetable/teacher/${id}`, p),
  workload:    (p)          => _get('/timetable/workload', p),
  conflicts:   (p)          => _get('/timetable/conflicts', p),
  overview:    (p)          => _get('/timetable/overview', p),
  create:      (data)       => _post('/timetable', data),
  update:      (id, data)   => _put(`/timetable/${id}`, data),
  remove:      (id)         => _delete(`/timetable/${id}`),
  bulkSet:     (data)       => _post('/timetable/bulk', data),
  // Publishing + version history
  status:      ()           => _get('/timetable/status'),
  publish:     (data)       => _post('/timetable/publish', data),
  unpublish:   ()           => _post('/timetable/unpublish'),
  versions:    ()           => _get('/timetable/versions'),
  // Substitution system
  substitutions: {
    list:        (params)   => _get('/timetable/substitutions', params),
    markAbsent:  (data)     => _post('/timetable/substitutions/absent', data),
    update:      (id, data) => _put(`/timetable/substitutions/${id}`, data),
    remove:      (id)       => _delete(`/timetable/substitutions/${id}`),
    autoAssign:  (data)     => _post('/timetable/substitutions/auto-assign', data),
    coverPdf:    async (params = {}) => {
      const token = getToken();
      const { slug } = detectSchool();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (slug)  headers['X-School-Slug'] = slug;
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
      ).toString();
      const res = await fetch(`${BASE}/timetable/substitutions/cover-pdf${qs ? `?${qs}` : ''}`, { headers });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new APIError('PDF_FAILED', json?.error?.message ?? 'Failed to generate cover sheet PDF', res.status);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cover-sheet-${params.date ?? 'unknown'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    },
  },
  // Free teachers at a given period on a date (ranked for cover suggestions)
  availableTeachers: (params) => _get('/timetable/available-teachers', params),
  // Portal views
  my:          ()           => _get('/timetable/my'),
  myChildren:  ()           => _get('/timetable/my-children'),
};

export const announcements = {
  ..._resource('announcements'),
  dismiss: (id) => _post(`/announcements/${id}/dismiss`),
};

// ─── Import / Export ──────────────────────────────────────────────────────────

function _getToken() { return getToken(); }

export const importExport = {
  /** Import a CSV file for the given type (students | teachers) */
  importCSV: async (type, csvText) => {
    const token = _getToken();
    const { slug } = detectSchool();
    const headers = { 'Content-Type': 'text/csv' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (slug)  headers['X-School-Slug'] = slug;

    const res = await fetch(`${BASE}/import-export/${type}`, {
      method: 'POST',
      headers,
      body: csvText,
    });

    const json = await res.json().catch(() => null);
    // 207 = partial success, 422 = all rows failed validation — both return structured data
    if (!res.ok && res.status !== 207 && res.status !== 422) {
      const { code = 'SERVER_ERROR', message = 'Import failed' } = json?.error ?? {};
      throw new APIError(code, message, res.status, json ?? {});
    }
    return json;
  },

  /** Export records for the given type as a CSV download.
   *  Pass an optional params object to filter the export (mirrors the list API). */
  exportCSV: async (type, params = {}) => {
    const token = _getToken();
    const { slug } = detectSchool();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (slug)  headers['X-School-Slug'] = slug;

    let url = `${BASE}/import-export/export/${type}`;
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    ).toString();
    if (qs) url += `?${qs}`;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new APIError('EXPORT_FAILED', 'Export failed', res.status);

    // Use server-provided filename when available (reflects active filters)
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = match?.[1] ?? `msingi_${type}_${stamp}.csv`;

    const blob = await res.blob();
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  },

  /** Download a blank demo template for the given type */
  downloadTemplate: async (type) => {
    const token = _getToken();
    const { slug } = detectSchool();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (slug)  headers['X-School-Slug'] = slug;

    const res = await fetch(`${BASE}/import-export/template/${type}`, { headers });
    if (!res.ok) throw new APIError('TEMPLATE_FAILED', 'Failed to download template', res.status);

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `msingi_${type}_template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

export const settings = {
  get:    ()       => _get('/settings'),
  update: (data)   => _put('/settings', data),
  school: {
    get:          ()     => _get('/settings/school'),
    update:       (data) => _put('/settings/school', data),
    admissionCounter: {
      get:  ()        => _get('/settings/admission-counter'),
      set:  (value)   => _put('/settings/admission-counter', { value }),
    },
    uploadLogo:   (b64)  => _put('/settings/school/logo',    { logoBase64: b64 }),
    deleteLogo:   ()     => _delete('/settings/school/logo'),
    uploadFavicon:(b64)  => _put('/settings/school/favicon', { faviconBase64: b64 }),
    deleteFavicon:()     => _delete('/settings/school/favicon'),
    smtp: {
      save:   (data) => _post('/settings/school/smtp', data),
      test:   (data) => _post('/settings/school/smtp/test', data),
      remove: ()     => _delete('/settings/school/smtp'),
    },
  },
  users: {
    list:        ()         => _get('/settings/users'),
    invite:      (data)     => _post('/settings/users/invite', data),
    bulkInvite:  (staff)    => _post('/settings/users/bulk-invite', { staff }),
    update:      (id, data) => _put(`/settings/users/${id}`, data),
    remove:        (id)       => _delete(`/settings/users/${id}`),
    resetPassword: (id, data = {}) => _post(`/settings/users/${id}/reset-password`, data),
  },
  notifications: {
    get:    ()       => _get('/settings/notifications'),
    update: (data)   => _put('/settings/notifications', data),
  },
  customRoles: {
    list:   ()           => _get('/settings/custom-roles'),
    create: (data)       => _post('/settings/custom-roles', data),
    update: (key, data)  => _put(`/settings/custom-roles/${key}`, data),
    remove: (key)        => _delete(`/settings/custom-roles/${key}`),
  },
};

export const academicConfig = {
  // Main academic config (grading schema, assessment weights, ranking, report settings)
  get:          ()           => _get('/academic-config'),
  update:       (data)       => _put('/academic-config', data),
  resetDefaults:()           => _post('/academic-config/reset'),
  // Academic years (terms embedded in each year)
  years: {
    list:       ()           => _get('/academic-config/years'),
    create:     (data)       => _post('/academic-config/years', data),
    update:     (id, data)   => _put(`/academic-config/years/${id}`, data),
    remove:     (id)         => _delete(`/academic-config/years/${id}`),
  },
  transition:   (data)       => _post('/academic-config/transition-year', data),
  archiveYear:  (data)       => _post('/academic-config/archive-year', data),
};

export const departments = _resource('departments');

export const subjects = {
  ..._resource('subjects'),
  byDepartment: (departmentId, params) => _get('/subjects', { ...params, departmentId }),
};

export const events = {
  list:      (params)   => _get('/events', params),
  get:       (id)       => _get(`/events/${id}`),
  create:    (data)     => _post('/events', data),
  update:    (id, data) => _put(`/events/${id}`, data),
  remove:    (id)       => _delete(`/events/${id}`),
  birthdays: (params)   => _get('/events/birthdays', params),
};

export const birthdaysApi = {
  today:  () => _get('/birthdays/today'),
  notify: () => _post('/birthdays/notify'),
};

export const teacherPortalApi = {
  dashboard: () => _get('/teacher-portal/dashboard'),
};

export const hr = {
  summary: ()          => _get('/hr/summary'),
  leave: {
    list:    (params)  => _get('/hr/leave', params),
    submit:  (data)    => _post('/hr/leave', data),
    resolve: (id, data)=> _patch(`/hr/leave/${id}/resolve`, data),
  },
  payroll: {
    list:      (params)  => _get('/hr/payroll', params),
    mine:      (params)  => _get('/hr/payroll/mine', params),
    save:      (data)    => _post('/hr/payroll', data),
    remove:    (id)      => _delete(`/hr/payroll/${id}`),
    setStatus: (id, status) => _patch(`/hr/payroll/${id}/status`, { status }),
    copy:      (data)    => _post('/hr/payroll/copy', data),
  },
  documents: {
    list:   (params)   => _get('/hr/documents', params),
    create: (data)     => _post('/hr/documents', data),
    update: (id, data) => _put(`/hr/documents/${id}`, data),
    remove: (id)       => _delete(`/hr/documents/${id}`),
  },
};

export const messages = {
  list:     (params) => _get('/messages', params),
  send:     (data)   => _post('/messages', data),
  markRead: (id)     => _patch(`/messages/${id}/read`, {}),
  remove:   (id)     => _delete(`/messages/${id}`),
};

export const studentSubjects = {
  counts:   ()       => _get('/student-subjects/counts'),
  list:     (params) => _get('/student-subjects', params),
  enroll:   (data)   => _post('/student-subjects', data),
  bulk:     (data)   => _post('/student-subjects/bulk', data),
  unenroll: (id)     => _delete(`/student-subjects/${id}`),
};

export const classSubjects = {
  /** { [classId]: count } */
  counts:   ()                   => _get('/class-subjects/counts'),
  /** GET ?classId=X or ?subjectId=X */
  list:     (params)             => _get('/class-subjects', params),
  /** GET /enrollment-warnings?classId=X  (or no param for school-wide) */
  warnings: (params)             => _get('/class-subjects/enrollment-warnings', params),
  assign:   (data)               => _post('/class-subjects', data),
  bulk:     (data)               => _post('/class-subjects/bulk', data),
  update:   (id, data)           => _put(`/class-subjects/${id}`, data),
  remove:   (id)                 => _delete(`/class-subjects/${id}`),
};

export const subjectRules = {
  list:   ()         => _get('/subject-rules'),
  get:    (id)       => _get(`/subject-rules/${id}`),
  create: (data)     => _post('/subject-rules', data),
  update: (id, data) => _put(`/subject-rules/${id}`, data),
  remove: (id)       => _delete(`/subject-rules/${id}`),
};

export const rooms = {
  list:   (params)     => _get('/rooms', params),
  get:    (id)         => _get(`/rooms/${id}`),
  create: (data)       => _post('/rooms', data),
  update: (id, data)   => _put(`/rooms/${id}`, data),
  remove: (id)         => _delete(`/rooms/${id}`),
};

export const teachingAssignments = {
  /** List assignments — pass ?teacherId, ?classId, ?subjectId, ?roomId */
  list:   (params)     => _get('/teaching-assignments', params),
  /** Create one assignment */
  create: (data)       => _post('/teaching-assignments', data),
  /** Update preferred room / periodsPerWeek */
  update: (id, data)   => _put(`/teaching-assignments/${id}`, data),
  /** Remove an assignment */
  remove: (id)         => _delete(`/teaching-assignments/${id}`),
  /** Convenience: find the teacher assigned to a subject in a class */
  lookup: (classId, subjectId) =>
    _get('/teaching-assignments', { classId, subjectId }),
};

export const sections = {
  /** List all sections for this school (auto-seeds defaults on first call). */
  list:   ()           => _get('/sections'),
  /** Create a new section. body: { key, name, color, order } */
  create: (data)       => _post('/sections', data),
  /** Update name/color/order only — key is immutable. */
  update: (id, data)   => _put(`/sections/${id}`, data),
  /** Delete a section (fails if active classes are assigned). */
  remove: (id)         => _delete(`/sections/${id}`),
};

export const growthProfile = {
  /** Full profile meta + section counts for a student */
  profile:  (studentId)       => _get(`/growth-profile/${studentId}`),
  /** Academic section: grades, attendance, recent reports (read-only aggregation) */
  academic: (studentId)       => _get(`/growth-profile/${studentId}/academic`),

  /** Generic records: leadership | activities | service | awards */
  records: {
    list:   (type, params)      => _get(`/growth-records/${type}`, params),
    get:    (type, id)          => _get(`/growth-records/${type}/${id}`),
    create: (type, data)        => _post(`/growth-records/${type}`, data),
    update: (type, id, data)    => _put(`/growth-records/${type}/${id}`, data),
    remove: (type, id)          => _delete(`/growth-records/${type}/${id}`),
    verify: (type, id, data)    => _patch(`/growth-records/${type}/${id}/verify`, data),
  },

  /** Projects (have supervisorId/supervisorName + status + evidenceUrls) */
  projects: {
    list:   (params)            => _get('/growth-projects', params),
    get:    (id)                => _get(`/growth-projects/${id}`),
    create: (data)              => _post('/growth-projects', data),
    update: (id, data)          => _put(`/growth-projects/${id}`, data),
    remove: (id)                => _delete(`/growth-projects/${id}`),
    verify: (id, data)          => _patch(`/growth-projects/${id}/verify`, data),
  },

  /** Recommendations — written by staff for a student */
  recommendations: {
    list:   (params)            => _get('/growth-recommendations', params),
    get:    (id)                => _get(`/growth-recommendations/${id}`),
    create: (data)              => _post('/growth-recommendations', data),
    remove: (id)                => _delete(`/growth-recommendations/${id}`),
  },

  /** Aspirations — one document per student (upsert) */
  aspirations: {
    get:    (studentId)         => _get(`/growth-recommendations/aspirations/${studentId}`),
    upsert: (studentId, data)   => _put(`/growth-recommendations/aspirations/${studentId}`, data),
  },
};

export const analytics = {
  /** Leadership snapshot: attendance risk, fee exposure, behaviour, academic health */
  leadership: (days = 30) => _get('/analytics/leadership', { days }),
};

export const billing = {
  /** Current pending invoice for this school */
  current:  ()     => _get('/billing/current'),
  /** Generate (or regenerate) the subscription invoice for the current term */
  generate: (data) => _post('/billing/generate', data),
  /** Full invoice history */
  history:  ()     => _get('/billing/history'),
};

export const mpesa = {
  /** Initiate an STK-push subscription payment */
  subscription: (data) => _post('/mpesa/subscription', data),
};

export const bellSchedule = {
  /** Fetch a section's schedule. Falls back: section → 'all' → hardcoded default. */
  get:      (section = 'all') => _get('/bell-schedule', { section }),
  /** Fetch overview of all configured sections */
  sections: ()                => _get('/bell-schedule/sections'),
  /** Save a section's schedule. body: { section, periods } */
  update:   (data)            => _put('/bell-schedule', data),
  /** Revert a section to the school-wide default */
  remove:   (section)         => _delete(`/bell-schedule?section=${section}`),
};

export const library = {
  summary: () => _get('/library/summary'),
  books: {
    list:   (params)     => _get('/library/books', params),
    get:    (id)         => _get(`/library/books/${id}`),
    create: (data)       => _post('/library/books', data),
    update: (id, data)   => _put(`/library/books/${id}`, data),
    remove: (id)         => _delete(`/library/books/${id}`),
  },
  loans: {
    list:        (params) => _get('/library/loans', params),
    issue:       (data)   => _post('/library/loans', data),
    return:      (id, body) => _patch(`/library/loans/${id}/return`, body ?? {}),
    syncOverdue: ()       => _post('/library/loans/sync-overdue', {}),
  },
};

export const transport = {
  summary: () => _get('/transport/summary'),
  routes: {
    list:   (params)     => _get('/transport/routes', params),
    get:    (id)         => _get(`/transport/routes/${id}`),
    create: (data)       => _post('/transport/routes', data),
    update: (id, data)   => _put(`/transport/routes/${id}`, data),
    remove: (id)         => _delete(`/transport/routes/${id}`),
  },
  assignments: {
    list:       (params)     => _get('/transport/assignments', params),
    assign:     (data)       => _post('/transport/assignments', data),
    update:     (id, data)   => _patch(`/transport/assignments/${id}`, data),
    remove:     (id)         => _delete(`/transport/assignments/${id}`),
  },
};

export const hostel = {
  summary: () => _get('/hostel/summary'),
  hostels: {
    list:   (params)     => _get('/hostel/hostels', params),
    get:    (id)         => _get(`/hostel/hostels/${id}`),
    create: (data)       => _post('/hostel/hostels', data),
    update: (id, data)   => _put(`/hostel/hostels/${id}`, data),
    remove: (id)         => _delete(`/hostel/hostels/${id}`),
  },
  rooms: {
    list:   (params)     => _get('/hostel/rooms', params),
    get:    (id)         => _get(`/hostel/rooms/${id}`),
    create: (data)       => _post('/hostel/rooms', data),
    update: (id, data)   => _put(`/hostel/rooms/${id}`, data),
    remove: (id)         => _delete(`/hostel/rooms/${id}`),
  },
  assignments: {
    list:      (params) => _get('/hostel/assignments', params),
    assign:    (data)   => _post('/hostel/assignments', data),
    discharge: (id, body) => _patch(`/hostel/assignments/${id}/discharge`, body ?? {}),
  },
};

export const lessons = {
  /* Topics (shared curriculum per subject) */
  topics: {
    list:    (params)     => _get('/lessons/topics', params),
    create:  (data)       => _post('/lessons/topics', data),
    update:  (id, data)   => _put(`/lessons/topics/${id}`, data),
    remove:  (id)         => _delete(`/lessons/topics/${id}`),
    reorder: (data)       => _post('/lessons/topics/reorder', data),
    copyFrom: (data)      => _post('/lessons/topics/copy-from', data),
  },
  /* Coverage (per teacher per class) */
  coverage: {
    list:    (params)     => _get('/lessons/coverage', params),
    mark:    (data)       => _post('/lessons/coverage', data),
    unmark:  (id)         => _delete(`/lessons/coverage/${id}`),
    unmarkBulk: (params)  => _req('DELETE', '/lessons/coverage', null, params),
  },
  /* Summary views */
  myClasses:    (params)  => _get('/lessons/my-classes', params),
  summary:      (params)  => _get('/lessons/summary', params),
  classSummary: (classId, params) => _get(`/lessons/class-summary/${classId}`, params),
  pendingTeachers: (params) => _get('/lessons/pending-teachers', params),
};

export const commentBanks = {
  list:   (params)     => _get('/comment-banks', params),
  create: (data)       => _post('/comment-banks', data),
  update: (id, data)   => _put(`/comment-banks/${id}`, data),
  remove: (id)         => _delete(`/comment-banks/${id}`),
};

export const examSeries = {
  list:        (params)         => _get('/exam-series', params),
  get:         (id)             => _get(`/exam-series/${id}`),
  create:      (data)           => _post('/exam-series', data),
  update:      (id, data)       => _put(`/exam-series/${id}`, data),
  remove:      (id)             => _delete(`/exam-series/${id}`),
  addExam:     (id, examId)     => _post(`/exam-series/${id}/exams`, { examId }),
  removeExam:  (id, examId)     => _delete(`/exam-series/${id}/exams/${examId}`),
};

export const markSubmissions = {
  list:    (params) => _get('/mark-submissions', params),
  get:     (id)     => _get(`/mark-submissions/${id}`),
  submit:  (data)   => _post('/mark-submissions', data),
  recall:  (id)     => _post(`/mark-submissions/${id}/recall`),
  review:  (id, data) => _post(`/mark-submissions/${id}/review`, data),
  lock:    (id)     => _post(`/mark-submissions/${id}/lock`),
  unlock:  (id, reason) => _post(`/mark-submissions/${id}/unlock`, { reason }),
};

export const reportCards = {
  generate: (data) => _post('/report-cards/generate', data),
  draftComments: {
    list:         (params)                     => _get('/report-cards/draft-comments', params),
    upsert:       (studentId, data)            => _put(`/report-cards/draft-comments/${studentId}`, data),
    saveSubject:  (studentId, subjectId, data) => _put(`/report-cards/draft-comments/${studentId}/subject/${subjectId}`, data),
  },
};

export const rcTemplates = {
  list:   ()           => _get('/rc-templates'),
  get:    (id)         => _get(`/rc-templates/${id}`),
  create: (data)       => _post('/rc-templates', data),
  update: (id, data)   => _put(`/rc-templates/${id}`, data),
  remove: (id)         => _delete(`/rc-templates/${id}`),
};

// Default export — single object for convenience
const api = {
  auth,
  students,
  teachers,
  classes,
  streams,
  attendance,
  finance,
  behaviour,
  exams,
  grades,
  assessment,
  admissions,
  timetable,
  announcements,
  settings,
  bellSchedule,
  departments,
  subjects,
  studentSubjects,
  classSubjects,
  subjectRules,
  messages,
  events,
  hr,
  rooms,
  teachingAssignments,
  importExport,
  growthProfile,
  analytics,
  billing,
  mpesa,
  library,
  transport,
  hostel,
  lessons,
  commentBanks,
  examSeries,
  markSubmissions,
  reportCards,
  APIError,
};

export default api;
