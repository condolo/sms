/* ============================================================
   SchoolSync — Timetable Module v3
   Sub-modules: Class View · Teacher View · Master Grid ·
                Conflicts · Substitutions · Assignments · Rules
   ============================================================ */

const Timetable = (() => {

  /* ─── Constants ─── */
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

  /* Default periods (Secondary-style 60 min) — used as fallback when no bell schedule set */
  const DEFAULT_PERIODS = [
    { p:1,   start:'07:30', end:'08:30', isBreak:false, label:'Period 1' },
    { p:2,   start:'08:30', end:'09:30', isBreak:false, label:'Period 2' },
    { p:3,   start:'09:30', end:'10:30', isBreak:false, label:'Period 3' },
    { p:'B', start:'10:30', end:'11:00', isBreak:true,  label:'Short Break' },
    { p:4,   start:'11:00', end:'12:00', isBreak:false, label:'Period 4' },
    { p:5,   start:'12:00', end:'13:00', isBreak:false, label:'Period 5' },
    { p:'L', start:'13:00', end:'14:00', isBreak:true,  label:'Lunch Break' },
    { p:6,   start:'14:00', end:'15:00', isBreak:false, label:'Period 6' },
    { p:7,   start:'15:00', end:'16:00', isBreak:false, label:'Period 7' },
  ];

  /* ─── Bell Schedule Helpers ─── */

  /* Get bell schedule object for a section (returns null if not configured) */
  function _getBSForSection(sectionId) {
    if (!sectionId) return null;
    const sec = DB.getById('sections', sectionId);
    if (!sec?.bellScheduleId) return null;
    const bs = DB.getById('bell_schedules', sec.bellScheduleId);
    return (bs?.periods?.length) ? bs : null;
  }

  /* All periods (lessons + breaks) for a class */
  function _getPeriodsForClass(classId) {
    const cls = DB.getById('classes', classId);
    const bs  = _getBSForSection(cls?.sectionId);
    return bs ? bs.periods : DEFAULT_PERIODS;
  }

  /* Lesson-only periods for a class */
  function _getLessonPeriodsForClass(classId) {
    return _getPeriodsForClass(classId).filter(p => !p.isBreak);
  }

  /* Is admin or timetabler (timetable manager) */
  function _isTT() { return Auth.isAdmin() || Auth.isTimetabler(); }

  /* Convert HH:MM time string to total minutes */
  function _toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

  /* Add N minutes to a HH:MM time string, returns HH:MM */
  function _addMinutes(t, n) {
    const total = _toMin(t) + n;
    const h = Math.floor(total / 60), m = total % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  /* True if two time ranges overlap */
  function _timesOverlap(s1, e1, s2, e2) {
    return _toMin(s1) < _toMin(e2) && _toMin(s2) < _toMin(e1);
  }

  /* Effective end time — extends by transition buffer if enabled */
  function _effectiveEnd(end, rules) {
    if (rules?.transitionEnabled && rules?.transitionMinutes > 0) {
      return _addMinutes(end, rules.transitionMinutes);
    }
    return end;
  }

  /* Core subject IDs — derived live from DB so new core subjects are included */
  function _coreSubjectIds() { return DB.get('subjects').filter(s => s.isCore).map(s => s.id); }

  /* Room mapping: subject-name keyword → default room */
  const ROOM_MAP = {
    'biology':          'Science Lab 1',
    'chemistry':        'Chemistry Lab',
    'physics':          'Physics Lab',
    'science':          'Science Lab 2',
    'computer science': 'ICT Lab 1',
    'ict':              'ICT Lab 1',
    'computing':        'ICT Lab 1',
    'art':              'Art Room',
    'music':            'Music Room',
    'physical education':'PE Hall / Field',
    'pe':               'PE Hall / Field',
    'sports':           'Sports Field',
  };

  /* ─── Module State ─── */
  let _view      = 'class';
  let _classId   = null;
  let _teacherId = null;
  let _editMode  = false;

  /* ═══════════════════════════════════════════════════════════
     ENTRY POINT
  ═══════════════════════════════════════════════════════════ */

  function render(param) {
    App.setBreadcrumb('<i class="fas fa-calendar-alt"></i> Timetable');

    if (Auth.isStudent()) {
      const stu = DB.query('students', s => s.userId === Auth.currentUser.id)[0];
      if (stu) { _classId = stu.classId; _view = 'class'; }
    } else if (Auth.isTimetabler() && !Auth.isAdmin()) {
      /* Timetabler lands on bell_schedules as their home tab */
      if (!_view || _view === 'class') _view = 'bell_schedules';
    } else if (Auth.isTeacher()) {
      const tch = DB.query('teachers', t => t.userId === Auth.currentUser.id)[0];
      if (tch) { _teacherId = tch.id; if (!_classId) _view = 'teacher'; }
    }

    const allClasses  = DB.get('classes');
    const allTeachers = DB.get('teachers');
    if (!_classId)   _classId   = allClasses[0]?.id   || null;
    if (!_teacherId) _teacherId = allTeachers[0]?.id  || null;

    _renderPage();
  }

  function _renderPage() {
    const isTT      = _isTT();
    const isTeacher = Auth.isTeacher();
    const conflicts = _detectConflicts();
    const school    = Auth.currentSchool;
    const termLabel = school ? `Term ${school.currentTermId?.replace('term','') || '?'}` : '';

    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1><i class="fas fa-calendar-alt" style="color:var(--primary);margin-right:10px;font-size:20px"></i>Timetable</h1>
        <p>${termLabel ? termLabel + ' · ' : ''}${school?.name || 'Meridian International School'}</p>
      </div>
      <div class="page-actions">
        ${isTT ? `
          <button class="btn btn-secondary" onclick="Timetable.exportCSV()"><i class="fas fa-file-csv"></i> Export CSV</button>
          <button class="btn btn-secondary" onclick="Timetable.printCurrent()"><i class="fas fa-print"></i> Print</button>
          <button class="btn btn-primary" onclick="Timetable.showGenerate()"><i class="fas fa-magic"></i> Auto-Generate</button>
        ` : `
          <button class="btn btn-secondary" onclick="Timetable.printCurrent()"><i class="fas fa-print"></i> Print</button>
        `}
      </div>
    </div>

    <div class="tt-tab-nav">
      ${_buildTabs(isTT, isTeacher, conflicts.length)}
    </div>

    <div id="tt-view-content">
      ${_renderView()}
    </div>`);
  }

  function _buildTabs(isTT, isTeacher, conflictCount) {
    const tabs = [
      { key:'class',          label:'Class View',        icon:'fas fa-door-open',            show: true },
      { key:'teacher',        label:'Teacher View',      icon:'fas fa-chalkboard-teacher',   show: isTT || isTeacher },
      { key:'master',         label:'Master Grid',       icon:'fas fa-th',                   show: isTT },
      { key:'conflicts',      label:'Conflicts',         icon:'fas fa-exclamation-triangle', show: isTT, badge: conflictCount },
      { key:'substitutions',  label:'Substitutions',     icon:'fas fa-exchange-alt',         show: isTT || isTeacher },
      { key:'assignments',    label:'Assignments',       icon:'fas fa-user-tag',             show: isTT },
      { key:'bell_schedules', label:'Bell Schedules',    icon:'fas fa-bell',                 show: isTT },
      { key:'rules',          label:'Generation Rules',  icon:'fas fa-sliders-h',            show: isTT },
    ];
    return tabs.filter(t => t.show).map(t => `
      <button class="tt-tab ${_view === t.key ? 'active' : ''}" onclick="Timetable.setView('${t.key}')">
        <i class="${t.icon}"></i><span>${t.label}</span>
        ${t.badge ? `<span class="tt-tab-badge">${t.badge}</span>` : ''}
      </button>`).join('');
  }

  function _renderView() {
    switch (_view) {
      case 'class':          return _classView();
      case 'teacher':        return _teacherView();
      case 'master':         return _masterView();
      case 'conflicts':      return _conflictsView();
      case 'substitutions':  return _substitutionsView();
      case 'assignments':    return _assignmentsView();
      case 'bell_schedules': return _bellSchedulesView();
      case 'rules':          return _rulesView();
      default:               return _classView();
    }
  }

  /* ═══════════════════════════════════════════════════════════
     CLASS VIEW
  ═══════════════════════════════════════════════════════════ */

  function _classView() {
    const classes = _getMyClasses();
    if (!classes.length) return `<div class="empty-state"><i class="fas fa-calendar-alt"></i><p>No classes available.</p></div>`;
    if (!_classId || !classes.find(c => c.id === _classId)) _classId = classes[0].id;

    const cls         = DB.getById('classes', _classId);
    const tt          = DB.query('timetable', t => t.classId === _classId)[0];
    const slots       = tt?.slots || [];
    const isTT        = _isTT();
    const assigned    = DB.query('teacher_assignments', a => a.classId === _classId);
    const lessonPds   = _getLessonPeriodsForClass(_classId);
    const coverage    = Math.round((slots.length / (lessonPds.length * DAYS.length)) * 100);

    return `
    <div class="card">
      <div class="tt-toolbar">
        <div class="tt-selector-row">
          <div class="tt-selector-wrap">
            <label><i class="fas fa-door-open"></i> Class</label>
            <select class="tt-select" onchange="Timetable.selectClass(this.value)">
              ${classes.map(c => `<option value="${c.id}" ${_classId===c.id?'selected':''}>${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="tt-inline-stats">
            <div class="tt-stat-chip"><i class="fas fa-calendar-check"></i> ${slots.length} lessons/week</div>
            <div class="tt-stat-chip"><i class="fas fa-user-tag"></i> ${assigned.length} subject assignments</div>
            <div class="tt-stat-chip ${coverage < 50 ? 'chip-warning' : 'chip-success'}">
              <i class="fas fa-chart-pie"></i> ${coverage}% scheduled
            </div>
          </div>
        </div>
        ${isTT ? `
        <div class="tt-toolbar-right">
          <button class="btn btn-sm ${_editMode ? 'btn-warning' : 'btn-secondary'}" onclick="Timetable.toggleEdit()">
            <i class="fas fa-${_editMode ? 'lock-open' : 'edit'}"></i> ${_editMode ? 'Exit Editing' : 'Edit Mode'}
          </button>
          ${_editMode ? `<button class="btn btn-sm btn-primary" onclick="Timetable.addSlotModal()"><i class="fas fa-plus"></i> Add Slot</button>` : ''}
        </div>` : ''}
      </div>

      ${!slots.length && !_editMode ? `
        <div class="tt-empty-timetable">
          <div class="tt-empty-icon"><i class="fas fa-calendar-times"></i></div>
          <h3>No timetable generated yet</h3>
          <p>First set up <strong>Assignments</strong> (which teacher covers which subject in this class), then use <strong>Auto-Generate</strong>.</p>
          ${isTT ? `
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-secondary" onclick="Timetable.setView('assignments')"><i class="fas fa-user-tag"></i> Manage Assignments</button>
            <button class="btn btn-primary" onclick="Timetable.showGenerate()"><i class="fas fa-magic"></i> Auto-Generate</button>
          </div>` : ''}
        </div>
      ` : `
        ${_buildGrid(slots, { mode:'class', classId:_classId, editable: isTT && _editMode })}
        ${_buildSubjectLegend(slots)}
      `}
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
     TEACHER VIEW
  ═══════════════════════════════════════════════════════════ */

  function _teacherView() {
    const teachers = Auth.isTeacher()
      ? DB.query('teachers', t => t.userId === Auth.currentUser.id)
      : DB.get('teachers');
    if (!teachers.length) return `<div class="empty-state"><i class="fas fa-chalkboard-teacher"></i><p>No teachers found.</p></div>`;
    if (!_teacherId || !teachers.find(t => t.id === _teacherId)) _teacherId = teachers[0].id;

    const tch = DB.getById('teachers', _teacherId);
    const slots = [];
    DB.get('timetable').forEach(tt => {
      (tt.slots||[]).forEach(s => {
        if (s.teacherId === _teacherId) slots.push({ ...s, classId: tt.classId });
      });
    });

    const periodsPerWeek = slots.length;
    const classCount     = [...new Set(slots.map(s => s.classId))].length;
    const assigned       = DB.query('teacher_assignments', a => a.teacherId === _teacherId);
    const workloadPct    = Math.min(100, Math.round((periodsPerWeek / 25) * 100));
    const workloadColor  = periodsPerWeek > 22 ? 'var(--danger)' : periodsPerWeek > 18 ? 'var(--warning)' : 'var(--primary)';

    return `
    <div class="card">
      <div class="tt-toolbar">
        <div class="tt-selector-row">
          <div class="tt-selector-wrap">
            <label><i class="fas fa-user-tie"></i> Teacher</label>
            <select class="tt-select" onchange="Timetable.selectTeacher(this.value)">
              ${teachers.map(t => `<option value="${t.id}" ${_teacherId===t.id?'selected':''}>${t.firstName} ${t.lastName}</option>`).join('')}
            </select>
          </div>
          <div class="tt-inline-stats">
            <div class="tt-stat-chip"><i class="fas fa-clock"></i> ${periodsPerWeek} periods/week</div>
            <div class="tt-stat-chip"><i class="fas fa-door-open"></i> ${classCount} classes</div>
            <div class="tt-stat-chip"><i class="fas fa-user-tag"></i> ${assigned.length} assignments</div>
            ${tch?.department ? `<div class="tt-stat-chip"><i class="fas fa-users"></i> ${tch.department}</div>` : ''}
          </div>
        </div>
        <div class="tt-toolbar-right">
          <button class="btn btn-sm btn-secondary" onclick="Timetable.printTeacher()"><i class="fas fa-print"></i> Print</button>
        </div>
      </div>

      ${_buildGrid(slots, { mode:'teacher', editable:false })}

      <div class="tt-workload-section">
        <div class="tt-workload-label">
          <span>Weekly Workload</span>
          <span style="color:${workloadColor};font-weight:700">${periodsPerWeek} / 25 periods</span>
        </div>
        <div class="tt-workload-bar"><div class="tt-workload-fill" style="width:${workloadPct}%;background:${workloadColor}"></div></div>
        ${periodsPerWeek > 22 ? `<p class="tt-workload-warn"><i class="fas fa-exclamation-triangle"></i> Overloaded — consider redistributing lessons</p>` : ''}
      </div>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
     MASTER GRID
  ═══════════════════════════════════════════════════════════ */

  function _masterView() {
    const allClasses  = DB.get('classes');
    const allSections = DB.get('sections').sort((a,b) => a.order - b.order);
    const allTT       = DB.get('timetable');

    return `
    <div>
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0 0 4px;font-size:16px;font-weight:700"><i class="fas fa-th" style="color:var(--primary);margin-right:8px"></i>Master Timetable Grid</h3>
            <p style="margin:0;font-size:13px;color:var(--gray-500)">Grouped by section · each section uses its own bell schedule</p>
          </div>
        </div>
      </div>

      ${allSections.map(sec => {
        const secClasses = allClasses.filter(c => c.sectionId === sec.id);
        if (!secClasses.length) return '';
        const bs         = _getBSForSection(sec.id);
        const periods    = bs ? bs.periods : DEFAULT_PERIODS;
        const lessonPds  = periods.filter(p => !p.isBreak);
        return `
        <div class="card" style="margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <span style="background:${sec.color}22;color:${sec.color};border:1px solid ${sec.color}44;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:700">${sec.name}</span>
            <span style="font-size:13px;color:var(--gray-500)">${bs?.name || 'Default Schedule'} · ${bs?.lessonDuration||60} min/lesson</span>
          </div>
          ${DAYS.map((day, di) => `
          <div class="tt-master-day-block">
            <div class="tt-master-day-header">${day}</div>
            <div style="overflow-x:auto">
              <table class="tt-master-table">
                <thead><tr>
                  <th>Class</th>
                  ${lessonPds.map(p => `<th>P${p.p}<span class="tt-master-time">${p.start}</span></th>`).join('')}
                </tr></thead>
                <tbody>
                  ${secClasses.map(cls => {
                    const tt = allTT.find(t => t.classId === cls.id);
                    return `<tr>
                      <td class="tt-master-cls-name">${cls.name}</td>
                      ${lessonPds.map(pd => {
                        const slot = tt?.slots?.find(s => s.day === di && s.period === pd.p);
                        if (!slot) return `<td class="tt-master-empty">—</td>`;
                        const subj  = DB.getById('subjects', slot.subjectId);
                        const color = subj?.color || '#2563EB';
                        const abbr  = subj?.code || subj?.name?.substring(0,3).toUpperCase() || '?';
                        return `<td class="tt-master-slot" style="background:${color}18;border-top:3px solid ${color}" title="${subj?.name||''}">
                          <span style="font-size:11px;font-weight:700;color:${color}">${abbr}</span>
                        </td>`;
                      }).join('')}
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
     CONFLICTS VIEW
  ═══════════════════════════════════════════════════════════ */

  function _conflictsView() {
    const conflicts   = _detectConflicts();
    const clashes     = conflicts.filter(c => c.type === 'teacher');
    const transitions = conflicts.filter(c => c.type === 'transition');
    const overloads   = conflicts.filter(c => c.type === 'overload');

    return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h3 style="margin:0 0 4px;font-size:16px;font-weight:700">
            <i class="fas fa-exclamation-triangle" style="color:var(--warning);margin-right:8px"></i>Conflict Analysis
          </h3>
          <p style="margin:0;font-size:13px;color:var(--gray-500)">Detects teacher double-bookings and workload issues</p>
        </div>
        ${conflicts.length ? `<button class="btn btn-warning" onclick="Timetable.autoResolve()"><i class="fas fa-tools"></i> Auto-Resolve</button>` : ''}
      </div>

      <div class="tt-conflict-summary">
        <div class="tt-csummary-card ${clashes.length ? 'has-issue' : 'clear'}">
          <div class="tt-csummary-num">${clashes.length}</div>
          <div class="tt-csummary-label">Double Bookings</div>
        </div>
        <div class="tt-csummary-card ${transitions.length ? 'has-issue' : 'clear'}">
          <div class="tt-csummary-num">${transitions.length}</div>
          <div class="tt-csummary-label">Transition Gaps</div>
        </div>
        <div class="tt-csummary-card ${overloads.length ? 'has-overload' : 'clear'}">
          <div class="tt-csummary-num">${overloads.length}</div>
          <div class="tt-csummary-label">Overloaded</div>
        </div>
        <div class="tt-csummary-card clear">
          <div class="tt-csummary-num" style="color:var(--success)">${DB.get('timetable').length}</div>
          <div class="tt-csummary-label">Classes Scheduled</div>
        </div>
      </div>

      ${!conflicts.length ? `
        <div class="tt-no-conflicts">
          <i class="fas fa-check-circle"></i>
          <h3>All Clear!</h3>
          <p>No conflicts detected. Your timetable is correctly scheduled.</p>
        </div>
      ` : `
        <div class="tt-conflicts-list">
          ${conflicts.map(c => {
            const iconMap    = { teacher:'user-times', transition:'running', overload:'battery-quarter' };
            const badgeMap   = { teacher:'danger', transition:'warning', overload:'warning' };
            const labelMap   = { teacher:'Double Booking', transition:'Transition Gap', overload:'Overload' };
            return `
          <div class="tt-conflict-row ${c.type}">
            <div class="tt-conflict-icon-wrap">
              <i class="fas fa-${iconMap[c.type]||'exclamation'}"></i>
            </div>
            <div class="tt-conflict-content">
              <div class="tt-conflict-title">${c.message}</div>
              <div class="tt-conflict-detail">${c.detail}</div>
            </div>
            <span class="badge badge-${badgeMap[c.type]||'secondary'}" style="flex-shrink:0">
              ${labelMap[c.type]||c.type}
            </span>
          </div>`;
          }).join('')}
        </div>
      `}
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
     SUBSTITUTIONS VIEW
  ═══════════════════════════════════════════════════════════ */

  function _substitutionsView() {
    const subs    = DB.get('substitutions') || [];
    const isAdmin = Auth.isAdmin();

    return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h3 style="margin:0 0 4px;font-size:16px;font-weight:700">
            <i class="fas fa-exchange-alt" style="color:var(--primary);margin-right:8px"></i>Substitution Management
          </h3>
          <p style="margin:0;font-size:13px;color:var(--gray-500)">Track teacher absences and assign cover teachers</p>
        </div>
        ${isAdmin ? `<button class="btn btn-primary" onclick="Timetable.addSubModal()"><i class="fas fa-plus"></i> Record Substitution</button>` : ''}
      </div>

      ${!subs.length ? `
        <div class="empty-state" style="padding:40px 0">
          <i class="fas fa-exchange-alt" style="font-size:44px;color:var(--gray-200)"></i>
          <h3 style="color:var(--gray-400);margin-top:12px">No substitutions recorded</h3>
          <p style="color:var(--gray-400)">When teachers are absent, record substitutions here.</p>
        </div>
      ` : `
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Class</th><th>Period</th><th>Absent Teacher</th><th>Cover Teacher</th><th>Reason</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${subs.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(sub => {
                const cls  = DB.getById('classes', sub.classId);
                const orig = DB.getById('teachers', sub.originalTeacherId);
                const cov  = DB.getById('teachers', sub.substituteTeacherId);
                const pd   = LESSON_PERIODS.find(p => p.p === sub.period);
                return `<tr>
                  <td>${fmtDate(sub.date)}</td>
                  <td><span class="badge badge-secondary">${cls?.name||'—'}</span></td>
                  <td>P${sub.period}${pd ? ` <span style="color:var(--gray-400);font-size:11px">(${pd.start})</span>` : ''}</td>
                  <td><span style="color:var(--danger);font-weight:600">${orig ? orig.firstName+' '+orig.lastName : '—'}</span></td>
                  <td>${cov ? `<span style="color:var(--success);font-weight:600">${cov.firstName} ${cov.lastName}</span>` : `<span class="badge badge-warning">TBD</span>`}</td>
                  <td><span class="badge badge-warning">${sub.reason||'Absent'}</span></td>
                  ${isAdmin ? `<td><button class="btn btn-sm btn-danger btn-icon" onclick="Timetable.deleteSub('${sub.id}')"><i class="fas fa-trash"></i></button></td>` : ''}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
     ASSIGNMENTS VIEW  ★ NEW
     Shows the teacher-subject-class allocation matrix.
     This is the source of truth for auto-generation.
  ═══════════════════════════════════════════════════════════ */

  function _assignmentsView() {
    const assignments = DB.get('teacher_assignments');
    const teachers    = DB.get('teachers');
    const subjects    = DB.get('subjects');
    const classes     = DB.get('classes');

    /* Group by teacher for a clean display */
    const byTeacher = {};
    teachers.forEach(t => { byTeacher[t.id] = []; });
    assignments.forEach(a => {
      if (!byTeacher[a.teacherId]) byTeacher[a.teacherId] = [];
      byTeacher[a.teacherId].push(a);
    });

    /* Coverage check: flag only class-subject pairs that ARE in class_subjects but have no assignment */
    const classSubjects = DB.get('class_subjects');
    const gaps = classSubjects
      .filter(cs => !assignments.some(a => a.classId === cs.classId && a.subjectId === cs.subjectId))
      .map(cs => ({ cls: DB.getById('classes', cs.classId), subj: DB.getById('subjects', cs.subjectId) }))
      .filter(g => g.cls && g.subj);

    return `
    <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;align-items:start">

      <!-- LEFT: Assignment list by teacher -->
      <div>
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
            <div>
              <h3 style="margin:0 0 4px;font-size:16px;font-weight:700">
                <i class="fas fa-user-tag" style="color:var(--primary);margin-right:8px"></i>Teacher Assignments
              </h3>
              <p style="margin:0;font-size:13px;color:var(--gray-500)">
                Define which teacher covers which subject in each class — used by the auto-generator
              </p>
            </div>
            <button class="btn btn-primary" onclick="Timetable.addAssignmentModal()">
              <i class="fas fa-plus"></i> Add Assignment
            </button>
          </div>

          ${!assignments.length ? `
            <div class="empty-state" style="padding:32px 0">
              <i class="fas fa-user-tag" style="font-size:44px;color:var(--gray-200)"></i>
              <h3 style="color:var(--gray-400)">No assignments configured</h3>
              <p style="color:var(--gray-400)">Add teacher-subject-class assignments to enable auto-generation.</p>
            </div>
          ` : teachers.map(tch => {
            const tchAssign = byTeacher[tch.id] || [];
            if (!tchAssign.length) return '';
            const totalPeriods = tchAssign.reduce((s, a) => s + (a.periodsPerWeek||0), 0);
            return `
            <div class="tt-assign-teacher-block">
              <div class="tt-assign-teacher-hd">
                <div class="tt-assign-avatar">${tch.firstName.charAt(0)}</div>
                <div>
                  <div class="tt-assign-name">${tch.firstName} ${tch.lastName}</div>
                  <div class="tt-assign-dept">${tch.department || tch.specialization || ''}</div>
                </div>
                <div class="tt-assign-count">${tchAssign.length} assignments · ${totalPeriods} periods/wk</div>
              </div>
              <table class="tt-assign-table">
                <thead><tr><th>Class</th><th>Subject</th><th>Periods/Week</th><th></th></tr></thead>
                <tbody>
                  ${tchAssign.map(a => {
                    const cls  = DB.getById('classes', a.classId);
                    const subj = DB.getById('subjects', a.subjectId);
                    return `<tr>
                      <td><span class="badge badge-secondary">${cls?.name||'?'}</span></td>
                      <td>
                        <span style="display:flex;align-items:center;gap:6px">
                          <span style="width:8px;height:8px;border-radius:50%;background:${subj?.color||'#888'};flex-shrink:0"></span>
                          ${subj?.name||'?'}
                        </span>
                      </td>
                      <td>
                        <span class="tt-ppw-badge">${a.periodsPerWeek||'—'}</span>
                      </td>
                      <td style="text-align:right">
                        <button class="btn btn-sm btn-secondary btn-icon" onclick="Timetable.editAssignmentModal('${a.id}')" title="Edit">
                          <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-danger btn-icon" onclick="Timetable.deleteAssignment('${a.id}')" title="Remove">
                          <i class="fas fa-trash"></i>
                        </button>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- RIGHT: Info panel + quick actions -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <div class="card">
          <h4 style="margin:0 0 12px;font-size:13px;font-weight:700;color:var(--gray-700)">
            <i class="fas fa-info-circle" style="color:var(--primary);margin-right:6px"></i>How Assignments Work
          </h4>
          <div class="tt-info-steps">
            <div class="tt-info-step">
              <span class="tt-step-num">1</span>
              <p>Add an assignment for each Teacher + Subject + Class combination.</p>
            </div>
            <div class="tt-info-step">
              <span class="tt-step-num">2</span>
              <p>Set <strong>Periods/Week</strong> — how many lessons that subject needs in that class each week.</p>
            </div>
            <div class="tt-info-step">
              <span class="tt-step-num">3</span>
              <p>Configure <strong>Generation Rules</strong> (max consecutive, avoid gaps, etc.) in the Rules tab.</p>
            </div>
            <div class="tt-info-step">
              <span class="tt-step-num">4</span>
              <p>Click <strong>Auto-Generate</strong> — the engine uses only these assignments to fill the grid.</p>
            </div>
          </div>
        </div>

        <div class="card">
          <h4 style="margin:0 0 12px;font-size:13px;font-weight:700;color:var(--gray-700)">
            <i class="fas fa-chart-pie" style="color:var(--success);margin-right:6px"></i>Coverage Summary
          </h4>
          <div style="font-size:13px;color:var(--gray-600);margin-bottom:10px">
            ${assignments.length} assignments · ${[...new Set(assignments.map(a=>a.teacherId))].length} teachers · ${[...new Set(assignments.map(a=>a.classId))].length} classes covered
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${teachers.map(t => {
              const count = byTeacher[t.id]?.length || 0;
              const pds   = (byTeacher[t.id]||[]).reduce((s,a)=>s+(a.periodsPerWeek||0),0);
              const color = pds > 25 ? 'var(--danger)' : pds > 20 ? 'var(--warning)' : 'var(--success)';
              return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--gray-100)">
                <span>${t.firstName} ${t.lastName}</span>
                <span style="font-weight:700;color:${color}">${pds} periods/wk</span>
              </div>`;
            }).join('')}
          </div>
        </div>

        ${gaps.length ? `
        <div class="card" style="border:1px solid var(--warning)">
          <h4 style="margin:0 0 8px;font-size:13px;font-weight:700;color:var(--warning)">
            <i class="fas fa-exclamation-triangle"></i> Unassigned Combinations
          </h4>
          <p style="font-size:12px;color:var(--gray-500);margin-bottom:8px">These class+subject pairs have no teacher assigned. They won't appear on the generated timetable.</p>
          <div style="max-height:160px;overflow-y:auto;font-size:12px">
            ${gaps.slice(0,20).map(g => `
            <div style="padding:3px 0;color:var(--gray-600);border-bottom:1px solid var(--gray-100)">
              <strong>${g.cls.name}</strong> — ${g.subj.name}
            </div>`).join('')}
            ${gaps.length > 20 ? `<div style="color:var(--gray-400);padding:4px 0">…and ${gaps.length-20} more</div>` : ''}
          </div>
        </div>` : `
        <div class="card" style="border:1px solid var(--success);background:#F0FDF4">
          <div style="display:flex;align-items:center;gap:8px;color:var(--success)">
            <i class="fas fa-check-circle" style="font-size:20px"></i>
            <div>
              <div style="font-weight:700;font-size:13px">All subjects assigned</div>
              <div style="font-size:12px">Every class has a teacher for every subject.</div>
            </div>
          </div>
        </div>`}

      </div>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
     RULES VIEW  ★ NEW
     Configuration panel for auto-generation constraints.
  ═══════════════════════════════════════════════════════════ */

  function _rulesView() {
    const rules = DB.get('timetable_rules')[0] || _defaultRules();

    const yn = (val, field) => `
      <div class="tt-rule-toggle">
        <button class="tt-toggle-btn ${val ? 'active' : ''}" onclick="Timetable.toggleRule('${field}', true)">Yes</button>
        <button class="tt-toggle-btn ${!val ? 'active' : ''}" onclick="Timetable.toggleRule('${field}', false)">No</button>
      </div>`;

    return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">

      <!-- LEFT COLUMN: Teacher & Class constraints -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <div class="card">
          <h3 style="margin:0 0 16px;font-size:15px;font-weight:700">
            <i class="fas fa-chalkboard-teacher" style="color:var(--primary);margin-right:8px"></i>Teacher Constraints
          </h3>
          <div class="tt-rules-list">

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Max Consecutive Periods</div>
                <div class="tt-rule-desc">Teacher cannot teach more than this many back-to-back lessons without a break</div>
              </div>
              <select class="tt-rule-select" onchange="Timetable.updateRule('maxConsecutivePeriods', Number(this.value))">
                ${[1,2,3,4,5].map(n => `<option value="${n}" ${rules.maxConsecutivePeriods===n?'selected':''}>${n} periods</option>`).join('')}
              </select>
            </div>

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Max Periods per Day (Teacher)</div>
                <div class="tt-rule-desc">Hard ceiling on how many lessons a teacher can have in one day</div>
              </div>
              <select class="tt-rule-select" onchange="Timetable.updateRule('maxTeacherPeriodsPerDay', Number(this.value))">
                ${[3,4,5,6,7].map(n => `<option value="${n}" ${rules.maxTeacherPeriodsPerDay===n?'selected':''}>${n} periods</option>`).join('')}
              </select>
            </div>

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Avoid Gaps in Teacher Schedule</div>
                <div class="tt-rule-desc">Try to keep teacher lessons compact — no free periods sandwiched between lessons</div>
              </div>
              ${yn(rules.avoidTeacherGaps, 'avoidTeacherGaps')}
            </div>

          </div>
        </div>

        <div class="card">
          <h3 style="margin:0 0 16px;font-size:15px;font-weight:700">
            <i class="fas fa-door-open" style="color:var(--primary);margin-right:8px"></i>Class Constraints
          </h3>
          <div class="tt-rules-list">

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Max Periods per Day (Class)</div>
                <div class="tt-rule-desc">Maximum lesson slots filled per class per day (out of 7 available)</div>
              </div>
              <select class="tt-rule-select" onchange="Timetable.updateRule('maxClassPeriodsPerDay', Number(this.value))">
                ${[4,5,6,7].map(n => `<option value="${n}" ${rules.maxClassPeriodsPerDay===n?'selected':''}>${n} periods</option>`).join('')}
              </select>
            </div>

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Max Same Subject per Day</div>
                <div class="tt-rule-desc">A class should not have the same subject more than this many times in one day</div>
              </div>
              <select class="tt-rule-select" onchange="Timetable.updateRule('maxSameSubjectPerDay', Number(this.value))">
                ${[1,2,3].map(n => `<option value="${n}" ${rules.maxSameSubjectPerDay===n?'selected':''}>${n}</option>`).join('')}
              </select>
            </div>

          </div>
        </div>

      </div>

      <!-- RIGHT COLUMN: Distribution & special rules -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <div class="card">
          <h3 style="margin:0 0 16px;font-size:15px;font-weight:700">
            <i class="fas fa-sliders-h" style="color:var(--primary);margin-right:8px"></i>Distribution Rules
          </h3>
          <div class="tt-rules-list">

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Even Distribution Across Week</div>
                <div class="tt-rule-desc">Spread each subject evenly across Monday–Friday rather than bunching days</div>
              </div>
              ${yn(rules.evenDistribution, 'evenDistribution')}
            </div>

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Core Subjects First</div>
                <div class="tt-rule-desc">Place Maths and English in the first 3 periods when possible (peak attention time)</div>
              </div>
              ${yn(rules.coreSubjectsEarly, 'coreSubjectsEarly')}
            </div>

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Allow Double Lessons</div>
                <div class="tt-rule-desc">Permit the same subject to be scheduled in consecutive periods (double lesson)</div>
              </div>
              ${yn(rules.allowDoubleLesson, 'allowDoubleLesson')}
            </div>

          </div>
        </div>

        <div class="card">
          <h3 style="margin:0 0 16px;font-size:15px;font-weight:700">
            <i class="fas fa-flask" style="color:var(--primary);margin-right:8px"></i>Room & Facility Rules
          </h3>
          <div class="tt-rules-list">

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Check Room Capacity</div>
                <div class="tt-rule-desc">Warn if class size exceeds the room's capacity</div>
              </div>
              ${yn(rules.respectRoomCapacity, 'respectRoomCapacity')}
            </div>

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Multiple Buildings</div>
                <div class="tt-rule-desc">School has more than one building — allow travel time between back-to-back lessons in different buildings</div>
              </div>
              ${yn(rules.multiBuilding, 'multiBuilding')}
            </div>

          </div>
        </div>

        <!-- ── TRANSITION TIME ── -->
        <div class="card" style="border:2px solid ${rules.transitionEnabled ? 'var(--primary)' : 'var(--gray-200)'}">
          <h3 style="margin:0 0 6px;font-size:15px;font-weight:700">
            <i class="fas fa-running" style="color:${rules.transitionEnabled ? 'var(--primary)' : 'var(--gray-400)'};margin-right:8px"></i>Transition Time
            ${rules.transitionEnabled ? `<span class="badge badge-primary" style="margin-left:8px;font-size:10px">ON</span>` : `<span class="badge badge-secondary" style="margin-left:8px;font-size:10px">OFF</span>`}
          </h3>
          <p style="font-size:12.5px;color:var(--gray-500);margin:0 0 16px">
            When enabled, a teacher's schedule must have at least this many minutes between consecutive lessons — across <strong>all sections</strong>.
            Ideal for schools where teachers move between classrooms or buildings.
            <br><span style="color:var(--gray-400);font-size:11.5px">
              KG/Primary: lesson stays 40 min, transition adds a movement buffer.
              Secondary: 60 min slot = 55 min lesson + 5 min transition.
            </span>
          </p>
          <div class="tt-rules-list">

            <div class="tt-rule-row">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Enable Transition Time</div>
                <div class="tt-rule-desc">Enforce a minimum gap between a teacher's consecutive slots in the auto-generator and conflict checker</div>
              </div>
              ${yn(rules.transitionEnabled, 'transitionEnabled')}
            </div>

            <div class="tt-rule-row" style="${!rules.transitionEnabled ? 'opacity:0.4;pointer-events:none' : ''}">
              <div class="tt-rule-body">
                <div class="tt-rule-label">Transition Duration (minutes)</div>
                <div class="tt-rule-desc">Default: <strong>5 min</strong>. Time a teacher needs to move from one class to the next. Applied globally to all sections.</div>
              </div>
              <select class="tt-rule-select" onchange="Timetable.updateRule('transitionMinutes', Number(this.value))">
                ${[3,4,5,7,10].map(n => `<option value="${n}" ${rules.transitionMinutes===n?'selected':''}>${n} min</option>`).join('')}
              </select>
            </div>

          </div>
        </div>

        <div class="card" style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4)">
          <h4 style="margin:0 0 10px;font-size:13px;font-weight:700;color:var(--gray-700)">
            <i class="fas fa-lightbulb" style="color:var(--warning);margin-right:6px"></i>Current Configuration Summary
          </h4>
          <div style="font-size:12.5px;color:var(--gray-600);line-height:1.9">
            Max <strong>${rules.maxConsecutivePeriods}</strong> consecutive periods per teacher &nbsp;·&nbsp;
            <strong>${rules.maxTeacherPeriodsPerDay}</strong> periods/day teacher cap &nbsp;·&nbsp;
            <strong>${rules.maxClassPeriodsPerDay}</strong> periods/day class cap &nbsp;·&nbsp;
            max <strong>${rules.maxSameSubjectPerDay}</strong> of same subject/day<br>
            ${rules.avoidTeacherGaps ? '✅' : '❌'} Avoid teacher gaps &nbsp;·&nbsp;
            ${rules.evenDistribution ? '✅' : '❌'} Even distribution &nbsp;·&nbsp;
            ${rules.coreSubjectsEarly ? '✅' : '❌'} Core subjects early &nbsp;·&nbsp;
            ${rules.allowDoubleLesson ? '✅' : '❌'} Double lessons<br>
            ${rules.transitionEnabled
              ? `✅ Transition time: <strong>${rules.transitionMinutes} min</strong> between teacher slots`
              : '❌ Transition time: off'}
          </div>
          <div style="margin-top:14px">
            <button class="btn btn-primary" onclick="Timetable.showGenerate()">
              <i class="fas fa-magic"></i> Generate Timetable Using These Rules
            </button>
          </div>
        </div>

      </div>
    </div>`;
  }

  /* ─── Rules helpers ─── */
  function _defaultRules() {
    return {
      id:'rules1', maxConsecutivePeriods:3, avoidTeacherGaps:true,
      maxTeacherPeriodsPerDay:6, maxClassPeriodsPerDay:7,
      maxSameSubjectPerDay:2, evenDistribution:true,
      coreSubjectsEarly:true, allowDoubleLesson:false,
      respectRoomCapacity:false, multiBuilding:false,
      transitionEnabled:false, transitionMinutes:5
    };
  }

  function updateRule(field, value) {
    let rules = DB.get('timetable_rules')[0];
    if (!rules) {
      DB.insert('timetable_rules', { ..._defaultRules(), [field]: value });
    } else {
      DB.update('timetable_rules', rules.id, { [field]: value });
    }
    showToast(`Rule updated.`, 'success');
    _renderPage();
  }

  function toggleRule(field, value) {
    updateRule(field, value);
  }

  /* ═══════════════════════════════════════════════════════════
     ASSIGNMENT CRUD  ★ NEW
  ═══════════════════════════════════════════════════════════ */

  function addAssignmentModal(prefillClassId) {
    const teachers = DB.get('teachers');
    const subjects = DB.get('subjects');
    const classes  = DB.get('classes');

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-user-tag" style="color:var(--primary);margin-right:8px"></i>Add Teacher Assignment</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Timetable.saveAssignment(event)">

      <div class="tt-assign-form-info">
        <i class="fas fa-info-circle"></i>
        An assignment tells the auto-generator: "This teacher teaches this subject in this class, X times per week."
      </div>

      <div class="form-field mb-12">
        <label>Teacher *</label>
        <select name="teacherId" required>
          <option value="">Select teacher…</option>
          ${teachers.map(t => `<option value="${t.id}">${t.firstName} ${t.lastName} — ${t.department||t.specialization||''}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Subject *</label>
        <select name="subjectId" required>
          <option value="">Select subject…</option>
          ${subjects.map(s => `<option value="${s.id}">${s.name} (${s.code})</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Class *</label>
        <select name="classId" required>
          <option value="">Select class…</option>
          ${classes.map(c => `<option value="${c.id}" ${prefillClassId===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-0">
        <label>Periods per Week *</label>
        <select name="periodsPerWeek" required>
          ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${n===3?'selected':''}>${n} period${n>1?'s':''}/week</option>`).join('')}
        </select>
        <p style="font-size:11.5px;color:var(--gray-400);margin-top:4px">How many times this lesson appears in the weekly timetable for this class</p>
      </div>

      <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Assignment</button>
      </div>
    </form>`, 'sm');
  }

  function editAssignmentModal(id) {
    const a        = DB.getById('teacher_assignments', id);
    if (!a) return;
    const teachers = DB.get('teachers');
    const subjects = DB.get('subjects');
    const classes  = DB.get('classes');

    openModal(`
    <div class="modal-header">
      <h3>Edit Assignment</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Timetable.saveAssignment(event,'${id}')">
      <div class="form-field mb-12">
        <label>Teacher</label>
        <select name="teacherId" required>
          ${teachers.map(t => `<option value="${t.id}" ${a.teacherId===t.id?'selected':''}>${t.firstName} ${t.lastName}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Subject</label>
        <select name="subjectId" required>
          ${subjects.map(s => `<option value="${s.id}" ${a.subjectId===s.id?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Class</label>
        <select name="classId" required>
          ${classes.map(c => `<option value="${c.id}" ${a.classId===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-0">
        <label>Periods per Week</label>
        <select name="periodsPerWeek" required>
          ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${n===a.periodsPerWeek?'selected':''}>${n}/week</option>`).join('')}
        </select>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Update</button>
      </div>
    </form>`, 'sm');
  }

  function saveAssignment(e, editId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      teacherId:     fd.get('teacherId'),
      subjectId:     fd.get('subjectId'),
      classId:       fd.get('classId'),
      periodsPerWeek: Number(fd.get('periodsPerWeek')),
    };
    if (!data.teacherId || !data.subjectId || !data.classId) {
      showToast('Please fill in all fields.', 'warning'); return;
    }
    // Duplicate check
    const existing = DB.query('teacher_assignments', a =>
      a.teacherId === data.teacherId &&
      a.subjectId === data.subjectId &&
      a.classId   === data.classId   &&
      a.id        !== editId
    );
    if (existing.length) {
      showToast('This teacher is already assigned to that subject in that class.', 'warning'); return;
    }
    if (editId) {
      DB.update('teacher_assignments', editId, data);
      showToast('Assignment updated.', 'success');
    } else {
      DB.insert('teacher_assignments', data);
      showToast('Assignment added.', 'success');
    }
    _closeModal();
    _renderPage();
  }

  function deleteAssignment(id) {
    confirmAction('Remove this teacher assignment? The timetable will need to be regenerated.', () => {
      DB['delete']('teacher_assignments', id);
      showToast('Assignment removed.', 'info');
      _renderPage();
    });
  }

  /* ═══════════════════════════════════════════════════════════
     SHARED TIMETABLE GRID RENDERER
  ═══════════════════════════════════════════════════════════ */

  function _buildGrid(slots, options) {
    const { mode, classId, editable } = options;
    /* Use the class's section bell schedule; teacher view uses DEFAULT (mixed sections) */
    const periods = (mode === 'teacher' || !classId)
      ? DEFAULT_PERIODS
      : _getPeriodsForClass(classId);

    return `
    <div class="tt-grid-wrap">
      <table class="tt-table">
        <thead>
          <tr>
            <th class="tt-th-period">Period</th>
            ${DAYS.map(d => `<th class="tt-th-day">${d}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${periods.map(pd => {
            if (pd.isBreak) return `<tr class="tt-break-row">
              <td colspan="6"><span class="tt-break-label"><i class="fas fa-coffee"></i> ${pd.label||'Break'} &nbsp;·&nbsp; ${pd.start} – ${pd.end}</span></td>
            </tr>`;

            return `<tr class="tt-lesson-row">
              <td class="tt-td-period">
                <div class="tt-pnum">P${pd.p}</div>
                <div class="tt-ptime">${pd.start}<br>${pd.end}</div>
              </td>
              ${DAYS.map((_, di) => {
                const slot = slots.find(s => s.day === di && s.period === pd.p);

                if (!slot) {
                  if (editable) return `<td class="tt-td-free tt-td-add" onclick="Timetable.addSlotModal(${di},${pd.p})" title="Add lesson">
                    <span class="tt-add-hint"><i class="fas fa-plus"></i></span>
                  </td>`;
                  return `<td class="tt-td-free"></td>`;
                }

                const subj  = DB.getById('subjects', slot.subjectId);
                const tch   = DB.getById('teachers', slot.teacherId);
                const cls   = slot.classId ? DB.getById('classes', slot.classId) : (classId ? DB.getById('classes', classId) : null);
                const color = subj?.color || '#2563EB';
                const subtitle = mode === 'teacher'
                  ? `${cls?.name || '—'} <span style="color:var(--gray-400);font-size:10px">${slot.start||pd.start}</span>`
                  : (tch ? `${tch.firstName} ${tch.lastName}` : '—');
                const ttRecord = DB.query('timetable', t => t.classId === (slot.classId || classId))[0];

                return `<td class="tt-td-lesson">
                  <div class="tt-lesson" style="border-left:4px solid ${color};background:${color}15">
                    <div class="tt-l-subject" style="color:${color}">${subj?.name||'Unknown'}</div>
                    <div class="tt-l-meta">${subtitle}</div>
                    ${slot.room ? `<div class="tt-l-room"><i class="fas fa-map-marker-alt"></i>${slot.room}</div>` : ''}
                    ${editable && ttRecord ? `
                    <div class="tt-l-actions">
                      <button onclick="event.stopPropagation();Timetable.editSlotModal('${ttRecord.id}',${di},${pd.p})" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                      <button onclick="event.stopPropagation();Timetable.deleteSlot('${ttRecord.id}',${di},${pd.p})" class="danger-btn" title="Remove"><i class="fas fa-times"></i></button>
                    </div>` : ''}
                  </div>
                </td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function _buildSubjectLegend(slots) {
    const ids = [...new Set(slots.map(s => s.subjectId))];
    if (!ids.length) return '';
    return `
    <div class="tt-legend">
      ${ids.map(id => {
        const s = DB.getById('subjects', id);
        if (!s) return '';
        const count = slots.filter(sl => sl.subjectId === id).length;
        return `<div class="tt-legend-item" title="${s.name}: ${count} periods/week">
          <span class="tt-legend-dot" style="background:${s.color||'#2563EB'}"></span>
          <span class="tt-legend-name">${s.name}</span>
          <span class="tt-legend-count">${count}×</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
     AUTO-GENERATION ENGINE  (uses teacher_assignments + rules)
  ═══════════════════════════════════════════════════════════ */

  function showGenerate() {
    const classes     = DB.get('classes');
    const assignments = DB.get('teacher_assignments');
    const rules       = DB.get('timetable_rules')[0] || _defaultRules();

    /* Classes that have at least one assignment */
    const assignedClassIds = [...new Set(assignments.map(a => a.classId))];
    const readyClasses     = classes.filter(c => assignedClassIds.includes(c.id));
    const missingClasses   = classes.filter(c => !assignedClassIds.includes(c.id));

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-magic" style="color:var(--primary);margin-right:8px"></i>Auto-Generate Timetable</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Timetable.runGenerate(event)">

      ${!assignments.length ? `
      <div class="tt-gen-warn">
        <i class="fas fa-exclamation-triangle"></i>
        <div>
          <strong>No assignments configured.</strong><br>
          Go to the <a href="#" onclick="event.preventDefault();_closeModal();setTimeout(()=>Timetable.setView('assignments'),100)">Assignments tab</a> first to define which teacher teaches which subject in each class.
        </div>
      </div>` : ''}

      <div class="form-field mb-16">
        <label style="margin-bottom:8px">Apply to Classes
          ${readyClasses.length < classes.length ? `<span class="badge badge-warning" style="margin-left:6px">${missingClasses.length} class${missingClasses.length>1?'es':''} have no assignments</span>` : ''}
        </label>
        <div class="tt-class-checklist">
          <label class="check-label tt-check-all">
            <input type="checkbox" id="gen-select-all" onchange="document.querySelectorAll('.gen-cls-cb').forEach(cb=>cb.checked=this.checked)" checked>
            <strong>All Classes with Assignments</strong>
          </label>
          <div class="tt-class-check-grid">
            ${classes.map(c => {
              const hasAssign = assignedClassIds.includes(c.id);
              const count = assignments.filter(a => a.classId === c.id).length;
              return `<label class="check-label ${!hasAssign ? 'tt-cls-no-assign' : ''}">
                <input type="checkbox" class="gen-cls-cb" name="classIds" value="${c.id}" ${hasAssign ? 'checked' : 'disabled'}>
                <span>${c.name} ${hasAssign ? `<span style="color:var(--gray-400);font-size:10px">(${count})</span>` : '<span style="color:var(--danger);font-size:10px">no assignments</span>'}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="tt-gen-rules-summary">
        <div class="tt-gen-rules-title"><i class="fas fa-sliders-h"></i> Active Rules</div>
        <div class="tt-gen-rules-grid">
          <span>Max consecutive: <strong>${rules.maxConsecutivePeriods}</strong></span>
          <span>Max periods/day: <strong>${rules.maxClassPeriodsPerDay}</strong></span>
          <span>Max same subj/day: <strong>${rules.maxSameSubjectPerDay}</strong></span>
          <span>Avoid gaps: <strong>${rules.avoidTeacherGaps ? 'Yes' : 'No'}</strong></span>
          <span>Even spread: <strong>${rules.evenDistribution ? 'Yes' : 'No'}</strong></span>
          <span>Core subj early: <strong>${rules.coreSubjectsEarly ? 'Yes' : 'No'}</strong></span>
          <span>Transition: <strong>${rules.transitionEnabled ? rules.transitionMinutes + ' min' : 'Off'}</strong></span>
        </div>
        <a href="#" style="font-size:11.5px;color:var(--primary)" onclick="event.preventDefault();_closeModal();setTimeout(()=>Timetable.setView('rules'),100)">Change rules →</a>
      </div>

      <div class="form-field mb-0">
        <label class="check-label">
          <input type="checkbox" name="clearExisting" checked>
          <span>Clear existing timetables before generating</span>
        </label>
      </div>

      <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="gen-run-btn" ${!assignments.length ? 'disabled' : ''}>
          <i class="fas fa-magic"></i> Generate Now
        </button>
      </div>
    </form>`, 'md');
  }

  function runGenerate(e) {
    e.preventDefault();
    const fd       = new FormData(e.target);
    const classIds = fd.getAll('classIds');
    if (!classIds.length) { showToast('Select at least one class.', 'warning'); return; }

    const btn = document.getElementById('gen-run-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Generating…'; }

    setTimeout(() => {
      try {
        const result = _runEngine({ classIds, clearExisting: fd.has('clearExisting') });
        _closeModal();
        showToast(`Generated ${result.slotsCreated} slots across ${result.classesProcessed} classes!`, 'success');
        _view = 'class';
        _renderPage();
      } catch(err) {
        showToast('Generation error: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> Generate Now'; }
      }
    }, 500);
  }

  function _runEngine({ classIds, clearExisting }) {
    /* Load rules */
    const rules = DB.get('timetable_rules')[0] || _defaultRules();
    const {
      maxConsecutivePeriods, avoidTeacherGaps, maxTeacherPeriodsPerDay,
      maxClassPeriodsPerDay, maxSameSubjectPerDay,
      evenDistribution, coreSubjectsEarly, allowDoubleLesson,
      transitionEnabled, transitionMinutes
    } = rules;

    /* All assignments for these classes */
    const allAssignments = DB.get('teacher_assignments').filter(a => classIds.includes(a.classId));
    const allTeachers    = DB.get('teachers');

    /* Busy maps
       teacherBusy[tid][day] = [{start, end}]  ← time-range based (cross-section safe)
       classBusy[classId][day][period] = true   ← period-based within a class
    */
    const teacherBusy   = {}; // [tid][day] = [{start,end}]
    const classBusy     = {}; // [classId][day][period] = true
    const teacherDayPd  = {}; // [tid][day] = count (for max-per-day)
    const teacherLoad   = {}; // [tid] = total periods (for workload balance)

    allTeachers.forEach(t => { teacherLoad[t.id] = 0; });

    /* Helper: mark teacher busy for a time range */
    function _markTeacherBusy(tid, day, start, end) {
      if (!teacherBusy[tid])       teacherBusy[tid] = {};
      if (!teacherBusy[tid][day])  teacherBusy[tid][day] = [];
      teacherBusy[tid][day].push({ start, end });
    }

    /* Helper: is teacher free at a given time range? */
    function _isTeacherFree(tid, day, start, end) {
      const ranges = teacherBusy[tid]?.[day] || [];
      return !ranges.some(r => _timesOverlap(r.start, r.end, start, end));
    }

    /* Pre-load teacher busy from classes NOT being regenerated.
       Always run — even when clearExisting=true — so cross-section teacher
       slots from OTHER sections are never double-booked. Only count toward
       workload totals when NOT clearing (cleared slots will be re-counted as
       new ones are placed). */
    DB.get('timetable').filter(t => !classIds.includes(t.classId)).forEach(tt => {
      const extPds = _getPeriodsForClass(tt.classId);
      (tt.slots||[]).forEach(s => {
        const pdInfo = extPds.find(p => p.p === s.period);
        const st  = s.start || pdInfo?.start || '00:00';
        const en  = s.end   || pdInfo?.end   || '00:01';
        const eff = _effectiveEnd(en, rules); // extend by transition if enabled
        _markTeacherBusy(s.teacherId, s.day, st, eff);
        if (!clearExisting) teacherLoad[s.teacherId] = (teacherLoad[s.teacherId]||0) + 1;
      });
    });

    /* Shuffle helper */
    const shuffle = arr => {
      const a = [...arr];
      for (let i = a.length-1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i+1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    /* Room lookup */
    const getRoom = (subjectName, cls) => {
      const k = subjectName.toLowerCase();
      for (const [key, room] of Object.entries(ROOM_MAP)) if (k.includes(key)) return room;
      return cls?.room || '';
    };

    let slotsCreated = 0, classesProcessed = 0;

    classIds.forEach(classId => {
      const cls = DB.getById('classes', classId);
      if (!cls) return;

      /* Per-class bell schedule */
      const clsPeriods    = _getPeriodsForClass(classId);
      const clsLessonPds  = clsPeriods.filter(p => !p.isBreak);
      const lessonPNums   = clsLessonPds.map(p => p.p);
      /* "Early" = first 3 lesson periods; "late" = rest */
      const earlyPNums    = clsLessonPds.slice(0, 3).map(p => p.p);
      const latePNums     = clsLessonPds.slice(3).map(p => p.p);

      const existingTT = DB.query('timetable', t => t.classId === classId)[0];
      if (clearExisting && existingTT) DB.update('timetable', existingTT.id, { slots: [] });

      classBusy[classId] = {};
      const slots = [];

      /* Get this class's requirements from teacher_assignments */
      const classAssign = allAssignments.filter(a => a.classId === classId);
      if (!classAssign.length) return;

      /* Sort: core subjects first, then by most periods needed */
      classAssign.sort((a, b) => {
        const aCore = _coreSubjectIds().includes(a.subjectId) ? 0 : 1;
        const bCore = _coreSubjectIds().includes(b.subjectId) ? 0 : 1;
        if (aCore !== bCore) return aCore - bCore;
        return (b.periodsPerWeek||3) - (a.periodsPerWeek||3);
      });

      /* Per-class day counters */
      const dayCount = { 0:0, 1:0, 2:0, 3:0, 4:0 };
      const subjDay  = {};
      classAssign.forEach(a => { subjDay[a.subjectId] = {0:0,1:0,2:0,3:0,4:0}; });

      for (const req of classAssign) {
        const tid    = req.teacherId;
        const needed = req.periodsPerWeek || 3;
        const subj   = DB.getById('subjects', req.subjectId);
        const room   = getRoom(subj?.name || '', cls);
        const isCore = _coreSubjectIds().includes(req.subjectId);

        if (!teacherBusy[tid])  teacherBusy[tid]  = {};
        if (!teacherDayPd[tid]) teacherDayPd[tid] = {0:0,1:0,2:0,3:0,4:0};

        let placed = 0;
        const dayOrder = shuffle([0,1,2,3,4]);

        for (let attempt = 0; attempt < needed * 20 && placed < needed; attempt++) {
          const day = dayOrder[attempt % 5];

          if ((dayCount[day]||0) >= maxClassPeriodsPerDay) continue;
          if ((teacherDayPd[tid]?.[day]||0) >= maxTeacherPeriodsPerDay) continue;
          if ((subjDay[req.subjectId]?.[day]||0) >= maxSameSubjectPerDay) continue;

          /* Period order — core first in early slots */
          let periodOrder = evenDistribution ? shuffle([...lessonPNums]) : [...lessonPNums];
          if (coreSubjectsEarly && isCore) {
            periodOrder = [...shuffle(earlyPNums), ...shuffle(latePNums)];
          }

          for (const period of periodOrder) {
            if (classBusy[classId]?.[day]?.[period]) continue;

            const pdInfo = clsLessonPds.find(p => p.p === period);
            if (!pdInfo) continue;

            /* Time-based teacher availability (cross-section safe) */
            if (!_isTeacherFree(tid, day, pdInfo.start, pdInfo.end)) continue;

            /* Consecutive check (within this class's lesson sequence) */
            if (maxConsecutivePeriods < clsLessonPds.length) {
              const dayPNums = slots.filter(s => s.day === day && s.teacherId === tid)
                .map(s => s.period).sort((a,b) => a-b);
              if (_wouldExceedConsecutive(dayPNums, period, maxConsecutivePeriods)) continue;
            }

            /* Double lesson check */
            if (!allowDoubleLesson) {
              const hasAdj = slots.some(s => s.day === day && s.subjectId === req.subjectId &&
                (s.period === period - 1 || s.period === period + 1));
              if (hasAdj) continue;
            }

            /* Place it! */
            slots.push({ day, period, subjectId: req.subjectId, teacherId: tid, room,
                         start: pdInfo.start, end: pdInfo.end });

            /* Mark teacher busy: extend end by transition buffer so next slot must wait */
            _markTeacherBusy(tid, day, pdInfo.start, _effectiveEnd(pdInfo.end, rules));
            _markClassBusy(classBusy, classId, day, period);
            dayCount[day]++;
            teacherDayPd[tid][day]++;
            subjDay[req.subjectId][day]++;
            teacherLoad[tid] = (teacherLoad[tid]||0) + 1;
            placed++;
            break;
          }
        }
      }

      const school = Auth.currentSchool;
      if (existingTT) {
        DB.update('timetable', existingTT.id, { slots });
      } else {
        DB.insert('timetable', { schoolId: school?.id||'sch1', classId,
          academicYearId: school?.currentAcademicYearId||'ay2025',
          termId: school?.currentTermId||'term2', slots });
      }

      slotsCreated += slots.length;
      classesProcessed++;
    });

    return { slotsCreated, classesProcessed };
  }

  function _markClassBusy(map, classId, day, period) {
    if (!map[classId])       map[classId] = {};
    if (!map[classId][day])  map[classId][day] = {};
    map[classId][day][period] = true;
  }

  function _wouldExceedConsecutive(existingPeriods, newPeriod, max) {
    const all = [...existingPeriods, newPeriod].sort((a,b)=>a-b);
    let streak = 1;
    for (let i = 1; i < all.length; i++) {
      streak = all[i] === all[i-1] + 1 ? streak + 1 : 1;
      if (streak > max) return true;
    }
    return false;
  }

  /* ═══════════════════════════════════════════════════════════
     CONFLICT DETECTION & AUTO-RESOLVE
  ═══════════════════════════════════════════════════════════ */

  function _detectConflicts() {
    const allTT     = DB.get('timetable');
    const rules     = DB.get('timetable_rules')[0] || _defaultRules();
    const conflicts = [];
    /* teacherRanges[tid][day] = [{start, effEnd, classId, period}]
       effEnd = actual end + transition buffer (if enabled) */
    const teacherRanges  = {};
    const teacherPeriods = {};

    allTT.forEach(tt => {
      const clsPeriods = _getPeriodsForClass(tt.classId);
      (tt.slots||[]).forEach(s => {
        const pdInfo = clsPeriods.find(p => p.p === s.period);
        const st     = s.start || pdInfo?.start || '00:00';
        const en     = s.end   || pdInfo?.end   || '00:01';
        const effEnd = _effectiveEnd(en, rules);

        if (!teacherRanges[s.teacherId]) teacherRanges[s.teacherId] = {};
        if (!teacherRanges[s.teacherId][s.day]) teacherRanges[s.teacherId][s.day] = [];

        /* Check against every existing range for this teacher on this day */
        for (const r of teacherRanges[s.teacherId][s.day]) {
          if (_timesOverlap(r.start, r.effEnd, st, effEnd)) {
            const t  = DB.getById('teachers', s.teacherId);
            const c1 = DB.getById('classes', r.classId);
            const c2 = DB.getById('classes', tt.classId);
            const isTransitionClash = !_timesOverlap(r.start, r.rawEnd, st, en);
            conflicts.push({
              type: isTransitionClash ? 'transition' : 'teacher',
              teacherId:s.teacherId, day:s.day, period:s.period,
              message:`${t?.firstName||''} ${t?.lastName||'Unknown'} ${isTransitionClash ? 'has insufficient transition time' : 'is double-booked'}`,
              detail:`${DAYS[s.day]}, ${st}–${en}: ${isTransitionClash
                ? `only ${_toMin(st) - _toMin(r.rawEnd)} min gap before ${c2?.name||'?'} (need ${rules.transitionMinutes} min)`
                : `assigned to both ${c1?.name||'?'} and ${c2?.name||'?'}`}`
            });
          }
        }
        teacherRanges[s.teacherId][s.day].push({ start:st, rawEnd:en, effEnd, classId:tt.classId, period:s.period });
        teacherPeriods[s.teacherId] = (teacherPeriods[s.teacherId]||0) + 1;
      });
    });

    Object.entries(teacherPeriods).forEach(([tid, count]) => {
      if (count > 30) {
        const t = DB.getById('teachers', tid);
        conflicts.push({
          type:'overload', teacherId:tid,
          message:`${t?.firstName||''} ${t?.lastName||'Unknown'} is overloaded`,
          detail:`${count} periods/week across all sections — maximum recommended is 30`
        });
      }
    });

    return conflicts;
  }

  function autoResolve() {
    confirmAction('Auto-resolve will remove duplicate slot assignments keeping the first. Continue?', () => {
      const seen = {};
      let removed = 0;
      DB.get('timetable').forEach(tt => {
        const kept = [];
        (tt.slots||[]).forEach(s => {
          const k = `${s.teacherId}-${s.day}-${s.period}`;
          if (!seen[k]) { seen[k]=true; kept.push(s); } else removed++;
        });
        if (kept.length !== (tt.slots||[]).length) DB.update('timetable', tt.id, { slots:kept });
      });
      showToast(`Auto-resolved: removed ${removed} conflict${removed!==1?'s':''}.`, 'success');
      _renderPage();
    });
  }

  /* ═══════════════════════════════════════════════════════════
     SLOT ADD / EDIT / DELETE
  ═══════════════════════════════════════════════════════════ */

  function addSlotModal(day, period) {
    const subjects = DB.get('subjects');
    const teachers = DB.get('teachers');
    const classes  = DB.get('classes');
    const assign   = _classId ? DB.query('teacher_assignments', a => a.classId === _classId) : [];

    openModal(`
    <div class="modal-header">
      <h3>Add Lesson Slot</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Timetable.saveSlot(event)">
      <div class="form-row cols-2">
        <div class="form-field">
          <label>Class *</label>
          <select name="classId" required>
            ${classes.map(c => `<option value="${c.id}" ${_classId===c.id?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>Day *</label>
          <select name="day" required>
            ${DAYS.map((d,i) => `<option value="${i}" ${i===day?'selected':''}>${d}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-field mb-12">
        <label>Period *</label>
        <select name="period" required>
          ${_getLessonPeriodsForClass(_classId).map(p => `<option value="${p.p}" ${p.p===period?'selected':''}>P${p.p} · ${p.start}–${p.end}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Subject *</label>
        <select name="subjectId" required onchange="Timetable._suggestRoom(this)">
          <option value="">Select subject…</option>
          ${assign.length
            ? assign.map(a => { const s=DB.getById('subjects',a.subjectId); return s?`<option value="${s.id}" data-name="${s.name}">${s.name} (assigned)</option>`:''; }).join('')
            : subjects.map(s => `<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('')}
        </select>
        ${assign.length ? `<p style="font-size:11px;color:var(--gray-400);margin-top:3px">Showing assigned subjects. <a href="#" onclick="event.preventDefault();this.closest('select').innerHTML='${subjects.map(s=>`<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('')}'">Show all</a></p>` : ''}
      </div>
      <div class="form-field mb-12">
        <label>Teacher *</label>
        <select name="teacherId" required>
          <option value="">Select teacher…</option>
          ${teachers.map(t => `<option value="${t.id}">${t.firstName} ${t.lastName}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-0">
        <label>Room / Location</label>
        <input name="room" id="slot-room-input" placeholder="e.g. Room 203, Science Lab 1…">
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Add Slot</button>
      </div>
    </form>`, 'sm');
  }

  function _suggestRoom(sel) {
    const name = sel.options[sel.selectedIndex]?.dataset?.name || '';
    const inp  = document.getElementById('slot-room-input');
    if (!inp) return;
    for (const [key, room] of Object.entries(ROOM_MAP)) if (name.toLowerCase().includes(key)) { inp.value = room; return; }
  }

  function editSlotModal(ttId, day, period) {
    const tt   = DB.getById('timetable', ttId);
    const slot = tt?.slots?.find(s => s.day === day && s.period === period);
    if (!slot) return addSlotModal(day, period);
    const subjects = DB.get('subjects');
    const teachers = DB.get('teachers');

    openModal(`
    <div class="modal-header">
      <h3>Edit Slot — ${DAYS[day]}, P${period}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Timetable.saveSlot(event,'${ttId}','edit',${day},${period})">
      <div class="form-field mb-12">
        <label>Subject</label>
        <select name="subjectId">
          ${subjects.map(s => `<option value="${s.id}" ${slot.subjectId===s.id?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Teacher</label>
        <select name="teacherId">
          <option value="">— Unassigned —</option>
          ${teachers.map(t => `<option value="${t.id}" ${slot.teacherId===t.id?'selected':''}>${t.firstName} ${t.lastName}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-0">
        <label>Room / Location</label>
        <input name="room" value="${slot.room||''}">
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Update</button>
      </div>
    </form>`, 'sm');
  }

  function saveSlot(e, ttId, mode, editDay, editPeriod) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const classId   = fd.get('classId')  || _classId;
    const day       = mode==='edit' ? editDay    : Number(fd.get('day'));
    const period    = mode==='edit' ? editPeriod : Number(fd.get('period'));
    const subjectId = fd.get('subjectId');
    const teacherId = fd.get('teacherId') || null;
    const room      = fd.get('room') || '';

    /* Validate referential integrity and teacher double-booking */
    const slotErr = Validators.timetableSlot(
      { day, period, subjectId, teacherId, classId },
      ttId,
      mode === 'edit' ? editDay    : undefined,
      mode === 'edit' ? editPeriod : undefined
    );
    if (slotErr) return showToast(slotErr, 'warning');

    let tt = DB.query('timetable', t => t.classId===classId)[0];
    if (!tt) tt = DB.insert('timetable', {
      schoolId: Auth.currentSchool?.id || 'sch1',
      classId,
      academicYearId: SchoolContext.currentAcYearId(),
      termId:         SchoolContext.currentTermId(),
      slots: []
    });

    const pdInfo  = LESSON_PERIODS.find(p => p.p===period);
    const newSlot = { day, period, subjectId, teacherId, room, start:pdInfo?.start||'', end:pdInfo?.end||'' };
    let slots = [...(tt.slots||[])];
    if (mode==='edit') slots = slots.map(s => s.day===editDay && s.period===editPeriod ? newSlot : s);
    else { slots = slots.filter(s => !(s.day===day && s.period===period)); slots.push(newSlot); }

    DB.update('timetable', tt.id, { slots });
    _classId = classId;
    showToast('Timetable updated!', 'success');
    _closeModal();
    _renderPage();
  }

  function deleteSlot(ttId, day, period) {
    confirmAction('Remove this lesson?', () => {
      const tt = DB.getById('timetable', ttId);
      if (!tt) return;
      DB.update('timetable', ttId, { slots:(tt.slots||[]).filter(s=>!(s.day===day&&s.period===period)) });
      showToast('Lesson removed.', 'success');
      _renderPage();
    });
  }

  /* ═══════════════════════════════════════════════════════════
     SUBSTITUTIONS
  ═══════════════════════════════════════════════════════════ */

  function addSubModal() {
    const teachers = DB.get('teachers');
    const classes  = DB.get('classes');
    const today    = new Date().toISOString().split('T')[0];

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-exchange-alt" style="color:var(--warning);margin-right:8px"></i>Record Substitution</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Timetable.saveSub(event)">
      <div class="form-row cols-2">
        <div class="form-field">
          <label>Date *</label>
          <input type="date" name="date" value="${today}" required>
        </div>
        <div class="form-field">
          <label>Class *</label>
          <select name="classId" required>
            <option value="">Select class…</option>
            ${classes.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-field mb-12">
        <label>Period *</label>
        <select name="period" required>
          ${_allLessonPeriods().map(p=>`<option value="${p.p}">P${p.p} · ${p.start}–${p.end}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Absent Teacher *</label>
        <select name="originalTeacherId" required>
          <option value="">Select teacher…</option>
          ${teachers.map(t=>`<option value="${t.id}">${t.firstName} ${t.lastName}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Cover Teacher</label>
        <select name="substituteTeacherId">
          <option value="">— TBD —</option>
          ${teachers.map(t=>`<option value="${t.id}">${t.firstName} ${t.lastName}</option>`).join('')}
        </select>
      </div>
      <div class="form-row cols-2">
        <div class="form-field">
          <label>Reason</label>
          <select name="reason">
            <option>Absent</option><option>Sick Leave</option><option>Training / PD</option>
            <option>Emergency</option><option>Official Duty</option><option>Other</option>
          </select>
        </div>
        <div class="form-field">
          <label>Notes</label>
          <input name="note" placeholder="Optional…">
        </div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-warning"><i class="fas fa-save"></i> Record</button>
      </div>
    </form>`, 'sm');
  }

  function saveSub(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    DB.insert('substitutions', {
      date: fd.get('date'), classId: fd.get('classId'),
      period: Number(fd.get('period')),
      originalTeacherId: fd.get('originalTeacherId'),
      substituteTeacherId: fd.get('substituteTeacherId')||null,
      reason: fd.get('reason'), note: fd.get('note')||''
    });
    showToast('Substitution recorded.', 'success');
    _closeModal(); _renderPage();
  }

  function deleteSub(id) {
    confirmAction('Delete this substitution record?', () => {
      DB['delete']('substitutions', id);
      showToast('Deleted.', 'info'); _renderPage();
    });
  }

  /* ═══════════════════════════════════════════════════════════
     PRINT & EXPORT
  ═══════════════════════════════════════════════════════════ */

  function printCurrent() { _view==='teacher' ? printTeacher() : printClass(); }

  function printClass() {
    const cls   = DB.getById('classes', _classId);
    const tt    = DB.query('timetable', t => t.classId===_classId)[0];
    _openPrint(`Class: ${cls?.name||'Unknown'}`, _buildPrintTable(tt?.slots||[], 'class', _classId));
  }

  function printTeacher() {
    const tch   = DB.getById('teachers', _teacherId);
    const slots = [];
    DB.get('timetable').forEach(tt => (tt.slots||[]).forEach(s => { if (s.teacherId===_teacherId) slots.push({...s,classId:tt.classId}); }));
    _openPrint(`Teacher: ${tch?.firstName||''} ${tch?.lastName||'Unknown'}`, _buildPrintTable(slots, 'teacher', null));
  }

  function _buildPrintTable(slots, mode, classId) {
    const periods = classId ? _getPeriodsForClass(classId) : DEFAULT_PERIODS;
    const rows = periods.map(pd => {
      if (pd.isBreak) return `<tr><td colspan="6" style="text-align:center;background:#f1f5f9;font-size:11px;font-weight:700;letter-spacing:.5px;padding:7px;color:#64748b;border:1px solid #e2e8f0">${(pd.label||'Break').toUpperCase()} · ${pd.start}–${pd.end}</td></tr>`;
      return `<tr>
        <td style="font-weight:700;font-size:12px;text-align:center;background:#f8fafc;padding:10px 8px;border:1px solid #e2e8f0;white-space:nowrap">P${pd.p}<br><span style="font-size:10px;color:#94a3b8;font-weight:400">${pd.start}</span></td>
        ${DAYS.map((_,di)=>{
          const slot=slots.find(s=>s.day===di&&s.period===pd.p);
          if (!slot) return `<td style="border:1px solid #e2e8f0;padding:8px"></td>`;
          const subj=DB.getById('subjects',slot.subjectId);const tch=DB.getById('teachers',slot.teacherId);
          const cls=slot.classId?DB.getById('classes',slot.classId):(classId?DB.getById('classes',classId):null);
          const sub2=mode==='teacher'?(cls?.name||''):(tch?`${tch.firstName} ${tch.lastName}`:'');
          return `<td style="border:1px solid #e2e8f0;padding:8px;border-left:3px solid ${subj?.color||'#2563EB'}">
            <div style="font-weight:700;font-size:12px;color:#1e293b">${subj?.name||'?'}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">${sub2}</div>
            ${slot.room?`<div style="font-size:10px;color:#94a3b8;margin-top:2px">📍 ${slot.room}</div>`:''}
          </td>`;
        }).join('')}
      </tr>`;
    }).join('');
    return `<table style="width:100%;border-collapse:collapse;font-family:Inter,system-ui,sans-serif">
      <thead><tr>
        <th style="background:#1e293b;color:#fff;padding:10px 8px;font-size:12px;border:1px solid #334155;width:70px">Period</th>
        ${DAYS.map(d=>`<th style="background:#1e293b;color:#fff;padding:10px 8px;font-size:12px;border:1px solid #334155">${d}</th>`).join('')}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function _openPrint(title, tableHtml) {
    const school = Auth.currentSchool;
    const win = window.open('','_blank','width=1100,height=750');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} – Timetable</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;padding:24px;color:#1e293b}
    .ph{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:16px;border-bottom:2px solid #1e293b}
    .ph h1{font-size:20px;font-weight:800}.ph p{font-size:12px;color:#64748b;margin-top:4px}
    .pbtn{margin-top:8px;padding:7px 16px;background:#2563EB;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px}
    @media print{body{padding:0}.pbtn{display:none}}</style></head><body>
    <div class="ph"><div><h1>📅 ${title}</h1><p>${school?.name||'Meridian International School'} · Term 2, 2024–2025</p></div>
    <div style="text-align:right;font-size:11px;color:#94a3b8"><p>Generated: ${new Date().toLocaleDateString('en-KE',{day:'2-digit',month:'short',year:'numeric'})}</p>
    <button class="pbtn" onclick="window.print()">🖨 Print</button></div></div>${tableHtml}</body></html>`);
    win.document.close();
  }

  function exportCSV() {
    const cls   = DB.getById('classes', _classId);
    const tt    = DB.query('timetable', t => t.classId===_classId)[0];
    const slots = tt?.slots || [];
    const rows  = [['Period','Time',...DAYS]];
    _getLessonPeriodsForClass(_classId).forEach(pd => {
      const row = [`P${pd.p}`,`${pd.start}–${pd.end}`];
      DAYS.forEach((_,di) => {
        const slot=slots.find(s=>s.day===di&&s.period===pd.p);
        if (!slot){row.push('');return;}
        const subj=DB.getById('subjects',slot.subjectId);const tch=DB.getById('teachers',slot.teacherId);
        row.push(`${subj?.name||'?'} | ${tch?tch.firstName+' '+tch.lastName:''} | ${slot.room||''}`);
      });
      rows.push(row);
    });
    const csv  = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`timetable-${(cls?.name||'class').replace(/\s+/g,'-').toLowerCase()}.csv`;
    a.click(); URL.revokeObjectURL(url);
    showToast('CSV exported!', 'success');
  }

  /* ═══════════════════════════════════════════════════════════
     NAVIGATION HELPERS
  ═══════════════════════════════════════════════════════════ */

  function setView(v)       { _view=v; _editMode=false; _renderPage(); }
  function selectClass(id)  { _classId=id; _editMode=false; _renderPage(); }
  function selectTeacher(id){ _teacherId=id; _renderPage(); }
  function toggleEdit()     { _editMode=!_editMode; _renderPage(); }

  function _getMyClasses() {
    if (_isTT() || Auth.isFinance()) return DB.get('classes');
    if (Auth.isTeacher()) {
      const tch=DB.query('teachers',t=>t.userId===Auth.currentUser.id)[0];
      if (!tch) return DB.get('classes');
      return DB.get('classes').filter(c=>c.homeroomTeacherId===tch.id||
        DB.query('timetable',t=>t.classId===c.id).some(tt=>(tt.slots||[]).some(s=>s.teacherId===tch.id)));
    }
    if (Auth.isStudent()) {
      const stu=DB.query('students',s=>s.userId===Auth.currentUser.id)[0];
      return stu?DB.get('classes').filter(c=>c.id===stu.classId):[];
    }
    return DB.get('classes');
  }

  /* ─── Union of all lesson periods across all bell schedules (for substitution modal) ─── */
  function _allLessonPeriods() {
    const allBS  = DB.get('bell_schedules');
    const seen   = new Set();
    const result = [];
    /* Default first */
    DEFAULT_PERIODS.filter(p => !p.isBreak).forEach(p => { if (!seen.has(p.p)) { seen.add(p.p); result.push(p); } });
    allBS.forEach(bs => (bs.periods||[]).filter(p => !p.isBreak).forEach(p => {
      if (!seen.has(p.p)) { seen.add(p.p); result.push(p); }
    }));
    return result.sort((a,b) => (Number(a.p)||0) - (Number(b.p)||0));
  }

  /* ═══════════════════════════════════════════════════════════
     BELL SCHEDULES VIEW & CRUD
  ═══════════════════════════════════════════════════════════ */

  function _bellSchedulesView() {
    const sections = DB.get('sections').sort((a,b) => a.order - b.order);

    return `
    <div>
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0 0 6px;font-size:16px;font-weight:700">
              <i class="fas fa-bell" style="color:var(--primary);margin-right:8px"></i>Bell Schedules
            </h3>
            <p style="margin:0;font-size:13px;color:var(--gray-500)">
              Each section can have its own lesson duration, period times and break layout.
              Teachers who span multiple sections are conflict-checked by <strong>time overlap</strong>, not period number.
            </p>
          </div>
        </div>
      </div>

      ${sections.map(sec => {
        const bs      = _getBSForSection(sec.id);
        const periods = bs?.periods || [];
        const lsnPds  = periods.filter(p => !p.isBreak);
        return `
        <div class="card" style="margin-bottom:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="background:${sec.color}22;color:${sec.color};border:1px solid ${sec.color}44;border-radius:6px;padding:4px 12px;font-size:13px;font-weight:700">${sec.name}</span>
              <div>
                <div style="font-size:14px;font-weight:600">${bs?.name || 'No Schedule Set'}</div>
                <div style="font-size:12px;color:var(--gray-400)">${lsnPds.length} lesson periods · ${bs?.lessonDuration||'—'} min/lesson</div>
              </div>
            </div>
            <div style="display:flex;gap:8px">
              ${bs ? `<button class="btn btn-sm btn-secondary" onclick="Timetable.editBSNameModal('${bs.id}')"><i class="fas fa-edit"></i> Edit Name</button>` : ''}
              <button class="btn btn-sm btn-primary" onclick="Timetable.addBSPeriodModal('${sec.id}')"><i class="fas fa-plus"></i> Add Period</button>
            </div>
          </div>

          ${!periods.length ? `
            <div class="empty-state" style="padding:30px 0">
              <i class="fas fa-clock" style="font-size:36px;color:var(--gray-200)"></i>
              <h3 style="color:var(--gray-400);margin-top:10px">No periods configured</h3>
              <p style="color:var(--gray-400);font-size:13px">Click <strong>Add Period</strong> to build this section's bell schedule.</p>
            </div>
          ` : `
            <div style="overflow-x:auto">
              <table class="data-table">
                <thead><tr>
                  <th style="width:70px">Period</th>
                  <th>Label</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Duration</th>
                  <th>Type</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  ${periods.map((pd, idx) => {
                    const dur = _toMin(pd.end) - _toMin(pd.start);
                    return `<tr>
                      <td><span class="badge badge-${pd.isBreak ? 'warning' : 'primary'}">${pd.isBreak ? pd.p : 'P' + pd.p}</span></td>
                      <td>${pd.label || '—'}</td>
                      <td style="font-weight:600;font-variant-numeric:tabular-nums">${pd.start}</td>
                      <td style="font-variant-numeric:tabular-nums">${pd.end}</td>
                      <td><span style="color:var(--gray-500);font-size:12px">${dur} min</span></td>
                      <td><span class="badge badge-${pd.isBreak ? 'warning' : 'success'}">${pd.isBreak ? 'Break' : 'Lesson'}</span></td>
                      <td style="text-align:right;white-space:nowrap">
                        <button class="btn btn-sm btn-secondary btn-icon" onclick="Timetable.editBSPeriodModal('${sec.id}',${idx})" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger btn-icon" onclick="Timetable.deleteBSPeriod('${sec.id}',${idx})" title="Delete"><i class="fas fa-trash"></i></button>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}

          ${bs && lsnPds.length ? (() => {
            const tr = DB.get('timetable_rules')[0] || _defaultRules();
            const teachingMin = tr.transitionEnabled && tr.transitionMinutes
              ? (bs.lessonDuration || 60) - tr.transitionMinutes
              : (bs.lessonDuration || 60);
            return `
          <div style="margin-top:12px;padding:10px 14px;background:var(--gray-50);border-radius:8px;font-size:12px;color:var(--gray-500)">
            <i class="fas fa-info-circle" style="color:var(--primary);margin-right:6px"></i>
            School day: <strong>${lsnPds[0].start}</strong> – <strong>${lsnPds[lsnPds.length-1].end}</strong> ·
            ${lsnPds.length} lessons ·
            ${tr.transitionEnabled
              ? `<strong>${teachingMin} min</strong> teaching + <strong style="color:var(--primary)">${tr.transitionMinutes} min</strong> transition per slot`
              : `<strong>${bs.lessonDuration || '—'} min</strong> per lesson (no transition)`}
          </div>`;
          })() : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  /* Add / Edit a period in a section's bell schedule */
  function addBSPeriodModal(sectionId, editIdx) {
    const sec  = DB.getById('sections', sectionId);
    const bs   = _getBSForSection(sectionId);
    const edit = (editIdx !== undefined) && bs ? bs.periods[editIdx] : null;

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-bell" style="color:var(--primary);margin-right:8px"></i>${edit ? 'Edit' : 'Add'} Period — ${sec?.name}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Timetable.saveBSPeriod(event,'${sectionId}',${editIdx !== undefined ? editIdx : 'null'})">
      <div class="form-row cols-2">
        <div class="form-field">
          <label>Period Key *</label>
          <input name="pKey" value="${edit ? edit.p : ''}" required placeholder="e.g. 1, 2, B1, L">
          <p style="font-size:11px;color:var(--gray-400);margin-top:3px">Unique within this schedule. Use numbers for lessons, letters for breaks.</p>
        </div>
        <div class="form-field">
          <label>Label *</label>
          <input name="label" value="${edit ? (edit.label||'') : ''}" required placeholder="e.g. Period 1, Morning Break">
        </div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field">
          <label>Start Time *</label>
          <input type="time" name="start" value="${edit ? edit.start : ''}" required>
        </div>
        <div class="form-field">
          <label>End Time *</label>
          <input type="time" name="end" value="${edit ? edit.end : ''}" required>
        </div>
      </div>
      <div class="form-field mb-0">
        <label>Type *</label>
        <div style="display:flex;gap:16px;margin-top:6px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:normal">
            <input type="radio" name="isBreak" value="false" ${!edit?.isBreak ? 'checked' : ''}> Lesson
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:normal">
            <input type="radio" name="isBreak" value="true" ${edit?.isBreak ? 'checked' : ''}> Break
          </label>
        </div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${edit ? 'Update' : 'Add'} Period</button>
      </div>
    </form>`, 'sm');
  }

  function editBSPeriodModal(sectionId, idx) {
    addBSPeriodModal(sectionId, idx);
  }

  function saveBSPeriod(e, sectionId, editIdx) {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const pRaw    = fd.get('pKey').trim();
    /* Convert to number if numeric, keep string if not (e.g. 'B1', 'L') */
    const pKey    = /^\d+$/.test(pRaw) ? Number(pRaw) : pRaw;
    const label   = fd.get('label').trim();
    const start   = fd.get('start');
    const end     = fd.get('end');
    const isBreak = fd.get('isBreak') === 'true';

    if (_toMin(end) <= _toMin(start)) {
      showToast('End time must be after start time.', 'warning'); return;
    }

    const sec = DB.getById('sections', sectionId);
    if (!sec) return;

    let bs = _getBSForSection(sectionId);
    if (!bs) {
      /* Create a new bell schedule for this section */
      bs = DB.insert('bell_schedules', {
        schoolId: sec.schoolId || 'sch1',
        sectionId,
        name: `${sec.name} Bell Schedule`,
        lessonDuration: 60,
        periods: []
      });
      DB.update('sections', sectionId, { bellScheduleId: bs.id });
      /* Refresh bs from DB */
      bs = DB.getById('bell_schedules', bs.id);
    }

    const periods = [...(bs.periods || [])];
    const newPd   = { p: pKey, start, end, isBreak, label };

    if (editIdx !== null && editIdx !== undefined) {
      periods[editIdx] = newPd;
    } else {
      /* Duplicate key check */
      if (periods.some(p => String(p.p) === String(pKey))) {
        showToast(`Period key "${pKey}" already exists in this schedule.`, 'warning'); return;
      }
      periods.push(newPd);
    }

    /* Sort periods by start time */
    periods.sort((a, b) => _toMin(a.start) - _toMin(b.start));

    /* Update lessonDuration from non-break periods */
    const lessonPds = periods.filter(p => !p.isBreak);
    if (lessonPds.length) {
      const durations = lessonPds.map(p => _toMin(p.end) - _toMin(p.start));
      const mode = durations.sort((a,b)=>a-b)[Math.floor(durations.length/2)];
      DB.update('bell_schedules', bs.id, { periods, lessonDuration: mode });
    } else {
      DB.update('bell_schedules', bs.id, { periods });
    }

    showToast(editIdx !== null && editIdx !== undefined ? 'Period updated.' : 'Period added.', 'success');
    _closeModal();
    _renderPage();
  }

  function deleteBSPeriod(sectionId, idx) {
    confirmAction('Delete this period from the bell schedule?', () => {
      const bs = _getBSForSection(sectionId);
      if (!bs) return;
      const periods = (bs.periods || []).filter((_, i) => i !== idx);
      DB.update('bell_schedules', bs.id, { periods });
      showToast('Period deleted.', 'info');
      _renderPage();
    });
  }

  function editBSNameModal(bsId) {
    const bs = DB.getById('bell_schedules', bsId);
    if (!bs) return;
    openModal(`
    <div class="modal-header">
      <h3>Edit Schedule Name</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Timetable.saveBSName(event,'${bsId}')">
      <div class="form-field mb-0">
        <label>Schedule Name *</label>
        <input name="name" value="${bs.name}" required>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save</button>
      </div>
    </form>`, 'sm');
  }

  function saveBSName(e, bsId) {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    DB.update('bell_schedules', bsId, { name });
    showToast('Schedule name updated.', 'success');
    _closeModal(); _renderPage();
  }

  /* ═══════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════ */

  return {
    render,
    setView, selectClass, selectTeacher, toggleEdit,
    showGenerate, runGenerate, autoResolve,
    addSlotModal, editSlotModal, saveSlot, deleteSlot,
    addSubModal, saveSub, deleteSub,
    printCurrent, printClass, printTeacher, exportCSV,
    addAssignmentModal, editAssignmentModal, saveAssignment, deleteAssignment,
    updateRule, toggleRule,
    addBSPeriodModal, editBSPeriodModal, saveBSPeriod, deleteBSPeriod,
    editBSNameModal, saveBSName,
    _suggestRoom,
  };
})();
