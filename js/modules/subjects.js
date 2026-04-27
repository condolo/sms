/* ============================================================
   SchoolSync — Subjects Module
   Tabs: Subject Catalogue | Class Assignments
   ============================================================ */

const Subjects = (() => {
  let _tab           = 'catalogue';
  let _assignClassId = '';   // selected class in Class Assignments tab

  /* ─── Entry point ─── */
  function render() {
    App.setBreadcrumb('<i class="fas fa-book"></i> Subjects');
    _renderShell();
  }

  function _renderShell() {
    const subjects = DB.get('subjects');
    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1>Subjects</h1>
        <p>${subjects.length} subjects · ${DB.get('class_subjects').length} class–subject assignments</p>
      </div>
      <div class="page-actions">
        ${Auth.isAdmin() && _tab === 'catalogue'
          ? `<button class="btn btn-primary" onclick="Subjects.renderNew()"><i class="fas fa-plus"></i> Add Subject</button>`
          : ''}
      </div>
    </div>

    <div class="subj-tab-nav">
      <button class="subj-tab-btn ${_tab==='catalogue'?'active':''}" onclick="Subjects.switchTab('catalogue')">
        <i class="fas fa-list"></i> Subject Catalogue
      </button>
      ${Auth.isAdmin() ? `
      <button class="subj-tab-btn ${_tab==='assignments'?'active':''}" onclick="Subjects.switchTab('assignments')">
        <i class="fas fa-chalkboard"></i> Class Assignments
      </button>` : ''}
    </div>

    <div id="subj-panel"></div>
    `);
    _renderTab();
  }

  function switchTab(tab) {
    _tab = tab;
    _renderShell();
  }

  function _renderTab() {
    const panel = document.getElementById('subj-panel');
    if (!panel) return;
    if (_tab === 'catalogue')  _renderCatalogue(panel);
    else                       _renderAssignments(panel);
  }

  /* ══════════════════════════════════════════════════════════════
     TAB 1 — SUBJECT CATALOGUE (existing behaviour)
  ══════════════════════════════════════════════════════════════ */
  function _renderCatalogue(panel) {
    const subjects = DB.get('subjects');
    const depts    = [...new Set(subjects.map(s => s.department))].sort();

    panel.innerHTML = depts.map(dept => {
      const dSubjs = subjects.filter(s => s.department === dept);
      return `
      <div class="card">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--gray-500);margin-bottom:14px">
          <i class="fas fa-layer-group" style="margin-right:6px"></i>${dept}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
          ${dSubjs.map(s => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:${s.color}10;border:1px solid ${s.color}30;border-radius:var(--radius-sm);border-left:4px solid ${s.color}">
            <div style="width:36px;height:36px;border-radius:10px;background:${s.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0">${s.code}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:700;color:var(--gray-800)">${s.name}</div>
              <div style="font-size:11px;color:var(--gray-400);margin-top:2px">${s.credits} credits · <span style="color:${s.isCore?'var(--primary)':'var(--gray-500)'}">${s.isCore?'Core':'Elective'}</span></div>
            </div>
            ${Auth.isAdmin() ? `
              <button class="btn btn-sm btn-secondary btn-icon" onclick="Subjects.renderEdit('${s.id}')"><i class="fas fa-edit"></i></button>
              <button class="btn btn-sm btn-danger btn-icon" onclick="Subjects.deleteSubject('${s.id}')"><i class="fas fa-trash"></i></button>
            ` : ''}
          </div>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  function renderNew()    { openModal(_formHTML(null), 'sm'); }
  function renderEdit(id) { openModal(_formHTML(DB.getById('subjects', id)), 'sm'); }

  function _formHTML(s) {
    const isEdit = !!s;
    return `
    <div class="modal-header">
      <h3>${isEdit ? 'Edit Subject' : 'Add Subject'}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Subjects.save(event,'${s?.id||''}')">
      <div class="form-row cols-2">
        <div class="form-field"><label>Subject Name *</label><input name="name" required value="${s?.name||''}"></div>
        <div class="form-field"><label>Code *</label><input name="code" required value="${s?.code||''}" style="text-transform:uppercase"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Department</label><input name="department" value="${s?.department||''}"></div>
        <div class="form-field"><label>Credits</label><input type="number" name="credits" value="${s?.credits||3}" min="1" max="10"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Colour</label><input type="color" name="color" value="${s?.color||'#3B82F6'}"></div>
        <div class="form-field"><label>Type</label>
          <select name="isCore">
            <option value="true"  ${s?.isCore ?'selected':''}>Core (compulsory)</option>
            <option value="false" ${!s?.isCore?'selected':''}>Elective (optional)</option>
          </select>
        </div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${isEdit?'Update':'Add'} Subject</button>
      </div>
    </form>`;
  }

  function save(e, id) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const data = {
      schoolId: 'sch1',
      name:     fd.get('name').trim(),
      code:     fd.get('code').toUpperCase().trim(),
      department: fd.get('department').trim(),
      credits:  Number(fd.get('credits')),
      color:    fd.get('color'),
      isCore:   fd.get('isCore') === 'true',
      curriculum: (DB.get('schools')[0]?.curriculum?.length ? DB.get('schools')[0].curriculum : ['cambridge','ib'])
    };
    if (id) { DB.update('subjects', id, data); showToast('Subject updated.', 'success'); }
    else    { DB.insert('subjects', data);     showToast(`${data.name} added.`, 'success'); }
    _closeModal();
    _renderCatalogue(document.getElementById('subj-panel'));
  }

  function deleteSubject(id) {
    const s = DB.getById('subjects', id);
    if (!s) return;
    if (!Auth.isAdmin()) return showToast('Permission denied.', 'error');
    const blockMsg = Validators.canDeleteSubject(id);
    if (blockMsg) return showToast(blockMsg, 'warning');
    confirmAction(`Delete subject "${s.name}"? This cannot be undone.`, () => {
      _audit('SUBJECT_DELETED', { id, name: s.name, code: s.code, department: s.department });
      DB.delete('subjects', id);
      showToast(`"${s.name}" deleted.`, 'info');
      _renderCatalogue(document.getElementById('subj-panel'));
    });
  }

  /* ══════════════════════════════════════════════════════════════
     TAB 2 — CLASS ASSIGNMENTS
     For each class, admin ticks which subjects it teaches.
     Saving updates class_subjects AND auto-adds new subjects
     to enrolledSubjectIds of all students in that class.
  ══════════════════════════════════════════════════════════════ */
  function _renderAssignments(panel) {
    const classes  = DB.get('classes').sort((a,b) => a.level-b.level || a.stream.localeCompare(b.stream));
    const subjects = DB.get('subjects');
    const cs       = DB.get('class_subjects');

    // Grouped by grade for the class picker sidebar
    const grades   = [...new Set(classes.map(c => c.grade))].sort((a,b)=>a-b);

    // Ensure a class is selected
    if (!_assignClassId && classes.length) _assignClassId = classes[0].id;
    const selCls   = DB.getById('classes', _assignClassId);
    const assigned = cs.filter(r => r.classId === _assignClassId).map(r => r.subjectId);
    const depts    = [...new Set(subjects.map(s => s.department))].sort();

    panel.innerHTML = `
    <div class="subj-assign-wrap">

      <!-- Left: class picker -->
      <div class="subj-assign-sidebar">
        <div class="subj-assign-sidebar-title">Select Class</div>
        ${grades.map(g => `
          <div class="subj-assign-grade-label">Grade ${g}</div>
          ${classes.filter(c=>c.grade===g).map(c=>`
          <div class="subj-assign-cls-item ${_assignClassId===c.id?'active':''}" onclick="Subjects.selectAssignClass('${c.id}')">
            <span class="subj-assign-cls-stream" style="background:${_assignClassId===c.id?'var(--primary)':'var(--gray-200)'};color:${_assignClassId===c.id?'#fff':'var(--gray-500)'}">${c.stream}</span>
            <span>${c.name}</span>
            <span class="subj-assign-cls-count">${cs.filter(r=>r.classId===c.id).length} subj.</span>
          </div>`).join('')}
        `).join('')}
      </div>

      <!-- Right: subject checkboxes for selected class -->
      <div class="subj-assign-main">
        ${selCls ? `
        <div class="subj-assign-header">
          <div>
            <div style="font-size:17px;font-weight:800;color:var(--gray-900)">${selCls.name}</div>
            <div style="font-size:13px;color:var(--gray-400)">
              ${assigned.length} subjects assigned · Tick to add, untick to remove
            </div>
          </div>
          <button class="btn btn-primary" onclick="Subjects.saveAssignments('${selCls.id}')">
            <i class="fas fa-save"></i> Save Assignments
          </button>
        </div>

        ${depts.map(dept => {
          const dSubjs = subjects.filter(s => s.department === dept);
          return `
          <div class="subj-assign-dept-block">
            <div class="subj-assign-dept-title">
              <i class="fas fa-layer-group"></i> ${dept}
            </div>
            <div class="subj-assign-subj-grid">
              ${dSubjs.map(subj => {
                const isAssigned = assigned.includes(subj.id);
                return `
                <label class="subj-assign-subj-item ${isAssigned?'subj-assigned':''}" style="border-left:4px solid ${subj.color}">
                  <input type="checkbox" id="sa_${subj.id}" value="${subj.id}" ${isAssigned?'checked':''}
                    onchange="this.closest('.subj-assign-subj-item').classList.toggle('subj-assigned',this.checked)">
                  <div style="flex:1">
                    <div style="display:flex;align-items:center;gap:6px">
                      <span style="font-size:11px;font-weight:800;color:#fff;background:${subj.color};padding:2px 7px;border-radius:4px">${subj.code}</span>
                      <span style="font-weight:600;font-size:13px;color:var(--gray-800)">${subj.name}</span>
                    </div>
                    <div style="font-size:11px;color:var(--gray-400);margin-top:2px">
                      ${subj.credits} credits · <span style="color:${subj.isCore?'var(--primary)':'var(--gray-500)'}">${subj.isCore?'Core — compulsory':'Elective'}</span>
                    </div>
                  </div>
                </label>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}

        <div style="display:flex;justify-content:flex-end;margin-top:20px">
          <button class="btn btn-primary" onclick="Subjects.saveAssignments('${selCls.id}')">
            <i class="fas fa-save"></i> Save Assignments for ${selCls.name}
          </button>
        </div>
        ` : `<div class="empty-state"><i class="fas fa-chalkboard"></i><h3>Select a class to manage its subjects</h3></div>`}
      </div>
    </div>`;
  }

  function selectAssignClass(classId) {
    _assignClassId = classId;
    _renderAssignments(document.getElementById('subj-panel'));
  }

  function saveAssignments(classId) {
    // Collect which subjects are ticked
    const newAssigned = [];
    DB.get('subjects').forEach(subj => {
      const chk = document.getElementById(`sa_${subj.id}`);
      if (chk && chk.checked) newAssigned.push(subj.id);
    });

    const existing  = DB.get('class_subjects').filter(r => r.classId === classId).map(r => r.subjectId);
    const toAdd     = newAssigned.filter(sid => !existing.includes(sid));
    const toRemove  = existing.filter(sid => !newAssigned.includes(sid));

    // Update class_subjects table
    toAdd.forEach(subjectId => {
      DB.insert('class_subjects', { schoolId:'sch1', classId, subjectId, academicYearId: SchoolContext.currentAcYearId() });
    });
    toRemove.forEach(subjectId => {
      const row = DB.get('class_subjects').find(r => r.classId === classId && r.subjectId === subjectId);
      if (row) DB.remove('class_subjects', row.id);
    });

    // Sync students in this class:
    // • Added subjects → add to ALL students in class (who don't already have it)
    // • Removed subjects → remove from ALL students in class
    if (toAdd.length || toRemove.length) {
      const students = DB.query('students', s => s.classId === classId && s.status === 'active');
      students.forEach(stu => {
        let ids = [...(stu.enrolledSubjectIds || [])];
        toAdd.forEach(sid => { if (!ids.includes(sid)) ids.push(sid); });
        toRemove.forEach(sid => { ids = ids.filter(id => id !== sid); });
        DB.update('students', stu.id, { enrolledSubjectIds: ids });
      });
    }

    const cls = DB.getById('classes', classId);
    showToast(`Subjects saved for ${cls?.name}. ${toAdd.length} added, ${toRemove.length} removed.`, 'success');
    _renderAssignments(document.getElementById('subj-panel'));
  }

  return {
    render, switchTab, selectAssignClass, saveAssignments,
    renderNew, renderEdit, save, deleteSubject
  };
})();
