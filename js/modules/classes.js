/* ============================================================
   InnoLearn — Classes & Streams Module
   Class detail has two tabs: Students | Subject Enrollment matrix
   ============================================================ */

const Classes = (() => {

  function render(param) {
    App.setBreadcrumb('<i class="fas fa-door-open"></i> Classes');
    if (param) return renderDetail(param);
    _renderList();
  }

  /* ══════════════════════════════════════════════════════════════
     CLASS LIST
  ══════════════════════════════════════════════════════════════ */
  function _renderList() {
    const classes  = DB.get('classes').sort((a,b) => a.level - b.level || a.stream.localeCompare(b.stream));
    const students = DB.get('students');
    const teachers = DB.get('teachers');
    const grouped  = {};
    classes.forEach(c => {
      if (!grouped[c.grade]) grouped[c.grade] = [];
      grouped[c.grade].push(c);
    });

    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1>Classes & Streams</h1>
        <p>${classes.length} classes across ${Object.keys(grouped).length} grade levels</p>
      </div>
      <div class="page-actions">
        ${Auth.isAdmin() ? `<button class="btn btn-primary" onclick="Classes.renderNew()"><i class="fas fa-plus"></i> Add Class</button>` : ''}
      </div>
    </div>

    ${Object.keys(grouped).map(grade => {
      const gradeClasses = grouped[grade];
      return `
      <div class="card">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--gray-500);margin-bottom:14px">Grade ${grade}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
          ${gradeClasses.map(c => {
            const teacher   = teachers.find(t => t.id === c.homeroomTeacherId);
            const stuCount  = students.filter(s => s.classId === c.id && s.status === 'active').length;
            const subjCount = DB.query('class_subjects', r => r.classId === c.id).length;
            const pct       = c.capacity > 0 ? Math.round(stuCount/c.capacity*100) : 0;
            return `
            <div class="card mb-0" style="cursor:pointer" onclick="Classes.renderDetail('${c.id}')">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                <div>
                  <div style="font-size:16px;font-weight:800;color:var(--gray-900)">${c.name}</div>
                  <div style="font-size:12px;color:var(--gray-400)">${c.room} · ${subjCount} subject${subjCount!==1?'s':''}</div>
                </div>
                <div style="width:44px;height:44px;border-radius:12px;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800">${c.stream}</div>
              </div>
              <div class="info-list">
                <div class="info-item">
                  <div class="info-icon"><i class="fas fa-chalkboard-teacher"></i></div>
                  <div><div class="info-label">Homeroom Teacher</div><div class="info-value">${teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Not assigned'}</div></div>
                </div>
              </div>
              <div style="margin-top:14px">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">
                  <span style="color:var(--gray-500)">Enrollment</span>
                  <span style="font-weight:700">${stuCount} / ${c.capacity}</span>
                </div>
                <div class="progress-bar"><div class="progress-fill ${pct>=90?'danger':pct>=75?'warning':'primary'}" style="width:${pct}%"></div></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
    `);
  }

  /* ══════════════════════════════════════════════════════════════
     CLASS DETAIL
  ══════════════════════════════════════════════════════════════ */
  function renderDetail(id) {
    const cls      = DB.getById('classes', id);
    if (!cls) return;
    const students = DB.query('students', s => s.classId === id && s.status === 'active')
                       .sort((a,b) => a.lastName.localeCompare(b.lastName));
    const teacher  = DB.query('teachers', t => t.id === cls.homeroomTeacherId)[0];
    const clsSubjs = DB.query('class_subjects', r => r.classId === id)
                       .map(r => DB.getById('subjects', r.subjectId)).filter(Boolean)
                       .sort((a,b) => a.name.localeCompare(b.name));

    App.setBreadcrumb(`<a href="#classes" onclick="App.navigate('classes')">Classes</a> / ${cls.name}`);
    App.renderPage(`
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" onclick="App.navigate('classes')"><i class="fas fa-arrow-left"></i> Back</button>
      ${Auth.isAdmin() ? `<button class="btn btn-secondary btn-sm" onclick="Classes.renderEdit('${id}')"><i class="fas fa-edit"></i> Edit Class</button>` : ''}
      ${Auth.isAdmin() ? `<button class="btn btn-sm btn-secondary" onclick="App.navigate('admissions')"><i class="fas fa-file-import"></i> Enroll via Admissions</button>` : ''}
    </div>

    <div class="profile-header" style="background:linear-gradient(135deg,#064E3B,#059669,#10B981)">
      <div style="width:72px;height:72px;border-radius:20px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:900;color:#fff;flex-shrink:0">${cls.stream}</div>
      <div class="profile-info">
        <h2>${cls.name}</h2>
        <p>Grade ${cls.grade} · ${cls.room} · Capacity: ${cls.capacity}</p>
        <div class="profile-tags">
          <span class="profile-tag">Stream ${cls.stream}</span>
          <span class="profile-tag">${students.length} Students</span>
          <span class="profile-tag">${clsSubjs.length} Subjects</span>
        </div>
      </div>
      <div style="display:flex;gap:24px;text-align:center;z-index:1">
        <div><div style="font-size:32px;font-weight:800">${students.length}</div><div style="font-size:12px;opacity:.8">Students</div></div>
        <div><div style="font-size:32px;font-weight:800">${clsSubjs.length}</div><div style="font-size:12px;opacity:.8">Subjects</div></div>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:16px">
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Class Information</div></div>
        <div class="info-list">
          <div class="info-item"><div class="info-icon"><i class="fas fa-chalkboard-teacher"></i></div><div><div class="info-label">Homeroom Teacher</div><div class="info-value">${teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Not assigned'}</div></div></div>
          <div class="info-item"><div class="info-icon"><i class="fas fa-door-open"></i></div><div><div class="info-label">Room</div><div class="info-value">${cls.room}</div></div></div>
          <div class="info-item"><div class="info-icon"><i class="fas fa-users"></i></div><div><div class="info-label">Capacity</div><div class="info-value">${cls.capacity} students</div></div></div>
        </div>
      </div>
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Quick Actions</div></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-secondary" onclick="App.navigate('timetable')"><i class="fas fa-calendar-alt"></i> View Timetable</button>
          <button class="btn btn-secondary" onclick="App.navigate('attendance')"><i class="fas fa-clipboard-check"></i> Mark Attendance</button>
          <button class="btn btn-secondary" onclick="App.navigate('academics')"><i class="fas fa-graduation-cap"></i> View Grades</button>
          ${Auth.isAdmin() ? `<button class="btn btn-secondary" onclick="App.navigate('subjects')"><i class="fas fa-book"></i> Manage Class Subjects</button>` : ''}
        </div>
      </div>
    </div>

    <!-- Tabs: Students | Subject Enrollment -->
    <div class="tabs" id="cls-detail-tabs">
      <button class="tab-btn active" onclick="switchTab('cls-detail-tabs','cls-tab-students',this)">
        <i class="fas fa-users"></i> Students (${students.length})
      </button>
      <button class="tab-btn" onclick="switchTab('cls-detail-tabs','cls-tab-matrix',this)">
        <i class="fas fa-th"></i> Subject Enrollment
        ${clsSubjs.length === 0 ? '<span class="tab-count" style="background:var(--warning-light);color:var(--warning)">!</span>' : `<span class="tab-count">${clsSubjs.length}</span>`}
      </button>
    </div>

    <!-- TAB: Students list -->
    <div id="cls-tab-students" class="tab-panel active">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Students (${students.length})</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Student</th><th>Admission No.</th><th>Gender</th><th>Guardian</th><th>Subjects</th><th>Actions</th></tr></thead>
            <tbody>
              ${students.map((s,i) => {
                const subCount = (s.enrolledSubjectIds||[]).length;
                return `<tr>
                  <td style="color:var(--gray-400);font-size:12px">${i+1}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:8px">
                      <div class="avatar-circle" style="background:${s.gender==='Female'?'#7C3AED':'#2563EB'};width:30px;height:30px;font-size:12px">${s.firstName.charAt(0)}</div>
                      <div>
                        <div style="font-weight:600">${s.firstName} ${s.lastName}</div>
                        <div style="font-size:11px;color:var(--gray-400)">${s.admissionNo}</div>
                      </div>
                    </div>
                  </td>
                  <td class="monospace text-sm">${s.admissionNo}</td>
                  <td>${s.gender}</td>
                  <td style="font-size:12px;color:var(--gray-500)">${s.guardians?.[0]?.name||'—'}</td>
                  <td><span class="badge badge-secondary">${subCount} subject${subCount!==1?'s':''}</span></td>
                  <td><button class="btn btn-sm btn-secondary" onclick="App.navigate('students','${s.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
              }).join('') || '<tr><td colspan="7"><div class="empty-state" style="padding:20px"><p>No students in this class</p></div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB: Subject Enrollment matrix -->
    <div id="cls-tab-matrix" class="tab-panel">
      ${_matrixHTML(id, students, clsSubjs)}
    </div>
    `);
  }

  /* ──────────────────────────────────────────────────────
     SUBJECT ENROLLMENT MATRIX
     Rows = students, Columns = class subjects
     Checkbox = student is enrolled in that subject
     Unticking removes subjectId from student.enrolledSubjectIds
  ────────────────────────────────────────────────────── */
  function _matrixHTML(classId, students, clsSubjs) {
    if (!clsSubjs.length) {
      return `
      <div class="card mb-0">
        <div style="padding:32px;text-align:center">
          <i class="fas fa-book-open" style="font-size:48px;color:var(--gray-300);margin-bottom:12px"></i>
          <h3 style="color:var(--gray-600);margin-bottom:6px">No subjects assigned to ${DB.getById('classes',classId)?.name}</h3>
          <p style="font-size:13px;color:var(--gray-400);margin-bottom:20px">
            Go to <b>Subjects → Class Assignments</b> to add subjects to this class first.
          </p>
          ${Auth.isAdmin() ? `<button class="btn btn-primary" onclick="App.navigate('subjects')"><i class="fas fa-book"></i> Go to Subjects</button>` : ''}
        </div>
      </div>`;
    }

    if (!students.length) {
      return `<div class="card mb-0"><div class="empty-state"><i class="fas fa-users-slash"></i><h3>No active students in this class</h3></div></div>`;
    }

    return `
    <div class="card mb-0">
      <div class="card-header">
        <div>
          <div class="card-title">Subject Enrollment Matrix</div>
          <div style="font-size:12px;color:var(--gray-400);margin-top:2px">
            Untick a student to remove them from an elective subject. Core subjects cannot be removed.
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--gray-400)">
          <span style="display:inline-flex;align-items:center;gap:4px"><i class="fas fa-circle" style="color:var(--primary);font-size:8px"></i> Core</span>
          <span style="display:inline-flex;align-items:center;gap:4px"><i class="fas fa-circle" style="color:var(--gray-300);font-size:8px"></i> Elective</span>
        </div>
      </div>
      <div class="cls-matrix-wrap">
        <table class="cls-matrix-table">
          <thead>
            <tr>
              <th class="cls-matrix-name-col">Student</th>
              ${clsSubjs.map(subj => `
              <th class="cls-matrix-subj-col" title="${subj.name}">
                <div class="cls-matrix-subj-header" style="color:${subj.color}">
                  <span class="cls-matrix-subj-code" style="background:${subj.color}">${subj.code}</span>
                  <span class="cls-matrix-subj-name">${subj.name}</span>
                  ${subj.isCore ? '<i class="fas fa-lock" title="Core subject" style="font-size:9px;color:var(--primary);margin-top:2px"></i>' : ''}
                </div>
              </th>`).join('')}
              <th class="cls-matrix-total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            ${students.map(stu => {
              const enrolled = stu.enrolledSubjectIds || [];
              const count    = clsSubjs.filter(s => enrolled.includes(s.id)).length;
              return `<tr class="cls-matrix-row">
                <td class="cls-matrix-name-cell">
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:28px;height:28px;border-radius:50%;background:${stu.gender==='Female'?'#7C3AED':'#2563EB'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${stu.firstName.charAt(0)}</div>
                    <div>
                      <div style="font-weight:600;font-size:13px">${stu.firstName} ${stu.lastName}</div>
                      <div style="font-size:11px;color:var(--gray-400)">${stu.admissionNo}</div>
                    </div>
                  </div>
                </td>
                ${clsSubjs.map(subj => {
                  const isEnrolled = enrolled.includes(subj.id);
                  return `<td class="cls-matrix-cell">
                    <label class="cls-matrix-checkbox-label ${isEnrolled?'enrolled':''}">
                      <input type="checkbox"
                        class="cls-enroll-chk"
                        ${isEnrolled ? 'checked' : ''}
                        ${subj.isCore ? 'disabled title="Core subject — cannot remove"' : ''}
                        onchange="Classes.toggleSubjectEnrollment('${stu.id}','${subj.id}',this.checked,this)"
                      >
                    </label>
                  </td>`;
                }).join('')}
                <td class="cls-matrix-total-cell">
                  <span class="badge badge-${count===clsSubjs.length?'success':'secondary'}">${count}/${clsSubjs.length}</span>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
          <!-- Column totals -->
          <tfoot>
            <tr>
              <td class="cls-matrix-name-cell" style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase">Enrolled</td>
              ${clsSubjs.map(subj => {
                const enrolledCount = students.filter(s => (s.enrolledSubjectIds||[]).includes(subj.id)).length;
                return `<td class="cls-matrix-cell" style="text-align:center;font-size:11px;font-weight:700;color:var(--gray-500)">${enrolledCount}/${students.length}</td>`;
              }).join('')}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
  }

  /* Toggle a single student–subject enrollment from the matrix checkbox */
  function toggleSubjectEnrollment(studentId, subjectId, checked, chkEl) {
    const stu  = DB.getById('students', studentId);
    const subj = DB.getById('subjects', subjectId);
    if (!stu || !subj) return;
    if (subj.isCore) { showToast('Core subjects cannot be removed.', 'warning'); chkEl.checked = true; return; }

    let ids = [...(stu.enrolledSubjectIds || [])];
    if (checked) {
      if (!ids.includes(subjectId)) ids.push(subjectId);
    } else {
      ids = ids.filter(id => id !== subjectId);
    }
    DB.update('students', studentId, { enrolledSubjectIds: ids });

    // Visual feedback on the cell
    const label = chkEl.closest('.cls-matrix-checkbox-label');
    if (label) label.classList.toggle('enrolled', checked);

    showToast(
      checked
        ? `${stu.firstName} added to ${subj.name}`
        : `${stu.firstName} removed from ${subj.name}`,
      checked ? 'success' : 'info'
    );
  }

  /* ══════════════════════════════════════════════════════════════
     ADD / EDIT CLASS FORM
  ══════════════════════════════════════════════════════════════ */
  function renderNew()    { openModal(_formHTML(null), 'sm'); }
  function renderEdit(id) { openModal(_formHTML(DB.getById('classes', id)), 'sm'); }

  function _formHTML(c) {
    const teachers  = DB.get('teachers');
    const isEdit    = !!c;
    /* Build grade list: all currently used grades + standard 1–12 */
    const usedGrades = DB.get('classes').map(cl => cl.grade);
    const allGrades  = [...new Set([...usedGrades, 1,2,3,4,5,6,7,8,9,10,11,12])].sort((a,b)=>Number(a)-Number(b));
    return `
    <div class="modal-header">
      <h3>${isEdit ? 'Edit Class' : 'Add New Class'}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Classes.save(event,'${c?.id||''}')">
      <div class="form-row cols-2">
        <div class="form-field"><label>Grade Level *</label><select name="grade" required>
          ${allGrades.map(g=>`<option value="${g}" ${c?.grade==g?'selected':''}>Grade ${g}</option>`).join('')}
        </select></div>
        <div class="form-field"><label>Stream *</label><select name="stream" required>
          ${['A','B','C','D'].map(s=>`<option value="${s}" ${c?.stream===s?'selected':''}>${s}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Room</label><input name="room" value="${c?.room||''}"></div>
        <div class="form-field"><label>Capacity</label><input type="number" name="capacity" value="${c?.capacity||35}" min="1"></div>
      </div>
      <div class="form-field mb-12"><label>Homeroom Teacher</label><select name="homeroomTeacherId">
        <option value="">None</option>
        ${teachers.map(t=>`<option value="${t.id}" ${c?.homeroomTeacherId===t.id?'selected':''}>${t.firstName} ${t.lastName}</option>`).join('')}
      </select></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Add Class'}</button>
      </div>
    </form>`;
  }

  function save(e, id) {
    e.preventDefault();
    if (!Auth.isAdmin()) return showToast('Permission denied.', 'error');
    const fd     = new FormData(e.target);
    const grade  = Number(fd.get('grade'));
    const stream = fd.get('stream');
    if (!grade || !stream) return showToast('Grade and stream are required.', 'warning');
    const data   = {
      schoolId: 'sch1', grade, stream,
      name:     `Grade ${grade}${stream}`,
      level:    Number(grade) || grade,
      room:     fd.get('room'),
      capacity: Number(fd.get('capacity')),
      homeroomTeacherId: fd.get('homeroomTeacherId') || null,
      academicYearId: SchoolContext.currentAcYearId()
    };
    if (id) {
      DB.update('classes', id, data);
      _audit('CLASS_UPDATED', { id, name: data.name, grade, stream });
      showToast('Class updated.', 'success');
    } else {
      const rec = DB.insert('classes', data);
      _audit('CLASS_CREATED', { id: rec.id, name: data.name, grade, stream });
      showToast(`${data.name} added.`, 'success');
    }
    _closeModal();
    _renderList();
  }

  return { render, renderDetail, renderNew, renderEdit, save, toggleSubjectEnrollment };
})();
