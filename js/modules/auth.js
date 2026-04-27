/* ============================================================
   SchoolSync — Authentication & Permission Module
   Supports multiple roles per user (roles: string[])
   Backward compatible with single role: string
   ============================================================ */

const Auth = (() => {
  let _user = null;
  let _school = null;

  function _load() {
    try {
      const s = sessionStorage.getItem('ss_session') || localStorage.getItem('ss_session');
      if (s) { const sess = JSON.parse(s); _user = sess.user; _school = sess.school; }
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

  function logout() {
    _user = null; _school = null;
    sessionStorage.removeItem('ss_session');
    localStorage.removeItem('ss_session');
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
    isSuperAdmin, isAdmin, isPrincipal, isSectionHead, isTeacher,
    isAdmissionsOfficer, isExamsOfficer, isFinance, isHR, isTimetabler,
    isDeputyPrincipal, isDisciplineCommittee, isParent, isStudent,
    mySectionId, myTeacher, myClasses, mySubjectIds, isClassTeacher, primaryRoleLabel,
    get currentUser()  { _load(); return _user;   },
    get currentSchool(){ _load(); return _school; }
  };
})();
