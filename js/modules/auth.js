/* ============================================================
   InnoLearn — Authentication & Permission Module
   Supports multiple roles per user (roles: string[])
   Backward compatible with single role: string
   ============================================================ */

const Auth = (() => {
  let _user = null;
  let _school = null;

  function _load() {
    try {
      const s = sessionStorage.getItem('ss_session') || localStorage.getItem('ss_session');
      if (s) {
        const sess = JSON.parse(s);
        _user = sess.user;
        // Always re-read school from DB so plan/branding changes apply immediately
        const freshSchool = DB.get('schools').find(sc => sc.id === (sess.school?.id || sess.school?._id));
        _school = freshSchool || sess.school;
      }
    } catch(e) { _user = null; _school = null; }
  }

  function _save(user, school, remember) {
    const sess = JSON.stringify({ user, school });
    sessionStorage.setItem('ss_session', sess);
    if (remember) localStorage.setItem('ss_session', sess);
  }

  function _resetBtn() {
    const btn = document.getElementById('login-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> <span>Sign In</span>';
  }

  function login(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('remember-me').checked;
    const btn      = document.getElementById('login-btn');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Signing in…';

    // Try server authentication first, fall back to localStorage
    _loginWithServer(email, password, remember)
      .catch(() => _loginLocal(email, password, remember));
  }

  async function _loginWithServer(email, password, remember) {
    try {
      const slug = _getSchoolSlug();
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-School-Slug': slug },
        body:    JSON.stringify({ email, password })
      });
      const data = await res.json();

      // Handle 2FA required — show OTP entry screen
      if (res.ok && data.mfaRequired) {
        _resetBtn();
        _showOTPScreen(data.userId, data.schoolId, data.hint);
        return;
      }

      // Handle pending / rejected school — show specific UI, don't fall back to local
      if (res.status === 403 && data.error === 'pending_approval') {
        _resetBtn();
        _showPendingScreen(data.message);
        return; // stop — do NOT fall through to local login
      }
      if (res.status === 403 && data.error === 'rejected') {
        _resetBtn();
        _shake();
        showToast(data.message, 'error');
        return;
      }

      if (!res.ok) throw new Error(data.message || data.error || 'Login failed');

      // Store JWT
      DB.setToken(data.token, remember);

      // Load fresh data from server into localStorage
      await DB.syncFromServer();

      _user   = data.user;
      _school = { ...data.school, ...(DB.get('schools')[0] || {}) };
      _save(_user, _school, remember);
      showToast(`Welcome back, ${data.user.name.split(' ')[0]}!`, 'success');
      App._showApp();
    } catch (err) {
      // If server not reachable, fall through to local login
      if (err.message && !err.message.match(/fetch|network|failed to fetch/i)) throw err;
      throw err;
    }
  }

  /* Show 2FA OTP entry screen */
  function _showOTPScreen(userId, schoolId, hint) {
    const loginInner = document.querySelector('.login-right-inner') || document.querySelector('.login-card');
    if (!loginInner) return;
    loginInner.style.transition = 'opacity .3s';
    loginInner.style.opacity = '0';
    setTimeout(() => {
      loginInner.innerHTML = `
        <div style="text-align:center;padding:8px 0">
          <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);
               display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:22px;color:#fff">
            <i class="fas fa-shield-halved"></i>
          </div>
          <h2 style="font-size:20px;font-weight:700;color:#111827;margin-bottom:6px">Two-step verification</h2>
          <p style="font-size:13px;color:#6b7280;margin-bottom:20px">${hint || 'A 6-digit code has been sent to your email address.'}</p>

          <div style="margin-bottom:16px">
            <label style="font-size:12px;font-weight:600;color:#374151;display:block;text-align:left;margin-bottom:6px">Enter your 6-digit code</label>
            <input id="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="— — — — — —"
              style="width:100%;padding:14px;font-size:24px;letter-spacing:10px;text-align:center;border:2px solid #e5e7eb;
                     border-radius:10px;font-family:monospace;font-weight:700;color:#4f46e5;outline:none;box-sizing:border-box"
              oninput="this.value=this.value.replace(/[^0-9]/g,'')"
              onkeydown="if(event.key==='Enter') document.getElementById('otp-btn').click()">
          </div>
          <div id="otp-error" style="display:none;margin-bottom:12px;padding:10px;background:#fef2f2;border:1px solid #fecaca;
               border-radius:8px;font-size:13px;color:#b91c1c"></div>

          <button id="otp-btn" onclick="Auth._submitOTP('${userId}','${schoolId}')"
            style="width:100%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;
                   padding:13px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:12px">
            <i class="fas fa-check"></i> Verify & Sign In
          </button>
          <button onclick="location.reload()"
            style="width:100%;background:none;border:1.5px solid #e5e7eb;padding:10px;border-radius:8px;
                   font-size:13px;color:#6b7280;cursor:pointer">
            ← Back to login
          </button>
          <p style="font-size:11px;color:#9ca3af;margin-top:14px">Code expires in 5 minutes. Check your spam folder if it doesn't arrive.</p>
        </div>`;
      loginInner.style.opacity = '1';
      setTimeout(() => document.getElementById('otp-input')?.focus(), 100);
    }, 300);
  }

  async function _submitOTP(userId, schoolId) {
    const otp = document.getElementById('otp-input')?.value.trim();
    const btn = document.getElementById('otp-btn');
    const err = document.getElementById('otp-error');
    if (!otp || otp.length !== 6) { err.textContent = 'Please enter the full 6-digit code.'; err.style.display='block'; return; }
    err.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Verifying…';

    try {
      const slug = _getSchoolSlug();
      const res  = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-School-Slug': slug },
        body: JSON.stringify({ userId, schoolId, otp })
      });
      const data = await res.json();
      if (!res.ok) {
        err.textContent = data.error || 'Verification failed.';
        err.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Verify & Sign In';
        return;
      }
      DB.setToken(data.token, false);
      await DB.syncFromServer();
      _user   = data.user;
      _school = { ...data.school, ...(DB.get('schools')[0] || {}) };
      _save(_user, _school, false);
      showToast(`Welcome back, ${data.user.name.split(' ')[0]}!`, 'success');
      App._showApp();
    } catch (e) {
      err.textContent = 'Could not verify code. Please try again.';
      err.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> Verify & Sign In';
    }
  }

  /* Show "Under Review" screen instead of login */
  function _showPendingScreen(msg) {
    const loginInner = document.querySelector('.login-right-inner') || document.querySelector('.login-card');
    if (!loginInner) return;
    loginInner.style.transition = 'opacity .3s';
    loginInner.style.opacity = '0';
    setTimeout(() => {
      loginInner.innerHTML = `
        <div style="text-align:center;padding:20px 0">
          <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);
               display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:26px;color:#fff">
            <i class="fas fa-hourglass-half"></i>
          </div>
          <h2 style="font-size:20px;font-weight:700;color:#111827;margin-bottom:10px">Application Under Review</h2>
          <p style="font-size:14px;color:#6b7280;line-height:1.6;margin-bottom:20px">${msg || 'Your school is awaiting approval. You will receive an email once approved.'}</p>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;text-align:left;font-size:13px;color:#92400e;margin-bottom:24px">
            <i class="fas fa-envelope" style="margin-right:8px"></i>
            Check your inbox for a confirmation email from <strong>innolearnnetwork@gmail.com</strong>
          </div>
          <button onclick="location.reload()" style="background:var(--primary);color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">
            <i class="fas fa-arrow-left"></i> Back to Login
          </button>
        </div>`;
      loginInner.style.opacity = '1';
    }, 300);
  }

  function _loginLocal(email, password, remember) {
    const users = DB.get('users');
    const user  = users.find(u => u.email.toLowerCase() === email && u.password === password && u.isActive);

    if (!user) { _resetBtn(); _shake(); showToast('Invalid email or password.', 'error'); return; }

    const school = DB.getById('schools', user.schoolId) || DB.get('schools')[0];
    DB.update('users', user.id, { lastLogin: new Date().toISOString() });

    _user   = { ...user, password: undefined };
    _school = school;
    _save(_user, _school, remember);

    showToast(`Welcome back, ${user.name.split(' ')[0]}!`, 'success');
    App._showApp();
  }

  function _getSchoolSlug() {
    // Extract slug from subdomain or return default
    const host  = window.location.hostname;
    const parts = host.split('.');
    if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'app') return parts[0];
    // Fallback: read from localStorage (set during school setup)
    return localStorage.getItem('ss_school_slug') || 'demo';
  }

  function logout() {
    _user = null; _school = null;
    sessionStorage.removeItem('ss_session');
    localStorage.removeItem('ss_session');
    DB.clearToken();
    location.hash = '';
    _resetBtn();
    App._showLogin();
    showToast('Logged out successfully.', 'info');
  }

  function _shake() {
    const target = document.querySelector('.login-right-inner') || document.querySelector('.login-card');
    if (!target) return;
    target.classList.add('shake');
    setTimeout(() => target.classList.remove('shake'), 600);
  }

  function isLoggedIn() { _load(); return !!_user; }

  /* ── Multi-role helpers ── */
  function _getRoles() {
    if (!_user) return [];
    // Support both new roles[] array and legacy role string
    return _user.roles || (_user.role ? [_user.role] : []);
  }

  function hasRole(role) {
    _load();
    return _getRoles().includes(role);
  }

  /* Check permission matrix from DB across ALL of the user's roles */
  function hasPermission(module, action = 'view') {
    _load();
    if (!_user) return false;
    const roles = _getRoles();
    // Super admin bypasses everything
    if (roles.includes('superadmin')) return true;
    const permTable = DB.get('role_permissions');
    for (const roleKey of roles) {
      const rp = permTable.find(r => r.roleKey === roleKey);
      if (rp?.permissions?.[module]?.[action]) return true;
    }
    return false;
  }

  /* Which modules does this user have view access to? (for nav building) */
  function visibleModules() {
    _load();
    if (!_user) return [];
    const roles = _getRoles();
    if (roles.includes('superadmin')) {
      return ['dashboard','admissions','students','classes','subjects',
              'timetable','attendance','academics','exams','finance','communication',
              'events','reports','hr','behaviour','settings'];
    }
    /* Timetabler — scoped to dashboard + timetable only */
    if (roles.includes('timetabler') && !roles.includes('admin')) {
      return ['dashboard','timetable'];
    }
    const permTable = DB.get('role_permissions');
    const seen = new Set();
    const modules = ['dashboard','admissions','students','classes','subjects',
                     'timetable','attendance','academics','exams','finance','communication',
                     'events','reports','hr','behaviour','settings'];
    const result = [];
    for (const mod of modules) {
      if (seen.has(mod)) continue;
      for (const roleKey of roles) {
        const rp = permTable.find(r => r.roleKey === roleKey);
        if (rp?.permissions?.[mod]?.view) { seen.add(mod); result.push(mod); break; }
      }
    }
    return result;
  }

  /* ── Convenience shortcuts (backward compatible) ── */
  function isSuperAdmin()         { _load(); return hasRole('superadmin'); }
  function isAdmin()              { _load(); return hasRole('superadmin') || hasRole('admin'); }
  function isPrincipal()          { _load(); return hasRole('admin'); }
  function isSectionHead()        { _load(); return hasRole('section_head'); }
  function isTeacher()            { _load(); return hasRole('teacher'); }
  function isAdmissionsOfficer()  { _load(); return hasRole('admissions_officer'); }
  function isExamsOfficer()       { _load(); return hasRole('exams_officer'); }
  function isFinance()            { _load(); return hasRole('finance'); }
  function isHR()                 { _load(); return hasRole('hr'); }
  function isTimetabler()         { _load(); return hasRole('timetabler'); }
  function isDeputyPrincipal()    { _load(); return hasRole('deputy_principal'); }
  function isDisciplineCommittee(){ _load(); return hasRole('discipline_committee'); }
  function isParent()             { _load(); return hasRole('parent'); }
  function isStudent()            { _load(); return hasRole('student'); }

  /* Section head's assigned section */
  function mySectionId()          { _load(); return _user?.sectionId || null; }

  /* Teacher record linked to current user */
  function myTeacher() {
    _load();
    if (!_user) return null;
    return DB.query('teachers', t => t.userId === _user.id)[0] || null;
  }

  /* Classes accessible to the current user based on their role(s) */
  function myClasses() {
    _load();
    if (!_user) return [];
    const roles = _getRoles();

    if (roles.includes('superadmin') || roles.includes('admin') || roles.includes('timetabler')) {
      return DB.get('classes').sort((a,b) => a.level - b.level);
    }
    if (roles.includes('section_head')) {
      const secId = mySectionId();
      const cls   = secId
        ? DB.get('classes').filter(c => c.sectionId === secId)
        : DB.get('classes');
      return cls.sort((a,b) => a.level - b.level);
    }
    if (roles.includes('teacher') || roles.includes('exams_officer')) {
      const tch = myTeacher();
      if (!tch) return [];
      // Classes where this teacher appears in timetable slots
      const ttEntries = DB.get('timetable');
      const classIds  = [...new Set(
        ttEntries
          .filter(tt => tt.slots.some(s => s.teacherId === tch.id))
          .map(tt => tt.classId)
      )];
      // Always include homeroom class even if not in timetable this term
      if (tch.homeroomClass && !classIds.includes(tch.homeroomClass)) {
        classIds.push(tch.homeroomClass);
      }
      return classIds
        .map(id => DB.getById('classes', id))
        .filter(Boolean)
        .sort((a,b) => a.level - b.level);
    }
    return DB.get('classes').sort((a,b) => a.level - b.level);
  }

  /* Subject IDs this user can access — null means ALL subjects */
  function mySubjectIds() {
    _load();
    if (!_user) return null;
    const roles = _getRoles();
    if (roles.includes('teacher')) {
      const tch = myTeacher();
      return tch ? [...(tch.subjects || [])] : null;
    }
    return null; // everyone else: all subjects
  }

  /* Whether current user is a class (homeroom) teacher */
  function isClassTeacher() {
    _load();
    return !!(myTeacher()?.homeroomClass);
  }

  /* Primary role label for display */
  function primaryRoleLabel() {
    _load();
    if (!_user) return '';
    const labels = {
      superadmin:'Super Admin', admin:'Principal', section_head:'Section Head',
      teacher:'Teacher', admissions_officer:'Admissions Officer',
      exams_officer:'Exams Officer', finance:'Finance', hr:'HR',
      timetabler:'Timetabler', deputy_principal:'Deputy Principal',
      discipline_committee:'Discipline Committee', parent:'Parent', student:'Student'
    };
    const primary = _user.primaryRole || _user.role || '';
    return labels[primary] || primary;
  }

  /* Legacy can() kept for any module that uses it */
  function can(permission) {
    _load();
    if (!_user) return false;
    if (_getRoles().includes('superadmin')) return true;
    const legacyPerms = {
      admin:   ['all'],
      finance: ['view_finance','edit_finance','view_students','view_reports'],
      teacher: ['view_students','mark_attendance','edit_grades','view_timetable','send_messages'],
      parent:  ['view_own_children','view_finance','view_events','send_messages'],
      student: ['view_own_profile','view_timetable','view_own_grades','view_events','send_messages']
    };
    const roles = _getRoles();
    for (const r of roles) {
      const p = legacyPerms[r] || [];
      if (p.includes('all') || p.includes(permission)) return true;
    }
    return false;
  }

  return {
    login, logout, isLoggedIn, can, hasRole, hasPermission, visibleModules,
    _submitOTP,  // exposed for inline onclick
    isSuperAdmin, isAdmin, isPrincipal, isSectionHead, isTeacher,
    isAdmissionsOfficer, isExamsOfficer, isFinance, isHR, isTimetabler,
    isDeputyPrincipal, isDisciplineCommittee, isParent, isStudent,
    mySectionId, myTeacher, myClasses, mySubjectIds, isClassTeacher, primaryRoleLabel,
    get currentUser()  { _load(); return _user;   },
    get currentSchool(){ _load(); return _school; }
  };
})();
