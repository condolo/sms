/* ============================================================
   SchoolSync — Behaviour & Pastoral Module  v2
   Merit/demerit matrix, house cup, demerit stages,
   merit milestones, appeals, detentions, period filtering.
   ============================================================ */

const Behaviour = (() => {
  let _tab    = 'dashboard';
  let _period = 'term';   // 'week' | 'month' | 'term' | 'all'
  let _incFilter    = { type:'all', classId:'', search:'', status:'all' };
  let _appealFilter = { status:'pending' };
  /* Log modal state — persists across inner refreshes */
  let _logState = {
    type:'merit', catId:'', selectedId:'', search:'',
    classId:'', presetStudentId:'', presetDate:''
  };

  /* ─────────────────────────────────────────
     CONFIG HELPERS
  ───────────────────────────────────────── */
  function _cfg() {
    return DB.get('behaviour_settings')[0] || {
      categories:[], meritMilestones:[], demeritStages:[],
      houses:[], detentionTypes:[], keyStages:[], halfTermWeeks:7
    };
  }

  function _saveCfg(partial) {
    const existing = DB.get('behaviour_settings')[0];
    if (existing) {
      DB.update('behaviour_settings', existing.id, partial);
    } else {
      DB.insert('behaviour_settings', { id:'beh_cfg', schoolId:'sch1', ...partial });
    }
  }

  /* ─────────────────────────────────────────
     PERMISSION HELPERS
  ───────────────────────────────────────── */
  function _canLog()      { return Auth.hasPermission('behaviour','create'); }
  function _canEdit()     { return Auth.hasPermission('behaviour','edit'); }
  function _canSettings() { return Auth.isSuperAdmin() || Auth.isAdmin(); }
  function _canSeeAll()   {
    const r = (Auth.currentUser?.roles || [Auth.currentUser?.role]);
    return r.some(x => ['superadmin','admin','deputy_principal','discipline_committee','section_head'].includes(x));
  }

  /* ─────────────────────────────────────────
     POINTS CALCULATION
  ───────────────────────────────────────── */
  /* Base: all incidents for a student in a term */
  function _stuIncidents(studentId, termId) {
    return DB.query('behaviour_incidents', i => i.studentId === studentId && i.termId === termId);
  }

  /* Period-aware version: term → same as base; others → date-filtered from ALL incidents */
  function _stuIncidentsPeriod(studentId, period, termId) {
    if (period === 'term') return _stuIncidents(studentId, termId);
    const all = DB.query('behaviour_incidents', i => i.studentId === studentId);
    return _filterByPeriod(all, period);
  }

  function _meritPts(studentId, termId) {
    return _stuIncidents(studentId, termId)
      .filter(i => i.type === 'merit')
      .reduce((s, i) => s + (i.points || 0), 0);
  }

  function _demeritPts(studentId, termId) {          // returns positive absolute value
    return _stuIncidents(studentId, termId)
      .filter(i => i.type === 'demerit')
      .reduce((s, i) => s + Math.abs(i.points || 0), 0);
  }

  /* Period-aware versions used on dashboard */
  function _meritPtsPeriod(studentId, period, termId) {
    return _stuIncidentsPeriod(studentId, period, termId)
      .filter(i => i.type === 'merit')
      .reduce((s, i) => s + (i.points || 0), 0);
  }

  function _demeritPtsPeriod(studentId, period, termId) {
    return _stuIncidentsPeriod(studentId, period, termId)
      .filter(i => i.type === 'demerit')
      .reduce((s, i) => s + Math.abs(i.points || 0), 0);
  }

  function _netPts(studentId, termId) {
    return _stuIncidents(studentId, termId)
      .reduce((s, i) => s + (i.points || 0), 0);
  }

  function _housePts(houseId, period, termId) {
    const students = DB.query('students', s => s.houseId === houseId && s.status === 'active');
    return students.reduce((sum, s) => {
      const inc = _stuIncidentsPeriod(s.id, period, termId);
      return sum + inc.reduce((ss, i) => ss + (i.housePoints || 0), 0);
    }, 0);
  }

  /* ─────────────────────────────────────────
     STUDENTS I CAN ACCESS
  ───────────────────────────────────────── */
  function _myStudents() {
    const user  = Auth.currentUser;
    const roles = user?.roles || [user?.role];
    if (roles.some(r => ['superadmin','admin','deputy_principal','discipline_committee'].includes(r))) {
      return DB.query('students', s => s.status === 'active')
        .sort((a,b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`));
    }
    if (roles.includes('section_head')) {
      const secId = Auth.mySectionId();
      const classes = secId
        ? DB.query('classes', c => c.sectionId === secId)
        : DB.get('classes');
      const clsIds = classes.map(c => c.id);
      return DB.query('students', s => s.status === 'active' && clsIds.includes(s.classId))
        .sort((a,b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`));
    }
    if (roles.includes('teacher')) {
      const tch = Auth.myTeacher();
      if (!tch) return [];
      const tts = DB.get('timetable');
      const clsIds = [...new Set(
        tts.filter(tt => tt.slots.some(s => s.teacherId === tch.id)).map(tt => tt.classId)
      )];
      if (tch.homeroomClass && !clsIds.includes(tch.homeroomClass)) clsIds.push(tch.homeroomClass);
      return DB.query('students', s => s.status === 'active' && clsIds.includes(s.classId))
        .sort((a,b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`));
    }
    if (roles.includes('parent')) {
      // Parent sees only their children
      const guardianStudents = DB.query('students', s =>
        s.guardians?.some(g => g.userId === user.id)
      );
      return guardianStudents;
    }
    if (roles.includes('student')) {
      return DB.query('students', s => s.userId === user.id);
    }
    return [];
  }

  /* ─────────────────────────────────────────
     UTILITY
  ───────────────────────────────────────── */
  function _className(classId) {
    return DB.getById('classes', classId)?.name || '—';
  }

  function _teacherLabel(classId) {
    const cls = DB.getById('classes', classId);
    if (!cls) return 'Class Teacher';
    const sec = DB.getById('sections', cls.sectionId);
    if (!sec) return 'Class Teacher';
    return (sec.name === 'KG' || sec.name === 'Primary') ? 'Homeroom Teacher' : 'Class Teacher';
  }

  function _houseInfo(houseId) {
    return _cfg().houses.find(h => h.id === houseId) || null;
  }

  function _demeritStageLabel(stage) {
    return _cfg().demeritStages.find(s => s.stage === stage)?.label || `Stage ${stage}`;
  }

  function _fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-KE',{day:'2-digit',month:'short',year:'numeric'});
  }

  /* ─────────────────────────────────────────
     PERIOD FILTERING HELPERS
  ───────────────────────────────────────── */
  function _periodDates(period) {
    const now   = new Date();
    const today = now.toISOString().split('T')[0];
    if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    if (period === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    return null; // 'term' and 'all' handled by caller
  }

  /* Filter an incidents array by the current _period.
     When period='term' we use termId matching (already pre-filtered by caller).
     When period='all'  we do not filter by date at all. */
  function _filterByPeriod(incidents, period) {
    if (period === 'term' || period === 'all') return incidents;
    const range = _periodDates(period);
    if (!range) return incidents;
    return incidents.filter(i => i.date >= range.from && i.date <= range.to);
  }

  function _periodLabel(p) {
    return { week:'This Week', month:'This Month', term:'This Term', all:'All Time' }[p] || p;
  }

  /* ─────────────────────────────────────────
     RENDER
  ───────────────────────────────────────── */
  function render(param) {
    if (param) _tab = param;
    // Redirect legacy 'incidents' key → 'register'
    if (_tab === 'incidents') _tab = 'register';
    App.setBreadcrumb('<i class="fas fa-shield-alt"></i> Behaviour & Pastoral');

    const roles      = Auth.currentUser?.roles || [Auth.currentUser?.role];
    const isStudent  = roles.includes('student');
    const isParent   = roles.includes('parent');
    const pendingAppeals = DB.query('behaviour_appeals', a => a.status === 'pending' || a.status === 'escalated').length;

    const tabs = [
      { key:'dashboard',  label:'Dashboard',         icon:'fas fa-chart-pie',   show: true },
      { key:'register',   label:'Register',           icon:'fas fa-list-alt',    show: !isStudent && !isParent },
      { key:'appeals',    label:'Appeals' + (pendingAppeals > 0 && !isStudent && !isParent ? ` <span style="background:#EF4444;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px">${pendingAppeals}</span>` : ''),
        icon:'fas fa-gavel', show: true },
      { key:'detentions', label:'Detentions',         icon:'fas fa-user-lock',   show: !isStudent && !isParent },
      { key:'settings',   label:'Settings',           icon:'fas fa-sliders-h',   show: _canSettings() },
    ].filter(t => t.show);

    if (!tabs.find(t => t.key === _tab)) _tab = tabs[0]?.key || 'dashboard';

    const tabHtml = tabs.map(t => `
      <button class="tab-btn ${_tab === t.key ? 'active' : ''}" onclick="Behaviour.setTab('${t.key}')">
        <i class="${t.icon}"></i> ${t.label}
      </button>`).join('');

    let content = '';
    if      (_tab === 'dashboard')  content = _dashboardView();
    else if (_tab === 'register')   content = _registerView();
    else if (_tab === 'appeals')    content = _appealsView();
    else if (_tab === 'detentions') content = _detentionsView();
    else if (_tab === 'settings')   content = _settingsView();

    App.renderPage(`
      <div class="page-header">
        <div class="page-title">
          <h1>Behaviour &amp; Pastoral</h1>
          <p>Merits, demerits, house points &amp; disciplinary tracking</p>
        </div>
        <div class="page-actions">
          ${_canSeeAll() ? `<button class="btn btn-secondary" onclick="Behaviour.generateReport()" style="margin-right:8px"><i class="fas fa-file-pdf"></i> Report</button>` : ''}
          ${_canLog() ? `<button class="btn btn-primary" onclick="Behaviour.logModal()"><i class="fas fa-plus"></i> Log Incident</button>` : ''}
        </div>
      </div>
      <div class="tabs" style="margin-bottom:20px">${tabHtml}</div>
      ${content}
    `);
  }

  function setTab(tab) { _tab = tab; render(); }

  /* ─────────────────────────────────────────
     DASHBOARD VIEW
  ───────────────────────────────────────── */
  function _dashboardView() {
    const cfg    = _cfg();
    const termId = SchoolContext.currentTermId();
    const user   = Auth.currentUser;
    const roles  = user?.roles || [user?.role];
    const isStudent = roles.includes('student');
    const isParent  = roles.includes('parent');

    /* ── Student/parent personal view ── */
    if (isStudent || isParent) return _personalView(termId);

    /* ── Period-filtered incidents ── */
    const baseInc  = _period === 'term'
      ? DB.query('behaviour_incidents', i => i.termId === termId)
      : _period === 'all'
        ? DB.get('behaviour_incidents')
        : _filterByPeriod(DB.get('behaviour_incidents'), _period);

    const students      = DB.query('students', s => s.status === 'active');
    const merits        = baseInc.filter(i => i.type === 'merit');
    const demerits      = baseInc.filter(i => i.type === 'demerit');
    const totalMeritPts = merits.reduce((s,i)  => s + (i.points||0), 0);
    const totalDemeritPts = demerits.reduce((s,i) => s + Math.abs(i.points||0), 0);

    /* Pending appeals count */
    const pendingAppeals = DB.query('behaviour_appeals', a => a.status==='pending'||a.status==='escalated').length;

    /* House Cup */
    const houseCup = cfg.houses.map(h => ({
      ...h, pts: _housePts(h.id, _period, termId)
    })).sort((a,b) => b.pts - a.pts);

    /* At-risk students: always use half-term demerit window (matches stage thresholds) */
    const atRisk = students.map(s => ({
      ...s,
      demerits: _halfTermDemeritPts(s.id)
    })).filter(s => s.demerits >= 3).sort((a,b) => b.demerits - a.demerits).slice(0,8);

    /* Top merit earners */
    const topMerit = students.map(s => ({
      ...s, merits: _meritPtsPeriod(s.id, _period, termId)
    })).filter(s => s.merits > 0).sort((a,b) => b.merits - a.merits).slice(0,8);

    /* Recent incidents */
    const recent = [...baseInc].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,6);

    /* Scheduled detentions */
    const upcomingDet = DB.query('detentions', d => d.status === 'scheduled');

    /* ── Period filter pills ── */
    const periodBar = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;flex-wrap:wrap">
      <span style="font-size:13px;color:var(--gray-500);font-weight:500">Showing:</span>
      ${['week','month','term','all'].map(p => `
        <button onclick="Behaviour.setPeriod('${p}')" style="padding:5px 14px;border-radius:20px;border:1px solid ${_period===p?'var(--primary)':'var(--gray-200)'};background:${_period===p?'var(--primary)':'#fff'};color:${_period===p?'#fff':'var(--gray-600)'};font-size:13px;cursor:pointer;font-weight:${_period===p?'600':'400'}">
          ${_periodLabel(p)}
        </button>`).join('')}
    </div>`;

    return `
    ${periodBar}

    <!-- Stats Row -->
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="stat-card"><div class="stat-icon" style="background:#E8F5E9"><i class="fas fa-star" style="color:#10B981"></i></div>
        <div class="stat-info"><h3>${totalMeritPts}</h3><p>Merit Points — ${_periodLabel(_period)}</p></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#FEF2F2"><i class="fas fa-exclamation-triangle" style="color:#EF4444"></i></div>
        <div class="stat-info"><h3>${totalDemeritPts}</h3><p>Demerit Points — ${_periodLabel(_period)}</p></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#EFF6FF"><i class="fas fa-clipboard-list" style="color:#3B82F6"></i></div>
        <div class="stat-info"><h3>${baseInc.length}</h3><p>Incidents Logged</p></div></div>
      <div class="stat-card" style="cursor:pointer" onclick="Behaviour.setTab('appeals')">
        <div class="stat-icon" style="background:#FFF7ED"><i class="fas fa-gavel" style="color:#F97316"></i></div>
        <div class="stat-info"><h3>${pendingAppeals}</h3><p>Pending Appeals</p></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <!-- House Cup -->
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-trophy" style="color:#F59E0B;margin-right:8px"></i>House Cup</h3>
          <span style="font-size:12px;color:var(--gray-400)">${_periodLabel(_period)}</span>
        </div>
        ${cfg.houses.length ? houseCup.map((h,i) => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0;${i < houseCup.length-1 ? 'border-bottom:1px solid var(--gray-100)' : ''}">
            <div style="width:28px;font-size:16px;text-align:center">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'4️⃣'}</div>
            <span style="font-size:20px">${h.badge}</span>
            <div style="flex:1">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-weight:600;color:${h.color}">${h.name} House</span>
                <strong>${h.pts} pts</strong>
              </div>
              <div style="background:var(--gray-100);border-radius:4px;height:6px">
                <div style="background:${h.color};border-radius:4px;height:6px;width:${Math.max(4, Math.min(100, houseCup[0]?.pts > 0 ? (h.pts/houseCup[0].pts*100) : 0))}%"></div>
              </div>
            </div>
          </div>`).join('') : '<div class="empty-state" style="padding:20px"><p>No houses configured yet.</p></div>'}
      </div>

      <!-- Recent Incidents -->
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-history" style="color:var(--primary);margin-right:8px"></i>Recent Incidents</h3></div>
        ${recent.length ? `<div style="overflow-x:auto"><table class="table">
          <thead><tr><th>Date</th><th>Student</th><th>Type</th><th>Pts</th><th>Status</th></tr></thead>
          <tbody>
          ${recent.map(i => {
            const stu = DB.getById('students', i.studentId);
            const statusBadge = i.status === 'appealing'  ? '<span class="badge badge-warning" style="font-size:10px">Appeal</span>'
                              : i.status === 'overturned' ? '<span class="badge badge-secondary" style="font-size:10px">Overturned</span>'
                              : '';
            return `<tr>
              <td style="white-space:nowrap;font-size:12px">${_fmtDate(i.date)}</td>
              <td style="font-size:13px">${stu ? `${stu.firstName} ${stu.lastName}` : '—'}</td>
              <td><span class="badge badge-${i.type==='merit'?'success':'danger'}" style="font-size:10px">${i.categoryName}</span></td>
              <td><strong style="color:${i.type==='merit'?'#10B981':'#EF4444'}">${i.type==='merit'?'+':''}${i.points}</strong></td>
              <td>${statusBadge}</td>
            </tr>`;
          }).join('')}
          </tbody></table></div>` : '<div class="empty-state" style="padding:20px"><p>No incidents in this period.</p></div>'}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <!-- At-Risk Students -->
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-exclamation-circle" style="color:#EF4444;margin-right:8px"></i>At-Risk Students</h3>
          <span style="font-size:12px;color:var(--gray-400)">3+ demerit pts this half-term</span>
        </div>
        ${atRisk.length ? `<table class="table">
          <thead><tr><th>Student</th><th>Class</th><th>Demerits</th><th>Stage</th></tr></thead>
          <tbody>${atRisk.map(s => {
            const stage     = _getCurrentStage(s.id, termId);
            const stageInfo = cfg.demeritStages.find(ds => ds.stage === stage);
            return `<tr>
              <td><strong>${s.firstName} ${s.lastName}</strong></td>
              <td style="font-size:12px">${_className(s.classId)}</td>
              <td><strong style="color:#EF4444">${s.demerits}</strong></td>
              <td>${stage ? `<span class="badge" style="background:${stageInfo?.color||'#EF4444'};color:#fff;font-size:10px">Stage ${stage}</span>` : '<span class="badge badge-secondary" style="font-size:10px">None</span>'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : '<div class="empty-state" style="padding:20px"><i class="fas fa-check-circle" style="color:#10B981;font-size:24px;margin-bottom:8px"></i><p>No at-risk students in this period!</p></div>'}
      </div>

      <!-- Top Merit Earners -->
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-medal" style="color:#F59E0B;margin-right:8px"></i>Top Merit Earners</h3>
          <span style="font-size:12px;color:var(--gray-400)">${_periodLabel(_period)}</span>
        </div>
        ${topMerit.length ? `<table class="table">
          <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Merits</th><th>Milestone</th></tr></thead>
          <tbody>${topMerit.map((s,idx) => {
            const ms = _topMilestone(s.id, termId);
            const h  = _houseInfo(s.houseId);
            return `<tr>
              <td style="font-size:13px">${idx===0?'🥇':idx===1?'🥈':idx===2?'🥉':`${idx+1}`}</td>
              <td>
                <div style="display:flex;align-items:center;gap:6px">
                  ${h ? `<span title="${h.name} House" style="color:${h.color}">${h.badge}</span>` : ''}
                  <strong style="font-size:13px">${s.firstName} ${s.lastName}</strong>
                </div>
              </td>
              <td style="font-size:12px">${_className(s.classId)}</td>
              <td><strong style="color:#10B981">+${s.merits}</strong></td>
              <td style="font-size:16px">${ms ? `<span title="${ms.name}">${ms.badge}</span>` : '—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : '<div class="empty-state" style="padding:20px"><p>No merits in this period yet.</p></div>'}
      </div>
    </div>

    <!-- ── Stage Alerts + Persistent Patterns ── -->
    ${_dashboardBottomPanels(students, baseInc, cfg, termId)}`;
  }

  /* Renders the two extra panels — extracted to keep _dashboardView readable */
  function _dashboardBottomPanels(students, baseInc, cfg, termId) {
    /* ── Stage Alerts (uses half-term demerit window) ── */
    const stageStudents = students
      .map(s => {
        const dp    = _halfTermDemeritPts(s.id);
        let stage   = null;
        let stageInfo = null;
        for (const st of (cfg.demeritStages || [])) {
          if (dp >= st.threshold) { stage = st.stage; stageInfo = st; }
        }
        return stage ? { ...s, stage, stageInfo, dp } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.stage - a.stage || b.dp - a.dp);

    const stagePanel = `
    <div class="card">
      <div class="card-header">
        <h3><i class="fas fa-exclamation-circle" style="color:#DC2626;margin-right:8px"></i>Stage Alerts</h3>
        <span style="font-size:12px;color:var(--gray-400)">Demerit stage based on rolling half-term window</span>
      </div>
      ${stageStudents.length ? `
      <div style="overflow-x:auto">
        <table class="table">
          <thead><tr><th>Student</th><th>Class</th><th>House</th><th>Stage</th><th>Who Handles</th><th>Demerit Pts (HT)</th></tr></thead>
          <tbody>
          ${stageStudents.map(s => {
            const h = _houseInfo(s.houseId);
            return `<tr>
              <td><strong style="font-size:13px">${s.firstName} ${s.lastName}</strong></td>
              <td style="font-size:12px">${_className(s.classId)}</td>
              <td>${h ? `<span style="color:${h.color}">${h.badge} ${h.name}</span>` : '—'}</td>
              <td>
                <span class="badge" style="background:${s.stageInfo?.color||'#EF4444'};color:#fff;font-size:11px">
                  Stage ${s.stage}
                </span>
              </td>
              <td style="font-size:12px;color:var(--gray-600)">${s.stageInfo?.who || s.stageInfo?.label || '—'}</td>
              <td><strong style="color:#EF4444">${s.dp}</strong></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>` : `
      <div class="empty-state" style="padding:28px">
        <i class="fas fa-shield-alt" style="font-size:28px;color:#10B981;margin-bottom:8px"></i>
        <h3>No students at a demerit stage</h3>
        <p>No one has crossed a stage threshold in this half-term.</p>
      </div>`}
    </div>`;

    /* ── Persistent Behaviour Patterns ── */
    const patterns  = _detectPatterns(baseInc, cfg);

    const patternsPanel = `
    <div class="card">
      <div class="card-header">
        <h3><i class="fas fa-redo" style="color:#8B5CF6;margin-right:8px"></i>Persistent Behaviour Patterns</h3>
        <span style="font-size:12px;color:var(--gray-400)">Same behaviour logged ≥ 2 times in ${_periodLabel(_period)}</span>
      </div>
      ${patterns.length ? `
      <div style="overflow-x:auto">
        <table class="table">
          <thead><tr><th>Student</th><th>Class</th><th>Behaviour</th><th>Type</th><th>Times</th><th>Last Logged</th></tr></thead>
          <tbody>
          ${patterns.slice(0, 12).map(p => {
            const stu  = DB.getById('students', p.studentId);
            const last = p.incidents.sort((a,b) => new Date(b.date)-new Date(a.date))[0];
            return `<tr>
              <td><strong style="font-size:13px">${stu ? `${stu.firstName} ${stu.lastName}` : '—'}</strong></td>
              <td style="font-size:12px">${stu ? _className(stu.classId) : '—'}</td>
              <td>
                <div style="font-size:13px;font-weight:500">${p.label}</div>
                <div style="font-size:11px;color:var(--gray-400)">${p.catName}</div>
              </td>
              <td><span class="badge badge-${p.type==='merit'?'success':'danger'}" style="font-size:10px">${p.type}</span></td>
              <td>
                <span style="display:inline-flex;align-items:center;justify-content:center;
                             width:28px;height:28px;border-radius:50%;font-weight:700;font-size:13px;
                             background:${p.type==='demerit'?'#FEF2F2':'#F0FDF4'};
                             color:${p.type==='demerit'?'#DC2626':'#059669'}">
                  ${p.incidents.length}×
                </span>
              </td>
              <td style="font-size:12px">${_fmtDate(last?.date)}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
        ${patterns.length > 12 ? `<div style="padding:8px 12px;font-size:12px;color:var(--gray-400);border-top:1px solid var(--gray-100)">+ ${patterns.length - 12} more patterns — switch to the Register for full view.</div>` : ''}
      </div>` : `
      <div class="empty-state" style="padding:28px">
        <i class="fas fa-check-circle" style="font-size:28px;color:#10B981;margin-bottom:8px"></i>
        <h3>No repeated patterns detected</h3>
        <p>No behaviour has been logged more than once per student in ${_periodLabel(_period).toLowerCase()}.</p>
      </div>`}
    </div>`;

    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">${stagePanel}${patternsPanel}</div>`;
  }

  function _termLabel(termId) {
    const ay = DB.get('academicYears').find(y => y.terms?.some(t => t.id === termId));
    if (!ay) return termId;
    const term = ay.terms.find(t => t.id === termId);
    return term ? `${ay.name} — ${term.name}` : termId;
  }

  /* Demerit points within the configured window (half-term or full term) */
  function _halfTermDemeritPts(studentId) {
    const cfg    = _cfg();
    const weeks  = cfg.halfTermWeeks || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - weeks * 7);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return DB.query('behaviour_incidents', i =>
      i.studentId === studentId &&
      i.type === 'demerit' &&
      i.date >= cutoffStr
    ).reduce((sum, i) => sum + Math.abs(i.points || 0), 0);
  }

  /* Stage check respects cfg.demeritWindow ('halfterm' | 'term') */
  function _getCurrentStage(studentId, termId) {
    const cfg   = _cfg();
    const useHT = (cfg.demeritWindow || 'halfterm') === 'halfterm';
    const dp    = useHT ? _halfTermDemeritPts(studentId) : _demeritPts(studentId, termId);
    if (!dp) return null;
    let stage = null;
    for (const s of cfg.demeritStages) {
      if (dp >= s.threshold) stage = s.stage;
    }
    return stage;
  }

  function _topMilestone(studentId, termId) {
    const cfg = _cfg();
    const mp  = _meritPts(studentId, termId);
    let best  = null;
    for (const ms of cfg.meritMilestones) {
      if (mp >= ms.threshold) best = ms;
    }
    return best;
  }

  /* Detect persistent behaviour: same behaviourId logged ≥ 2 times in a set of incidents */
  function _detectPatterns(incidents, cfg) {
    const matrixInc = incidents.filter(i => i.behaviourId);
    const counts    = {};
    matrixInc.forEach(i => {
      const key = `${i.studentId}::${i.behaviourId}`;
      if (!counts[key]) {
        const matItem = (cfg.matrix || []).find(m => m.id === i.behaviourId);
        counts[key] = {
          studentId:   i.studentId,
          behaviourId: i.behaviourId,
          label:       matItem?.label || i.categoryName,
          catName:     i.categoryName,
          type:        i.type,
          incidents:   []
        };
      }
      counts[key].incidents.push(i);
    });
    return Object.values(counts)
      .filter(p => p.incidents.length >= 2)
      .sort((a, b) => b.incidents.length - a.incidents.length);
  }

  /* ─────────────────────────────────────────
     PERSONAL VIEW (student / parent)
  ───────────────────────────────────────── */
  function _personalView(termId) {
    const user    = Auth.currentUser;
    const roles   = user?.roles || [user?.role];
    const cfg     = _cfg();
    let students  = _myStudents();

    if (!students.length) return '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>No student linked</h3><p>No student record is linked to your account.</p></div>';

    return students.map(s => {
      const inc    = _stuIncidents(s.id, termId);
      const merits = inc.filter(i => i.type === 'merit');
      const dem    = inc.filter(i => i.type === 'demerit');
      const mp     = _meritPts(s.id, termId);
      const dp     = _demeritPts(s.id, termId);
      const net    = mp - dp;
      const ms     = _topMilestone(s.id, termId);
      const stage  = _getCurrentStage(s.id, termId);
      const house  = _houseInfo(s.houseId);
      const cls    = DB.getById('classes', s.classId);

      /* Next milestone */
      const nextMs = cfg.meritMilestones.find(m => m.threshold > mp);

      return `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header" style="display:flex;align-items:center;gap:16px">
          <div class="avatar-circle" style="background:var(--primary);width:48px;height:48px;font-size:20px;flex-shrink:0">${s.firstName.charAt(0)}</div>
          <div>
            <h2 style="margin:0">${s.firstName} ${s.lastName}</h2>
            <div style="font-size:13px;color:var(--gray-400)">${cls?.name || '—'}${house ? ` · <span style="color:${house.color}">${house.badge} ${house.name} House</span>` : ''}</div>
          </div>
          ${ms ? `<div style="margin-left:auto;text-align:center"><span style="font-size:32px">${ms.badge}</span><div style="font-size:12px;color:var(--gray-500)">${ms.name}</div></div>` : ''}
        </div>

        <!-- Points summary -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px 0;border-top:1px solid var(--gray-100)">
          <div style="text-align:center;padding:12px;background:#F0FDF4;border-radius:8px">
            <div style="font-size:28px;font-weight:700;color:#10B981">+${mp}</div>
            <div style="font-size:12px;color:var(--gray-500)">Merit Points</div>
          </div>
          <div style="text-align:center;padding:12px;background:${dp>0?'#FEF2F2':'#F8FAFC'};border-radius:8px">
            <div style="font-size:28px;font-weight:700;color:${dp>0?'#EF4444':'var(--gray-400)'}">${dp>0?'-'+dp:'0'}</div>
            <div style="font-size:12px;color:var(--gray-500)">Demerit Points</div>
          </div>
          <div style="text-align:center;padding:12px;background:${net>=0?'#F0FDF4':'#FEF2F2'};border-radius:8px">
            <div style="font-size:28px;font-weight:700;color:${net>=0?'#10B981':'#EF4444'}">${net>=0?'+':''}${net}</div>
            <div style="font-size:12px;color:var(--gray-500)">Net Balance</div>
          </div>
        </div>

        ${nextMs ? `
        <!-- Next milestone progress -->
        <div style="padding:12px;background:#FFFBEB;border-radius:8px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
            <span>🎯 Next: <strong>${nextMs.name}</strong> ${nextMs.badge}</span>
            <span style="color:var(--gray-500)">${mp}/${nextMs.threshold} pts</span>
          </div>
          <div style="background:var(--gray-200);border-radius:4px;height:8px">
            <div style="background:#F59E0B;border-radius:4px;height:8px;width:${Math.min(100,mp/nextMs.threshold*100).toFixed(1)}%;transition:width .3s"></div>
          </div>
        </div>` : ms ? `<div style="padding:12px;background:#F0FDF4;border-radius:8px;margin-bottom:16px;text-align:center;font-size:13px;color:#10B981">🎉 Highest milestone achieved: <strong>${ms.name}</strong> ${ms.badge}</div>` : ''}

        ${stage ? `
        <div style="padding:10px 14px;background:#FEF2F2;border-radius:8px;border-left:4px solid #EF4444;margin-bottom:16px;font-size:13px">
          <strong style="color:#DC2626">⚠️ ${_demeritStageLabel(stage)}</strong>
          <span style="color:var(--gray-500);margin-left:8px">${cfg.demeritStages.find(d=>d.stage===stage)?.action||''}</span>
        </div>` : ''}

        <!-- Demerits with appeal buttons -->
        ${dem.length ? `
        <h4 style="margin-bottom:10px;color:var(--gray-600)"><i class="fas fa-exclamation-triangle" style="color:#EF4444"></i> Demerits This Term</h4>
        <table class="table" style="margin-bottom:16px"><thead><tr><th>Date</th><th>Category</th><th>Points</th><th>Note</th><th>Status</th><th></th></tr></thead>
        <tbody>${dem.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(i => {
          const incStatus = i.status || 'active';
          const hasAppeal = DB.query('behaviour_appeals', a => a.incidentId === i.id).length > 0;
          return `<tr style="${incStatus==='overturned'?'opacity:0.6':''}">
            <td style="font-size:12px">${_fmtDate(i.date)}</td>
            <td><span class="badge badge-danger" style="font-size:10px">${i.categoryName}</span></td>
            <td><strong style="color:#EF4444">${i.points}</strong></td>
            <td style="max-width:220px;font-size:12px;color:var(--gray-600)">${i.note||i.description||'—'}</td>
            <td>${incStatus==='appealing'?'<span class="badge badge-warning" style="font-size:10px">Under Appeal</span>':incStatus==='overturned'?'<span class="badge badge-secondary" style="font-size:10px">Overturned</span>':'<span style="font-size:11px;color:var(--gray-400)">Active</span>'}</td>
            <td>${incStatus==='active' && !hasAppeal ? `<button class="btn btn-sm btn-secondary" onclick="Behaviour.submitAppealModal('${i.id}')"><i class="fas fa-gavel"></i> Appeal</button>` : ''}</td>
          </tr>`;
        }).join('')}</tbody></table>` : ''}

        <!-- Merit incidents -->
        ${merits.length ? `
        <h4 style="margin-bottom:10px;color:var(--gray-600)"><i class="fas fa-star" style="color:#F59E0B"></i> Merits This Term</h4>
        <table class="table" style="margin-bottom:0"><thead><tr><th>Date</th><th>Category</th><th>Points</th><th>Note</th></tr></thead>
        <tbody>${merits.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(i=>`
          <tr><td style="font-size:12px">${_fmtDate(i.date)}</td><td><span class="badge badge-success" style="font-size:10px">${i.categoryName}</span></td>
          <td><strong style="color:#10B981">+${i.points}</strong></td>
          <td style="max-width:280px;font-size:12px;color:var(--gray-600)">${i.note||i.description||'—'}</td>
          </tr>
        `).join('')}</tbody></table>` : '<p style="color:var(--gray-400);font-size:13px;padding-top:8px">No merits logged this term yet.</p>'}
      </div>`;
    }).join('');
  }

  /* ─────────────────────────────────────────
     INCIDENT REGISTER VIEW
  ───────────────────────────────────────── */
  function _registerView() {
    const termId   = SchoolContext.currentTermId();
    const cfg      = _cfg();
    const classes  = Auth.myClasses ? Auth.myClasses() : DB.get('classes');

    /* Build base pool based on period */
    let incidents = _canSeeAll()
      ? (_period === 'term'
          ? DB.query('behaviour_incidents', i => i.termId === termId)
          : _period === 'all'
            ? DB.get('behaviour_incidents')
            : _filterByPeriod(DB.get('behaviour_incidents'), _period))
      : _myStudents().reduce((arr, s) => {
          const stuInc = _period === 'term'
            ? DB.query('behaviour_incidents', i => i.studentId === s.id && i.termId === termId)
            : _filterByPeriod(DB.query('behaviour_incidents', i => i.studentId === s.id), _period);
          return arr.concat(stuInc);
        }, []);

    /* Apply filters */
    if (_incFilter.type !== 'all')   incidents = incidents.filter(i => i.type === _incFilter.type);
    if (_incFilter.status !== 'all') incidents = incidents.filter(i => (i.status||'active') === _incFilter.status);
    if (_incFilter.classId) incidents = incidents.filter(i => {
      const stu = DB.getById('students', i.studentId);
      return stu?.classId === _incFilter.classId;
    });
    if (_incFilter.search) {
      const q = _incFilter.search.toLowerCase();
      incidents = incidents.filter(i => {
        const stu = DB.getById('students', i.studentId);
        const note = (i.note || i.description || '').toLowerCase();
        return `${stu?.firstName||''} ${stu?.lastName||''}`.toLowerCase().includes(q)
          || (i.categoryName||'').toLowerCase().includes(q)
          || note.includes(q);
      });
    }
    incidents = [...incidents].sort((a,b) => new Date(b.date) - new Date(a.date));

    const periodBar = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:13px;color:var(--gray-500);font-weight:500">Period:</span>
      ${['week','month','term','all'].map(p => `
        <button onclick="Behaviour.setPeriod('${p}')" style="padding:4px 12px;border-radius:16px;border:1px solid ${_period===p?'var(--primary)':'var(--gray-200)'};background:${_period===p?'var(--primary)':'#fff'};color:${_period===p?'#fff':'var(--gray-600)'};font-size:12px;cursor:pointer">
          ${_periodLabel(p)}
        </button>`).join('')}
    </div>`;

    const statusColor = { active:'', appealing:'#F97316', overturned:'#94A3B8' };

    return `
    ${periodBar}
    <!-- Filter Bar -->
    <div class="card" style="padding:14px;margin-bottom:16px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <select class="form-control" style="width:130px" onchange="Behaviour._setFilter('type',this.value)">
          <option value="all"     ${_incFilter.type==='all'?'selected':''}>All Types</option>
          <option value="merit"   ${_incFilter.type==='merit'?'selected':''}>Merits Only</option>
          <option value="demerit" ${_incFilter.type==='demerit'?'selected':''}>Demerits Only</option>
        </select>
        <select class="form-control" style="width:140px" onchange="Behaviour._setFilter('status',this.value)">
          <option value="all"       ${_incFilter.status==='all'?'selected':''}>All Status</option>
          <option value="active"    ${_incFilter.status==='active'?'selected':''}>Active</option>
          <option value="appealing" ${_incFilter.status==='appealing'?'selected':''}>Under Appeal</option>
          <option value="overturned"${_incFilter.status==='overturned'?'selected':''}>Overturned</option>
        </select>
        <select class="form-control" style="width:155px" onchange="Behaviour._setFilter('classId',this.value)">
          <option value="">All Classes</option>
          ${classes.map(c=>`<option value="${c.id}" ${_incFilter.classId===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
        <div style="flex:1;min-width:180px">
          <input type="text" class="form-control" placeholder="Search student, category…" value="${_incFilter.search}" oninput="Behaviour._setFilter('search',this.value)">
        </div>
        <div style="color:var(--gray-400);font-size:13px">${incidents.length} result${incidents.length!==1?'s':''}</div>
      </div>
    </div>

    <!-- Table -->
    <div class="card">
      ${incidents.length ? `
      <div style="overflow-x:auto">
        <table class="table">
          <thead><tr><th>Date</th><th>Student</th><th>Class</th><th>House</th><th>Type</th><th>Category</th><th>Pts</th><th>Note</th><th>Reported By</th><th>Stage</th><th>Status</th>${_canEdit()?'<th></th>':''}</tr></thead>
          <tbody>
          ${incidents.map(inc => {
            const stu      = DB.getById('students', inc.studentId);
            const house    = stu ? _houseInfo(stu.houseId) : null;
            const stageNow = inc.type==='demerit' && inc.stageReached
              ? cfg.demeritStages.find(s => s.stage === inc.stageReached) : null;
            const incStatus = inc.status || 'active';
            const statusBadge = incStatus === 'appealing'
              ? '<span class="badge badge-warning" style="font-size:10px;white-space:nowrap">Under Appeal</span>'
              : incStatus === 'overturned'
                ? '<span class="badge badge-secondary" style="font-size:10px">Overturned</span>'
                : '<span style="font-size:11px;color:var(--gray-400)">Active</span>';
            return `<tr style="${incStatus==='overturned'?'opacity:0.6':''}">
              <td style="white-space:nowrap;font-size:12px">${_fmtDate(inc.date)}</td>
              <td><strong style="font-size:13px">${stu ? `${stu.firstName} ${stu.lastName}` : '—'}</strong></td>
              <td style="font-size:12px">${stu ? _className(stu.classId) : '—'}</td>
              <td>${house ? `<span title="${house.name} House" style="color:${house.color}">${house.badge}</span>` : '—'}</td>
              <td><span class="badge badge-${inc.type==='merit'?'success':'danger'}" style="font-size:10px">${inc.type}</span></td>
              <td style="font-size:12px">${inc.categoryName}</td>
              <td><strong style="color:${inc.type==='merit'?'#10B981':'#EF4444'}">${inc.type==='merit'?'+':''}${inc.points}</strong></td>
              <td style="max-width:200px;font-size:12px;color:var(--gray-600)">${inc.note||inc.description||'—'}</td>
              <td style="font-size:12px">${inc.reportedByName||'—'}</td>
              <td>${stageNow ? `<span class="badge" style="background:${stageNow.color||'#EF4444'};color:#fff;font-size:10px">Stage ${stageNow.stage}</span>` : '—'}</td>
              <td>${statusBadge}</td>
              ${_canEdit() ? `<td style="white-space:nowrap">
                <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.deleteIncident('${inc.id}')" title="Delete"><i class="fas fa-trash"></i></button>
              </td>` : ''}
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state" style="padding:40px">
        <i class="fas fa-clipboard-list" style="font-size:40px;color:var(--gray-300);margin-bottom:12px"></i>
        <h3>No incidents found</h3><p>Try adjusting your filters or period.</p>
      </div>`}
    </div>`;
  }

  function _setFilter(key, val) {
    _incFilter[key] = val;
    render();
  }

  /* ─────────────────────────────────────────
     APPEALS VIEW  (Phase 3)
  ───────────────────────────────────────── */
  function _canResolveAppeals() {
    const r = Auth.currentUser?.roles || [Auth.currentUser?.role];
    return r.some(x => ['superadmin','admin','deputy_principal','discipline_committee','section_head','teacher'].includes(x));
  }

  function _appealStatusBadge(status) {
    const map = {
      pending:   'badge-secondary',
      escalated: 'badge-warning',
      accepted:  'badge-success',
      rejected:  'badge-danger'
    };
    return `<span class="badge ${map[status]||'badge-secondary'}" style="font-size:10px">${status}</span>`;
  }

  function _appealsView() {
    const appeals   = DB.get('behaviour_appeals') || [];
    const user      = Auth.currentUser;
    const roles     = user?.roles || [user?.role];
    const isStudent = roles.includes('student');
    const isParent  = roles.includes('parent');

    /* ── STUDENT VIEW ── */
    if (isStudent) {
      const stu        = DB.query('students', s => s.userId === user.id)[0];
      const myAppeals  = stu ? appeals.filter(a => a.studentId === stu.id) : [];
      const appealedIds= new Set(myAppeals.map(a => a.incidentId));
      const termId     = SchoolContext.currentTermId();
      /* Eligible: active demerits this term with no existing appeal */
      const eligible   = stu
        ? DB.query('behaviour_incidents', i =>
            i.studentId === stu.id &&
            i.type === 'demerit' &&
            (i.status || 'active') === 'active' &&
            !appealedIds.has(i.id)
          ).sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10)
        : [];

      return `
      <!-- My submitted appeals -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3><i class="fas fa-gavel" style="color:var(--primary);margin-right:8px"></i>My Appeals</h3>
        </div>
        ${myAppeals.length ? `
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Incident</th><th>Category</th><th>Points</th><th>Submitted</th><th>Status</th><th>Resolution</th></tr></thead>
            <tbody>
            ${myAppeals.sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt)).map(a => {
              const inc = DB.getById('behaviour_incidents', a.incidentId);
              return `<tr>
                <td style="font-size:12px">${_fmtDate(inc?.date)}</td>
                <td style="font-size:12px">${inc?.categoryName||'—'}</td>
                <td><strong style="color:#EF4444">${inc?.points||''}</strong></td>
                <td style="font-size:12px">${_fmtDate(a.submittedAt?.split('T')[0])}</td>
                <td>${_appealStatusBadge(a.status)}</td>
                <td style="font-size:12px;color:var(--gray-600);max-width:220px">${a.resolution || (a.status==='pending'||a.status==='escalated' ? '<em style="color:var(--gray-400)">Awaiting review…</em>' : '—')}</td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="empty-state" style="padding:28px">
          <i class="fas fa-gavel" style="font-size:28px;color:var(--gray-300);margin-bottom:8px"></i>
          <h3>No appeals submitted</h3>
          <p>You can appeal any active demerit below.</p>
        </div>`}
      </div>

      <!-- Eligible incidents to appeal -->
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-exclamation-triangle" style="color:#EF4444;margin-right:8px"></i>Demerits Eligible to Appeal</h3>
          <span style="font-size:12px;color:var(--gray-400)">Active demerits with no pending appeal</span>
        </div>
        ${eligible.length ? `
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Date</th><th>Category</th><th>Points</th><th>Note</th><th></th></tr></thead>
            <tbody>
            ${eligible.map(inc => `<tr>
              <td style="font-size:12px">${_fmtDate(inc.date)}</td>
              <td style="font-size:12px">${inc.categoryName}</td>
              <td><strong style="color:#EF4444">${inc.points}</strong></td>
              <td style="font-size:12px;color:var(--gray-600);max-width:200px">${inc.note||inc.description||'—'}</td>
              <td><button class="btn btn-sm btn-primary" onclick="Behaviour.submitAppealModal('${inc.id}')">
                <i class="fas fa-gavel"></i> Appeal
              </button></td>
            </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="empty-state" style="padding:28px">
          <i class="fas fa-check-circle" style="font-size:28px;color:#10B981;margin-bottom:8px"></i>
          <h3>No eligible demerits</h3>
          <p>All active demerits have already been appealed, or there are none.</p>
        </div>`}
      </div>`;
    }

    /* ── PARENT VIEW ── */
    if (isParent) {
      const children   = DB.query('students', s => s.guardians?.some(g => g.userId === user.id));
      const childIds   = new Set(children.map(c => c.id));
      const myAppeals  = appeals.filter(a => childIds.has(a.studentId))
                                .sort((a,b) => new Date(b.submittedAt) - new Date(a.submittedAt));
      const pending    = myAppeals.filter(a => a.status === 'pending' || a.status === 'escalated');
      const resolved   = myAppeals.filter(a => a.status === 'accepted' || a.status === 'rejected');

      return `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3><i class="fas fa-hourglass-half" style="color:#F97316;margin-right:8px"></i>Pending Appeals — Your Children</h3>
          <span class="badge badge-warning">${pending.length}</span>
        </div>
        ${pending.length ? `
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Child</th><th>Incident</th><th>Points</th><th>Student's Reason</th><th>Your Note</th><th>Status</th><th></th></tr></thead>
            <tbody>
            ${pending.map(a => {
              const inc = DB.getById('behaviour_incidents', a.incidentId);
              const stu = children.find(c => c.id === a.studentId);
              return `<tr>
                <td style="font-size:13px"><strong>${stu ? `${stu.firstName}` : '—'}</strong></td>
                <td style="font-size:12px">${inc?.categoryName||'—'}<br><span style="color:var(--gray-400);font-size:11px">${_fmtDate(inc?.date)}</span></td>
                <td><strong style="color:#EF4444">${inc?.points||''}</strong></td>
                <td style="font-size:12px;max-width:180px;color:var(--gray-600)">${a.reason||'—'}</td>
                <td style="font-size:12px;max-width:160px;color:var(--gray-600)">${a.parentNote || `<em style="color:var(--gray-400)">No note added</em>`}</td>
                <td>${_appealStatusBadge(a.status)}</td>
                <td>
                  <button class="btn btn-sm btn-secondary" onclick="Behaviour.addParentNoteModal('${a.id}')">
                    <i class="fas fa-pen"></i> ${a.parentNote ? 'Edit Note' : 'Add Note'}
                  </button>
                </td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="empty-state" style="padding:28px">
          <i class="fas fa-check-circle" style="font-size:28px;color:#10B981;margin-bottom:8px"></i>
          <h3>No pending appeals for your children</h3>
        </div>`}
      </div>

      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-check-double" style="color:var(--gray-400);margin-right:8px"></i>Resolved Appeals</h3>
        </div>
        ${resolved.length ? `
        <table class="table">
          <thead><tr><th>Child</th><th>Incident</th><th>Outcome</th><th>Resolution Note</th></tr></thead>
          <tbody>
          ${resolved.map(a => {
            const inc = DB.getById('behaviour_incidents', a.incidentId);
            const stu = children.find(c => c.id === a.studentId);
            return `<tr>
              <td style="font-size:13px">${stu?.firstName||'—'}</td>
              <td style="font-size:12px">${inc?.categoryName||'—'}</td>
              <td>${_appealStatusBadge(a.status)}</td>
              <td style="font-size:12px;color:var(--gray-600);max-width:240px">${a.resolution||'—'}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>` : `<div class="empty-state" style="padding:28px"><p>No resolved appeals yet.</p></div>`}
      </div>`;
    }

    /* ── STAFF VIEW ── */
    const canEscalate = (() => {
      const r = roles;
      return r.some(x => ['superadmin','admin','deputy_principal','discipline_committee'].includes(x));
    })();
    const pending  = appeals.filter(a => a.status === 'pending' || a.status === 'escalated')
                            .sort((a,b) => new Date(a.submittedAt) - new Date(b.submittedAt));
    const resolved = appeals.filter(a => a.status === 'accepted' || a.status === 'rejected')
                            .sort((a,b) => new Date(b.resolvedAt||b.submittedAt) - new Date(a.resolvedAt||a.submittedAt));

    return `
    <div style="margin-bottom:20px">
      <!-- Pending/Escalated -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3><i class="fas fa-hourglass-half" style="color:#F97316;margin-right:8px"></i>Pending Appeals</h3>
          <span class="badge badge-warning">${pending.length}</span>
        </div>
        ${pending.length ? `
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Student</th><th>Incident</th><th>Date</th><th>Student's Reason</th><th>Parent Note</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
            ${pending.map(a => {
              const inc = DB.getById('behaviour_incidents', a.incidentId);
              const stu = inc ? DB.getById('students', inc.studentId) : null;
              return `<tr>
                <td>
                  <strong style="font-size:13px">${stu ? `${stu.firstName} ${stu.lastName}` : '—'}</strong><br>
                  <span style="font-size:11px;color:var(--gray-400)">${stu ? _className(stu.classId) : ''}</span>
                </td>
                <td style="font-size:12px">
                  ${inc?.categoryName||'—'}<br>
                  <strong style="color:#EF4444">${inc?.points||''} pts</strong>
                </td>
                <td style="font-size:12px;white-space:nowrap">${_fmtDate(a.submittedAt?.split('T')[0])}</td>
                <td style="font-size:12px;max-width:180px;color:var(--gray-600)">${a.reason||'—'}</td>
                <td style="font-size:12px;max-width:150px;color:var(--gray-500)">${a.parentNote||'<em style="color:var(--gray-300)">None</em>'}</td>
                <td>${_appealStatusBadge(a.status)}</td>
                <td style="white-space:nowrap">
                  <button class="btn btn-sm btn-success btn-icon" onclick="Behaviour.resolveAppealModal('${a.id}','accepted')" title="Accept — overturn incident"><i class="fas fa-check"></i></button>
                  <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.resolveAppealModal('${a.id}','rejected')" title="Reject appeal"><i class="fas fa-times"></i></button>
                  ${canEscalate && a.status !== 'escalated' ? `<button class="btn btn-sm btn-warning btn-icon" onclick="Behaviour.resolveAppealModal('${a.id}','escalated')" title="Escalate to panel"><i class="fas fa-arrow-up"></i></button>` : ''}
                </td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="empty-state" style="padding:36px">
          <i class="fas fa-check-circle" style="font-size:36px;color:#10B981;margin-bottom:10px"></i>
          <h3>No pending appeals</h3><p>All clear.</p>
        </div>`}
      </div>

      <!-- Resolved -->
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-check-double" style="color:var(--gray-400);margin-right:8px"></i>Resolved Appeals</h3>
          <span class="badge badge-secondary">${resolved.length}</span>
        </div>
        ${resolved.length ? `
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Student</th><th>Incident</th><th>Outcome</th><th>Resolution Note</th><th>Resolved By</th><th>Date</th></tr></thead>
            <tbody>
            ${resolved.map(a => {
              const inc = DB.getById('behaviour_incidents', a.incidentId);
              const stu = inc ? DB.getById('students', inc.studentId) : null;
              return `<tr>
                <td style="font-size:13px"><strong>${stu ? `${stu.firstName} ${stu.lastName}` : '—'}</strong></td>
                <td style="font-size:12px">${inc?.categoryName||'—'} <strong style="color:#EF4444">${inc?.points||''}</strong></td>
                <td>${_appealStatusBadge(a.status)}</td>
                <td style="font-size:12px;max-width:220px;color:var(--gray-600)">${a.resolution||'—'}</td>
                <td style="font-size:12px">${a.resolvedByName||'—'}</td>
                <td style="font-size:12px">${_fmtDate(a.resolvedAt?.split('T')[0])}</td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>` : `<div class="empty-state" style="padding:28px"><p>No resolved appeals yet.</p></div>`}
      </div>
    </div>`;
  }

  /* ─────────────────────────────────────────
     APPEALS — STUDENT SUBMIT
  ───────────────────────────────────────── */
  function submitAppealModal(incidentId) {
    const inc = DB.getById('behaviour_incidents', incidentId);
    if (!inc) return showToast('Incident not found.', 'warning');
    const existing = DB.query('behaviour_appeals', a => a.incidentId === incidentId);
    if (existing.length) return showToast('An appeal already exists for this incident.', 'warning');

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-gavel"></i> Submit Appeal</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <!-- Incident summary -->
      <div style="padding:12px 14px;background:#FEF2F2;border-radius:8px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Incident being appealed</div>
          <div style="font-size:14px;font-weight:600;color:#DC2626">${inc.categoryName}</div>
          <div style="font-size:12px;color:var(--gray-500)">${_fmtDate(inc.date)} · ${inc.note||inc.description||''}</div>
        </div>
        <div style="font-size:26px;font-weight:800;color:#DC2626">${inc.points} pts</div>
      </div>

      <div class="form-field" style="margin-bottom:16px">
        <label>Your Reason for Appeal *</label>
        <textarea id="appeal-reason" rows="4" placeholder="Explain clearly why you believe this incident should be reconsidered…"
          style="width:100%;box-sizing:border-box;resize:vertical"></textarea>
        <div style="font-size:11px;color:var(--gray-400);margin-top:4px">Be specific and factual. Your reason will be seen by the reviewing staff member.</div>
      </div>

      <div style="background:#EFF6FF;border-radius:8px;padding:10px 14px;font-size:12px;color:#1E40AF;margin-bottom:16px">
        <i class="fas fa-info-circle" style="margin-right:6px"></i>
        Submitting an appeal does not immediately remove the demerit. It places the incident under review and notifies a staff member.
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Behaviour.saveAppeal('${incidentId}')">
          <i class="fas fa-paper-plane"></i> Submit Appeal
        </button>
      </div>
    </div>`, 'sm');
  }

  function saveAppeal(incidentId) {
    const reason = (document.getElementById('appeal-reason')?.value || '').trim();
    if (!reason) return showToast('Please provide a reason for your appeal.', 'warning');

    const inc  = DB.getById('behaviour_incidents', incidentId);
    if (!inc)  return showToast('Incident not found.', 'warning');
    const user = Auth.currentUser;
    const stu  = DB.query('students', s => s.userId === user.id)[0];

    DB.insert('behaviour_appeals', {
      schoolId:       'sch1',
      incidentId,
      studentId:      inc.studentId,
      submittedBy:    user.id,
      submittedByName: user.name,
      submittedAt:    new Date().toISOString(),
      reason,
      parentNote:     null,
      resolution:     null,
      resolvedBy:     null,
      resolvedByName: null,
      resolvedAt:     null,
      status:         'pending'
    });

    /* Mark incident as under appeal */
    DB.update('behaviour_incidents', incidentId, { status: 'appealing' });

    showToast('Appeal submitted. A staff member will review it.', 'success');
    _closeModal();
    render();
  }

  /* ─────────────────────────────────────────
     APPEALS — STAFF RESOLVE (accept / reject / escalate)
  ───────────────────────────────────────── */
  function resolveAppealModal(appealId, outcome) {
    const appeal = DB.getById('behaviour_appeals', appealId);
    if (!appeal) return showToast('Appeal not found.', 'warning');
    const inc    = DB.getById('behaviour_incidents', appeal.incidentId);
    const stu    = inc ? DB.getById('students', inc.studentId) : null;

    const outcomeLabels = {
      accepted:  { label:'Accept Appeal (Overturn Incident)', color:'#10B981', bg:'#F0FDF4', icon:'fa-check-circle' },
      rejected:  { label:'Reject Appeal',                     color:'#EF4444', bg:'#FEF2F2', icon:'fa-times-circle' },
      escalated: { label:'Escalate to Disciplinary Panel',    color:'#F97316', bg:'#FFF7ED', icon:'fa-arrow-circle-up' }
    };
    const meta = outcomeLabels[outcome] || outcomeLabels.rejected;

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-gavel"></i> Resolve Appeal</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <!-- Student + incident summary -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="padding:10px;background:var(--gray-50);border-radius:8px">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;margin-bottom:4px">Student</div>
          <div style="font-weight:600">${stu ? `${stu.firstName} ${stu.lastName}` : '—'}</div>
          <div style="font-size:12px;color:var(--gray-500)">${stu ? _className(stu.classId) : ''}</div>
        </div>
        <div style="padding:10px;background:#FEF2F2;border-radius:8px">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;margin-bottom:4px">Incident</div>
          <div style="font-weight:600;color:#DC2626">${inc?.categoryName||'—'} (${inc?.points||0} pts)</div>
          <div style="font-size:12px;color:var(--gray-500)">${_fmtDate(inc?.date)}</div>
        </div>
      </div>

      <!-- Student's reason -->
      <div style="padding:10px 14px;background:#FFFBEB;border-radius:8px;margin-bottom:16px">
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;margin-bottom:4px">Student's Reason</div>
        <div style="font-size:13px;color:var(--gray-700)">${appeal.reason||'—'}</div>
        ${appeal.parentNote ? `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid #FCD34D">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;margin-bottom:2px">Parent Note</div>
          <div style="font-size:13px;color:var(--gray-700)">${appeal.parentNote}</div>
        </div>` : ''}
      </div>

      <!-- Outcome banner -->
      <div style="padding:10px 14px;background:${meta.bg};border-radius:8px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <i class="fas ${meta.icon}" style="color:${meta.color};font-size:20px"></i>
        <span style="font-weight:600;color:${meta.color}">${meta.label}</span>
      </div>

      <div class="form-field" style="margin-bottom:16px">
        <label>Resolution Note *</label>
        <textarea id="resolve-note" rows="3" placeholder="${outcome==='accepted'?'Explain why the appeal is upheld and the incident overturned…':outcome==='escalated'?'Explain why this needs panel review…':'Explain why the appeal is not upheld…'}"
          style="width:100%;box-sizing:border-box;resize:vertical"></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" style="background:${meta.color};border-color:${meta.color}"
          onclick="Behaviour.saveResolution('${appealId}','${outcome}')">
          <i class="fas ${meta.icon}"></i> Confirm
        </button>
      </div>
    </div>`, 'sm');
  }

  function saveResolution(appealId, outcome) {
    const note = (document.getElementById('resolve-note')?.value || '').trim();
    if (!note) return showToast('Please provide a resolution note.', 'warning');

    const appeal = DB.getById('behaviour_appeals', appealId);
    if (!appeal) return showToast('Appeal not found.', 'warning');
    const user   = Auth.currentUser;

    /* Update appeal record */
    DB.update('behaviour_appeals', appealId, {
      status:         outcome,
      resolution:     note,
      resolvedBy:     user.id,
      resolvedByName: user.name,
      resolvedAt:     new Date().toISOString()
    });

    /* Update incident status */
    if (outcome === 'accepted') {
      DB.update('behaviour_incidents', appeal.incidentId, { status: 'overturned' });
    } else if (outcome === 'rejected') {
      DB.update('behaviour_incidents', appeal.incidentId, { status: 'active' });
    }
    /* escalated: incident stays 'appealing' */

    /* Audit trail — capture before state before writes ran */
    const inc = DB.getById('behaviour_incidents', appeal.incidentId);
    const stu = inc ? DB.getById('students', inc.studentId) : null;
    _audit('APPEAL_RESOLVED', {
      appealId,
      incidentId:  appeal.incidentId,
      studentId:   appeal.studentId,
      studentName: stu ? `${stu.firstName} ${stu.lastName}` : appeal.studentId,
      outcome,
      resolutionNote: note,
      before: { appealStatus: appeal.status, incidentStatus: inc?.status },
      after:  { appealStatus: outcome, incidentStatus: outcome === 'accepted' ? 'overturned' : outcome === 'rejected' ? 'active' : inc?.status },
    });

    const toastMsg = {
      accepted:  'Appeal accepted — incident marked as overturned.',
      rejected:  'Appeal rejected — incident remains active.',
      escalated: 'Appeal escalated to disciplinary panel.'
    }[outcome] || 'Appeal updated.';

    showToast(toastMsg, 'success');
    _closeModal();
    render();
  }

  /* ─────────────────────────────────────────
     APPEALS — PARENT ADD NOTE
  ───────────────────────────────────────── */
  function addParentNoteModal(appealId) {
    const appeal = DB.getById('behaviour_appeals', appealId);
    if (!appeal) return showToast('Appeal not found.', 'warning');
    const inc  = DB.getById('behaviour_incidents', appeal.incidentId);
    const stu  = inc ? DB.getById('students', inc.studentId) : null;

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-pen"></i> Add Parent Note</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <div style="padding:10px 14px;background:#FEF2F2;border-radius:8px;margin-bottom:14px">
        <div style="font-size:13px;font-weight:600">${stu ? `${stu.firstName} ${stu.lastName}` : '—'} — ${inc?.categoryName||'—'} (${inc?.points||0} pts)</div>
        <div style="font-size:12px;color:var(--gray-500)">${_fmtDate(inc?.date)}</div>
      </div>
      <div style="padding:10px 14px;background:#FFFBEB;border-radius:8px;margin-bottom:16px">
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;margin-bottom:2px">Student's Reason</div>
        <div style="font-size:13px;color:var(--gray-700)">${appeal.reason||'—'}</div>
      </div>
      <div class="form-field" style="margin-bottom:16px">
        <label>Your Note${appeal.parentNote ? ' (replaces existing)' : ''}</label>
        <textarea id="parent-note-text" rows="4" placeholder="Add any context you feel is relevant — this will be seen by the reviewing staff member…"
          style="width:100%;box-sizing:border-box;resize:vertical">${appeal.parentNote||''}</textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Behaviour.saveParentNote('${appealId}')">
          <i class="fas fa-save"></i> Save Note
        </button>
      </div>
    </div>`, 'sm');
  }

  function saveParentNote(appealId) {
    const note = (document.getElementById('parent-note-text')?.value || '').trim();
    if (!note) return showToast('Please enter a note before saving.', 'warning');
    DB.update('behaviour_appeals', appealId, { parentNote: note });
    showToast('Note saved. Staff will see it when reviewing the appeal.', 'success');
    _closeModal();
    render();
  }

  /* ─────────────────────────────────────────
     DETENTIONS VIEW
  ───────────────────────────────────────── */
  function _detentionsView() {
    const cfg = _cfg();
    const detentions = DB.get('detentions').sort((a,b) => new Date(a.date) - new Date(b.date));
    const upcoming = detentions.filter(d => d.status === 'scheduled');
    const past     = detentions.filter(d => d.status !== 'scheduled').slice(0, 20);

    return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      ${_canLog() ? `<button class="btn btn-primary btn-sm" onclick="Behaviour.scheduleDetentionModal()"><i class="fas fa-plus"></i> Schedule Detention</button>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-calendar-check" style="color:#EF4444;margin-right:8px"></i>Upcoming Detentions</h3></div>
        ${upcoming.length ? `<table class="table"><thead><tr><th>Date</th><th>Student</th><th>Type</th><th>Location</th><th>Status</th>${_canEdit()?'<th></th>':''}</tr></thead>
        <tbody>${upcoming.map(d => {
          const stu = DB.getById('students', d.studentId);
          return `<tr>
            <td><strong>${_fmtDate(d.date)}</strong><div style="font-size:11px;color:var(--gray-400)">${d.startTime||''} – ${d.endTime||''}</div></td>
            <td>${stu ? `${stu.firstName} ${stu.lastName}` : '—'}</td>
            <td style="font-size:12px">${d.typeName||'Detention'}</td>
            <td style="font-size:12px">${d.location||'—'}</td>
            <td><span class="badge badge-warning">Scheduled</span></td>
            ${_canEdit() ? `<td>
              <button class="btn btn-sm btn-success btn-icon" onclick="Behaviour.markDetentionComplete('${d.id}')" title="Mark complete"><i class="fas fa-check"></i></button>
              <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.cancelDetention('${d.id}')" title="Cancel"><i class="fas fa-times"></i></button>
            </td>` : ''}
          </tr>`;
        }).join('')}</tbody></table>` : '<div class="empty-state" style="padding:24px"><p>No upcoming detentions scheduled.</p></div>'}
      </div>

      <div class="card">
        <div class="card-header"><h3><i class="fas fa-history" style="color:var(--gray-400);margin-right:8px"></i>Past Detentions</h3></div>
        ${past.length ? `<table class="table"><thead><tr><th>Date</th><th>Student</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>${past.map(d => {
          const stu = DB.getById('students', d.studentId);
          return `<tr>
            <td style="font-size:12px">${_fmtDate(d.date)}</td>
            <td>${stu ? `${stu.firstName} ${stu.lastName}` : '—'}</td>
            <td style="font-size:12px">${d.typeName||'Detention'}</td>
            <td><span class="badge badge-${d.status==='completed'?'success':'secondary'}">${d.status}</span></td>
          </tr>`;
        }).join('')}</tbody></table>` : '<div class="empty-state" style="padding:24px"><p>No detention history.</p></div>'}
      </div>
    </div>`;
  }

  /* ─────────────────────────────────────────
     SETTINGS VIEW
  ───────────────────────────────────────── */
  function _settingsView() {
    const cfg = _cfg();
    const settingsTabs = [
      { key:'matrix',     label:'Behaviour Matrix' },
      { key:'categories', label:'Custom Categories' },
      { key:'milestones', label:'Merit Milestones' },
      { key:'stages',     label:'Demerit Stages' },
      { key:'houses',     label:'Houses' },
      { key:'keystages',  label:'Key Stages' },
      { key:'detention',  label:'Detention Types' },
    ];
    const st = window._behSettingsTab || 'matrix';

    const stTabHtml = settingsTabs.map(t => `
      <button class="tab-btn ${st===t.key?'active':''}" onclick="window._behSettingsTab='${t.key}';Behaviour.setTab('settings')">
        ${t.label}
      </button>`).join('');

    let panel = '';
    if      (st === 'matrix')     panel = _sMatrixPanel(cfg);
    else if (st === 'categories') panel = _sCategoriesPanel(cfg);
    else if (st === 'milestones') panel = _sMilestonesPanel(cfg);
    else if (st === 'stages')     panel = _sStagesPanel(cfg);
    else if (st === 'houses')     panel = _sHousesPanel(cfg);
    else if (st === 'keystages')  panel = _sKeyStagesPanel(cfg);
    else if (st === 'detention')  panel = _sDetentionTypesPanel(cfg);

    return `
    <div style="margin-bottom:16px"><div class="tabs" style="flex-wrap:wrap">${stTabHtml}</div></div>
    ${panel}`;
  }

  function _sMatrixPanel(cfg) {
    const matrix = cfg.matrix || [];
    if (!matrix.length) return `<div class="card"><div class="empty-state" style="padding:40px"><i class="fas fa-table" style="font-size:36px;color:var(--gray-300);margin-bottom:12px"></i><h3>Matrix not loaded</h3><p>Re-seed the database (bump SEED_VERSION) to load the standard behaviour matrix.</p></div></div>`;

    /* Group by catName */
    const groups = [];
    matrix.forEach(item => {
      let g = groups.find(x => x.cat === item.cat);
      if (!g) { g = { cat: item.cat, name: item.catName, merits: [], demerits: [] }; groups.push(g); }
      if (item.type === 'merit') g.merits.push(item);
      else g.demerits.push(item);
    });

    const meritsTotal   = matrix.filter(m => m.type === 'merit').length;
    const demeritsTotal = matrix.filter(m => m.type === 'demerit').length;

    /* Filter state stored on window for simplicity */
    const mFilter = window._matFilter || 'all';   // 'all' | 'merit' | 'demerit'
    const mSearch = window._matSearch || '';

    const filteredMatrix = matrix.filter(m => {
      if (mFilter !== 'all' && m.type !== mFilter) return false;
      if (mSearch && !m.label.toLowerCase().includes(mSearch.toLowerCase()) &&
          !m.catName.toLowerCase().includes(mSearch.toLowerCase())) return false;
      return true;
    });

    /* Re-group filtered items */
    const fGroups = [];
    filteredMatrix.forEach(item => {
      let g = fGroups.find(x => x.cat === item.cat);
      if (!g) { g = { cat: item.cat, name: item.catName, items: [] }; fGroups.push(g); }
      g.items.push(item);
    });

    return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <h3><i class="fas fa-table" style="color:var(--primary);margin-right:8px"></i>Standard Behaviour Matrix</h3>
        <span style="font-size:12px;color:var(--gray-400)">${matrix.length} items · ${meritsTotal} merits · ${demeritsTotal} demerits · <strong>Read-only</strong></span>
      </div>
      <div style="padding:12px 16px;background:#EFF6FF;border-bottom:1px solid #BFDBFE;font-size:12px;color:#1E40AF">
        <i class="fas fa-lock" style="margin-right:6px"></i>
        These are the standard SAA BPS v2 behaviours with locked point values. They cannot be edited or deleted.
        To add school-specific behaviours, use the <strong>Custom Categories</strong> tab.
      </div>

      <!-- Filter bar -->
      <div style="display:flex;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--gray-100);flex-wrap:wrap">
        ${['all','merit','demerit'].map(f => `
          <button onclick="window._matFilter='${f}';Behaviour.setTab('settings')"
            style="padding:4px 14px;border-radius:16px;border:1px solid ${mFilter===f?'var(--primary)':'var(--gray-200)'};
                   background:${mFilter===f?'var(--primary)':'#fff'};color:${mFilter===f?'#fff':'var(--gray-600)'};
                   font-size:12px;cursor:pointer">
            ${f==='all'?`All (${matrix.length})`:f==='merit'?`⭐ Merits (${meritsTotal})`:`⚠️ Demerits (${demeritsTotal})`}
          </button>`).join('')}
        <input type="text" value="${mSearch}" placeholder="🔍 Search behaviours…"
          oninput="window._matSearch=this.value;Behaviour.setTab('settings')"
          style="flex:1;min-width:180px;padding:5px 10px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px">
        <span style="font-size:12px;color:var(--gray-400)">${filteredMatrix.length} shown</span>
      </div>

      <!-- Category groups -->
      ${fGroups.length ? fGroups.map(g => `
      <div style="border-bottom:1px solid var(--gray-100)">
        <div style="padding:8px 16px;background:var(--gray-50);display:flex;align-items:center;gap:8px">
          <span style="font-weight:600;font-size:13px;color:var(--gray-700)">${g.name}</span>
          <span style="font-size:11px;color:var(--gray-400)">${g.items.length} item${g.items.length!==1?'s':''}</span>
        </div>
        <table class="table" style="margin:0">
          <thead><tr>
            <th style="width:40%">Behaviour</th>
            <th style="width:12%">Type</th>
            <th style="width:10%">Points</th>
            <th style="width:10%">House Pts</th>
            <th style="width:28%">ID</th>
          </tr></thead>
          <tbody>
          ${g.items.map(item => `
            <tr>
              <td style="font-size:13px">${item.label}</td>
              <td><span class="badge badge-${item.type==='merit'?'success':'danger'}" style="font-size:10px">${item.type}</span></td>
              <td><strong style="color:${item.type==='merit'?'#10B981':'#EF4444'}">${item.type==='merit'?'+':''}${item.points}</strong></td>
              <td style="font-size:12px;color:var(--gray-500)">${item.housePoints >= 0 ? '+' : ''}${item.housePoints}</td>
              <td style="font-size:11px;color:var(--gray-400);font-family:monospace">${item.id}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('') : `
      <div class="empty-state" style="padding:32px">
        <i class="fas fa-search" style="font-size:28px;color:var(--gray-300);margin-bottom:8px"></i>
        <h3>No items match your filter</h3>
        <p>Try clearing the search or changing the type filter.</p>
      </div>`}
    </div>`;
  }

  function _sCategoriesPanel(cfg) {
    const cats   = cfg.categories || [];
    const matrix = cfg.matrix || [];
    return `
    <div class="card">
      <div class="card-header">
        <div>
          <h3>Behaviour Categories</h3>
          <p style="font-size:12px;color:var(--gray-400);margin:2px 0 0">
            ${cats.length} categories · SAA BPS v2 defaults shown with a matrix badge — admin can edit or delete any category.
          </p>
        </div>
        <button class="btn btn-sm btn-primary" onclick="Behaviour.editCategoryModal(null)">
          <i class="fas fa-plus"></i> Add Custom Category
        </button>
      </div>
      ${cats.length ? `
      <table class="table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Linked To</th>
            <th style="text-align:center">⭐ Merits</th>
            <th style="text-align:center">⚠️ Demerits</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${cats.map(c => {
            const catColor = c.color || '#6366F1';
            const mCount   = c.matCat ? matrix.filter(m => m.cat === c.matCat && m.type === 'merit').length   : null;
            const dCount   = c.matCat ? matrix.filter(m => m.cat === c.matCat && m.type === 'demerit').length : null;
            return `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="width:32px;height:32px;border-radius:8px;flex-shrink:0;
                              background:${catColor}20;display:flex;align-items:center;justify-content:center">
                    <i class="${c.icon||'fas fa-circle'}" style="color:${catColor};font-size:13px"></i>
                  </div>
                  <div>
                    <div style="font-weight:600;color:var(--gray-800)">${c.name}</div>
                    ${c.isDefault ? '<div style="font-size:11px;color:var(--gray-400)">SAA BPS v2 Default</div>' : ''}
                  </div>
                </div>
              </td>
              <td>
                ${c.matCat
                  ? `<span class="badge badge-primary" style="font-size:11px">Standard Matrix</span>`
                  : `<span class="badge badge-secondary" style="font-size:11px">Custom</span>`}
              </td>
              <td style="text-align:center">
                ${mCount !== null
                  ? `<span class="badge badge-success">${mCount} item${mCount!==1?'s':''}</span>`
                  : `<span style="color:#10B981;font-weight:700">+${c.customPoints||0} pts</span>`}
              </td>
              <td style="text-align:center">
                ${dCount !== null
                  ? `<span class="badge badge-danger">${dCount} item${dCount!==1?'s':''}</span>`
                  : `<span style="color:#DC2626;font-weight:700">−${c.customPoints||0} pts</span>`}
              </td>
              <td>
                <button class="btn btn-sm btn-secondary btn-icon" onclick="Behaviour.editCategoryModal('${c.id}')"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.deleteCat('${c.id}')"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `
      <div class="empty-state" style="padding:32px">
        <i class="fas fa-tags" style="font-size:28px;color:var(--gray-300);margin-bottom:8px"></i>
        <h3>No categories yet</h3>
        <p>Click <strong>Add Custom Category</strong> to create one.</p>
      </div>`}
    </div>`;
  }

  function _sMilestonesPanel(cfg) {
    return `<div class="card">
      <div class="card-header">
        <h3>Merit Milestones <span style="font-size:12px;color:var(--gray-400);">(triggered by cumulative merit points)</span></h3>
        <button class="btn btn-sm btn-primary" onclick="Behaviour.editMilestoneModal(null)"><i class="fas fa-plus"></i> Add</button>
      </div>
      ${cfg.meritMilestones.length ? `<table class="table"><thead><tr><th>Milestone</th><th>Badge</th><th>Threshold</th><th>Description</th><th></th></tr></thead>
      <tbody>${cfg.meritMilestones.sort((a,b)=>a.threshold-b.threshold).map(m=>`<tr>
        <td><strong style="color:${m.color}">${m.name}</strong></td>
        <td style="font-size:20px">${m.badge}</td>
        <td><span class="badge badge-success">≥ ${m.threshold} pts</span></td>
        <td style="font-size:12px;color:var(--gray-500)">${m.description||'—'}</td>
        <td>
          <button class="btn btn-sm btn-secondary btn-icon" onclick="Behaviour.editMilestoneModal('${m.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.deleteMilestone('${m.id}')"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('')}</tbody></table>` : '<div style="padding:20px;color:var(--gray-400);font-size:13px">No milestones configured.</div>'}
    </div>`;
  }

  function _sStagesPanel(cfg) {
    return `<div class="card">
      <div class="card-header">
        <h3>Demerit Intervention Stages <span style="font-size:12px;color:var(--gray-400);">(cumulative demerit point thresholds)</span></h3>
        <button class="btn btn-sm btn-primary" onclick="Behaviour.editStageModal(null)"><i class="fas fa-plus"></i> Add</button>
      </div>
      <table class="table"><thead><tr><th>Stage</th><th>Label</th><th>Threshold</th><th>Action</th><th>Notify Parent</th><th></th></tr></thead>
      <tbody>${cfg.demeritStages.sort((a,b)=>a.stage-b.stage).map(s=>`<tr>
        <td><span class="badge" style="background:${s.color};color:#fff">Stage ${s.stage}</span></td>
        <td><strong>${s.label}</strong></td>
        <td>${s.threshold} demerit pts</td>
        <td style="font-size:12px;max-width:240px;color:var(--gray-600)">${s.action}</td>
        <td>${s.notifyParent ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-secondary">No</span>'}</td>
        <td>
          <button class="btn btn-sm btn-secondary btn-icon" onclick="Behaviour.editStageModal(${s.stage})"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.deleteStage(${s.stage})"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('')}</tbody></table>
    </div>`;
  }

  function _sHousesPanel(cfg) {
    return `<div class="card">
      <div class="card-header">
        <h3>Houses <span style="font-size:12px;color:var(--gray-400)">Students can be assigned a house in their profile</span></h3>
        <button class="btn btn-sm btn-primary" onclick="Behaviour.editHouseModal(null)"><i class="fas fa-plus"></i> Add House</button>
      </div>
      ${cfg.houses.length ? `<table class="table"><thead><tr><th>Badge</th><th>Name</th><th>Colour</th><th>Students</th><th></th></tr></thead>
      <tbody>${cfg.houses.map(h => {
        const count = DB.query('students', s => s.houseId === h.id && s.status === 'active').length;
        return `<tr>
          <td style="font-size:24px">${h.badge}</td>
          <td><strong style="color:${h.color}">${h.name} House</strong></td>
          <td><span style="display:inline-block;width:20px;height:20px;background:${h.color};border-radius:4px;vertical-align:middle"></span> ${h.color}</td>
          <td>${count} students</td>
          <td>
            <button class="btn btn-sm btn-secondary btn-icon" onclick="Behaviour.editHouseModal('${h.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.deleteHouse('${h.id}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`;
      }).join('')}</tbody></table>` : '<div style="padding:20px;color:var(--gray-400);font-size:13px">No houses configured.</div>'}
    </div>`;
  }

  function _sKeyStagesPanel(cfg) {
    return `<div class="card">
      <div class="card-header">
        <h3>Key Stages <span style="font-size:12px;color:var(--gray-400)">Used for analytics grouping. Fully customisable.</span></h3>
        <button class="btn btn-sm btn-primary" onclick="Behaviour.editKSModal(null)"><i class="fas fa-plus"></i> Add Key Stage</button>
      </div>
      ${cfg.keyStages.length ? `<table class="table"><thead><tr><th>Name</th><th>Section</th><th>Grades</th><th>Colour</th><th></th></tr></thead>
      <tbody>${cfg.keyStages.map(k=>`<tr>
        <td><strong style="color:${k.color}">${k.name}</strong></td>
        <td>${k.section}</td>
        <td>${k.grades.join(', ')}</td>
        <td><span style="display:inline-block;width:20px;height:20px;background:${k.color};border-radius:4px;vertical-align:middle"></span></td>
        <td>
          <button class="btn btn-sm btn-secondary btn-icon" onclick="Behaviour.editKSModal('${k.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.deleteKS('${k.id}')"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('')}</tbody></table>` : '<div style="padding:20px;color:var(--gray-400);font-size:13px">No key stages configured.</div>'}
    </div>`;
  }

  function _sDetentionTypesPanel(cfg) {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return `<div class="card">
      <div class="card-header">
        <h3>Detention Types</h3>
        <button class="btn btn-sm btn-primary" onclick="Behaviour.editDetTypeModal(null)"><i class="fas fa-plus"></i> Add Type</button>
      </div>
      ${cfg.detentionTypes?.length ? `<table class="table"><thead><tr><th>Name</th><th>Day</th><th>Time</th><th>Location</th><th></th></tr></thead>
      <tbody>${cfg.detentionTypes.map(d=>`<tr>
        <td><strong>${d.name}</strong></td>
        <td>${d.dayOfWeek != null ? days[d.dayOfWeek] : 'Any day'}</td>
        <td>${d.startTime} – ${d.endTime}</td>
        <td>${d.location}</td>
        <td>
          <button class="btn btn-sm btn-secondary btn-icon" onclick="Behaviour.editDetTypeModal('${d.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon" onclick="Behaviour.deleteDetType('${d.id}')"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('')}</tbody></table>` : '<div style="padding:20px;color:var(--gray-400);font-size:13px">No detention types configured.</div>'}
    </div>`;
  }

  /* ─────────────────────────────────────────
     LOG INCIDENT MODAL  (Phase 2 — dual matrix/custom)
  ───────────────────────────────────────── */
  function logModal(studentId) {
    if (!_myStudents().length) return showToast('No students found for your role.', 'warning');
    _logState = { type:'merit', catId:'', selectedId:'', search:'',
                  classId:'', presetStudentId: studentId||'',
                  presetDate: new Date().toISOString().split('T')[0] };
    openModal(`
      <div class="modal-header">
        <h3><i class="fas fa-plus-circle"></i> Log Behaviour Incident</h3>
        <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
      </div>
      <div id="beh-log-body" style="padding:20px">${_logBody()}</div>
    `, 'lg');
  }

  /* Builds the entire inner HTML of the log modal — new flow: Type → Category → Behaviour */
  function _logBody() {
    const cfg       = _cfg();
    const students  = _myStudents();
    const matrix    = cfg.matrix || [];
    const threshold = cfg.seriousIncidentThreshold || 5;
    const allCats   = cfg.categories || [];

    /* Selected category */
    const selCat = _logState.catId ? allCats.find(c => c.id === _logState.catId) : null;

    /* Matrix items for this category + type */
    const catItems = selCat?.matCat
      ? matrix.filter(m => m.cat === selCat.matCat && m.type === _logState.type)
      : [];

    /* Apply search */
    const sq = (_logState.search || '').toLowerCase();
    const filteredItems = sq ? catItems.filter(m => m.label.toLowerCase().includes(sq)) : catItems;

    /* Selected matrix item */
    const selItem = _logState.selectedId ? matrix.find(m => m.id === _logState.selectedId) : null;

    /* Raw points for serious-note check */
    let rawPts = 0;
    if (selCat?.matCat && selItem) rawPts = selItem.pts || selItem.points || 0;
    else if (selCat?.customPoints)  rawPts = selCat.customPoints;
    const needsNote = rawPts !== 0 && Math.abs(rawPts) >= threshold;

    /* Colour helpers */
    const mColor = _logState.type === 'merit' ? '#059669' : '#DC2626';
    const mBg    = _logState.type === 'merit' ? '#F0FDF4' : '#FEF2F2';

    return `
    <!-- ── STEP 1: TYPE ── -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--gray-400);margin-bottom:8px">Step 1 — Incident Type</div>
      <div style="display:flex;gap:10px">
        ${['merit','demerit'].map(t => `
          <button type="button" onclick="Behaviour._logSetType('${t}')"
            style="flex:1;padding:11px 0;border-radius:8px;
                   border:2px solid ${_logState.type===t?(t==='merit'?'#10B981':'#EF4444'):'var(--gray-200)'};
                   background:${_logState.type===t?(t==='merit'?'#F0FDF4':'#FEF2F2'):'#fff'};
                   cursor:pointer;font-weight:${_logState.type===t?'700':'400'};font-size:14px;
                   color:${_logState.type===t?(t==='merit'?'#059669':'#DC2626'):'var(--gray-500)'}">
            ${t==='merit'?'⭐ Merit':'⚠️ Demerit'}
          </button>`).join('')}
      </div>
    </div>

    <!-- ── STEP 2: CATEGORY ── -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--gray-400);margin-bottom:8px">Step 2 — Select Category</div>
      ${allCats.length ? `
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
        ${allCats.map(cat => {
          const isSel     = _logState.catId === cat.id;
          const catColor  = cat.color || '#6366F1';
          const itemCount = cat.matCat
            ? matrix.filter(m => m.cat === cat.matCat && m.type === _logState.type).length
            : null;
          return `
          <div onclick="Behaviour._logSetCat('${cat.id}')"
            style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;
                   border:2px solid ${isSel ? catColor : 'var(--gray-200)'};
                   background:${isSel ? catColor+'15' : '#fff'};transition:all .12s">
            <div style="width:32px;height:32px;border-radius:8px;flex-shrink:0;
                        background:${catColor}20;display:flex;align-items:center;justify-content:center">
              <i class="${cat.icon||'fas fa-circle'}" style="color:${catColor};font-size:13px"></i>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:${isSel?'600':'400'};
                          color:${isSel?catColor:'var(--gray-700)'};
                          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cat.name}</div>
              <div style="font-size:11px;color:var(--gray-400)">
                ${itemCount !== null
                  ? `${itemCount} ${_logState.type} item${itemCount!==1?'s':''}`
                  : `Fixed ±${cat.customPoints||0} pts`}
              </div>
            </div>
            ${isSel ? `<i class="fas fa-check-circle" style="color:${catColor};font-size:15px;flex-shrink:0"></i>` : ''}
          </div>`;
        }).join('')}
      </div>` : `
      <div style="padding:14px;background:var(--gray-50);border-radius:8px;text-align:center;font-size:13px;color:var(--gray-400)">
        No categories configured. Go to <strong>Settings → Behaviour → Categories</strong> to add them.
      </div>`}
    </div>

    ${selCat ? `
    <!-- ── STEP 3: BEHAVIOUR ── -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--gray-400);margin-bottom:8px">
        Step 3 — Select Behaviour
        <span style="font-size:10px;text-transform:none;letter-spacing:0;color:var(--gray-400);margin-left:6px">
          ${selCat.matCat
            ? `${catItems.length} ${_logState.type} behaviour${catItems.length!==1?'s':''} in this category`
            : 'Custom — fixed point value'}
        </span>
      </div>

      ${selCat.matCat ? `
      <!-- Matrix items list -->
      <div style="border:1px solid var(--gray-200);border-radius:8px;overflow:hidden">
        <div style="padding:7px 12px;border-bottom:1px solid var(--gray-100);background:#FAFAFA">
          <input type="text" placeholder="🔍 Search in ${selCat.name}…" value="${_logState.search||''}"
            oninput="Behaviour._logSearch(this.value)"
            style="width:100%;border:none;background:transparent;outline:none;font-size:13px;color:var(--gray-700)">
        </div>
        <div style="max-height:200px;overflow-y:auto">
          ${filteredItems.length ? filteredItems.map(item => {
            const pts = item.pts || item.points || 0;
            return `
            <div onclick="Behaviour._logSelectItem('${item.id}')"
              style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;
                     background:${_logState.selectedId===item.id?'#EEF2FF':'transparent'};
                     border-bottom:1px solid var(--gray-50);
                     border-left:3px solid ${_logState.selectedId===item.id?'var(--primary)':'transparent'}">
              <div style="flex:1;font-size:13px;line-height:1.35;
                          color:${_logState.selectedId===item.id?'var(--primary)':'var(--gray-700)'};
                          font-weight:${_logState.selectedId===item.id?'600':'400'}">
                ${item.label}
              </div>
              <div style="font-size:13px;font-weight:700;white-space:nowrap;color:${item.type==='merit'?'#10B981':'#EF4444'}">
                ${item.type==='merit'?'+':''}${pts}
              </div>
            </div>`;
          }).join('') : `
          <div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px">
            ${sq
              ? 'No behaviours match your search.'
              : `No ${_logState.type} behaviours in this category.`}
          </div>`}
        </div>
      </div>
      <!-- Selected item preview -->
      ${selItem ? `
      <div style="padding:10px 14px;background:${mBg};border-radius:8px;margin-top:10px;
                  display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Selected</div>
          <div style="font-size:13px;font-weight:600;color:${mColor}">${selItem.label}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:24px;font-weight:800;color:${mColor}">${selItem.type==='merit'?'+':''}${selItem.pts||selItem.points} pts</div>
          <div style="font-size:10px;color:var(--gray-400)">locked</div>
        </div>
      </div>` : `
      <div style="padding:10px 14px;background:var(--gray-50);border-radius:8px;margin-top:10px;
                  color:var(--gray-400);font-size:13px;text-align:center">
        ↑ Click a behaviour above to select it
      </div>`}` : `
      <!-- Custom category — fixed points display -->
      <div style="padding:14px;background:${mBg};border-radius:8px;
                  display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:13px;font-weight:600;color:${mColor}">${selCat.name}</div>
          <div style="font-size:12px;color:var(--gray-400)">Custom category — fixed point value</div>
        </div>
        <div style="font-size:28px;font-weight:800;color:${mColor}">
          ${_logState.type==='merit'?'+':'-'}${selCat.customPoints||0} pts
        </div>
      </div>`}
    </div>` : ''}

    <!-- ── SERIOUS INCIDENT NOTE (required) ── -->
    ${needsNote ? `
    <div style="background:#FFF7ED;border:1px solid #FCD34D;border-radius:8px;padding:12px;margin-bottom:14px">
      <div style="font-size:12px;color:#B45309;font-weight:600;margin-bottom:6px">
        <i class="fas fa-exclamation-triangle"></i> Serious incident (${Math.abs(rawPts)} pts) — a detailed note is required before you can submit.
      </div>
      <textarea id="beh-serious-text" rows="3" placeholder="Describe exactly what happened, where and when…"
        style="width:100%;border:1px solid #FCD34D;border-radius:6px;padding:8px;font-size:13px;box-sizing:border-box;resize:vertical"></textarea>
    </div>` : ''}

    <!-- ── CLASS FILTER + STUDENT + DATE ── -->
    ${(() => {
      /* Build class list from the role-scoped student pool */
      const classIds = [...new Set(students.map(s => s.classId))].filter(Boolean);
      const classes  = classIds
        .map(id => DB.getById('classes', id))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));

      /* Students visible for the selected class (or all if none chosen) */
      const visibleStudents = _logState.classId
        ? students.filter(s => s.classId === _logState.classId)
        : students;

      /* Auto-clear student selection if they're not in the filtered set */
      if (_logState.presetStudentId &&
          !visibleStudents.find(s => s.id === _logState.presetStudentId)) {
        _logState.presetStudentId = '';
      }

      const clsLabel = _logState.classId
        ? `<span style="font-size:11px;color:var(--primary);font-weight:400;margin-left:4px">
             ${visibleStudents.length} student${visibleStudents.length!==1?'s':''} in ${_className(_logState.classId)}
           </span>`
        : '';

      return `
      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                    color:var(--gray-400);margin-bottom:8px">Student &amp; Date</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div class="form-field" style="margin:0">
            <label>Filter by Class</label>
            <select id="beh-class-sel" onchange="Behaviour._logSetClass(this.value)">
              <option value="">All Classes</option>
              ${classes.map(c => `<option value="${c.id}" ${c.id===_logState.classId?'selected':''}>${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-field" style="margin:0">
            <label>Date *</label>
            <input type="date" id="beh-date" value="${_logState.presetDate||new Date().toISOString().split('T')[0]}">
          </div>
        </div>
        <div class="form-field" style="margin:0">
          <label>Student *${clsLabel}</label>
          <select id="beh-student-sel">
            <option value="">Select student…</option>
            ${visibleStudents.map(s => `<option value="${s.id}" ${s.id===_logState.presetStudentId?'selected':''}>${s.firstName} ${s.lastName}</option>`).join('')}
          </select>
        </div>
      </div>`;
    })()}

    <!-- ── OPTIONAL NOTE ── -->
    ${!needsNote ? `
    <div class="form-field" style="margin-bottom:14px">
      <label>Note <span style="font-weight:400;color:var(--gray-400)">(optional)</span></label>
      <textarea id="beh-note-text" rows="2" placeholder="Brief context or observation…"
        style="width:100%;box-sizing:border-box;resize:vertical"></textarea>
    </div>` : ''}

    <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:4px;border-top:1px solid var(--gray-100)">
      <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
      <button type="button" class="btn btn-primary" onclick="Behaviour.saveIncidentNew()">
        <i class="fas fa-save"></i> Log Incident
      </button>
    </div>`;
  }

  /* ── Log modal state-change helpers (called from inline onclick) ── */
  function _logSetType(type) {
    _logState.type       = type;
    _logState.catId      = '';
    _logState.selectedId = '';
    _logState.search     = '';
    _logRefresh();
  }

  function _logSetCat(catId) {
    _logState.catId      = catId;
    _logState.selectedId = '';
    _logState.search     = '';
    _logRefresh();
  }

  /* Legacy no-ops — kept so any cached HTML calls don't throw */
  function _logSetSource()    {}
  function _logSetGroup()     {}
  function _logSetCustomCat() {}

  function _logSetClass(classId) {
    _logState.classId         = classId;
    _logState.presetStudentId = '';   // reset student when class changes
    _logRefresh();
  }

  function _logSearch(val) {
    _logState.search     = val;
    _logState.selectedId = '';
    _logRefresh();
  }

  function _logSelectItem(id) {
    _logState.selectedId = id;
    _logRefresh();
  }

  /* Preserve class, student, and date across refreshes, then re-render inner body */
  function _logRefresh() {
    const clsSel  = document.getElementById('beh-class-sel');
    const stuSel  = document.getElementById('beh-student-sel');
    const dateSel = document.getElementById('beh-date');
    if (clsSel)  _logState.classId         = clsSel.value;
    if (stuSel)  _logState.presetStudentId = stuSel.value;
    if (dateSel) _logState.presetDate      = dateSel.value;
    const body = document.getElementById('beh-log-body');
    if (body) body.innerHTML = _logBody();
  }

  /* Legacy — kept so any old form-based callers don't break */
  function _updateCatOptions() {}

  function saveIncident(e) {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const cfg     = _cfg();
    const user    = Auth.currentUser;
    const termId  = SchoolContext.currentTermId();
    const ayId    = SchoolContext.currentAcYearId();

    const catId   = fd.get('categoryId');
    const type    = fd.get('type');
    const stuId   = fd.get('studentId');
    const cat     = cfg.categories.find(c => c.id === catId);

    if (!cat) return showToast('Select a valid category.', 'warning');
    if (!stuId) return showToast('Select a student.', 'warning');

    const student   = DB.getById('students', stuId);
    const rawPts    = cat.points;
    const points    = type === 'merit' ? Math.abs(rawPts) : -Math.abs(rawPts);
    const housePoints = cfg.housePointsOnDemerit ? points : (type === 'merit' ? points : 0);

    /* Check milestone / stage crossing */
    const prevMerit  = _meritPts(stuId, termId);
    const prevDem    = _demeritPts(stuId, termId);
    const newMerit   = type === 'merit'   ? prevMerit + Math.abs(points) : prevMerit;
    const newDem     = type === 'demerit' ? prevDem   + Math.abs(points) : prevDem;

    let milestoneReached = null;
    let stageReached     = null;

    if (type === 'merit') {
      const hit = cfg.meritMilestones.filter(m => m.threshold <= newMerit && m.threshold > prevMerit);
      if (hit.length) milestoneReached = hit[hit.length - 1].id;
    } else {
      const hit = cfg.demeritStages.filter(s => s.threshold <= newDem && s.threshold > prevDem);
      if (hit.length) stageReached = hit[0].stage;
    }

    DB.insert('behaviour_incidents', {
      schoolId:        'sch1',
      studentId:       stuId,
      type,
      categoryId:      catId,
      categoryName:    cat.name,
      points,
      housePoints,
      note:            fd.get('description') || fd.get('note') || '',
      reportedBy:      user.id,
      reportedByName:  user.name,
      date:            fd.get('date'),
      termId,
      academicYearId:  ayId,
      milestoneReached,
      stageReached,
      status:          'active',
      parentNotified:  false,
      detentionScheduled: false,
      createdAt:       new Date().toISOString()
    });

    /* Send notifications */
    if (milestoneReached) {
      const ms = cfg.meritMilestones.find(m => m.id === milestoneReached);
      if (ms) _notifyMilestone(student, ms);
    }
    if (stageReached !== null) {
      const stage = cfg.demeritStages.find(s => s.stage === stageReached);
      if (stage?.notifyParent) _notifyDemeritStage(student, stage, type, cat.name);
      if (stage) {
        showToast(`⚠️ Stage ${stage.stage} reached: ${stage.label}`, 'warning');
      }
    }

    const milestone = milestoneReached ? cfg.meritMilestones.find(m => m.id === milestoneReached) : null;
    showToast(
      milestone
        ? `${type === 'merit' ? 'Merit' : 'Demerit'} logged. 🎉 Milestone reached: ${milestone.name}!`
        : `${type === 'merit' ? 'Merit' : 'Demerit'} incident logged successfully.`,
      'success'
    );
    _closeModal();
    render();
  }

  /* ─────────────────────────────────────────
     SAVE INCIDENT — new modal path (Phase 2)
  ───────────────────────────────────────── */
  function saveIncidentNew() {
    if (!Auth.hasPermission('behaviour', 'create')) return showToast('You do not have permission to log incidents.', 'error');
    const cfg       = _cfg();
    const user      = Auth.currentUser;
    const termId    = SchoolContext.currentTermId();
    const ayId      = SchoolContext.currentAcYearId();
    const threshold = cfg.seriousIncidentThreshold || 5;

    /* Collect DOM values (preserved across _logRefresh) */
    const stuId = document.getElementById('beh-student-sel')?.value || '';
    const date  = document.getElementById('beh-date')?.value        || '';

    if (!stuId) return showToast('Please select a student.', 'warning');
    if (!date)  return showToast('Please select a date.', 'warning');

    /* Referential integrity: student must exist */
    const incErr = Validators.incident({ studentId: stuId, type: _logState.type });
    if (incErr) return showToast(incErr, 'warning');

    /* ── Resolve category then behaviour ── */
    const allCats = cfg.categories || [];
    const selCat  = _logState.catId ? allCats.find(c => c.id === _logState.catId) : null;
    if (!selCat) return showToast('Please select a category.', 'warning');

    let behaviourId  = null;
    let categoryId   = null;
    let categoryName = selCat.name;
    let points       = 0;
    let housePoints  = 0;

    if (selCat.matCat) {
      /* Matrix path — category links to standard matrix items */
      if (!_logState.selectedId) return showToast('Please select a behaviour from the list.', 'warning');
      const item = (cfg.matrix || []).find(m => m.id === _logState.selectedId);
      if (!item) return showToast('Selected behaviour not found.', 'warning');
      behaviourId  = item.id;
      categoryName = item.cat || selCat.name;
      const pts    = item.pts || item.points || 0;
      points       = _logState.type === 'merit' ?  Math.abs(pts) : -Math.abs(pts);
      housePoints  = _logState.type === 'merit' ?  Math.abs(pts) : -Math.abs(pts);
    } else {
      /* Custom category path — fixed point value */
      categoryId  = selCat.id;
      const pts   = selCat.customPoints || 0;
      points      = _logState.type === 'merit' ?  Math.abs(pts) : -Math.abs(pts);
      housePoints = (cfg.housePointsOnDemerit || _logState.type === 'merit') ? points : 0;
    }

    /* ── Serious note enforcement ── */
    const needsNote = Math.abs(points) >= threshold;
    let note = '';
    if (needsNote) {
      note = (document.getElementById('beh-serious-text')?.value || '').trim();
      if (!note) return showToast('A detailed note is required for serious incidents (' + Math.abs(points) + ' pts).', 'warning');
    } else {
      note = (document.getElementById('beh-note-text')?.value || '').trim();
    }

    /* ── Milestone / stage crossing ── */
    const prevMerit = _meritPts(stuId, termId);
    const prevDem   = _demeritPts(stuId, termId);
    const newMerit  = _logState.type === 'merit'   ? prevMerit + Math.abs(points) : prevMerit;
    const newDem    = _logState.type === 'demerit' ? prevDem   + Math.abs(points) : prevDem;

    let milestoneReached = null;
    let stageReached     = null;

    if (_logState.type === 'merit') {
      const hit = (cfg.meritMilestones || []).filter(m => m.threshold <= newMerit && m.threshold > prevMerit);
      if (hit.length) milestoneReached = hit[hit.length - 1].id;
    } else {
      const hit = (cfg.demeritStages || []).filter(s => s.threshold <= newDem && s.threshold > prevDem);
      if (hit.length) stageReached = hit[0].stage;
    }

    const student = DB.getById('students', stuId);

    DB.insert('behaviour_incidents', {
      schoolId:     'sch1',
      studentId:    stuId,
      type:         _logState.type,
      behaviourId,
      categoryId,
      categoryName,
      points,
      housePoints,
      note,
      reportedBy:   user.id,
      reportedByName: user.name,
      date,
      termId,
      academicYearId: ayId,
      milestoneReached,
      stageReached,
      status:       'active',
      parentNotified:     false,
      detentionScheduled: false,
      createdAt:    new Date().toISOString()
    });

    /* Notifications */
    if (milestoneReached) {
      const ms = (cfg.meritMilestones || []).find(m => m.id === milestoneReached);
      if (ms) _notifyMilestone(student, ms);
    }
    if (stageReached !== null) {
      const stage = (cfg.demeritStages || []).find(s => s.stage === stageReached);
      if (stage?.notifyParent) _notifyDemeritStage(student, stage, _logState.type, categoryName);
      if (stage) showToast(`⚠️ Stage ${stage.stage} reached: ${stage.label}`, 'warning');
    }

    const ms = milestoneReached ? (cfg.meritMilestones || []).find(m => m.id === milestoneReached) : null;
    showToast(
      ms  ? `${_logState.type === 'merit' ? 'Merit' : 'Demerit'} logged. 🎉 Milestone: ${ms.name}!`
          : `${_logState.type === 'merit' ? 'Merit' : 'Demerit'} logged successfully.`,
      'success'
    );
    _closeModal();
    render();
  }

  /* ─────────────────────────────────────────
     NOTIFICATIONS
  ───────────────────────────────────────── */
  function _notifyMilestone(student, milestone) {
    if (!student) return;
    const user  = Auth.currentUser;
    const pIds  = (student.guardians || []).filter(g => g.userId).map(g => g.userId);
    if (!pIds.length) return;
    DB.insert('messages', {
      schoolId:   'sch1',
      senderId:   user.id,
      senderName: user.name,
      recipients: pIds,
      subject:    `🎉 ${student.firstName} has earned the ${milestone.name} ${milestone.badge}!`,
      body:       `Dear Parent/Guardian,\n\nWe are delighted to inform you that ${student.firstName} ${student.lastName} has achieved the ${milestone.name} ${milestone.badge} for outstanding behaviour and character.\n\nThis award is given for reaching ${milestone.threshold} merit points. Congratulations to ${student.firstName} and your family on this wonderful achievement!\n\nBest regards,\nPastoral Team`,
      type:       'notification',
      isRead:     {}
    });
  }

  function _notifyDemeritStage(student, stage, catType, catName) {
    if (!student) return;
    const user  = Auth.currentUser;
    const pIds  = (student.guardians || []).filter(g => g.userId).map(g => g.userId);
    if (!pIds.length) return;
    DB.insert('messages', {
      schoolId:   'sch1',
      senderId:   user.id,
      senderName: user.name,
      recipients: pIds,
      subject:    `Behaviour Notice — ${student.firstName}: Stage ${stage.stage} (${stage.label})`,
      body:       `Dear Parent/Guardian,\n\nThis is to inform you that ${student.firstName} ${student.lastName} has reached Stage ${stage.stage} (${stage.label}) in our behaviour monitoring system.\n\nRequired Action: ${stage.action}\n\nPlease contact the school at your earliest convenience to discuss this matter.\n\nKind regards,\nPastoral Team`,
      type:       'notification',
      isRead:     {}
    });
  }

  /* ─────────────────────────────────────────
     DELETE INCIDENT
  ───────────────────────────────────────── */
  function deleteIncident(id) {
    confirmAction('Delete this incident record? This cannot be undone.', () => {
      DB.remove('behaviour_incidents', id);
      showToast('Incident deleted.', 'info');
      render();
    });
  }

  /* ─────────────────────────────────────────
     SCHEDULE DETENTION MODAL
  ───────────────────────────────────────── */
  function scheduleDetentionModal() {
    const cfg      = _cfg();
    const students = _myStudents();
    const types    = cfg.detentionTypes || [];

    openModal(`
    <div class="modal-header"><h3><i class="fas fa-user-lock"></i> Schedule Detention</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Behaviour.saveDetention(event)">
      <div class="form-field mb-12">
        <label>Student *</label>
        <select name="studentId" required>
          <option value="">Select student…</option>
          ${students.map(s=>`<option value="${s.id}">${s.firstName} ${s.lastName} (${_className(s.classId)})</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Detention Type *</label>
        <select name="detTypeId" required>
          <option value="">Select type…</option>
          ${types.map(t=>`<option value="${t.id}">${t.name} — ${t.startTime}–${t.endTime}, ${t.location}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12">
        <label>Date *</label>
        <input type="date" name="date" required>
      </div>
      <div class="form-field mb-12">
        <label>Notes</label>
        <textarea name="notes" rows="2" placeholder="Reason / additional notes…"></textarea>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Schedule</button>
      </div>
    </form>`, 'sm');
  }

  function saveDetention(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const cfg  = _cfg();
    const user = Auth.currentUser;
    const dt   = cfg.detentionTypes?.find(t => t.id === fd.get('detTypeId'));
    DB.insert('detentions', {
      schoolId:    'sch1',
      studentId:   fd.get('studentId'),
      typeId:      fd.get('detTypeId'),
      typeName:    dt?.name || 'Detention',
      date:        fd.get('date'),
      startTime:   dt?.startTime || '',
      endTime:     dt?.endTime   || '',
      location:    dt?.location  || '',
      notes:       fd.get('notes'),
      scheduledBy: user.id,
      status:      'scheduled'
    });
    showToast('Detention scheduled.', 'success');
    _closeModal();
    render();
  }

  function markDetentionComplete(id) {
    DB.update('detentions', id, { status:'completed' });
    showToast('Detention marked as completed.', 'success');
    render();
  }

  function cancelDetention(id) {
    confirmAction('Cancel this detention?', () => {
      DB.update('detentions', id, { status:'cancelled' });
      showToast('Detention cancelled.', 'info');
      render();
    });
  }

  /* ─────────────────────────────────────────
     SETTINGS — CATEGORY CRUD
  ───────────────────────────────────────── */
  function editCategoryModal(catId) {
    const cfg      = _cfg();
    const cat      = catId ? cfg.categories.find(c => c.id === catId) : null;
    const isMatrix = !!(cat?.matCat);   // matrix-backed categories don't have custom points

    openModal(`
    <div class="modal-header">
      <h3>${cat ? 'Edit' : 'Add Custom'} Category</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Behaviour._saveCat(event,'${catId||''}')">
      ${isMatrix ? `
      <div style="padding:10px 12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;
                  font-size:12px;color:#1E40AF;margin-bottom:14px">
        <i class="fas fa-info-circle"></i>
        This is an <strong>SAA BPS v2 matrix category</strong>. Point values are locked per behaviour item.
        You can rename it or change its icon and colour.
      </div>` : ''}
      <div class="form-field mb-12">
        <label>Name *</label>
        <input name="name" required value="${cat?.name||''}">
      </div>
      ${!isMatrix ? `
      <div class="form-field mb-12">
        <label>Fixed Points (positive number) *
          <span style="font-size:11px;color:var(--gray-400);font-weight:400">
            — applied as +pts for merit or −pts for demerit when logging
          </span>
        </label>
        <input type="number" name="customPoints" min="1" max="50" required value="${cat?.customPoints||1}">
      </div>` : ''}
      <div class="form-field mb-12">
        <label>Colour</label>
        <input type="color" name="color" value="${cat?.color||'#6366F1'}"
          style="width:60px;height:36px;padding:2px;border-radius:6px;cursor:pointer">
      </div>
      <div class="form-field mb-12">
        <label>Icon <span style="font-size:11px;color:var(--gray-400);font-weight:400">(FontAwesome class, e.g. fas fa-star)</span></label>
        <input name="icon" value="${cat?.icon||'fas fa-star'}" placeholder="fas fa-star">
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Category</button>
      </div>
    </form>`, 'sm');
  }

  function _saveCat(e, catId) {
    e.preventDefault();
    const fd       = new FormData(e.target);
    const cfg      = _cfg();
    const existing = catId ? cfg.categories.find(c => c.id === catId) : null;

    const cat = {
      ...(existing || {}),
      id:    catId || `bcat${Date.now()}`,
      name:  fd.get('name'),
      color: fd.get('color') || '#6366F1',
      icon:  fd.get('icon')  || 'fas fa-star'
    };
    /* Only set customPoints for non-matrix categories */
    if (!existing?.matCat) {
      cat.customPoints = Math.abs(parseInt(fd.get('customPoints')) || 1);
    }

    const cats = catId
      ? cfg.categories.map(c => c.id === catId ? cat : c)
      : [...cfg.categories, cat];
    _saveCfg({ categories: cats });
    showToast('Category saved.', 'success');
    _closeModal();
    render();
  }

  function deleteCat(catId) {
    confirmAction('Delete this category? Existing incidents using it are not affected.', () => {
      const cfg  = _cfg();
      _saveCfg({ categories: cfg.categories.filter(c => c.id !== catId) });
      showToast('Category deleted.', 'info');
      render();
    });
  }

  /* ─────────────────────────────────────────
     SETTINGS — MILESTONE CRUD
  ───────────────────────────────────────── */
  function editMilestoneModal(msId) {
    const cfg = _cfg();
    const ms  = msId ? cfg.meritMilestones.find(m => m.id === msId) : null;
    openModal(`
    <div class="modal-header"><h3>${ms ? 'Edit' : 'Add'} Merit Milestone</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Behaviour._saveMs(event,'${msId||''}')">
      <div class="form-field mb-12"><label>Name *</label><input name="name" required value="${ms?.name||''}"></div>
      <div class="form-field mb-12"><label>Badge emoji</label><input name="badge" value="${ms?.badge||'🏅'}" maxlength="4"></div>
      <div class="form-field mb-12"><label>Threshold (cumulative merit points) *</label>
        <input type="number" name="threshold" min="1" required value="${ms?.threshold||10}"></div>
      <div class="form-field mb-12"><label>Colour</label>
        <input type="color" name="color" value="${ms?.color||'#F59E0B'}" style="width:60px;height:36px;padding:2px;border-radius:6px"></div>
      <div class="form-field mb-12"><label>Description</label>
        <input name="description" value="${ms?.description||''}"></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`, 'sm');
  }

  function _saveMs(e, msId) {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const cfg = _cfg();
    const ms  = {
      id:          msId || `mm${Date.now()}`,
      name:        fd.get('name'),
      badge:       fd.get('badge')||'🏅',
      threshold:   parseInt(fd.get('threshold'))||10,
      color:       fd.get('color'),
      description: fd.get('description')
    };
    const list = msId
      ? cfg.meritMilestones.map(m => m.id===msId ? ms : m)
      : [...cfg.meritMilestones, ms];
    _saveCfg({ meritMilestones: list });
    showToast('Milestone saved.', 'success');
    _closeModal(); render();
  }

  function deleteMilestone(msId) {
    confirmAction('Delete this milestone?', () => {
      const cfg = _cfg();
      _saveCfg({ meritMilestones: cfg.meritMilestones.filter(m => m.id !== msId) });
      showToast('Milestone deleted.', 'info'); render();
    });
  }

  /* ─────────────────────────────────────────
     SETTINGS — DEMERIT STAGE CRUD
  ───────────────────────────────────────── */
  function editStageModal(stageNum) {
    const cfg  = _cfg();
    const s    = stageNum ? cfg.demeritStages.find(d => d.stage === stageNum) : null;
    openModal(`
    <div class="modal-header"><h3>${s ? 'Edit' : 'Add'} Demerit Stage</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Behaviour._saveStage(event,${stageNum||'null'})">
      <div class="form-field mb-12"><label>Stage Number *</label>
        <input type="number" name="stage" min="1" max="10" required value="${s?.stage||''}"></div>
      <div class="form-field mb-12"><label>Label *</label>
        <input name="label" required value="${s?.label||''}"></div>
      <div class="form-field mb-12"><label>Threshold (cumulative demerit points) *</label>
        <input type="number" name="threshold" min="1" required value="${s?.threshold||5}"></div>
      <div class="form-field mb-12"><label>Action / Description *</label>
        <textarea name="action" rows="2" required>${s?.action||''}</textarea></div>
      <div class="form-field mb-12"><label>Notify Parent?</label>
        <select name="notifyParent"><option value="true" ${s?.notifyParent?'selected':''}>Yes</option><option value="false" ${!s?.notifyParent?'selected':''}>No</option></select></div>
      <div class="form-field mb-12"><label>Colour</label>
        <input type="color" name="color" value="${s?.color||'#EF4444'}" style="width:60px;height:36px;padding:2px;border-radius:6px"></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`, 'sm');
  }

  function _saveStage(e, oldStage) {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const cfg = _cfg();
    const s   = {
      stage:        parseInt(fd.get('stage')),
      label:        fd.get('label'),
      threshold:    parseInt(fd.get('threshold')),
      action:       fd.get('action'),
      notifyParent: fd.get('notifyParent') === 'true',
      color:        fd.get('color')
    };
    const list = oldStage
      ? cfg.demeritStages.map(d => d.stage===oldStage ? s : d)
      : [...cfg.demeritStages, s];
    _saveCfg({ demeritStages: list });
    showToast('Stage saved.', 'success');
    _closeModal(); render();
  }

  function deleteStage(stageNum) {
    confirmAction('Delete this intervention stage?', () => {
      const cfg = _cfg();
      _saveCfg({ demeritStages: cfg.demeritStages.filter(d => d.stage !== stageNum) });
      showToast('Stage deleted.', 'info'); render();
    });
  }

  /* ─────────────────────────────────────────
     SETTINGS — HOUSE CRUD
  ───────────────────────────────────────── */
  function editHouseModal(houseId) {
    const cfg = _cfg();
    const h   = houseId ? cfg.houses.find(x => x.id === houseId) : null;
    openModal(`
    <div class="modal-header"><h3>${h ? 'Edit' : 'Add'} House</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Behaviour._saveHouse(event,'${houseId||''}')">
      <div class="form-field mb-12"><label>Name *</label>
        <input name="name" required value="${h?.name||''}"></div>
      <div class="form-field mb-12"><label>Badge emoji</label>
        <input name="badge" value="${h?.badge||'🏠'}" maxlength="4"></div>
      <div class="form-field mb-12"><label>House Colour *</label>
        <input type="color" name="color" value="${h?.color||'#6366F1'}" required style="width:60px;height:36px;padding:2px;border-radius:6px"></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`, 'sm');
  }

  function _saveHouse(e, houseId) {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const cfg = _cfg();
    const h   = { id: houseId||`h${Date.now()}`, name:fd.get('name'), badge:fd.get('badge')||'🏠', color:fd.get('color') };
    const list= houseId ? cfg.houses.map(x=>x.id===houseId?h:x) : [...cfg.houses, h];
    _saveCfg({ houses: list });
    showToast('House saved.', 'success');
    _closeModal(); render();
  }

  function deleteHouse(houseId) {
    const count = DB.query('students', s => s.houseId === houseId).length;
    confirmAction(`Delete ${DB.get('behaviour_settings')[0]?.houses?.find(h=>h.id===houseId)?.name||''} House? ${count} student(s) will lose their house assignment.`, () => {
      const cfg = _cfg();
      _saveCfg({ houses: cfg.houses.filter(h => h.id !== houseId) });
      showToast('House deleted.', 'info'); render();
    });
  }

  /* ─────────────────────────────────────────
     SETTINGS — KEY STAGE CRUD
  ───────────────────────────────────────── */
  function editKSModal(ksId) {
    const cfg = _cfg();
    const ks  = ksId ? cfg.keyStages.find(k => k.id === ksId) : null;
    openModal(`
    <div class="modal-header"><h3>${ks ? 'Edit' : 'Add'} Key Stage</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Behaviour._saveKS(event,'${ksId||''}')">
      <div class="form-field mb-12"><label>Name * (e.g. KS3, Early Years)</label>
        <input name="name" required value="${ks?.name||''}"></div>
      <div class="form-field mb-12"><label>Section label</label>
        <input name="section" value="${ks?.section||''}"></div>
      <div class="form-field mb-12"><label>Grades (comma-separated, e.g. 7,8,9 or KG1,KG2)</label>
        <input name="grades" value="${ks?.grades?.join(',')||''}" placeholder="7,8,9"></div>
      <div class="form-field mb-12"><label>Colour</label>
        <input type="color" name="color" value="${ks?.color||'#6366F1'}" style="width:60px;height:36px;padding:2px;border-radius:6px"></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`, 'sm');
  }

  function _saveKS(e, ksId) {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const cfg = _cfg();
    const raw = fd.get('grades').split(',').map(g => {
      const n = parseInt(g.trim());
      return isNaN(n) ? g.trim() : n;
    }).filter(Boolean);
    const ks  = { id: ksId||`ks${Date.now()}`, name:fd.get('name'), section:fd.get('section'), grades:raw, color:fd.get('color') };
    const list= ksId ? cfg.keyStages.map(k=>k.id===ksId?ks:k) : [...cfg.keyStages, ks];
    _saveCfg({ keyStages: list });
    showToast('Key Stage saved.', 'success');
    _closeModal(); render();
  }

  function deleteKS(ksId) {
    confirmAction('Delete this key stage?', () => {
      const cfg = _cfg();
      _saveCfg({ keyStages: cfg.keyStages.filter(k => k.id !== ksId) });
      showToast('Key Stage deleted.', 'info'); render();
    });
  }

  /* ─────────────────────────────────────────
     SETTINGS — DETENTION TYPE CRUD
  ───────────────────────────────────────── */
  function editDetTypeModal(dtId) {
    const cfg = _cfg();
    const dt  = dtId ? cfg.detentionTypes?.find(d => d.id === dtId) : null;
    const days= ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    openModal(`
    <div class="modal-header"><h3>${dt ? 'Edit' : 'Add'} Detention Type</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Behaviour._saveDetType(event,'${dtId||''}')">
      <div class="form-field mb-12"><label>Name *</label>
        <input name="name" required value="${dt?.name||''}"></div>
      <div class="form-field mb-12"><label>Day of Week</label>
        <select name="dayOfWeek">
          <option value="">Any day (assigned per schedule)</option>
          ${days.map((d,i)=>`<option value="${i}" ${dt?.dayOfWeek===i?'selected':''}>${d}</option>`).join('')}
        </select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-field mb-12"><label>Start Time</label>
          <input type="time" name="startTime" value="${dt?.startTime||'08:00'}"></div>
        <div class="form-field mb-12"><label>End Time</label>
          <input type="time" name="endTime" value="${dt?.endTime||'12:00'}"></div>
      </div>
      <div class="form-field mb-12"><label>Location</label>
        <input name="location" value="${dt?.location||''}"></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`, 'sm');
  }

  function _saveDetType(e, dtId) {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const cfg = _cfg();
    const raw = fd.get('dayOfWeek');
    const dt  = {
      id:        dtId||`det${Date.now()}`,
      name:      fd.get('name'),
      dayOfWeek: raw !== '' ? parseInt(raw) : null,
      startTime: fd.get('startTime'),
      endTime:   fd.get('endTime'),
      location:  fd.get('location')
    };
    const list = dtId
      ? (cfg.detentionTypes||[]).map(d=>d.id===dtId?dt:d)
      : [...(cfg.detentionTypes||[]), dt];
    _saveCfg({ detentionTypes: list });
    showToast('Detention type saved.', 'success');
    _closeModal(); render();
  }

  function deleteDetType(dtId) {
    confirmAction('Delete this detention type?', () => {
      const cfg = _cfg();
      _saveCfg({ detentionTypes: (cfg.detentionTypes||[]).filter(d => d.id !== dtId) });
      showToast('Detention type deleted.', 'info'); render();
    });
  }

  /* ─────────────────────────────────────────
     PDF REPORT GENERATION
  ───────────────────────────────────────── */
  function generateReport() {
    const cfg    = _cfg();
    const termId = SchoolContext.currentTermId();
    const school = Auth.currentSchool;

    /* Gather data */
    const baseInc = _period === 'term'
      ? DB.query('behaviour_incidents', i => i.termId === termId)
      : _period === 'all'
        ? DB.get('behaviour_incidents')
        : _filterByPeriod(DB.get('behaviour_incidents'), _period);

    const students  = DB.query('students', s => s.status === 'active');
    const houseCup  = cfg.houses.map(h => ({ ...h, pts: _housePts(h.id, _period, termId) }))
                                .sort((a,b) => b.pts - a.pts);
    const patterns  = _detectPatterns(baseInc, cfg);
    const stageAlerts = students
      .map(s => {
        const dp  = _halfTermDemeritPts(s.id);
        let stage = null; let si = null;
        for (const st of (cfg.demeritStages||[])) { if (dp >= st.threshold) { stage = st.stage; si = st; } }
        return stage ? { ...s, stage, si, dp } : null;
      }).filter(Boolean).sort((a,b) => b.stage - a.stage);

    /* Student summary rows */
    const stuSummary = students.map(s => {
      const mp    = _meritPts(s.id, termId);
      const dp    = _halfTermDemeritPts(s.id);
      const stage = _getCurrentStage(s.id, termId);
      const ms    = _topMilestone(s.id, termId);
      const h     = _houseInfo(s.houseId);
      return { ...s, mp, dp, stage, ms, h };
    }).filter(s => s.mp > 0 || s.dp > 0)
      .sort((a,b) => (b.mp - b.dp) - (a.mp - a.dp));

    /* Staff activity */
    const staffActivity = {};
    baseInc.forEach(i => {
      const k = i.reportedByName || 'Unknown';
      if (!staffActivity[k]) staffActivity[k] = { merits:0, demerits:0 };
      if (i.type === 'merit') staffActivity[k].merits++;
      else staffActivity[k].demerits++;
    });

    const totalMerits   = baseInc.filter(i=>i.type==='merit').reduce((s,i)=>s+(i.points||0),0);
    const totalDemerits = baseInc.filter(i=>i.type==='demerit').reduce((s,i)=>s+Math.abs(i.points||0),0);
    const now = new Date().toLocaleDateString('en-KE',{day:'2-digit',month:'long',year:'numeric'});

    const maxHousePts = houseCup[0]?.pts || 1;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Behaviour Report — ${school?.name||'SchoolSync'}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111;padding:28px 32px;background:#fff}
  h1{font-size:22px;font-weight:700;margin-bottom:2px}
  h2{font-size:14px;font-weight:700;margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid #1E3A8A;color:#1E3A8A;text-transform:uppercase;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;margin-bottom:4px}
  thead th{background:#1E3A8A;color:#fff;padding:6px 8px;font-size:11px;text-align:left;font-weight:600}
  tbody td{padding:5px 8px;border-bottom:1px solid #E5E7EB;font-size:11px;vertical-align:middle}
  tbody tr:nth-child(even) td{background:#F9FAFB}
  .stats{display:flex;gap:16px;margin-bottom:4px}
  .stat{flex:1;border:1px solid #E5E7EB;border-radius:8px;padding:12px;text-align:center}
  .stat-v{font-size:28px;font-weight:800}
  .stat-l{font-size:11px;color:#6B7280;margin-top:2px}
  .badge{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600}
  .m{background:#D1FAE5;color:#065F46}.d{background:#FEE2E2;color:#991B1B}
  .bar-bg{background:#E5E7EB;border-radius:4px;height:8px;width:120px;display:inline-block;vertical-align:middle}
  .bar-fill{height:8px;border-radius:4px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #1E3A8A}
  .sub{font-size:12px;color:#6B7280;margin-top:4px}
  .empty{padding:16px;color:#9CA3AF;text-align:center;font-style:italic}
  .page-break{page-break-before:always}
  @media print{body{padding:16px}@page{margin:1.5cm}}
</style>
</head>
<body>

<!-- HEADER -->
<div class="hdr">
  <div>
    <h1>Behaviour &amp; Pastoral Report</h1>
    <div class="sub">${school?.name||'Meridian International School'} · ${_periodLabel(_period)} · Generated ${now}</div>
  </div>
  <div style="text-align:right;font-size:12px;color:#6B7280">
    SchoolSync<br>${_termLabel(termId)}
  </div>
</div>

<!-- SUMMARY STATS -->
<div class="stats">
  <div class="stat"><div class="stat-v" style="color:#059669">+${totalMerits}</div><div class="stat-l">Merit Points</div></div>
  <div class="stat"><div class="stat-v" style="color:#DC2626">${totalDemerits}</div><div class="stat-l">Demerit Points</div></div>
  <div class="stat"><div class="stat-v" style="color:#2563EB">${baseInc.length}</div><div class="stat-l">Total Incidents</div></div>
  <div class="stat"><div class="stat-v" style="color:#D97706">${stageAlerts.length}</div><div class="stat-l">Students at a Stage</div></div>
  <div class="stat"><div class="stat-v" style="color:#7C3AED">${patterns.filter(p=>p.type==='demerit').length}</div><div class="stat-l">Demerit Patterns</div></div>
</div>

<!-- HOUSE CUP -->
<h2>🏆 House Cup Standings</h2>
${houseCup.length ? `
<table>
  <thead><tr><th>#</th><th>House</th><th>Badge</th><th>Points</th><th>Bar</th></tr></thead>
  <tbody>
  ${houseCup.map((h,i) => `<tr>
    <td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}`}</td>
    <td style="font-weight:600;color:${h.color}">${h.name} House</td>
    <td style="font-size:18px">${h.badge}</td>
    <td><strong>${h.pts}</strong></td>
    <td><div class="bar-bg"><div class="bar-fill" style="background:${h.color};width:${Math.max(4,Math.min(100,maxHousePts>0?h.pts/maxHousePts*100:0)).toFixed(1)}%"></div></div></td>
  </tr>`).join('')}
  </tbody>
</table>` : '<div class="empty">No houses configured.</div>'}

<!-- STAGE ALERTS -->
<h2>⚠️ Demerit Stage Alerts (Rolling Half-Term)</h2>
${stageAlerts.length ? `
<table>
  <thead><tr><th>Student</th><th>Class</th><th>House</th><th>Stage</th><th>Responsibility</th><th>Demerit Pts (HT)</th></tr></thead>
  <tbody>
  ${stageAlerts.map(s => `<tr>
    <td><strong>${s.firstName} ${s.lastName}</strong></td>
    <td>${_className(s.classId)}</td>
    <td>${s.h ? `${s.h.badge} ${s.h.name}` : '—'}</td>
    <td><span class="badge d">Stage ${s.stage}</span></td>
    <td>${s.si?.who||s.si?.label||'—'}</td>
    <td><strong style="color:#DC2626">${s.dp}</strong></td>
  </tr>`).join('')}
  </tbody>
</table>` : '<div class="empty">No students at a demerit stage this half-term.</div>'}

<!-- PERSISTENT PATTERNS -->
<h2>🔁 Persistent Behaviour Patterns</h2>
${patterns.length ? `
<table>
  <thead><tr><th>Student</th><th>Class</th><th>Behaviour</th><th>Category</th><th>Type</th><th>Count</th><th>Last</th></tr></thead>
  <tbody>
  ${patterns.slice(0,20).map(p => {
    const stu  = DB.getById('students', p.studentId);
    const last = p.incidents.sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
    return `<tr>
      <td><strong>${stu?`${stu.firstName} ${stu.lastName}`:'—'}</strong></td>
      <td>${stu?_className(stu.classId):'—'}</td>
      <td>${p.label}</td>
      <td>${p.catName}</td>
      <td><span class="badge ${p.type==='merit'?'m':'d'}">${p.type}</span></td>
      <td><strong>${p.incidents.length}×</strong></td>
      <td>${_fmtDate(last?.date)}</td>
    </tr>`;
  }).join('')}
  </tbody>
</table>${patterns.length>20?`<div class="empty">…and ${patterns.length-20} more patterns</div>`:''}` :
'<div class="empty">No repeated behaviour patterns in this period.</div>'}

<!-- STUDENT SUMMARY -->
<h2 class="page-break">📋 Student Behaviour Summary</h2>
${stuSummary.length ? `
<table>
  <thead><tr><th>Student</th><th>Class</th><th>House</th><th>Merit Pts</th><th>Demerit Pts (HT)</th><th>Net</th><th>Stage</th><th>Milestone</th></tr></thead>
  <tbody>
  ${stuSummary.map(s => `<tr>
    <td><strong>${s.firstName} ${s.lastName}</strong></td>
    <td>${_className(s.classId)}</td>
    <td>${s.h?`${s.h.badge} ${s.h.name}`:'—'}</td>
    <td style="color:#059669;font-weight:600">+${s.mp}</td>
    <td style="color:#DC2626;font-weight:600">${s.dp}</td>
    <td style="font-weight:700;color:${(s.mp-s.dp)>=0?'#059669':'#DC2626'}">${(s.mp-s.dp)>=0?'+':''}${s.mp-s.dp}</td>
    <td>${s.stage?`<span class="badge d">Stage ${s.stage}</span>`:'—'}</td>
    <td>${s.ms?`${s.ms.badge} ${s.ms.name}`:'—'}</td>
  </tr>`).join('')}
  </tbody>
</table>` : '<div class="empty">No incidents recorded for this period.</div>'}

<!-- STAFF ACTIVITY -->
<h2>👤 Staff Activity Log</h2>
${Object.keys(staffActivity).length ? `
<table>
  <thead><tr><th>Staff Member</th><th>Merits Logged</th><th>Demerits Logged</th><th>Total</th></tr></thead>
  <tbody>
  ${Object.entries(staffActivity).sort((a,b)=>(b[1].merits+b[1].demerits)-(a[1].merits+a[1].demerits)).map(([name,act])=>`<tr>
    <td>${name}</td>
    <td style="color:#059669">${act.merits}</td>
    <td style="color:#DC2626">${act.demerits}</td>
    <td><strong>${act.merits+act.demerits}</strong></td>
  </tr>`).join('')}
  </tbody>
</table>` : '<div class="empty">No incidents logged in this period.</div>'}

<div style="margin-top:28px;padding-top:12px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center">
  Generated by SchoolSync · ${school?.name||'Meridian International School'} · ${now}
</div>

<script>window.onload=function(){window.print();}</script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return showToast('Pop-up blocked — please allow pop-ups for this site.', 'warning');
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  /* ─────────────────────────────────────────
     PERIOD SETTER (called from inline onclick)
  ───────────────────────────────────────── */
  function setPeriod(p) {
    _period = p;
    render();
  }

  /* ─────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────── */
  return {
    render, setTab, setPeriod, generateReport,
    logModal, saveIncident, saveIncidentNew, deleteIncident,
    // Log modal helpers (called from inline onclick inside modal)
    _logSetType, _logSetCat, _logSetClass, _logSearch, _logSelectItem, _logRefresh,
    // Legacy no-ops (kept for backward compat)
    _logSetSource, _logSetGroup, _logSetCustomCat,
    _updateCatOptions, _setFilter,
    // Appeals
    submitAppealModal, saveAppeal,
    resolveAppealModal, saveResolution,
    addParentNoteModal, saveParentNote,
    scheduleDetentionModal, saveDetention,
    markDetentionComplete, cancelDetention,
    // Settings
    editCategoryModal, _saveCat, deleteCat,
    editMilestoneModal, _saveMs, deleteMilestone,
    editStageModal, _saveStage, deleteStage,
    editHouseModal, _saveHouse, deleteHouse,
    editKSModal, _saveKS, deleteKS,
    editDetTypeModal, _saveDetType, deleteDetType
  };
})();
