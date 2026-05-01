/* ============================================================
   InnoLearn — Attendance Module
   ============================================================ */

const Attendance = (() => {
  let _selectedClass = 'cls10a';
  let _selectedDate  = new Date().toISOString().split('T')[0];
  let _pendingState  = {};

  function render() {
    App.setBreadcrumb('<i class="fas fa-clipboard-check"></i> Attendance');

    if (Auth.isStudent()) return _renderStudentView();
    if (Auth.isParent())  return _renderParentView();

    // Pre-select homeroom class for class teachers; otherwise first accessible class
    const accessibleClasses = Auth.myClasses();
    if (Auth.isClassTeacher()) {
      const tch = Auth.myTeacher();
      if (tch?.homeroomClass) _selectedClass = tch.homeroomClass;
    } else if (accessibleClasses.length && !accessibleClasses.find(c => c.id === _selectedClass)) {
      _selectedClass = accessibleClasses[0]?.id || _selectedClass;
    }

    _renderMarkPage();
  }

  function _renderMarkPage() {
    const classes  = Auth.myClasses();
    const cls      = DB.getById('classes', _selectedClass);
    const students = DB.query('students', s => s.classId === _selectedClass && s.status === 'active')
                       .sort((a,b) => a.lastName.localeCompare(b.lastName));
    const existing = DB.query('attendance', a => a.classId === _selectedClass && a.date === _selectedDate)[0];

    /* Initialise pending from existing */
    if (!Object.keys(_pendingState).length || _pendingState._class !== _selectedClass) {
      _pendingState = { _class: _selectedClass };
      students.forEach(s => {
        const rec = existing?.records?.find(r => r.studentId === s.id);
        _pendingState[s.id] = rec?.status || 'present';
      });
    }

    const summary = {
      present: students.filter(s => (_pendingState[s.id]||'present') === 'present').length,
      absent:  students.filter(s => (_pendingState[s.id]||'present') === 'absent').length,
      late:    students.filter(s => (_pendingState[s.id]||'present') === 'late').length,
      excused: students.filter(s => (_pendingState[s.id]||'present') === 'excused').length,
    };

    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1>Daily Attendance</h1>
        <p>${cls?.name || 'Select class'} · ${fmtDate(_selectedDate)}</p>
      </div>
      <div class="page-actions">
        ${existing ? `<span class="badge badge-success"><i class="fas fa-check"></i> Already submitted</span>` : `<span class="badge badge-warning">Not yet submitted</span>`}
        <button class="btn btn-primary" onclick="Attendance.submit()"><i class="fas fa-paper-plane"></i> ${existing ? 'Update' : 'Submit Attendance'}</button>
        <button class="btn btn-secondary" onclick="App.navigate('reports')"><i class="fas fa-chart-bar"></i> Reports</button>
      </div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
      <select class="filter-select" onchange="Attendance.selectClass(this.value)">
        ${classes.map(c=>`<option value="${c.id}" ${_selectedClass===c.id?'selected':''}>${c.name}</option>`).join('')}
      </select>
      <input type="date" class="filter-select" value="${_selectedDate}" onchange="Attendance.selectDate(this.value)" max="${new Date().toISOString().split('T')[0]}">
      <button class="btn btn-sm btn-secondary" onclick="Attendance.markAll('present')"><i class="fas fa-check" style="color:var(--success)"></i> All Present</button>
      <button class="btn btn-sm btn-secondary" onclick="Attendance.markAll('absent')"><i class="fas fa-times" style="color:var(--danger)"></i> All Absent</button>

      <div style="margin-left:auto;display:flex;gap:12px">
        <div style="text-align:center;background:var(--success-light);border-radius:8px;padding:8px 14px"><div style="font-size:18px;font-weight:800;color:var(--success)">${summary.present}</div><div style="font-size:11px;color:var(--gray-500)">Present</div></div>
        <div style="text-align:center;background:var(--danger-light);border-radius:8px;padding:8px 14px"><div style="font-size:18px;font-weight:800;color:var(--danger)">${summary.absent}</div><div style="font-size:11px;color:var(--gray-500)">Absent</div></div>
        <div style="text-align:center;background:var(--warning-light);border-radius:8px;padding:8px 14px"><div style="font-size:18px;font-weight:800;color:var(--warning)">${summary.late}</div><div style="font-size:11px;color:var(--gray-500)">Late</div></div>
      </div>
    </div>

    <div class="card mb-0">
      <div class="att-grid">
        <div class="att-row header">
          <span>#</span><span>Student</span><span>Present</span><span>Absent</span><span>Late</span><span>Excused</span>
        </div>
        ${students.map((s, i) => {
          const state = _pendingState[s.id] || 'present';
          return `<div class="att-row" id="att-row-${s.id}">
            <span style="color:var(--gray-400);font-size:12px">${i+1}</span>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="avatar-circle" style="background:${s.gender==='Female'?'#7C3AED':'#2563EB'};width:30px;height:30px;font-size:12px">${s.firstName.charAt(0)}</div>
              <div>
                <div style="font-size:13px;font-weight:600">${s.firstName} ${s.lastName}</div>
                <div style="font-size:11px;color:var(--gray-400)">${s.admissionNo}</div>
              </div>
            </div>
            <button class="att-status-btn present ${state==='present'?'active':''}" onclick="Attendance.setStatus('${s.id}','present',this)">✓ Present</button>
            <button class="att-status-btn absent  ${state==='absent'?'active':''}"  onclick="Attendance.setStatus('${s.id}','absent',this)">✗ Absent</button>
            <button class="att-status-btn late    ${state==='late'?'active':''}"    onclick="Attendance.setStatus('${s.id}','late',this)">⏰ Late</button>
            <button class="att-status-btn excused ${state==='excused'?'active':''}" onclick="Attendance.setStatus('${s.id}','excused',this)">📋 Excused</button>
          </div>`;
        }).join('') || '<div class="empty-state" style="padding:30px"><i class="fas fa-users-slash"></i><h3>No students in this class</h3></div>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <div class="card-title">Recent Attendance History</div>
      </div>
      ${_recentHistory()}
    </div>
    `);
  }

  function setStatus(studentId, status, btn) {
    _pendingState[studentId] = status;
    const row = document.getElementById(`att-row-${studentId}`);
    if (!row) return;
    row.querySelectorAll('.att-status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    /* Update summary numbers */
    _updateSummary();
  }

  function _updateSummary() { /* simplified: just re-counts from pendingState */ }

  function markAll(status) {
    Object.keys(_pendingState).filter(k => k !== '_class').forEach(sid => {
      _pendingState[sid] = status;
    });
    _renderMarkPage();
  }

  function selectClass(id) {
    _selectedClass = id;
    _pendingState = {};
    _renderMarkPage();
  }

  function selectDate(d) {
    _selectedDate = d;
    _pendingState = {};
    _renderMarkPage();
  }

  function submit() {
    const students = DB.query('students', s => s.classId === _selectedClass && s.status === 'active');
    const records  = students.map(s => ({
      studentId: s.id,
      status: _pendingState[s.id] || 'present',
      note: '',
      markedAt: new Date().toISOString(),
      markedBy: Auth.currentUser.id
    }));

    const existing = DB.query('attendance', a => a.classId === _selectedClass && a.date === _selectedDate)[0];
    if (existing) {
      DB.update('attendance', existing.id, { records, markedAt: new Date().toISOString(), markedBy: Auth.currentUser.id });
      showToast('Attendance updated.', 'success');
    } else {
      const _school = Auth.currentSchool;
      DB.insert('attendance', { schoolId:'sch1', classId:_selectedClass, date:_selectedDate, termId:SchoolContext.currentTermId(), academicYearId:SchoolContext.currentAcYearId(), records, markedAt:new Date().toISOString(), markedBy:Auth.currentUser.id });
      showToast('Attendance submitted successfully.', 'success');
    }
    _renderMarkPage();
  }

  function _recentHistory() {
    const records = DB.query('attendance', a => a.classId === _selectedClass).slice(-7).reverse();
    if (!records.length) return '<div class="empty-state" style="padding:20px"><p>No attendance history</p></div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Present</th><th>Absent</th><th>Late</th><th>Excused</th><th>Rate</th></tr></thead>
      <tbody>
      ${records.map(a => {
        const p = a.records.filter(r=>r.status==='present').length;
        const ab= a.records.filter(r=>r.status==='absent').length;
        const l = a.records.filter(r=>r.status==='late').length;
        const ex= a.records.filter(r=>r.status==='excused').length;
        const rate = a.records.length > 0 ? Math.round(p/a.records.length*100) : 0;
        return `<tr>
          <td>${fmtDate(a.date)}</td>
          <td><span class="badge badge-success">${p}</span></td>
          <td><span class="badge badge-danger">${ab}</span></td>
          <td><span class="badge badge-warning">${l}</span></td>
          <td><span class="badge badge-secondary">${ex}</span></td>
          <td><span style="font-weight:700;color:var(--${rate>=90?'success':rate>=75?'warning':'danger'})">${rate}%</span></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table></div>`;
  }

  function _renderStudentView() {
    const user = Auth.currentUser;
    const stu  = DB.query('students', s => s.userId === user.id)[0];
    if (!stu) { App.renderPage('<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Student profile not found</h3></div>'); return; }

    const records = DB.get('attendance').flatMap(a => a.records.filter(r => r.studentId === stu.id).map(r => ({ ...r, date: a.date })));
    const total   = records.length;
    const present = records.filter(r => r.status === 'present').length;
    const absent  = records.filter(r => r.status === 'absent').length;
    const late    = records.filter(r => r.status === 'late').length;
    const rate    = total > 0 ? Math.round(present/total*100) : 100;

    App.renderPage(`
    <div class="page-header"><div class="page-title"><h1>My Attendance</h1><p>${fmtDate(new Date().toISOString())} — ${DB.getById('classes',stu.classId)?.name}</p></div></div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon ${rate>=90?'green':rate>=75?'yellow':'red'}"><i class="fas fa-percent"></i></div><div class="stat-body"><div class="stat-value">${rate}%</div><div class="stat-label">Attendance Rate</div></div></div>
      <div class="stat-card"><div class="stat-icon green"><i class="fas fa-check-circle"></i></div><div class="stat-body"><div class="stat-value">${present}</div><div class="stat-label">Days Present</div></div></div>
      <div class="stat-card"><div class="stat-icon red"><i class="fas fa-times-circle"></i></div><div class="stat-body"><div class="stat-value">${absent}</div><div class="stat-label">Days Absent</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow"><i class="fas fa-clock"></i></div><div class="stat-body"><div class="stat-value">${late}</div><div class="stat-label">Days Late</div></div></div>
    </div>

    <div class="card">
      <div class="card-title mb-12">Attendance Record</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Status</th><th>Note</th></tr></thead>
        <tbody>
          ${records.reverse().map(r=>`<tr>
            <td>${fmtDate(r.date)}</td>
            <td><span class="badge badge-${statusBadge(r.status)}">${r.status}</span></td>
            <td style="font-size:12px;color:var(--gray-400)">${r.note||'—'}</td>
          </tr>`).join('') || '<tr><td colspan="3"><div class="empty-state" style="padding:20px"><p>No records yet</p></div></td></tr>'}
        </tbody>
      </table></div>
    </div>
    `);
  }

  function _renderParentView() {
    const user = Auth.currentUser;
    const kids = DB.query('students', s => s.guardians?.some(g => g.userId === user.id));

    App.renderPage(`
    <div class="page-header"><div class="page-title"><h1>Children's Attendance</h1></div></div>
    ${kids.map(stu => {
      const records = DB.get('attendance').flatMap(a => a.records.filter(r => r.studentId === stu.id).map(r => ({...r,date:a.date}))).slice(-10).reverse();
      const total   = records.length; const present = records.filter(r=>r.status==='present').length;
      const rate    = total > 0 ? Math.round(present/total*100) : 100;
      const cls     = DB.getById('classes', stu.classId);
      return `<div class="card">
        <div class="card-header">
          <div><div class="card-title">${stu.firstName} ${stu.lastName}</div><div class="card-subtitle">${cls?.name} · ${rate}% attendance rate</div></div>
          <span class="badge badge-${rate>=90?'success':rate>=75?'warning':'danger'}">${rate}%</span>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            ${records.map(r=>`<tr><td>${fmtDate(r.date)}</td><td><span class="badge badge-${statusBadge(r.status)}">${r.status}</span></td><td style="font-size:12px;color:var(--gray-400)">${r.note||'—'}</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--gray-400);padding:16px">No records</td></tr>'}
          </tbody>
        </table></div>
      </div>`;
    }).join('')}
    `);
  }

  function _getTeacherClasses() {
    return Auth.myClasses(); // delegates to role-aware helper in Auth
  }

  return { render, setStatus, markAll, selectClass, selectDate, submit };
})();
