/**
 * InnoLearn React API client
 * Adapted from js/api.js — same contract, React-compatible.
 */

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
    const raw = localStorage.getItem('innolearn_session');
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
    localStorage.removeItem('innolearn_session');
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

export const auth = {
  login:           (credentials)  => _post('/auth/login', credentials),
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
  admissions,
  timetable,
  announcements,
  settings,
  APIError,
};

export default api;
