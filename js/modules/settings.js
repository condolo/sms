/* ============================================================
   SchoolSync — Settings Module
   ============================================================ */

const Settings = (() => {
  let _tab = 'school';
  let _permSelectedRole = 'superadmin';

  function render() {
    App.setBreadcrumb('<i class="fas fa-cog"></i> Settings');
    _renderPage();
  }

  function _renderPage() {
    const school = DB.get('schools')[0];
    const ay     = DB.get('academicYears').find(a=>a.isCurrent);
    const users  = DB.get('users');

    App.renderPage(`
    <div class="page-header">
      <div class="page-title"><h1>Settings</h1><p>System configuration & administration</p></div>
    </div>

    <div class="tabs" id="set-tabs">
      <button class="tab-btn ${_tab==='school'?'active':''}"   onclick="Settings.setTab('school',this)">School Profile</button>
      <button class="tab-btn ${_tab==='academic'?'active':''}" onclick="Settings.setTab('academic',this)">Academic Year</button>
      ${Auth.isAdmin() ? `<button class="tab-btn ${_tab==='users'?'active':''}" onclick="Settings.setTab('users',this)">User Management</button>` : ''}
      <button class="tab-btn ${_tab==='system'?'active':''}"  onclick="Settings.setTab('system',this)">System</button>
      ${Auth.isSuperAdmin() ? `<button class="tab-btn ${_tab==='roles'?'active':''}" onclick="Settings.setTab('roles',this)"><i class="fas fa-shield-alt"></i> Roles & Permissions</button>` : ''}
      ${Auth.isSuperAdmin() ? `<button class="tab-btn ${_tab==='sections'?'active':''}" onclick="Settings.setTab('sections',this)">Sections & Grades</button>` : ''}
    </div>

    <div id="set-content">${_tabContent(_tab, school, ay, users)}</div>
    `);
  }

  function _tabContent(tab, school, ay, users) {
    if (tab === 'school')   return _schoolTab(school);
    if (tab === 'academic') return _academicTab(ay);
    if (tab === 'users')    return _usersTab(users);
    if (tab === 'system')   return _systemTab();
    if (tab === 'roles')    return _rolesTab();
    if (tab === 'sections') return _sectionsTab();
    return '';
  }

  function _schoolTab(school) {
    return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">School Information</div>
        ${Auth.isAdmin() ? `<button class="btn btn-primary btn-sm" onclick="Settings.saveSchool()"><i class="fas fa-save"></i> Save Changes</button>` : ''}
      </div>
      <div id="school-form">
        <div class="form-row cols-2">
          <div class="form-field"><label>School Name</label><input id="s-name" value="${school?.name||''}" ${Auth.isAdmin()?'':'readonly'}></div>
          <div class="form-field"><label>Short Name</label><input id="s-short" value="${school?.shortName||''}" ${Auth.isAdmin()?'':'readonly'}></div>
        </div>
        <div class="form-row cols-2">
          <div class="form-field"><label>School Code</label><input id="s-code" value="${school?.code||''}" ${Auth.isAdmin()?'':'readonly'}></div>
          <div class="form-field"><label>School Type</label><select id="s-type" ${Auth.isAdmin()?'':'disabled'}>
            <option value="international" ${school?.type==='international'?'selected':''}>International</option>
            <option value="national" ${school?.type==='national'?'selected':''}>National</option>
            <option value="private" ${school?.type==='private'?'selected':''}>Private</option>
          </select></div>
        </div>
        <div class="form-field mb-12"><label>Address</label><input id="s-addr" value="${school?.address||''}" ${Auth.isAdmin()?'':'readonly'}></div>
        <div class="form-row cols-2">
          <div class="form-field"><label>Phone</label><input id="s-phone" value="${school?.phone||''}" ${Auth.isAdmin()?'':'readonly'}></div>
          <div class="form-field"><label>Email</label><input type="email" id="s-email" value="${school?.email||''}" ${Auth.isAdmin()?'':'readonly'}></div>
        </div>
        <div class="form-row cols-2">
          <div class="form-field"><label>Website</label><input id="s-website" value="${school?.website||''}" ${Auth.isAdmin()?'':'readonly'}></div>
          <div class="form-field"><label>School Motto</label><input id="s-motto" value="${school?.motto||''}" ${Auth.isAdmin()?'':'readonly'}></div>
        </div>
        <div class="form-row cols-2">
          <div class="form-field"><label>Timezone</label><select id="s-tz" ${Auth.isAdmin()?'':'disabled'}>
            <option value="Africa/Nairobi" ${school?.timezone==='Africa/Nairobi'?'selected':''}>Africa/Nairobi (EAT, UTC+3)</option>
            <option value="UTC">UTC</option>
            <option value="Europe/London">Europe/London</option>
            <option value="America/New_York">America/New_York</option>
          </select></div>
          <div class="form-field"><label>Currency</label><select id="s-curr" ${Auth.isAdmin()?'':'disabled'}>
            <option value="KES" ${school?.currency==='KES'?'selected':''}>KES – Kenyan Shilling</option>
            <option value="USD" ${school?.currency==='USD'?'selected':''}>USD – US Dollar</option>
            <option value="GBP" ${school?.currency==='GBP'?'selected':''}>GBP – British Pound</option>
            <option value="EUR" ${school?.currency==='EUR'?'selected':''}>EUR – Euro</option>
          </select></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title mb-12">Curriculum</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${['cambridge','ib','american','local'].map(cur=>`
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;background:${(school?.curriculum||[]).includes(cur)?'var(--primary-light)':'var(--gray-100)'};padding:10px 16px;border-radius:8px;border:1.5px solid ${(school?.curriculum||[]).includes(cur)?'var(--primary)':'var(--gray-200)'};transition:all .2s">
          <input type="checkbox" ${(school?.curriculum||[]).includes(cur)?'checked':''} onchange="Settings.toggleCurriculum('${cur}',this.checked)" ${!Auth.isAdmin()?'disabled':''}>
          <span style="font-weight:600;font-size:13px;text-transform:capitalize">${cur === 'ib' ? 'IB' : cur}</span>
        </label>`).join('')}
      </div>
    </div>`;
  }

  function _academicTab(ay) {
    const ayList = DB.get('academicYears');
    return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">Academic Years</div>
        ${Auth.isAdmin() ? `<button class="btn btn-sm btn-primary" onclick="Settings.addYearModal()"><i class="fas fa-plus"></i> New Year</button>` : ''}
      </div>
      ${ayList.map(a=>`
      <div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--gray-100)">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700">${a.name} ${a.isCurrent?`<span class="badge badge-success" style="margin-left:6px">Current</span>`:''}</div>
          <div style="font-size:12px;color:var(--gray-400)">${fmtDate(a.startDate)} – ${fmtDate(a.endDate)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${(a.terms||[]).map(t=>`
          <div style="display:flex;align-items:center;gap:8px;font-size:12px">
            <span class="badge badge-${t.isCurrent?'primary':'secondary'}">${t.name}</span>
            <span style="color:var(--gray-400)">${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}</span>
          </div>`).join('')}
        </div>
        <div style="display:flex;gap:6px">
          ${Auth.isAdmin() && !a.isCurrent ? `<button class="btn btn-sm btn-secondary" onclick="Settings.setCurrentYear('${a.id}')">Set Current</button>` : ''}
          ${Auth.isAdmin() && !a.isCurrent ? `<button class="btn btn-sm btn-danger btn-icon" onclick="Settings.deleteYear('${a.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>`).join('')}
    </div>`;
  }

  function _usersTab(users) {
    return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">System Users</div>
        ${Auth.isAdmin() ? `<button class="btn btn-sm btn-primary" onclick="Settings.addUserModal()"><i class="fas fa-user-plus"></i> Add User</button>` : ''}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Last Login</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${users.map(u=>`<tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div class="avatar-circle" style="background:${{admin:'#2563EB',teacher:'#7C3AED',parent:'#059669',student:'#D97706',finance:'#DC2626'}[u.role]||'#64748B'};width:30px;height:30px;font-size:12px">${u.name.charAt(0)}</div>
                <span style="font-weight:600;font-size:13px">${u.name}</span>
              </div>
            </td>
            <td style="font-size:13px">${u.email}</td>
            <td>
              ${(u.roles||[u.role]).map(r=>{
                const rp = DB.get('role_permissions').find(p=>p.roleKey===r);
                return `<span class="badge" style="background:${rp?.color||'#64748B'}20;color:${rp?.color||'#64748B'};border:1px solid ${rp?.color||'#64748B'}40;margin-right:3px;font-size:10px">${rp?.roleName||r}</span>`;
              }).join('')}
            </td>
            <td style="font-size:12px;color:var(--gray-400)">${u.lastLogin?fmtDate(u.lastLogin):'Never'}</td>
            <td><span class="badge badge-${u.isActive?'success':'danger'}">${u.isActive?'Active':'Inactive'}</span></td>
            <td>
              <div class="tbl-actions">
                <button class="btn btn-sm btn-secondary" onclick="Settings.editUserModal('${u.id}')"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-danger" onclick="Settings.toggleUserStatus('${u.id}','${!u.isActive}')"><i class="fas fa-${u.isActive?'ban':'check'}"></i></button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
  }

  function _systemTab() {
    return `
    <div class="card">
      <div class="settings-section">
        <div class="settings-section-title">Data Management</div>
        <div class="settings-row">
          <div class="settings-row-info"><h4>Reset to Demo Data</h4><p>Clear all data and restore original seed data. This cannot be undone.</p></div>
          <button class="btn btn-danger btn-sm" onclick="Settings.resetData()"><i class="fas fa-undo"></i> Reset Data</button>
        </div>
        <div class="settings-row">
          <div class="settings-row-info"><h4>Export All Data</h4><p>Download all school data as JSON backup.</p></div>
          <button class="btn btn-secondary btn-sm" onclick="Settings.exportData()"><i class="fas fa-download"></i> Export</button>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Notifications</div>
        <div class="settings-row">
          <div class="settings-row-info"><h4>Email Notifications</h4><p>Send email alerts for attendance, grades and fees.</p></div>
          <label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label>
        </div>
        <div class="settings-row">
          <div class="settings-row-info"><h4>SMS Notifications</h4><p>Send SMS for absence and critical alerts.</p></div>
          <label class="toggle"><input type="checkbox"><span class="toggle-slider"></span></label>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Security</div>
        <div class="settings-row">
          <div class="settings-row-info"><h4>Session Timeout</h4><p>Automatically log out inactive users.</p></div>
          <select class="filter-select"><option>30 minutes</option><option>1 hour</option><option>4 hours</option></select>
        </div>
        <div class="settings-row">
          <div class="settings-row-info"><h4>Audit Logging</h4><p>Track all user actions for compliance.</p></div>
          <label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label>
        </div>
        <div class="settings-row">
          <div class="settings-row-info"><h4>GDPR Data Privacy</h4><p>Enable GDPR-compliant data handling.</p></div>
          <label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">About SchoolSync</div>
        <div class="settings-row"><div class="settings-row-info"><h4>Version</h4><p>SchoolSync v1.0.0</p></div><span class="badge badge-success">Up to date</span></div>
        <div class="settings-row"><div class="settings-row-info"><h4>Build</h4><p>2025 · Nairobi, Kenya</p></div></div>
      </div>
    </div>`;
  }

  function saveSchool() {
    const school = DB.get('schools')[0];
    if (!school) return;
    DB.update('schools', school.id, {
      name:     document.getElementById('s-name').value,
      shortName:document.getElementById('s-short').value,
      code:     document.getElementById('s-code').value,
      type:     document.getElementById('s-type').value,
      address:  document.getElementById('s-addr').value,
      phone:    document.getElementById('s-phone').value,
      email:    document.getElementById('s-email').value,
      website:  document.getElementById('s-website').value,
      motto:    document.getElementById('s-motto').value,
      timezone: document.getElementById('s-tz').value,
      currency: document.getElementById('s-curr').value,
    });
    showToast('School profile updated.', 'success');
    document.getElementById('sidebar-school-name').textContent = document.getElementById('s-short').value;
  }

  function toggleCurriculum(cur, checked) {
    const school = DB.get('schools')[0];
    if (!school) return;
    let curr = [...(school.curriculum||[])];
    if (checked) { if (!curr.includes(cur)) curr.push(cur); }
    else curr = curr.filter(c => c !== cur);
    DB.update('schools', school.id, { curriculum: curr });
    showToast('Curriculum updated.', 'success');
  }

  function setCurrentYear(yearId) {
    if (!Auth.isAdmin() && !Auth.isSuperAdmin()) return showToast('Only admins can change the current academic year.', 'error');
    const years    = DB.get('academicYears');
    const previous = years.find(y => y.isCurrent);
    const next     = years.find(y => y.id === yearId);
    years.forEach(y => DB.update('academicYears', y.id, { isCurrent: y.id === yearId }));
    DB.update('schools', DB.get('schools')[0].id, { currentAcademicYearId: yearId });
    _audit('ACADEMIC_YEAR_CHANGED', {
      from: { id: previous?.id, name: previous?.name },
      to:   { id: next?.id,     name: next?.name }
    });
    showToast('Current academic year updated.', 'success');
    setTab('academic');
  }

  function addUserModal() {
    openModal(`
    <div class="modal-header"><h3>Add New User</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Settings.saveUser(event,'')">
      <div class="form-row cols-2">
        <div class="form-field"><label>Full Name *</label><input name="name" required></div>
        <div class="form-field"><label>Email *</label><input type="email" name="email" required></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Role *</label><select name="role" required>
          ${DB.get('role_permissions').map(rp=>`<option value="${rp.roleKey}">${rp.roleName}</option>`).join('')}
        </select></div>
        <div class="form-field"><label>Phone</label><input name="phone"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Password *</label><input type="password" name="password" required minlength="6"></div>
        <div class="form-field"><label>Confirm Password *</label><input type="password" name="password2" required minlength="6"></div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-user-plus"></i> Add User</button>
      </div>
    </form>`, 'sm');
  }

  function editUserModal(id) {
    const u = DB.getById('users', id);
    if (!u) return;
    openModal(`
    <div class="modal-header"><h3>Edit User</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Settings.saveUser(event,'${id}')">
      <div class="form-row cols-2">
        <div class="form-field"><label>Full Name</label><input name="name" value="${u.name}" required></div>
        <div class="form-field"><label>Phone</label><input name="phone" value="${u.phone||''}"></div>
      </div>
      <div class="form-field mb-12"><label>Role</label><select name="role">
        ${DB.get('role_permissions').map(rp=>`<option value="${rp.roleKey}" ${u.role===rp.roleKey?'selected':''}>${rp.roleName}</option>`).join('')}
      </select></div>
      <div class="form-field mb-12"><label>New Password (leave blank to keep)</label><input type="password" name="password" minlength="6" placeholder="Leave blank to keep current"></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Update User</button>
      </div>
    </form>`, 'sm');
  }

  function saveUser(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!id && fd.get('password') !== fd.get('password2')) return showToast('Passwords do not match.', 'error');
    const roleKey = fd.get('role');
    const email   = id ? (DB.getById('users', id)?.email || fd.get('email')) : fd.get('email');
    const data = { schoolId:'sch1', name:fd.get('name'), email, role:roleKey, primaryRole:roleKey, roles:[roleKey], phone:fd.get('phone'), isActive:true };
    if (fd.get('password')) data.password = fd.get('password');
    const err = Validators.user(data, id || null);
    if (err) return showToast(err, 'warning');
    if (id) { DB.update('users', id, data); showToast('User updated.', 'success'); }
    else     { DB.insert('users', { ...data, lastLogin: null }); showToast('User added.', 'success'); }
    _closeModal(); setTab('users');
  }

  function toggleUserStatus(id, active) {
    DB.update('users', id, { isActive: active === 'true' });
    showToast(`User ${active==='true'?'activated':'deactivated'}.`, 'success');
    setTab('users');
  }

  function addYearModal() {
    openModal(`
    <div class="modal-header"><h3>Add Academic Year</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Settings.saveYear(event)">
      <div class="form-field mb-12"><label>Year Name *</label><input name="name" required placeholder="e.g. 2025 – 2026"></div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Start Date</label><input type="date" name="startDate" required></div>
        <div class="form-field"><label>End Date</label><input type="date" name="endDate" required></div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Add Year</button>
      </div>
    </form>`, 'sm');
  }

  function saveYear(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    DB.insert('academicYears', { schoolId:'sch1', name:fd.get('name'), startDate:fd.get('startDate'), endDate:fd.get('endDate'), isCurrent:false, terms:[] });
    showToast('Academic year added.', 'success');
    _closeModal(); setTab('academic');
  }

  function deleteYear(id) {
    const ay = DB.getById('academicYears', id);
    if (!ay) return;
    const blockMsg = Validators.canDeleteYear(id);
    if (blockMsg) return showToast(blockMsg, 'warning');
    confirmAction(`Delete academic year "${ay.name}"? This cannot be undone.`, () => {
      _audit('ACADEMIC_YEAR_DELETED', { id, name: ay.name, startDate: ay.startDate, endDate: ay.endDate });
      DB.remove('academicYears', id);
      showToast('Academic year deleted.', 'info');
      setTab('academic');
    });
  }

  function resetData() {
    confirmAction('Reset ALL data to original demo data? This cannot be undone.', () => {
      DB.reset();
      showToast('Data reset to demo. Please refresh.', 'success');
      setTimeout(() => location.reload(), 1500);
    });
  }

  function exportData() {
    /* Dynamically discover all SchoolSync collections from localStorage.
       This ensures newly added collections are always included in the
       backup without requiring a manual update to a hardcoded list. */
    const PREFIX = 'ss_';
    const SKIP   = new Set(['_version']); // internal meta keys to exclude
    const keys = Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .map(k => k.slice(PREFIX.length))
      .filter(k => !SKIP.has(k))
      .sort();

    const data = { _exportedAt: new Date().toISOString(), _version: '1' };
    keys.forEach(k => { data[k] = DB.get(k); });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `schoolsync-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    showToast(`Full backup exported (${keys.length} collections).`, 'success');
  }

  function setTab(tab, btn) {
    _tab = tab;
    if (btn) {
      document.querySelectorAll('#set-tabs .tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    }
    const school = DB.get('schools')[0];
    const ay     = DB.get('academicYears').find(a=>a.isCurrent);
    const users  = DB.get('users');
    const el     = document.getElementById('set-content');
    if (el) el.innerHTML = _tabContent(tab, school, ay, users);
  }

  function _rolesTab() {
    const permsData = DB.get('role_permissions');
    const modules   = ['dashboard','admissions','students','teachers','classes','subjects',
                       'timetable','attendance','academics','exams','finance','communication',
                       'events','reports','hr','settings'];
    const actions   = ['view','create','edit','delete','approve'];
    const actionIcons = { view:'👁', create:'➕', edit:'✏️', delete:'🗑️', approve:'✅' };

    return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">Roles & Permissions</div>
        <div style="font-size:13px;color:var(--gray-400)">Click checkboxes to toggle access. Changes save immediately.</div>
      </div>

      <!-- Role selector tabs -->
      <div class="perm-role-tabs" id="perm-role-tabs">
        ${permsData.map(rp => `
        <button class="perm-role-chip" id="prc_${rp.roleKey}"
          style="border-color:${rp.color};${_permSelectedRole===rp.roleKey?`background:${rp.color};color:#fff`:'color:'+rp.color}"
          onclick="Settings.selectPermRole('${rp.roleKey}')">
          <span style="width:8px;height:8px;border-radius:50%;background:${rp.color};display:inline-block;margin-right:5px"></span>
          ${rp.roleName}
        </button>`).join('')}
      </div>

      <!-- Permission matrix for selected role -->
      <div id="perm-matrix-wrap">
        ${_permMatrixHTML(permsData, modules, actions, actionIcons)}
      </div>
    </div>`;
  }

  function _permMatrixHTML(permsData, modules, actions, actionIcons) {
    const rp = permsData.find(r => r.roleKey === _permSelectedRole) || permsData[0];
    if (!rp) return '<div class="empty-state"><p>No roles found.</p></div>';

    /* Sub-module definitions — keys must match _SUBS in data.js */
    const _SUB_MODULES = {
      admissions: [
        { key:'admissions.applications', label:'Applications' },
        { key:'admissions.bulk_upload',  label:'Bulk Upload' },
        { key:'admissions.online_form',  label:'Online Form' },
        { key:'admissions.adm_settings',label:'Module Settings' },
      ],
      students: [
        { key:'students.profile',    label:'Profile & Documents' },
        { key:'students.subjects',   label:'Subjects Enrolled' },
        { key:'students.grades',     label:'Grades & Results' },
        { key:'students.attendance', label:'Attendance' },
        { key:'students.finance',    label:'Fee Account' },
        { key:'students.medical',    label:'Medical Records' },
        { key:'students.behavior',   label:'Behaviour & Discipline' },
      ],
      teachers: [
        { key:'teachers.profile',     label:'Profile & Documents' },
        { key:'teachers.classes',     label:'Classes & Subjects' },
        { key:'teachers.performance', label:'Performance Reviews' },
      ],
      classes: [
        { key:'classes.roster',     label:'Class Roster' },
        { key:'classes.enrollment', label:'Enrollment' },
      ],
      subjects: [
        { key:'subjects.catalogue',   label:'Subject Catalogue' },
        { key:'subjects.assignments', label:'Class Assignments' },
      ],
      timetable: [
        { key:'timetable.view_tt', label:'View Timetable' },
        { key:'timetable.edit_tt', label:'Edit Timetable' },
        { key:'timetable.rules',   label:'Rules & Constraints' },
      ],
      attendance: [
        { key:'attendance.mark',        label:'Mark Attendance' },
        { key:'attendance.records',     label:'Records' },
        { key:'attendance.att_reports', label:'Reports' },
      ],
      academics: [
        { key:'academics.gradebook',        label:'Gradebook' },
        { key:'academics.report_cards',     label:'Report Cards' },
        { key:'academics.lesson_plans',     label:'Lesson Plans' },
        { key:'academics.grade_scales',     label:'Grade Scales' },
        { key:'academics.assessment_types', label:'Assessment Types' },
      ],
      exams: [
        { key:'exams.schedule', label:'Exam Schedule' },
        { key:'exams.announce', label:'Announcements' },
        { key:'exams.results',  label:'Results' },
      ],
      finance: [
        { key:'finance.invoices',       label:'Invoices' },
        { key:'finance.payments',       label:'Payments' },
        { key:'finance.fee_structures', label:'Fee Structures' },
        { key:'finance.fin_reports',    label:'Reports' },
      ],
      communication: [
        { key:'communication.inbox',    label:'Inbox' },
        { key:'communication.send_msg', label:'Send Messages' },
      ],
      events: [
        { key:'events.calendar',       label:'Calendar' },
        { key:'events.manage_events',  label:'Manage Events' },
      ],
      reports: [
        { key:'reports.rpt_academic',   label:'Academic Reports' },
        { key:'reports.rpt_finance',    label:'Finance Reports' },
        { key:'reports.rpt_attendance', label:'Attendance Reports' },
        { key:'reports.rpt_admissions', label:'Admissions Reports' },
      ],
      hr: [
        { key:'hr.staff',     label:'Staff Records' },
        { key:'hr.salary',    label:'Salary & Payroll' },
        { key:'hr.leave',     label:'Leave Management' },
        { key:'hr.documents', label:'Documents' },
      ],
      settings: [
        { key:'settings.school_info', label:'School Information' },
        { key:'settings.academic',    label:'Academic Settings' },
        { key:'settings.users',       label:'User Management' },
        { key:'settings.roles',       label:'Roles & Permissions' },
        { key:'settings.sections',    label:'Sections & Grades' },
        { key:'settings.system',      label:'System' },
      ],
    };

    const modLabels = {
      dashboard:'Dashboard', admissions:'Admissions', students:'Students',
      teachers:'Teachers & Staff', classes:'Classes', subjects:'Subjects',
      timetable:'Timetable', attendance:'Attendance', academics:'Academics',
      exams:'Exams', finance:'Finance', communication:'Communication',
      events:'Events', reports:'Reports', hr:'HR & Staff', settings:'Settings'
    };

    const modIcons = {
      dashboard:'🏠', admissions:'📋', students:'🎓', teachers:'👩‍🏫', classes:'🏫',
      subjects:'📚', timetable:'🗓️', attendance:'✅', academics:'📊', exams:'📝',
      finance:'💰', communication:'💬', events:'📅', reports:'📈', hr:'👥', settings:'⚙️'
    };

    const disabled = rp.isSystem && rp.roleKey === 'superadmin';

    const _chk = (key, action, checked) => {
      const lbl = `chk_${key.replace('.','_')}_${action}`;
      return `<td class="perm-act-cell">
        <label class="perm-chk-label ${checked?'perm-checked':''}" id="lbl_${lbl}">
          <input type="checkbox"
            ${checked ? 'checked' : ''}
            ${disabled ? 'disabled title="Super Admin always has full access"' : ''}
            onchange="Settings.togglePerm('${rp.roleKey}','${key}','${action}',this.checked,this)"
          >
        </label>
      </td>`;
    };

    let rows = '';
    for (const mod of modules) {
      const modPerm = rp.permissions?.[mod] || {};
      const anyTrue = actions.some(a => modPerm[a]);
      const subs    = _SUB_MODULES[mod] || [];

      /* Parent module row */
      rows += `<tr class="perm-row perm-parent-row ${anyTrue?'perm-row-active':''}">
        <td class="perm-mod-cell">
          <div class="perm-parent-cell">
            <span class="perm-mod-icon">${modIcons[mod]||'📦'}</span>
            <span style="font-weight:700;font-size:13px">${modLabels[mod]||mod}</span>
            ${subs.length ? `<span class="perm-sub-count">${subs.length} feature${subs.length!==1?'s':''}</span>` : ''}
          </div>
        </td>
        ${actions.map(a => _chk(mod, a, !!modPerm[a])).join('')}
      </tr>`;

      /* Sub-module rows */
      for (const sub of subs) {
        const subPerm = rp.permissions?.[sub.key] || {};
        const subAny  = actions.some(a => subPerm[a]);
        rows += `<tr class="perm-row perm-sub-row ${subAny?'perm-row-active':''}">
          <td class="perm-mod-cell">
            <div class="perm-sub-cell">
              <span class="perm-sub-connector"></span>
              <span class="perm-sub-label">${sub.label}</span>
            </div>
          </td>
          ${actions.map(a => _chk(sub.key, a, !!subPerm[a])).join('')}
        </tr>`;
      }
    }

    return `
    <div style="margin-top:16px;padding:0 4px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <div style="width:10px;height:10px;border-radius:50%;background:${rp.color}"></div>
        <span style="font-size:15px;font-weight:700;color:var(--gray-800)">${rp.roleName}</span>
        ${rp.isSystem ? `<span class="badge badge-secondary" style="font-size:10px">System Role · Cannot be deleted</span>` : ''}
        <span style="font-size:12px;color:var(--gray-400);margin-left:auto">
          <i class="fas fa-info-circle"></i> Parent row controls all sub-features at once
        </span>
      </div>
      <div class="perm-matrix-scroll">
        <table class="perm-matrix-table">
          <thead>
            <tr>
              <th class="perm-mod-col">Module / Feature</th>
              ${actions.map(a=>`<th class="perm-act-col" title="${a}">${actionIcons[a]}<br><span style="font-size:10px;text-transform:capitalize">${a}</span></th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  function _sectionsTab() {
    const sections = DB.get('sections');
    return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">Sections & Grades</div>
        <button class="btn btn-sm btn-primary" onclick="Settings.addSectionModal()"><i class="fas fa-plus"></i> Add Section</button>
      </div>
      ${sections.map(sec => {
        const classes = DB.get('classes').filter(c => c.sectionId === sec.id).sort((a,b)=>a.level-b.level);
        const gradeCounts = {};
        classes.forEach(c => { gradeCounts[c.grade] = (gradeCounts[c.grade]||0)+1; });
        return `
        <div class="card mb-0" style="border-left:4px solid ${sec.color};margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="width:40px;height:40px;border-radius:10px;background:${sec.color}20;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
              ${sec.name==='KG'?'🎒':sec.name==='Primary'?'📚':'🎓'}
            </div>
            <div style="flex:1">
              <div style="font-size:15px;font-weight:800;color:var(--gray-900)">${sec.name}</div>
              <div style="font-size:12px;color:var(--gray-400)">${sec.description}</div>
              ${sec.grades?.length ? `<div style="font-size:11px;color:var(--gray-500);margin-top:3px"><i class="fas fa-layer-group" style="margin-right:4px"></i>Grades: ${sec.grades.join(', ')}</div>` : ''}
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-secondary" onclick="Settings.addGradeModal('${sec.id}')"><i class="fas fa-plus"></i> Add Class</button>
              <button class="btn btn-sm btn-secondary btn-icon" onclick="Settings.addSectionModal('${sec.id}')" title="Edit section"><i class="fas fa-edit"></i></button>
              ${!sec.isSystem ? `<button class="btn btn-sm btn-danger btn-icon" onclick="Settings.deleteSection('${sec.id}')"><i class="fas fa-trash"></i></button>` : ''}
            </div>
          </div>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px">
            ${classes.length ? classes.map(cls => `
            <div class="perm-grade-chip" title="${cls.name} · ${cls.room}">
              <span style="font-weight:700;color:${sec.color}">${cls.name}</span>
              <span style="color:var(--gray-400);font-size:10px;margin-left:4px">Cap.${cls.capacity}</span>
              ${Auth.isSuperAdmin() ? `<button onclick="Settings.deleteClass('${cls.id}')" title="Delete ${cls.name}" style="margin-left:4px;background:none;border:none;cursor:pointer;color:var(--gray-400);padding:0;font-size:10px">✕</button>` : ''}
            </div>`).join('') : `<span style="color:var(--gray-400);font-size:13px">No classes yet — add one above</span>`}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function selectPermRole(roleKey) {
    _permSelectedRole = roleKey;
    // Update chip styles
    document.querySelectorAll('.perm-role-chip').forEach(btn => {
      const rp = DB.get('role_permissions').find(r => r.roleKey === btn.id.replace('prc_',''));
      if (!rp) return;
      if (btn.id === `prc_${roleKey}`) {
        btn.style.background = rp.color; btn.style.color = '#fff';
      } else {
        btn.style.background = ''; btn.style.color = rp.color;
      }
    });
    // Re-render matrix
    const permsData = DB.get('role_permissions');
    const modules   = ['dashboard','admissions','students','teachers','classes','subjects',
                       'timetable','attendance','academics','exams','finance','communication',
                       'events','reports','hr','settings'];
    const actions   = ['view','create','edit','delete','approve'];
    const actionIcons = { view:'👁', create:'➕', edit:'✏️', delete:'🗑️', approve:'✅' };
    const wrap = document.getElementById('perm-matrix-wrap');
    if (wrap) wrap.innerHTML = _permMatrixHTML(permsData, modules, actions, actionIcons);
  }

  function togglePerm(roleKey, module, action, checked, chkEl) {
    const rp = DB.get('role_permissions').find(r => r.roleKey === roleKey);
    if (!rp) return;
    // Super Admin is always full — never change
    if (roleKey === 'superadmin') { chkEl.checked = true; showToast('Super Admin always has full access.', 'warning'); return; }
    // view is required if any other permission is granted
    if (action !== 'view' && checked) {
      const current = rp.permissions[module] || {};
      if (!current.view) {
        const viewChk = chkEl.closest('tr').querySelector('input[type="checkbox"]');
        if (viewChk && !viewChk.disabled) { viewChk.checked = true; current.view = true; }
      }
    }
    // If unchecking view, uncheck all others for this module
    if (action === 'view' && !checked) {
      const row = chkEl.closest('tr');
      row.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = false; });
      rp.permissions[module] = { view:false, create:false, edit:false, delete:false, approve:false };
      DB.update('role_permissions', rp.id, { permissions: rp.permissions });
      chkEl.closest('.perm-row').classList.remove('perm-row-active');
      showToast('All permissions removed for this module.', 'info');
      return;
    }
    if (!rp.permissions[module]) rp.permissions[module] = { view:false, create:false, edit:false, delete:false, approve:false };
    rp.permissions[module][action] = checked;
    DB.update('role_permissions', rp.id, { permissions: rp.permissions });
    _audit('PERMISSION_CHANGED', { roleKey, roleName: rp.roleName, module, action, newValue: checked });
    // Update row active state
    const anyTrue = Object.values(rp.permissions[module]).some(Boolean);
    chkEl.closest('.perm-row').classList.toggle('perm-row-active', anyTrue);
    // Update cell highlight
    chkEl.closest('.perm-act-cell').querySelector('.perm-chk-label').classList.toggle('perm-checked', checked);
    showToast(`${rp.roleName} — ${module} ${action}: ${checked?'enabled':'disabled'}.`, 'success');
  }

  function addSectionModal(sectionId) {
    const sec  = sectionId ? DB.getById('sections', sectionId) : null;
    const isEdit = !!sec;
    openModal(`
    <div class="modal-header"><h3>${isEdit?'Edit Section':'Add Section'}</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Settings.saveSection(event,'${sectionId||''}')">
      <div class="form-row cols-2">
        <div class="form-field"><label>Section Name *</label><input name="name" required placeholder="e.g. Advanced, Vocational" value="${sec?.name||''}"></div>
        <div class="form-field"><label>Colour</label><input type="color" name="color" value="${sec?.color||'#6366F1'}"></div>
      </div>
      <div class="form-field mb-12"><label>Description</label><input name="description" placeholder="Short description of this section" value="${sec?.description||''}"></div>
      <div class="form-field mb-12">
        <label>Grade Range <span style="font-size:11px;color:var(--gray-400)">(comma-separated, e.g. 1,2,3 or KG1,KG2)</span></label>
        <input name="grades" placeholder="e.g. 7,8,9,10,11,12" value="${(sec?.grades||[]).join(',')}">
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${isEdit?'Update':'Add'} Section</button>
      </div>
    </form>`, 'sm');
  }

  function saveSection(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const gradesRaw = fd.get('grades').trim();
    const grades = gradesRaw ? gradesRaw.split(',').map(g => g.trim()).filter(Boolean) : [];
    const sections = DB.get('sections');
    if (id) {
      DB.update('sections', id, { name:fd.get('name').trim(), color:fd.get('color'), description:fd.get('description').trim(), grades });
      showToast('Section updated.', 'success');
    } else {
      DB.insert('sections', {
        schoolId:'sch1', name:fd.get('name').trim(), color:fd.get('color'),
        description:fd.get('description').trim(), order:sections.length+1, grades
      });
      showToast('Section added.', 'success');
    }
    _closeModal(); setTab('sections');
  }

  function addGradeModal(sectionId) {
    const sec = DB.getById('sections', sectionId);
    const isKG = sectionId === 'sec_kg';
    openModal(`
    <div class="modal-header"><h3>Add Class to ${sec?.name}</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Settings.saveGradeClass(event,'${sectionId}')">
      <div class="form-row cols-2">
        <div class="form-field"><label>${isKG?'KG Year *':'Grade Level *'}</label>
          ${isKG
            ? `<select name="grade"><option value="KG1">KG 1</option><option value="KG2">KG 2</option><option value="KG3">KG 3</option></select>`
            : `<input name="grade" type="number" required placeholder="e.g. 7" min="1" max="13">`
          }
        </div>
        <div class="form-field"><label>Stream</label><input name="stream" placeholder="${isKG?'Leave blank for KG':'e.g. A, B, C'}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Room</label><input name="room" placeholder="e.g. Room 101"></div>
        <div class="form-field"><label>Capacity</label><input type="number" name="capacity" value="30" min="1"></div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Add Class</button>
      </div>
    </form>`, 'sm');
  }

  function saveGradeClass(e, sectionId) {
    e.preventDefault();
    const fd     = new FormData(e.target);
    const grade  = fd.get('grade');
    const stream = fd.get('stream').trim().toUpperCase();
    const isKG   = sectionId === 'sec_kg';
    const name   = isKG ? `${grade}${stream?` ${stream}`:''}` : `Grade ${grade}${stream}`;
    const level  = isKG ? (['KG1','KG2','KG3'].indexOf(grade) - 2) : Number(grade);
    const data   = {
      schoolId:'sch1', grade: isKG ? grade : Number(grade), name, stream,
      level, sectionId, homeroomTeacherId:'', capacity:Number(fd.get('capacity')),
      room:fd.get('room').trim(), academicYearId: SchoolContext.currentAcYearId()
    };
    const err = Validators.cls(data, null);
    if (err) return showToast(err, 'warning');
    DB.insert('classes', data);
    showToast(`${name} added.`, 'success');
    _closeModal(); setTab('sections');
  }

  function deleteSection(sectionId) {
    const sec      = DB.getById('sections', sectionId);
    const blockMsg = Validators.canDeleteSection(sectionId);
    if (blockMsg) return showToast(blockMsg, 'warning');
    confirmAction(`Delete the "${sec?.name}" section? This cannot be undone.`, () => {
      DB.remove('sections', sectionId);
      showToast('Section deleted.', 'success');
      setTab('sections');
    });
  }

  function deleteClass(classId) {
    const cls      = DB.getById('classes', classId);
    const blockMsg = Validators.canDeleteClass(classId);
    if (blockMsg) return showToast(blockMsg, 'warning');
    confirmAction(`Delete ${cls?.name}? This cannot be undone.`, () => {
      DB.remove('classes', classId);
      /* Clean up class_subjects join records */
      DB.query('class_subjects', r => r.classId === classId).forEach(r => DB.remove('class_subjects', r.id));
      /* Clean up timetable records */
      DB.query('timetable', t => t.classId === classId).forEach(t => DB.remove('timetable', t.id));
      showToast(`${cls?.name} deleted.`, 'success');
      setTab('sections');
    });
  }

  return { render, saveSchool, toggleCurriculum, setCurrentYear, addUserModal, editUserModal, saveUser, toggleUserStatus, addYearModal, saveYear, deleteYear, resetData, exportData, setTab, selectPermRole, togglePerm, addSectionModal, saveSection, addGradeModal, saveGradeClass, deleteSection, deleteClass };
})();
