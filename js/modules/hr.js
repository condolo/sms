/* ============================================================
   InnoLearn — HR & Staff Module
   (Includes Teachers & Staff, merged)
   ============================================================ */

const HR = (() => {
  let _tab    = 'staff';
  let _filter = { q: '', dept: '', section: '', contractType: '', status: '', payPeriod: '2025-04' };

  /* ── Constants ── */
  const LEAVE_TYPES  = { annual:'Annual Leave', sick:'Sick Leave', emergency:'Emergency', maternity:'Maternity', paternity:'Paternity', unpaid:'Unpaid Leave' };
  const LEAVE_COLORS = { annual:'primary', sick:'warning', emergency:'danger', maternity:'purple', paternity:'secondary', unpaid:'secondary' };
  const DOC_TYPES    = { contract:'Contract', appraisal:'Appraisal', certificate:'Certificate', id_copy:'ID Copy', other:'Other' };
  const DOC_ICONS    = { contract:'fas fa-file-signature', appraisal:'fas fa-star', certificate:'fas fa-award', id_copy:'fas fa-id-card', other:'fas fa-file' };

  /* ── Section colour palette for badges ── */
  const SEC_COLORS = ['#2563EB','#7C3AED','#059669','#D97706','#DC2626'];

  /* ─────────────────────────────────────────────────────────── */
  /*  ENTRY POINT                                                */
  /* ─────────────────────────────────────────────────────────── */
  function render(param) {
    // param = teacher id (from #hr/tch1 or legacy #teachers/tch1)
    if (param) return _renderProfile(param);
    if (!Auth.isHR() && !Auth.isAdmin()) return _renderSelfView();
    _renderMain();
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  MAIN VIEW (HR / Admin)                                     */
  /* ─────────────────────────────────────────────────────────── */
  function _renderMain() {
    App.setBreadcrumb('<i class="fas fa-id-card"></i> HR & Staff');
    const teachers   = DB.get('teachers');
    const active     = teachers.filter(t => t.status === 'active').length;
    const onLeave    = teachers.filter(t => t.status === 'on_leave').length;
    const inactive   = teachers.filter(t => t.status === 'inactive').length;
    const pendLeaves = DB.query('leave_requests', l => l.status === 'pending').length;
    const totalPayroll = DB.query('payroll', p => p.payPeriod === _filter.payPeriod)
                           .reduce((s,p) => s + p.netSalary, 0);

    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1>HR &amp; Staff</h1>
        <p>${active} active · ${onLeave} on leave · ${inactive} inactive</p>
      </div>
      <div class="page-actions">
        ${Auth.isAdmin() ? `<button class="btn btn-primary" onclick="HR.openStaffModal()"><i class="fas fa-user-plus"></i> Add Staff</button>` : ''}
        ${pendLeaves ? `<button class="btn btn-secondary" onclick="HR.switchTab('leave')" style="position:relative">
          <i class="fas fa-calendar-times"></i> Leave
          <span style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border-radius:99px;font-size:10px;font-weight:700;width:18px;height:18px;display:flex;align-items:center;justify-content:center">${pendLeaves}</span>
        </button>` : ''}
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-users"></i></div>
        <div class="stat-body"><div class="stat-value">${active}</div><div class="stat-label">Active Staff</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow"><i class="fas fa-user-clock"></i></div>
        <div class="stat-body"><div class="stat-value">${onLeave}</div><div class="stat-label">On Leave</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red"><i class="fas fa-user-times"></i></div>
        <div class="stat-body"><div class="stat-value">${inactive}</div><div class="stat-label">Inactive</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple"><i class="fas fa-money-bill-wave"></i></div>
        <div class="stat-body"><div class="stat-value">${fmtMoney(totalPayroll)}</div><div class="stat-label">Monthly Net Payroll</div></div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs" id="hr-tabs">
      <button class="tab-btn ${_tab==='staff'?'active':''}"     onclick="HR.switchTab('staff')"><i class="fas fa-chalkboard-teacher"></i> Staff</button>
      <button class="tab-btn ${_tab==='leave'?'active':''}"     onclick="HR.switchTab('leave')" style="position:relative">
        <i class="fas fa-calendar-times"></i> Leave
        ${pendLeaves ? `<span style="background:var(--danger);color:#fff;border-radius:99px;font-size:9px;font-weight:700;padding:1px 5px;margin-left:4px">${pendLeaves}</span>` : ''}
      </button>
      <button class="tab-btn ${_tab==='payroll'?'active':''}"   onclick="HR.switchTab('payroll')"><i class="fas fa-money-check-alt"></i> Payroll</button>
      <button class="tab-btn ${_tab==='documents'?'active':''}" onclick="HR.switchTab('documents')"><i class="fas fa-folder-open"></i> Documents</button>
    </div>

    <div id="hr-tab-staff"     style="display:${_tab==='staff'?'block':'none'}">${_staffPanel()}</div>
    <div id="hr-tab-leave"     style="display:${_tab==='leave'?'block':'none'}">${_leavePanel()}</div>
    <div id="hr-tab-payroll"   style="display:${_tab==='payroll'?'block':'none'}">${_payrollPanel()}</div>
    <div id="hr-tab-documents" style="display:${_tab==='documents'?'block':'none'}">${_documentsPanel()}</div>
    `);
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  STAFF PANEL (card grid — was Teachers module)              */
  /* ─────────────────────────────────────────────────────────── */
  function _staffPanel() {
    const allTeachers = DB.get('teachers');
    const depts = [...new Set(allTeachers.map(t => {
      const s = DB.getById('subjects', t.subjects?.[0]);
      return s?.department || 'General';
    }))].sort();
    const sections = DB.get('sections').sort((a,b) => (a.order||0) - (b.order||0));
    const teachers = _getFilteredStaff();

    return `
    <div class="toolbar" style="margin-top:4px">
      <div class="search-box">
        <i class="fas fa-search"></i>
        <input type="text" placeholder="Search by name or staff ID…" value="${_filter.q}" oninput="HR.setFilter('q',this.value)">
      </div>
      <select class="filter-select" onchange="HR.setFilter('dept',this.value)">
        <option value="">All Departments</option>
        ${depts.map(d=>`<option value="${d}" ${_filter.dept===d?'selected':''}>${d}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="HR.setFilter('section',this.value)">
        <option value="">All Sections</option>
        ${sections.map(s=>`<option value="${s.id}" ${_filter.section===s.id?'selected':''}>${s.name}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="HR.setFilter('contractType',this.value)">
        <option value="">All Contracts</option>
        <option value="permanent" ${_filter.contractType==='permanent'?'selected':''}>Permanent</option>
        <option value="contract"  ${_filter.contractType==='contract'?'selected':''}>Contract</option>
        <option value="part-time" ${_filter.contractType==='part-time'?'selected':''}>Part-time</option>
      </select>
      <select class="filter-select" onchange="HR.setFilter('status',this.value)">
        <option value="">All Statuses</option>
        <option value="active"   ${_filter.status==='active'?'selected':''}>Active</option>
        <option value="on_leave" ${_filter.status==='on_leave'?'selected':''}>On Leave</option>
        <option value="inactive" ${_filter.status==='inactive'?'selected':''}>Inactive</option>
      </select>
      <span style="color:var(--gray-400);font-size:13px;margin-left:auto">${teachers.length} staff</span>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
      ${teachers.map(t => {
        const subjs   = t.subjects.map(sid => DB.getById('subjects', sid)).filter(Boolean);
        const homeroom= DB.getById('classes', t.homeroomClass);
        const tchSecs = _teacherSections(t.id);
        const pend    = DB.query('leave_requests', l => l.teacherId===t.id && l.status==='pending').length;
        return `
        <div class="card mb-0" style="cursor:pointer;transition:transform .15s,box-shadow .15s"
          onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='var(--shadow)'"
          onmouseleave="this.style.transform='';this.style.boxShadow=''"
          onclick="App.navigate('hr','${t.id}')">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
            <div class="avatar-circle avatar-lg" style="background:${t.gender==='Female'?'#7C3AED':'#2563EB'}">${t.firstName.charAt(0)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:15px;font-weight:700;color:var(--gray-900)">${t.firstName} ${t.lastName}</div>
              <div style="font-size:12px;color:var(--gray-400);margin-top:2px">${t.staffId} · ${t.contractType}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap">
                <span class="badge badge-${statusBadge(t.status)}">${t.status}</span>
                ${tchSecs.map((sec,i)=>`<span style="background:${SEC_COLORS[i%SEC_COLORS.length]}18;color:${SEC_COLORS[i%SEC_COLORS.length]};border:1px solid ${SEC_COLORS[i%SEC_COLORS.length]}33;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;white-space:nowrap">${sec.name}</span>`).join('')}
                ${pend ? `<span class="badge badge-warning">${pend} leave pending</span>` : ''}
              </div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--gray-600);margin-bottom:6px">
            <i class="fas fa-graduation-cap" style="color:var(--primary);width:14px"></i> ${t.qualification}
          </div>
          <div style="font-size:12px;color:var(--gray-600);margin-bottom:6px">
            <i class="fas fa-door-open" style="color:var(--secondary);width:14px"></i> Homeroom: ${homeroom?.name||'Not assigned'}
          </div>
          <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">
            <i class="fas fa-clock" style="color:var(--warning);width:14px"></i> ${t.workloadHours}h/week · ${fmtMoney(t.salary)}/mo
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${subjs.slice(0,3).map(s=>`<span style="background:${s.color}22;color:${s.color};border:1px solid ${s.color}44;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:600">${s.code}</span>`).join('')}
            ${subjs.length>3?`<span style="background:var(--gray-100);color:var(--gray-500);border-radius:12px;padding:2px 8px;font-size:11px;font-weight:600">+${subjs.length-3}</span>`:''}
          </div>
        </div>`;
      }).join('') || '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-user-slash"></i><h3>No staff found</h3></div>'}
    </div>`;
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  STAFF PROFILE VIEW                                         */
  /* ─────────────────────────────────────────────────────────── */
  function _renderProfile(id) {
    const t = DB.getById('teachers', id);
    if (!t) { App.renderPage('<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Staff member not found</h3></div>'); return; }

    App.setBreadcrumb(`<a href="#hr" onclick="App.navigate('hr')"><i class="fas fa-id-card"></i> HR &amp; Staff</a> / ${t.firstName} ${t.lastName}`);

    const subjs    = t.subjects.map(sid => DB.getById('subjects', sid)).filter(Boolean);
    const homeroom = DB.getById('classes', t.homeroomClass);
    const tchSecs  = _teacherSections(t.id);
    const myLeaves = DB.query('leave_requests', l => l.teacherId === t.id)
                       .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    const myPayroll= DB.query('payroll', p => p.teacherId === t.id)
                       .sort((a,b) => b.payPeriod.localeCompare(a.payPeriod)).slice(0,6);
    const myDocs   = DB.query('hr_documents', d => d.teacherId === t.id);
    const leaveTotal = myLeaves.filter(l=>l.status==='approved').reduce((s,l)=>s+l.days,0);
    const pendLeave  = myLeaves.filter(l=>l.status==='pending').length;

    App.renderPage(`
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <button class="btn btn-secondary btn-sm" onclick="App.navigate('hr')"><i class="fas fa-arrow-left"></i> Back</button>
      ${Auth.isAdmin() ? `<button class="btn btn-secondary btn-sm" onclick="HR.openStaffModal('${id}')"><i class="fas fa-edit"></i> Edit</button>` : ''}
      ${Auth.isAdmin() ? `<button class="btn btn-secondary btn-sm" onclick="HR.newLeaveModal('${id}')"><i class="fas fa-calendar-plus"></i> Add Leave</button>` : ''}
    </div>

    <!-- Profile header -->
    <div class="profile-header" style="background:linear-gradient(135deg,#1e3a5f,#2563EB,#7C3AED)">
      <div class="avatar-circle avatar-xl" style="background:rgba(255,255,255,0.2)">${t.firstName.charAt(0)}</div>
      <div class="profile-info" style="flex:1">
        <h2>${t.firstName} ${t.lastName}</h2>
        <p>${t.specialization} · ${t.staffId}</p>
        <div class="profile-tags">
          <span class="profile-tag">${t.gender}</span>
          <span class="profile-tag">${t.nationality}</span>
          <span class="profile-tag">${t.contractType}</span>
          <span class="profile-tag">${t.status.toUpperCase()}</span>
          ${tchSecs.length > 1 ? `<span class="profile-tag" style="background:rgba(255,180,0,0.3)">⇄ Cross-section</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:20px;text-align:center;z-index:1;flex-wrap:wrap">
        <div><div style="font-size:26px;font-weight:800">${t.workloadHours}h</div><div style="font-size:11px;opacity:.8">Weekly Load</div></div>
        <div><div style="font-size:26px;font-weight:800">${subjs.length}</div><div style="font-size:11px;opacity:.8">Subjects</div></div>
        <div><div style="font-size:26px;font-weight:800">${tchSecs.length||'—'}</div><div style="font-size:11px;opacity:.8">Section${tchSecs.length!==1?'s':''}</div></div>
        <div><div style="font-size:26px;font-weight:800">${leaveTotal}</div><div style="font-size:11px;opacity:.8">Leave Days</div></div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs" id="prof-tabs">
      <button class="tab-btn active" onclick="switchTab('prof-tabs','prof-overview',this)"><i class="fas fa-user"></i> Overview</button>
      <button class="tab-btn" onclick="switchTab('prof-tabs','prof-timetable',this)"><i class="fas fa-calendar-alt"></i> Timetable</button>
      <button class="tab-btn" onclick="switchTab('prof-tabs','prof-hr',this)">
        <i class="fas fa-id-card"></i> HR Details
        ${pendLeave ? `<span style="background:var(--warning);color:#fff;border-radius:99px;font-size:9px;font-weight:700;padding:1px 5px;margin-left:4px">${pendLeave} pending</span>` : ''}
      </button>
    </div>

    <!-- OVERVIEW TAB -->
    <div id="prof-overview" class="tab-panel active">
      <div class="grid-2">
        <!-- Personal Details -->
        <div class="card mb-0">
          <div class="card-title mb-12">Personal Details</div>
          <div class="info-list">
            <div class="info-item"><div class="info-icon"><i class="fas fa-envelope"></i></div><div><div class="info-label">Email</div><div class="info-value">${t.email}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-phone"></i></div><div><div class="info-label">Phone</div><div class="info-value">${t.phone}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-map-marker-alt"></i></div><div><div class="info-label">Address</div><div class="info-value">${t.address}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-birthday-cake"></i></div><div><div class="info-label">Date of Birth</div><div class="info-value">${fmtDate(t.dateOfBirth)}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-graduation-cap"></i></div><div><div class="info-label">Qualification</div><div class="info-value">${t.qualification}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-calendar"></i></div><div><div class="info-label">Joined</div><div class="info-value">${fmtDate(t.joinDate)}</div></div></div>
          </div>
        </div>

        <!-- Teaching Assignment -->
        <div class="card mb-0">
          <div class="card-title mb-12">Teaching Assignment</div>
          <div class="info-item mb-12">
            <div class="info-icon"><i class="fas fa-door-open"></i></div>
            <div><div class="info-label">Homeroom Class</div><div class="info-value">${homeroom?.name||'Not assigned'}</div></div>
          </div>
          ${tchSecs.length ? `
          <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:8px">Sections Teaching</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
            ${tchSecs.map((sec,i)=>`<span style="display:inline-flex;align-items:center;gap:5px;background:${SEC_COLORS[i%SEC_COLORS.length]}18;color:${SEC_COLORS[i%SEC_COLORS.length]};border:1px solid ${SEC_COLORS[i%SEC_COLORS.length]}33;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700"><i class="fas fa-school" style="font-size:10px"></i>${sec.name}</span>`).join('')}
            ${tchSecs.length>1?`<span style="display:inline-flex;align-items:center;gap:4px;background:#FEF3C711;color:#D97706;border:1px solid #D9780633;border-radius:20px;padding:4px 10px;font-size:11px;font-weight:600"><i class="fas fa-exchange-alt" style="font-size:9px"></i>Cross-section</span>`:''}
          </div>` : ''}
          <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:10px">Subjects</div>
          ${subjs.map(s=>`
            <div style="display:flex;align-items:center;gap:10px;padding:8px;background:${s.color}11;border-radius:6px;margin-bottom:6px;border-left:3px solid ${s.color}">
              <div style="font-size:13px;font-weight:600">${s.name}</div>
              <span style="margin-left:auto;font-size:11px;color:var(--gray-400)">${s.code} · ${s.department}</span>
            </div>
          `).join('') || '<p style="color:var(--gray-400);font-size:13px">No subjects assigned</p>'}
        </div>
      </div>
    </div>

    <!-- TIMETABLE TAB -->
    <div id="prof-timetable" class="tab-panel">
      <div class="card mb-0">
        <div class="card-title mb-12">Weekly Timetable</div>
        ${_teacherTimetableGrid(t.id)}
      </div>
    </div>

    <!-- HR DETAILS TAB -->
    <div id="prof-hr" class="tab-panel">
      <div class="grid-2" style="margin-bottom:16px">
        <!-- Employment -->
        <div class="card mb-0">
          <div class="card-title mb-12">Employment Details</div>
          <div class="info-list">
            <div class="info-item"><div class="info-icon"><i class="fas fa-id-card"></i></div><div><div class="info-label">Staff ID</div><div class="info-value monospace">${t.staffId}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-briefcase"></i></div><div><div class="info-label">Contract Type</div><div class="info-value">${t.contractType}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-money-bill"></i></div><div><div class="info-label">Monthly Salary</div><div class="info-value">${fmtMoney(t.salary)}</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-clock"></i></div><div><div class="info-label">Weekly Hours</div><div class="info-value">${t.workloadHours} hours</div></div></div>
            <div class="info-item"><div class="info-icon"><i class="fas fa-phone-alt"></i></div><div><div class="info-label">Emergency Contact</div><div class="info-value">${t.emergencyContact}</div></div></div>
          </div>
        </div>
        <!-- Leave Summary -->
        <div class="card mb-0">
          <div class="card-header" style="margin-bottom:12px">
            <div class="card-title">Leave History</div>
            ${Auth.isAdmin()?`<button class="btn btn-sm btn-primary" onclick="HR.newLeaveModal('${t.id}')"><i class="fas fa-plus"></i> Add</button>`:''}
          </div>
          ${myLeaves.slice(0,5).map(l=>`
          <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--gray-100)">
            <span class="badge badge-${LEAVE_COLORS[l.type]||'secondary'}" style="white-space:nowrap">${LEAVE_TYPES[l.type]||l.type}</span>
            <div style="flex:1;font-size:12px;color:var(--gray-600)">${fmtDate(l.startDate)}–${fmtDate(l.endDate)} <span style="color:var(--gray-400)">(${l.days}d)</span></div>
            <span class="badge badge-${l.status==='approved'?'success':l.status==='rejected'?'danger':'warning'}">${l.status}</span>
          </div>`).join('') || `<div class="empty-state" style="padding:16px"><p>No leave records</p></div>`}
        </div>
      </div>

      <!-- Payroll -->
      ${myPayroll.length ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title mb-12">Recent Payslips</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Period</th><th>Basic</th><th>Gross</th><th>Deductions</th><th>Net Pay</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${myPayroll.map(p=>{
              const totalDed=Object.values(p.deductions||{}).reduce((s,v)=>s+v,0);
              return `<tr>
                <td style="font-weight:600">${_formatPeriod(p.payPeriod)}</td>
                <td>${fmtMoney(p.basicSalary)}</td>
                <td>${fmtMoney(p.grossSalary)}</td>
                <td style="color:var(--danger)">-${fmtMoney(totalDed)}</td>
                <td style="font-weight:700">${fmtMoney(p.netSalary)}</td>
                <td><span class="badge badge-${p.status==='paid'?'success':p.status==='processed'?'primary':'secondary'}">${p.status}</span></td>
                <td><button class="btn btn-sm btn-secondary" onclick="HR.viewPayslip('${p.id}')"><i class="fas fa-eye"></i></button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>` : ''}

      <!-- Documents -->
      <div class="card mb-0">
        <div class="card-header" style="margin-bottom:12px">
          <div class="card-title">Documents (${myDocs.length})</div>
          ${Auth.isAdmin()?`<button class="btn btn-sm btn-secondary" onclick="HR.uploadDocModal('${t.id}')"><i class="fas fa-upload"></i> Upload</button>`:''}
        </div>
        ${myDocs.length ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
          ${myDocs.map(doc=>{
            const expiring = doc.expiryDate && new Date(doc.expiryDate) < new Date(Date.now()+30*86400000);
            return `<div style="display:flex;gap:10px;align-items:flex-start;background:var(--gray-50);border-radius:8px;padding:10px;${expiring?'border:1.5px solid var(--warning)':''}">
              <i class="${DOC_ICONS[doc.type]||'fas fa-file'}" style="color:var(--primary);font-size:20px;margin-top:2px;flex-shrink:0"></i>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.title}</div>
                <div style="font-size:11px;color:var(--gray-400)">${DOC_TYPES[doc.type]||doc.type} · ${doc.fileSize}</div>
                ${doc.expiryDate?`<div style="font-size:11px;color:${expiring?'var(--danger)':'var(--gray-400)'}"><i class="fas fa-clock"></i> Expires: ${fmtDate(doc.expiryDate)}</div>`:''}
              </div>
              ${Auth.isAdmin()?`<button class="btn btn-sm btn-secondary" onclick="HR.deleteDoc('${doc.id}')"><i class="fas fa-trash" style="color:var(--danger)"></i></button>`:''}
            </div>`;
          }).join('')}
        </div>` : `<div class="empty-state" style="padding:16px"><p>No documents uploaded</p></div>`}
      </div>
    </div>
    `);
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  LEAVE PANEL                                                */
  /* ─────────────────────────────────────────────────────────── */
  function _leavePanel() {
    const leaves  = DB.get('leave_requests').sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
    const pending = leaves.filter(l => l.status==='pending');
    const others  = leaves.filter(l => l.status!=='pending');
    return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="btn btn-primary" onclick="HR.newLeaveModal('')"><i class="fas fa-plus"></i> New Request</button>
    </div>
    ${pending.length ? `
    <div class="card" style="border-left:4px solid var(--warning);margin-bottom:0">
      <div class="card-title mb-12" style="color:var(--warning)"><i class="fas fa-clock"></i> Pending Approval (${pending.length})</div>
      ${_leaveTable(pending, true)}
    </div>` : ''}
    <div class="card mb-0" ${pending.length?'style="margin-top:16px"':''}>
      <div class="card-title mb-12">All Leave Records</div>
      ${_leaveTable(others, false)}
    </div>`;
  }

  function _leaveTable(leaves, showActions) {
    if (!leaves.length) return `<div class="empty-state" style="padding:20px"><p>No records</p></div>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th>Staff Member</th><th>Type</th><th>Period</th><th>Days</th><th>Reason</th><th>Status</th>${showActions?'<th>Actions</th>':''}</tr></thead>
      <tbody>
        ${leaves.map(l=>{
          const tch=DB.getById('teachers',l.teacherId);
          return `<tr>
            <td>
              <div style="font-weight:600">${tch?`${tch.firstName} ${tch.lastName}`:'Unknown'}</div>
              <div style="font-size:11px;color:var(--gray-400)">${tch?.staffId||''}</div>
            </td>
            <td><span class="badge badge-${LEAVE_COLORS[l.type]||'secondary'}">${LEAVE_TYPES[l.type]||l.type}</span></td>
            <td>
              <div style="font-size:13px">${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}</div>
              <div style="font-size:11px;color:var(--gray-400)">Applied: ${fmtDate(l.createdAt)}</div>
            </td>
            <td style="text-align:center;font-weight:700">${l.days}</td>
            <td style="font-size:12px;color:var(--gray-600);max-width:200px">${l.reason}</td>
            <td>
              <span class="badge badge-${l.status==='approved'?'success':l.status==='rejected'?'danger':'warning'}">${l.status}</span>
              ${l.rejectionReason?`<div style="font-size:10px;color:var(--danger);margin-top:2px">${l.rejectionReason}</div>`:''}
            </td>
            ${showActions?`<td>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm btn-primary" onclick="HR.approveLeave('${l.id}')"><i class="fas fa-check"></i> Approve</button>
                <button class="btn btn-sm btn-secondary" onclick="HR.rejectLeaveModal('${l.id}')"><i class="fas fa-times" style="color:var(--danger)"></i></button>
              </div>
            </td>`:''}
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  PAYROLL PANEL                                              */
  /* ─────────────────────────────────────────────────────────── */
  function _payrollPanel() {
    const allPeriods = [...new Set(DB.get('payroll').map(p=>p.payPeriod))].sort().reverse();
    const records    = DB.query('payroll', p=>p.payPeriod===_filter.payPeriod)
                         .sort((a,b)=>a.teacherId.localeCompare(b.teacherId));
    const totalGross = records.reduce((s,p)=>s+p.grossSalary,0);
    const totalNet   = records.reduce((s,p)=>s+p.netSalary,0);
    const totalDed   = records.reduce((s,p)=>s+(p.grossSalary-p.netSalary),0);
    const paid       = records.filter(p=>p.status==='paid').length;

    return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <select class="filter-select" onchange="HR.setFilter('payPeriod',this.value)" style="min-width:160px">
        ${allPeriods.length ? allPeriods.map(p=>`<option value="${p}" ${_filter.payPeriod===p?'selected':''}>${_formatPeriod(p)}</option>`).join('')
          : `<option value="${_filter.payPeriod}">${_formatPeriod(_filter.payPeriod)}</option>`}
      </select>
      <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap">
        <div style="background:var(--gray-50);border-radius:8px;padding:8px 14px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--gray-800)">${fmtMoney(totalGross)}</div>
          <div style="font-size:10px;color:var(--gray-400)">Gross Payroll</div>
        </div>
        <div style="background:var(--danger-light);border-radius:8px;padding:8px 14px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--danger)">${fmtMoney(totalDed)}</div>
          <div style="font-size:10px;color:var(--gray-400)">Deductions</div>
        </div>
        <div style="background:var(--success-light);border-radius:8px;padding:8px 14px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--success)">${fmtMoney(totalNet)}</div>
          <div style="font-size:10px;color:var(--gray-400)">Net Payroll</div>
        </div>
        <div style="background:var(--primary-light);border-radius:8px;padding:8px 14px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--primary)">${paid}/${records.length}</div>
          <div style="font-size:10px;color:var(--gray-400)">Paid</div>
        </div>
      </div>
    </div>
    ${records.length ? `
    <div class="card mb-0">
      <div class="table-wrap"><table>
        <thead><tr><th>Staff Member</th><th>Basic</th><th>Allowances</th><th>Gross</th><th>Deductions</th><th>Net Pay</th><th>Status</th>${Auth.isAdmin()?'<th>Action</th>':''}</tr></thead>
        <tbody>
          ${records.map(p=>{
            const tch=DB.getById('teachers',p.teacherId);
            const totalAll=Object.values(p.allowances||{}).reduce((s,v)=>s+v,0);
            const totalDd =Object.values(p.deductions||{}).reduce((s,v)=>s+v,0);
            return `<tr>
              <td>
                <div style="font-weight:600">${tch?`${tch.firstName} ${tch.lastName}`:'Unknown'}</div>
                <div style="font-size:11px;color:var(--gray-400)">${tch?.staffId||''} · ${tch?.contractType||''}</div>
              </td>
              <td>${fmtMoney(p.basicSalary)}</td>
              <td style="color:var(--success)">+${fmtMoney(totalAll)}</td>
              <td style="font-weight:600">${fmtMoney(p.grossSalary)}</td>
              <td style="color:var(--danger)">-${fmtMoney(totalDd)}</td>
              <td style="font-weight:700">${fmtMoney(p.netSalary)}</td>
              <td><span class="badge badge-${p.status==='paid'?'success':p.status==='processed'?'primary':'secondary'}">${p.status}</span></td>
              ${Auth.isAdmin()?`<td>
                <div style="display:flex;gap:4px">
                  ${p.status==='draft'?`<button class="btn btn-sm btn-primary" onclick="HR.processPayslip('${p.id}')"><i class="fas fa-check"></i> Process</button>`:
                    p.status==='processed'?`<button class="btn btn-sm btn-success" onclick="HR.markPaid('${p.id}')"><i class="fas fa-money-bill"></i> Mark Paid</button>`:
                    `<button class="btn btn-sm btn-secondary" onclick="HR.viewPayslip('${p.id}')"><i class="fas fa-eye"></i></button>`}
                  ${p.status!=='paid'?`<button class="btn btn-sm btn-danger btn-icon" onclick="HR.deletePayslip('${p.id}')" title="Delete draft"><i class="fas fa-trash"></i></button>`:''}
                </div>
              </td>`:''}
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>` : `
    <div class="empty-state">
      <i class="fas fa-money-check-alt"></i>
      <h3>No payroll records for ${_formatPeriod(_filter.payPeriod)}</h3>
      ${Auth.isAdmin()?`<button class="btn btn-primary" onclick="HR.generatePayroll()"><i class="fas fa-magic"></i> Generate Payroll</button>`:''}
    </div>`}`;
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  DOCUMENTS PANEL                                            */
  /* ─────────────────────────────────────────────────────────── */
  function _documentsPanel() {
    const allDocs = DB.get('hr_documents').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const byTeacher = {};
    allDocs.forEach(doc => { (byTeacher[doc.teacherId]||(byTeacher[doc.teacherId]=[])).push(doc); });

    return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      ${Auth.isAdmin()?`<button class="btn btn-primary" onclick="HR.uploadDocModal('')"><i class="fas fa-upload"></i> Upload Document</button>`:''}
    </div>
    ${Object.keys(byTeacher).length ? Object.keys(byTeacher).map(tchId=>{
      const tch  = DB.getById('teachers', tchId);
      const docs = byTeacher[tchId];
      return `<div class="card" style="margin-bottom:12px">
        <div class="card-header" style="margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="avatar-circle" style="background:${tch?.gender==='Female'?'#7C3AED':'#2563EB'};width:34px;height:34px;font-size:13px">${tch?.firstName?.charAt(0)||'?'}</div>
            <div>
              <div class="card-title">${tch?`${tch.firstName} ${tch.lastName}`:'Unknown'}</div>
              <div class="card-subtitle">${tch?.staffId||''}</div>
            </div>
          </div>
          ${Auth.isAdmin()?`<button class="btn btn-sm btn-secondary" onclick="HR.uploadDocModal('${tchId}')"><i class="fas fa-upload"></i> Add</button>`:''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">
          ${docs.map(doc=>{
            const expiring=doc.expiryDate&&new Date(doc.expiryDate)<new Date(Date.now()+30*86400000);
            return `<div style="display:flex;gap:10px;align-items:flex-start;background:var(--gray-50);border-radius:8px;padding:10px;${expiring?'border:1.5px solid var(--warning)':''}">
              <i class="${DOC_ICONS[doc.type]||'fas fa-file'}" style="color:var(--primary);font-size:20px;margin-top:2px;flex-shrink:0"></i>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.title}</div>
                <div style="font-size:11px;color:var(--gray-400)">${DOC_TYPES[doc.type]||doc.type} · ${doc.fileSize}</div>
                ${doc.expiryDate?`<div style="font-size:11px;color:${expiring?'var(--danger)':'var(--gray-400)'}"><i class="fas fa-clock"></i> Expires: ${fmtDate(doc.expiryDate)}</div>`:''}
              </div>
              ${Auth.isAdmin()?`<button class="btn btn-sm btn-secondary" onclick="HR.deleteDoc('${doc.id}')"><i class="fas fa-trash" style="color:var(--danger)"></i></button>`:''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('') : `<div class="empty-state"><i class="fas fa-folder-open"></i><h3>No documents uploaded yet</h3></div>`}`;
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  SELF VIEW (non-admin / non-HR staff)                       */
  /* ─────────────────────────────────────────────────────────── */
  function _renderSelfView() {
    App.setBreadcrumb('<i class="fas fa-id-card"></i> My HR Record');
    const tch = DB.query('teachers', t => t.userId === Auth.currentUser.id)[0];
    if (!tch) { App.renderPage('<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Staff record not found</h3></div>'); return; }

    const myLeaves  = DB.query('leave_requests', l=>l.teacherId===tch.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const myPayroll = DB.query('payroll', p=>p.teacherId===tch.id).sort((a,b)=>b.payPeriod.localeCompare(a.payPeriod)).slice(0,6);
    const myDocs    = DB.query('hr_documents', d=>d.teacherId===tch.id);
    const leaveTotal= myLeaves.filter(l=>l.status==='approved').reduce((s,l)=>s+l.days,0);

    App.renderPage(`
    <div class="page-header">
      <div class="page-title"><h1>My HR Record</h1><p>${tch.staffId} · ${tch.specialization}</p></div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="HR.newLeaveModal('${tch.id}')"><i class="fas fa-calendar-plus"></i> Apply for Leave</button>
      </div>
    </div>

    <div class="grid-2">
      <div class="card mb-0">
        <div class="card-title mb-12">Employment Summary</div>
        <div class="info-list">
          <div class="info-item"><div class="info-icon"><i class="fas fa-id-card"></i></div><div><div class="info-label">Staff ID</div><div class="info-value monospace">${tch.staffId}</div></div></div>
          <div class="info-item"><div class="info-icon"><i class="fas fa-briefcase"></i></div><div><div class="info-label">Contract</div><div class="info-value">${tch.contractType}</div></div></div>
          <div class="info-item"><div class="info-icon"><i class="fas fa-calendar"></i></div><div><div class="info-label">Date Joined</div><div class="info-value">${fmtDate(tch.joinDate)}</div></div></div>
          <div class="info-item"><div class="info-icon"><i class="fas fa-clock"></i></div><div><div class="info-label">Weekly Hours</div><div class="info-value">${tch.workloadHours}h/week</div></div></div>
          <div class="info-item"><div class="info-icon"><i class="fas fa-plane"></i></div><div><div class="info-label">Leave Taken (year)</div><div class="info-value">${leaveTotal} days</div></div></div>
        </div>
      </div>
      <div class="card mb-0">
        <div class="card-title mb-12">Leave History</div>
        ${myLeaves.slice(0,5).map(l=>`
        <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--gray-100)">
          <span class="badge badge-${LEAVE_COLORS[l.type]||'secondary'}">${LEAVE_TYPES[l.type]||l.type}</span>
          <div style="flex:1;font-size:12px">${fmtDate(l.startDate)}–${fmtDate(l.endDate)} (${l.days}d)</div>
          <span class="badge badge-${l.status==='approved'?'success':l.status==='rejected'?'danger':'warning'}">${l.status}</span>
        </div>`).join('') || `<div class="empty-state" style="padding:16px"><p>No leave records yet</p></div>`}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title mb-12">Recent Payslips</div>
      ${myPayroll.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Period</th><th>Basic</th><th>Gross</th><th>Deductions</th><th>Net Pay</th><th>Status</th></tr></thead>
        <tbody>${myPayroll.map(p=>{const d=Object.values(p.deductions||{}).reduce((s,v)=>s+v,0);return`<tr>
          <td style="font-weight:600">${_formatPeriod(p.payPeriod)}</td><td>${fmtMoney(p.basicSalary)}</td>
          <td>${fmtMoney(p.grossSalary)}</td><td style="color:var(--danger)">-${fmtMoney(d)}</td>
          <td style="font-weight:700">${fmtMoney(p.netSalary)}</td>
          <td><span class="badge badge-${p.status==='paid'?'success':p.status==='processed'?'primary':'secondary'}">${p.status}</span></td>
        </tr>`;}).join('')}</tbody>
      </table></div>` : `<div class="empty-state" style="padding:20px"><p>No payslips available yet</p></div>`}
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title mb-12">My Documents (${myDocs.length})</div>
      ${myDocs.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        ${myDocs.map(doc=>`<div style="display:flex;gap:10px;align-items:flex-start;background:var(--gray-50);border-radius:8px;padding:10px">
          <i class="${DOC_ICONS[doc.type]||'fas fa-file'}" style="color:var(--primary);font-size:20px;flex-shrink:0"></i>
          <div><div style="font-weight:600;font-size:13px">${doc.title}</div><div style="font-size:11px;color:var(--gray-400)">${DOC_TYPES[doc.type]||doc.type} · ${doc.fileSize}</div></div>
        </div>`).join('')}
      </div>` : `<div class="empty-state" style="padding:16px"><p>No documents</p></div>`}
    </div>`);
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  ADD / EDIT STAFF MODAL  (from Teachers module)             */
  /* ─────────────────────────────────────────────────────────── */
  function openStaffModal(id) {
    const t        = id ? DB.getById('teachers', id) : null;
    const subjects = DB.get('subjects');
    const classes  = DB.get('classes');
    const isEdit   = !!t;

    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-chalkboard-teacher"></i> ${isEdit?'Edit Staff Member':'Add New Staff Member'}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="HR.saveStaff(event,'${t?.id||''}')">
      <div class="form-row cols-2">
        <div class="form-field"><label>First Name *</label><input name="firstName" required value="${t?.firstName||''}"></div>
        <div class="form-field"><label>Last Name *</label><input name="lastName" required value="${t?.lastName||''}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Email *</label><input type="email" name="email" required value="${t?.email||''}"></div>
        <div class="form-field"><label>Phone</label><input name="phone" value="${t?.phone||''}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Gender</label><select name="gender"><option ${t?.gender==='Male'?'selected':''}>Male</option><option ${t?.gender==='Female'?'selected':''}>Female</option></select></div>
        <div class="form-field"><label>Nationality</label><input name="nationality" value="${t?.nationality||''}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Date of Birth</label><input type="date" name="dateOfBirth" value="${t?.dateOfBirth||''}"></div>
        <div class="form-field"><label>Join Date</label><input type="date" name="joinDate" value="${t?.joinDate||new Date().toISOString().split('T')[0]}"></div>
      </div>
      <div class="form-field mb-12"><label>Qualification</label><input name="qualification" value="${t?.qualification||''}"></div>
      <div class="form-field mb-12"><label>Specialization</label><input name="specialization" value="${t?.specialization||''}"></div>
      <div class="form-field mb-12"><label>Address</label><input name="address" value="${t?.address||''}"></div>
      <div class="form-field mb-12"><label>Emergency Contact</label><input name="emergencyContact" value="${t?.emergencyContact||''}"></div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Contract Type</label>
          <select name="contractType">
            <option value="permanent" ${t?.contractType==='permanent'?'selected':''}>Permanent</option>
            <option value="contract"  ${t?.contractType==='contract'?'selected':''}>Contract</option>
            <option value="part-time" ${t?.contractType==='part-time'?'selected':''}>Part-time</option>
          </select>
        </div>
        <div class="form-field"><label>Status</label>
          <select name="status">
            <option value="active"   ${(!t||t.status==='active')?'selected':''}>Active</option>
            <option value="inactive" ${t?.status==='inactive'?'selected':''}>Inactive</option>
            <option value="on_leave" ${t?.status==='on_leave'?'selected':''}>On Leave</option>
          </select>
        </div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Monthly Salary (KSh)</label><input type="number" name="salary" value="${t?.salary||''}"></div>
        <div class="form-field"><label>Weekly Hours</label><input type="number" name="workloadHours" value="${t?.workloadHours||24}" min="0" max="40"></div>
      </div>
      <div class="form-field mb-12"><label>Homeroom Class</label>
        <select name="homeroomClass">
          <option value="">None</option>
          ${classes.map(c=>`<option value="${c.id}" ${t?.homeroomClass===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-field mb-12"><label>Subjects (hold Ctrl for multiple)</label>
        <select name="subjects" multiple style="height:110px">
          ${subjects.map(s=>`<option value="${s.id}" ${t?.subjects?.includes(s.id)?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${isEdit?'Update':'Add Staff'}</button>
      </div>
    </form>`, 'lg');
  }

  function saveStaff(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      schoolId:'sch1',
      firstName:fd.get('firstName'), lastName:fd.get('lastName'),
      email:fd.get('email'), phone:fd.get('phone'),
      gender:fd.get('gender'), nationality:fd.get('nationality'),
      dateOfBirth:fd.get('dateOfBirth'), joinDate:fd.get('joinDate'),
      qualification:fd.get('qualification'), specialization:fd.get('specialization'),
      address:fd.get('address'), emergencyContact:fd.get('emergencyContact'),
      contractType:fd.get('contractType'), status:fd.get('status'),
      salary:Number(fd.get('salary')), workloadHours:Number(fd.get('workloadHours')),
      homeroomClass:fd.get('homeroomClass'),
      subjects:[...document.querySelectorAll('[name="subjects"] option:checked')].map(o=>o.value)
    };
    if (id) {
      DB.update('teachers', id, data);
      showToast('Staff member updated.', 'success');
      _closeModal();
      _renderProfile(id);
    } else {
      data.staffId = `MIS-TCH-${String(DB.get('teachers').length+1).padStart(3,'0')}`;
      DB.insert('teachers', data);
      showToast(`${data.firstName} ${data.lastName} added.`, 'success');
      _closeModal();
      _tab = 'staff';
      _renderMain();
    }
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  LEAVE MODALS                                               */
  /* ─────────────────────────────────────────────────────────── */
  function newLeaveModal(teacherId) {
    const teachers = DB.get('teachers');
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-calendar-plus"></i> Leave Request</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="HR.submitLeave(event)">
      ${Auth.isAdmin() ? `
      <div class="form-field mb-12"><label>Staff Member *</label>
        <select name="teacherId" required>
          <option value="">Select staff…</option>
          ${teachers.map(t=>`<option value="${t.id}" ${t.id===teacherId?'selected':''}>${t.firstName} ${t.lastName} (${t.staffId})</option>`).join('')}
        </select>
      </div>` : `<input type="hidden" name="teacherId" value="${teacherId}">`}
      <div class="form-row cols-2">
        <div class="form-field"><label>Leave Type *</label>
          <select name="type" required>
            ${Object.entries(LEAVE_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Substitute</label>
          <select name="substituteTeacherId">
            <option value="">None / TBD</option>
            ${teachers.map(t=>`<option value="${t.id}">${t.firstName} ${t.lastName}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Start Date *</label><input type="date" name="startDate" required></div>
        <div class="form-field"><label>End Date *</label><input type="date" name="endDate" required></div>
      </div>
      <div class="form-field mb-12"><label>Reason *</label>
        <textarea name="reason" required rows="3" placeholder="Briefly explain the reason…"></textarea>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Submit</button>
      </div>
    </form>`);
  }

  function submitLeave(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const start = fd.get('startDate'), end = fd.get('endDate');
    const days = Math.max(1, Math.ceil((new Date(end)-new Date(start))/86400000)+1);
    DB.insert('leave_requests', {
      schoolId:'sch1', teacherId:fd.get('teacherId'), type:fd.get('type'),
      startDate:start, endDate:end, days, reason:fd.get('reason'),
      status:'pending', approvedBy:null, approvedAt:null, rejectionReason:null,
      substituteTeacherId:fd.get('substituteTeacherId')||null,
      createdAt:new Date().toISOString()
    });
    showToast('Leave request submitted.', 'success');
    _closeModal();
    _tab = 'leave';
    _renderMain();
  }

  function approveLeave(id) {
    DB.update('leave_requests', id, { status:'approved', approvedBy:Auth.currentUser.id, approvedAt:new Date().toISOString() });
    showToast('Leave approved.', 'success');
    _renderMain();
  }

  function rejectLeaveModal(id) {
    openModal(`
    <div class="modal-header">
      <h3 style="color:var(--danger)"><i class="fas fa-times-circle"></i> Reject Leave Request</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <div class="form-field mb-12"><label>Rejection Reason *</label>
        <textarea id="reject-reason" rows="3" placeholder="Explain why this leave is being rejected…"></textarea>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="HR.confirmReject('${id}')"><i class="fas fa-times"></i> Reject</button>
      </div>
    </div>`);
  }

  function confirmReject(id) {
    const reason = document.getElementById('reject-reason')?.value?.trim()||'';
    if (!reason) { showToast('Please provide a rejection reason.','error'); return; }
    DB.update('leave_requests', id, { status:'rejected', rejectionReason:reason, approvedBy:Auth.currentUser.id, approvedAt:new Date().toISOString() });
    showToast('Leave request rejected.','info');
    _closeModal();
    _renderMain();
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  PAYROLL ACTIONS                                            */
  /* ─────────────────────────────────────────────────────────── */
  function processPayslip(id) { DB.update('payroll',id,{status:'processed'}); showToast('Payslip processed.','success'); _renderMain(); }
  function markPaid(id) { DB.update('payroll',id,{status:'paid',paymentDate:new Date().toISOString().split('T')[0]}); showToast('Marked as paid.','success'); _renderMain(); }
  function deletePayslip(id) {
    const p = DB.getById('payroll', id);
    if (!p) return;
    if (p.status === 'paid') return showToast('Cannot delete a paid payslip.','warning');
    confirmAction(`Delete this draft payslip for ${_formatPeriod(p.payPeriod)}?`, () => {
      DB.remove('payroll', id);
      showToast('Payslip deleted.','info');
      _renderMain();
    });
  }

  function viewPayslip(id) {
    const p=DB.getById('payroll',id), tch=DB.getById('teachers',p?.teacherId);
    if (!p||!tch) return;
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-file-invoice-dollar"></i> Payslip — ${_formatPeriod(p.payPeriod)}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563EB);color:#fff;border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700">InnoLearn International School</div>
        <div style="font-size:12px;opacity:.8">Staff Payslip — ${_formatPeriod(p.payPeriod)}</div>
        <div style="margin-top:12px;font-size:15px;font-weight:600">${tch.firstName} ${tch.lastName}</div>
        <div style="font-size:12px;opacity:.8">${tch.staffId} · ${tch.contractType}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:8px">Earnings</div>
          ${_lineItem('Basic Salary',p.basicSalary)}
          ${Object.entries(p.allowances||{}).map(([k,v])=>_lineItem(_cap(k)+' Allowance',v)).join('')}
          <div style="border-top:2px solid var(--gray-200);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-weight:700">
            <span>Gross</span><span>${fmtMoney(p.grossSalary)}</span>
          </div>
        </div>
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--danger);text-transform:uppercase;margin-bottom:8px">Deductions</div>
          ${Object.entries(p.deductions||{}).map(([k,v])=>v?_lineItem(k.toUpperCase(),v,true):'').join('')}
          <div style="border-top:2px solid var(--gray-200);margin-top:8px;padding-top:8px">
            <div style="display:flex;justify-content:space-between;font-weight:700;font-size:16px;color:var(--success)">
              <span>Net Pay</span><span>${fmtMoney(p.netSalary)}</span>
            </div>
            ${p.paymentDate?`<div style="font-size:11px;color:var(--gray-400);margin-top:4px">Paid: ${fmtDate(p.paymentDate)}</div>`:''}
          </div>
        </div>
      </div>
    </div>`,'md');
  }

  function generatePayroll() {
    const teachers = DB.get('teachers').filter(t=>t.status!=='inactive');
    const period = _filter.payPeriod;
    let added = 0;
    teachers.forEach(t => {
      if (DB.query('payroll',p=>p.teacherId===t.id&&p.payPeriod===period).length) return;
      const month = new Date(period+'-01').toLocaleString('en',{month:'long'});
      const year  = parseInt(period.split('-')[0]);
      const allowances = { housing:Math.round(t.salary*.1), transport:5000, medical:3000 };
      const grossSalary = t.salary+Object.values(allowances).reduce((s,v)=>s+v,0);
      const paye = Math.max(0, Math.round(grossSalary*.17));
      const deductions = { paye, nhif:1700, nssf:200, other:0 };
      DB.insert('payroll',{ schoolId:'sch1',teacherId:t.id,month,year,payPeriod:period,
        basicSalary:t.salary,allowances,deductions,grossSalary,
        netSalary:grossSalary-Object.values(deductions).reduce((s,v)=>s+v,0),
        status:'draft',paymentDate:null,paymentMethod:'bank_transfer' });
      added++;
    });
    showToast(`Generated payroll for ${added} staff.`,'success');
    _renderMain();
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  DOCUMENT ACTIONS                                           */
  /* ─────────────────────────────────────────────────────────── */
  function uploadDocModal(teacherId) {
    const teachers = DB.get('teachers');
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-upload"></i> Upload Document</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="HR.saveDoc(event)">
      <div class="form-field mb-12"><label>Staff Member *</label>
        <select name="teacherId" required>
          <option value="">Select staff…</option>
          ${teachers.map(t=>`<option value="${t.id}" ${t.id===teacherId?'selected':''}>${t.firstName} ${t.lastName}</option>`).join('')}
        </select>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Document Type *</label>
          <select name="type" required>
            ${Object.entries(DOC_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Expiry Date</label><input type="date" name="expiryDate"></div>
      </div>
      <div class="form-field mb-12"><label>Title *</label><input name="title" required placeholder="e.g. Employment Contract 2025"></div>
      <div class="form-field mb-12"><label>File Name *</label><input name="fileName" required placeholder="e.g. contract_2025.pdf"></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save</button>
      </div>
    </form>`);
  }

  function saveDoc(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    DB.insert('hr_documents',{ schoolId:'sch1', teacherId:fd.get('teacherId'), type:fd.get('type'),
      title:fd.get('title'), fileName:fd.get('fileName'), fileSize:'—',
      expiryDate:fd.get('expiryDate')||null, uploadedBy:Auth.currentUser.id,
      createdAt:new Date().toISOString() });
    showToast('Document saved.','success');
    _closeModal();
    _renderMain();
  }

  function deleteDoc(id) {
    if (!confirm('Remove this document record?')) return;
    DB.remove('hr_documents', id);
    showToast('Document removed.','info');
    _renderMain();
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  HELPERS                                                    */
  /* ─────────────────────────────────────────────────────────── */

  /* Timetable grid for a teacher (used in profile) */
  function _teacherTimetableGrid(teacherId) {
    const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
    const PERIODS = [1,2,3,4,5,6,7];
    const allTT = DB.get('timetable');
    const slotMap = {};
    allTT.forEach(tt => {
      tt.slots.filter(s=>s.teacherId===teacherId).forEach(s=>{
        slotMap[`${s.day}_${s.period}`] = {...s, classId:tt.classId};
      });
    });
    return `<div class="timetable-grid"><table class="tt-table">
      <thead><tr><th>Period</th>${DAYS.map(d=>`<th>${d}</th>`).join('')}</tr></thead>
      <tbody>
        ${PERIODS.map(p=>`<tr>
          <td class="tt-period-label">P${p}</td>
          ${DAYS.map((_,di)=>{
            const slot = slotMap[`${di}_${p}`];
            if (!slot) return '<td></td>';
            const subj = DB.getById('subjects',slot.subjectId);
            const cls  = DB.getById('classes',slot.classId);
            const sec  = cls?.sectionId ? DB.getById('sections',cls.sectionId) : null;
            return `<td><div class="tt-cell" style="background:${subj?.color||'#2563EB'}">
              <div class="tt-cell-subject">${subj?.name||'—'}</div>
              <div class="tt-cell-teacher">${cls?.name||'—'}${sec?` <span style="opacity:.7;font-size:9px">· ${sec.name}</span>`:''}</div>
              <div class="tt-cell-room">${slot.room||''} · ${slot.start}–${slot.end}</div>
            </div></td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  /* Sections a teacher teaches in (derived from timetable + homeroom) */
  function _teacherSections(teacherId) {
    const ttEntries = DB.get('timetable');
    const sectionIds = new Set();
    ttEntries.forEach(tt => {
      if (tt.slots.some(s=>s.teacherId===teacherId)) {
        const cls = DB.getById('classes',tt.classId);
        if (cls?.sectionId) sectionIds.add(cls.sectionId);
      }
    });
    const tch = DB.query('teachers',t=>t.id===teacherId)[0];
    if (tch?.homeroomClass) {
      const hcls = DB.getById('classes',tch.homeroomClass);
      if (hcls?.sectionId) sectionIds.add(hcls.sectionId);
    }
    return [...sectionIds].map(sid=>DB.getById('sections',sid)).filter(Boolean);
  }

  function _getFilteredStaff() {
    let data = DB.get('teachers');
    // Section head scoping
    if (Auth.isSectionHead() && !Auth.isAdmin()) {
      const myClassIds = new Set(Auth.myClasses().map(c=>c.id));
      const ttEntries  = DB.get('timetable');
      data = data.filter(t =>
        myClassIds.has(t.homeroomClass) ||
        ttEntries.some(tt=>myClassIds.has(tt.classId)&&tt.slots.some(s=>s.teacherId===t.id))
      );
    }
    if (_filter.q) {
      const q = _filter.q.toLowerCase();
      data = data.filter(t=>`${t.firstName} ${t.lastName}`.toLowerCase().includes(q)||t.staffId.toLowerCase().includes(q));
    }
    if (_filter.dept) {
      data = data.filter(t=>t.subjects.some(sid=>{const s=DB.getById('subjects',sid);return s?.department===_filter.dept;}));
    }
    if (_filter.section) {
      const secId = _filter.section;
      const ttEntries = DB.get('timetable');
      const secClassIds = new Set(DB.get('classes').filter(c=>c.sectionId===secId).map(c=>c.id));
      data = data.filter(t=>secClassIds.has(t.homeroomClass)||ttEntries.some(tt=>secClassIds.has(tt.classId)&&tt.slots.some(s=>s.teacherId===t.id)));
    }
    if (_filter.contractType) data = data.filter(t=>t.contractType===_filter.contractType);
    if (_filter.status)       data = data.filter(t=>t.status===_filter.status);
    return data;
  }

  function _formatPeriod(p) {
    if (!p) return '—';
    const [y,m] = p.split('-');
    return `${new Date(Number(y),Number(m)-1,1).toLocaleString('en',{month:'long'})} ${y}`;
  }
  function _lineItem(label,amount,isDed=false) {
    return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
      <span style="color:var(--gray-600)">${label}</span>
      <span style="color:${isDed?'var(--danger)':'var(--gray-800)'}">${isDed?'-':''}${fmtMoney(amount)}</span>
    </div>`;
  }
  function _cap(s) { return s.charAt(0).toUpperCase()+s.slice(1); }

  /* Tab switching for main HR tabs */
  function switchTab(tab) {
    _tab = tab;
    ['staff','leave','payroll','documents'].forEach(t=>{
      const el = document.getElementById(`hr-tab-${t}`);
      if (el) el.style.display = t===tab?'block':'none';
    });
    document.querySelectorAll('#hr-tabs .tab-btn').forEach((b,i)=>{
      b.classList.toggle('active',['staff','leave','payroll','documents'][i]===tab);
    });
  }

  function setFilter(key,val) { _filter[key]=val; _renderMain(); }

  /* ─────────────────────────────────────────────────────────── */
  /*  PUBLIC API                                                 */
  /* ─────────────────────────────────────────────────────────── */
  return {
    render, switchTab, setFilter,
    openStaffModal, saveStaff,
    newLeaveModal, submitLeave, approveLeave, rejectLeaveModal, confirmReject,
    uploadDocModal, saveDoc, deleteDoc,
    processPayslip, markPaid, deletePayslip, viewPayslip, generatePayroll
  };
})();
