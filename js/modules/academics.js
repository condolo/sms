/* ============================================================
   InnoLearn — Academics Module
   Tabs: Gradebook | Grade Weights | Grade Scales | Analytics | Reports | Lesson Plans
   ============================================================ */

const Academics = (() => {

  /* ── State ── */
  let _tab            = 'gradebook';
  let _selectedClass  = 'cls10a';
  let _selectedSubject= 'sbj1';
  let _selectedTerm   = SchoolContext.currentTermId();
  let _selectedAcYear = SchoolContext.currentAcYearId();

  // Lesson plan state
  let _lpClass   = 'cls10a';
  let _lpSubject = 'sbj2';
  let _lpTerm    = SchoolContext.currentTermId();
  let _lpYear    = SchoolContext.currentAcYearId();

  // Report state
  let _rptClass  = 'cls10a';
  let _rptTerm   = SchoolContext.currentTermId();
  let _rptYear   = SchoolContext.currentAcYearId();

  /* ═══════════════════════════════════════════════════════════════
     ENTRY POINT
  ═══════════════════════════════════════════════════════════════ */
  function render() {
    App.setBreadcrumb('<i class="fas fa-graduation-cap"></i> Academics');
    if (Auth.isStudent()) return _renderStudentView();
    if (Auth.isParent())  return _renderParentView();
    // Auto-select first accessible class/subject if defaults aren't in scope
    const accessibleClasses  = _getAccessibleClasses();
    const accessibleSubjects = _getAccessibleSubjects();
    if (accessibleClasses.length && !accessibleClasses.find(c => c.id === _selectedClass)) {
      _selectedClass  = accessibleClasses[0].id;
      _lpClass        = accessibleClasses[0].id;
      _rptClass       = accessibleClasses[0].id;
    }
    if (accessibleSubjects.length && !accessibleSubjects.find(s => s.id === _selectedSubject)) {
      _selectedSubject = accessibleSubjects[0].id;
      _lpSubject       = accessibleSubjects[0].id;
    }
    _renderMain();
  }

  /* ═══════════════════════════════════════════════════════════════
     MAIN SHELL (Admin / Teacher)
  ═══════════════════════════════════════════════════════════════ */
  function _renderMain() {
    const isAdmin   = Auth.isAdmin();
    const isTeacher = Auth.isTeacher();

    const tabs = [
      { id:'gradebook',    icon:'fas fa-table',            label:'Gradebook' },
      { id:'weights',      icon:'fas fa-balance-scale',    label:'Grade Weights',  adminOnly:false },
      { id:'scales',       icon:'fas fa-star-half-alt',    label:'Grade Scales',   adminOnly:false },
      { id:'analytics',    icon:'fas fa-chart-line',       label:'Analytics' },
      { id:'reports',      icon:'fas fa-file-alt',         label:'Reports' },
      { id:'lesson_plans', icon:'fas fa-book-open',        label:'Lesson Plans' },
    ].filter(t => !t.adminOnly || isAdmin);

    App.renderPage(`
    <div class="page-header">
      <div class="page-title"><h1>Academics</h1><p>Gradebook, grades, analytics &amp; reports</p></div>
    </div>
    <div class="ac-tab-nav" id="ac-tabs">
      ${tabs.map(t => `
        <button class="ac-tab-btn ${_tab===t.id?'active':''}" onclick="Academics.switchTab('${t.id}')">
          <i class="${t.icon}"></i> ${t.label}
        </button>`).join('')}
    </div>
    <div id="ac-panel"></div>
    `);

    _renderTab();
  }

  function switchTab(tab) {
    _tab = tab;
    document.querySelectorAll('.ac-tab-btn').forEach(b => {
      b.classList.toggle('active', !!b.getAttribute('onclick')?.includes(`'${tab}'`));
    });
    _renderTab();
  }

  function _renderTab() {
    const map = {
      gradebook:    _renderGradebook,
      weights:      _renderWeights,
      scales:       _renderScales,
      analytics:    _renderAnalytics,
      reports:      _renderReports,
      lesson_plans: _renderLessonPlans,
    };
    const fn = map[_tab];
    if (fn) fn();
  }

  /* ═══════════════════════════════════════════════════════════════
     TAB 1 — GRADEBOOK (Class Marksheet)
  ═══════════════════════════════════════════════════════════════ */
  function _renderGradebook() {
    const panel     = document.getElementById('ac-panel');
    if (!panel) return;

    const isAdmin   = Auth.isAdmin();
    const isTeacher = Auth.isTeacher();
    const canEdit   = isAdmin || isTeacher;

    const classes   = _getAccessibleClasses();
    const subjects  = _getAccessibleSubjects();
    const termOpts  = _termOptions(_selectedTerm);
    const students  = DB.query('students', s => s.classId === _selectedClass && s.status === 'active')
                        .sort((a,b) => a.lastName.localeCompare(b.lastName));

    const allGrades = DB.query('grades', g =>
      g.classId === _selectedClass && g.subjectId === _selectedSubject && g.termId === _selectedTerm);

    // Unique assessments (columns)
    const assessments = [...new Map(allGrades.map(g => [g.name, {name:g.name, type:g.type, maxScore:g.maxScore}])).values()];

    // Assessment types for weighted avg
    const atypes = DB.query('assessment_types', t => t.isActive).sort((a,b) => a.order - b.order);

    // Grade scale for this class
    const scale = _getScaleForClass(_selectedClass);

    // Marking progress
    const totalStudents = students.length;
    const progressData  = assessments.map(a => {
      const filled = allGrades.filter(g => g.name === a.name && g.score !== null).length;
      return { name:a.name, filled, total:totalStudents, pct: totalStudents ? Math.round(filled/totalStudents*100) : 0 };
    });

    const cls  = DB.getById('classes', _selectedClass);
    const subj = DB.getById('subjects', _selectedSubject);

    panel.innerHTML = `
    <div class="ac-toolbar">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select class="filter-select" onchange="Academics.selectClass(this.value)">
          ${classes.map(c=>`<option value="${c.id}" ${_selectedClass===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
        <select class="filter-select" onchange="Academics.selectSubject(this.value)">
          ${subjects.map(s=>`<option value="${s.id}" ${_selectedSubject===s.id?'selected':''}>${s.name}</option>`).join('')}
        </select>
        <select class="filter-select" onchange="Academics.selectTerm(this.value)">
          ${termOpts}
        </select>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${canEdit ? `
          <button class="btn btn-secondary" onclick="Academics.addAssessmentModal()"><i class="fas fa-plus"></i> Add Assessment</button>
          <button class="btn btn-primary" onclick="Academics.bulkEntryModal()"><i class="fas fa-keyboard"></i> Bulk Entry</button>
        ` : ''}
      </div>
    </div>

    ${progressData.length ? `
    <div class="ac-progress-section">
      <div class="ac-progress-label"><i class="fas fa-tasks"></i> Marking Progress</div>
      <div class="ac-progress-list">
        ${progressData.map(p=>`
          <div class="ac-progress-item">
            <span class="ac-progress-name">${p.name}</span>
            <div class="ac-progress-bar-wrap">
              <div class="ac-progress-bar" style="width:${p.pct}%;background:${p.pct===100?'var(--success)':p.pct>50?'var(--warning)':'var(--danger)'}"></div>
            </div>
            <span class="ac-progress-count ${p.pct===100?'done':''}">${p.filled}/${p.total}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="card mb-0">
      <div class="card-header">
        <div>
          <div class="card-title">${subj?.name||'Subject'} — ${cls?.name||'Class'}</div>
          <div class="card-subtitle">${_termLabel(_selectedTerm)} · ${students.length} students${scale?` · Scale: ${scale.name}`:''}</div>
        </div>
        ${assessments.length ? `<div style="font-size:12px;color:var(--gray-400)">${assessments.length} assessment${assessments.length!==1?'s':''}</div>` : ''}
      </div>
      <div class="table-wrap">
        <table class="ac-marksheet">
          <thead>
            <tr>
              <th class="ac-ms-student">Student</th>
              ${assessments.map(a=>{
                const at = atypes.find(t=>t.typeCodes.includes(a.type));
                return `<th class="ac-ms-score" title="${at?at.name:a.type}">
                  <span>${a.name}</span><br>
                  <small>${at?`<span class="ac-type-chip">${at.code}</span>`:a.type} /${a.maxScore}</small>
                </th>`;
              }).join('')}
              <th class="ac-ms-avg">Wt. Avg</th>
              <th class="ac-ms-grade">Grade</th>
              ${canEdit?`<th style="width:60px"></th>`:''}
            </tr>
          </thead>
          <tbody>
            ${students.length ? students.map(s=>{
              const sGrades  = allGrades.filter(g=>g.studentId===s.id);
              const wAvg     = _weightedAverage(sGrades, atypes);
              const gradeStr = wAvg !== null ? _applyScale(Math.round(wAvg), scale) : '—';
              const color    = wAvg !== null ? gradeColor(Math.round(wAvg)) : 'gray-400';
              return `<tr>
                <td class="ac-ms-student">
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="avatar-circle" style="background:${s.gender==='Female'?'#7C3AED':'#2563EB'};width:28px;height:28px;font-size:11px">${s.firstName.charAt(0)}</div>
                    <div><div style="font-weight:600;font-size:13px">${s.lastName}, ${s.firstName}</div></div>
                  </div>
                </td>
                ${assessments.map(a=>{
                  const g = sGrades.find(x=>x.name===a.name);
                  if (g && g.score !== null) {
                    return `<td class="ac-ms-score" style="text-align:center">
                      <span style="font-weight:700;color:var(--${gradeColor(g.percentage)})">${g.score}</span>
                      <span style="font-size:10px;color:var(--gray-400)">/${g.maxScore}</span>
                      ${canEdit?`<button class="ac-edit-btn" onclick="Academics.addGradeModal('${s.id}','${a.name}')"><i class="fas fa-pencil-alt"></i></button>`:''}
                    </td>`;
                  }
                  return `<td class="ac-ms-score" style="text-align:center">
                    ${canEdit?`<button class="btn btn-sm btn-outline" onclick="Academics.addGradeModal('${s.id}','${a.name}')"><i class="fas fa-plus"></i></button>`:'<span style="color:var(--gray-300)">—</span>'}
                  </td>`;
                }).join('')}
                <td class="ac-ms-avg" style="text-align:center;font-weight:800;font-size:14px;color:var(--${color})">
                  ${wAvg!==null?Math.round(wAvg)+'%':'—'}
                </td>
                <td class="ac-ms-grade" style="text-align:center">
                  <span class="grade-pill ${wAvg!==null?`grade-${gradeStr.charAt(0)}`:'grade-na'}">${gradeStr}</span>
                </td>
                ${canEdit?`<td><button class="btn btn-sm btn-ghost" onclick="Academics.addGradeModal('${s.id}')"><i class="fas fa-plus"></i></button></td>`:''}
              </tr>`;
            }).join('') : `<tr><td colspan="${assessments.length+4+canEdit}" class="ac-empty"><i class="fas fa-users-slash"></i><br>No students in this class</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Class Performance Distribution</div></div>
        <div class="chart-wrap"><canvas id="gbDistChart"></canvas></div>
      </div>
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Student Averages</div></div>
        <div class="chart-wrap"><canvas id="gbAvgChart"></canvas></div>
      </div>
    </div>
    `;

    setTimeout(() => _buildGradebookCharts(students, allGrades, atypes), 100);
  }

  function _buildGradebookCharts(students, allGrades, atypes) {
    const avgs = students.map(s => {
      const sg = allGrades.filter(g => g.studentId === s.id);
      const wa = _weightedAverage(sg, atypes);
      return { name: s.firstName, avg: wa !== null ? Math.round(wa) : 0 };
    });

    const avgCtx = document.getElementById('gbAvgChart');
    if (avgCtx) new Chart(avgCtx, {
      type:'bar',
      data:{ labels:avgs.map(a=>a.name), datasets:[{ label:'Weighted Avg %', data:avgs.map(a=>a.avg), backgroundColor:avgs.map(a=>a.avg>=90?'#059669':a.avg>=75?'#2563EB':a.avg>=60?'#D97706':'#DC2626'), borderRadius:4 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%'}}} }
    });

    const bands = ['A (≥80)','B+ (75-79)','B (70-74)','C (60-69)','D (50-59)','F (<50)'];
    const counts = [
      avgs.filter(a=>a.avg>=80).length,
      avgs.filter(a=>a.avg>=75&&a.avg<80).length,
      avgs.filter(a=>a.avg>=70&&a.avg<75).length,
      avgs.filter(a=>a.avg>=60&&a.avg<70).length,
      avgs.filter(a=>a.avg>=50&&a.avg<60).length,
      avgs.filter(a=>a.avg<50).length
    ];
    const distCtx = document.getElementById('gbDistChart');
    if (distCtx) new Chart(distCtx, {
      type:'doughnut',
      data:{ labels:bands, datasets:[{ data:counts, backgroundColor:['#059669','#10B981','#2563EB','#D97706','#F59E0B','#DC2626'], borderWidth:2, borderColor:'#fff' }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right',labels:{font:{size:11}}}} }
    });
  }

  /* ─── Add Assessment Modal ─── */
  function addAssessmentModal() {
    const atypes = DB.query('assessment_types', t=>t.isActive).sort((a,b)=>a.order-b.order);
    openModal(`
    <div class="modal-header"><h3><i class="fas fa-plus-circle"></i> Add Assessment Column</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Academics.saveAssessment(event)">
      <div class="form-field mb-12"><label>Assessment Name *</label><input name="name" required placeholder="e.g. Term 2 Exam, CAT 1, Quiz 3…"></div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Assessment Type</label>
          <select name="type">
            ${atypes.map(t=>t.typeCodes.map(tc=>`<option value="${tc}" data-label="${t.name}">${tc} (${t.name})</option>`).join('')).join('')}
            <option value="practical">practical</option>
          </select>
        </div>
        <div class="form-field"><label>Max Score</label><input type="number" name="maxScore" value="100" min="1"></div>
      </div>
      <div class="form-field mb-12"><label>Date</label><input type="date" name="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-plus"></i> Create for All Students</button>
      </div>
    </form>`, 'sm');
  }

  function saveAssessment(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const name = fd.get('name').trim();
    const type = fd.get('type');
    const max  = Number(fd.get('maxScore'));
    const date = fd.get('date');
    if (!name) return showToast('Assessment name required.', 'warning');
    // Check duplicate name
    const exists = DB.query('grades', g => g.classId===_selectedClass && g.subjectId===_selectedSubject && g.termId===_selectedTerm && g.name===name);
    if (exists.length) { showToast('An assessment with this name already exists.','warning'); return; }

    const students = DB.query('students', s => s.classId===_selectedClass && s.status==='active');
    students.forEach(s => {
      DB.insert('grades', { schoolId:'sch1', studentId:s.id, subjectId:_selectedSubject, classId:_selectedClass, termId:_selectedTerm, teacherId:Auth.currentUser?.id||'', type, name, maxScore:max, score:null, grade:'—', percentage:null, comments:'', date });
    });
    showToast(`"${name}" added for ${students.length} students.`, 'success');
    _closeModal(); _renderGradebook();
  }

  /* ─── Bulk Entry Modal ─── */
  function bulkEntryModal() {
    const allGrades  = DB.query('grades', g => g.classId===_selectedClass && g.subjectId===_selectedSubject && g.termId===_selectedTerm);
    const assessments= [...new Map(allGrades.map(g=>[g.name,{name:g.name,type:g.type,maxScore:g.maxScore}])).values()];
    if (!assessments.length) return showToast('No assessments yet. Add one first.', 'warning');
    const students   = DB.query('students', s=>s.classId===_selectedClass && s.status==='active').sort((a,b)=>a.lastName.localeCompare(b.lastName));

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-keyboard"></i> Bulk Score Entry</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <div class="form-field mb-12">
        <label>Assessment</label>
        <select id="bulk-assessment-sel" onchange="Academics._loadBulkTable()">
          ${assessments.map(a=>`<option value="${a.name}" data-max="${a.maxScore}">${a.name} (/${a.maxScore})</option>`).join('')}
        </select>
      </div>
      <div id="bulk-table-wrap"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Academics.saveBulkEntry()"><i class="fas fa-save"></i> Save All Scores</button>
      </div>
    </div>`, 'md');

    setTimeout(() => _loadBulkTable(), 80);
  }

  function _loadBulkTable() {
    const sel = document.getElementById('bulk-assessment-sel');
    if (!sel) return;
    const aName = sel.value;
    const maxScore = Number(sel.options[sel.selectedIndex].dataset.max) || 100;
    const students = DB.query('students', s=>s.classId===_selectedClass && s.status==='active').sort((a,b)=>a.lastName.localeCompare(b.lastName));
    const allGrades= DB.query('grades', g=>g.classId===_selectedClass && g.subjectId===_selectedSubject && g.termId===_selectedTerm && g.name===aName);
    const wrap = document.getElementById('bulk-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
    <table class="ac-bulk-table">
      <thead><tr><th>#</th><th>Student</th><th>Score (/${maxScore})</th><th>%</th></tr></thead>
      <tbody>
        ${students.map((s,i)=>{
          const g = allGrades.find(x=>x.studentId===s.id);
          const existing = g && g.score !== null ? g.score : '';
          return `<tr>
            <td style="font-size:12px;color:var(--gray-400)">${i+1}</td>
            <td><b>${s.lastName}</b>, ${s.firstName}</td>
            <td>
              <input type="number" class="bulk-score-inp" data-student="${s.id}" data-max="${maxScore}"
                min="0" max="${maxScore}" value="${existing}" placeholder="—"
                onchange="this.nextElementSibling.textContent=this.value?(Math.round(this.value/this.dataset.max*100)+'%'):'—'"
                style="width:80px;padding:4px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px">
            </td>
            <td style="font-size:12px;color:var(--gray-500);font-weight:600">${existing?Math.round(existing/maxScore*100)+'%':'—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  function saveBulkEntry() {
    const sel  = document.getElementById('bulk-assessment-sel');
    if (!sel) return;
    const aName    = sel.value;
    const inputs   = document.querySelectorAll('.bulk-score-inp');
    const allGrades= DB.query('grades', g=>g.classId===_selectedClass && g.subjectId===_selectedSubject && g.termId===_selectedTerm && g.name===aName);
    let saved = 0;
    inputs.forEach(inp => {
      const val = inp.value.trim();
      if (val === '') return;
      const score    = Number(val);
      const maxScore = Number(inp.dataset.max);
      const studentId= inp.dataset.student;
      if (isNaN(score) || score < 0 || score > maxScore) return;
      const pct  = Math.round(score/maxScore*100);
      const existing = allGrades.find(g=>g.studentId===studentId);
      if (existing) {
        DB.update('grades', existing.id, { score, percentage:pct });
      } else {
        // Find the grade record with score=null
        const placeholder = DB.query('grades', g=>g.studentId===studentId && g.classId===_selectedClass && g.subjectId===_selectedSubject && g.termId===_selectedTerm && g.name===aName)[0];
        if (placeholder) DB.update('grades', placeholder.id, { score, percentage:pct });
        else DB.insert('grades', { schoolId:'sch1', studentId, subjectId:_selectedSubject, classId:_selectedClass, termId:_selectedTerm, teacherId:Auth.currentUser?.id||'', type:'exam', name:aName, maxScore, score, grade:'', percentage:pct, comments:'', date:new Date().toISOString().split('T')[0] });
      }
      saved++;
    });
    showToast(`${saved} score${saved!==1?'s':''} saved.`, 'success');
    _closeModal(); _renderGradebook();
  }

  /* ─── Individual Grade Modal ─── */
  function addGradeModal(studentId, assessmentName) {
    const student  = DB.getById('students', studentId);
    const atypes   = DB.query('assessment_types', t=>t.isActive).sort((a,b)=>a.order-b.order);
    const existing = assessmentName
      ? DB.query('grades', g => g.studentId===studentId && g.name===assessmentName && g.classId===_selectedClass && g.subjectId===_selectedSubject && g.termId===_selectedTerm)[0]
      : null;

    const typeOptions = atypes.flatMap(t=>t.typeCodes.map(tc=>`<option value="${tc}" ${existing?.type===tc?'selected':''}>${tc} (${t.name})</option>`));
    typeOptions.push(`<option value="practical" ${existing?.type==='practical'?'selected':''}>practical</option>`);

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-graduation-cap"></i> ${existing&&existing.score!==null?'Edit':'Enter'} Score — ${student?.firstName} ${student?.lastName}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Academics.saveGrade(event,'${studentId}','${existing?.id||''}')">
      <div class="form-field mb-12"><label>Assessment Name *</label>
        <input name="name" required value="${existing?.name||assessmentName||''}">
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Type</label><select name="type">${typeOptions.join('')}</select></div>
        <div class="form-field"><label>Term</label>
          <select name="termId">${_termOptions(existing?.termId||_selectedTerm)}</select>
        </div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Score *</label>
          <input type="number" name="score" required min="0" value="${existing&&existing.score!==null?existing.score:''}" placeholder="e.g. 78">
        </div>
        <div class="form-field"><label>Max Score *</label>
          <input type="number" name="maxScore" required min="1" value="${existing?.maxScore||100}">
        </div>
      </div>
      <div class="form-field mb-12"><label>Date</label>
        <input type="date" name="date" value="${existing?.date||new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-field mb-12"><label>Teacher Comments</label>
        <textarea name="comments" rows="2" placeholder="Optional feedback…">${existing?.comments||''}</textarea>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        ${existing?.id?`<button type="button" class="btn btn-danger" onclick="Academics.deleteGrade('${existing.id}')"><i class="fas fa-trash"></i></button>`:''}
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Grade</button>
      </div>
    </form>`, 'sm');
  }

  function saveGrade(e, studentId, existingId) {
    e.preventDefault();
    const fd       = new FormData(e.target);
    const score    = Number(fd.get('score'));
    const maxScore = Number(fd.get('maxScore'));
    if (maxScore <= 0) return showToast('Max score must be > 0.', 'warning');
    const pct  = Math.round(score/maxScore*100);
    const scale= _getScaleForClass(_selectedClass);
    const data = {
      schoolId:'sch1', studentId, classId:_selectedClass,
      subjectId:_selectedSubject, termId:fd.get('termId'),
      teacherId:Auth.currentUser?.id||'',
      type:fd.get('type'), name:fd.get('name').trim(),
      maxScore, score, percentage:pct, grade:_applyScale(pct,scale)||'',
      comments:fd.get('comments'), date:fd.get('date')
    };
    if (existingId) { DB.update('grades', existingId, data); showToast('Grade updated.','success'); }
    else             { DB.insert('grades', data);             showToast('Grade saved.','success'); }
    _closeModal(); _renderGradebook();
  }

  function deleteGrade(id) {
    confirmAction('Delete this grade entry? This cannot be undone.', () => {
      DB.delete('grades', id);
      showToast('Grade deleted.','info');
      _closeModal(); _renderGradebook();
    });
  }

  function selectClass(id)   { _selectedClass   = id; _renderGradebook(); }
  function selectSubject(id) { _selectedSubject = id; _renderGradebook(); }
  function selectTerm(id)    { _selectedTerm    = id; _renderGradebook(); }

  /* ═══════════════════════════════════════════════════════════════
     TAB 2 — GRADE WEIGHTS (Assessment Types)
  ═══════════════════════════════════════════════════════════════ */
  function _renderWeights() {
    const panel  = document.getElementById('ac-panel');
    if (!panel) return;
    const isAdmin= Auth.isAdmin();
    const types  = DB.query('assessment_types', ()=>true).sort((a,b)=>a.order-b.order);
    const total  = types.filter(t=>t.isActive).reduce((s,t)=>s+t.weight, 0);

    panel.innerHTML = `
    <div class="ac-section-header">
      <div>
        <h3>Assessment Type Weights</h3>
        <p>Configure how each assessment category contributes to the final grade. Weights auto-normalize if some types are absent in a term.</p>
      </div>
      ${isAdmin?`<button class="btn btn-primary" onclick="Academics.addTypeModal()"><i class="fas fa-plus"></i> Add Type</button>`:''}
    </div>

    ${total!==100?`<div class="ac-warn-banner"><i class="fas fa-exclamation-triangle"></i> Active type weights sum to <b>${total}%</b> — they will be auto-normalized to 100% at grade calculation time.</div>`:''}

    <div class="ac-weight-grid">
      ${types.map(t=>`
        <div class="ac-weight-card ${!t.isActive?'ac-weight-inactive':''}">
          <div class="ac-weight-head">
            <div>
              <span class="ac-code-chip">${t.code}</span>
              <span class="ac-weight-name">${t.name}</span>
            </div>
            ${isAdmin?`<div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" onclick="Academics.editTypeModal('${t.id}')"><i class="fas fa-pencil-alt"></i></button>
              <button class="btn btn-sm btn-ghost danger" onclick="Academics.deleteType('${t.id}')"><i class="fas fa-trash"></i></button>
            </div>`:''}
          </div>
          <div class="ac-weight-bar-wrap">
            <div class="ac-weight-bar" style="width:${t.weight}%;background:${t.isActive?'var(--primary)':'var(--gray-200)'}"></div>
          </div>
          <div class="ac-weight-meta">
            <span class="ac-weight-pct">${t.weight}% weight</span>
            <span style="font-size:11px;color:var(--gray-400)">${t.typeCodes.join(', ')}</span>
            <span class="badge ${t.isActive?'badge-success':'badge-secondary'}">${t.isActive?'Active':'Inactive'}</span>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="card mt-16 mb-0" style="background:var(--gray-50)">
      <div class="card-header"><div class="card-title">How Weighted Averages Work</div></div>
      <div style="padding:0 20px 20px;font-size:13px;color:var(--gray-600);line-height:1.7">
        <p>Each assessment you create belongs to a <b>type</b> (e.g. "exam", "test"). The type maps to an <b>assessment category</b> above.</p>
        <p>For a student who has: an exam (82%) and a CAT (75%) but no homework recorded this term:<br>
        Normalized weights = EXAM: 60/(60+30)=67%, CAT: 30/(60+30)=33%<br>
        Weighted average = (82×67% + 75×33%) = <b>79.7%</b></p>
      </div>
    </div>
    `;
  }

  function addTypeModal(id) {
    const existing = id ? DB.getById('assessment_types', id) : null;
    openModal(`
    <div class="modal-header">
      <h3>${existing?'Edit':'Add'} Assessment Type</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Academics.saveType(event,'${id||''}')">
      <div class="form-row cols-2">
        <div class="form-field"><label>Display Name *</label><input name="name" required value="${existing?.name||''}" placeholder="e.g. Continuous Assessment Test"></div>
        <div class="form-field"><label>Short Code *</label><input name="code" required value="${existing?.code||''}" placeholder="e.g. CAT" style="text-transform:uppercase" maxlength="6"></div>
      </div>
      <div class="form-field mb-12">
        <label>Weight (%) *</label>
        <input type="number" name="weight" required min="1" max="100" value="${existing?.weight||30}" placeholder="e.g. 30">
      </div>
      <div class="form-field mb-12">
        <label>Grade Type Codes (comma-separated)</label>
        <input name="typeCodes" value="${existing?.typeCodes?.join(',')||''}" placeholder="e.g. test,quiz,cat">
        <small style="color:var(--gray-400)">Match the "type" field in grade entries. Examples: exam, test, quiz, homework, project, practical</small>
      </div>
      <div class="form-field mb-12">
        <label>Order</label>
        <input type="number" name="order" min="1" value="${existing?.order||1}">
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Status</label>
          <select name="isActive">
            <option value="true"  ${existing?.isActive!==false?'selected':''}>Active</option>
            <option value="false" ${existing?.isActive===false?'selected':''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save</button>
      </div>
    </form>`, 'sm');
  }

  function editTypeModal(id) { addTypeModal(id); }

  function saveType(e, existingId) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const data = {
      name: fd.get('name').trim(),
      code: fd.get('code').trim().toUpperCase(),
      weight: Number(fd.get('weight')),
      typeCodes: fd.get('typeCodes').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
      order: Number(fd.get('order')),
      isActive: fd.get('isActive') === 'true',
      schoolId: 'sch1'
    };
    if (!data.name || !data.code) return showToast('Name and code required.','warning');
    if (data.typeCodes.length === 0) return showToast('At least one type code required.','warning');
    if (existingId) { DB.update('assessment_types', existingId, data); showToast('Assessment type updated.','success'); }
    else            { DB.insert('assessment_types', data);              showToast('Assessment type added.','success'); }
    _closeModal(); _renderWeights();
  }

  function deleteType(id) {
    confirmAction('Delete this assessment type? Grade weights will recalculate without it.', () => {
      DB.delete('assessment_types', id);
      showToast('Assessment type deleted.','info');
      _renderWeights();
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     TAB 3 — GRADE SCALES
  ═══════════════════════════════════════════════════════════════ */
  function _renderScales() {
    const panel  = document.getElementById('ac-panel');
    if (!panel) return;
    const isAdmin= Auth.isAdmin();
    const scales = DB.get('grade_scales');

    panel.innerHTML = `
    <div class="ac-section-header">
      <div>
        <h3>Grade Scales</h3>
        <p>Define grading scales for different sections of the school. Each scale is assigned to specific grade levels.</p>
      </div>
      ${isAdmin?`<button class="btn btn-primary" onclick="Academics.addScaleModal()"><i class="fas fa-plus"></i> Add Scale</button>`:''}
    </div>

    <div class="ac-scales-grid">
      ${scales.map(sc=>`
      <div class="card mb-0">
        <div class="card-header">
          <div>
            <div class="card-title">${sc.name}</div>
            <div class="card-subtitle">Applies to: Grade${sc.applyToGrades.length>1?'s':''} ${sc.applyToGrades.join(', ')}</div>
          </div>
          ${isAdmin?`<div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-secondary" onclick="Academics.editScaleModal('${sc.id}')"><i class="fas fa-pencil-alt"></i> Edit</button>
            <button class="btn btn-sm btn-danger" onclick="Academics.deleteScale('${sc.id}')"><i class="fas fa-trash"></i></button>
          </div>`:''}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Grade</th><th>Range</th><th>Points</th><th>Remarks</th></tr></thead>
            <tbody>
              ${sc.ranges.map(r=>`<tr>
                <td><span class="grade-pill grade-${r.grade.charAt(0)}">${r.grade}</span></td>
                <td style="font-weight:600">${r.min}% – ${r.max}%</td>
                <td style="color:var(--gray-500)">${r.points}</td>
                <td style="color:var(--gray-500);font-size:12px">${r.remarks}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`).join('')}
    </div>

    ${scales.length===0?`<div class="empty-state"><i class="fas fa-star-half-alt"></i><h3>No grade scales defined</h3><p>Add your first grade scale to start grading students.</p></div>`:''}
    `;
  }

  function addScaleModal(id) {
    const existing = id ? DB.getById('grade_scales', id) : null;
    const defaultRanges = existing ? existing.ranges : [
      {min:90,max:100,grade:'A+',points:12,remarks:'Exceptional'},
      {min:80,max:89, grade:'A', points:11,remarks:'Excellent'},
      {min:70,max:79, grade:'B', points:9, remarks:'Good'},
      {min:60,max:69, grade:'C', points:7, remarks:'Average'},
      {min:50,max:59, grade:'D', points:5, remarks:'Pass'},
      {min:0, max:49, grade:'F', points:0, remarks:'Fail'}
    ];

    openModal(`
    <div class="modal-header">
      <h3>${existing?'Edit':'Add'} Grade Scale</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <form id="scale-form" onsubmit="Academics.saveScale(event,'${id||''}')">
        <div class="form-field mb-12"><label>Scale Name *</label><input name="scaleName" required value="${existing?.name||''}" placeholder="e.g. Upper School Scale"></div>
        <div class="form-field mb-16">
          <label>Apply to Grade Levels (comma-separated)</label>
          <input name="applyToGrades" value="${existing?.applyToGrades?.join(',')||''}" placeholder="e.g. 9,10,11,12">
        </div>
        <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--gray-700)">Grade Ranges</div>
        <div id="scale-ranges-wrap">
          ${defaultRanges.map((r,i)=>`
          <div class="ac-scale-range-row" data-idx="${i}">
            <input type="number" class="sr-min" placeholder="Min" min="0" max="100" value="${r.min}" style="width:60px">
            <span style="font-size:12px;color:var(--gray-400)">–</span>
            <input type="number" class="sr-max" placeholder="Max" min="0" max="100" value="${r.max}" style="width:60px">
            <input class="sr-grade" placeholder="Grade" value="${r.grade}" style="width:55px">
            <input type="number" class="sr-pts" placeholder="Pts" value="${r.points}" style="width:55px">
            <input class="sr-remarks" placeholder="Remarks" value="${r.remarks}" style="flex:1">
            <button type="button" class="btn btn-sm btn-ghost danger" onclick="this.closest('.ac-scale-range-row').remove()"><i class="fas fa-times"></i></button>
          </div>`).join('')}
        </div>
        <button type="button" class="btn btn-sm btn-secondary mt-8" onclick="Academics._addScaleRow()"><i class="fas fa-plus"></i> Add Row</button>
        <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
          <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Scale</button>
        </div>
      </form>
    </div>`, 'md');
  }

  function editScaleModal(id) { addScaleModal(id); }

  function _addScaleRow() {
    const wrap = document.getElementById('scale-ranges-wrap');
    if (!wrap) return;
    const row = document.createElement('div');
    row.className = 'ac-scale-range-row';
    row.innerHTML = `
      <input type="number" class="sr-min" placeholder="Min" min="0" max="100" value="0" style="width:60px">
      <span style="font-size:12px;color:var(--gray-400)">–</span>
      <input type="number" class="sr-max" placeholder="Max" min="0" max="100" value="0" style="width:60px">
      <input class="sr-grade" placeholder="Grade" style="width:55px">
      <input type="number" class="sr-pts" placeholder="Pts" style="width:55px">
      <input class="sr-remarks" placeholder="Remarks" style="flex:1">
      <button type="button" class="btn btn-sm btn-ghost danger" onclick="this.closest('.ac-scale-range-row').remove()"><i class="fas fa-times"></i></button>`;
    wrap.appendChild(row);
  }

  function saveScale(e, existingId) {
    e.preventDefault();
    const form   = e.target.closest('form') || e.target;
    const nameEl = form.querySelector('[name="scaleName"]');
    const gradesEl=form.querySelector('[name="applyToGrades"]');
    if (!nameEl?.value.trim()) return showToast('Scale name required.','warning');
    const applyToGrades = gradesEl?.value.split(',').map(s=>s.trim()).filter(Boolean) || [];
    const rows = document.querySelectorAll('.ac-scale-range-row');
    const ranges = Array.from(rows).map(row=>({
      min:   Number(row.querySelector('.sr-min')?.value||0),
      max:   Number(row.querySelector('.sr-max')?.value||0),
      grade: row.querySelector('.sr-grade')?.value.trim()||'',
      points:Number(row.querySelector('.sr-pts')?.value||0),
      remarks:row.querySelector('.sr-remarks')?.value.trim()||''
    })).filter(r=>r.grade);
    if (!ranges.length) return showToast('At least one grade range required.','warning');
    const data = { name:nameEl.value.trim(), applyToGrades, ranges, schoolId:'sch1' };
    if (existingId) { DB.update('grade_scales', existingId, data); showToast('Grade scale updated.','success'); }
    else            { DB.insert('grade_scales', data);              showToast('Grade scale created.','success'); }
    _closeModal(); _renderScales();
  }

  function deleteScale(id) {
    confirmAction('Delete this grade scale? Any classes assigned to it will fall back to the first available scale.', () => {
      DB.delete('grade_scales', id);
      showToast('Grade scale deleted.','info');
      _renderScales();
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     TAB 4 — ANALYTICS
  ═══════════════════════════════════════════════════════════════ */
  function _renderAnalytics() {
    const panel   = document.getElementById('ac-panel');
    if (!panel) return;
    const classes = _getAccessibleClasses();
    const atypes  = DB.query('assessment_types', t=>t.isActive);

    // Build summary stats across the accessible scope
    const grades  = DB.get('grades');
    const students= DB.get('students').filter(s=>s.status==='active');

    // Term comparison data
    const terms = ['term1','term2','term3'];
    const termAvgs = terms.map(t => {
      const tGrades = grades.filter(g=>g.termId===t && g.percentage!==null);
      return tGrades.length ? Math.round(tGrades.reduce((s,g)=>s+g.percentage,0)/tGrades.length) : 0;
    });

    // Subject difficulty (average % per subject)
    const subjects = DB.get('subjects');
    const subjAvgs = subjects.map(subj => {
      const sg = grades.filter(g=>g.subjectId===subj.id && g.percentage!==null);
      return { name:subj.code||subj.name, avg:sg.length?Math.round(sg.reduce((s,g)=>s+g.percentage,0)/sg.length):0 };
    }).filter(s=>s.avg>0).sort((a,b)=>a.avg-b.avg);

    // Top 5 students
    const studentAvgs = students.map(s=>{
      const sg=grades.filter(g=>g.studentId===s.id&&g.percentage!==null);
      return { name:`${s.firstName} ${s.lastName}`, cls:DB.getById('classes',s.classId)?.name||'', avg:sg.length?Math.round(sg.reduce((t,g)=>t+g.percentage,0)/sg.length):0 };
    }).sort((a,b)=>b.avg-a.avg);

    const top5   = studentAvgs.slice(0,5);
    const bottom5= [...studentAvgs].reverse().slice(0,5);

    panel.innerHTML = `
    <div class="ac-section-header">
      <div><h3>Analytics &amp; Insights</h3><p>School-wide academic performance overview</p></div>
    </div>

    <div class="ac-analytics-grid">
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Average Score by Term</div></div>
        <div class="chart-wrap"><canvas id="analTermChart"></canvas></div>
      </div>
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Subject Difficulty (Avg %)</div></div>
        <div class="chart-wrap"><canvas id="analSubjChart"></canvas></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="card mb-0">
        <div class="card-header"><div class="card-title"><i class="fas fa-trophy" style="color:#D97706"></i> Top Performers</div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Average</th></tr></thead>
          <tbody>${top5.map((s,i)=>`<tr>
            <td style="font-weight:700;color:var(--gray-400)">${i+1}</td>
            <td style="font-weight:600">${s.name}</td>
            <td><span class="badge badge-primary">${s.cls}</span></td>
            <td><span style="font-weight:800;color:var(--${gradeColor(s.avg)})">${s.avg}%</span></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card mb-0">
        <div class="card-header"><div class="card-title"><i class="fas fa-exclamation-circle" style="color:#DC2626"></i> Needs Attention</div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Average</th></tr></thead>
          <tbody>${bottom5.map((s,i)=>`<tr>
            <td style="font-weight:700;color:var(--gray-400)">${i+1}</td>
            <td style="font-weight:600">${s.name}</td>
            <td><span class="badge badge-secondary">${s.cls}</span></td>
            <td><span style="font-weight:800;color:var(--${gradeColor(s.avg)})">${s.avg}%</span></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card mt-16 mb-0">
      <div class="card-header"><div class="card-title">Assessment Type Contribution Overview</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>Grades Entered</th><th>Avg Score</th><th>Configured Weight</th></tr></thead>
        <tbody>
          ${atypes.map(at=>{
            const matchGrades = grades.filter(g=>at.typeCodes.includes(g.type)&&g.percentage!==null);
            const avg = matchGrades.length ? Math.round(matchGrades.reduce((s,g)=>s+g.percentage,0)/matchGrades.length) : null;
            return `<tr>
              <td><span class="ac-code-chip">${at.code}</span> ${at.name}</td>
              <td>${matchGrades.length}</td>
              <td>${avg!==null?`<span style="font-weight:700;color:var(--${gradeColor(avg)})">${avg}%</span>`:'—'}</td>
              <td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;background:var(--gray-100);border-radius:3px"><div style="width:${at.weight}%;height:6px;background:var(--primary);border-radius:3px"></div></div><span style="font-size:12px;font-weight:700">${at.weight}%</span></div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>
    `;

    setTimeout(() => {
      const termCtx = document.getElementById('analTermChart');
      if (termCtx) new Chart(termCtx, {
        type:'line',
        data:{ labels:['Term 1','Term 2','Term 3'], datasets:[{ label:'School Avg %', data:termAvgs, borderColor:'#2563EB', backgroundColor:'rgba(37,99,235,.1)', fill:true, tension:.4, pointRadius:5, pointBackgroundColor:'#2563EB' }] },
        options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%'}}} }
      });
      const subjCtx = document.getElementById('analSubjChart');
      if (subjCtx) new Chart(subjCtx, {
        type:'bar',
        data:{ labels:subjAvgs.map(s=>s.name), datasets:[{ label:'Avg %', data:subjAvgs.map(s=>s.avg), backgroundColor:subjAvgs.map(s=>s.avg>=75?'#059669':s.avg>=60?'#D97706':'#DC2626'), borderRadius:4 }] },
        options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{min:0,max:100,ticks:{callback:v=>v+'%'}}} }
      });
    }, 100);
  }

  /* ═══════════════════════════════════════════════════════════════
     TAB 5 — REPORTS
  ═══════════════════════════════════════════════════════════════ */
  function _renderReports() {
    const panel   = document.getElementById('ac-panel');
    if (!panel) return;
    const isAdmin = Auth.isAdmin();
    const isTeacher=Auth.isTeacher();
    const classes = _getAccessibleClasses();
    const termOpts= _termOptions(_rptTerm);
    const students= DB.query('students', s=>s.classId===_rptClass && s.status==='active').sort((a,b)=>a.lastName.localeCompare(b.lastName));
    const atypes  = DB.query('assessment_types', t=>t.isActive);
    const scale   = _getScaleForClass(_rptClass);

    const reportCards = DB.query('report_cards', rc=>rc.classId===_rptClass && rc.termId===_rptTerm);
    const getRC = (stuId) => reportCards.find(rc=>rc.studentId===stuId)||null;

    panel.innerHTML = `
    <div class="ac-toolbar">
      <div style="display:flex;gap:10px;align-items:center">
        <select class="filter-select" onchange="Academics.selectRptClass(this.value)">
          ${classes.map(c=>`<option value="${c.id}" ${_rptClass===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
        <select class="filter-select" onchange="Academics.selectRptTerm(this.value)">
          ${termOpts}
        </select>
      </div>
      <div style="display:flex;gap:8px">
        ${isAdmin?`<button class="btn btn-primary" onclick="Academics.publishAllModal()"><i class="fas fa-globe"></i> Publish All</button>`:''}
      </div>
    </div>

    <div class="card mb-0">
      <div class="card-header">
        <div class="card-title">Report Cards — ${DB.getById('classes',_rptClass)?.name} · ${_termLabel(_rptTerm)}</div>
        <div style="font-size:12px;color:var(--gray-400)">${students.length} students</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th style="text-align:center">Avg</th>
              <th style="text-align:center">Grade</th>
              <th>Subject Comments</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${students.length ? students.map(stu=>{
              const grades    = DB.query('grades', g=>g.studentId===stu.id && g.termId===_rptTerm);
              const bySubj    = {};
              grades.forEach(g=>{ if(!bySubj[g.subjectId])bySubj[g.subjectId]=[]; bySubj[g.subjectId].push(g); });
              const subjAvgs  = Object.keys(bySubj).map(sid=>({sid, avg:_weightedSubjAvg(bySubj[sid],atypes)})).filter(r=>r.avg!==null);
              const overall   = subjAvgs.length ? Math.round(subjAvgs.reduce((s,r)=>s+(r.avg||0),0)/subjAvgs.length) : null;
              const rc        = getRC(stu.id);
              const status    = rc?.status||'draft';
              const commentCt = DB.query('subject_comments', c=>c.studentId===stu.id&&c.termId===_rptTerm).length;
              const statusBadges = { draft:'badge-secondary', published:'badge-success', restricted:'badge-danger' };
              return `<tr>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="avatar-circle" style="background:${stu.gender==='Female'?'#7C3AED':'#2563EB'};width:28px;height:28px;font-size:11px">${stu.firstName.charAt(0)}</div>
                    <span style="font-weight:600;font-size:13px">${stu.lastName}, ${stu.firstName}</span>
                  </div>
                </td>
                <td style="text-align:center;font-weight:700;color:var(--${overall!==null?gradeColor(overall):'gray-400'})">${overall!==null?overall+'%':'—'}</td>
                <td style="text-align:center">
                  <span class="grade-pill ${overall!==null?`grade-${(_applyScale(overall,scale)||'F').charAt(0)}`:'grade-na'}">${overall!==null?(_applyScale(overall,scale)||'—'):'—'}</span>
                </td>
                <td style="font-size:12px;color:var(--gray-500)">${commentCt} comment${commentCt!==1?'s':''}</td>
                <td><span class="badge ${statusBadges[status]||'badge-secondary'}">${status}</span></td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-sm btn-primary" onclick="Academics.editReportCard('${stu.id}')"><i class="fas fa-edit"></i> Edit</button>
                    <button class="btn btn-sm btn-secondary" onclick="Academics.viewReportCard('${stu.id}')"><i class="fas fa-eye"></i></button>
                  </div>
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="6"><div class="empty-state" style="padding:30px"><i class="fas fa-user-graduate"></i><h3>No students</h3></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function selectRptClass(id) { _rptClass = id; _renderReports(); }
  function selectRptTerm(id)  { _rptTerm  = id; _renderReports(); }

  /* ─── Edit Report Card Modal (comments + publish) ─── */
  function editReportCard(studentId) {
    const stu     = DB.getById('students', studentId);
    const grades  = DB.query('grades', g=>g.studentId===studentId && g.termId===_rptTerm);
    const atypes  = DB.query('assessment_types', t=>t.isActive);
    const scale   = _getScaleForClass(_rptClass);
    const rc      = DB.query('report_cards', r=>r.studentId===studentId && r.termId===_rptTerm && r.classId===_rptClass)[0];

    // Build per-subject rows
    const bySubj = {};
    grades.forEach(g=>{ if(!bySubj[g.subjectId])bySubj[g.subjectId]=[]; bySubj[g.subjectId].push(g); });
    const subjRows = Object.keys(bySubj).map(sid=>{
      const subj = DB.getById('subjects',sid);
      const avg  = _weightedSubjAvg(bySubj[sid],atypes);
      const comm = DB.query('subject_comments', c=>c.studentId===studentId && c.subjectId===sid && c.termId===_rptTerm)[0];
      return { sid, name:subj?.name||'Unknown', avg, comment:comm?.comment||'', commentId:comm?.id||'' };
    });

    const overall   = subjRows.length ? Math.round(subjRows.filter(r=>r.avg!==null).reduce((s,r)=>s+(r.avg||0),0)/subjRows.filter(r=>r.avg!==null).length) : null;
    const isAdmin   = Auth.isAdmin();
    const isTeacher = Auth.isTeacher();

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-edit"></i> Report Card — ${stu?.firstName} ${stu?.lastName}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <div class="ac-rc-meta">
        <div>Overall: <b style="color:var(--${overall!==null?gradeColor(overall):'gray-400'})">${overall!==null?overall+'%':'—'}</b></div>
        <div>Grade: <span class="grade-pill ${overall!==null?`grade-${(_applyScale(overall,scale)||'F').charAt(0)}`:'grade-na'}">${overall!==null?_applyScale(overall,scale)||'—':'—'}</span></div>
        <div>Status: <span class="badge ${rc?.status==='published'?'badge-success':rc?.status==='restricted'?'badge-danger':'badge-secondary'}">${rc?.status||'draft'}</span></div>
      </div>

      <div style="font-weight:600;font-size:13px;margin:16px 0 8px;color:var(--gray-700)">Subject Comments (by Subject Teacher)</div>
      ${subjRows.map(r=>`
      <div class="ac-subj-comment-row">
        <div class="ac-subj-comment-label">
          <span style="font-weight:600">${r.name}</span>
          ${r.avg!==null?`<span style="color:var(--${gradeColor(Math.round(r.avg))})">${Math.round(r.avg)}%</span>`:''}
        </div>
        <textarea class="ac-subj-comment-inp" data-subject="${r.sid}" data-comment-id="${r.commentId}"
          rows="2" placeholder="Subject teacher comment (optional)…"
          ${!isTeacher && !isAdmin?'readonly':''} >${r.comment}</textarea>
      </div>`).join('')}

      <div style="font-weight:600;font-size:13px;margin:16px 0 8px;color:var(--gray-700)">Class Teacher's Overall Remark</div>
      <textarea id="class-teacher-remark" rows="3" class="ac-remark-inp"
        placeholder="Class teacher's overall remark (leave blank to omit from report)…"
        ${!isAdmin?'readonly':''} >${rc?.classTeacherRemark||''}</textarea>

      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:20px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="Academics.saveReportCard('${studentId}')"><i class="fas fa-save"></i> Save Comments</button>
          <button class="btn btn-secondary" onclick="Academics.viewReportCard('${studentId}')"><i class="fas fa-eye"></i> Preview</button>
          ${isAdmin?`<button class="btn btn-success" onclick="Academics.publishOne('${studentId}',false)"><i class="fas fa-globe"></i> Publish</button>`:''}
        </div>
      </div>
    </div>`, 'lg');
  }

  function saveReportCard(studentId) {
    const commentInputs = document.querySelectorAll('.ac-subj-comment-inp');
    commentInputs.forEach(inp => {
      const subjectId = inp.dataset.subject;
      const commentId = inp.dataset.commentId;
      const comment   = inp.value.trim();
      if (!comment) {
        if (commentId) DB.delete('subject_comments', commentId);
        return;
      }
      const data = { schoolId:'sch1', studentId, subjectId, termId:_rptTerm, classId:_rptClass, teacherId:Auth.currentUser?.id||'', comment };
      if (commentId) { DB.update('subject_comments', commentId, data); inp.dataset.commentId = commentId; }
      else {
        const rec = DB.insert('subject_comments', data);
        inp.dataset.commentId = rec.id;
      }
    });

    const remark = document.getElementById('class-teacher-remark')?.value.trim()||'';
    let rc = DB.query('report_cards', r=>r.studentId===studentId && r.termId===_rptTerm && r.classId===_rptClass)[0];
    if (rc) DB.update('report_cards', rc.id, { classTeacherRemark:remark });
    else    DB.insert('report_cards', { schoolId:'sch1', studentId, classId:_rptClass, termId:_rptTerm, academicYearId:_rptYear, status:'draft', classTeacherRemark:remark });

    showToast('Report card comments saved.', 'success');
    _renderReports();
  }

  /* ─── Publish All Modal ─── */
  function publishAllModal() {
    openModal(`
    <div class="modal-header"><h3><i class="fas fa-globe"></i> Publish Reports — ${DB.getById('classes',_rptClass)?.name}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--gray-600);margin-bottom:16px">
        Publishing makes report cards visible on the student and parent dashboard for <b>${_termLabel(_rptTerm)}</b>.
      </p>
      <div class="form-field mb-16">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="fee-restrict-chk" style="width:16px;height:16px">
          <span><b>Restrict access for students with outstanding fee balance</b><br><small style="color:var(--gray-400)">Students with an unpaid invoice will see "Report locked — please clear fees" instead of grades.</small></span>
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="Academics.publishAll()"><i class="fas fa-globe"></i> Publish All Reports</button>
      </div>
    </div>`, 'sm');
  }

  function publishAll() {
    const feeRestrict = document.getElementById('fee-restrict-chk')?.checked || false;
    const students    = DB.query('students', s=>s.classId===_rptClass && s.status==='active');
    let published = 0, restricted = 0;
    students.forEach(stu => {
      const status = feeRestrict ? _checkFeeStatus(stu.id) : 'published';
      publishOne(stu.id, feeRestrict, true);
      if (status === 'restricted') restricted++; else published++;
    });
    showToast(`${published} published, ${restricted} restricted (fee balance).`, 'success');
    _closeModal(); _renderReports();
  }

  function publishOne(studentId, feeRestrict, silent) {
    const status = feeRestrict ? _checkFeeStatus(studentId) : 'published';
    const atypes = DB.query('assessment_types', t=>t.isActive);
    const scale  = _getScaleForClass(_rptClass);
    const grades = DB.query('grades', g=>g.studentId===studentId && g.termId===_rptTerm);
    const bySubj = {};
    grades.forEach(g=>{ if(!bySubj[g.subjectId])bySubj[g.subjectId]=[]; bySubj[g.subjectId].push(g); });
    const subjAvgs  = Object.keys(bySubj).map(sid=>({ sid, avg:_weightedSubjAvg(bySubj[sid],atypes) })).filter(r=>r.avg!==null);
    const overall   = subjAvgs.length ? Math.round(subjAvgs.reduce((s,r)=>s+(r.avg||0),0)/subjAvgs.length) : null;
    const overallGrade = overall !== null ? _applyScale(overall, scale)||'' : '';
    const rc = DB.query('report_cards', r=>r.studentId===studentId && r.termId===_rptTerm && r.classId===_rptClass)[0];
    const data = { studentId, classId:_rptClass, termId:_rptTerm, academicYearId:_rptYear, schoolId:'sch1', status, publishedAt:new Date().toISOString(), overallAverage:overall, overallGrade, subjectAverages:bySubj };
    if (rc) DB.update('report_cards', rc.id, data);
    else    DB.insert('report_cards', data);
    if (!silent) { showToast(`Report ${status==='restricted'?'restricted (fee balance)':'published'}.`, 'success'); _closeModal(); _renderReports(); }
  }

  /* ─── View / Print Report Card ─── */
  function viewReportCard(studentId) {
    const html = _buildReportCardHTML(studentId, _rptTerm, _rptClass);
    openModal(html, 'lg');
  }

  function _buildReportCardHTML(studentId, termId, classId) {
    const stu     = DB.getById('students', studentId);
    const cls     = DB.getById('classes', classId);
    const school  = Auth.currentSchool || DB.get('schools')[0];
    const atypes  = DB.query('assessment_types', t=>t.isActive);
    const scale   = _getScaleForClass(classId);
    const grades  = DB.query('grades', g=>g.studentId===studentId && g.termId===termId);
    const bySubj  = {};
    grades.forEach(g=>{ if(!bySubj[g.subjectId])bySubj[g.subjectId]=[]; bySubj[g.subjectId].push(g); });
    const rc      = DB.query('report_cards', r=>r.studentId===studentId && r.termId===termId)[0];

    const rows = Object.keys(bySubj).map(sid=>{
      const subj  = DB.getById('subjects',sid);
      const avg   = _weightedSubjAvg(bySubj[sid],atypes);
      const grade = avg!==null ? _applyScale(Math.round(avg),scale)||'—' : '—';
      const comm  = DB.query('subject_comments', c=>c.studentId===studentId && c.subjectId===sid && c.termId===termId)[0];
      return { subj, avg:avg!==null?Math.round(avg):null, grade, comment:comm?.comment||'' };
    });

    const overall = rows.filter(r=>r.avg!==null).length ? Math.round(rows.filter(r=>r.avg!==null).reduce((s,r)=>s+r.avg,0)/rows.filter(r=>r.avg!==null).length) : 0;
    const overallGrade = _applyScale(overall, scale)||'—';

    return `
    <div class="modal-header">
      <h3>Report Card — ${_termLabel(termId)}</h3>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
        <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
      </div>
    </div>
    <div class="modal-body" id="rc-print-area">
      <div class="ac-rc-header">
        <div style="font-size:22px;font-weight:800;color:var(--primary)">${school?.name||'InnoLearn International School'}</div>
        <div style="font-size:12px;color:var(--gray-400)">${school?.address||''}</div>
        <div style="font-size:15px;font-weight:700;margin-top:8px;letter-spacing:.5px">STUDENT REPORT CARD</div>
        <div style="font-size:12px;color:var(--gray-500)">${_termLabel(termId)} · ${DB.get('academicYears').find(y=>y.id===_rptYear)?.name||'2024–2025'}</div>
      </div>

      <div class="ac-rc-student-meta">
        <div>
          ${[['Name',`${stu?.firstName} ${stu?.lastName}`],['Admission No.',stu?.admissionNo||'—'],['Class',cls?.name||'—'],['Date of Birth',fmtDate(stu?.dateOfBirth)]].map(([l,v])=>`
          <div class="ac-rc-meta-row"><span>${l}</span><b>${v}</b></div>`).join('')}
        </div>
        <div class="ac-rc-overall-box">
          <div style="font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:.5px">Overall</div>
          <div style="font-size:46px;font-weight:900;line-height:1">${overall}%</div>
          <div style="font-size:22px;font-weight:700">${overallGrade}</div>
          <div style="font-size:11px;opacity:.8;margin-top:4px">${overall>=90?'Exceptional':overall>=75?'Excellent':overall>=60?'Good':'Needs Improvement'}</div>
        </div>
      </div>

      <table class="ac-rc-table">
        <thead><tr>
          <th>Subject</th><th style="text-align:center">Avg</th><th style="text-align:center">Grade</th>
          <th style="text-align:center">Remarks</th><th>Teacher Comment</th>
        </tr></thead>
        <tbody>
          ${rows.map((r,i)=>`<tr style="background:${i%2===0?'#fff':'var(--gray-50)'}">
            <td style="font-weight:600">${r.subj?.name||'—'}</td>
            <td style="text-align:center;font-weight:700;color:var(--${r.avg!==null?gradeColor(r.avg):'gray-400'})">${r.avg!==null?r.avg+'%':'—'}</td>
            <td style="text-align:center"><span class="grade-pill grade-${(r.grade||'F').charAt(0)}">${r.grade}</span></td>
            <td style="text-align:center;font-size:12px;color:var(--gray-500)">${r.avg!==null?_scaleRemarks(r.avg,scale):'—'}</td>
            <td style="font-size:12px;color:var(--gray-600);font-style:${r.comment?'normal':'italic'}">${r.comment||'—'}</td>
          </tr>`).join('')||`<tr><td colspan="5" style="text-align:center;color:var(--gray-300);padding:20px">No grades recorded for this term</td></tr>`}
        </tbody>
      </table>

      ${rc?.classTeacherRemark?`
      <div class="ac-rc-remarks-section">
        <div class="ac-rc-remark-box">
          <div class="ac-rc-remark-label">Class Teacher's Remarks</div>
          <div class="ac-rc-remark-text">${rc.classTeacherRemark}</div>
          <div class="ac-rc-sig">Signature: _____________________</div>
        </div>
      </div>`:''}

      <div class="ac-rc-footer">Generated by InnoLearn · ${fmtDate(new Date().toISOString())} · ${school?.name}</div>
    </div>`;
  }

  // Old compat alias
  function generateReportCards() {
    _tab = 'reports';
    _renderReports();
  }

  /* ═══════════════════════════════════════════════════════════════
     TAB 6 — LESSON PLANS
  ═══════════════════════════════════════════════════════════════ */
  function _renderLessonPlans() {
    const panel   = document.getElementById('ac-panel');
    if (!panel) return;
    const isAdmin = Auth.isAdmin();
    const isTeacher=Auth.isTeacher();
    const canEdit = isAdmin || isTeacher;
    const classes = _getAccessibleClasses();
    const subjects= _getAccessibleSubjects();
    const termOpts= _termOptions(_lpTerm);
    const years   = DB.get('academicYears');

    const plans = DB.query('lesson_plans', p=>p.classId===_lpClass && p.subjectId===_lpSubject && p.termId===_lpTerm && p.academicYearId===_lpYear)
                    .sort((a,b)=>a.week-b.week);

    const total     = plans.length;
    const completed = plans.filter(p=>p.status==='completed').length;
    const inProg    = plans.filter(p=>p.status==='in_progress').length;
    const coverage  = total ? Math.round(completed/total*100) : 0;

    panel.innerHTML = `
    <div class="ac-toolbar">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select class="filter-select" onchange="Academics.selectLPClass(this.value)">
          ${classes.map(c=>`<option value="${c.id}" ${_lpClass===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
        <select class="filter-select" onchange="Academics.selectLPSubject(this.value)">
          ${subjects.map(s=>`<option value="${s.id}" ${_lpSubject===s.id?'selected':''}>${s.name}</option>`).join('')}
        </select>
        <select class="filter-select" onchange="Academics.selectLPTerm(this.value)">
          ${termOpts}
        </select>
        <select class="filter-select" onchange="Academics.selectLPYear(this.value)">
          ${years.map(y=>`<option value="${y.id}" ${_lpYear===y.id?'selected':''}>${y.name}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:8px">
        ${canEdit?`
          <button class="btn btn-secondary" onclick="Academics.copyPlanModal()"><i class="fas fa-copy"></i> Copy to Term/Year</button>
          <button class="btn btn-primary" onclick="Academics.addTopicModal()"><i class="fas fa-plus"></i> Add Topic</button>
        `:''}
      </div>
    </div>

    ${total ? `
    <div class="ac-lp-progress-bar-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;font-weight:600;color:var(--gray-700)">Scheme Coverage</span>
        <span style="font-size:13px;font-weight:700;color:var(--${coverage===100?'success':'primary'})">${coverage}% (${completed}/${total} completed)</span>
      </div>
      <div class="ac-lp-bar-track">
        <div class="ac-lp-bar-fill" style="width:${coverage}%;background:${coverage===100?'var(--success)':'var(--primary)'}"></div>
      </div>
      <div style="display:flex;gap:16px;margin-top:6px;font-size:12px">
        <span style="color:var(--success)">● Completed: ${completed}</span>
        <span style="color:var(--warning)">● In Progress: ${inProg}</span>
        <span style="color:var(--gray-400)">● Planned: ${total-completed-inProg}</span>
      </div>
    </div>` : ''}

    <div class="card mb-0">
      <div class="card-header">
        <div class="card-title">${DB.getById('subjects',_lpSubject)?.name||'Subject'} — ${DB.getById('classes',_lpClass)?.name||'Class'} · ${_termLabel(_lpTerm)}</div>
      </div>
      <div class="table-wrap">
        <table class="ac-lp-table">
          <thead>
            <tr>
              <th style="width:60px">Week</th>
              <th>Topic</th>
              <th>Chapter/Unit</th>
              <th>Objectives</th>
              <th>Materials</th>
              <th>Status</th>
              ${canEdit?`<th style="width:80px">Actions</th>`:''}
            </tr>
          </thead>
          <tbody>
            ${plans.length ? plans.map(p=>{
              const statusColors = { completed:'success', in_progress:'warning', planned:'secondary' };
              const statusLabels = { completed:'Completed', in_progress:'In Progress', planned:'Planned' };
              return `<tr class="ac-lp-row ac-lp-${p.status}">
                <td style="text-align:center;font-weight:700;font-size:14px">Wk ${p.week}</td>
                <td style="font-weight:600">${p.topic}</td>
                <td style="color:var(--gray-500);font-size:12px">${p.chapter||'—'}</td>
                <td style="font-size:12px;color:var(--gray-600);max-width:200px">${p.objectives||'—'}</td>
                <td style="font-size:12px;color:var(--gray-500)">${p.materials||'—'}</td>
                <td><span class="badge badge-${statusColors[p.status]||'secondary'}">${statusLabels[p.status]||p.status}</span></td>
                ${canEdit?`<td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-sm btn-ghost" onclick="Academics.editTopicModal('${p.id}')"><i class="fas fa-pencil-alt"></i></button>
                    <button class="btn btn-sm btn-ghost danger" onclick="Academics.deleteTopic('${p.id}')"><i class="fas fa-trash"></i></button>
                  </div>
                </td>`:''}
              </tr>`;
            }).join('') : `<tr><td colspan="${canEdit?7:6}" class="ac-empty"><i class="fas fa-book-open"></i><br>No topics added yet<br><small style="color:var(--gray-300)">Use "Add Topic" to build your scheme of work</small></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    `;
  }

  function selectLPClass(id)   { _lpClass   = id; _renderLessonPlans(); }
  function selectLPSubject(id) { _lpSubject = id; _renderLessonPlans(); }
  function selectLPTerm(id)    { _lpTerm    = id; _renderLessonPlans(); }
  function selectLPYear(id)    { _lpYear    = id; _renderLessonPlans(); }

  function addTopicModal(id) {
    const existing = id ? DB.getById('lesson_plans', id) : null;
    const classes  = _getAccessibleClasses();
    const subjects = _getAccessibleSubjects();
    const years    = DB.get('academicYears');

    openModal(`
    <div class="modal-header">
      <h3>${existing?'Edit':'Add'} Lesson Topic</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Academics.saveTopic(event,'${id||''}')">
      <div class="form-row cols-3">
        <div class="form-field"><label>Class *</label>
          <select name="classId">
            ${classes.map(c=>`<option value="${c.id}" ${(existing?.classId||_lpClass)===c.id?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Subject *</label>
          <select name="subjectId">
            ${subjects.map(s=>`<option value="${s.id}" ${(existing?.subjectId||_lpSubject)===s.id?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Week No. *</label>
          <input type="number" name="week" required min="1" max="16" value="${existing?.week||plans_nextWeek()}">
        </div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Term</label>
          <select name="termId">${_termOptions(existing?.termId||_lpTerm)}</select>
        </div>
        <div class="form-field"><label>Academic Year</label>
          <select name="academicYearId">
            ${years.map(y=>`<option value="${y.id}" ${(existing?.academicYearId||_lpYear)===y.id?'selected':''}>${y.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-field mb-12"><label>Topic Title *</label>
        <input name="topic" required value="${existing?.topic||''}" placeholder="e.g. Introduction to Photosynthesis">
      </div>
      <div class="form-field mb-12"><label>Chapter / Unit</label>
        <input name="chapter" value="${existing?.chapter||''}" placeholder="e.g. Chapter 4">
      </div>
      <div class="form-field mb-12"><label>Learning Objectives</label>
        <textarea name="objectives" rows="2" placeholder="What students will be able to do after this lesson…">${existing?.objectives||''}</textarea>
      </div>
      <div class="form-field mb-12"><label>Teaching Materials & Resources</label>
        <input name="materials" value="${existing?.materials||''}" placeholder="e.g. Textbook Ch.4, lab equipment, worksheet">
      </div>
      <div class="form-field mb-12"><label>Status</label>
        <select name="status">
          <option value="planned" ${(existing?.status||'planned')==='planned'?'selected':''}>Planned</option>
          <option value="in_progress" ${existing?.status==='in_progress'?'selected':''}>In Progress</option>
          <option value="completed" ${existing?.status==='completed'?'selected':''}>Completed</option>
        </select>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Topic</button>
      </div>
    </form>`, 'md');
  }

  function plans_nextWeek() {
    const existing = DB.query('lesson_plans', p=>p.classId===_lpClass&&p.subjectId===_lpSubject&&p.termId===_lpTerm&&p.academicYearId===_lpYear);
    return existing.length ? Math.max(...existing.map(p=>p.week))+1 : 1;
  }

  function editTopicModal(id) { addTopicModal(id); }

  function saveTopic(e, existingId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      schoolId:'sch1', teacherId:Auth.currentUser?.id||'',
      classId: fd.get('classId'), subjectId:fd.get('subjectId'),
      termId: fd.get('termId'), academicYearId:fd.get('academicYearId'),
      week: Number(fd.get('week')), topic:fd.get('topic').trim(),
      chapter:fd.get('chapter').trim(), objectives:fd.get('objectives').trim(),
      materials:fd.get('materials').trim(), status:fd.get('status')
    };
    if (!data.topic) return showToast('Topic title required.','warning');
    if (existingId) { DB.update('lesson_plans', existingId, data); showToast('Topic updated.','success'); }
    else            { DB.insert('lesson_plans', data);              showToast('Topic added.','success'); }
    _lpClass=data.classId; _lpSubject=data.subjectId; _lpTerm=data.termId; _lpYear=data.academicYearId;
    _closeModal(); _renderLessonPlans();
  }

  function deleteTopic(id) {
    confirmAction('Delete this lesson topic?', () => {
      DB.delete('lesson_plans', id);
      showToast('Topic removed.','info');
      _renderLessonPlans();
    });
  }

  /* ─── Copy Scheme of Work Modal ─── */
  function copyPlanModal() {
    const plans  = DB.query('lesson_plans', p=>p.classId===_lpClass && p.subjectId===_lpSubject && p.termId===_lpTerm && p.academicYearId===_lpYear);
    if (!plans.length) return showToast('No topics in this scheme to copy.','warning');
    const years  = DB.get('academicYears');
    const terms  = [
      {id:'term1',label:'Term 1'},{id:'term2',label:'Term 2'},{id:'term3',label:'Term 3'}
    ].filter(t=>t.id!==_lpTerm||true);

    openModal(`
    <div class="modal-header"><h3><i class="fas fa-copy"></i> Copy Scheme of Work</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--gray-600);margin-bottom:16px">
        Copy <b>${plans.length} topic${plans.length!==1?'s':''}</b> from <b>${_termLabel(_lpTerm)}</b> to another term or year. All copied topics will be reset to <em>Planned</em> status.
      </p>
      <div class="form-row cols-2">
        <div class="form-field"><label>Target Term</label>
          <select id="copy-term">
            ${terms.map(t=>`<option value="${t.id}" ${t.id!==_lpTerm?'':''}>${t.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Target Academic Year</label>
          <select id="copy-year">
            ${years.map(y=>`<option value="${y.id}">${y.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Academics.copyPlan()"><i class="fas fa-copy"></i> Copy Topics</button>
      </div>
    </div>`, 'sm');
  }

  function copyPlan() {
    const targetTerm = document.getElementById('copy-term')?.value;
    const targetYear = document.getElementById('copy-year')?.value;
    if (!targetTerm || !targetYear) return showToast('Select target term and year.','warning');

    const plans = DB.query('lesson_plans', p=>p.classId===_lpClass && p.subjectId===_lpSubject && p.termId===_lpTerm && p.academicYearId===_lpYear);
    // Check for duplicates
    const existing = DB.query('lesson_plans', p=>p.classId===_lpClass && p.subjectId===_lpSubject && p.termId===targetTerm && p.academicYearId===targetYear);
    if (existing.length) {
      if (!confirm(`The target already has ${existing.length} topic(s). Copy anyway (adds new entries without removing existing ones)?`)) return;
    }
    plans.forEach(p => {
      DB.insert('lesson_plans', { ...p, id:undefined, termId:targetTerm, academicYearId:targetYear, status:'planned', createdAt:new Date().toISOString() });
    });
    _lpTerm = targetTerm; _lpYear = targetYear;
    showToast(`${plans.length} topic${plans.length!==1?'s':''} copied successfully.`, 'success');
    _closeModal(); _renderLessonPlans();
  }

  /* ═══════════════════════════════════════════════════════════════
     STUDENT VIEW
  ═══════════════════════════════════════════════════════════════ */
  function _renderStudentView() {
    const stu = DB.query('students', s=>s.userId===Auth.currentUser?.id)[0];
    if (!stu) return App.renderPage('<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Student profile not found</h3></div>');

    const atypes    = DB.query('assessment_types', t=>t.isActive);
    const scale     = _getScaleForClass(stu.classId);
    const allGrades = DB.query('grades', g=>g.studentId===stu.id);
    const terms     = ['term1','term2','term3'];

    // Published reports for this student
    const pubReports= DB.query('report_cards', r=>r.studentId===stu.id && r.status==='published');

    App.renderPage(`
    <div class="page-header">
      <div class="page-title"><h1>My Grades</h1><p>${DB.getById('classes',stu.classId)?.name}</p></div>
    </div>

    ${pubReports.length?`
    <div class="card mb-16">
      <div class="card-header"><div class="card-title"><i class="fas fa-file-alt"></i> Published Report Cards</div></div>
      <div style="padding:0 20px 16px;display:flex;gap:10px;flex-wrap:wrap">
        ${pubReports.map(rc=>`
          <button class="btn btn-secondary" onclick="Academics._viewPublishedReport('${rc.studentId}','${rc.termId}','${rc.classId}')">
            <i class="fas fa-download"></i> ${_termLabel(rc.termId)} Report
          </button>`).join('')}
      </div>
    </div>`:''}

    <div class="ac-tab-nav" style="margin-bottom:0" id="stu-grade-tabs">
      ${terms.map((t,i)=>`<button class="ac-tab-btn ${i===1?'active':''}" onclick="Academics._stuSwitchTerm('${t}',this)">${_termLabel(t)}</button>`).join('')}
    </div>
    <div id="stu-grade-panel"></div>
    `);

    _renderStudentTermGrades(stu, allGrades, atypes, scale, 'term2');
  }

  function _stuSwitchTerm(termId, btn) {
    document.querySelectorAll('#stu-grade-tabs .ac-tab-btn').forEach(b=>b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const stu = DB.query('students', s=>s.userId===Auth.currentUser?.id)[0];
    if (!stu) return;
    const allGrades = DB.query('grades', g=>g.studentId===stu.id);
    const atypes    = DB.query('assessment_types', t=>t.isActive);
    const scale     = _getScaleForClass(stu.classId);
    _renderStudentTermGrades(stu, allGrades, atypes, scale, termId);
  }

  function _renderStudentTermGrades(stu, allGrades, atypes, scale, termId) {
    const panel  = document.getElementById('stu-grade-panel');
    if (!panel) return;
    const grades = allGrades.filter(g=>g.termId===termId);

    // Group by subject
    const bySubj = {};
    grades.forEach(g=>{ if(!bySubj[g.subjectId])bySubj[g.subjectId]=[]; bySubj[g.subjectId].push(g); });
    const subjRows = Object.keys(bySubj).map(sid=>{
      const subj  = DB.getById('subjects',sid);
      const sGrades = bySubj[sid];
      const avg   = _weightedAverage(sGrades,atypes);
      const grade = avg!==null ? _applyScale(Math.round(avg),scale)||'—' : '—';
      return { subj, sGrades, avg, grade };
    });

    const rc = DB.query('report_cards', r=>r.studentId===stu.id&&r.termId===termId&&r.status==='restricted')[0];

    if (rc) {
      panel.innerHTML = `<div class="ac-fee-block"><i class="fas fa-lock"></i><h3>Report Locked</h3><p>Please clear your outstanding fee balance to view this term's report.</p></div>`;
      return;
    }

    panel.innerHTML = `
    <div class="card mt-0 mb-0" style="margin-top:0;border-radius:0 0 12px 12px">
      ${subjRows.length?`<div class="table-wrap"><table>
        <thead><tr><th>Subject</th><th style="text-align:center">Assessments</th><th style="text-align:center">Weighted Avg</th><th style="text-align:center">Grade</th></tr></thead>
        <tbody>
          ${subjRows.map(r=>`<tr>
            <td style="font-weight:600">${r.subj?.name||'—'}</td>
            <td style="text-align:center">
              <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center">
                ${r.sGrades.map(g=>`<span style="font-size:11px;padding:2px 6px;border-radius:4px;background:var(--gray-100);color:var(--gray-700)">${g.name}: <b>${g.score}/${g.maxScore}</b></span>`).join('')}
              </div>
            </td>
            <td style="text-align:center;font-weight:800;font-size:15px;color:var(--${r.avg!==null?gradeColor(Math.round(r.avg)):'gray-400'})">${r.avg!==null?Math.round(r.avg)+'%':'—'}</td>
            <td style="text-align:center"><span class="grade-pill grade-${(r.grade||'F').charAt(0)}">${r.grade}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="empty-state"><i class="fas fa-graduation-cap"></i><h3>No grades for ${_termLabel(termId)}</h3></div>`}
    </div>`;
  }

  function _viewPublishedReport(studentId, termId, classId) {
    _rptTerm=termId; _rptClass=classId;
    const html = _buildReportCardHTML(studentId, termId, classId);
    openModal(html, 'lg');
  }

  /* ═══════════════════════════════════════════════════════════════
     PARENT VIEW
  ═══════════════════════════════════════════════════════════════ */
  function _renderParentView() {
    const kids = DB.query('students', s=>s.guardians?.some(g=>g.userId===Auth.currentUser?.id));
    const atypes= DB.query('assessment_types', t=>t.isActive);

    App.renderPage(`
    <div class="page-header"><div class="page-title"><h1>Children's Grades</h1></div></div>
    ${kids.length?kids.map(stu=>{
      const scale   = _getScaleForClass(stu.classId);
      const grades  = DB.query('grades', g=>g.studentId===stu.id && g.termId==='term2');
      const bySubj  = {};
      grades.forEach(g=>{ if(!bySubj[g.subjectId])bySubj[g.subjectId]=[]; bySubj[g.subjectId].push(g); });
      const subjAvgs= Object.keys(bySubj).map(sid=>{ const a=_weightedSubjAvg(bySubj[sid],atypes); return a; }).filter(a=>a!==null);
      const overall = subjAvgs.length?Math.round(subjAvgs.reduce((s,a)=>s+a,0)/subjAvgs.length):null;
      const pubRpts = DB.query('report_cards', r=>r.studentId===stu.id && r.status==='published');
      return `<div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${stu.firstName} ${stu.lastName}</div>
            <div class="card-subtitle">${DB.getById('classes',stu.classId)?.name||'—'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            ${overall!==null?`<span style="font-size:24px;font-weight:800;color:var(--${gradeColor(overall)})">${overall}%</span>`:''}
            ${pubRpts.length?`<button class="btn btn-sm btn-primary" onclick="Academics._viewPublishedReport('${stu.id}','${pubRpts[pubRpts.length-1].termId}','${pubRpts[pubRpts.length-1].classId}')"><i class="fas fa-file-alt"></i> Report Card</button>`:''}
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Subject</th><th style="text-align:center">Weighted Avg</th><th style="text-align:center">Grade</th><th>Remarks</th></tr></thead>
          <tbody>
            ${Object.keys(bySubj).length?Object.keys(bySubj).map(sid=>{
              const subj=DB.getById('subjects',sid);
              const avg=_weightedSubjAvg(bySubj[sid],atypes);
              const gr = avg!==null?_applyScale(Math.round(avg),scale)||'—':'—';
              return `<tr>
                <td style="font-weight:600">${subj?.name||'—'}</td>
                <td style="text-align:center;font-weight:700;color:var(--${avg!==null?gradeColor(Math.round(avg)):'gray-400'})">${avg!==null?Math.round(avg)+'%':'—'}</td>
                <td style="text-align:center"><span class="grade-pill grade-${(gr||'F').charAt(0)}">${gr}</span></td>
                <td style="font-size:12px;color:var(--gray-500)">${avg!==null?_scaleRemarks(Math.round(avg),scale):'—'}</td>
              </tr>`;
            }).join(''):`<tr><td colspan="4" style="text-align:center;color:var(--gray-300);padding:20px">No grades recorded for Term 2</td></tr>`}
          </tbody>
        </table></div>
      </div>`;
    }).join(''):`<div class="empty-state"><i class="fas fa-user-graduate"></i><h3>No children linked to your account</h3></div>`}
    `);
  }

  /* ═══════════════════════════════════════════════════════════════
     UTILITY FUNCTIONS
  ═══════════════════════════════════════════════════════════════ */

  /** Weighted average for a student's grades in ONE subject, using configured assessment types */
  function _weightedAverage(grades, atypes) {
    const filtered = grades.filter(g => g.score !== null && g.percentage !== null);
    if (!filtered.length) return null;

    const groups = [];
    atypes.forEach(at => {
      const matching = filtered.filter(g => at.typeCodes.includes(g.type));
      if (matching.length) {
        const avg = matching.reduce((s,g)=>s+g.percentage,0) / matching.length;
        groups.push({ weight: at.weight, avg });
      }
    });

    // Also handle types that don't map to any configured assessment type
    const mappedTypes = atypes.flatMap(t=>t.typeCodes);
    const unmapped    = filtered.filter(g=>!mappedTypes.includes(g.type));
    if (unmapped.length) {
      const avg = unmapped.reduce((s,g)=>s+g.percentage,0)/unmapped.length;
      groups.push({ weight:10, avg }); // fallback weight
    }

    if (!groups.length) return null;
    const totalWeight = groups.reduce((s,g)=>s+g.weight, 0);
    const weighted    = groups.reduce((s,g)=>s+(g.avg * g.weight/totalWeight), 0);
    return Math.round(weighted * 10) / 10;
  }

  /** Weighted average for a subject using its own grade array (for report card) */
  function _weightedSubjAvg(grades, atypes) {
    return _weightedAverage(grades, atypes);
  }

  /** Get the appropriate grade scale for a class */
  function _getScaleForClass(classId) {
    const cls    = DB.getById('classes', classId);
    const grade  = cls ? String(cls.grade) : null;
    const scales = DB.get('grade_scales');
    if (!grade || !scales.length) return scales[0]||null;
    return scales.find(s=>s.applyToGrades.includes(grade)) || scales[0];
  }

  /** Apply scale to get letter grade */
  function _applyScale(pct, scale) {
    if (!scale || pct === null || pct === undefined) return '—';
    const range = scale.ranges.find(r => pct >= r.min && pct <= r.max);
    return range ? range.grade : '—';
  }

  /** Get remarks from scale */
  function _scaleRemarks(pct, scale) {
    if (!scale || pct === null) return '—';
    const range = scale.ranges.find(r => pct >= r.min && pct <= r.max);
    return range ? range.remarks : '—';
  }

  /** Check if student has outstanding fees for current term */
  function _checkFeeStatus(studentId) {
    const inv = DB.query('invoices', i=>i.studentId===studentId && i.termId===_rptTerm && i.balance>0);
    return inv.length > 0 ? 'restricted' : 'published';
  }

  /** Get classes this user can access — delegates to Auth.myClasses() */
  function _getAccessibleClasses() {
    return Auth.myClasses().sort((a,b) => a.level - b.level || a.name.localeCompare(b.name));
  }

  /** Get subjects this user can access — delegates to Auth.mySubjectIds() */
  function _getAccessibleSubjects() {
    const ids = Auth.mySubjectIds();
    if (!ids) return DB.get('subjects').sort((a,b) => a.name.localeCompare(b.name));
    return ids.map(id => DB.getById('subjects', id)).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name));
  }

  function _termOptions(selected) {
    return ['term1','term2','term3'].map(t=>`<option value="${t}" ${selected===t?'selected':''}>${_termLabel(t)}</option>`).join('');
  }

  function _termLabel(t) {
    return t==='term1'?'Term 1':t==='term2'?'Term 2':t==='term3'?'Term 3':t;
  }

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════ */
  return {
    render, switchTab,
    // Gradebook
    selectClass, selectSubject, selectTerm,
    addAssessmentModal, saveAssessment,
    bulkEntryModal, _loadBulkTable, saveBulkEntry,
    addGradeModal, saveGrade, deleteGrade,
    // Grade Weights
    addTypeModal, editTypeModal, saveType, deleteType,
    // Grade Scales
    addScaleModal, editScaleModal, saveScale, deleteScale, _addScaleRow,
    // Reports
    selectRptClass, selectRptTerm,
    editReportCard, saveReportCard,
    publishAllModal, publishAll, publishOne,
    viewReportCard, generateReportCards,
    _viewPublishedReport,
    // Analytics (no extra public fns needed)
    // Lesson Plans
    selectLPClass, selectLPSubject, selectLPTerm, selectLPYear,
    addTopicModal, editTopicModal, saveTopic, deleteTopic,
    copyPlanModal, copyPlan,
    // Student view
    _stuSwitchTerm,
  };
})();
