/* ============================================================
   InnoLearn — Dashboard Module (Role-aware)
   ============================================================ */

const Dashboard = (() => {

  function render() {
    App.setBreadcrumb('<i class="fas fa-th-large"></i> Dashboard');
    if (Auth.isSuperAdmin() || Auth.isPrincipal() || Auth.isFinance()) return _adminDashboard();
    if (Auth.isSectionHead())       return _sectionHeadDashboard();
    if (Auth.isExamsOfficer() && !Auth.isTeacher()) return _examsDashboard();
    if (Auth.isAdmissionsOfficer()) return _admissionsDashboard();
    if (Auth.isHR())                return _hrDashboard();
    if (Auth.isTeacher())           return _teacherDashboard();
    if (Auth.isParent())            return _parentDashboard();
    if (Auth.isStudent())           return _studentDashboard();
    _adminDashboard();
  }

  /* ─── SETUP WIZARD ─── */
  function _setupWizard(school) {
    const students  = DB.get('students').filter(s => s.schoolId === school.id);
    const teachers  = DB.get('teachers').filter(t => t.schoolId === school.id);
    const classes   = DB.get('classes').filter(c => c.schoolId === school.id);
    const fees      = DB.get('feeStructures') || [];
    const reports   = DB.get('reportTemplates') || [];
    const ay        = (DB.get('academicYears') || []).find(a => a.schoolId === school.id);

    const steps = [
      {
        id:'profile', icon:'fas fa-school', label:'Complete school profile',
        done: !!(school.address || school.phone || school.logo),
        action: "App.navigate('settings')", hint:'Add contact details, logo & address'
      },
      {
        id:'ay', icon:'fas fa-calendar', label:'Set up academic year & terms',
        done: !!(ay && ay.terms?.length > 0),
        action: "App.navigate('settings')", hint:'Define current term dates'
      },
      {
        id:'classes', icon:'fas fa-door-open', label:'Create classes / grades',
        done: classes.length >= 1,
        action: "App.navigate('classes')", hint:'Add your Grade 1, Form 1… etc.'
      },
      {
        id:'staff', icon:'fas fa-chalkboard-teacher', label:'Add teaching staff',
        done: teachers.length >= 1,
        action: "App.navigate('teachers')", hint:'Import or manually add teachers'
      },
      {
        id:'students', icon:'fas fa-user-graduate', label:'Enroll your first students',
        done: students.length >= 1,
        action: "Students.renderNew()", hint:'Enroll students or import via CSV'
      },
      {
        id:'fees', icon:'fas fa-file-invoice-dollar', label:'Configure fee structures',
        done: fees.filter(f => f.schoolId === school.id).length >= 1,
        action: "App.navigate('finance')", hint:'Set tuition, boarding, bus fees…'
      },
      {
        id:'reports', icon:'fas fa-file-alt', label:'Set up report card templates',
        done: reports.filter(r => r.schoolId === school.id).length >= 1,
        action: "App.navigate('reports')", hint:'Define grading scales & layout'
      },
    ];

    const doneCount = steps.filter(s => s.done).length;
    const pct = Math.round(doneCount / steps.length * 100);
    const allDone = doneCount === steps.length;

    // Persist wizard dismissal
    const dismissKey = `setup_wizard_done_${school.id}`;
    if (localStorage.getItem(dismissKey) === 'true') return '';

    return `
      <div class="setup-wizard" id="setup-wizard">
        <div class="setup-wizard-header">
          <div class="setup-wizard-title">
            <i class="fas fa-rocket" style="color:#f59e0b"></i>
            <span>School Setup Checklist</span>
            <span class="setup-pct-badge" style="background:${pct===100?'#22c55e':'#f59e0b'}">${pct}% complete</span>
          </div>
          ${allDone
            ? `<button class="btn btn-sm btn-success" onclick="dismissWizard('${school.id}')"><i class="fas fa-check"></i> Mark complete</button>`
            : `<button class="btn-link" onclick="dismissWizard('${school.id}')" title="Hide checklist" style="color:var(--gray-400);font-size:12px">Hide for now</button>`
          }
        </div>
        <div class="setup-progress-bar">
          <div class="setup-progress-fill" style="width:${pct}%;background:${pct===100?'#22c55e':'#4f46e5'}"></div>
        </div>
        <p class="setup-sub">${allDone ? '🎉 Your school is fully set up! You can now hide this panel.' : `${steps.length - doneCount} step${steps.length-doneCount!==1?'s':''} remaining — complete them to unlock the full power of InnoLearn.`}</p>
        <div class="setup-steps">
          ${steps.map(s => `
            <div class="setup-step ${s.done ? 'done' : ''}" onclick="${s.done ? '' : s.action}">
              <div class="setup-step-check">
                ${s.done ? '<i class="fas fa-check"></i>' : ''}
              </div>
              <div class="setup-step-body">
                <div class="setup-step-label">${s.label}</div>
                ${!s.done ? `<div class="setup-step-hint">${s.hint}</div>` : ''}
              </div>
              ${!s.done ? '<i class="fas fa-chevron-right setup-step-arrow"></i>' : ''}
            </div>`).join('')}
        </div>
      </div>`;
  }

  /* ─── ADMIN DASHBOARD ─── */
  function _adminDashboard() {
    const students  = DB.get('students').filter(s => s.status === 'active');
    const teachers  = DB.get('teachers').filter(t => t.status === 'active');
    const classes   = DB.get('classes');
    const invoices  = DB.get('invoices');
    const events    = DB.get('events').filter(e => new Date(e.startDate) >= new Date()).slice(0,5);
    const messages  = DB.get('messages').slice(0,4);
    const school    = Auth.currentSchool;

    const totalFees  = invoices.reduce((s,i) => s + i.totalAmount, 0);
    const collected  = invoices.reduce((s,i) => s + i.paidAmount,  0);
    const outstanding= invoices.reduce((s,i) => s + i.balance, 0);
    const paidCount  = invoices.filter(i => i.status === 'paid').length;
    const collection = totalFees > 0 ? Math.round(collected/totalFees*100) : 0;

    const attRecords = DB.get('attendance');
    const attTotal   = attRecords.reduce((s,r) => s + r.records.length, 0);
    const attPresent = attRecords.reduce((s,r) => s + r.records.filter(x => x.status === 'present').length, 0);
    const attRate    = attTotal > 0 ? Math.round(attPresent/attTotal*100) : 0;

    const ay = DB.get('academicYears').find(a => a.isCurrent);
    const term = ay?.terms?.find(t => t.isCurrent);

    // Show setup wizard for superadmin on new/sparse schools
    const wizardHtml = (Auth.isSuperAdmin() && school) ? _setupWizard(school) : '';

    App.renderPage(`
    ${wizardHtml}
    <div class="hero-card blue" style="margin-bottom:20px">
      <div class="hero-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div>
          <p style="opacity:.7;font-size:13px;margin-bottom:6px;font-weight:500"><i class="fas fa-sun"></i> Good ${_greeting()}</p>
          <h2 style="font-size:26px">${Auth.currentUser.name}</h2>
          <p style="margin-top:6px;opacity:.75">${school?.name || 'InnoLearn International School'}</p>
          <p style="margin-top:3px;font-size:13px;opacity:.65"><i class="fas fa-calendar-alt"></i> ${term?.name || 'Term 2'}, ${ay?.name || '2024-2025'} &nbsp;·&nbsp; ${fmtDate(new Date().toISOString())}</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;position:relative;z-index:1">
          <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;border-color:rgba(255,255,255,0.3)" onclick="Students.renderNew()"><i class="fas fa-user-plus"></i> Enroll Student</button>
          <button class="btn" style="background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.2)" onclick="App.navigate('reports')"><i class="fas fa-chart-bar"></i> Reports</button>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" style="cursor:pointer" onclick="App.navigate('students')">
        <div class="stat-icon blue"><i class="fas fa-user-graduate"></i></div>
        <div class="stat-body">
          <div class="stat-value">${students.length}</div>
          <div class="stat-label">Active Students</div>
          <div class="stat-change up"><i class="fas fa-arrow-up"></i> 3 this term</div>
        </div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="App.navigate('teachers')">
        <div class="stat-icon purple"><i class="fas fa-chalkboard-teacher"></i></div>
        <div class="stat-body">
          <div class="stat-value">${teachers.length}</div>
          <div class="stat-label">Teaching Staff</div>
          <div class="stat-change up"><i class="fas fa-check"></i> All active</div>
        </div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="App.navigate('classes')">
        <div class="stat-icon green"><i class="fas fa-door-open"></i></div>
        <div class="stat-body">
          <div class="stat-value">${classes.length}</div>
          <div class="stat-label">Classes</div>
          <div class="stat-change"><span style="color:var(--gray-400)">Grades 7 – 12</span></div>
        </div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="App.navigate('attendance')">
        <div class="stat-icon ${attRate >= 90 ? 'green' : attRate >= 75 ? 'yellow' : 'red'}"><i class="fas fa-clipboard-check"></i></div>
        <div class="stat-body">
          <div class="stat-value">${attRate}%</div>
          <div class="stat-label">Attendance Rate</div>
          <div class="stat-change ${attRate >= 90 ? 'up' : 'down'}">${attRate >= 90 ? '↑ Excellent' : '↓ Needs attention'}</div>
        </div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="App.navigate('finance')">
        <div class="stat-icon yellow"><i class="fas fa-coins"></i></div>
        <div class="stat-body">
          <div class="stat-value">${collection}%</div>
          <div class="stat-label">Fee Collection</div>
          <div class="stat-change ${collection >= 80 ? 'up' : 'down'}">KSh ${(collected/1000).toFixed(0)}k collected</div>
        </div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="App.navigate('finance')">
        <div class="stat-icon red"><i class="fas fa-exclamation-circle"></i></div>
        <div class="stat-body">
          <div class="stat-value">${fmtMoney(outstanding)}</div>
          <div class="stat-label">Outstanding Fees</div>
          <div class="stat-change down">${invoices.filter(i=>i.status==='overdue').length} overdue</div>
        </div>
      </div>
    </div>

    ${typeof Birthday !== 'undefined' ? Birthday.dashboardCard() : ''}

    <div class="grid-2">
      <div class="card mb-0">
        <div class="card-header">
          <div>
            <div class="card-title">Fee Collection – Term 2</div>
            <div class="card-subtitle">By payment status</div>
          </div>
        </div>
        <div class="chart-wrap"><canvas id="feeChart"></canvas></div>
      </div>

      <div class="card mb-0">
        <div class="card-header">
          <div>
            <div class="card-title">Attendance Trend</div>
            <div class="card-subtitle">Last 6 days</div>
          </div>
        </div>
        <div class="chart-wrap"><canvas id="attChart"></canvas></div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-calendar" style="color:var(--primary)"></i> Upcoming Events</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('events')">View all</button>
        </div>
        ${events.length ? events.map(ev => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--gray-100)">
            <div style="width:42px;height:42px;border-radius:10px;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;text-align:center;flex-shrink:0">
              ${new Date(ev.startDate).toLocaleDateString('en',{month:'short'}).toUpperCase()}<br>
              ${new Date(ev.startDate).getDate()}
            </div>
            <div style="min-width:0">
              <div style="font-size:13.5px;font-weight:600;color:var(--gray-800)">${ev.title}</div>
              <div style="font-size:12px;color:var(--gray-400)">${ev.location||'School'}</div>
            </div>
            <span class="badge badge-${ev.type==='exam'?'danger':ev.type==='holiday'?'success':ev.type==='meeting'?'warning':'primary'}" style="margin-left:auto;flex-shrink:0">${ev.type}</span>
          </div>
        `).join('') : '<div class="empty-state" style="padding:30px"><i class="fas fa-calendar-times"></i><p>No upcoming events</p></div>'}
      </div>

      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-comment-dots" style="color:var(--secondary)"></i> Recent Messages</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('communication')">View all</button>
        </div>
        ${messages.map(m => `
          <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--gray-100);cursor:pointer" onclick="App.navigate('communication')">
            <div class="avatar-circle" style="background:var(--primary);flex-shrink:0;width:36px;height:36px;font-size:14px">${m.senderName.charAt(0)}</div>
            <div style="min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${m.subject}</div>
              <div style="font-size:12px;color:var(--gray-400)">${m.senderName} · ${_timeAgo(m.createdAt)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <div class="card-title"><i class="fas fa-bolt"></i> Quick Actions</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px">
        <div class="quick-action" onclick="Students.renderNew()">
          <i class="fas fa-user-plus" style="background:var(--primary-light);color:var(--primary);width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px"></i>
          <span>Enroll Student</span>
        </div>
        <div class="quick-action" onclick="App.navigate('attendance')">
          <i class="fas fa-clipboard-check" style="background:var(--success-light);color:var(--success);width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px"></i>
          <span>Attendance</span>
        </div>
        <div class="quick-action" onclick="App.navigate('finance')">
          <i class="fas fa-file-invoice" style="background:var(--warning-light);color:var(--warning);width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px"></i>
          <span>Invoices</span>
        </div>
        <div class="quick-action" onclick="App.navigate('communication')">
          <i class="fas fa-bullhorn" style="background:var(--secondary-light);color:var(--secondary);width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px"></i>
          <span>Announcement</span>
        </div>
        <div class="quick-action" onclick="App.navigate('reports')">
          <i class="fas fa-chart-bar" style="background:var(--info-light);color:var(--info);width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px"></i>
          <span>Reports</span>
        </div>
        <div class="quick-action" onclick="App.navigate('timetable')">
          <i class="fas fa-calendar-alt" style="background:var(--danger-light);color:var(--danger);width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px"></i>
          <span>Timetable</span>
        </div>
      </div>
    </div>
    `);

    /* Charts */
    setTimeout(() => {
      const paid    = invoices.filter(i => i.status === 'paid').length;
      const partial = invoices.filter(i => i.status === 'partial').length;
      const overdue = invoices.filter(i => i.status === 'overdue').length;
      const unpaid  = invoices.filter(i => i.status === 'unpaid').length;

      new Chart(document.getElementById('feeChart'), {
        type:'doughnut',
        data: {
          labels:['Paid','Partial','Overdue','Unpaid'],
          datasets:[{
            data:[paid,partial,overdue,unpaid],
            backgroundColor:['#059669','#D97706','#DC2626','#CBD5E1'],
            borderWidth:3, borderColor:'#fff',
            hoverOffset:6
          }]
        },
        options: {
          responsive:true, maintainAspectRatio:false, cutout:'72%',
          plugins:{
            legend:{ position:'bottom', labels:{ padding:16, font:{ size:12, weight:'600' }, usePointStyle:true, pointStyle:'circle' } }
          }
        }
      });

      const attDays = DB.get('attendance').slice(-6);
      new Chart(document.getElementById('attChart'), {
        type:'line',
        data: {
          labels: attDays.map(d => fmtDate(d.date)),
          datasets:[{
            label:'Attendance %',
            data: attDays.map(d => {
              const tot = d.records.length; const pres = d.records.filter(r => r.status==='present').length;
              return tot > 0 ? Math.round(pres/tot*100) : 100;
            }),
            fill:true,
            backgroundColor:(ctx) => {
              const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
              gradient.addColorStop(0, 'rgba(37,99,235,0.15)');
              gradient.addColorStop(1, 'rgba(37,99,235,0.01)');
              return gradient;
            },
            borderColor:'#2563EB', borderWidth:2.5,
            tension:0.45,
            pointBackgroundColor:'#2563EB', pointRadius:4, pointHoverRadius:6,
            pointBorderColor:'#fff', pointBorderWidth:2
          }]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          scales:{
            y:{ min:70, max:100, ticks:{ callback:v => v+'%', font:{ size:11 } }, grid:{ color:'rgba(0,0,0,0.04)' } },
            x:{ ticks:{ font:{ size:11 } }, grid:{ display:false } }
          },
          plugins:{ legend:{ display:false } }
        }
      });
    }, 100);
  }

  /* ─── TEACHER DASHBOARD ─── */
  function _teacherDashboard() {
    const user = Auth.currentUser;
    const teacher = DB.query('teachers', t => t.userId === user.id)[0];
    if (!teacher) { App.renderPage('<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Teacher profile not found</h3></div>'); return; }

    const myClasses  = DB.get('classes').filter(c => c.homeroomTeacherId === teacher.id || teacher.subjects.some(() => true));
    const myClass    = DB.getById('classes', teacher.homeroomClass);
    const myStudents = myClass ? DB.query('students', s => s.classId === teacher.homeroomClass) : [];
    const today      = new Date().toISOString().split('T')[0];
    const todayAtt   = DB.query('attendance', a => a.classId === teacher.homeroomClass && a.date === today)[0];
    const events     = DB.get('events').filter(e => new Date(e.startDate) >= new Date()).slice(0,4);
    const messages   = DB.get('messages').filter(m => m.recipients.includes(user.id) || m.recipients.includes('teachers') || m.recipients.includes('all')).slice(0,4);

    App.renderPage(`
    <div class="hero-card purple" style="margin-bottom:20px">
      <div class="hero-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <p style="opacity:.7;font-size:13px;margin-bottom:6px;font-weight:500"><i class="fas fa-moon"></i> Good ${_greeting()}</p>
          <h2 style="font-size:24px">${teacher.firstName} ${teacher.lastName}</h2>
          <p style="opacity:.75;margin-top:4px">Homeroom: ${myClass?.name || 'Not assigned'} &nbsp;·&nbsp; Staff ID: ${teacher.staffId}</p>
        </div>
        <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.25);position:relative;z-index:1" onclick="App.navigate('attendance')">
          <i class="fas fa-clipboard-check"></i> Mark Attendance
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-users"></i></div>
        <div class="stat-body">
          <div class="stat-value">${myStudents.length}</div>
          <div class="stat-label">Homeroom Students</div>
        </div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="App.navigate('attendance')">
        <div class="stat-icon ${todayAtt ? 'green' : 'red'}"><i class="fas fa-clipboard-check"></i></div>
        <div class="stat-body">
          <div class="stat-value">${todayAtt ? 'Done' : 'Pending'}</div>
          <div class="stat-label">Today's Attendance</div>
          <div class="stat-change ${todayAtt ? 'up' : 'down'}">${todayAtt ? 'Marked' : 'Not yet marked'}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple"><i class="fas fa-book"></i></div>
        <div class="stat-body">
          <div class="stat-value">${teacher.subjects.length}</div>
          <div class="stat-label">Subjects Teaching</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow"><i class="fas fa-clock"></i></div>
        <div class="stat-body">
          <div class="stat-value">${teacher.workloadHours}h</div>
          <div class="stat-label">Weekly Workload</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Today's Timetable</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('timetable')">Full view</button>
        </div>
        ${_teacherTodayTimetable(teacher)}
      </div>
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Recent Messages</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('communication')">View all</button>
        </div>
        ${messages.map(m => `
          <div style="padding:10px 0;border-bottom:1px solid var(--gray-100);cursor:pointer" onclick="App.navigate('communication')">
            <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${m.subject}</div>
            <div style="font-size:12px;color:var(--gray-400);margin-top:2px">${m.senderName} · ${_timeAgo(m.createdAt)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">Quick Actions</div></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="App.navigate('attendance')"><i class="fas fa-clipboard-check"></i> Mark Attendance</button>
        <button class="btn btn-secondary" onclick="App.navigate('academics')"><i class="fas fa-graduation-cap"></i> Enter Grades</button>
        <button class="btn btn-secondary" onclick="App.navigate('timetable')"><i class="fas fa-calendar-alt"></i> My Timetable</button>
        <button class="btn btn-secondary" onclick="App.navigate('communication')"><i class="fas fa-envelope"></i> Send Message</button>
      </div>
    </div>
    `);
  }

  function _teacherTodayTimetable(teacher) {
    const dayIdx = new Date().getDay() - 1; // Mon=0
    if (dayIdx < 0 || dayIdx > 4) return '<div style="padding:20px;text-align:center;color:var(--gray-400)">No classes today (weekend)</div>';
    const timetable = DB.get('timetable');
    const allSlots = [];
    timetable.forEach(tt => {
      const slots = tt.slots.filter(s => s.day === dayIdx && s.teacherId === teacher.id);
      slots.forEach(s => allSlots.push({ ...s, classId: tt.classId }));
    });
    if (!allSlots.length) return '<div style="padding:20px;text-align:center;color:var(--gray-400)">No classes today</div>';
    return allSlots.sort((a,b) => a.period - b.period).map(s => {
      const subj = DB.getById('subjects', s.subjectId);
      const cls  = DB.getById('classes', s.classId);
      return `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--gray-100)">
        <div style="width:60px;text-align:center;font-size:11px;color:var(--gray-400);flex-shrink:0">${s.start}<br>—<br>${s.end}</div>
        <div style="flex:1;background:${subj?.color||'#2563EB'}15;border-left:3px solid ${subj?.color||'#2563EB'};border-radius:0 6px 6px 0;padding:6px 10px">
          <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${subj?.name||'Unknown'}</div>
          <div style="font-size:12px;color:var(--gray-400)">${cls?.name||''} · ${s.room}</div>
        </div>
      </div>`;
    }).join('');
  }

  /* ─── PARENT DASHBOARD ─── */
  function _parentDashboard() {
    const user = Auth.currentUser;
    const myStudents = DB.query('students', s => s.guardians?.some(g => g.userId === user.id));
    const events = DB.get('events').filter(e => new Date(e.startDate) >= new Date()).slice(0,4);
    const messages = DB.get('messages').filter(m => m.recipients.includes(user.id) || m.recipients.includes('parents') || m.recipients.includes('all')).slice(0,4);

    App.renderPage(`
    <div class="hero-card green" style="margin-bottom:20px">
      <div class="hero-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <p style="opacity:.7;font-size:13px;margin-bottom:6px;font-weight:500"><i class="fas fa-leaf"></i> Good ${_greeting()}</p>
          <h2 style="font-size:24px">${user.name}</h2>
          <p style="opacity:.75;margin-top:4px">${myStudents.length} child${myStudents.length !== 1 ? 'ren' : ''} enrolled · InnoLearn International School</p>
        </div>
        <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.25);position:relative;z-index:1" onclick="App.navigate('communication')">
          <i class="fas fa-envelope"></i> Messages
        </button>
      </div>
    </div>

    ${myStudents.length === 0 ? '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>No children linked to your account</h3></div>' :
    myStudents.map(s => {
      const cls    = DB.getById('classes', s.classId);
      const grades = DB.query('grades', g => g.studentId === s.id);
      const avg    = grades.length ? Math.round(grades.reduce((sum,g) => sum + g.percentage, 0) / grades.length) : null;
      const invoice= DB.query('invoices', i => i.studentId === s.id).filter(i => i.termId === 'term2')[0];
      const att    = DB.query('attendance', a => a.classId === s.classId).slice(-10);
      const attP   = att.flatMap(a => a.records).filter(r => r.studentId === s.id && r.status === 'present').length;
      const attT   = att.flatMap(a => a.records).filter(r => r.studentId === s.id).length;
      const attRate= attT > 0 ? Math.round(attP/attT*100) : 100;

      return `<div class="card">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
          <div class="avatar-circle avatar-lg" style="background:var(--primary)">${s.firstName.charAt(0)}</div>
          <div>
            <h3 style="font-size:17px;font-weight:700">${s.firstName} ${s.lastName}</h3>
            <p style="color:var(--gray-500);font-size:13px">${cls?.name || 'Unknown class'} · Adm: ${s.admissionNo}</p>
          </div>
          <button class="btn btn-sm btn-outline" style="margin-left:auto" onclick="App.navigate('students','${s.id}')">View Profile</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          <div style="background:var(--primary-light);border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:22px;font-weight:800;color:var(--primary)">${avg !== null ? avg+'%' : 'N/A'}</div>
            <div style="font-size:12px;color:var(--gray-500)">Average Grade</div>
          </div>
          <div style="background:var(--success-light);border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:22px;font-weight:800;color:var(--success)">${attRate}%</div>
            <div style="font-size:12px;color:var(--gray-500)">Attendance</div>
          </div>
          <div style="background:${invoice?.status==='paid'?'var(--success-light)':invoice?.status==='overdue'?'var(--danger-light)':'var(--warning-light)'};border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:16px;font-weight:800;color:${invoice?.status==='paid'?'var(--success)':invoice?.status==='overdue'?'var(--danger)':'var(--warning)'}">${invoice ? invoice.status.toUpperCase() : 'NO INV.'}</div>
            <div style="font-size:12px;color:var(--gray-500)">Fee Status</div>
          </div>
        </div>
      </div>`;
    }).join('')}

    <div class="grid-2">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Upcoming Events</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('events')">View all</button>
        </div>
        ${events.map(ev => `
          <div style="padding:10px 0;border-bottom:1px solid var(--gray-100)">
            <div style="font-size:13.5px;font-weight:600;color:var(--gray-800)">${ev.title}</div>
            <div style="font-size:12px;color:var(--gray-400)">${fmtDate(ev.startDate)} · ${ev.location||'School'}</div>
          </div>
        `).join('')}
      </div>
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">School Messages</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('communication')">View all</button>
        </div>
        ${messages.map(m => `
          <div style="padding:10px 0;border-bottom:1px solid var(--gray-100);cursor:pointer" onclick="App.navigate('communication')">
            <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${m.subject}</div>
            <div style="font-size:12px;color:var(--gray-400)">${m.senderName} · ${_timeAgo(m.createdAt)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    `);
  }

  /* ─── STUDENT DASHBOARD ─── */
  function _studentDashboard() {
    const user = Auth.currentUser;
    const student = DB.query('students', s => s.userId === user.id)[0];
    if (!student) { App.renderPage('<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Student profile not found</h3></div>'); return; }
    const cls    = DB.getById('classes', student.classId);
    const grades = DB.query('grades', g => g.studentId === student.id);
    const avg    = grades.length ? Math.round(grades.reduce((s,g) => s+g.percentage,0)/grades.length) : null;
    const events = DB.get('events').filter(e => new Date(e.startDate) >= new Date()).slice(0,4);
    const messages = DB.get('messages').filter(m => m.recipients.includes(user.id) || m.recipients.includes('all')).slice(0,3);

    App.renderPage(`
    <div class="hero-card amber" style="margin-bottom:20px">
      <div class="hero-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <p style="opacity:.7;font-size:13px;margin-bottom:6px;font-weight:500"><i class="fas fa-star"></i> Good ${_greeting()}</p>
          <h2 style="font-size:24px">${student.firstName} ${student.lastName}</h2>
          <p style="opacity:.75;margin-top:4px">${cls?.name || 'Unknown class'} &nbsp;·&nbsp; Adm: ${student.admissionNo}</p>
        </div>
        <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.25);position:relative;z-index:1" onclick="App.navigate('academics')">
          <i class="fas fa-graduation-cap"></i> My Grades
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-percent"></i></div>
        <div class="stat-body">
          <div class="stat-value">${avg !== null ? avg+'%' : 'N/A'}</div>
          <div class="stat-label">Average Grade</div>
          <div class="stat-change ${avg >= 75 ? 'up' : 'down'}">${avg >= 90 ? 'Excellent' : avg >= 75 ? 'Good' : avg >= 60 ? 'Fair' : 'Needs work'}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-book-open"></i></div>
        <div class="stat-body">
          <div class="stat-value">${grades.length}</div>
          <div class="stat-label">Assessments</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">Recent Grades</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('academics')">View all</button>
        </div>
        ${grades.slice(-5).reverse().map(g => {
          const subj = DB.getById('subjects', g.subjectId);
          return `<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--gray-100)">
            <div style="width:8px;height:8px;border-radius:50%;background:${subj?.color||'#2563EB'};flex-shrink:0"></div>
            <div style="flex:1"><div style="font-size:13px;font-weight:600">${subj?.name}</div><div style="font-size:12px;color:var(--gray-400)">${g.name} · ${fmtDate(g.date)}</div></div>
            <span class="grade-pill grade-${g.grade?.charAt(0)||'C'}">${g.grade}</span>
            <span style="font-size:13px;font-weight:700;color:var(--gray-600);width:42px;text-align:right">${g.percentage}%</span>
          </div>`;
        }).join('') || '<div class="empty-state" style="padding:30px"><p>No grades yet</p></div>'}
      </div>
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title">School Announcements</div>
        </div>
        ${messages.map(m => `
          <div style="padding:10px 0;border-bottom:1px solid var(--gray-100);cursor:pointer" onclick="App.navigate('communication')">
            <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${m.subject}</div>
            <div style="font-size:12px;color:var(--gray-400)">${m.senderName} · ${_timeAgo(m.createdAt)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    `);
  }

  /* ─── SECTION HEAD DASHBOARD ─── */
  function _sectionHeadDashboard() {
    const user      = Auth.currentUser;
    const myClasses = Auth.myClasses();
    const myClassIds= myClasses.map(c => c.id);
    const secId     = Auth.mySectionId();
    const section   = secId ? DB.get('sections').find(s => s.id === secId) : null;

    const students  = DB.get('students').filter(s => myClassIds.includes(s.classId) && s.status === 'active');
    const today     = new Date().toISOString().split('T')[0];

    // Attendance rate for this section today
    const todayRecs = DB.get('attendance').filter(a => myClassIds.includes(a.classId) && a.date === today);
    const attTotal  = todayRecs.reduce((s,r) => s + r.records.length, 0);
    const attPres   = todayRecs.reduce((s,r) => s + r.records.filter(x => x.status==='present').length, 0);
    const attRate   = attTotal > 0 ? Math.round(attPres/attTotal*100) : null;

    // Teachers in this section (from timetable)
    const ttEntries = DB.get('timetable').filter(tt => myClassIds.includes(tt.classId));
    const tchIds    = [...new Set(ttEntries.flatMap(tt => tt.slots.map(s => s.teacherId)))];
    const teachers  = tchIds.map(id => DB.getById('teachers', id)).filter(Boolean);

    const events    = DB.get('events').filter(e => new Date(e.startDate) >= new Date()).slice(0,4);
    const messages  = DB.get('messages').filter(m => m.recipients.includes(user.id) || m.recipients.includes('all')).slice(0,4);

    App.renderPage(`
    <div class="hero-card" style="background:linear-gradient(135deg,#7C3AED,#4F46E5);margin-bottom:20px">
      <div class="hero-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <p style="opacity:.7;font-size:13px;margin-bottom:6px;font-weight:500"><i class="fas fa-sun"></i> Good ${_greeting()}</p>
          <h2 style="font-size:24px;color:#fff">${user.name}</h2>
          <p style="opacity:.8;margin-top:4px;color:#fff">${section ? section.name + ' Section Head' : 'Section Head'} &nbsp;·&nbsp; ${myClasses.length} classes</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;position:relative;z-index:1">
          <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.25)" onclick="App.navigate('students')"><i class="fas fa-users"></i> My Students</button>
          <button class="btn" style="background:rgba(255,255,255,0.1);color:#fff;border-color:rgba(255,255,255,0.2)" onclick="App.navigate('attendance')"><i class="fas fa-clipboard-check"></i> Attendance</button>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" onclick="App.navigate('students')" style="cursor:pointer">
        <div class="stat-icon blue"><i class="fas fa-user-graduate"></i></div>
        <div class="stat-body">
          <div class="stat-value">${students.length}</div>
          <div class="stat-label">Students in Section</div>
        </div>
      </div>
      <div class="stat-card" onclick="App.navigate('classes')" style="cursor:pointer">
        <div class="stat-icon purple"><i class="fas fa-door-open"></i></div>
        <div class="stat-body">
          <div class="stat-value">${myClasses.length}</div>
          <div class="stat-label">Classes</div>
        </div>
      </div>
      <div class="stat-card" onclick="App.navigate('teachers')" style="cursor:pointer">
        <div class="stat-icon green"><i class="fas fa-chalkboard-teacher"></i></div>
        <div class="stat-body">
          <div class="stat-value">${teachers.length}</div>
          <div class="stat-label">Teachers in Section</div>
        </div>
      </div>
      <div class="stat-card" onclick="App.navigate('attendance')" style="cursor:pointer">
        <div class="stat-icon ${attRate===null?'gray':attRate>=90?'green':attRate>=75?'yellow':'red'}">
          <i class="fas fa-clipboard-check"></i>
        </div>
        <div class="stat-body">
          <div class="stat-value">${attRate !== null ? attRate+'%' : '—'}</div>
          <div class="stat-label">Today's Attendance</div>
          <div class="stat-change">${attRate !== null ? (attRate>=90?'↑ Good':'↓ Needs attention') : 'Not yet submitted'}</div>
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-door-open" style="color:var(--secondary)"></i> My Classes</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('classes')">View all</button>
        </div>
        ${myClasses.slice(0,8).map(cls => {
          const stuCount = students.filter(s => s.classId === cls.id).length;
          const homeroom = DB.get('teachers').find(t => t.id === cls.homeroomTeacherId);
          return `<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--gray-100)">
            <div style="width:38px;height:38px;border-radius:8px;background:var(--secondary-light);color:var(--secondary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;text-align:center;flex-shrink:0">${cls.name.replace('Grade ','G').replace('KG ','KG')}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${cls.name}</div>
              <div style="font-size:12px;color:var(--gray-400)">${homeroom ? homeroom.firstName+' '+homeroom.lastName : 'No homeroom'} · ${cls.room}</div>
            </div>
            <span style="font-size:12px;font-weight:700;color:var(--gray-500)">${stuCount} students</span>
          </div>`;
        }).join('')}
      </div>
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-calendar" style="color:var(--primary)"></i> Upcoming Events</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('events')">View all</button>
        </div>
        ${events.length ? events.map(ev => `
          <div style="padding:9px 0;border-bottom:1px solid var(--gray-100)">
            <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${ev.title}</div>
            <div style="font-size:12px;color:var(--gray-400)">${fmtDate(ev.startDate)} · ${ev.location||'School'}</div>
          </div>
        `).join('') : '<div style="padding:20px;text-align:center;color:var(--gray-400)">No upcoming events</div>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">Quick Actions</div></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="App.navigate('students')"><i class="fas fa-users"></i> Students</button>
        <button class="btn btn-secondary" onclick="App.navigate('academics')"><i class="fas fa-graduation-cap"></i> Academics</button>
        <button class="btn btn-secondary" onclick="App.navigate('attendance')"><i class="fas fa-clipboard-check"></i> Attendance</button>
        <button class="btn btn-secondary" onclick="App.navigate('admissions')"><i class="fas fa-file-import"></i> Admissions</button>
        <button class="btn btn-secondary" onclick="App.navigate('communication')"><i class="fas fa-envelope"></i> Messages</button>
      </div>
    </div>
    `);
  }

  /* ─── EXAMS OFFICER DASHBOARD ─── */
  function _examsDashboard() {
    const user    = Auth.currentUser;
    const classes = Auth.myClasses();
    const events  = DB.get('events').filter(e => e.type === 'exam' && new Date(e.startDate) >= new Date()).slice(0,5);
    const allEvt  = DB.get('events').filter(e => new Date(e.startDate) >= new Date()).slice(0,4);
    const messages= DB.get('messages').filter(m => m.recipients.includes(user.id) || m.recipients.includes('all')).slice(0,4);

    App.renderPage(`
    <div class="hero-card" style="background:linear-gradient(135deg,#0891B2,#0E7490);margin-bottom:20px">
      <div class="hero-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <p style="opacity:.7;font-size:13px;margin-bottom:6px;font-weight:500"><i class="fas fa-sun"></i> Good ${_greeting()}</p>
          <h2 style="font-size:24px;color:#fff">${user.name}</h2>
          <p style="opacity:.8;margin-top:4px;color:#fff">Exams Officer &nbsp;·&nbsp; ${classes.length} classes in scope</p>
        </div>
        <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.25);position:relative;z-index:1" onclick="App.navigate('exams')">
          <i class="fas fa-file-alt"></i> Exam Management
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-file-alt"></i></div>
        <div class="stat-body">
          <div class="stat-value">${events.length}</div>
          <div class="stat-label">Upcoming Exams</div>
        </div>
      </div>
      <div class="stat-card" onclick="App.navigate('classes')" style="cursor:pointer">
        <div class="stat-icon purple"><i class="fas fa-door-open"></i></div>
        <div class="stat-body">
          <div class="stat-value">${classes.length}</div>
          <div class="stat-label">Classes</div>
        </div>
      </div>
      <div class="stat-card" onclick="App.navigate('students')" style="cursor:pointer">
        <div class="stat-icon green"><i class="fas fa-users"></i></div>
        <div class="stat-body">
          <div class="stat-value">${DB.query('students', s=>s.status==='active').length}</div>
          <div class="stat-label">Active Students</div>
        </div>
      </div>
      <div class="stat-card" onclick="App.navigate('academics')" style="cursor:pointer">
        <div class="stat-icon yellow"><i class="fas fa-graduation-cap"></i></div>
        <div class="stat-body">
          <div class="stat-value">${DB.get('grades').length}</div>
          <div class="stat-label">Grade Entries</div>
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-calendar-alt" style="color:var(--danger)"></i> Upcoming Exams</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('events')">View all</button>
        </div>
        ${events.length ? events.map(ev => `
          <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--gray-100)">
            <div style="width:38px;height:38px;border-radius:8px;background:var(--danger-light);color:var(--danger);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;text-align:center;flex-shrink:0">
              ${new Date(ev.startDate).toLocaleDateString('en',{month:'short'}).toUpperCase()}<br>${new Date(ev.startDate).getDate()}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${ev.title}</div>
              <div style="font-size:12px;color:var(--gray-400)">${ev.location||'School'}</div>
            </div>
          </div>
        `).join('') : '<div style="padding:20px;text-align:center;color:var(--gray-400)">No upcoming exams</div>'}
      </div>
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Quick Actions</div></div>
        <div style="display:flex;flex-direction:column;gap:10px;padding:8px 0">
          <button class="btn btn-primary" onclick="App.navigate('exams')"><i class="fas fa-file-alt"></i> Exams Module</button>
          <button class="btn btn-secondary" onclick="App.navigate('academics')"><i class="fas fa-graduation-cap"></i> Gradebook</button>
          <button class="btn btn-secondary" onclick="App.navigate('reports')"><i class="fas fa-chart-bar"></i> Reports</button>
          <button class="btn btn-secondary" onclick="App.navigate('communication')"><i class="fas fa-envelope"></i> Messages</button>
        </div>
      </div>
    </div>
    `);
  }

  /* ─── ADMISSIONS OFFICER DASHBOARD ─── */
  function _admissionsDashboard() {
    const user    = Auth.currentUser;
    const apps    = DB.get('admissions');
    const pending = apps.filter(a => a.status === 'pending' || a.status === 'under_review');
    const approved= apps.filter(a => a.status === 'approved');
    const enrolled= apps.filter(a => a.status === 'enrolled');
    const events  = DB.get('events').filter(e => new Date(e.startDate) >= new Date()).slice(0,4);
    const messages= DB.get('messages').filter(m => m.recipients.includes(user.id) || m.recipients.includes('all')).slice(0,4);

    App.renderPage(`
    <div class="hero-card" style="background:linear-gradient(135deg,#D97706,#B45309);margin-bottom:20px">
      <div class="hero-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <p style="opacity:.7;font-size:13px;margin-bottom:6px;font-weight:500"><i class="fas fa-sun"></i> Good ${_greeting()}</p>
          <h2 style="font-size:24px;color:#fff">${user.name}</h2>
          <p style="opacity:.8;margin-top:4px;color:#fff">Admissions Officer &nbsp;·&nbsp; ${apps.length} total applications</p>
        </div>
        <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.25);position:relative;z-index:1" onclick="App.navigate('admissions')">
          <i class="fas fa-file-import"></i> Admissions
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" onclick="App.navigate('admissions')" style="cursor:pointer">
        <div class="stat-icon yellow"><i class="fas fa-hourglass-half"></i></div>
        <div class="stat-body">
          <div class="stat-value">${pending.length}</div>
          <div class="stat-label">Pending Review</div>
          ${pending.length > 0 ? `<div class="stat-change down">Needs attention</div>` : `<div class="stat-change up">All clear</div>`}
        </div>
      </div>
      <div class="stat-card" onclick="App.navigate('admissions')" style="cursor:pointer">
        <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
        <div class="stat-body">
          <div class="stat-value">${approved.length}</div>
          <div class="stat-label">Approved</div>
        </div>
      </div>
      <div class="stat-card" onclick="App.navigate('students')" style="cursor:pointer">
        <div class="stat-icon blue"><i class="fas fa-user-graduate"></i></div>
        <div class="stat-body">
          <div class="stat-value">${enrolled.length}</div>
          <div class="stat-label">Enrolled This Cycle</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple"><i class="fas fa-file-alt"></i></div>
        <div class="stat-body">
          <div class="stat-value">${apps.length}</div>
          <div class="stat-label">Total Applications</div>
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-clock" style="color:var(--warning)"></i> Pending Applications</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('admissions')">View all</button>
        </div>
        ${pending.length ? pending.slice(0,6).map(a => `
          <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--gray-100);cursor:pointer" onclick="App.navigate('admissions','${a.id}')">
            <div class="avatar-circle" style="background:var(--warning);width:34px;height:34px;font-size:13px;flex-shrink:0">${a.firstName.charAt(0)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${a.firstName} ${a.lastName}</div>
              <div style="font-size:12px;color:var(--gray-400)">Grade ${a.applyingForGrade} · ${fmtDate(a.submittedAt)}</div>
            </div>
            <span class="badge badge-warning">${a.status}</span>
          </div>
        `).join('') : '<div style="padding:20px;text-align:center;color:var(--success)"><i class="fas fa-check-circle"></i> No pending applications</div>'}
      </div>
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Quick Actions</div></div>
        <div style="display:flex;flex-direction:column;gap:10px;padding:8px 0">
          <button class="btn btn-primary" onclick="App.navigate('admissions')"><i class="fas fa-file-import"></i> View Applications</button>
          <button class="btn btn-secondary" onclick="App.navigate('students')"><i class="fas fa-users"></i> Student Directory</button>
          <button class="btn btn-secondary" onclick="App.navigate('classes')"><i class="fas fa-door-open"></i> Class Capacity</button>
          <button class="btn btn-secondary" onclick="App.navigate('communication')"><i class="fas fa-envelope"></i> Messages</button>
        </div>
      </div>
    </div>
    `);
  }

  /* ─── HR DASHBOARD ─── */
  function _hrDashboard() {
    const user     = Auth.currentUser;
    const teachers = DB.get('teachers');
    const active   = teachers.filter(t => t.status === 'active');
    const contract = teachers.filter(t => t.contractType === 'contract');
    const events   = DB.get('events').filter(e => new Date(e.startDate) >= new Date()).slice(0,4);
    const messages = DB.get('messages').filter(m => m.recipients.includes(user.id) || m.recipients.includes('all')).slice(0,4);

    App.renderPage(`
    <div class="hero-card" style="background:linear-gradient(135deg,#475569,#334155);margin-bottom:20px">
      <div class="hero-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <p style="opacity:.7;font-size:13px;margin-bottom:6px;font-weight:500"><i class="fas fa-sun"></i> Good ${_greeting()}</p>
          <h2 style="font-size:24px;color:#fff">${user.name}</h2>
          <p style="opacity:.8;margin-top:4px;color:#fff">HR Department &nbsp;·&nbsp; ${active.length} active staff</p>
        </div>
        <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.25);position:relative;z-index:1" onclick="App.navigate('hr')">
          <i class="fas fa-id-card"></i> HR Module
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" onclick="App.navigate('teachers')" style="cursor:pointer">
        <div class="stat-icon blue"><i class="fas fa-chalkboard-teacher"></i></div>
        <div class="stat-body">
          <div class="stat-value">${active.length}</div>
          <div class="stat-label">Active Staff</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple"><i class="fas fa-file-contract"></i></div>
        <div class="stat-body">
          <div class="stat-value">${contract.length}</div>
          <div class="stat-label">Contract Staff</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-user-check"></i></div>
        <div class="stat-body">
          <div class="stat-value">${active.length - contract.length}</div>
          <div class="stat-label">Permanent Staff</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow"><i class="fas fa-users"></i></div>
        <div class="stat-body">
          <div class="stat-value">${teachers.length}</div>
          <div class="stat-label">Total Staff Records</div>
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card mb-0">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-chalkboard-teacher" style="color:var(--primary)"></i> Staff Overview</div>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('teachers')">View all</button>
        </div>
        ${teachers.slice(0,6).map(t => {
          const subjs = t.subjects.map(sid => DB.getById('subjects', sid)).filter(Boolean);
          return `<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--gray-100);cursor:pointer" onclick="App.navigate('teachers','${t.id}')">
            <div class="avatar-circle" style="background:${t.gender==='Female'?'#7C3AED':'#2563EB'};width:34px;height:34px;font-size:13px;flex-shrink:0">${t.firstName.charAt(0)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--gray-800)">${t.firstName} ${t.lastName}</div>
              <div style="font-size:12px;color:var(--gray-400)">${t.staffId} · ${subjs.map(s=>s.code).join(', ')||'—'}</div>
            </div>
            <span class="badge badge-${t.contractType==='permanent'?'success':'warning'}">${t.contractType}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Quick Actions</div></div>
        <div style="display:flex;flex-direction:column;gap:10px;padding:8px 0">
          <button class="btn btn-primary" onclick="App.navigate('hr')"><i class="fas fa-id-card"></i> HR Module</button>
          <button class="btn btn-secondary" onclick="App.navigate('teachers')"><i class="fas fa-chalkboard-teacher"></i> Staff Directory</button>
          <button class="btn btn-secondary" onclick="App.navigate('communication')"><i class="fas fa-envelope"></i> Messages</button>
        </div>
      </div>
    </div>
    `);
  }

  function _greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  }
  function _timeAgo(d) {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff/60000);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m/60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h/24) + 'd ago';
  }

  return { render };
})();

/* ── Global: dismiss setup wizard ─────────────────────────── */
function dismissWizard(schoolId) {
  localStorage.setItem(`setup_wizard_done_${schoolId}`, 'true');
  const el = document.getElementById('setup-wizard');
  if (el) {
    el.style.transition = 'opacity .3s, max-height .4s';
    el.style.opacity = '0';
    el.style.overflow = 'hidden';
    el.style.maxHeight = el.offsetHeight + 'px';
    setTimeout(() => { el.style.maxHeight = '0'; el.style.margin = '0'; el.style.padding = '0'; }, 50);
    setTimeout(() => el.remove(), 500);
  }
}
