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

  // 401 → clear session and broadcast
  if (res.status === 401) {
    localStorage.removeItem('msingi_session');
    window.dispatchEvent(new CustomEvent('api:unauthorized'));
    throw new APIError('UNAUTHORIZED', 'Session expired. Please log in again.', 401);
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const { code = 'SERVER_ERROR', message = 'An error occurred' } = json?.error ?? {};
    throw new APIError(code, message, res.status, json ?? {});
  }

  return json;
}

// ─── Method helpers ───────────────────────────────────────────────────────────

const _get    = (path, params)       => _req('GET',    path, null, params);
const _post   = (path, body)         => _req('POST',   path, body);
const _put    = (path, body)         => _req('PUT',    path, body);
const _patch  = (path, body)         => _req('PATCH',  path, body);
const _delete = (path)               => _req('DELETE', path);

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
  me:              ()             => _get('/auth/me'),
  changePassword:  (data)         => _post('/auth/change-password', data),
  refresh:         ()             => _post('/auth/refresh'),
};

export const students = {
  ..._resource('students'),
  bulkImport: (data) => _post('/students/bulk', data),
};

export const teachers = _resource('teachers');

export const classes = {
  ..._resource('classes'),
  students: (classId, params) => _get(`/classes/${classId}/students`, params),
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
};

export const grades = {
  report: (params) => _get('/grades/report', params),
};

export const assessment = {
  // Config
  getConfig:    (params)     => _get('/assessment/config', params),
  updateConfig: (data)       => _patch('/assessment/config', data),

  // Schedule
  getSchedule:    (params)   => _get('/assessment/schedule', params),
  upsertSchedule: (data)     => _put('/assessment/schedule', data),
  deleteSchedule: (id)       => _delete(`/assessment/schedule/${id}`),

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
};

export const admissions = {
  ..._resource('admissions'),
  changeStage: (id, data) => _patch(`/admissions/${id}/stage`, data),
  stats:       (params)   => _get('/admissions/stats', params),
};

export const timetable = {
  list:       (params)     => _get('/timetable', params),
  byClass:    (classId)    => _get(`/timetable/class/${classId}`),
  create:     (data)       => _post('/timetable', data),
  update:     (id, data)   => _put(`/timetable/${id}`, data),
  remove:     (id)         => _delete(`/timetable/${id}`),
  bulkSet:    (data)       => _post('/timetable/bulk', data),
};

export const announcements = _resource('announcements');

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
    // 207 = partial success — not an error
    if (!res.ok && res.status !== 207) {
      const { code = 'SERVER_ERROR', message = 'Import failed' } = json?.error ?? {};
      throw new APIError(code, message, res.status, json ?? {});
    }
    return json;
  },

  /** Export all records for the given type as a CSV download */
  exportCSV: async (type) => {
    const token = _getToken();
    const { slug } = detectSchool();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (slug)  headers['X-School-Slug'] = slug;

    const res = await fetch(`${BASE}/import-export/export/${type}`, { headers });
    if (!res.ok) throw new APIError('EXPORT_FAILED', 'Export failed', res.status);

    const blob     = await res.blob();
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const stamp    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href         = url;
    a.download     = `msingi_${type}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    get:    ()     => _get('/settings/school'),
    update: (data) => _put('/settings/school', data),
  },
  users: {
    list:   ()         => _get('/settings/users'),
    invite: (data)     => _post('/settings/users/invite', data),
    update: (id, data) => _put(`/settings/users/${id}`, data),
    remove: (id)       => _delete(`/settings/users/${id}`),
  },
};

// Default export — single object for convenience
const api = {
  auth,
  students,
  teachers,
  classes,
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
  importExport,
  APIError,
};

export default api;
