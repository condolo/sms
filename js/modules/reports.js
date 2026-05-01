/* ============================================================
   InnoLearn — Reports & Analytics Module
   ============================================================ */

const Reports = (() => {
  let _tab = 'overview';

  function render() {
    App.setBreadcrumb('<i class="fas fa-chart-bar"></i> Reports & Analytics');
    _renderPage();
  }

  function _renderPage() {
    const students = DB.query('students', s => s.status === 'active');
    const teachers = DB.get('teachers');
    const invoices = DB.get('invoices');
    const grades   = DB.get('grades');
    const attAll   = DB.get('attendance');

    const totalBilled = invoices.reduce((s,i)=>s+i.totalAmount,0);
    const collected   = invoices.reduce((s,i)=>s+i.paidAmount,0);
    const attTotal    = attAll.reduce((s,a)=>s+a.records.length,0);
    const attPresent  = attAll.reduce((s,a)=>s+a.records.filter(r=>r.status==='present').length,0);
    const attRate     = attTotal>0?Math.round(attPresent/attTotal*100):0;
    const avgGrade    = grades.length ? Math.round(grades.reduce((s,g)=>s+(g.percentage||0),0)/grades.length) : 0;

    App.renderPage(`
    <div class="page-header">
      <div class="page-title"><h1>Reports & Analytics</h1><p>Term 2 · 2024-2025</p></div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="Reports.exportAll()"><i class="fas fa-download"></i> Export</button>
      </div>
    </div>

    <!-- KPI Row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin-bottom:24px">
      <div class="report-kpi kpi-blue">
        <div class="kpi-icon"><i class="fas fa-user-graduate"></i></div>
        <div class="value">${students.length}</div>
        <div class="label">Total Students</div>
        <div class="trend"><i class="fas fa-arrow-up"></i> 3 enrolled this term</div>
      </div>
      <div class="report-kpi kpi-green">
        <div class="kpi-icon"><i class="fas fa-clipboard-check"></i></div>
        <div class="value">${attRate}%</div>
        <div class="label">Attendance Rate</div>
        <div class="trend">${attPresent} of ${attTotal} records present</div>
      </div>
      <div class="report-kpi kpi-purple">
        <div class="kpi-icon"><i class="fas fa-graduation-cap"></i></div>
        <div class="value">${avgGrade}%</div>
        <div class="label">Average Grade</div>
        <div class="trend">Across ${grades.length} assessments</div>
      </div>
      <div class="report-kpi kpi-amber">
        <div class="kpi-icon"><i class="fas fa-coins"></i></div>
        <div class="value">${totalBilled>0?Math.round(collected/totalBilled*100):0}%</div>
        <div class="label">Fee Collection</div>
        <div class="trend">KSh ${(collected/1000).toFixed(0)}k of KSh ${(totalBilled/1000).toFixed(0)}k</div>
      </div>
    </div>

    <div class="tabs" id="rep-tabs">
      <button class="tab-btn ${_tab==='overview'?'active':''}"  onclick="Reports.setTab('overview',this)">Overview</button>
      <button class="tab-btn ${_tab==='academic'?'active':''}"  onclick="Reports.setTab('academic',this)">Academic</button>
      <button class="tab-btn ${_tab==='attendance'?'active':''}"onclick="Reports.setTab('attendance',this)">Attendance</button>
      <button class="tab-btn ${_tab==='finance'?'active':''}"   onclick="Reports.setTab('finance',this)">Financial</button>
      <button class="tab-btn ${_tab==='enrollment'?'active':''}"onclick="Reports.setTab('enrollment',this)">Enrollment</button>
    </div>

    <div id="rep-content">
      ${_tabContent(_tab)}
    </div>
    `);

    setTimeout(() => _buildCharts(_tab), 150);
  }

  function _tabContent(tab) {
    if (tab === 'overview')    return _overviewTab();
    if (tab === 'academic')    return _academicTab();
    if (tab === 'attendance')  return _attendanceTab();
    if (tab === 'finance')     return _financeTab();
    if (tab === 'enrollment')  return _enrollmentTab();
    return '';
  }

  function _overviewTab() {
    return `
    <div class="grid-2">
      <div class="card mb-0"><div class="card-header"><div class="card-title">Students by Grade</div></div><div class="chart-wrap"><canvas id="gradeDistChart"></canvas></div></div>
      <div class="card mb-0"><div class="card-header"><div class="card-title">Gender Distribution</div></div><div class="chart-wrap"><canvas id="genderChart"></canvas></div></div>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <div class="card mb-0"><div class="card-header"><div class="card-title">Attendance Trend (Last 6 Days)</div></div><div class="chart-wrap"><canvas id="attTrendChart"></canvas></div></div>
      <div class="card mb-0"><div class="card-header"><div class="card-title">Fee Collection by Status</div></div><div class="chart-wrap"><canvas id="feeStatusChart"></canvas></div></div>
    </div>`;
  }

  function _academicTab() {
    const grades   = DB.get('grades');
    const subjects = DB.get('subjects');
    const bySubj   = {};
    grades.forEach(g => {
      if (!bySubj[g.subjectId]) bySubj[g.subjectId] = [];
      bySubj[g.subjectId].push(g.percentage);
    });

    return `
    <div class="card mb-0">
      <div class="card-header"><div class="card-title">Subject Performance Averages</div></div>
      <div class="chart-wrap" style="height:300px"><canvas id="subjPerfChart"></canvas></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">Subject Breakdown</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Subject</th><th>Assessments</th><th>Avg Score</th><th>Highest</th><th>Lowest</th><th>Pass Rate</th></tr></thead>
        <tbody>
          ${subjects.map(s => {
            const sg = grades.filter(g => g.subjectId === s.id).map(g => g.percentage).filter(p => p !== null);
            if (!sg.length) return '';
            const avg  = Math.round(sg.reduce((a,b)=>a+b,0)/sg.length);
            const max  = Math.max(...sg);
            const min  = Math.min(...sg);
            const pass = Math.round(sg.filter(p=>p>=50).length/sg.length*100);
            return `<tr>
              <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color};margin-right:6px"></span><strong>${s.name}</strong></td>
              <td>${sg.length}</td>
              <td><span style="font-weight:700;color:var(--${gradeColor(avg)})">${avg}%</span></td>
              <td style="color:var(--success);font-weight:600">${max}%</td>
              <td style="color:var(--danger);font-weight:600">${min}%</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="progress-bar" style="width:80px"><div class="progress-fill ${pass>=80?'success':'warning'}" style="width:${pass}%"></div></div>
                  <span style="font-weight:600;font-size:12px">${pass}%</span>
                </div>
              </td>
            </tr>`;
          }).filter(Boolean).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:20px">No grades recorded</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
  }

  function _attendanceTab() {
    const attAll  = DB.get('attendance');
    const classes = DB.get('classes');
    const stats   = classes.map(cls => {
      const clsAtt = attAll.filter(a => a.classId === cls.id);
      const total  = clsAtt.reduce((s,a) => s+a.records.length, 0);
      const pres   = clsAtt.reduce((s,a) => s+a.records.filter(r=>r.status==='present').length, 0);
      const rate   = total > 0 ? Math.round(pres/total*100) : null;
      return { cls, rate, days: clsAtt.length };
    });

    return `
    <div class="card mb-0">
      <div class="card-header"><div class="card-title">Attendance by Class</div></div>
      <div class="chart-wrap"><canvas id="attByClassChart"></canvas></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">Class Attendance Summary</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Class</th><th>Days Recorded</th><th>Attendance Rate</th><th>Status</th></tr></thead>
        <tbody>
          ${stats.filter(s=>s.rate!==null).map(s=>`<tr>
            <td><strong>${s.cls.name}</strong></td>
            <td>${s.days}</td>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div class="progress-bar" style="width:100px"><div class="progress-fill ${s.rate>=90?'success':s.rate>=75?'warning':'danger'}" style="width:${s.rate}%"></div></div>
                <span style="font-weight:700;color:var(--${s.rate>=90?'success':s.rate>=75?'warning':'danger'})">${s.rate}%</span>
              </div>
            </td>
            <td><span class="badge badge-${s.rate>=90?'success':s.rate>=75?'warning':'danger'}">${s.rate>=90?'Excellent':s.rate>=75?'Good':'Needs Attention'}</span></td>
          </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:20px">No attendance records</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
  }

  function _financeTab() {
    const invoices = DB.get('invoices');
    const totalBilled = invoices.reduce((s,i)=>s+i.totalAmount,0);
    const collected   = invoices.reduce((s,i)=>s+i.paidAmount,0);
    const outstanding = invoices.reduce((s,i)=>s+i.balance,0);
    const byClass     = {};

    invoices.forEach(inv => {
      const stu = DB.getById('students', inv.studentId);
      if (!stu) return;
      const cls = DB.getById('classes', stu.classId);
      const key = cls?.name || 'Unknown';
      if (!byClass[key]) byClass[key] = { billed:0, collected:0, count:0 };
      byClass[key].billed    += inv.totalAmount;
      byClass[key].collected += inv.paidAmount;
      byClass[key].count++;
    });

    return `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      <div style="background:var(--success-light);border:1px solid #A7F3D0;border-radius:var(--radius);padding:16px 20px">
        <div style="font-size:12px;color:var(--success);font-weight:700;text-transform:uppercase">Collected</div>
        <div style="font-size:24px;font-weight:800;color:var(--success);margin-top:4px">${fmtMoney(collected)}</div>
      </div>
      <div style="background:var(--danger-light);border:1px solid #FECACA;border-radius:var(--radius);padding:16px 20px">
        <div style="font-size:12px;color:var(--danger);font-weight:700;text-transform:uppercase">Outstanding</div>
        <div style="font-size:24px;font-weight:800;color:var(--danger);margin-top:4px">${fmtMoney(outstanding)}</div>
      </div>
      <div style="background:var(--primary-light);border:1px solid #BFDBFE;border-radius:var(--radius);padding:16px 20px">
        <div style="font-size:12px;color:var(--primary);font-weight:700;text-transform:uppercase">Total Billed</div>
        <div style="font-size:24px;font-weight:800;color:var(--primary);margin-top:4px">${fmtMoney(totalBilled)}</div>
      </div>
    </div>
    <div class="card mb-0">
      <div class="card-header"><div class="card-title">Revenue by Class</div></div>
      <div class="chart-wrap"><canvas id="revByClassChart"></canvas></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">Fee Collection by Class</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Class</th><th>Students</th><th>Total Billed</th><th>Collected</th><th>Outstanding</th><th>Rate</th></tr></thead>
        <tbody>
          ${Object.keys(byClass).map(cls=>{const d=byClass[cls];const rate=d.billed>0?Math.round(d.collected/d.billed*100):0;return`<tr>
            <td><strong>${cls}</strong></td>
            <td>${d.count}</td>
            <td>${fmtMoney(d.billed)}</td>
            <td style="color:var(--success);font-weight:600">${fmtMoney(d.collected)}</td>
            <td style="color:${d.billed-d.collected>0?'var(--danger)':'var(--success)'};font-weight:600">${fmtMoney(d.billed-d.collected)}</td>
            <td><span style="font-weight:700;color:var(--${rate>=80?'success':rate>=50?'warning':'danger'})">${rate}%</span></td>
          </tr>`;}).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:20px">No data</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
  }

  function _enrollmentTab() {
    const students    = DB.get('students');
    const classes     = DB.get('classes');
    const byGender    = { Male:0, Female:0, Other:0 };
    const byNat       = {};
    const byStatus    = {};
    students.forEach(s => {
      byGender[s.gender] = (byGender[s.gender]||0)+1;
      byNat[s.nationality] = (byNat[s.nationality]||0)+1;
      byStatus[s.status]   = (byStatus[s.status]||0)+1;
    });

    return `
    <div class="grid-2">
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Enrollment by Status</div></div>
        <div class="chart-wrap"><canvas id="statusChart"></canvas></div>
      </div>
      <div class="card mb-0">
        <div class="card-header"><div class="card-title">Top Nationalities</div></div>
        ${Object.entries(byNat).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([nat,cnt])=>`
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--gray-50)">
          <div style="flex:1"><div style="font-size:13px;font-weight:600">${nat}</div>
            <div class="progress-bar" style="margin-top:4px"><div class="progress-fill primary" style="width:${Math.round(cnt/students.length*100)}%"></div></div>
          </div>
          <div style="font-size:13px;font-weight:700;color:var(--gray-700)">${cnt}</div>
        </div>`).join('')}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">Enrollment by Class</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Class</th><th>Students</th><th>Capacity</th><th>Fill Rate</th></tr></thead>
        <tbody>
          ${classes.map(c=>{const cnt=students.filter(s=>s.classId===c.id&&s.status==='active').length;const pct=Math.round(cnt/c.capacity*100);return`<tr>
            <td><strong>${c.name}</strong></td>
            <td>${cnt}</td>
            <td>${c.capacity}</td>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="progress-bar" style="width:80px"><div class="progress-fill ${pct>=90?'danger':'primary'}" style="width:${pct}%"></div></div><span style="font-size:12px;font-weight:600">${pct}%</span></div></td>
          </tr>`;}).join('')}
        </tbody>
      </table></div>
    </div>`;
  }

  function _buildCharts(tab) {
    if (tab === 'overview') {
      /* Students by grade */
      const students = DB.get('students');
      const byGrade  = {};
      students.forEach(s => {
        const cls = DB.getById('classes', s.classId);
        if (cls) byGrade[`G${cls.grade}`] = (byGrade[`G${cls.grade}`]||0)+1;
      });
      const gCtx = document.getElementById('gradeDistChart');
      if (gCtx) new Chart(gCtx, { type:'bar', data:{labels:Object.keys(byGrade),datasets:[{label:'Students',data:Object.values(byGrade),backgroundColor:'#2563EB',borderRadius:4}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}} });

      /* Gender */
      const genCtx = document.getElementById('genderChart');
      const male = students.filter(s=>s.gender==='Male').length;
      const female = students.filter(s=>s.gender==='Female').length;
      if (genCtx) new Chart(genCtx, { type:'doughnut', data:{labels:['Male','Female'],datasets:[{data:[male,female],backgroundColor:['#2563EB','#7C3AED'],borderWidth:0}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}} });

      /* Attendance trend */
      const attDays = DB.get('attendance').slice(-6);
      const attCtx  = document.getElementById('attTrendChart');
      if (attCtx) new Chart(attCtx, { type:'line', data:{labels:attDays.map(d=>fmtDate(d.date)),datasets:[{label:'%',data:attDays.map(d=>{const t=d.records.length;const p=d.records.filter(r=>r.status==='present').length;return t>0?Math.round(p/t*100):100;}),fill:true,backgroundColor:'rgba(37,99,235,.1)',borderColor:'#2563EB',tension:.4,pointBackgroundColor:'#2563EB'}]}, options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:60,max:100,ticks:{callback:v=>v+'%'}}},plugins:{legend:{display:false}}} });

      /* Fee status */
      const invs = DB.get('invoices');
      const fsCtx = document.getElementById('feeStatusChart');
      if (fsCtx) new Chart(fsCtx, { type:'doughnut', data:{labels:['Paid','Partial','Overdue','Unpaid'],datasets:[{data:[invs.filter(i=>i.status==='paid').length,invs.filter(i=>i.status==='partial').length,invs.filter(i=>i.status==='overdue').length,invs.filter(i=>i.status==='unpaid').length],backgroundColor:['#059669','#D97706','#DC2626','#94A3B8'],borderWidth:0}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}} });
    }

    if (tab === 'academic') {
      const subjects = DB.get('subjects');
      const grades   = DB.get('grades');
      const avgs     = subjects.map(s => { const g=grades.filter(x=>x.subjectId===s.id&&x.percentage!==null).map(x=>x.percentage); return g.length?Math.round(g.reduce((a,b)=>a+b,0)/g.length):null; });
      const spCtx = document.getElementById('subjPerfChart');
      if (spCtx) new Chart(spCtx, { type:'horizontalBar'||'bar', data:{labels:subjects.map(s=>s.name),datasets:[{label:'Avg %',data:avgs,backgroundColor:subjects.map(s=>s.color),borderRadius:4}]}, options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{min:0,max:100,ticks:{callback:v=>v+'%'}}},plugins:{legend:{display:false}}} });
    }

    if (tab === 'attendance') {
      const classes = DB.get('classes');
      const attAll  = DB.get('attendance');
      const rates   = classes.map(c => { const ca=attAll.filter(a=>a.classId===c.id); const t=ca.reduce((s,a)=>s+a.records.length,0); const p=ca.reduce((s,a)=>s+a.records.filter(r=>r.status==='present').length,0); return t>0?Math.round(p/t*100):null; });
      const valid   = classes.map((c,i)=>({name:c.name,rate:rates[i]})).filter(x=>x.rate!==null);
      const abcCtx  = document.getElementById('attByClassChart');
      if (abcCtx) new Chart(abcCtx, { type:'bar', data:{labels:valid.map(x=>x.name),datasets:[{label:'Attendance %',data:valid.map(x=>x.rate),backgroundColor:valid.map(x=>x.rate>=90?'#059669':x.rate>=75?'#D97706':'#DC2626'),borderRadius:4}]}, options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%'}}},plugins:{legend:{display:false}}} });
    }

    if (tab === 'finance') {
      const invoices = DB.get('invoices');
      const byClass  = {};
      invoices.forEach(inv=>{const s=DB.getById('students',inv.studentId);const c=s?DB.getById('classes',s.classId):null;const k=c?.name||'Unknown';if(!byClass[k])byClass[k]={c:0,b:0};byClass[k].c+=inv.paidAmount;byClass[k].b+=inv.totalAmount;});
      const rCtx = document.getElementById('revByClassChart');
      if (rCtx) new Chart(rCtx, { type:'bar', data:{labels:Object.keys(byClass),datasets:[{label:'Collected',data:Object.values(byClass).map(d=>d.c),backgroundColor:'#059669',borderRadius:4},{label:'Total Billed',data:Object.values(byClass).map(d=>d.b),backgroundColor:'rgba(37,99,235,.3)',borderRadius:4}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}}} });
    }

    if (tab === 'enrollment') {
      const students = DB.get('students');
      const byStatus = {};
      students.forEach(s=>{byStatus[s.status]=(byStatus[s.status]||0)+1;});
      const stCtx = document.getElementById('statusChart');
      if (stCtx) new Chart(stCtx, { type:'pie', data:{labels:Object.keys(byStatus),datasets:[{data:Object.values(byStatus),backgroundColor:['#059669','#D97706','#2563EB','#DC2626'],borderWidth:0}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}} });
    }
  }

  function setTab(tab, btn) {
    _tab = tab;
    document.querySelectorAll('#rep-tabs .tab-btn').forEach(b=>b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const el = document.getElementById('rep-content');
    if (el) el.innerHTML = _tabContent(tab);
    setTimeout(() => _buildCharts(tab), 150);
  }

  function exportAll() {
    /* Build a multi-section CSV: students, attendance summary, grades summary */
    const rows = [];
    const students = DB.get('students');
    const classes  = DB.get('classes');
    const attAll   = DB.get('attendance');
    const grades   = DB.get('grades');

    /* --- Student roster --- */
    rows.push(['=== STUDENT ROSTER ===']);
    rows.push(['Admission No','Name','Gender','Class','Status','Enrolled Subjects']);
    students.forEach(s => {
      const cls = DB.getById('classes', s.classId);
      rows.push([s.admissionNo, `${s.firstName} ${s.lastName}`, s.gender, cls?.name||'—', s.status, (s.enrolledSubjectIds||[]).length]);
    });

    rows.push([]);
    /* --- Attendance summary --- */
    rows.push(['=== ATTENDANCE SUMMARY ===']);
    rows.push(['Student','Class','Days Recorded','Days Present','Attendance Rate']);
    students.forEach(s => {
      const cls  = DB.getById('classes', s.classId);
      const recs = attAll.flatMap(a => a.records.filter(r => r.studentId === s.id));
      const pres = recs.filter(r => r.status === 'present').length;
      const rate = recs.length > 0 ? (pres/recs.length*100).toFixed(1)+'%' : '—';
      rows.push([`${s.firstName} ${s.lastName}`, cls?.name||'—', recs.length, pres, rate]);
    });

    rows.push([]);
    /* --- Grades summary --- */
    rows.push(['=== GRADES SUMMARY ===']);
    rows.push(['Student','Class','Subject','Assessment','Score','Max','Percentage','Grade']);
    grades.forEach(g => {
      const stu  = DB.getById('students', g.studentId);
      const cls  = DB.getById('classes', g.classId);
      const subj = DB.getById('subjects', g.subjectId);
      rows.push([
        stu ? `${stu.firstName} ${stu.lastName}` : g.studentId,
        cls?.name||'—', subj?.name||'—', g.name||g.type,
        g.score, g.maxScore, g.percentage!=null?g.percentage.toFixed(1)+'%':'—', g.grade||'—'
      ]);
    });

    const csv  = rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `InnoLearn-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    showToast('Report exported as CSV.', 'success');
  }

  return { render, setTab, exportAll };
})();
