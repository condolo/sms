/* ============================================================
   SchoolSync — App Core (Router, Utilities, Navigation)
   ============================================================ */

const App = (() => {
  const ROUTES = {
    dashboard:     () => Dashboard.render(),
    admissions:    (p) => Admissions.render(p),
    apply:         (p) => Admissions.renderPublicForm(p),
    students:      (p) => Students.render(p),
    'students/new':(p) => Students.renderNew(p),
    teachers:      (p) => HR.render(p),   // redirected — Teachers merged into HR
    classes:       (p) => Classes.render(p),
    subjects:      (p) => Subjects.render(p),
    timetable:     (p) => Timetable.render(p),
    attendance:    (p) => Attendance.render(p),
    academics:     (p) => Academics.render(p),
    finance:       (p) => Finance.render(p),
    communication: (p) => Communication.render(p),
    events:        (p) => Events.render(p),
    reports:       (p) => Reports.render(p),
    settings:      (p) => Settings.render(p),
    exams:         (p) => (typeof Exams !== 'undefined' ? Exams.render(p) : _moduleComingSoon('Exams')),
    hr:            (p) => (typeof HR        !== 'undefined' ? HR.render(p)        : _moduleComingSoon('HR & Staff')),
    behaviour:     (p) => (typeof Behaviour  !== 'undefined' ? Behaviour.render(p)  : _moduleComingSoon('Behaviour & Pastoral')),
    changelog:     ()  => (typeof Changelog  !== 'undefined' ? Changelog.render()   : _moduleComingSoon('Changelog')),
    help:          ()  => (typeof Help       !== 'undefined' ? Help.render()        : _moduleComingSoon('Help Centre')),
  };

  /* ── Master list of all modules with their nav metadata ── */
  const NAV_ITEMS = {
    dashboard:          { icon:'fas fa-th-large',           label:'Dashboard',           route:'dashboard' },
    admissions:         { icon:'fas fa-file-import',        label:'Admissions',          route:'admissions' },
    students:           { icon:'fas fa-user-graduate',      label:'Students',            route:'students' },
    // teachers removed from nav — merged into HR & Staff module
    classes:            { icon:'fas fa-door-open',          label:'Classes',             route:'classes' },
    subjects:           { icon:'fas fa-book',               label:'Subjects',            route:'subjects' },
    timetable:          { icon:'fas fa-calendar-alt',       label:'Timetable',           route:'timetable' },
    attendance:         { icon:'fas fa-clipboard-check',    label:'Attendance',          route:'attendance' },
    academics:          { icon:'fas fa-graduation-cap',     label:'Academics',           route:'academics' },
    exams:              { icon:'fas fa-file-alt',           label:'Exams',               route:'exams' },
    finance:            { icon:'fas fa-coins',              label:'Finance',             route:'finance' },
    communication:      { icon:'fas fa-comment-dots',       label:'Communication',       route:'communication' },
    events:             { icon:'fas fa-calendar',           label:'Events & Calendar',   route:'events' },
    reports:            { icon:'fas fa-chart-bar',          label:'Reports & Analytics', route:'reports' },
    hr:                 { icon:'fas fa-id-card',            label:'HR & Staff',          route:'hr' },
    behaviour:          { icon:'fas fa-shield-alt',         label:'Behaviour & Pastoral',route:'behaviour' },
    settings:           { icon:'fas fa-cog',                label:'Settings',            route:'settings' },
    changelog:          { icon:'fas fa-history',            label:'Changelog',           route:'changelog' },
    help:               { icon:'fas fa-question-circle',    label:'Help Centre',         route:'help' },
  };

  /* NAV is now built dynamically from role_permissions — kept for legacy fallback only */
  const NAV = {};

  let _currentRoute = 'dashboard';
  let _sidebarOpen = true;

  function init() {
    window.addEventListener('hashchange', _handleHash);
    document.addEventListener('click', _globalClick);
    // Public admission form route — accessible without login
    const initRoute = location.hash.replace('#','').split('/')[0];
    if (initRoute === 'apply') {
      _showPublicForm();
      return;
    }
    if (Auth.isLoggedIn()) {
      _showApp();
    } else {
      _showLogin();
    }
  }

  function _handleHash() {
    const route = location.hash.replace('#', '').split('/')[0];
    // Allow public admission form without login
    if (route === 'apply') { _showPublicForm(); return; }
    if (!Auth.isLoggedIn()) return;
    const hash  = location.hash.replace('#', '').split('/');
    const param = hash[1] || null;
    _render(route, param);
  }

  function _showPublicForm() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    // Render the public form into body directly
    let pf = document.getElementById('public-form-screen');
    if (!pf) {
      pf = document.createElement('div');
      pf.id = 'public-form-screen';
      document.body.appendChild(pf);
    }
    pf.style.display = 'block';
    const token = location.hash.replace('#','').split('/')[1] || '';
    Admissions.renderPublicForm(token, pf);
  }

  function navigate(route, param) {
    location.hash = param ? `${route}/${param}` : route;
  }

  function _render(route, param) {
    _currentRoute = route;
    const fn = ROUTES[param ? `${route}/${param}` : route] || ROUTES[route];
    const content = document.getElementById('page-content');
    if (fn && content) {
      content.innerHTML = '<div class="page-loading"><div class="page-loading-spinner"></div><span style="font-size:13px;color:var(--gray-400)">Loading…</span></div>';
      setTimeout(() => { fn(param); }, 60);
    }
    _updateActiveNav(route);
  }

  function renderPage(html) {
    const el = document.getElementById('page-content');
    if (el) el.innerHTML = html;
  }

  function _moduleComingSoon(name) {
    renderPage(`<div class="empty-state" style="padding:60px 0"><i class="fas fa-tools" style="font-size:48px;color:var(--gray-300);margin-bottom:16px"></i><h3 style="color:var(--gray-500)">${name}</h3><p style="color:var(--gray-400)">This module is coming soon.</p></div>`);
  }

  function setBreadcrumb(text) {
    const el = document.getElementById('breadcrumb');
    if (el) el.innerHTML = text;
  }

  function _showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    _buildSidebar();
    _buildNotifications();
    const user = Auth.currentUser;
    document.getElementById('sidebar-user-name').textContent = user.name;
    document.getElementById('sidebar-user-role').textContent = Auth.primaryRoleLabel();
    document.getElementById('sidebar-avatar').textContent = user.name.charAt(0);
    document.getElementById('topbar-avatar').textContent = user.name.charAt(0);
    const topbarName = document.getElementById('topbar-name');
    if (topbarName) topbarName.textContent = user.name.split(' ')[0];
    const umHeader = document.getElementById('um-header-name');
    if (umHeader) umHeader.textContent = user.name;
    const school = Auth.currentSchool;
    document.getElementById('sidebar-school-name').textContent = school ? school.shortName : 'SchoolSync';
    // Navigate: if no hash set, go to dashboard; otherwise render current hash
    const hash = location.hash.replace('#', '').split('/')[0];
    if (!hash) {
      navigate('dashboard');
    } else {
      _handleHash();
    }
  }

  function _showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  }

  function _buildSidebar() {
    const mods = Auth.visibleModules();
    const nav  = document.getElementById('sidebar-nav');
    const role = Auth.currentUser ? Auth.currentUser.role : '';

    let html = mods.map(mod => {
      const item = NAV_ITEMS[mod];
      if (!item) return '';
      return `<a class="nav-item" href="#${item.route}" data-route="${item.route}">
      <i class="${item.icon}"></i><span>${item.label}</span>
    </a>`;
    }).join('');

    /* ── Always-visible bottom links (not gated by role_permissions) ── */
    html += `<div class="nav-divider" style="margin:8px 12px;border-top:1px solid rgba(255,255,255,.1)"></div>`;

    /* Changelog — admin/superadmin only */
    if (['superadmin','admin'].includes(role)) {
      const cl = NAV_ITEMS.changelog;
      html += `<a class="nav-item" href="#${cl.route}" data-route="${cl.route}">
        <i class="${cl.icon}"></i><span>${cl.label}</span>
      </a>`;
    }

    /* Help Centre — all logged-in roles */
    const hlp = NAV_ITEMS.help;
    html += `<a class="nav-item" href="#${hlp.route}" data-route="${hlp.route}">
      <i class="${hlp.icon}"></i><span>${hlp.label}</span>
    </a>`;

    nav.innerHTML = html;
  }

  function _updateActiveNav(route) {
    // teachers route is merged into hr — highlight hr nav item for both
    const activeRoute = route === 'teachers' ? 'hr' : route;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === activeRoute);
    });
  }

  function _buildNotifications() {
    const msgs = DB.get('messages').filter(m =>
      m.recipients.includes('all') ||
      m.recipients.includes(Auth.currentUser.role + 's') ||
      m.recipients.includes(Auth.currentUser.id)
    ).slice(0, 5);

    const list = document.getElementById('notifications-list');
    const badge = document.getElementById('notif-badge');
    if (!list) return;

    list.innerHTML = msgs.length ? msgs.map(m => `
      <div class="notif-item" onclick="App.navigate('communication')">
        <div class="notif-icon"><i class="fas fa-bell"></i></div>
        <div class="notif-body">
          <p>${m.subject}</p>
          <span>${_timeAgo(m.createdAt)}</span>
        </div>
      </div>
    `).join('') : '<div class="notif-empty">No new notifications</div>';

    badge.textContent = msgs.length;
    badge.style.display = msgs.length ? 'flex' : 'none';
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const isOpen = sidebar.classList.contains('mobile-open');
      sidebar.classList.toggle('mobile-open', !isOpen);
      if (overlay) overlay.classList.toggle('show', !isOpen);
    } else {
      _sidebarOpen = !_sidebarOpen;
      sidebar.classList.toggle('collapsed', !_sidebarOpen);
      document.querySelector('.main-content').classList.toggle('sidebar-collapsed', !_sidebarOpen);
    }
  }

  function _globalClick(e) {
    if (!e.target.closest('.notif-wrap')) {
      const dd = document.getElementById('notification-dropdown');
      if (dd) dd.classList.remove('open');
    }
    if (!e.target.closest('.topbar-profile')) {
      const um = document.getElementById('user-menu');
      if (um) um.classList.remove('open');
    }
  }

  function globalSearch(val) {
    if (!val || val.length < 2) return;
    const q = val.toLowerCase();
    const students = DB.get('students').filter(s =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q)
    );
    if (students.length === 1) navigate('students', students[0].id);
  }

  /* ─── Utilities ─── */
  function _capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function _timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff/60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h/24)}d ago`;
  }

  return { init, navigate, renderPage, setBreadcrumb, toggleSidebar, globalSearch, _showApp, _showLogin };
})();

/* ─── Global Utilities ─── */
function showToast(msg, type = 'success') {
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success:'check-circle', error:'exclamation-circle', warning:'exclamation-triangle', info:'info-circle' };
  t.innerHTML = `<i class="fas fa-${icons[type]||'info-circle'}"></i><span>${msg}</span>`;
  tc.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

function openModal(html, size = '') {
  const overlay = document.getElementById('modal-overlay');
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  content.innerHTML = html;
  container.className = `modal-container ${size}`;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  _closeModal();
}

function _closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  setTimeout(() => overlay.classList.add('hidden'), 250);
}

function togglePassword() {
  const inp = document.getElementById('login-password');
  const icon = document.getElementById('eye-icon');
  if (inp.type === 'password') { inp.type = 'text'; icon.className = 'fas fa-eye-slash'; }
  else { inp.type = 'password'; icon.className = 'fas fa-eye'; }
}

function fillDemo(role) {
  const creds = {
    superadmin:  { email:'superadmin@meridian.edu.ke',      pass:'super123' },
    admin:       { email:'admin@meridian.edu.ke',           pass:'admin123' },
    teacher:     { email:'sarah.smith@meridian.edu.ke',     pass:'teacher123' },
    admissions:  { email:'admissions@meridian.edu.ke',      pass:'admissions123' },
    finance:     { email:'finance@meridian.edu.ke',         pass:'finance123' },
    parent:      { email:'parent1@meridian.edu.ke',         pass:'parent123' },
    student:     { email:'student1@meridian.edu.ke',        pass:'student123' },
    hr:          { email:'hr@meridian.edu.ke',              pass:'hr123' },
    section_sec: { email:'head.secondary@meridian.edu.ke',  pass:'section123' },
    deputy:      { email:'deputy@meridian.edu.ke',          pass:'deputy123' },
    discipline:  { email:'discipline@meridian.edu.ke',      pass:'discipline123' }
  };
  const c = creds[role];
  if (c) {
    document.getElementById('login-email').value    = c.email;
    document.getElementById('login-password').value = c.pass;
  }
}

function toggleNotifications() {
  const dd = document.getElementById('notification-dropdown');
  if (dd) dd.classList.toggle('open');
}

function markAllRead() {
  document.getElementById('notif-badge').style.display = 'none';
}

function toggleUserMenu() {
  const um = document.getElementById('user-menu');
  if (um) um.classList.toggle('open');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtMoney(n, sym = 'KSh') {
  if (n == null) return '—';
  return `${sym} ${Number(n).toLocaleString()}`;
}

function fmtPct(n) {
  return n != null ? `${Number(n).toFixed(1)}%` : '—';
}

function gradeColor(pct) {
  if (pct >= 90) return 'success';
  if (pct >= 75) return 'primary';
  if (pct >= 60) return 'warning';
  return 'danger';
}

function statusBadge(status) {
  const map = {
    active:'success', paid:'success', present:'success', good:'success',
    partial:'warning', late:'warning', pending:'warning', overdue:'danger',
    absent:'danger', inactive:'danger',
    graduated:'info', transferred:'secondary', withdrawn:'secondary'
  };
  return map[status] || 'secondary';
}

function avatar(name, role) {
  const colors = { admin:'#2563EB', teacher:'#7C3AED', parent:'#059669', student:'#D97706', finance:'#DC2626' };
  const bg = colors[role] || '#64748B';
  return `<div class="avatar-circle" style="background:${bg}">${name.charAt(0).toUpperCase()}</div>`;
}

function confirmAction(msg, fn) {
  if (confirm(msg)) fn();
}

/* ─────────────────────────────────────────────────────────────
   Global Utility Functions
   ───────────────────────────────────────────────────────────── */

/**
 * _audit(action, details)
 * Appends an immutable audit log entry to the 'audit_log' collection.
 * Called internally — never throws or shows UI feedback.
 *
 * Targeted operations:
 *   STUDENT_UPDATED      · STUDENT_DELETED
 *   PAYMENT_RECORDED
 *   APPEAL_RESOLVED
 *   ACADEMIC_YEAR_CHANGED · TERM_CHANGED
 *   PERMISSION_CHANGED
 *   ACADEMIC_YEAR_DELETED
 *
 * @param {string} action  — one of the constants above
 * @param {object} details — free-form context (IDs, names, amounts, etc.)
 */
function _audit(action, details = {}) {
  try {
    const user = (typeof Auth !== 'undefined' && Auth.currentUser) ? Auth.currentUser : null;
    DB.insert('audit_log', {
      action,
      performedBy:   user ? user.id   : 'system',
      performedByName: user ? user.name : 'System',
      performedAt:   new Date().toISOString(),
      details
    });
  } catch (e) {
    /* Audit must never break the primary action */
    console.warn('[audit] failed to log', action, e);
  }
}

/**
 * assert(condition, message)
 * Throws a descriptive error if `condition` is falsy.
 * Use before DB.insert / DB.update to catch bad data early.
 *
 * @param {*}      condition  — truthy = ok, falsy = throw
 * @param {string} message    — human-readable description of the problem
 */
function assert(condition, message) {
  if (!condition) {
    const err = new Error(`[SchoolSync] Assertion failed: ${message}`);
    console.error(err);
    throw err;
  }
}

/**
 * safe(fn, label)
 * Wraps a UI action handler so that unexpected errors show a toast
 * instead of silently swallowing the exception or crashing the page.
 *
 * Usage: onclick="safe(() => MyModule.doThing(), 'doThing')"
 *
 * @param {Function} fn     — the action to run
 * @param {string}   label  — shown in the error toast (optional)
 */
function safe(fn, label = 'action') {
  try {
    fn();
  } catch (err) {
    console.error(`[SchoolSync] Error in ${label}:`, err);
    showToast(`Something went wrong (${label}). See console for details.`, 'error');
  }
}

/**
 * isOverlapping(aStart, aEnd, bStart, bEnd)
 * Returns true when time range [aStart, aEnd) overlaps [bStart, bEnd).
 * All values are HH:MM strings (24-hour), e.g. '09:00', '10:30'.
 * A range that ends exactly when another starts is NOT an overlap.
 *
 * @param {string} aStart
 * @param {string} aEnd
 * @param {string} bStart
 * @param {string} bEnd
 * @returns {boolean}
 */
function isOverlapping(aStart, aEnd, bStart, bEnd) {
  const toMins = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const aS = toMins(aStart), aE = toMins(aEnd);
  const bS = toMins(bStart), bE = toMins(bEnd);
  return aS < bE && bS < aE;
}

/* Boot */
document.addEventListener('DOMContentLoaded', () => App.init());
