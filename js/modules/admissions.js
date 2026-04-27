/* ============================================================
   SchoolSync — Admissions Module
   Tabs: Pipeline | New Application | Bulk Upload | Online Form | Settings
   ============================================================ */

const Admissions = (() => {

  /* ── State ── */
  let _tab           = 'pipeline';
  let _filterStatus  = 'all';
  let _filterGrade   = 'all';
  let _filterSource  = 'all';
  let _searchQ       = '';
  let _bulkStep      = 1;
  let _bulkData      = [];   // parsed rows before import
  let _bulkErrors    = [];

  /* ══════════════════════════════════════════════════════════════
     ENTRY POINT
  ══════════════════════════════════════════════════════════════ */
  function render() {
    App.setBreadcrumb('<i class="fas fa-file-import"></i> Admissions');
    if (!Auth.isAdmin()) return App.renderPage('<div class="empty-state"><i class="fas fa-lock"></i><h3>Admin access required</h3></div>');
    _renderShell();
  }

  /* ══════════════════════════════════════════════════════════════
     SHELL
  ══════════════════════════════════════════════════════════════ */
  function _renderShell() {
    const cfg   = _cfg();
    const apps  = DB.get('applications');
    const pend  = apps.filter(a => a.status === 'pending').length;
    const appr  = apps.filter(a => a.status === 'approved').length;

    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1>Admissions</h1>
        <p>Student intake pipeline — ${DB.get('academicYears').find(y=>y.isCurrent)?.name||'2024–2025'}</p>
      </div>
      <div class="page-actions">
        ${pend ? `<span class="adm-badge-alert"><i class="fas fa-clock"></i> ${pend} pending review</span>` : ''}
        ${appr ? `<span class="adm-badge-ready"><i class="fas fa-check-circle"></i> ${appr} ready to enroll</span>` : ''}
        <button class="btn btn-primary" onclick="Admissions.switchTab('new_application')"><i class="fas fa-plus"></i> New Application</button>
      </div>
    </div>

    <div class="adm-tab-nav" id="adm-tabs">
      ${[
        { id:'pipeline',        icon:'fas fa-stream',         label:'Pipeline'         },
        { id:'new_application', icon:'fas fa-user-plus',      label:'New Application'  },
        { id:'bulk_upload',     icon:'fas fa-upload',         label:'Bulk Upload'      },
        { id:'online_form',     icon:'fas fa-link',           label:'Online Form'      },
        { id:'settings',        icon:'fas fa-sliders-h',      label:'Settings'         },
      ].map(t => `<button class="adm-tab-btn ${_tab===t.id?'active':''}" onclick="Admissions.switchTab('${t.id}')">
        <i class="${t.icon}"></i> ${t.label}
      </button>`).join('')}
    </div>
    <div id="adm-panel"></div>
    `);

    _renderTab();
  }

  function switchTab(tab) {
    _tab = tab;
    document.querySelectorAll('.adm-tab-btn').forEach(b => {
      b.classList.toggle('active', !!b.getAttribute('onclick')?.includes(`'${tab}'`));
    });
    _renderTab();
  }

  function _renderTab() {
    const map = {
      pipeline:        _renderPipeline,
      new_application: _renderNewApp,
      bulk_upload:     _renderBulkUpload,
      online_form:     _renderOnlineForm,
      settings:        _renderSettings,
    };
    (map[_tab] || _renderPipeline)();
  }

  /* ══════════════════════════════════════════════════════════════
     TAB 1 — PIPELINE
  ══════════════════════════════════════════════════════════════ */
  function _renderPipeline() {
    const panel = document.getElementById('adm-panel');
    if (!panel) return;

    let apps = DB.get('applications');

    // Filters
    if (_filterStatus !== 'all') apps = apps.filter(a => a.status === _filterStatus);
    if (_filterGrade  !== 'all') apps = apps.filter(a => String(a.applyingForGrade) === _filterGrade);
    if (_filterSource !== 'all') apps = apps.filter(a => a.source === _filterSource);
    if (_searchQ.length > 1)     apps = apps.filter(a =>
      `${a.firstName} ${a.lastName}`.toLowerCase().includes(_searchQ.toLowerCase()) ||
      (a.guardians?.[0]?.name||'').toLowerCase().includes(_searchQ.toLowerCase())
    );
    apps.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    const all  = DB.get('applications');
    const stats = {
      total:    all.length,
      draft:    all.filter(a=>a.status==='draft').length,
      pending:  all.filter(a=>a.status==='pending').length,
      approved: all.filter(a=>a.status==='approved').length,
      rejected: all.filter(a=>a.status==='rejected').length,
      enrolled: all.filter(a=>a.status==='enrolled').length,
    };

    const statusColors = {
      draft:'secondary', pending:'warning', approved:'primary',
      rejected:'danger',  enrolled:'success'
    };
    const sourceIcons = { manual:'fas fa-pen', bulk:'fas fa-upload', online:'fas fa-globe' };

    panel.innerHTML = `
    <!-- Stats Row -->
    <div class="adm-stats-row">
      ${[
        { label:'Total',    val:stats.total,    icon:'fas fa-users',         color:'primary'   },
        { label:'Draft',    val:stats.draft,    icon:'fas fa-pencil-alt',    color:'gray'      },
        { label:'Pending',  val:stats.pending,  icon:'fas fa-clock',         color:'warning'   },
        { label:'Approved', val:stats.approved, icon:'fas fa-check-circle',  color:'primary'   },
        { label:'Enrolled', val:stats.enrolled, icon:'fas fa-user-check',    color:'success'   },
        { label:'Rejected', val:stats.rejected, icon:'fas fa-times-circle',  color:'danger'    },
      ].map(s=>`
        <div class="adm-stat-card adm-stat-${s.color}" onclick="Admissions.setFilter('status','${s.label.toLowerCase()}')">
          <div class="adm-stat-icon"><i class="${s.icon}"></i></div>
          <div class="adm-stat-val">${s.val}</div>
          <div class="adm-stat-label">${s.label}</div>
        </div>`).join('')}
    </div>

    <!-- Filter Bar -->
    <div class="adm-filter-bar">
      <input class="adm-search" type="text" placeholder="&#xF002;  Search by name or guardian…" value="${_searchQ}"
        oninput="Admissions.search(this.value)">
      <select class="filter-select" onchange="Admissions.setFilter('status',this.value)">
        <option value="all" ${_filterStatus==='all'?'selected':''}>All Statuses</option>
        ${['draft','pending','approved','rejected','enrolled'].map(s=>`<option value="${s}" ${_filterStatus===s?'selected':''}>${_cap(s)}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="Admissions.setFilter('grade',this.value)">
        <option value="all" ${_filterGrade==='all'?'selected':''}>All Grades</option>
        ${[7,8,9,10,11,12].map(g=>`<option value="${g}" ${_filterGrade===String(g)?'selected':''}>Grade ${g}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="Admissions.setFilter('source',this.value)">
        <option value="all" ${_filterSource==='all'?'selected':''}>All Sources</option>
        <option value="manual" ${_filterSource==='manual'?'selected':''}>Manual</option>
        <option value="bulk"   ${_filterSource==='bulk'?'selected':''}>Bulk Upload</option>
        <option value="online" ${_filterSource==='online'?'selected':''}>Online Form</option>
      </select>
      <button class="btn btn-sm btn-secondary" onclick="Admissions.clearFilters()"><i class="fas fa-times"></i> Clear</button>
    </div>

    <!-- Applications Table -->
    <div class="card mb-0">
      <div class="card-header">
        <div class="card-title">Applications (${apps.length})</div>
      </div>
      <div class="table-wrap">
        <table class="adm-table">
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Grade</th>
              <th>Source</th>
              <th>Checklist</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${apps.length ? apps.map(a => {
              const cfg = _cfg();
              const items   = cfg.checklistItems || [];
              const done    = items.filter(it => a.checklist?.[it.id]).length;
              const total   = items.length;
              const reqDone = items.filter(it => it.required && a.checklist?.[it.id]).length;
              const reqTotal= items.filter(it => it.required).length;
              const allReqDone = reqDone === reqTotal;
              return `<tr class="adm-row">
                <td>
                  <div style="display:flex;align-items:center;gap:10px">
                    <div class="adm-avatar" style="background:${a.gender==='Female'?'#7C3AED':'#2563EB'}">${a.firstName.charAt(0)}</div>
                    <div>
                      <div class="adm-name">${a.firstName} ${a.lastName}</div>
                      <div class="adm-sub">${a.guardians?.[0]?.name||'—'}</div>
                    </div>
                  </div>
                </td>
                <td><span class="badge badge-secondary">Grade ${a.applyingForGrade}${a.applyingForStream?' '+a.applyingForStream:''}</span></td>
                <td>
                  <span class="adm-source-chip adm-source-${a.source}">
                    <i class="${sourceIcons[a.source]||'fas fa-file'}"></i> ${_cap(a.source)}
                  </span>
                </td>
                <td>
                  <div class="adm-checklist-mini" title="${done}/${total} items done">
                    <div class="adm-check-bar">
                      <div class="adm-check-fill ${allReqDone?'adm-check-ok':''}" style="width:${total?Math.round(done/total*100):0}%"></div>
                    </div>
                    <span class="adm-check-count">${done}/${total}</span>
                    ${!allReqDone?`<i class="fas fa-exclamation-circle" style="color:var(--warning);font-size:11px" title="Required items incomplete"></i>`:''}
                  </div>
                </td>
                <td><span class="badge badge-${statusColors[a.status]||'secondary'}">${_cap(a.status)}</span></td>
                <td style="font-size:12px;color:var(--gray-400)">${fmtDate(a.createdAt)}</td>
                <td>
                  <div class="adm-actions">
                    <button class="btn btn-sm btn-ghost" onclick="Admissions.viewApplication('${a.id}')" title="View"><i class="fas fa-eye"></i></button>
                    ${a.status==='draft'||a.status==='pending' ? `<button class="btn btn-sm btn-ghost" onclick="Admissions.editApplication('${a.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>` : ''}
                    ${a.status==='pending' ? `<button class="btn btn-sm btn-primary" onclick="Admissions.approveModal('${a.id}')" title="Approve"><i class="fas fa-check"></i> Approve</button>` : ''}
                    ${a.status==='approved' ? `<button class="btn btn-sm btn-success" onclick="Admissions.enrollModal('${a.id}')" title="Enroll"><i class="fas fa-user-check"></i> Enroll</button>` : ''}
                    ${a.status==='pending' ? `<button class="btn btn-sm btn-ghost danger" onclick="Admissions.rejectModal('${a.id}')" title="Reject"><i class="fas fa-times"></i></button>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="7" class="adm-empty"><i class="fas fa-inbox"></i><br>No applications match your filters</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    `;
  }

  function setFilter(type, val) {
    if (type === 'status') _filterStatus = val;
    if (type === 'grade')  _filterGrade  = val;
    if (type === 'source') _filterSource = val;
    _renderPipeline();
  }
  function search(q)    { _searchQ = q; _renderPipeline(); }
  function clearFilters(){ _filterStatus='all'; _filterGrade='all'; _filterSource='all'; _searchQ=''; _renderPipeline(); }

  /* ──────────────────────────────────────────────────────
     VIEW APPLICATION MODAL
  ────────────────────────────────────────────────────── */
  function viewApplication(id) {
    const a   = DB.getById('applications', id);
    if (!a) return;
    const cfg = _cfg();
    const statusColors = { draft:'secondary',pending:'warning',approved:'primary',rejected:'danger',enrolled:'success' };

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-file-alt"></i> Application — ${a.firstName} ${a.lastName}</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="badge badge-${statusColors[a.status]||'secondary'}">${_cap(a.status)}</span>
        <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
      </div>
    </div>
    <div class="modal-body adm-view-body">

      <!-- Personal -->
      <div class="adm-view-section">
        <div class="adm-view-sec-title">Personal Details</div>
        <div class="adm-view-grid">
          ${_infoRow('Full Name',`${a.firstName} ${a.lastName}`)}
          ${_infoRow('Gender',a.gender||'—')}
          ${_infoRow('Date of Birth',fmtDate(a.dateOfBirth))}
          ${_infoRow('Nationality',a.nationality||'—')}
          ${_infoRow('Blood Group',a.bloodGroup||'—')}
          ${_infoRow('Source',_cap(a.source))}
        </div>
      </div>

      <!-- Admission Intent -->
      <div class="adm-view-section">
        <div class="adm-view-sec-title">Admission Details</div>
        <div class="adm-view-grid">
          ${_infoRow('Applying for Grade',`Grade ${a.applyingForGrade}${a.applyingForStream?' — Stream '+a.applyingForStream:''}`)}
          ${_infoRow('Preferred Term',a.applyingForTerm?_termLabel(a.applyingForTerm):'—')}
          ${a.assignedClass ? _infoRow('Assigned Class',DB.getById('classes',a.assignedClass)?.name||a.assignedClass) : ''}
          ${a.assignedAdmissionNo ? _infoRow('Admission No.',`<b style="color:var(--primary)">${a.assignedAdmissionNo}</b>`) : ''}
          ${(() => { if (!a.assignedHouseId) return ''; try { const bCfg = DB.get('behaviour_settings')[0]; const h = (bCfg?.houses||[]).find(x=>x.id===a.assignedHouseId); return h ? _infoRow('House',`<span style="display:inline-flex;align-items:center;gap:6px"><i class="fas fa-shield-alt" style="color:${h.color}"></i>${h.name}</span>`) : ''; } catch(e){ return ''; } })()}
          ${a.studentId ? _infoRow('Student Profile',`<a onclick="App.navigate('students','${a.studentId}');_closeModal()" style="color:var(--primary);cursor:pointer"><i class="fas fa-external-link-alt"></i> View Student</a>`) : ''}
        </div>
      </div>

      <!-- Previous School -->
      <div class="adm-view-section">
        <div class="adm-view-sec-title">Previous School</div>
        <div class="adm-view-grid">
          ${_infoRow('School Name',a.previousSchool||'—')}
          ${_infoRow('Class / Grade',a.previousClass||'—')}
          ${_infoRow('Performance',a.previousPerformance||'—')}
          ${a.previousAverage!=null ? _infoRow('Average Score',`${a.previousAverage}%`) : ''}
        </div>
      </div>

      <!-- Guardian -->
      <div class="adm-view-section">
        <div class="adm-view-sec-title">Parent / Guardian</div>
        ${(a.guardians||[]).map(g=>`
        <div class="adm-view-grid">
          ${_infoRow('Name',g.name||'—')}
          ${_infoRow('Relation',g.relation||'—')}
          ${_infoRow('Phone',g.phone||'—')}
          ${_infoRow('Email',g.email||'—')}
        </div>`).join('<hr style="border:none;border-top:1px dashed var(--gray-200);margin:8px 0">')}
      </div>

      <!-- Medical -->
      ${a.medicalInfo ? `
      <div class="adm-view-section">
        <div class="adm-view-sec-title">Medical Information</div>
        <div class="adm-view-grid">
          ${_infoRow('Conditions',a.medicalInfo.conditions||'None')}
          ${_infoRow('Allergies',a.medicalInfo.allergies||'None')}
          ${_infoRow('Medications',a.medicalInfo.medications||'None')}
        </div>
      </div>` : ''}

      <!-- Checklist -->
      <div class="adm-view-section">
        <div class="adm-view-sec-title">Admission Checklist</div>
        <div class="adm-checklist-grid">
          ${(cfg.checklistItems||[]).map(it=>{
            const done = a.checklist?.[it.id];
            return `<div class="adm-check-item ${done?'adm-check-done':'adm-check-miss'}">
              <i class="fas fa-${done?'check-circle':'circle'}"></i>
              <span>${it.label}${it.required?' <small style="color:var(--danger)">*</small>':''}</span>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Notes -->
      ${a.notes ? `<div class="adm-view-section"><div class="adm-view-sec-title">Notes</div><p style="font-size:13px;color:var(--gray-600);margin:0">${a.notes}</p></div>` : ''}

      <!-- Rejection reason -->
      ${a.rejectionReason ? `<div class="adm-view-section" style="background:var(--danger-light);border-radius:var(--radius-sm);padding:12px 16px">
        <div class="adm-view-sec-title" style="color:var(--danger)">Rejection Reason</div>
        <p style="font-size:13px;margin:0;color:var(--danger)">${a.rejectionReason}</p>
      </div>` : ''}

      <!-- Footer actions -->
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="_closeModal()">Close</button>
        ${a.status==='draft'||a.status==='pending' ? `<button class="btn btn-primary" onclick="_closeModal();Admissions.editApplication('${a.id}')"><i class="fas fa-pencil-alt"></i> Edit</button>` : ''}
        ${a.status==='pending'  ? `<button class="btn btn-primary"  onclick="_closeModal();Admissions.approveModal('${a.id}')"><i class="fas fa-check"></i> Approve</button>` : ''}
        ${a.status==='approved' ? `<button class="btn btn-success"  onclick="_closeModal();Admissions.enrollModal('${a.id}')"><i class="fas fa-user-check"></i> Enroll Now</button>` : ''}
        ${a.status==='pending'  ? `<button class="btn btn-danger"   onclick="_closeModal();Admissions.rejectModal('${a.id}')"><i class="fas fa-times"></i> Reject</button>` : ''}
      </div>
    </div>
    `, 'lg');
  }

  /* ──────────────────────────────────────────────────────
     APPROVE MODAL
  ────────────────────────────────────────────────────── */
  function approveModal(id) {
    const a    = DB.getById('applications', id);
    if (!a) return;
    const cfg  = _cfg();
    const classes = DB.get('classes');
    const gradeClasses = classes.filter(c => c.grade === Number(a.applyingForGrade));
    const nextAdmNo = _nextAdmNo(cfg);

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-check-circle" style="color:var(--success)"></i> Approve Application</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <div class="adm-approve-banner">
        <div class="adm-approve-name">${a.firstName} ${a.lastName}</div>
        <div style="font-size:13px;color:var(--gray-500)">Applying for Grade ${a.applyingForGrade} · ${_cap(a.source)}</div>
      </div>

      <div class="form-row cols-2 mt-16">
        <div class="form-field">
          <label>Assign Class *</label>
          <select id="approve-class">
            <option value="">— Select Class —</option>
            ${gradeClasses.map(c=>`<option value="${c.id}" ${a.assignedClass===c.id?'selected':''}>${c.name}</option>`).join('')}
            ${!gradeClasses.length?classes.map(c=>`<option value="${c.id}">${c.name}</option>`).join(''):''}
          </select>
        </div>
        <div class="form-field">
          <label>Admission Number</label>
          <input id="approve-admno" value="${a.assignedAdmissionNo||nextAdmNo}" placeholder="${nextAdmNo}">
        </div>
      </div>
      <div class="form-row cols-2 mt-12">
        <div class="form-field">
          <label>Assign House <small style="font-weight:400;color:var(--gray-400)">(optional)</small></label>
          <select id="approve-house">
            <option value="">— No House —</option>
            ${(() => { try { const bCfg = DB.get('behaviour_settings')[0]; return (bCfg?.houses||[]).map(h=>`<option value="${h.id}" ${a.assignedHouseId===h.id?'selected':''}>${h.name}</option>`).join(''); } catch(e) { return ''; } })()}
          </select>
        </div>
      </div>

      <div class="form-field mt-12">
        <label>Approval Notes (optional)</label>
        <textarea id="approve-notes" rows="2" placeholder="Any internal notes about this approval…"></textarea>
      </div>

      <div class="adm-checklist-warn" id="approve-warn" style="display:none">
        <i class="fas fa-exclamation-triangle"></i>
        <span id="approve-warn-text"></span>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Admissions.approveApplication('${id}')"><i class="fas fa-check"></i> Approve Application</button>
      </div>
    </div>
    `, 'sm');

    // Check required checklist items
    setTimeout(() => {
      const cfg2 = _cfg();
      const missingReq = (cfg2.checklistItems||[]).filter(it=>it.required && !a.checklist?.[it.id]);
      if (missingReq.length) {
        const warn = document.getElementById('approve-warn');
        const warnText = document.getElementById('approve-warn-text');
        if (warn) warn.style.display = 'flex';
        if (warnText) warnText.textContent = `Required items not complete: ${missingReq.map(i=>i.label).join(', ')}`;
      }
    }, 100);
  }

  function approveApplication(id) {
    const classId = document.getElementById('approve-class')?.value;
    const admNo   = document.getElementById('approve-admno')?.value.trim();
    const notes   = document.getElementById('approve-notes')?.value.trim();
    const houseId = document.getElementById('approve-house')?.value || null;
    if (!classId) return showToast('Please assign a class.','warning');
    if (!admNo)   return showToast('Admission number required.','warning');
    DB.update('applications', id, {
      status:'approved', assignedClass:classId,
      assignedAdmissionNo:admNo,
      assignedHouseId: houseId || null,
      notes:notes||DB.getById('applications',id)?.notes,
      reviewedBy:Auth.currentUser?.id, reviewedAt:new Date().toISOString()
    });
    showToast('Application approved. Ready to enroll.','success');
    _closeModal(); _renderPipeline();
  }

  /* ──────────────────────────────────────────────────────
     REJECT MODAL
  ────────────────────────────────────────────────────── */
  function rejectModal(id) {
    const a = DB.getById('applications', id);
    if (!a) return;
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-times-circle" style="color:var(--danger)"></i> Reject Application</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--gray-600);margin-bottom:16px">
        You are about to reject the application for <b>${a.firstName} ${a.lastName}</b>.<br>
        Please provide a reason — this will be recorded and can be communicated to the parent.
      </p>
      <div class="form-field mb-12">
        <label>Rejection Reason *</label>
        <textarea id="reject-reason" rows="3" placeholder="e.g. Academic performance below entry threshold of 65%. We encourage re-applying once grades improve…"></textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-danger" onclick="Admissions.rejectApplication('${id}')"><i class="fas fa-times"></i> Reject Application</button>
      </div>
    </div>`, 'sm');
  }

  function rejectApplication(id) {
    const reason = document.getElementById('reject-reason')?.value.trim();
    if (!reason) return showToast('Rejection reason required.','warning');
    DB.update('applications', id, {
      status:'rejected', rejectionReason:reason,
      reviewedBy:Auth.currentUser?.id, reviewedAt:new Date().toISOString()
    });
    showToast('Application rejected.','info');
    _closeModal(); _renderPipeline();
  }

  /* ──────────────────────────────────────────────────────
     ENROLL MODAL → THE CONVERSION ENGINE
  ────────────────────────────────────────────────────── */
  function enrollModal(id) {
    const a = DB.getById('applications', id);
    if (!a || a.status !== 'approved') return showToast('Application must be approved first.','warning');
    const cls = DB.getById('classes', a.assignedClass);
    const house = (() => { try { const bCfg = DB.get('behaviour_settings')[0]; return (bCfg?.houses||[]).find(h=>h.id===a.assignedHouseId)||null; } catch(e){ return null; } })();

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-user-check" style="color:var(--success)"></i> Enroll Student</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <div class="adm-enroll-confirm">
        <div class="adm-enroll-avatar"${house?` style="background:${house.color}"`:''}>${a.firstName.charAt(0)}</div>
        <div>
          <div class="adm-enroll-name">${a.firstName} ${a.lastName}</div>
          <div class="adm-enroll-meta">
            <span><i class="fas fa-id-card"></i> ${a.assignedAdmissionNo}</span>
            <span><i class="fas fa-door-open"></i> ${cls?.name||'Class TBD'}</span>
            ${house?`<span><i class="fas fa-shield-alt" style="color:${house.color}"></i> ${house.name} House</span>`:''}
          </div>
        </div>
      </div>

      <div class="adm-enroll-checklist">
        <div class="adm-enroll-step adm-step-done"><i class="fas fa-check-circle"></i> Student profile created in system</div>
        <div class="adm-enroll-step adm-step-done"><i class="fas fa-check-circle"></i> Login credentials generated</div>
        <div class="adm-enroll-step adm-step-done"><i class="fas fa-check-circle"></i> Assigned to ${cls?.name||'class'}</div>
        <div class="adm-enroll-step adm-step-done"><i class="fas fa-check-circle"></i> Appears in Gradebook &amp; Attendance instantly</div>
        <div class="adm-enroll-step adm-step-done"><i class="fas fa-check-circle"></i> Guardian account linked</div>
        ${house?`<div class="adm-enroll-step adm-step-done"><i class="fas fa-check-circle"></i> House points tracked under <strong>${house.name}</strong></div>`:''}
      </div>

      <div class="form-field mt-16">
        <label>Student Login Email</label>
        <input id="enroll-email" value="${_genEmail(a.firstName, a.lastName)}" placeholder="student@school.edu.ke">
        <small style="color:var(--gray-400)">Auto-generated — you can customise before enrolling</small>
      </div>
      <div class="form-field mt-12">
        <label>Initial Password</label>
        <div style="display:flex;gap:8px">
          <input id="enroll-pass" value="${_genPassword(a.firstName)}" style="flex:1">
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('enroll-pass').value=Admissions._genPass()">Regenerate</button>
        </div>
        <small style="color:var(--gray-400)">Share these credentials with the student/parent securely</small>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
        <button class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="Admissions.enrollStudent('${id}')"><i class="fas fa-user-check"></i> Confirm Enrollment</button>
      </div>
    </div>`, 'sm');
  }

  function enrollStudent(appId) {
    const a     = DB.getById('applications', appId);
    if (!a) return;
    const email = document.getElementById('enroll-email')?.value.trim();
    const pass  = document.getElementById('enroll-pass')?.value.trim();
    if (!email || !pass) return showToast('Email and password required.','warning');

    const cfg = _cfg();
    const admNo = a.assignedAdmissionNo || _nextAdmNo(cfg);

    // 1. Create user record for student
    const userId = 'u_' + Date.now().toString(36);
    DB.insert('users', {
      id: userId, schoolId:'sch1', role:'student',
      name:`${a.firstName} ${a.lastName}`,
      email, password:pass, phone:a.guardians?.[0]?.phone||'',
      avatar:null, isActive:true,
      lastLogin:null, createdAt:new Date().toISOString()
    });

    // 2. Create student record
    // Default enrolled subjects = all core subjects; admin can add electives from student profile
    const coreSubjectIds = DB.get('subjects')
      .filter(sub => sub.isCore)
      .map(sub => sub.id);

    const stuId = 'stu_' + Date.now().toString(36);
    DB.insert('students', {
      id: stuId, schoolId:'sch1', userId,
      admissionNo: admNo,
      firstName:   a.firstName, lastName:  a.lastName,
      gender:      a.gender,    dateOfBirth:a.dateOfBirth,
      nationality: a.nationality, bloodGroup:a.bloodGroup||'',
      classId:     a.assignedClass,
      houseId:     a.assignedHouseId || null,
      status:      'active',
      enrollmentDate: new Date().toISOString().split('T')[0],
      photo: null,
      enrolledSubjectIds: coreSubjectIds,   // core subjects auto-assigned; electives added per student
      guardians: (a.guardians||[]).map(g => ({
        name:g.name, relation:g.relation,
        phone:g.phone, email:g.email, isPrimary:g.isPrimary||false
      })),
      medicalInfo: a.medicalInfo || {},
      createdAt: new Date().toISOString()
    });

    // 3. Increment seq number in settings
    DB.update('admission_settings', cfg.id, { nextSeqNumber: cfg.nextSeqNumber + 1 });

    // 4. Mark application as enrolled
    DB.update('applications', appId, {
      status:'enrolled', studentId:stuId,
      assignedAdmissionNo:admNo,
      reviewedAt:new Date().toISOString()
    });

    showToast(`${a.firstName} ${a.lastName} enrolled as ${admNo}! Student profile active.`, 'success');
    _closeModal();
    _renderPipeline();
  }

  /* ══════════════════════════════════════════════════════════════
     TAB 2 — NEW APPLICATION (Manual Entry Form)
  ══════════════════════════════════════════════════════════════ */
  function _renderNewApp(editId) {
    const panel = document.getElementById('adm-panel');
    if (!panel) return;
    const existing = editId ? DB.getById('applications', editId) : null;
    const cfg = _cfg();
    const classes = DB.get('classes');

    panel.innerHTML = `
    <div class="adm-form-wrap">
      <div class="adm-form-header">
        <h3>${existing?'Edit Application':'New Application'}</h3>
        <p>Fill in the applicant's details. You can save as a draft and complete later.</p>
      </div>
      <form id="adm-main-form" onsubmit="Admissions.saveApplication(event,'${editId||''}')">

        <!-- SECTION: Personal -->
        <div class="adm-form-section">
          <div class="adm-form-sec-title"><i class="fas fa-user"></i> Personal Details</div>
          <div class="form-row cols-3">
            <div class="form-field"><label>First Name *</label><input name="firstName" required value="${existing?.firstName||''}" placeholder="First name"></div>
            <div class="form-field"><label>Last Name *</label><input name="lastName"  required value="${existing?.lastName||''}"  placeholder="Last name"></div>
            <div class="form-field"><label>Gender *</label>
              <select name="gender" required>
                <option value="">— Select —</option>
                <option value="Male"   ${existing?.gender==='Male'?'selected':''}>Male</option>
                <option value="Female" ${existing?.gender==='Female'?'selected':''}>Female</option>
              </select>
            </div>
          </div>
          <div class="form-row cols-3">
            <div class="form-field"><label>Date of Birth *</label><input type="date" name="dateOfBirth" required value="${existing?.dateOfBirth||''}"></div>
            <div class="form-field"><label>Nationality</label><input name="nationality" value="${existing?.nationality||''}" placeholder="e.g. Kenyan"></div>
            <div class="form-field"><label>Blood Group</label>
              <select name="bloodGroup">
                <option value="">— Unknown —</option>
                ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg=>`<option value="${bg}" ${existing?.bloodGroup===bg?'selected':''}>${bg}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- SECTION: Admission Intent -->
        <div class="adm-form-section">
          <div class="adm-form-sec-title"><i class="fas fa-school"></i> Admission Details</div>
          <div class="form-row cols-3">
            <div class="form-field"><label>Applying for Grade *</label>
              <select name="applyingForGrade" required>
                <option value="">— Grade —</option>
                ${[7,8,9,10,11,12].map(g=>`<option value="${g}" ${existing?.applyingForGrade===g?'selected':''}>${g}</option>`).join('')}
              </select>
            </div>
            <div class="form-field"><label>Stream Preference</label>
              <select name="applyingForStream">
                <option value="">No preference</option>
                <option value="A" ${existing?.applyingForStream==='A'?'selected':''}>A</option>
                <option value="B" ${existing?.applyingForStream==='B'?'selected':''}>B</option>
              </select>
            </div>
            <div class="form-field"><label>Preferred Term</label>
              <select name="applyingForTerm">
                <option value="term1" ${existing?.applyingForTerm==='term1'?'selected':''}>Term 1</option>
                <option value="term2" ${(existing?.applyingForTerm||'term2')==='term2'?'selected':''}>Term 2</option>
                <option value="term3" ${existing?.applyingForTerm==='term3'?'selected':''}>Term 3</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SECTION: Previous School -->
        <div class="adm-form-section">
          <div class="adm-form-sec-title"><i class="fas fa-university"></i> Previous School</div>
          <div class="form-row cols-2">
            <div class="form-field"><label>School Name</label><input name="previousSchool" value="${existing?.previousSchool||''}" placeholder="Name of previous school"></div>
            <div class="form-field"><label>Class / Grade Completed</label><input name="previousClass" value="${existing?.previousClass||''}" placeholder="e.g. Grade 8 / Form 2"></div>
          </div>
          <div class="form-row cols-2">
            <div class="form-field"><label>Overall Performance / Grade</label>
              <select name="previousPerformance">
                <option value="">—</option>
                ${['A+','A','B+','B','C+','C','D+','D','F'].map(g=>`<option value="${g}" ${existing?.previousPerformance===g?'selected':''}>${g}</option>`).join('')}
              </select>
            </div>
            <div class="form-field"><label>Average Score (%)</label>
              <input type="number" name="previousAverage" min="0" max="100" value="${existing?.previousAverage||''}" placeholder="e.g. 82">
            </div>
          </div>
        </div>

        <!-- SECTION: Guardian -->
        <div class="adm-form-section">
          <div class="adm-form-sec-title"><i class="fas fa-users"></i> Parent / Guardian</div>
          <div class="form-row cols-2">
            <div class="form-field"><label>Guardian Full Name *</label><input name="guardianName" required value="${existing?.guardians?.[0]?.name||''}" placeholder="Full name"></div>
            <div class="form-field"><label>Relation *</label>
              <select name="guardianRelation" required>
                <option value="">— Select —</option>
                ${['Father','Mother','Guardian','Grandparent','Uncle','Aunt','Sibling'].map(r=>`<option value="${r}" ${existing?.guardians?.[0]?.relation===r?'selected':''}>${r}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row cols-2">
            <div class="form-field"><label>Phone *</label><input name="guardianPhone" required value="${existing?.guardians?.[0]?.phone||''}" placeholder="+254 7XX XXX XXX"></div>
            <div class="form-field"><label>Email</label><input type="email" name="guardianEmail" value="${existing?.guardians?.[0]?.email||''}" placeholder="parent@email.com"></div>
          </div>
        </div>

        <!-- SECTION: Medical -->
        <div class="adm-form-section">
          <div class="adm-form-sec-title"><i class="fas fa-heartbeat"></i> Medical Information <small style="font-weight:400;color:var(--gray-400)">(optional)</small></div>
          <div class="form-row cols-3">
            <div class="form-field"><label>Medical Conditions</label><input name="medConditions" value="${existing?.medicalInfo?.conditions||''}" placeholder="e.g. Asthma, Diabetes or None"></div>
            <div class="form-field"><label>Allergies</label><input name="medAllergies" value="${existing?.medicalInfo?.allergies||''}" placeholder="e.g. Penicillin, Pollen or None"></div>
            <div class="form-field"><label>Medications</label><input name="medMedications" value="${existing?.medicalInfo?.medications||''}" placeholder="e.g. Ventolin inhaler or None"></div>
          </div>
        </div>

        <!-- SECTION: Checklist -->
        <div class="adm-form-section">
          <div class="adm-form-sec-title"><i class="fas fa-clipboard-check"></i> Admission Checklist</div>
          <div class="adm-checklist-form-grid">
            ${(cfg.checklistItems||[]).map(it=>`
              <label class="adm-check-label">
                <input type="checkbox" name="chk_${it.id}" ${existing?.checklist?.[it.id]?'checked':''}>
                <span>${it.label}${it.required?' <span style="color:var(--danger)">*</span>':''}</span>
              </label>`).join('')}
          </div>
        </div>

        <!-- SECTION: Notes -->
        <div class="adm-form-section">
          <div class="adm-form-sec-title"><i class="fas fa-sticky-note"></i> Internal Notes</div>
          <textarea name="notes" rows="3" placeholder="Any additional notes about this applicant…" style="width:100%;padding:10px;border:1.5px solid var(--gray-200);border-radius:var(--radius-sm);font-size:13px;font-family:inherit;resize:vertical">${existing?.notes||''}</textarea>
        </div>

        <!-- Submit buttons -->
        <div class="adm-form-footer">
          <button type="button" class="btn btn-secondary" onclick="Admissions.switchTab('pipeline')">Cancel</button>
          <div style="display:flex;gap:8px">
            <button type="submit" name="action" value="draft" class="btn btn-secondary" onclick="this.form.dataset.action='draft'"><i class="fas fa-save"></i> Save Draft</button>
            <button type="submit" name="action" value="pending" class="btn btn-primary"   onclick="this.form.dataset.action='pending'"><i class="fas fa-paper-plane"></i> Submit Application</button>
          </div>
        </div>
      </form>
    </div>
    `;
  }

  function saveApplication(e, existingId) {
    e.preventDefault();
    const fd     = new FormData(e.target);
    const action = e.target.dataset.action || 'pending';
    const cfg    = _cfg();

    const checklist = {};
    (cfg.checklistItems||[]).forEach(it => {
      checklist[it.id] = !!fd.get(`chk_${it.id}`);
    });

    const data = {
      schoolId: 'sch1', source: 'manual',
      status: action,
      academicYearId: 'ay2025',
      firstName: fd.get('firstName').trim(),
      lastName:  fd.get('lastName').trim(),
      gender:    fd.get('gender'),
      dateOfBirth:    fd.get('dateOfBirth'),
      nationality:    fd.get('nationality').trim(),
      bloodGroup:     fd.get('bloodGroup'),
      applyingForGrade: Number(fd.get('applyingForGrade')),
      applyingForStream:fd.get('applyingForStream'),
      applyingForTerm:  fd.get('applyingForTerm'),
      previousSchool:   fd.get('previousSchool').trim(),
      previousClass:    fd.get('previousClass').trim(),
      previousPerformance: fd.get('previousPerformance'),
      previousAverage: fd.get('previousAverage') ? Number(fd.get('previousAverage')) : null,
      guardians: [{
        name:      fd.get('guardianName').trim(),
        relation:  fd.get('guardianRelation'),
        phone:     fd.get('guardianPhone').trim(),
        email:     fd.get('guardianEmail').trim(),
        isPrimary: true
      }],
      medicalInfo: {
        conditions:  fd.get('medConditions').trim() || 'None',
        allergies:   fd.get('medAllergies').trim()  || 'None',
        medications: fd.get('medMedications').trim()|| 'None'
      },
      checklist,
      notes: fd.get('notes').trim(),
      submittedAt: action === 'pending' ? new Date().toISOString() : null,
      reviewedBy: null, reviewedAt: null, rejectionReason: null,
      assignedClass: null, assignedAdmissionNo: null, studentId: null
    };

    if (!data.firstName || !data.lastName) return showToast('First and last name required.','warning');
    if (!data.applyingForGrade) return showToast('Grade applying for is required.','warning');

    if (existingId) {
      DB.update('applications', existingId, data);
      showToast(`Application ${action==='draft'?'draft saved':'submitted'}.`, 'success');
    } else {
      DB.insert('applications', data);
      showToast(`Application ${action==='draft'?'saved as draft':'submitted successfully'}.`, 'success');
    }

    _tab = 'pipeline'; _renderShell();
  }

  function editApplication(id) {
    _tab = 'new_application';
    _renderNewApp(id);
  }

  /* ══════════════════════════════════════════════════════════════
     TAB 3 — BULK UPLOAD
  ══════════════════════════════════════════════════════════════ */
  function _renderBulkUpload() {
    const panel = document.getElementById('adm-panel');
    if (!panel) return;

    panel.innerHTML = `
    <div class="adm-bulk-wrap">

      <!-- Step indicator -->
      <div class="adm-steps">
        ${[
          {n:1,label:'Download Template'},
          {n:2,label:'Upload File'},
          {n:3,label:'Validate & Preview'},
          {n:4,label:'Import'},
        ].map(s=>`
          <div class="adm-step ${_bulkStep===s.n?'adm-step-active':_bulkStep>s.n?'adm-step-done':''}">
            <div class="adm-step-num">${_bulkStep>s.n?'<i class="fas fa-check"></i>':s.n}</div>
            <div class="adm-step-label">${s.label}</div>
          </div>
          ${s.n<4?'<div class="adm-step-line"></div>':''}`).join('')}
      </div>

      <!-- Step content -->
      <div id="adm-bulk-content"></div>
    </div>
    `;

    _renderBulkStep();
  }

  function _renderBulkStep() {
    const wrap = document.getElementById('adm-bulk-content');
    if (!wrap) return;

    if (_bulkStep === 1) {
      wrap.innerHTML = `
      <div class="adm-step-card">
        <div class="adm-step-icon"><i class="fas fa-file-csv"></i></div>
        <h3>Download the Template</h3>
        <p>Use the official CSV template to ensure all required fields are present. Do not change column headers.</p>

        <div class="adm-template-guide">
          <div class="adm-guide-title">Required Columns</div>
          <div class="adm-guide-grid">
            ${['First Name *','Last Name *','Gender *','Date of Birth * (YYYY-MM-DD)','Grade Applying For *','Guardian Name *','Guardian Phone *'].map(f=>`<div class="adm-guide-field adm-field-required"><i class="fas fa-asterisk"></i> ${f}</div>`).join('')}
          </div>
          <div class="adm-guide-title" style="margin-top:12px">Optional Columns</div>
          <div class="adm-guide-grid">
            ${['Nationality','Blood Group','Stream Preference','Guardian Email','Guardian Relation','Previous School','Previous Class','Previous Grade','Previous Average %','Medical Conditions','Allergies','Notes'].map(f=>`<div class="adm-guide-field"><i class="fas fa-minus"></i> ${f}</div>`).join('')}
          </div>
        </div>

        <div style="display:flex;gap:12px;margin-top:24px;justify-content:center">
          <button class="btn btn-primary" onclick="Admissions.downloadTemplate()"><i class="fas fa-download"></i> Download CSV Template</button>
          <button class="btn btn-secondary" onclick="Admissions._bulkNext()">I already have a file <i class="fas fa-arrow-right"></i></button>
        </div>
      </div>`;

    } else if (_bulkStep === 2) {
      wrap.innerHTML = `
      <div class="adm-step-card">
        <div class="adm-step-icon"><i class="fas fa-cloud-upload-alt"></i></div>
        <h3>Upload Your File</h3>
        <p>Upload a CSV file (.csv). Excel files should be saved as CSV before uploading.</p>

        <div class="adm-upload-zone" id="adm-drop-zone"
          ondrop="Admissions._handleDrop(event)" ondragover="event.preventDefault();this.classList.add('adm-drop-active')" ondragleave="this.classList.remove('adm-drop-active')"
          onclick="document.getElementById('adm-file-inp').click()">
          <i class="fas fa-file-upload" style="font-size:40px;color:var(--gray-300)"></i>
          <p style="margin:10px 0 4px;font-weight:600;color:var(--gray-600)">Drop your CSV file here or click to browse</p>
          <p style="font-size:12px;color:var(--gray-400)">Supports .csv files · Max 5MB</p>
          <input type="file" id="adm-file-inp" accept=".csv,.txt" style="display:none" onchange="Admissions._handleFileSelect(this)">
        </div>

        <div id="adm-file-name" style="margin-top:12px;text-align:center;font-size:13px;color:var(--gray-500)"></div>

        <div style="display:flex;gap:8px;justify-content:center;margin-top:20px">
          <button class="btn btn-secondary" onclick="Admissions._bulkPrev()"><i class="fas fa-arrow-left"></i> Back</button>
          <button class="btn btn-primary" id="adm-parse-btn" disabled onclick="Admissions._parseFile()">Validate File <i class="fas fa-arrow-right"></i></button>
        </div>
      </div>`;

    } else if (_bulkStep === 3) {
      _renderBulkPreview(wrap);

    } else if (_bulkStep === 4) {
      wrap.innerHTML = `
      <div class="adm-step-card" style="text-align:center">
        <div class="adm-step-icon" style="background:var(--success-light);color:var(--success)"><i class="fas fa-check-double"></i></div>
        <h3>Import Complete</h3>
        <p>Your student data has been imported successfully.</p>
        <div class="adm-import-summary" id="adm-import-summary"></div>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:24px">
          <button class="btn btn-secondary" onclick="Admissions._bulkReset()"><i class="fas fa-redo"></i> Upload Another File</button>
          <button class="btn btn-primary" onclick="Admissions.switchTab('pipeline')"><i class="fas fa-stream"></i> View Pipeline</button>
        </div>
      </div>`;
    }
  }

  function _renderBulkPreview(wrap) {
    const validRows   = _bulkData.filter(r => !r._errors?.length);
    const errorRows   = _bulkData.filter(r =>  r._errors?.length);
    const dupRows     = _bulkData.filter(r =>  r._isDuplicate);

    wrap.innerHTML = `
    <div class="adm-preview-header">
      <div class="adm-preview-stat adm-pstat-success"><i class="fas fa-check-circle"></i> ${validRows.length} ready to import</div>
      ${errorRows.length?`<div class="adm-preview-stat adm-pstat-danger"><i class="fas fa-exclamation-circle"></i> ${errorRows.length} with errors</div>`:''}
      ${dupRows.length?`<div class="adm-preview-stat adm-pstat-warning"><i class="fas fa-clone"></i> ${dupRows.length} possible duplicates</div>`:''}
    </div>

    <div class="table-wrap" style="max-height:320px;overflow-y:auto">
      <table class="adm-preview-table">
        <thead><tr>
          <th>#</th><th>First Name</th><th>Last Name</th><th>Gender</th>
          <th>DOB</th><th>Grade</th><th>Guardian</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${_bulkData.map((r,i)=>{
            const hasErr = r._errors?.length;
            const isDup  = r._isDuplicate;
            return `<tr class="${hasErr?'adm-row-error':isDup?'adm-row-warn':'adm-row-ok'}">
              <td style="color:var(--gray-400);font-size:12px">${i+1}</td>
              <td>${r.firstName||'<span style="color:var(--danger)">MISSING</span>'}</td>
              <td>${r.lastName||'<span style="color:var(--danger)">MISSING</span>'}</td>
              <td>${r.gender||'—'}</td>
              <td style="font-size:12px">${r.dateOfBirth||'—'}</td>
              <td>${r.applyingForGrade||'—'}</td>
              <td style="font-size:12px">${r.guardianName||'—'}</td>
              <td>
                ${hasErr?`<span class="badge badge-danger" title="${r._errors.join('; ')}">
                  <i class="fas fa-times"></i> ${r._errors.length} error${r._errors.length>1?'s':''}
                </span>`:''}
                ${isDup&&!hasErr?`<span class="badge badge-warning"><i class="fas fa-clone"></i> Duplicate?</span>`:''}
                ${!hasErr&&!isDup?`<span class="badge badge-success"><i class="fas fa-check"></i> OK</span>`:''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    ${errorRows.length ? `
    <div class="adm-error-log">
      <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--danger)"><i class="fas fa-exclamation-triangle"></i> Errors to fix</div>
      ${errorRows.map(r=>`<div class="adm-error-item">Row: <b>${r.firstName||'?'} ${r.lastName||'?'}</b> — ${r._errors.join(' · ')}</div>`).join('')}
    </div>` : ''}

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:8px">
      <button class="btn btn-secondary" onclick="Admissions._bulkPrev()"><i class="fas fa-arrow-left"></i> Back</button>
      <div style="display:flex;gap:8px">
        ${errorRows.length?`<span style="font-size:13px;color:var(--danger);align-self:center"><i class="fas fa-exclamation-circle"></i> Fix errors before importing</span>`:''}
        <button class="btn btn-primary" ${validRows.length===0||errorRows.length?'disabled':''} onclick="Admissions._doImport()">
          <i class="fas fa-file-import"></i> Import ${validRows.length} Application${validRows.length!==1?'s':''}
        </button>
      </div>
    </div>`;
  }

  function _bulkNext() { _bulkStep = Math.min(_bulkStep+1, 4); _renderBulkStep(); }
  function _bulkPrev() { _bulkStep = Math.max(_bulkStep-1, 1); _renderBulkStep(); }
  function _bulkReset(){ _bulkStep=1; _bulkData=[]; _bulkErrors=[]; _renderBulkStep(); }

  let _pendingFile = null;
  function _handleFileSelect(input) {
    _pendingFile = input.files?.[0] || null;
    if (_pendingFile) {
      document.getElementById('adm-file-name').textContent = `Selected: ${_pendingFile.name} (${(_pendingFile.size/1024).toFixed(1)} KB)`;
      const btn = document.getElementById('adm-parse-btn');
      if (btn) btn.disabled = false;
    }
  }
  function _handleDrop(e) {
    e.preventDefault();
    document.getElementById('adm-drop-zone')?.classList.remove('adm-drop-active');
    _pendingFile = e.dataTransfer.files?.[0];
    if (_pendingFile) {
      document.getElementById('adm-file-name').textContent = `Dropped: ${_pendingFile.name}`;
      const btn = document.getElementById('adm-parse-btn');
      if (btn) btn.disabled = false;
    }
  }

  function _parseFile() {
    if (!_pendingFile) return showToast('No file selected.','warning');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = _parseCSV(e.target.result);
        _bulkData  = _validateRows(rows);
        _bulkStep  = 3;
        _renderBulkStep();
      } catch(err) {
        showToast('Could not parse file: ' + err.message, 'error');
      }
    };
    reader.readAsText(_pendingFile);
  }

  function _parseCSV(text) {
    const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim());
    if (lines.length < 2) throw new Error('File has no data rows.');
    const rawHeaders = lines[0].split(',').map(h=>h.replace(/"/g,'').trim().toLowerCase());

    // Map raw header names to our field keys
    const headerMap = {
      'first name':'firstName','firstname':'firstName',
      'last name':'lastName','lastname':'lastName','surname':'lastName',
      'gender':'gender',
      'date of birth':'dateOfBirth','dob':'dateOfBirth','birth date':'dateOfBirth',
      'nationality':'nationality',
      'blood group':'bloodGroup','blood':'bloodGroup',
      'grade applying for':'applyingForGrade','grade':'applyingForGrade','grade for':'applyingForGrade',
      'stream preference':'applyingForStream','stream':'applyingForStream',
      'guardian name':'guardianName','parent name':'guardianName','father':'guardianName',
      'guardian phone':'guardianPhone','phone':'guardianPhone','mobile':'guardianPhone',
      'guardian email':'guardianEmail','email':'guardianEmail','parent email':'guardianEmail',
      'guardian relation':'guardianRelation','relation':'guardianRelation',
      'previous school':'previousSchool','prev school':'previousSchool',
      'previous class':'previousClass','prev class':'previousClass',
      'previous grade':'previousPerformance','prev grade':'previousPerformance',
      'previous average %':'previousAverage','previous average':'previousAverage','avg':'previousAverage',
      'medical conditions':'medConditions','conditions':'medConditions',
      'allergies':'medAllergies',
      'notes':'notes',
    };

    const fields = rawHeaders.map(h => headerMap[h] || h);

    return lines.slice(1).map(line => {
      const vals = _splitCSVLine(line);
      const obj  = {};
      fields.forEach((f,i) => { obj[f] = (vals[i]||'').replace(/"/g,'').trim(); });
      return obj;
    }).filter(r => Object.values(r).some(v=>v));
  }

  function _splitCSVLine(line) {
    const result = []; let cur=''; let inQ=false;
    for (let i=0;i<line.length;i++) {
      const ch=line[i];
      if (ch==='"') { inQ=!inQ; continue; }
      if (ch===',' && !inQ) { result.push(cur); cur=''; }
      else cur+=ch;
    }
    result.push(cur);
    return result;
  }

  function _validateRows(rows) {
    const existing = DB.get('applications');
    const existingStudents = DB.get('students');
    return rows.map(r => {
      const errors = [];
      if (!r.firstName) errors.push('First name missing');
      if (!r.lastName)  errors.push('Last name missing');
      if (!r.gender || !['male','female'].includes(r.gender.toLowerCase())) errors.push('Invalid gender (use Male/Female)');
      if (!r.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(r.dateOfBirth)) errors.push('Date of birth must be YYYY-MM-DD');
      if (!r.applyingForGrade || isNaN(Number(r.applyingForGrade))) errors.push('Grade applying for is required and must be a number');
      if (!r.guardianName)  errors.push('Guardian name missing');
      if (!r.guardianPhone) errors.push('Guardian phone missing');

      // Gender normalize
      if (r.gender) r.gender = r.gender.charAt(0).toUpperCase()+r.gender.slice(1).toLowerCase();

      // Duplicate check
      const isDup = existing.some(a =>
        a.firstName.toLowerCase()===r.firstName?.toLowerCase() &&
        a.lastName.toLowerCase()===r.lastName?.toLowerCase()
      ) || existingStudents.some(s =>
        s.firstName.toLowerCase()===r.firstName?.toLowerCase() &&
        s.lastName.toLowerCase()===r.lastName?.toLowerCase()
      );

      r._errors = errors;
      r._isDuplicate = isDup && !errors.length;
      r.applyingForGrade = Number(r.applyingForGrade) || 7;
      r.previousAverage  = r.previousAverage ? Number(r.previousAverage) : null;
      return r;
    });
  }

  function _doImport() {
    const cfg  = _cfg();
    const valid= _bulkData.filter(r=>!r._errors?.length);
    let imported = 0;
    valid.forEach(r => {
      const checklist = {};
      (cfg.checklistItems||[]).forEach(it=>{ checklist[it.id]=false; });
      DB.insert('applications', {
        schoolId:'sch1', source:'bulk', status:'pending',
        academicYearId:'ay2025',
        firstName:r.firstName, lastName:r.lastName,
        gender:r.gender||'', dateOfBirth:r.dateOfBirth,
        nationality:r.nationality||'', bloodGroup:r.bloodGroup||'',
        applyingForGrade:r.applyingForGrade, applyingForStream:r.applyingForStream||'',
        applyingForTerm:'term3',
        previousSchool:r.previousSchool||'', previousClass:r.previousClass||'',
        previousPerformance:r.previousPerformance||'',
        previousAverage:r.previousAverage,
        guardians:[{name:r.guardianName,relation:r.guardianRelation||'Guardian',phone:r.guardianPhone,email:r.guardianEmail||'',isPrimary:true}],
        medicalInfo:{conditions:r.medConditions||'None',allergies:r.medAllergies||'None',medications:'None'},
        checklist, notes:r.notes||'Imported via bulk upload.',
        submittedAt:new Date().toISOString(), createdAt:new Date().toISOString(),
        reviewedBy:null,reviewedAt:null,rejectionReason:null,
        assignedClass:null,assignedAdmissionNo:null,studentId:null
      });
      imported++;
    });

    // Show summary
    _bulkStep = 4;
    _renderBulkStep();
    setTimeout(()=>{
      const summary = document.getElementById('adm-import-summary');
      if (summary) summary.innerHTML = `
        <div class="adm-import-row adm-import-ok"><i class="fas fa-check-circle"></i> ${imported} applications created</div>
        ${_bulkData.filter(r=>r._errors?.length).length?`<div class="adm-import-row adm-import-err"><i class="fas fa-times-circle"></i> ${_bulkData.filter(r=>r._errors?.length).length} rows skipped (errors)</div>`:''}
        ${_bulkData.filter(r=>r._isDuplicate).length?`<div class="adm-import-row adm-import-warn"><i class="fas fa-clone"></i> ${_bulkData.filter(r=>r._isDuplicate).length} possible duplicates imported</div>`:''}
      `;
    }, 100);
    showToast(`${imported} application${imported!==1?'s':''} imported.`, 'success');
  }

  function downloadTemplate() {
    const headers = ['First Name','Last Name','Gender','Date of Birth','Nationality','Blood Group','Grade Applying For','Stream Preference','Guardian Name','Guardian Phone','Guardian Email','Guardian Relation','Previous School','Previous Class','Previous Grade','Previous Average %','Medical Conditions','Allergies','Notes'];
    const example = ['John','Doe','Male','2011-05-14','Kenyan','O+','9','A','Mr. James Doe','+254 722 123 456','james.doe@email.com','Father','Nairobi Academy','Grade 8','B+','78','None','None',''];
    const csv = [headers.join(','), example.join(',')].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'SchoolSync_Admissions_Template.csv';
    a.click(); URL.revokeObjectURL(url);
    showToast('Template downloaded.','success');
  }

  /* ══════════════════════════════════════════════════════════════
     TAB 4 — ONLINE FORM
  ══════════════════════════════════════════════════════════════ */
  function _renderOnlineForm() {
    const panel = document.getElementById('adm-panel');
    if (!panel) return;
    const cfg   = _cfg();
    const link  = `${location.origin}${location.pathname}#apply/${cfg.onlineFormToken}`;

    panel.innerHTML = `
    <div class="adm-online-wrap">

      <!-- Status card -->
      <div class="adm-online-status ${cfg.onlineFormEnabled?'adm-online-on':'adm-online-off'}">
        <div>
          <div class="adm-online-status-title">
            <i class="fas fa-${cfg.onlineFormEnabled?'globe':'globe-slash'}"></i>
            Online Admissions Form is <b>${cfg.onlineFormEnabled?'OPEN':'CLOSED'}</b>
          </div>
          <div class="adm-online-status-sub">
            ${cfg.onlineFormEnabled
              ? `Applications are being accepted · Deadline: ${cfg.onlineFormDeadline?fmtDate(cfg.onlineFormDeadline):'Not set'}`
              : 'The public form is disabled. Enable it to start receiving online applications.'}
          </div>
        </div>
        <button class="btn ${cfg.onlineFormEnabled?'btn-danger':'btn-success'}" onclick="Admissions.toggleOnlineForm()">
          <i class="fas fa-${cfg.onlineFormEnabled?'times-circle':'check-circle'}"></i>
          ${cfg.onlineFormEnabled?'Close Form':'Open Form'}
        </button>
      </div>

      <!-- Share link -->
      ${cfg.onlineFormEnabled ? `
      <div class="card mb-16">
        <div class="card-header"><div class="card-title"><i class="fas fa-link"></i> Shareable Application Link</div></div>
        <div style="padding:0 20px 20px">
          <div class="adm-link-row">
            <input id="adm-form-link" value="${link}" readonly class="adm-link-input">
            <button class="btn btn-primary" onclick="Admissions.copyLink()"><i class="fas fa-copy"></i> Copy</button>
          </div>
          <div style="font-size:12px;color:var(--gray-400);margin-top:8px">
            Share this link on your school website, social media, or via email. Parents fill it without logging in.
          </div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn btn-sm btn-secondary" onclick="Admissions._previewForm()"><i class="fas fa-eye"></i> Preview Form</button>
            <a class="btn btn-sm btn-secondary" href="${link}" target="_blank"><i class="fas fa-external-link-alt"></i> Open in New Tab</a>
          </div>
        </div>
      </div>` : ''}

      <!-- Form stats -->
      <div class="card mb-16">
        <div class="card-header"><div class="card-title"><i class="fas fa-chart-pie"></i> Online Applications Received</div></div>
        <div style="padding:0 20px 20px">
          ${(() => {
            const onlineApps = DB.query('applications', a=>a.source==='online');
            const stats = {
              total: onlineApps.length,
              pending:  onlineApps.filter(a=>a.status==='pending').length,
              approved: onlineApps.filter(a=>a.status==='approved').length,
              enrolled: onlineApps.filter(a=>a.status==='enrolled').length,
              rejected: onlineApps.filter(a=>a.status==='rejected').length,
            };
            return `<div class="adm-online-stats-row">
              ${[['Total',stats.total,'fas fa-inbox','primary'],['Pending',stats.pending,'fas fa-clock','warning'],['Approved',stats.approved,'fas fa-check','primary'],['Enrolled',stats.enrolled,'fas fa-user-check','success'],['Rejected',stats.rejected,'fas fa-times','danger']].map(([l,v,ic,col])=>`
              <div class="adm-online-stat">
                <i class="${ic}" style="color:var(--${col});font-size:18px"></i>
                <div class="adm-online-stat-val">${v}</div>
                <div class="adm-online-stat-label">${l}</div>
              </div>`).join('')}
            </div>`;
          })()}
        </div>
      </div>

      <!-- Form config -->
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-sliders-h"></i> Form Configuration</div>
        </div>
        <div style="padding:0 20px 20px">
          <div class="form-row cols-2">
            <div class="form-field">
              <label>Form Title</label>
              <input id="ol-form-title" value="${cfg.onlineFormTitle||''}" placeholder="Apply to Our School">
            </div>
            <div class="form-field">
              <label>Application Deadline</label>
              <input type="date" id="ol-form-deadline" value="${cfg.onlineFormDeadline||''}">
            </div>
          </div>
          <div class="form-field mt-12">
            <label>Access Token (in the URL)</label>
            <input id="ol-form-token" value="${cfg.onlineFormToken||''}" placeholder="e.g. mis2025open">
            <small style="color:var(--gray-400)">Change this to invalidate old links</small>
          </div>
          <button class="btn btn-primary mt-12" onclick="Admissions.saveOnlineFormConfig()"><i class="fas fa-save"></i> Save Configuration</button>
        </div>
      </div>
    </div>
    `;
  }

  function toggleOnlineForm() {
    const cfg = _cfg();
    DB.update('admission_settings', cfg.id, { onlineFormEnabled: !cfg.onlineFormEnabled });
    showToast(`Online form ${!cfg.onlineFormEnabled?'opened':'closed'}.`, 'success');
    _renderOnlineForm();
  }

  function copyLink() {
    const inp = document.getElementById('adm-form-link');
    if (!inp) return;
    navigator.clipboard?.writeText(inp.value).then(()=>showToast('Link copied to clipboard!','success')).catch(()=>{
      inp.select(); document.execCommand('copy'); showToast('Link copied!','success');
    });
  }

  function saveOnlineFormConfig() {
    const cfg = _cfg();
    DB.update('admission_settings', cfg.id, {
      onlineFormTitle:    document.getElementById('ol-form-title')?.value.trim()  || cfg.onlineFormTitle,
      onlineFormDeadline: document.getElementById('ol-form-deadline')?.value       || cfg.onlineFormDeadline,
      onlineFormToken:    document.getElementById('ol-form-token')?.value.trim()   || cfg.onlineFormToken,
    });
    showToast('Online form settings saved.','success');
    _renderOnlineForm();
  }

  function _previewForm() {
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-eye"></i> Online Form Preview</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body" style="background:var(--gray-50)">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:var(--radius);padding:24px;box-shadow:var(--shadow-md)">
        ${_publicFormHTML(_cfg(), true)}
      </div>
    </div>`, 'lg');
  }

  /* ══════════════════════════════════════════════════════════════
     TAB 5 — SETTINGS
  ══════════════════════════════════════════════════════════════ */
  function _renderSettings() {
    const panel = document.getElementById('adm-panel');
    if (!panel) return;
    const cfg   = _cfg();
    const nextNo= _nextAdmNo(cfg);

    panel.innerHTML = `
    <div class="adm-settings-wrap">

      <!-- Numbering -->
      <div class="card mb-16">
        <div class="card-header"><div class="card-title"><i class="fas fa-sort-numeric-up"></i> Admission Number Format</div></div>
        <div style="padding:0 20px 20px">
          <div class="form-row cols-3">
            <div class="form-field">
              <label>Prefix</label>
              <input id="cfg-prefix" value="${cfg.admissionNoPrefix||'MIS'}" placeholder="e.g. MIS">
            </div>
            <div class="form-field">
              <label>Year</label>
              <input id="cfg-year" value="${cfg.admissionNoYear||'2025'}" placeholder="e.g. 2025" maxlength="4">
            </div>
            <div class="form-field">
              <label>Next Sequence</label>
              <input type="number" id="cfg-seq" value="${cfg.nextSeqNumber||1}" min="1">
            </div>
          </div>
          <div class="form-field mt-12">
            <label>Zero-Pad Length</label>
            <select id="cfg-pad">
              ${[2,3,4].map(n=>`<option value="${n}" ${(cfg.zeroPad||3)===n?'selected':''}>${n} digits (e.g. ${'0'.repeat(n-1)}1)</option>`).join('')}
            </select>
          </div>
          <div class="adm-preview-no">
            <span style="font-size:12px;color:var(--gray-500)">Preview:</span>
            <span id="cfg-preview-no" class="adm-preview-number">${nextNo}</span>
          </div>
          <button class="btn btn-primary" onclick="Admissions.saveNumberingConfig()"><i class="fas fa-save"></i> Save Numbering</button>
        </div>
      </div>

      <!-- Checklist items -->
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-clipboard-list"></i> Admission Checklist</div>
          <button class="btn btn-sm btn-primary" onclick="Admissions.addChecklistItem()"><i class="fas fa-plus"></i> Add Item</button>
        </div>
        <div style="padding:0 20px 16px">
          <p style="font-size:13px;color:var(--gray-500);margin:0 0 12px">Required items must be complete before an application can be approved.</p>
          <div id="adm-checklist-items">
            ${(cfg.checklistItems||[]).map((it,i)=>`
            <div class="adm-checklist-cfg-row" data-id="${it.id}">
              <i class="fas fa-grip-vertical adm-drag-handle"></i>
              <input class="adm-cfg-label-inp" value="${it.label}" data-id="${it.id}" onchange="Admissions.updateChecklistLabel('${it.id}',this.value)">
              <label class="adm-toggle-required">
                <input type="checkbox" ${it.required?'checked':''} onchange="Admissions.toggleChecklistRequired('${it.id}',this.checked)">
                <span>Required</span>
              </label>
              <button class="btn btn-sm btn-ghost danger" onclick="Admissions.deleteChecklistItem('${it.id}')"><i class="fas fa-trash"></i></button>
            </div>`).join('')}
          </div>
        </div>
      </div>
    </div>
    `;
  }

  function saveNumberingConfig() {
    const cfg = _cfg();
    const prefix = document.getElementById('cfg-prefix')?.value.trim()||'MIS';
    const year   = document.getElementById('cfg-year')?.value.trim()||'2025';
    const seq    = Number(document.getElementById('cfg-seq')?.value)||1;
    const pad    = Number(document.getElementById('cfg-pad')?.value)||3;
    DB.update('admission_settings', cfg.id, { admissionNoPrefix:prefix, admissionNoYear:year, nextSeqNumber:seq, zeroPad:pad });
    const preview = document.getElementById('cfg-preview-no');
    if (preview) preview.textContent = `${prefix}-${year}-${String(seq).padStart(pad,'0')}`;
    showToast('Numbering config saved.','success');
  }

  function addChecklistItem() {
    const label = prompt('Enter checklist item label:');
    if (!label) return;
    const cfg = _cfg();
    const id  = label.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const items = [...(cfg.checklistItems||[]), { id, label:label.trim(), required:false }];
    DB.update('admission_settings', cfg.id, { checklistItems:items });
    showToast('Item added.','success');
    _renderSettings();
  }

  function deleteChecklistItem(id) {
    confirmAction('Remove this checklist item?', ()=>{
      const cfg   = _cfg();
      const items = (cfg.checklistItems||[]).filter(it=>it.id!==id);
      DB.update('admission_settings', cfg.id, { checklistItems:items });
      showToast('Item removed.','info');
      _renderSettings();
    });
  }

  function updateChecklistLabel(id, val) {
    const cfg   = _cfg();
    const items = (cfg.checklistItems||[]).map(it=>it.id===id?{...it,label:val}:it);
    DB.update('admission_settings', cfg.id, { checklistItems:items });
  }

  function toggleChecklistRequired(id, checked) {
    const cfg   = _cfg();
    const items = (cfg.checklistItems||[]).map(it=>it.id===id?{...it,required:checked}:it);
    DB.update('admission_settings', cfg.id, { checklistItems:items });
    showToast(`"${id}" marked as ${checked?'required':'optional'}.`,'info');
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC FORM (no auth required — hash #apply/TOKEN)
  ══════════════════════════════════════════════════════════════ */
  function renderPublicForm(tokenOrParam, container) {
    const cfg = _cfg();
    const token = tokenOrParam || '';

    // If token doesn't match and form is closed, block
    if (!cfg.onlineFormEnabled && token !== cfg.onlineFormToken) {
      const html = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--gray-50)">
        <div style="text-align:center;padding:60px 24px">
          <i class="fas fa-lock" style="font-size:64px;color:var(--gray-300)"></i>
          <h2 style="margin:16px 0 8px;color:var(--gray-700)">Applications Closed</h2>
          <p style="color:var(--gray-400)">Online admissions are currently closed. Please contact the school directly.</p>
        </div>
      </div>`;
      if (container) { container.innerHTML = html; return; }
      App.renderPage(html); return;
    }

    const formHTML = `
    <div class="adm-public-wrap">
      <div class="adm-public-header">
        <div class="adm-public-school">${DB.get('schools')[0]?.name||'School'}</div>
        <div class="adm-public-title">${cfg.onlineFormTitle||'Online Admission Application'}</div>
        ${cfg.onlineFormDeadline?`<div class="adm-public-deadline"><i class="fas fa-clock"></i> Application deadline: <b>${fmtDate(cfg.onlineFormDeadline)}</b></div>`:''}
      </div>

      <div class="adm-public-card">
        <form id="public-adm-form" onsubmit="Admissions.submitPublicForm(event,'${token}')">

          <div class="adm-form-sec-title"><i class="fas fa-user"></i> Student Details</div>
          <div class="form-row cols-2 mb-12">
            <div class="form-field"><label>First Name *</label><input name="firstName" required placeholder="First name"></div>
            <div class="form-field"><label>Last Name *</label><input name="lastName" required placeholder="Last name"></div>
          </div>
          <div class="form-row cols-3">
            <div class="form-field"><label>Gender *</label>
              <select name="gender" required><option value="">— Select —</option><option>Male</option><option>Female</option></select>
            </div>
            <div class="form-field"><label>Date of Birth *</label><input type="date" name="dateOfBirth" required></div>
            <div class="form-field"><label>Nationality</label><input name="nationality" placeholder="e.g. Kenyan"></div>
          </div>

          <div class="adm-form-sec-title mt-20"><i class="fas fa-school"></i> Admission Details</div>
          <div class="form-row cols-2">
            <div class="form-field"><label>Grade Applying For *</label>
              <select name="applyingForGrade" required><option value="">— Select Grade —</option>${[7,8,9,10,11,12].map(g=>`<option value="${g}">Grade ${g}</option>`).join('')}</select>
            </div>
            <div class="form-field"><label>Previous School</label><input name="previousSchool" placeholder="Name of previous school"></div>
          </div>

          <div class="adm-form-sec-title mt-20"><i class="fas fa-users"></i> Parent / Guardian</div>
          <div class="form-row cols-2">
            <div class="form-field"><label>Guardian Full Name *</label><input name="guardianName" required placeholder="Full name"></div>
            <div class="form-field"><label>Phone Number *</label><input name="guardianPhone" required placeholder="+254 7XX XXX XXX"></div>
          </div>
          <div class="form-field mb-12"><label>Email Address</label><input type="email" name="guardianEmail" placeholder="parent@email.com"></div>

          <div class="adm-form-sec-title mt-20"><i class="fas fa-heartbeat"></i> Medical (optional)</div>
          <div class="form-row cols-2">
            <div class="form-field"><label>Medical Conditions</label><input name="medConditions" placeholder="None if not applicable"></div>
            <div class="form-field"><label>Allergies</label><input name="medAllergies" placeholder="None if not applicable"></div>
          </div>

          <div class="form-field mt-16 mb-0">
            <label>Additional Message (optional)</label>
            <textarea name="notes" rows="2" style="width:100%;padding:10px;border:1.5px solid var(--gray-200);border-radius:var(--radius-sm);font-family:inherit;font-size:13px" placeholder="Any other information you'd like us to know…"></textarea>
          </div>

          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:20px;padding:14px;font-size:15px">
            <i class="fas fa-paper-plane"></i> Submit Application
          </button>
        </form>
        <div id="public-form-success" style="display:none;text-align:center;padding:40px">
          <i class="fas fa-check-circle" style="font-size:60px;color:var(--success)"></i>
          <h2 style="margin:16px 0 8px;color:var(--gray-800)">Application Received!</h2>
          <p style="color:var(--gray-500)">Thank you. We will review your application and contact you shortly.</p>
        </div>
      </div>
      <div class="adm-public-footer">Powered by SchoolSync · ${DB.get('schools')[0]?.name}</div>
    </div>`;

    if (container) { container.innerHTML = formHTML; }
    else           { App.renderPage(formHTML); }
  }

  function submitPublicForm(e, token) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const cfg  = _cfg();
    const checklist = {};
    (cfg.checklistItems||[]).forEach(it=>{ checklist[it.id]=false; });
    DB.insert('applications', {
      schoolId:'sch1', source:'online', status:'pending',
      academicYearId:'ay2025',
      firstName: fd.get('firstName').trim(),
      lastName:  fd.get('lastName').trim(),
      gender:    fd.get('gender'),
      dateOfBirth: fd.get('dateOfBirth'),
      nationality: fd.get('nationality').trim(),
      bloodGroup: '',
      applyingForGrade: Number(fd.get('applyingForGrade')),
      applyingForStream:'', applyingForTerm:'term3',
      previousSchool: fd.get('previousSchool').trim(),
      previousClass:'', previousPerformance:'', previousAverage:null,
      guardians:[{ name:fd.get('guardianName').trim(), relation:'Guardian', phone:fd.get('guardianPhone').trim(), email:fd.get('guardianEmail').trim(), isPrimary:true }],
      medicalInfo:{ conditions:fd.get('medConditions')||'None', allergies:fd.get('medAllergies')||'None', medications:'None' },
      checklist, notes:fd.get('notes')||'',
      submittedAt:new Date().toISOString(), createdAt:new Date().toISOString(),
      reviewedBy:null,reviewedAt:null,rejectionReason:null,
      assignedClass:null,assignedAdmissionNo:null,studentId:null
    });
    // Show success without redirecting
    e.target.style.display='none';
    document.getElementById('public-form-success').style.display='block';
  }

  /* ══════════════════════════════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════════════════════════════ */
  function _cfg() {
    return DB.get('admission_settings')[0] || {
      id:'adm_cfg', admissionNoPrefix:'MIS', admissionNoYear:'2025',
      nextSeqNumber:21, zeroPad:3, onlineFormEnabled:true,
      onlineFormToken:'mis2025open', checklistItems:[], schoolId:'sch1'
    };
  }

  function _nextAdmNo(cfg) {
    const prefix = cfg.admissionNoPrefix||'MIS';
    const year   = cfg.admissionNoYear||'2025';
    const seq    = String(cfg.nextSeqNumber||1).padStart(cfg.zeroPad||3,'0');
    return `${prefix}-${year}-${seq}`;
  }

  function _genEmail(first, last) {
    const school = DB.get('schools')[0];
    const domain = school?.email?.split('@')[1] || 'meridian.edu.ke';
    return `${first.toLowerCase()}.${last.toLowerCase().replace(/'/g,'')}@${domain}`;
  }

  function _genPassword(firstName) {
    return firstName.toLowerCase().replace(/\s/g,'') + Math.floor(1000+Math.random()*9000);
  }

  function _genPass() { return 'Pass' + Math.floor(10000+Math.random()*90000) + '!'; }

  function _infoRow(label, value) {
    return `<div class="adm-view-row"><span class="adm-view-label">${label}</span><span class="adm-view-val">${value||'—'}</span></div>`;
  }

  function _cap(s) { return s ? s.charAt(0).toUpperCase()+s.slice(1) : ''; }

  function _termLabel(t) {
    return t==='term1'?'Term 1':t==='term2'?'Term 2':t==='term3'?'Term 3':t;
  }

  function _publicFormHTML(cfg, preview) {
    return `<div style="font-size:18px;font-weight:800;margin-bottom:16px;text-align:center;color:var(--primary)">${cfg.onlineFormTitle||'Admission Application'}</div>
    <div style="font-size:13px;color:var(--gray-500);margin-bottom:20px;text-align:center">Fill out all required fields (*) and submit.</div>
    ${['Student Name', 'Gender', 'Date of Birth', 'Grade Applying For', 'Guardian Name', 'Guardian Phone'].map(f=>`<div style="margin-bottom:12px"><label style="font-size:12px;font-weight:600;color:var(--gray-600)">${f} *</label><div style="height:36px;background:var(--gray-100);border-radius:6px;margin-top:4px"></div></div>`).join('')}
    <div style="height:40px;background:var(--primary);border-radius:8px;margin-top:16px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">Submit Application</div>`;
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════ */
  return {
    render, renderPublicForm, switchTab,
    // Pipeline
    setFilter, search, clearFilters,
    viewApplication, approveModal, approveApplication,
    rejectModal, rejectApplication, enrollModal, enrollStudent,
    // New Application
    saveApplication, editApplication,
    // Bulk Upload
    downloadTemplate,
    _handleFileSelect, _handleDrop, _parseFile,
    _bulkNext, _bulkPrev, _bulkReset, _doImport, _genPass,
    // Online Form
    toggleOnlineForm, copyLink, saveOnlineFormConfig, _previewForm, submitPublicForm,
    // Settings
    saveNumberingConfig, addChecklistItem, deleteChecklistItem,
    updateChecklistLabel, toggleChecklistRequired,
  };
})();
