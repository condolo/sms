/* ============================================================
   InnoLearn — Frontend API Client  (js/api.js)

   Centralised fetch wrapper for all server-side resource routes.
   Replaces direct DB.get() / DB.save() calls in feature modules.

   Usage:
     const { data, pagination } = await API.students.list({ page: 1, classId: 'cls_1' });
     const student = await API.students.get('stu_abc');
     const created = await API.students.create({ firstName: 'Ada', ... });
     await API.students.update('stu_abc', { status: 'inactive' });
     await API.students.remove('stu_abc');

   Error handling:
     API methods throw an APIError on non-success responses.
     Catch it with:
       try { ... } catch(e) { if (e instanceof APIError) showToast(e.message); }

   Loading states:
     Each namespace exposes loading/error state if needed, but
     simple boolean spinners can just wrap await calls.
   ============================================================ */

/* ── Custom error class ─────────────────────────────────────── */
class APIError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name      = 'APIError';
    this.code      = code;
    this.status    = status;
  }
}

/* ── Core fetch wrapper ─────────────────────────────────────── */
const API = (() => {
  const BASE = '/api';

  /* Get the current JWT from localStorage */
  function _token() {
    try {
      const session = JSON.parse(localStorage.getItem('innolearn_session') || '{}');
      return session.token || null;
    } catch { return null; }
  }

  /* Build a URL with optional query params */
  function _url(path, params) {
    const url = `${BASE}${path}`;
    if (!params || !Object.keys(params).length) return url;
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    });
    const s = qs.toString();
    return s ? `${url}?${s}` : url;
  }

  /* Core HTTP request */
  async function _req(method, path, body = null, params = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token   = _token();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(_url(path, params), opts);
    } catch (netErr) {
      throw new APIError('NETWORK_ERROR', 'Network request failed. Check your connection.', 0);
    }

    // Handle 401 — session expired
    if (res.status === 401) {
      // Dispatch a custom event so the app can redirect to login
      window.dispatchEvent(new CustomEvent('api:unauthorized'));
      throw new APIError('UNAUTHENTICATED', 'Your session has expired. Please log in again.', 401);
    }

    let json;
    try { json = await res.json(); }
    catch { throw new APIError('PARSE_ERROR', 'Invalid server response', res.status); }

    if (json.success === false || !res.ok) {
      const err = json.error || {};
      throw new APIError(err.code || 'SERVER_ERROR', err.message || 'An error occurred', res.status);
    }

    // Return { data, pagination } for list responses; data directly for single items
    return {
      data:       json.data,
      pagination: json.pagination || null,
      raw:        json
    };
  }

  /* ── Convenience helpers ────────────────────────────────────── */
  const _get    = (path, params) => _req('GET', path, null, params);
  const _post   = (path, body)   => _req('POST', path, body);
  const _put    = (path, body)   => _req('PUT', path, body);
  const _patch  = (path, body)   => _req('PATCH', path, body);
  const _delete = (path)         => _req('DELETE', path);

  /* ── Resource namespace factory ─────────────────────────────── */
  /**
   * Creates a standard CRUD namespace for a resource.
   * @param {string} resource - API path segment, e.g. 'students'
   */
  function _resource(resource) {
    return {
      list:   (params)      => _get(`/${resource}`, params),
      get:    (id)          => _get(`/${resource}/${id}`),
      create: (data)        => _post(`/${resource}`, data),
      update: (id, data)    => _put(`/${resource}/${id}`, data),
      patch:  (id, data)    => _patch(`/${resource}/${id}`, data),
      remove: (id)          => _delete(`/${resource}/${id}`),
      bulk:   (data)        => _post(`/${resource}/bulk`, data),
    };
  }

  /* ════════════════════════════════════════════════════════════
     Module Namespaces
     ════════════════════════════════════════════════════════════ */

  /* ── Students ───────────────────────────────────────────────── */
  const students = {
    ..._resource('students'),
    bulkImport: (data) => _post('/students/bulk', data),
  };

  /* ── Teachers ───────────────────────────────────────────────── */
  const teachers = _resource('teachers');

  /* ── Classes ────────────────────────────────────────────────── */
  const classes = {
    ..._resource('classes'),
    students: (classId, params) => _get(`/classes/${classId}/students`, params),
  };

  /* ── Attendance ─────────────────────────────────────────────── */
  const attendance = {
    ..._resource('attendance'),
    bulkMark: (data)   => _post('/attendance/bulk', data),
    summary:  (params) => _get('/attendance/summary', params),
  };

  /* ── Finance ────────────────────────────────────────────────── */
  const finance = {
    invoices: {
      list:   (params)   => _get('/finance/invoices', params),
      get:    (id)       => _get(`/finance/invoices/${id}`),
      create: (data)     => _post('/finance/invoices', data),
      update: (id, data) => _put(`/finance/invoices/${id}`, data),
      void:   (id)       => _delete(`/finance/invoices/${id}`),
    },
    payments: {
      list:   (params) => _get('/finance/payments', params),
      record: (data)   => _post('/finance/payments', data),
    },
    summary:  (params) => _get('/finance/summary', params),
  };

  /* ── Behaviour ──────────────────────────────────────────────── */
  const behaviour = {
    incidents: {
      list:    (params)   => _get('/behaviour/incidents', params),
      get:     (id)       => _get(`/behaviour/incidents/${id}`),
      create:  (data)     => _post('/behaviour/incidents', data),
      update:  (id, data) => _put(`/behaviour/incidents/${id}`, data),
      remove:  (id)       => _delete(`/behaviour/incidents/${id}`),
      summary: (params)   => _get('/behaviour/incidents/summary', params),
    },
    appeals: {
      list:   (params)   => _get('/behaviour/appeals', params),
      create: (data)     => _post('/behaviour/appeals', data),
      update: (id, data) => _put(`/behaviour/appeals/${id}`, data),
    },
    categories: {
      list:   (params)   => _get('/behaviour/categories', params),
      create: (data)     => _post('/behaviour/categories', data),
      update: (id, data) => _put(`/behaviour/categories/${id}`, data),
      remove: (id)       => _delete(`/behaviour/categories/${id}`),
    },
  };

  /* ── Exams ──────────────────────────────────────────────────── */
  const exams = {
    ..._resource('exams'),
    results: {
      forExam:   (examId, params) => _get(`/exams/${examId}/results`, params),
      bulkEnter: (examId, data)   => _post(`/exams/${examId}/results`, data),
      all:       (params)         => _get('/exams/results/all', params),
    },
  };

  /* ── Grades ─────────────────────────────────────────────────── */
  const grades = {
    ..._resource('grades'),
    bulkSave: (data)   => _post('/grades/bulk', data),
    report:   (params) => _get('/grades/report', params),
  };

  /* ── Admissions ─────────────────────────────────────────────── */
  const admissions = {
    ..._resource('admissions'),
    stats:       (params)   => _get('/admissions/stats', params),
    changeStage: (id, data) => _patch(`/admissions/${id}/stage`, data),
  };

  /* ── Timetable ──────────────────────────────────────────────── */
  const timetable = {
    ..._resource('timetable'),
    forClass:   (classId, params)   => _get(`/timetable/class/${classId}`, params),
    forTeacher: (teacherId, params) => _get(`/timetable/teacher/${teacherId}`, params),
    bulkSet:    (data)              => _post('/timetable/bulk', data),
  };

  /* ── Auth ───────────────────────────────────────────────────── */
  const auth = {
    login:       (credentials) => _post('/auth/login', credentials),
    me:          ()            => _get('/auth/me'),
    changePassword: (data)    => _post('/auth/change-password', data),
    forceChange: (data)       => _post('/auth/force-change', data),
  };

  /* ── Messages (persistent, MongoDB-backed) ──────────────────── */
  const messages = {
    list:    (params) => _get('/messages', params),      // { tab: 'inbox'|'sent', page }
    send:    (data)   => _post('/messages', data),        // { subject, body, recipients, type }
    markRead:(id)     => _patch(`/messages/${id}/read`),
    remove:  (id)     => _delete(`/messages/${id}`),
  };

  /* ── Announcements ──────────────────────────────────────────── */
  const announcements = {
    list:    ()   => _get('/announcements'),
    dismiss: (id) => _post(`/announcements/${id}/dismiss`),
  };

  /* ── Backup ─────────────────────────────────────────────────── */
  const backup = {
    preview: () => _get('/backup/preview'),
    history: () => _get('/backup/history'),
    // Note: export is handled separately (binary blob) — see Dashboard.createBackup()
  };

  /* ── Collections (legacy) ───────────────────────────────────── */
  /**
   * Legacy accessor — wraps /api/collections/:col
   * Use this only during migration. Prefer named module methods above.
   * @param {string} col - Collection name
   * @deprecated Will be removed when all modules migrate to resource routes
   */
  const collections = {
    list:   (col, params) => _get(`/collections/${col}`, params),
    create: (col, data)   => _post(`/collections/${col}`, data),
    update: (col, id, data) => _put(`/collections/${col}/${id}`, data),
    remove: (col, id)     => _delete(`/collections/${col}/${id}`),
    bulk:   (col, data)   => _post(`/collections/${col}/bulk`, data),
  };

  /* ── Health check ───────────────────────────────────────────── */
  const health = () => _get('/health');

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    APIError,
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
    auth,
    messages,
    announcements,
    backup,
    collections,
    health,
    // Expose internals for custom calls
    _get, _post, _put, _patch, _delete,
  };
})();

/* ── Global 401 handler — redirect to login on session expiry ── */
window.addEventListener('api:unauthorized', () => {
  // Only redirect if currently showing the app (not already on login)
  if (document.getElementById('app-shell')?.style.display !== 'none') {
    localStorage.removeItem('innolearn_session');
    // Use existing Auth module if available, otherwise reload
    if (typeof Auth !== 'undefined' && Auth.logout) {
      Auth.logout();
    } else {
      location.reload();
    }
  }
});
