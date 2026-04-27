/* ============================================================
   SchoolSync — Exams Module
   ============================================================ */

const Exams = (() => {
  let _tab    = 'schedule';
  let _filter = { termId: 'term2', classId: '', subjectId: '', status: '' };

  /* ── Status display helpers ── */
  const STATUS_BADGE = { scheduled:'primary', in_progress:'warning', completed:'success', cancelled:'secondary' };
  const STATUS_LABEL = { scheduled:'Scheduled', in_progress:'In Progress', completed:'Completed', cancelled:'Cancelled' };

  function render() {
    App.setBreadcrumb('<i class="fas fa-file-alt"></i> Examinations');

    // Role scoping — students/parents see a limited view
    if (Auth.isStudent()) return _renderStudentView();
    if (Auth.isParent())  return _renderParentView();

    // Sync accessible classes
    const myCls = Auth.myClasses();
    if (myCls.length && !myCls.find(c => c.id === _filter.classId)) {
      _filter.classId = myCls[0]?.id || '';
    }

    _renderMain();
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  MAIN VIEW (staff)                                          */
  /* ─────────────────────────────────────────────────────────── */
  function _renderMain() {
    const terms    = (DB.getById('academicYears','ay2025')?.terms || []);
    const classes  = Auth.myClasses();
    const subjects = DB.get('subjects');
    const exams    = _getFiltered();

    /* Summary counts */
    const total     = exams.length;
    const scheduled = exams.filter(e => e.status === 'scheduled').length;
    const completed = exams.filter(e => e.status === 'completed').length;
    const upcoming  = exams.filter(e => e.status === 'scheduled' && e.date >= new Date().toISOString().split('T')[0]).length;

    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1>Examinations</h1>
        <p>${total} exam${total!==1?'s':''} found · ${upcoming} upcoming</p>
      </div>
      <div class="page-actions">
        ${Auth.hasPermission('exams','create') ? `<button class="btn btn-primary" onclick="Exams.openScheduleModal()"><i class="fas fa-plus"></i> Schedule Exam</button>` : ''}
        ${Auth.hasPermission('exams','create') ? `<button class="btn btn-secondary" onclick="Exams.announceModal()"><i class="fas fa-bullhorn"></i> Announce</button>` : ''}
      </div>
    </div>

    <div class="tabs" id="exam-tabs">
      <button class="tab-btn ${_tab==='schedule'?'active':''}" onclick="Exams.switchTab('schedule',this)">
        <i class="fas fa-calendar-alt"></i> Schedule
      </button>
      <button class="tab-btn ${_tab==='results'?'active':''}" onclick="Exams.switchTab('results',this)">
        <i class="fas fa-chart-bar"></i> Results
      </button>
      <button class="tab-btn ${_tab==='analytics'?'active':''}" onclick="Exams.switchTab('analytics',this)">
        <i class="fas fa-chart-bar"></i> Analytics
      </button>
    </div>

    <!-- FILTERS -->
    <div class="toolbar" style="margin-top:0">
      <select class="filter-select" onchange="Exams.setFilter('termId',this.value)">
        <option value="">All Terms</option>
        ${terms.map(t=>`<option value="${t.id}" ${_filter.termId===t.id?'selected':''}>${t.name}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="Exams.setFilter('classId',this.value)">
        <option value="">All Classes</option>
        ${classes.map(c=>`<option value="${c.id}" ${_filter.classId===c.id?'selected':''}>${c.name}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="Exams.setFilter('subjectId',this.value)">
        <option value="">All Subjects</option>
        ${subjects.map(s=>`<option value="${s.id}" ${_filter.subjectId===s.id?'selected':''}>${s.name}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="Exams.setFilter('status',this.value)">
        <option value="">All Statuses</option>
        <option value="scheduled" ${_filter.status==='scheduled'?'selected':''}>Scheduled</option>
        <option value="completed" ${_filter.status==='completed'?'selected':''}>Completed</option>
        <option value="cancelled" ${_filter.status==='cancelled'?'selected':''}>Cancelled</option>
      </select>
      <span style="color:var(--gray-400);font-size:13px;margin-left:auto">${exams.length} exam${exams.length!==1?'s':''}</span>
    </div>

    <!-- STATS STRIP -->
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-file-alt"></i></div>
        <div class="stat-body"><div class="stat-value">${total}</div><div class="stat-label">Total Exams</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow"><i class="fas fa-clock"></i></div>
        <div class="stat-body"><div class="stat-value">${scheduled}</div><div class="stat-label">Scheduled</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
        <div class="stat-body"><div class="stat-value">${completed}</div><div class="stat-label">Completed</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple"><i class="fas fa-calendar-day"></i></div>
        <div class="stat-body"><div class="stat-value">${upcoming}</div><div class="stat-label">Upcoming</div></div>
      </div>
    </div>

    <!-- SCHEDULE TAB -->
    <div id="exam-tab-schedule" style="display:${_tab==='schedule'?'block':'none'}">
      ${_scheduleTable(exams)}
    </div>

    <!-- RESULTS TAB -->
    <div id="exam-tab-results" style="display:${_tab==='results'?'block':'none'}">
      ${_resultsPanel(exams)}
    </div>

    <!-- ANALYTICS TAB -->
    <div id="exam-tab-analytics" style="display:${_tab==='analytics'?'block':'none'}">
      ${_analyticsPanel(exams)}
    </div>
    `);
  }

  /* ── Schedule table ── */
  function _scheduleTable(exams) {
    if (!exams.length) return `<div class="empty-state"><i class="fas fa-file-alt"></i><h3>No exams found</h3><p>Try adjusting your filters or schedule a new exam.</p></div>`;

    const sorted = [...exams].sort((a,b) => a.date.localeCompare(b.date));

    return `<div class="card mb-0">
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Date &amp; Time</th><th>Exam</th><th>Class</th><th>Subject</th>
          <th>Room</th><th>Duration</th><th>Marks</th><th>Status</th>
          ${Auth.hasPermission('exams','edit') ? '<th>Actions</th>' : ''}
        </tr></thead>
        <tbody>
          ${sorted.map(ex => {
            const cls  = DB.getById('classes', ex.classId);
            const subj = DB.getById('subjects', ex.subjectId);
            const isUpcoming = ex.date >= new Date().toISOString().split('T')[0];
            return `<tr>
              <td>
                <div style="font-weight:600;font-size:13px">${fmtDate(ex.date)}</div>
                <div style="font-size:11px;color:var(--gray-400)">${ex.startTime} – ${ex.endTime}</div>
              </td>
              <td><span style="font-weight:600">${ex.title}</span></td>
              <td>${cls?.name||'—'}</td>
              <td>
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="width:8px;height:8px;border-radius:50%;background:${subj?.color||'#6B7280'};flex-shrink:0"></span>
                  ${subj?.name||'—'}
                </div>
              </td>
              <td><i class="fas fa-map-marker-alt" style="color:var(--gray-400);font-size:11px"></i> ${ex.room||'TBA'}</td>
              <td>${ex.duration} min</td>
              <td>${ex.maxMarks} pts · Pass: ${ex.passMark}</td>
              <td><span class="badge badge-${STATUS_BADGE[ex.status]||'secondary'}">${STATUS_LABEL[ex.status]||ex.status}</span></td>
              ${Auth.hasPermission('exams','edit') ? `<td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-sm btn-secondary" onclick="Exams.editModal('${ex.id}')"><i class="fas fa-edit"></i></button>
                  ${ex.status==='scheduled' ? `<button class="btn btn-sm btn-secondary" onclick="Exams.markComplete('${ex.id}')" title="Mark as completed"><i class="fas fa-check" style="color:var(--success)"></i></button>` : ''}
                  ${Auth.hasPermission('exams','delete') ? `<button class="btn btn-sm btn-secondary" onclick="Exams.deleteExam('${ex.id}')"><i class="fas fa-trash" style="color:var(--danger)"></i></button>` : ''}
                </div>
              </td>` : ''}
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
  }

  /* ── Results panel ── */
  function _resultsPanel(exams) {
    const completed = exams.filter(e => e.status === 'completed');
    if (!completed.length) return `<div class="empty-state"><i class="fas fa-chart-bar"></i><h3>No completed exams yet</h3><p>Results appear here once exams are marked as completed.</p></div>`;

    // Group completed exams by class+subject, show grade distribution from grades table
    return `<div style="display:grid;gap:16px">
      ${completed.map(ex => {
        const cls  = DB.getById('classes', ex.classId);
        const subj = DB.getById('subjects', ex.subjectId);
        const students = DB.query('students', s => s.classId === ex.classId && s.status === 'active');
        const gradRecs  = DB.query('grades', g => g.subjectId === ex.subjectId && g.classId === ex.classId && g.name === ex.title);
        const scored    = gradRecs.filter(g => g.score !== null);
        const avg       = scored.length ? Math.round(scored.reduce((s,g)=>s+g.percentage,0)/scored.length) : null;
        const high      = scored.length ? Math.max(...scored.map(g=>g.percentage)) : null;
        const low       = scored.length ? Math.min(...scored.map(g=>g.percentage)) : null;
        const passed    = scored.filter(g => g.score >= ex.passMark).length;

        return `<div class="card mb-0">
          <div class="card-header" style="margin-bottom:16px">
            <div>
              <div class="card-title">${ex.title} — ${subj?.name||'?'} · ${cls?.name||'?'}</div>
              <div class="card-subtitle">${fmtDate(ex.date)} · Max: ${ex.maxMarks} · Pass: ${ex.passMark}</div>
            </div>
            ${Auth.hasPermission('exams','edit') ? `<button class="btn btn-sm btn-primary" onclick="Exams.enterResultsModal('${ex.id}')"><i class="fas fa-edit"></i> Enter Marks</button>` : ''}
          </div>
          ${scored.length ? `
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
            <div style="text-align:center;background:var(--primary-light);border-radius:8px;padding:10px 20px">
              <div style="font-size:22px;font-weight:800;color:var(--primary)">${avg}%</div>
              <div style="font-size:11px;color:var(--gray-500)">Class Average</div>
            </div>
            <div style="text-align:center;background:var(--success-light);border-radius:8px;padding:10px 20px">
              <div style="font-size:22px;font-weight:800;color:var(--success)">${high}%</div>
              <div style="font-size:11px;color:var(--gray-500)">Highest</div>
            </div>
            <div style="text-align:center;background:var(--danger-light);border-radius:8px;padding:10px 20px">
              <div style="font-size:22px;font-weight:800;color:var(--danger)">${low}%</div>
              <div style="font-size:11px;color:var(--gray-500)">Lowest</div>
            </div>
            <div style="text-align:center;background:var(--warning-light);border-radius:8px;padding:10px 20px">
              <div style="font-size:22px;font-weight:800;color:var(--warning)">${passed}/${scored.length}</div>
              <div style="font-size:11px;color:var(--gray-500)">Passed</div>
            </div>
            <div style="text-align:center;background:var(--gray-50);border-radius:8px;padding:10px 20px">
              <div style="font-size:22px;font-weight:800;color:var(--gray-600)">${students.length - scored.length}</div>
              <div style="font-size:11px;color:var(--gray-500)">Not Entered</div>
            </div>
          </div>
          <div class="table-wrap" style="max-height:220px;overflow-y:auto"><table>
            <thead><tr><th>#</th><th>Student</th><th>Score</th><th>%</th><th>Grade</th><th>Remarks</th></tr></thead>
            <tbody>
              ${students.sort((a,b)=>a.lastName.localeCompare(b.lastName)).map((stu,i)=>{
                const g = gradRecs.find(g=>g.studentId===stu.id);
                return `<tr>
                  <td style="color:var(--gray-400);font-size:12px">${i+1}</td>
                  <td><span style="font-weight:600">${stu.firstName} ${stu.lastName}</span></td>
                  <td>${g?.score!=null?`${g.score}/${ex.maxMarks}`:'<span style="color:var(--gray-300)">—</span>'}</td>
                  <td>${g?.percentage!=null?`<span style="font-weight:700;color:var(--${g.percentage>=50?'success':'danger'})">${g.percentage}%</span>`:'—'}</td>
                  <td>${g?.grade?`<span class="badge badge-${g.percentage>=70?'success':g.percentage>=50?'warning':'danger'}">${g.grade}</span>`:'—'}</td>
                  <td style="font-size:12px;color:var(--gray-400)">${g?.comments||'—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>` : `<div class="empty-state" style="padding:20px"><p>No results entered yet. <button class="btn btn-sm btn-primary" onclick="Exams.enterResultsModal('${ex.id}')">Enter Marks</button></p></div>`}
        </div>`;
      }).join('')}
    </div>`;
  }

  /* ── Analytics panel ── */
  function _analyticsPanel(exams) {
    const allGrades  = DB.get('grades');
    const myClassIds = Auth.myClasses().map(c=>c.id);
    const relevant   = allGrades.filter(g => myClassIds.includes(g.classId));

    // Subject pass rates
    const subjects = DB.get('subjects');
    const subjStats = subjects.map(s => {
      const recs  = relevant.filter(g => g.subjectId === s.id && g.percentage != null);
      const pass  = recs.filter(g => g.percentage >= 50).length;
      const avg   = recs.length ? Math.round(recs.reduce((a,g)=>a+g.percentage,0)/recs.length) : null;
      return { subj:s, total:recs.length, pass, avg, passRate: recs.length ? Math.round(pass/recs.length*100) : null };
    }).filter(s=>s.total>0).sort((a,b)=>(b.avg||0)-(a.avg||0));

    if (!subjStats.length) return `<div class="empty-state"><i class="fas fa-chart-bar"></i><h3>No data yet</h3><p>Analytics will appear once grades are entered.</p></div>`;

    return `<div class="card mb-0">
      <div class="card-title mb-12">Subject Performance Overview</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Subject</th><th>Entries</th><th>Average</th><th>Pass Rate</th><th>Performance Bar</th></tr></thead>
        <tbody>
          ${subjStats.map(s=>`<tr>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:10px;height:10px;border-radius:50%;background:${s.subj.color};flex-shrink:0"></span>
                <span style="font-weight:600">${s.subj.name}</span>
              </div>
            </td>
            <td>${s.total}</td>
            <td><span style="font-weight:700;color:var(--${(s.avg||0)>=70?'success':(s.avg||0)>=50?'warning':'danger'})">${s.avg!=null?s.avg+'%':'—'}</span></td>
            <td><span class="badge badge-${(s.passRate||0)>=80?'success':(s.passRate||0)>=60?'warning':'danger'}">${s.passRate!=null?s.passRate+'%':'—'}</span></td>
            <td style="min-width:120px">
              <div style="background:var(--gray-100);border-radius:99px;height:8px;overflow:hidden">
                <div style="width:${s.avg||0}%;height:100%;background:${(s.avg||0)>=70?'var(--success)':(s.avg||0)>=50?'var(--warning)':'var(--danger)'};border-radius:99px;transition:width .3s"></div>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  STUDENT VIEW                                               */
  /* ─────────────────────────────────────────────────────────── */
  function _renderStudentView() {
    const user = Auth.currentUser;
    const stu  = DB.query('students', s => s.userId === user.id)[0];
    if (!stu) { App.renderPage('<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Student profile not found</h3></div>'); return; }

    const myExams = DB.query('exam_schedules', e => e.classId === stu.classId)
                      .sort((a,b) => a.date.localeCompare(b.date));
    const upcoming = myExams.filter(e => e.date >= new Date().toISOString().split('T')[0] && e.status === 'scheduled');
    const past     = myExams.filter(e => e.date <  new Date().toISOString().split('T')[0] || e.status === 'completed');

    App.renderPage(`
    <div class="page-header"><div class="page-title"><h1>My Exams</h1><p>${DB.getById('classes',stu.classId)?.name}</p></div></div>

    ${upcoming.length ? `
    <h3 style="font-size:14px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:10px"><i class="fas fa-calendar-alt" style="color:var(--primary)"></i> Upcoming Exams (${upcoming.length})</h3>
    <div style="display:grid;gap:12px;margin-bottom:24px">
      ${upcoming.map(ex => {
        const subj = DB.getById('subjects', ex.subjectId);
        const daysLeft = Math.ceil((new Date(ex.date) - new Date()) / 86400000);
        return `<div class="card mb-0" style="border-left:4px solid ${subj?.color||'var(--primary)'}">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:0">
              <div style="font-size:15px;font-weight:700">${subj?.name||'—'}</div>
              <div style="font-size:12px;color:var(--gray-500)">${ex.title}</div>
            </div>
            <div style="text-align:center">
              <div style="font-weight:800;font-size:18px;color:var(--primary)">${fmtDate(ex.date)}</div>
              <div style="font-size:11px;color:var(--gray-400)">${ex.startTime} – ${ex.endTime}</div>
            </div>
            <div style="text-align:center;background:var(--gray-50);border-radius:8px;padding:6px 14px">
              <div style="font-size:15px;font-weight:700">${ex.room||'TBA'}</div>
              <div style="font-size:10px;color:var(--gray-400)">Room</div>
            </div>
            <div style="text-align:center;background:${daysLeft<=3?'var(--danger-light)':'var(--primary-light)'};border-radius:8px;padding:6px 14px">
              <div style="font-size:15px;font-weight:700;color:${daysLeft<=3?'var(--danger)':'var(--primary)'}">
                ${daysLeft === 0 ? 'Today!' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days`}
              </div>
              <div style="font-size:10px;color:var(--gray-400)">Until exam</div>
            </div>
          </div>
          ${ex.instructions ? `<div style="margin-top:10px;font-size:12px;color:var(--gray-500);background:var(--gray-50);border-radius:6px;padding:8px"><i class="fas fa-info-circle" style="color:var(--warning)"></i> ${ex.instructions}</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : `<div class="card mb-0" style="text-align:center;padding:24px"><i class="fas fa-check-circle" style="font-size:32px;color:var(--success)"></i><p style="margin-top:8px;color:var(--gray-500)">No upcoming exams at the moment.</p></div>`}

    ${past.length ? `
    <h3 style="font-size:14px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-top:24px;margin-bottom:10px"><i class="fas fa-history" style="color:var(--gray-400)"></i> Past Exams</h3>
    <div class="card mb-0">
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Subject</th><th>Title</th><th>Room</th><th>Duration</th><th>Max Marks</th></tr></thead>
        <tbody>
          ${past.map(ex=>{
            const subj = DB.getById('subjects', ex.subjectId);
            return `<tr>
              <td>${fmtDate(ex.date)}</td>
              <td><div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${subj?.color||'#6B7280'}"></span>${subj?.name||'—'}</div></td>
              <td>${ex.title}</td>
              <td>${ex.room||'—'}</td>
              <td>${ex.duration} min</td>
              <td>${ex.maxMarks}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>` : ''}
    `);
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  PARENT VIEW                                                */
  /* ─────────────────────────────────────────────────────────── */
  function _renderParentView() {
    const user = Auth.currentUser;
    const kids = DB.query('students', s => s.guardians?.some(g => g.userId === user.id));

    App.renderPage(`
    <div class="page-header"><div class="page-title"><h1>Children's Exams</h1></div></div>
    ${kids.map(stu => {
      const myExams = DB.query('exam_schedules', e => e.classId === stu.classId)
                        .filter(e => e.status === 'scheduled' && e.date >= new Date().toISOString().split('T')[0])
                        .sort((a,b) => a.date.localeCompare(b.date))
                        .slice(0,5);
      return `<div class="card">
        <div class="card-header">
          <div class="card-title">${stu.firstName} ${stu.lastName}</div>
          <div class="card-subtitle">${DB.getById('classes',stu.classId)?.name}</div>
        </div>
        ${myExams.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Subject</th><th>Time</th><th>Room</th></tr></thead>
          <tbody>
            ${myExams.map(ex=>{
              const subj = DB.getById('subjects', ex.subjectId);
              return `<tr>
                <td><span style="font-weight:600">${fmtDate(ex.date)}</span></td>
                <td>${subj?.name||'—'}</td>
                <td>${ex.startTime} – ${ex.endTime}</td>
                <td>${ex.room||'TBA'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>` : `<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:16px">No upcoming exams.</p>`}
      </div>`;
    }).join('')}
    `);
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  MODALS                                                     */
  /* ─────────────────────────────────────────────────────────── */
  function openScheduleModal(id) {
    const existing = id ? DB.getById('exam_schedules', id) : null;
    const classes  = Auth.myClasses();
    const subjects = DB.get('subjects');
    const terms    = DB.getById('academicYears','ay2025')?.terms || [];

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-calendar-plus"></i> ${existing ? 'Edit Exam' : 'Schedule New Exam'}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Exams.saveExam(event,'${id||''}')">
      <div class="form-field mb-12"><label>Exam Title *</label>
        <input name="title" required value="${existing?.title||'Term 2 Examination'}" placeholder="e.g. Term 2 Examination">
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Term *</label>
          <select name="termId" required>
            ${terms.map(t=>`<option value="${t.id}" ${(existing?.termId||'term2')===t.id?'selected':''}>${t.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Status</label>
          <select name="status">
            <option value="scheduled" ${(!existing||existing.status==='scheduled')?'selected':''}>Scheduled</option>
            <option value="in_progress" ${existing?.status==='in_progress'?'selected':''}>In Progress</option>
            <option value="completed" ${existing?.status==='completed'?'selected':''}>Completed</option>
            <option value="cancelled" ${existing?.status==='cancelled'?'selected':''}>Cancelled</option>
          </select>
        </div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Class *</label>
          <select name="classId" required>
            <option value="">Select class</option>
            ${classes.map(c=>`<option value="${c.id}" ${existing?.classId===c.id?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Subject *</label>
          <select name="subjectId" required>
            <option value="">Select subject</option>
            ${subjects.map(s=>`<option value="${s.id}" ${existing?.subjectId===s.id?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row cols-3">
        <div class="form-field"><label>Date *</label>
          <input type="date" name="date" required value="${existing?.date||''}">
        </div>
        <div class="form-field"><label>Start Time *</label>
          <input type="time" name="startTime" required value="${existing?.startTime||'08:00'}">
        </div>
        <div class="form-field"><label>End Time *</label>
          <input type="time" name="endTime" required value="${existing?.endTime||'10:00'}">
        </div>
      </div>
      <div class="form-row cols-3">
        <div class="form-field"><label>Duration (min) *</label>
          <input type="number" name="duration" required min="15" value="${existing?.duration||120}">
        </div>
        <div class="form-field"><label>Max Marks *</label>
          <input type="number" name="maxMarks" required min="1" value="${existing?.maxMarks||100}">
        </div>
        <div class="form-field"><label>Pass Mark *</label>
          <input type="number" name="passMark" required min="0" value="${existing?.passMark||50}">
        </div>
      </div>
      <div class="form-field mb-12"><label>Exam Room</label>
        <input name="room" value="${existing?.room||''}" placeholder="e.g. Exam Hall A, Room 203">
      </div>
      <div class="form-field mb-12"><label>Instructions for Students</label>
        <textarea name="instructions" rows="2" placeholder="e.g. No talking. Calculator allowed.">${existing?.instructions||''}</textarea>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${existing?'Update':'Schedule'}</button>
      </div>
    </form>`, 'lg');
  }

  function editModal(id) { openScheduleModal(id); }

  function saveExam(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      schoolId: 'sch1', academicYearId: 'ay2025',
      title: fd.get('title'), termId: fd.get('termId'),
      classId: fd.get('classId'), subjectId: fd.get('subjectId'),
      date: fd.get('date'), startTime: fd.get('startTime'), endTime: fd.get('endTime'),
      duration: Number(fd.get('duration')), maxMarks: Number(fd.get('maxMarks')),
      passMark: Number(fd.get('passMark')), room: fd.get('room'),
      instructions: fd.get('instructions'), status: fd.get('status'),
      createdBy: Auth.currentUser.id
    };
    if (id) { DB.update('exam_schedules', id, data); showToast('Exam updated.', 'success'); }
    else    { DB.insert('exam_schedules', data); showToast('Exam scheduled.', 'success'); }
    _closeModal();
    _renderMain();
  }

  function markComplete(id) {
    DB.update('exam_schedules', id, { status: 'completed' });
    showToast('Exam marked as completed.', 'success');
    _renderMain();
  }

  function deleteExam(id) {
    if (!confirm('Delete this exam record?')) return;
    DB.remove('exam_schedules', id);
    showToast('Exam deleted.', 'info');
    _renderMain();
  }

  /* Enter results modal — opens grade entry for an exam */
  function enterResultsModal(examId) {
    const ex = DB.getById('exam_schedules', examId);
    if (!ex) return;
    const students = DB.query('students', s => s.classId === ex.classId && s.status === 'active')
                       .sort((a,b) => a.lastName.localeCompare(b.lastName));
    const subj = DB.getById('subjects', ex.subjectId);
    const cls  = DB.getById('classes', ex.classId);

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-pen"></i> Enter Results — ${subj?.name} · ${cls?.name}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Exams.saveResults(event,'${examId}')">
      <p style="font-size:12px;color:var(--gray-400);margin-bottom:12px">
        ${ex.title} · ${fmtDate(ex.date)} · Max marks: ${ex.maxMarks}
      </p>
      <div style="max-height:340px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--gray-50)">
            <th style="padding:8px;text-align:left;font-size:12px;color:var(--gray-500)">Student</th>
            <th style="padding:8px;text-align:center;font-size:12px;color:var(--gray-500)">Score /${ex.maxMarks}</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:var(--gray-500)">Comment</th>
          </tr></thead>
          <tbody>
            ${students.map(stu => {
              const existing = DB.query('grades', g => g.studentId===stu.id && g.subjectId===ex.subjectId && g.classId===ex.classId && g.name===ex.title)[0];
              return `<tr style="border-bottom:1px solid var(--gray-100)">
                <td style="padding:8px 4px;font-weight:600;font-size:13px">${stu.firstName} ${stu.lastName}</td>
                <td style="padding:8px 4px;text-align:center">
                  <input type="number" name="score_${stu.id}" min="0" max="${ex.maxMarks}"
                    value="${existing?.score!=null?existing.score:''}"
                    style="width:70px;padding:5px;border:1.5px solid var(--gray-200);border-radius:6px;text-align:center;font-size:13px">
                </td>
                <td style="padding:8px 4px">
                  <input name="comment_${stu.id}" value="${existing?.comments||''}"
                    placeholder="Optional…" style="width:100%;padding:5px;border:1.5px solid var(--gray-200);border-radius:6px;font-size:12px">
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Results</button>
      </div>
    </form>`, 'lg');
  }

  function saveResults(e, examId) {
    e.preventDefault();
    const ex = DB.getById('exam_schedules', examId);
    if (!ex) return;
    const fd       = new FormData(e.target);
    const students = DB.query('students', s => s.classId === ex.classId && s.status === 'active');
    const subj     = DB.getById('subjects', ex.subjectId);
    let saved = 0;

    students.forEach(stu => {
      const rawScore = fd.get(`score_${stu.id}`);
      if (rawScore === '' || rawScore === null) return;
      const score   = Number(rawScore);
      const pct     = Math.round(score / ex.maxMarks * 100);
      const comment = fd.get(`comment_${stu.id}`) || '';
      // Determine grade from grade scale
      const scales = DB.get('grade_scales');
      const cls    = DB.getById('classes', ex.classId);
      const scale  = scales.find(gs => gs.applyToGrades?.includes(String(cls?.grade))) || scales[0];
      const range  = scale?.ranges?.find(r => pct >= r.min && pct <= r.max);
      const grade  = range?.grade || (pct >= 50 ? 'P' : 'F');

      const existing = DB.query('grades', g => g.studentId===stu.id && g.subjectId===ex.subjectId && g.classId===ex.classId && g.name===ex.title)[0];
      const rec = {
        schoolId:'sch1', studentId:stu.id, subjectId:ex.subjectId, classId:ex.classId,
        termId:ex.termId, teacherId:ex.teacherId, type:'exam', name:ex.title,
        maxScore:ex.maxMarks, score, grade, percentage:pct, comments:comment, date:ex.date
      };
      if (existing) DB.update('grades', existing.id, rec);
      else          DB.insert('grades', rec);
      saved++;
    });

    // Auto-mark exam as completed
    DB.update('exam_schedules', examId, { status: 'completed' });
    showToast(`${saved} result${saved!==1?'s':''} saved.`, 'success');
    _closeModal();
    _tab = 'results';
    _renderMain();
  }

  /* Quick announcement modal */
  function announceModal() {
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-bullhorn"></i> Exam Announcement</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Exams.sendAnnouncement(event)">
      <div class="form-field mb-12"><label>Subject *</label>
        <input name="subject" required placeholder="e.g. Term 2 Exam Reminder – July 7–18">
      </div>
      <div class="form-field mb-12"><label>Message *</label>
        <textarea name="body" required rows="5" placeholder="Write your exam announcement…"></textarea>
      </div>
      <div class="form-field mb-12"><label>Send to</label>
        <select name="recipients">
          <option value="all">All (Students, Teachers, Parents)</option>
          <option value="students">Students Only</option>
          <option value="parents">Parents Only</option>
          <option value="teachers">Teachers Only</option>
        </select>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Send</button>
      </div>
    </form>`);
  }

  function sendAnnouncement(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    DB.insert('messages', {
      schoolId:'sch1', senderId:Auth.currentUser.id, senderName:Auth.currentUser.name,
      recipients:[fd.get('recipients')], subject:fd.get('subject'),
      body:fd.get('body'), type:'announcement', isRead:{}, createdAt:new Date().toISOString()
    });
    showToast('Announcement sent.', 'success');
    _closeModal();
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  HELPERS                                                    */
  /* ─────────────────────────────────────────────────────────── */
  function _getFiltered() {
    let data = DB.get('exam_schedules');
    // Role scoping
    if (!Auth.isAdmin()) {
      const myClassIds = Auth.myClasses().map(c => c.id);
      data = data.filter(e => myClassIds.includes(e.classId));
    }
    if (_filter.termId)    data = data.filter(e => e.termId    === _filter.termId);
    if (_filter.classId)   data = data.filter(e => e.classId   === _filter.classId);
    if (_filter.subjectId) data = data.filter(e => e.subjectId === _filter.subjectId);
    if (_filter.status)    data = data.filter(e => e.status    === _filter.status);
    return data;
  }

  function switchTab(tab) {
    _tab = tab;
    ['schedule','results','analytics'].forEach(t => {
      const el = document.getElementById(`exam-tab-${t}`);
      if (el) el.style.display = t === tab ? 'block' : 'none';
    });
    document.querySelectorAll('#exam-tabs .tab-btn').forEach((b,i) => {
      b.classList.toggle('active', ['schedule','results','analytics'][i] === tab);
    });
  }

  function setFilter(key, val) { _filter[key] = val; _renderMain(); }

  return { render, openScheduleModal, editModal, saveExam, markComplete, deleteExam,
           enterResultsModal, saveResults, announceModal, sendAnnouncement,
           switchTab, setFilter };
})();
