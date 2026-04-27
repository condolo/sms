/* ============================================================
   SchoolSync — Students Module (SIS)
   ============================================================ */

const Students = (() => {
  let _filter = { q:'', grade:'', status:'active', subjectId:'' };

  function render(param) {
    if (param) return _renderProfile(param);
    App.setBreadcrumb('<i class="fas fa-user-graduate"></i> Students');

    /* Parents see only their own children */
    if (Auth.isParent()) {
      const user = Auth.currentUser;
      const kids = DB.query('students', s => s.guardians?.some(g => g.userId === user.id));
      if (kids.length === 1) return _renderProfile(kids[0].id);
    }
    if (Auth.isStudent()) {
      const user = Auth.currentUser;
      const stu = DB.query('students', s => s.userId === user.id)[0];
      if (stu) return _renderProfile(stu.id);
    }
    _renderList();
  }

  /* Helper: label for a grade value (handles KG strings and numeric grades) */
  function _gradeLabel(g) {
    return String(g).startsWith('KG') ? g : `Grade ${g}`;
  }

  function _renderList() {
    const students   = _getFiltered();
    // Only show classes this user is allowed to see
    const allClasses = Auth.myClasses(); // already sorted by level

    // Unique grade values in accessible classes (maintain level order)
    const gradeList = [...new Map(allClasses.map(c => [c.grade, c.level])).entries()]
      .sort((a,b) => a[1] - b[1])
      .map(([g]) => g);

    // Classes dropdown: if a grade is selected, only show classes for that grade
    const visibleClasses = _filter.grade
      ? allClasses.filter(c => String(c.grade) === String(_filter.grade))
      : allClasses;

    // Subjects dropdown: scope to selected class, or selected grade, or user's accessible subjects
    const mySubjIds = Auth.mySubjectIds(); // null = all
    let visibleSubjectIds;
    if (_filter.classId) {
      let ids = DB.query('class_subjects', r => r.classId === _filter.classId).map(r => r.subjectId);
      if (mySubjIds) ids = ids.filter(id => mySubjIds.includes(id));
      visibleSubjectIds = ids;
    } else if (_filter.grade) {
      const gradeClassIds = allClasses.filter(c => String(c.grade) === String(_filter.grade)).map(c => c.id);
      const rows = DB.get('class_subjects').filter(r => gradeClassIds.includes(r.classId));
      let ids = [...new Set(rows.map(r => r.subjectId))];
      if (mySubjIds) ids = ids.filter(id => mySubjIds.includes(id));
      visibleSubjectIds = ids;
    } else {
      visibleSubjectIds = mySubjIds; // null = all, or teacher's subject list
    }
    const visibleSubjects = visibleSubjectIds
      ? visibleSubjectIds.map(id => DB.getById('subjects', id)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name))
      : DB.get('subjects').sort((a,b)=>a.name.localeCompare(b.name));

    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1>Students</h1>
        <p>${DB.query('students',s=>s.status==='active').length} active · ${DB.get('students').length} total</p>
      </div>
      <div class="page-actions">
        ${Auth.isAdmin() ? `<button class="btn btn-primary" onclick="App.navigate('admissions')"><i class="fas fa-file-import"></i> New Admission</button>` : ''}
        <button class="btn btn-secondary" onclick="Students.exportCSV()"><i class="fas fa-download"></i> Export</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="search-box">
        <i class="fas fa-search"></i>
        <input type="text" id="stuSearch" placeholder="Search by name or admission no…" value="${_filter.q}" oninput="Students.setFilter('q',this.value)">
      </div>
      <select class="filter-select" onchange="Students.setFilter('grade',this.value)">
        <option value="">All Grades</option>
        ${gradeList.map(g=>`<option value="${g}" ${String(_filter.grade)===String(g)?'selected':''}>${_gradeLabel(g)}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="Students.setFilter('classId',this.value)">
        <option value="">All Classes${_filter.grade ? ` in Grade ${_filter.grade}` : ''}</option>
        ${visibleClasses.map(c=>`<option value="${c.id}" ${_filter.classId===c.id?'selected':''}>${c.name}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="Students.setFilter('subjectId',this.value)">
        <option value="">All Subjects${_filter.classId||_filter.grade ? ' (filtered)' : ''}</option>
        ${visibleSubjects.map(s=>`<option value="${s.id}" ${_filter.subjectId===s.id?'selected':''}>${s.name}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="Students.setFilter('status',this.value)">
        <option value="">All Status</option>
        <option value="active" ${_filter.status==='active'?'selected':''}>Active</option>
        <option value="graduated" ${_filter.status==='graduated'?'selected':''}>Graduated</option>
        <option value="transferred" ${_filter.status==='transferred'?'selected':''}>Transferred</option>
        <option value="withdrawn" ${_filter.status==='withdrawn'?'selected':''}>Withdrawn</option>
      </select>
      <button class="btn btn-sm btn-ghost" onclick="Students.clearFilters()" title="Clear filters"><i class="fas fa-times"></i></button>
      <span style="color:var(--gray-400);font-size:13px;margin-left:auto">${students.length} result${students.length!==1?'s':''}</span>
    </div>

    <div class="card mb-0">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Admission No.</th>
              <th>Class</th>
              <th>House</th>
              <th>Gender</th>
              <th>Nationality</th>
              <th>Enrolled</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${students.length ? students.map(s => {
              const cls = DB.getById('classes', s.classId);
              const _h = (() => { try { const bCfg = DB.get('behaviour_settings')[0]; return s.houseId ? (bCfg?.houses||[]).find(h=>h.id===s.houseId)||null : null; } catch(e){ return null; } })();
              return `<tr>
                <td>
                  <div style="display:flex;align-items:center;gap:10px">
                    <div class="avatar-circle" style="background:${_h ? _h.color : (s.gender==='Female'?'#7C3AED':'#2563EB')}">${s.firstName.charAt(0)}</div>
                    <div>
                      <div style="font-weight:600">${s.firstName} ${s.lastName}</div>
                      <div class="text-muted text-sm">${s.guardians?.[0]?.name||'—'}</div>
                    </div>
                  </div>
                </td>
                <td class="monospace" style="font-size:13px">${s.admissionNo}</td>
                <td>${cls?.name||'—'}</td>
                <td>${_h ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:${_h.color}"><i class="fas fa-shield-alt"></i>${_h.name}</span>` : '<span style="color:var(--gray-300)">—</span>'}</td>
                <td>${s.gender}</td>
                <td>${s.nationality}</td>
                <td>${fmtDate(s.enrollmentDate)}</td>
                <td><span class="badge badge-${statusBadge(s.status)}">${s.status}</span></td>
                <td>
                  <div class="tbl-actions">
                    <button class="btn btn-sm btn-secondary" onclick="App.navigate('students','${s.id}')"><i class="fas fa-eye"></i></button>
                    ${Auth.isAdmin() ? `<button class="btn btn-sm btn-secondary" onclick="Students.renderEdit('${s.id}')"><i class="fas fa-edit"></i></button>` : ''}
                    ${Auth.isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="Students.delete('${s.id}')"><i class="fas fa-trash"></i></button>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-user-slash"></i><h3>No students found</h3><p>Try adjusting your filters or enroll a new student.</p></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    `);
  }

  function _renderProfile(id) {
    const s = DB.getById('students', id);
    if (!s) { App.renderPage('<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Student not found</h3></div>'); return; }
    const cls    = DB.getById('classes', s.classId);
    const house  = (() => { try { const bCfg = DB.get('behaviour_settings')[0]; return s.houseId ? (bCfg?.houses||[]).find(h=>h.id===s.houseId)||null : null; } catch(e){ return null; } })();
    const grades = DB.query('grades', g => g.studentId === id);
    const att    = DB.get('attendance').flatMap(a => a.records.filter(r => r.studentId === id));
    const attPresent = att.filter(r => r.status === 'present').length;
    const attRate    = att.length > 0 ? Math.round(attPresent/att.length*100) : 100;
    const avg        = grades.length ? Math.round(grades.reduce((s,g) => s+g.percentage,0)/grades.length) : null;
    const invoice    = DB.query('invoices', i => i.studentId === id).filter(i => i.termId === 'term2')[0];
    const behavior   = DB.query('behavior', b => b.studentId === id);
    // Enrolled subjects — individual per student (supports electives)
    const enrolledIds   = s.enrolledSubjectIds || [];
    const enrolledSubjs = enrolledIds.map(sid => DB.getById('subjects', sid)).filter(Boolean);

    App.setBreadcrumb(`<a href="#students" onclick="App.navigate('students')">Students</a> / ${s.firstName} ${s.lastName}`);

    App.renderPage(`
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">
      <button class="btn btn-secondary btn-sm" onclick="App.navigate('students')"><i class="fas fa-arrow-left"></i> Back</button>
      ${Auth.isAdmin() ? `<button class="btn btn-secondary btn-sm" onclick="Students.renderEdit('${id}')"><i class="fas fa-edit"></i> Edit</button>` : ''}
      ${Auth.isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="Students.delete('${id}')"><i class="fas fa-trash"></i> Delete</button>` : ''}
    </div>

    <div class="profile-header">
      <div class="avatar-circle avatar-xl">${s.firstName.charAt(0)}</div>
      <div class="profile-info" style="flex:1">
        <h2>${s.firstName} ${s.lastName}</h2>
        <p>${cls?.name||'Unknown Class'} · Admission: ${s.admissionNo}</p>
        <div class="profile-tags">
          <span class="profile-tag">${s.gender}</span>
          <span class="profile-tag">${s.nationality}</span>
          <span class="profile-tag">${s.bloodGroup}</span>
          ${house ? `<span class="profile-tag" style="background:${house.color};color:#fff"><i class="fas fa-shield-alt"></i> ${house.name} House</span>` : ''}
          <span class="profile-tag badge-${statusBadge(s.status)}" style="background:rgba(255,255,255,0.2)">${s.status.toUpperCase()}</span>
        </div>
      </div>
      <div style="display:flex;gap:20px;text-align:center;z-index:1">
        <div><div style="font-size:28px;font-weight:800">${avg !== null ? avg+'%' : 'N/A'}</div><div style="font-size:12px;opacity:.8">Avg Grade</div></div>
        <div><div style="font-size:28px;font-weight:800">${attRate}%</div><div style="font-size:12px;opacity:.8">Attendance</div></div>
      </div>
    </div>

    <div class="tabs" id="stu-tabs">
      <button class="tab-btn active" onclick="switchTab('stu-tabs','tab-overview',this)">Overview</button>
      <button class="tab-btn" onclick="switchTab('stu-tabs','tab-subjects',this)">
        Subjects <span class="tab-count">${enrolledSubjs.length}</span>
      </button>
      <button class="tab-btn" onclick="switchTab('stu-tabs','tab-grades',this)">Grades</button>
      <button class="tab-btn" onclick="switchTab('stu-tabs','tab-attendance',this)">Attendance</button>
      <button class="tab-btn" onclick="switchTab('stu-tabs','tab-finance',this)">Finance</button>
      <button class="tab-btn" onclick="switchTab('stu-tabs','tab-medical',this)">Medical</button>
      <button class="tab-btn" onclick="switchTab('stu-tabs','tab-behavior',this)">Behavior</button>
    </div>

    <!-- OVERVIEW -->
    <div id="tab-overview" class="tab-panel active">
      <div class="grid-2">
        <div class="card mb-0">
          <div class="card-title mb-12">Personal Information</div>
          <div class="info-list">
            <div class="info-item"><div class="info-icon"><i class="fas fa-user"></i></div><div><div class="info-label">Full Name</div><div class="info-value">${s.firstName} ${s.lastName}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-birthday-cake"></i></div><div><div class="info-label">Date of Birth</div><div class="info-value">${fmtDate(s.dateOfBirth)}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-venus-mars"></i></div><div><div class="info-label">Gender</div><div class="info-value">${s.gender}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-globe"></i></div><div><div class="info-label">Nationality</div><div class="info-value">${s.nationality}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-tint"></i></div><div><div class="info-label">Blood Group</div><div class="info-value">${s.bloodGroup}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-calendar-check"></i></div><div><div class="info-label">Enrolled</div><div class="info-value">${fmtDate(s.enrollmentDate)}</div></div></div>
            ${house ? `<div class="info-item"><div class="info-icon" style="color:${house.color}"><i class="fas fa-shield-alt"></i></div><div><div class="info-label">House</div><div class="info-value" style="font-weight:600;color:${house.color}">${house.name}</div></div></div>` : ''}
          </div>
        </div>
        <div class="card mb-0">
          <div class="card-title mb-12">Guardians</div>
          ${(s.guardians||[]).map(g => `
            <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:14px;margin-bottom:10px">
              <div style="font-size:14px;font-weight:700">${g.name}</div>
              <div style="font-size:12px;color:var(--gray-500);margin-top:4px">${g.relation} ${g.isPrimary?'· <span style="color:var(--primary)">Primary Contact</span>':''}</div>
              <div style="font-size:13px;color:var(--gray-600);margin-top:6px"><i class="fas fa-phone" style="width:14px"></i> ${g.phone}</div>
              <div style="font-size:13px;color:var(--gray-600);margin-top:3px"><i class="fas fa-envelope" style="width:14px"></i> ${g.email}</div>
            </div>
          `).join('') || '<p class="text-muted">No guardians on record</p>'}
        </div>
      </div>
    </div>

    <!-- SUBJECTS -->
    <div id="tab-subjects" class="tab-panel">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Enrolled Subjects (${enrolledSubjs.length})</div>
          ${Auth.isAdmin() ? `<a class="btn btn-sm btn-secondary" onclick="App.navigate('classes','${s.classId}')" title="Manage via Classes module"><i class="fas fa-external-link-alt"></i> Manage in Classes</a>` : ''}
        </div>
        <div style="padding:16px 20px">
          ${enrolledSubjs.length ? `
          <div class="stu-subjects-grid">
            ${enrolledSubjs.map(subj => `
            <div class="stu-subject-card" style="border-left:4px solid ${subj.color}">
              <div class="stu-subj-code" style="background:${subj.color}">${subj.code}</div>
              <div style="flex:1;min-width:0">
                <div class="stu-subj-name">${subj.name}</div>
                <div class="stu-subj-dept">${subj.department} · ${subj.credits} credit${subj.credits!==1?'s':''}</div>
              </div>
              <span class="badge badge-${subj.isCore?'primary':'secondary'}">${subj.isCore?'Core':'Elective'}</span>
            </div>`).join('')}
          </div>

          <div class="stu-subject-summary">
            <div class="stu-subj-sum-item">
              <span class="stu-subj-sum-val">${enrolledSubjs.filter(s=>s.isCore).length}</span>
              <span class="stu-subj-sum-label">Core</span>
            </div>
            <div class="stu-subj-sum-item">
              <span class="stu-subj-sum-val">${enrolledSubjs.filter(s=>!s.isCore).length}</span>
              <span class="stu-subj-sum-label">Electives</span>
            </div>
            <div class="stu-subj-sum-item">
              <span class="stu-subj-sum-val">${enrolledSubjs.reduce((t,s)=>t+s.credits,0)}</span>
              <span class="stu-subj-sum-label">Total Credits</span>
            </div>
          </div>` : `
          <div class="empty-state">
            <i class="fas fa-book-open"></i>
            <h3>No subjects assigned</h3>
            <p>Use "Add Subject" to assign core and elective subjects.</p>
          </div>`}
        </div>
      </div>
    </div>

    <!-- GRADES -->
    <div id="tab-grades" class="tab-panel">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Academic Results</div>
          ${Auth.isAdmin() || Auth.isTeacher() ? `<button class="btn btn-sm btn-primary" onclick="Academics.addGradeModal('${id}')"><i class="fas fa-plus"></i> Add Grade</button>` : ''}
        </div>
        ${grades.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Subject</th><th>Assessment</th><th>Score</th><th>Grade</th><th>%</th><th>Term</th><th>Date</th><th>Comments</th></tr></thead>
            <tbody>
              ${grades.map(g => {
                const subj = DB.getById('subjects', g.subjectId);
                return `<tr>
                  <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${subj?.color||'#ccc'};margin-right:6px"></span>${subj?.name||'—'}</td>
                  <td><span class="badge badge-secondary">${g.type}</span> ${g.name}</td>
                  <td style="font-weight:600">${g.score}/${g.maxScore}</td>
                  <td><span class="grade-pill grade-${g.grade?.charAt(0)||'C'}">${g.grade}</span></td>
                  <td><span style="font-weight:700;color:var(--${gradeColor(g.percentage)})">${g.percentage}%</span></td>
                  <td>${g.termId === 'term1' ? 'Term 1' : g.termId === 'term2' ? 'Term 2' : 'Term 3'}</td>
                  <td>${fmtDate(g.date)}</td>
                  <td style="font-size:12px;color:var(--gray-400);max-width:180px">${g.comments||'—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : '<div class="empty-state"><i class="fas fa-graduation-cap"></i><h3>No grades recorded</h3></div>'}
      </div>
    </div>

    <!-- ATTENDANCE -->
    <div id="tab-attendance" class="tab-panel">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Attendance Record</div>
          <div style="display:flex;gap:16px;font-size:13px">
            <span><span class="badge badge-success">Present</span> ${att.filter(r=>r.status==='present').length}</span>
            <span><span class="badge badge-danger">Absent</span> ${att.filter(r=>r.status==='absent').length}</span>
            <span><span class="badge badge-warning">Late</span> ${att.filter(r=>r.status==='late').length}</span>
          </div>
        </div>
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
            <span>Overall Attendance Rate</span>
            <span style="font-weight:700;color:var(--${attRate>=90?'success':attRate>=75?'warning':'danger'})">${attRate}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${attRate>=90?'success':attRate>=75?'warning':'danger'}" style="width:${attRate}%"></div></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Status</th><th>Note</th><th>Marked By</th></tr></thead>
            <tbody>
              ${DB.get('attendance').filter(a=>a.classId===s.classId).map(a => {
                const rec = a.records.find(r => r.studentId === id);
                if (!rec) return '';
                return `<tr>
                  <td>${fmtDate(a.date)}</td>
                  <td><span class="badge badge-${statusBadge(rec.status)}">${rec.status}</span></td>
                  <td style="font-size:12px;color:var(--gray-500)">${rec.note||'—'}</td>
                  <td style="font-size:12px;color:var(--gray-400)">${DB.getById('users',rec.markedBy)?.name||rec.markedBy}</td>
                </tr>`;
              }).join('') || '<tr><td colspan="4"><div class="empty-state" style="padding:20px"><p>No attendance records</p></div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- FINANCE -->
    <div id="tab-finance" class="tab-panel">
      ${invoice ? `
      <div class="invoice-card">
        <div class="invoice-header">
          <div>
            <div style="font-size:15px;font-weight:700">${invoice.invoiceNo}</div>
            <div style="font-size:13px;color:var(--gray-500)">Term 2 · Due: ${fmtDate(invoice.dueDate)}</div>
          </div>
          <span class="badge badge-${statusBadge(invoice.status)}">${invoice.status.toUpperCase()}</span>
        </div>
        <div class="invoice-body">
          ${invoice.items.map(item => `<div class="invoice-line"><span>${item.name}</span><span>${fmtMoney(item.amount)}</span></div>`).join('')}
          <div class="invoice-line total"><span>Total</span><span>${fmtMoney(invoice.totalAmount)}</span></div>
          <div class="invoice-line paid"><span>Amount Paid</span><span>${fmtMoney(invoice.paidAmount)}</span></div>
          ${invoice.balance > 0 ? `<div class="invoice-line balance"><span>Outstanding Balance</span><span>${fmtMoney(invoice.balance)}</span></div>` : ''}
        </div>
        ${invoice.payments.length ? `
        <div style="padding:16px 20px;border-top:1px solid var(--gray-100)">
          <div style="font-size:12px;font-weight:700;color:var(--gray-500);margin-bottom:8px">PAYMENT HISTORY</div>
          ${invoice.payments.map(p => `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid var(--gray-50)">
              <span>${fmtDate(p.date)} · ${p.method?.replace('_',' ')}</span>
              <span style="font-weight:600;color:var(--success)">${fmtMoney(p.amount)}</span>
            </div>
            <div style="font-size:11px;color:var(--gray-400);margin-bottom:4px">Ref: ${p.reference}</div>
          `).join('')}
        </div>` : ''}
        ${Auth.isAdmin() || Auth.isFinance() ? `
        <div style="padding:16px 20px;border-top:1px solid var(--gray-100)">
          <button class="btn btn-success btn-sm" onclick="Finance.recordPaymentModal('${invoice.id}')"><i class="fas fa-plus"></i> Record Payment</button>
        </div>` : ''}
      </div>` : '<div class="empty-state"><i class="fas fa-file-invoice"></i><h3>No invoice for this term</h3></div>'}
    </div>

    <!-- MEDICAL -->
    <div id="tab-medical" class="tab-panel">
      <div class="grid-2">
        <div class="card mb-0">
          <div class="card-title mb-12">Medical Information</div>
          <div class="info-list">
            <div class="info-item"><div class="info-icon"><i class="fas fa-heartbeat"></i></div><div><div class="info-label">Medical Conditions</div><div class="info-value">${s.medicalInfo?.conditions||'None'}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-allergies"></i></div><div><div class="info-label">Allergies</div><div class="info-value">${s.medicalInfo?.allergies||'None'}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-pills"></i></div><div><div class="info-label">Medications</div><div class="info-value">${s.medicalInfo?.medications||'None'}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-user-md"></i></div><div><div class="info-label">Doctor</div><div class="info-value">${s.medicalInfo?.doctorName||'—'} · ${s.medicalInfo?.doctorPhone||''}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-phone-alt"></i></div><div><div class="info-label">Emergency Contact</div><div class="info-value">${s.medicalInfo?.emergencyContact||'—'}</div></div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- BEHAVIOR -->
    <div id="tab-behavior" class="tab-panel">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Behavior & Discipline Records</div>
          ${Auth.isAdmin() || Auth.isTeacher() ? `<button class="btn btn-sm btn-primary" onclick="Students.addBehaviorModal('${id}')"><i class="fas fa-plus"></i> Add Record</button>` : ''}
        </div>
        ${behavior.length ? behavior.map(b => `
          <div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--gray-100)">
            <div style="width:36px;height:36px;border-radius:50%;background:${b.type==='positive'?'var(--success-light)':'var(--danger-light)'};color:${b.type==='positive'?'var(--success)':'var(--danger)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <i class="fas fa-${b.type==='positive'?'thumbs-up':'exclamation-triangle'}"></i>
            </div>
            <div style="flex:1">
              <div style="font-size:13.5px;font-weight:600">${b.description}</div>
              <div style="font-size:12px;color:var(--gray-400);margin-top:4px"><span class="badge badge-${b.type==='positive'?'success':'danger'}">${b.category}</span> · ${fmtDate(b.date)}</div>
              <div style="font-size:12px;color:var(--gray-500);margin-top:4px"><strong>Action:</strong> ${b.action}</div>
            </div>
          </div>
        `).join('') : '<div class="empty-state"><i class="fas fa-check-circle"></i><h3>No behavior records</h3></div>'}
      </div>
    </div>
    `);
  }

  function renderNew() {
    // New students must come through the Admissions pipeline to ensure:
    //   • A user login account is created
    //   • The admission number sequence (nextSeqNumber) stays in sync
    //   • The application audit trail is maintained
    if (!Auth.isAdmin()) return showToast('Administrators only.', 'error');
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-file-import"></i> Enroll a New Student</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body" style="text-align:center;padding:36px 32px">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--primary-light);color:var(--primary);font-size:28px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
        <i class="fas fa-route"></i>
      </div>
      <h3 style="margin:0 0 10px;color:var(--gray-800)">Use the Admissions Pipeline</h3>
      <p style="font-size:13px;color:var(--gray-500);max-width:380px;margin:0 auto 24px">
        New students must be enrolled through <b>Admissions</b> to ensure a verified student profile,
        login credentials, a sequenced admission number, and a full application audit trail.
      </p>
      <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:16px;text-align:left;margin-bottom:24px;font-size:13px;color:var(--gray-600)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><i class="fas fa-check-circle" style="color:var(--success)"></i> Fill application (manual, bulk, or online form)</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><i class="fas fa-check-circle" style="color:var(--success)"></i> Review & approve with class assignment</div>
        <div style="display:flex;align-items:center;gap:8px"><i class="fas fa-check-circle" style="color:var(--success)"></i> One-click enroll — creates profile + login automatically</div>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="_closeModal();App.navigate('admissions')">
          <i class="fas fa-file-import"></i> Go to Admissions
        </button>
      </div>
    </div>`, 'sm');
  }

  function renderEdit(id) {
    if (!Auth.isAdmin()) return showToast('Administrators only.', 'error');
    const s = DB.getById('students', id);
    if (!s) return showToast('Student not found.', 'error');
    openModal(_formHTML(s), 'lg');
  }

  function _formHTML(s) {
    // This form is for EDITING existing students only.
    // New students must come through Admissions → renderNew() handles that redirect.
    if (!s) return ''; // guard — should never reach here for new students
    const classes = DB.get('classes');
    // Build subject list for the student's assigned class (info only — subjects come from class)
    const classSubjects = s.classId
      ? DB.query('grades', g => g.studentId === s.id)
          .map(g => DB.getById('subjects', g.subjectId))
          .filter(Boolean)
          .filter((sub, i, arr) => arr.findIndex(x => x.id === sub.id) === i) // unique
      : [];

    return `
    <div class="modal-header">
      <h3><i class="fas fa-user-edit"></i> Edit Student Profile</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Students.save(event,'${s.id}')">

      <!-- Admission No — read-only, managed by Admissions module -->
      <div class="stu-admno-row">
        <i class="fas fa-id-badge"></i>
        <span class="stu-admno-label">Admission No.</span>
        <span class="stu-admno-val">${s.admissionNo}</span>
        <small style="color:var(--gray-400);font-size:11px">Managed by Admissions · cannot be changed here</small>
        <input type="hidden" name="admissionNo" value="${s.admissionNo}">
      </div>

      <div class="form-row cols-2">
        <div class="form-field"><label>First Name *</label><input name="firstName" required value="${s.firstName||''}"></div>
        <div class="form-field"><label>Last Name *</label><input name="lastName" required value="${s.lastName||''}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Date of Birth</label><input type="date" name="dateOfBirth" value="${s.dateOfBirth||''}"></div>
        <div class="form-field"><label>Gender</label><select name="gender">
          <option ${s.gender==='Male'?'selected':''}>Male</option>
          <option ${s.gender==='Female'?'selected':''}>Female</option>
          <option ${s.gender==='Other'?'selected':''}>Other</option>
        </select></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Nationality</label><input name="nationality" value="${s.nationality||''}"></div>
        <div class="form-field"><label>Blood Group</label><select name="bloodGroup">
          ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b=>`<option ${s.bloodGroup===b?'selected':''}>${b}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Class *</label><select name="classId" required>
          <option value="">Select class…</option>
          ${classes.map(c=>`<option value="${c.id}" ${s.classId===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
        <small style="color:var(--gray-400);font-size:11px;margin-top:4px;display:block">
          <i class="fas fa-info-circle"></i> Subjects are inherited from the assigned class automatically
        </small>
        </div>
        <div class="form-field"><label>Status</label><select name="status">
          ${['active','graduated','transferred','withdrawn'].map(st=>`<option value="${st}" ${s.status===st?'selected':''}>${st}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Enrollment Date</label><input type="date" name="enrollmentDate" value="${s.enrollmentDate||''}"></div>
        <div class="form-field"><label>House <small style="font-weight:400;color:var(--gray-400)">(optional)</small></label>
          <select name="houseId">
            <option value="">— No House —</option>
            ${(() => { try { const bCfg = DB.get('behaviour_settings')[0]; return (bCfg?.houses||[]).map(h=>`<option value="${h.id}" ${s.houseId===h.id?'selected':''}>${h.name}</option>`).join(''); } catch(e){ return ''; } })()}
          </select>
        </div>
      </div>

      <hr class="sep">
      <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:12px">Guardian Information</div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Guardian Name</label><input name="guardianName" value="${s.guardians?.[0]?.name||''}"></div>
        <div class="form-field"><label>Relation</label><input name="guardianRelation" value="${s.guardians?.[0]?.relation||'Parent'}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Guardian Phone</label><input name="guardianPhone" value="${s.guardians?.[0]?.phone||''}"></div>
        <div class="form-field"><label>Guardian Email</label><input type="email" name="guardianEmail" value="${s.guardians?.[0]?.email||''}"></div>
      </div>

      <hr class="sep">
      <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:12px">Medical Information</div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Medical Conditions</label><input name="conditions" value="${s.medicalInfo?.conditions||'None'}"></div>
        <div class="form-field"><label>Allergies</label><input name="allergies" value="${s.medicalInfo?.allergies||'None'}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Medications</label><input name="medications" value="${s.medicalInfo?.medications||'None'}"></div>
        <div class="form-field"><label>Emergency Contact Phone</label><input name="emergencyContact" value="${s.medicalInfo?.emergencyContact||''}"></div>
      </div>

      <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Changes</button>
      </div>
    </form>`;
  }

  function save(e, id) {
    e.preventDefault();
    // Guard: editing only — new students must come through Admissions
    if (!id) {
      showToast('New students must be enrolled through Admissions.', 'warning');
      _closeModal();
      App.navigate('admissions');
      return;
    }
    const fd  = new FormData(e.target);
    const existing = DB.getById('students', id);
    const data = {
      // Preserve fields that should not change here
      admissionNo:    existing?.admissionNo,   // locked — do NOT overwrite from form
      userId:         existing?.userId,         // login account unchanged
      schoolId:       existing?.schoolId || 'sch1',
      enrollmentDate: existing?.enrollmentDate, // enrollment date is set at admission time
      // Editable fields
      firstName:   fd.get('firstName').trim(),
      lastName:    fd.get('lastName').trim(),
      dateOfBirth: fd.get('dateOfBirth'),
      gender:      fd.get('gender'),
      nationality: fd.get('nationality').trim(),
      bloodGroup:  fd.get('bloodGroup'),
      classId:     fd.get('classId'),
      houseId:     fd.get('houseId') || null,
      status:      fd.get('status'),
      guardians: [{
        name:      fd.get('guardianName').trim(),
        relation:  fd.get('guardianRelation').trim() || 'Parent',
        phone:     fd.get('guardianPhone').trim(),
        email:     fd.get('guardianEmail').trim(),
        isPrimary: true,
        userId:    existing?.guardians?.[0]?.userId || null
      }],
      medicalInfo: {
        conditions:       fd.get('conditions').trim()       || 'None',
        allergies:        fd.get('allergies').trim()        || 'None',
        medications:      fd.get('medications').trim()      || 'None',
        emergencyContact: fd.get('emergencyContact').trim() || ''
      }
    };
    /* Central validation — catches required fields, FK integrity, enum values */
    const err = Validators.student(data, id);
    if (err) return showToast(err, 'warning');
    const before = DB.getById('students', id);
    DB.update('students', id, data);
    _audit('STUDENT_UPDATED', {
      studentId:   id,
      studentName: `${data.firstName} ${data.lastName}`,
      admissionNo: before?.admissionNo,
      changes: {
        classId: before?.classId !== data.classId ? { from: before?.classId, to: data.classId } : undefined,
        status:  before?.status  !== data.status  ? { from: before?.status,  to: data.status  } : undefined,
        houseId: before?.houseId !== data.houseId ? { from: before?.houseId, to: data.houseId } : undefined,
      }
    });
    showToast('Student profile updated successfully.', 'success');
    _closeModal();
    _renderProfile(id);
  }

  function deleteStudent(id) {
    const s = DB.getById('students', id);
    if (!s) return;
    const blockMsg = Validators.canDeleteStudent(id);
    if (blockMsg) return showToast(blockMsg, 'warning');
    confirmAction(`Delete ${s.firstName} ${s.lastName}? This cannot be undone.`, () => {
      _audit('STUDENT_DELETED', { studentId: id, studentName: `${s.firstName} ${s.lastName}`, admissionNo: s.admissionNo, class: s.classId });
      DB.delete('students', id);
      showToast('Student removed.', 'success');
      _renderList();
    });
  }

  /* ─── Subject Enrollment ─── */
  function addSubjectModal(studentId) {
    const s          = DB.getById('students', studentId);
    if (!s) return;
    const enrolled   = s.enrolledSubjectIds || [];
    const allSubjs   = DB.get('subjects');
    const available  = allSubjs.filter(sub => !enrolled.includes(sub.id));

    if (!available.length) {
      showToast('Student is already enrolled in all available subjects.', 'info');
      return;
    }

    // Group available subjects by department
    const depts = [...new Set(available.map(sub => sub.department))].sort();

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-book-medical"></i> Add Subject — ${s.firstName} ${s.lastName}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">
        Select one or more subjects to add to this student's enrollment.
        <b>Core subjects</b> are compulsory; <b>Electives</b> are optional and can be removed later.
      </p>
      <form id="add-subj-form" onsubmit="Students.saveSubjects(event,'${studentId}')">
        ${depts.map(dept => `
        <div style="margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-400);margin-bottom:8px">
            <i class="fas fa-layer-group" style="margin-right:5px"></i>${dept}
          </div>
          <div class="stu-add-subj-grid">
            ${available.filter(sub => sub.department === dept).map(sub => `
            <label class="stu-add-subj-item" style="border-left:4px solid ${sub.color}">
              <input type="checkbox" name="subj_${sub.id}" value="${sub.id}">
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-size:11px;font-weight:800;color:#fff;background:${sub.color};padding:2px 6px;border-radius:4px">${sub.code}</span>
                  <span style="font-weight:600;font-size:13px">${sub.name}</span>
                </div>
                <div style="font-size:11px;color:var(--gray-400);margin-top:2px">${sub.credits} credits · <span style="color:${sub.isCore?'var(--primary)':'var(--gray-400)'}">${sub.isCore?'Core':'Elective'}</span></div>
              </div>
            </label>`).join('')}
          </div>
        </div>`).join('')}
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
          <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-plus"></i> Add Selected Subjects</button>
        </div>
      </form>
    </div>`, 'md');
  }

  function saveSubjects(e, studentId) {
    e.preventDefault();
    const s       = DB.getById('students', studentId);
    if (!s) return;
    const fd      = new FormData(e.target);
    const toAdd   = [];
    DB.get('subjects').forEach(sub => {
      if (fd.get(`subj_${sub.id}`)) toAdd.push(sub.id);
    });
    if (!toAdd.length) { showToast('No subjects selected.', 'warning'); return; }
    const updated = [...new Set([...(s.enrolledSubjectIds || []), ...toAdd])];
    DB.update('students', studentId, { enrolledSubjectIds: updated });
    showToast(`${toAdd.length} subject${toAdd.length!==1?'s':''} added.`, 'success');
    _closeModal();
    _renderProfile(studentId);
  }

  function removeSubject(studentId, subjectId) {
    const s    = DB.getById('students', studentId);
    const subj = DB.getById('subjects', subjectId);
    if (!s || !subj) return;
    if (subj.isCore) { showToast('Core subjects cannot be removed.', 'warning'); return; }
    confirmAction(`Remove "${subj.name}" from ${s.firstName}'s enrollment? Their existing grades for this subject will be kept.`, () => {
      const updated = (s.enrolledSubjectIds || []).filter(id => id !== subjectId);
      DB.update('students', studentId, { enrolledSubjectIds: updated });
      showToast(`${subj.name} removed from enrollment.`, 'info');
      _renderProfile(studentId);
    });
  }

  function addBehaviorModal(studentId) {
    openModal(`
    <div class="modal-header"><h3>Add Behavior Record</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Students.saveBehavior(event,'${studentId}')">
      <div class="form-row cols-2">
        <div class="form-field"><label>Type</label><select name="type"><option value="positive">Positive</option><option value="negative">Negative</option></select></div>
        <div class="form-field"><label>Category</label><select name="category">
          <option>academic_excellence</option><option>leadership</option><option>teamwork</option>
          <option>tardiness</option><option>disruption</option><option>bullying</option><option>vandalism</option>
        </select></div>
      </div>
      <div class="form-field mb-12"><label>Description *</label><textarea name="description" required placeholder="Describe the incident or achievement…"></textarea></div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Action Taken</label><input name="action" placeholder="e.g. Verbal warning, Commendation…"></div>
        <div class="form-field"><label>Date</label><input type="date" name="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Record</button>
      </div>
    </form>`, 'sm');
  }

  function saveBehavior(e, studentId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    DB.insert('behavior', {
      schoolId: 'sch1', studentId,
      reportedBy: Auth.currentUser.id,
      type: fd.get('type'), category: fd.get('category'),
      description: fd.get('description'), action: fd.get('action'),
      date: fd.get('date')
    });
    showToast('Behavior record added.', 'success');
    _closeModal();
    _renderProfile(studentId);
  }

  function setFilter(key, val) {
    if (key === 'grade') {
      // Changing grade clears the class selection (may no longer belong to new grade)
      // but keep subjectId only if it still makes sense (we let the dropdown re-filter it)
      _filter.grade   = val;
      _filter.classId = '';
      // If a subject was selected that isn't in this grade, clear it
      if (_filter.subjectId && val) {
        const gradeClassIds = DB.get('classes').filter(c => c.grade == val).map(c => c.id);
        const gradeSubjIds  = DB.get('class_subjects').filter(r => gradeClassIds.includes(r.classId)).map(r => r.subjectId);
        if (!gradeSubjIds.includes(_filter.subjectId)) _filter.subjectId = '';
      }
    } else if (key === 'classId') {
      _filter.classId = val;
      if (val) {
        // Derive grade from the selected class so the Grade dropdown stays in sync
        const cls = DB.getById('classes', val);
        if (cls) _filter.grade = String(cls.grade);
        // If a subject was selected that isn't in this class, clear it
        if (_filter.subjectId) {
          const clsSubjIds = DB.query('class_subjects', r => r.classId === val).map(r => r.subjectId);
          if (!clsSubjIds.includes(_filter.subjectId)) _filter.subjectId = '';
        }
      }
    } else {
      _filter[key] = val;
    }
    _renderList();
  }

  function clearFilters() {
    _filter = { q:'', grade:'', status:'active', subjectId:'', classId:'' };
    _renderList();
  }

  function _getFiltered() {
    let data = DB.get('students');

    // Role-based scope: teacher sees only their classes; section_head sees only their section
    if (Auth.isTeacher() && !Auth.isAdmin()) {
      const myClassIds = Auth.myClasses().map(c => c.id);
      data = data.filter(s => myClassIds.includes(s.classId));
    } else if (Auth.isSectionHead() && !Auth.isAdmin()) {
      const myClassIds = Auth.myClasses().map(c => c.id);
      data = data.filter(s => myClassIds.includes(s.classId));
    }

    if (_filter.status)    data = data.filter(s => s.status === _filter.status);
    if (_filter.classId)   data = data.filter(s => s.classId === _filter.classId);
    if (_filter.grade && !_filter.classId) {
      const ids = DB.get('classes').filter(c => String(c.grade) === String(_filter.grade)).map(c => c.id);
      data = data.filter(s => ids.includes(s.classId));
    }
    if (_filter.subjectId) data = data.filter(s => (s.enrolledSubjectIds||[]).includes(_filter.subjectId));
    if (_filter.q) {
      const q = _filter.q.toLowerCase();
      data = data.filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q));
    }
    if (Auth.isParent()) {
      const uid = Auth.currentUser.id;
      data = data.filter(s => s.guardians?.some(g => g.userId === uid));
    }
    return data;
  }

  function exportCSV() {
    const rows = _getFiltered();
    const headers = ['Admission No','First Name','Last Name','Class','Gender','Nationality','Blood Group','Enrolled','Status'];
    const csv = [headers, ...rows.map(s => {
      const cls = DB.getById('classes', s.classId);
      return [s.admissionNo, s.firstName, s.lastName, cls?.name||'', s.gender, s.nationality, s.bloodGroup, s.enrollmentDate, s.status];
    })].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'students.csv'; a.click();
    showToast('Students exported.', 'success');
  }

  return {
    render, renderNew, renderEdit, save,
    delete: deleteStudent, setFilter, clearFilters, exportCSV,
    addBehaviorModal, saveBehavior,
    addSubjectModal, saveSubjects, removeSubject
  };
})();

function switchTab(tabGroup, panelId, btn) {
  document.querySelectorAll(`#${tabGroup} .tab-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const allPanels = panel.parentElement.querySelectorAll('.tab-panel');
  allPanels.forEach(p => p.classList.remove('active'));
  panel.classList.add('active');
}
