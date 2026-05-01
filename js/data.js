/* ============================================================
   InnoLearn — Data Layer (DB + Seed Data)
   Hybrid: localStorage (synchronous, instant) +
           API server (async background sync for persistence).
   All existing module code works unchanged — DB.get/insert/
   update/remove remain synchronous via localStorage.
   Changes are mirrored to the server in the background.
   ============================================================ */

const DB = (() => {
  const PREFIX = 'ss_';

  /* ── API sync helpers ──────────────────────────────────────
     These talk to the Express backend when it's available.
     If the server is unreachable, localStorage is the fallback.
  ─────────────────────────────────────────────────────────── */
  const API_BASE = '/api/collections';

  function _token() {
    return localStorage.getItem('ss_jwt') || sessionStorage.getItem('ss_jwt') || '';
  }

  function _authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_token()}` };
  }

  function _serverAvailable() {
    return !!_token();
  }

  /* Push a single write to the server (fire-and-forget) */
  function _push(method, col, data, id) {
    if (!_serverAvailable()) return;
    const url = id ? `${API_BASE}/${col}/${id}` : `${API_BASE}/${col}`;
    fetch(url, { method, headers: _authHeaders(), body: JSON.stringify(data) })
      .catch(() => {}); // silent — localStorage is the source of truth during session
  }

  /* On login: pull ALL school data from server into localStorage */
  async function syncFromServer() {
    if (!_serverAvailable()) return false;
    try {
      const res  = await fetch('/api/sync', { headers: _authHeaders() });
      if (!res.ok) return false;
      const data = await res.json();
      Object.entries(data).forEach(([col, rows]) => {
        if (Array.isArray(rows) && rows.length > 0) {
          localStorage.setItem(_key(col), JSON.stringify(rows));
        }
      });
      console.log('[DB] Synced from server.');
      return true;
    } catch { return false; }
  }

  /* Push entire localStorage to server (data migration tool) */
  async function pushToServer() {
    if (!_serverAvailable()) return false;
    const payload = {};
    Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => {
      const col = k.slice(PREFIX.length);
      if (col.startsWith('_')) return; // skip _version etc.
      try { payload[col] = JSON.parse(localStorage.getItem(k)); } catch {}
    });
    try {
      const res = await fetch('/api/sync', {
        method: 'POST', headers: _authHeaders(), body: JSON.stringify(payload)
      });
      return res.ok;
    } catch { return false; }
  }

  /* ── localStorage CRUD (synchronous — all modules use these) ─ */

  function _key(col) { return PREFIX + col; }

  function get(col) {
    try { return JSON.parse(localStorage.getItem(_key(col))) || []; }
    catch(e) { return []; }
  }

  function getById(col, id) {
    return get(col).find(r => r.id === id) || null;
  }

  function query(col, fn) {
    return get(col).filter(fn);
  }

  function insert(col, data) {
    const rows = get(col);
    const rec  = { ...data, id: data.id || _uid(), createdAt: data.createdAt || new Date().toISOString() };
    rows.push(rec);
    localStorage.setItem(_key(col), JSON.stringify(rows));
    _push('POST', col, rec);   // async mirror to server
    return rec;
  }

  function update(col, id, data) {
    const rows = get(col).map(r => r.id === id ? { ...r, ...data, updatedAt: new Date().toISOString() } : r);
    localStorage.setItem(_key(col), JSON.stringify(rows));
    _push('PUT', col, { ...data, updatedAt: new Date().toISOString() }, id);  // async mirror
    return rows.find(r => r.id === id);
  }

  function remove(col, id) {
    const rows = get(col).filter(r => r.id !== id);
    localStorage.setItem(_key(col), JSON.stringify(rows));
    _push('DELETE', col, null, id);   // async mirror
  }

  function set(col, rows) {
    localStorage.setItem(_key(col), JSON.stringify(rows));
  }

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  function reset() {
    Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
    seed();
    console.log('DB reset to seed data.');
  }

  /* ── JWT token helpers (for auth module) ─────────────────── */
  function setToken(token, remember) {
    if (remember) { localStorage.setItem('ss_jwt', token); }
    sessionStorage.setItem('ss_jwt', token);
  }

  function clearToken() {
    localStorage.removeItem('ss_jwt');
    sessionStorage.removeItem('ss_jwt');
  }

  const SEED_VERSION = '21';
  function isSeeded() {
    return localStorage.getItem(_key('_version')) === SEED_VERSION;
  }
  function _markSeeded() {
    localStorage.setItem(_key('_version'), SEED_VERSION);
  }

  /* ─────────────── SEED DATA ─────────────── */
  function seed() {
    /* SCHOOL */
    set('schools', [{
      id: 'sch1',
      name: 'InnoLearn International School',
      shortName: 'IIS',
      code: 'IIS-001',
      address: '14 Ngong Road, Nairobi, Kenya',
      phone: '+254 20 386 4000',
      email: 'info@innolearn.edu.ke',
      website: 'www.innolearn.edu.ke',
      logo: null,
      motto: 'Excellence Through Knowledge',
      type: 'international',
      curriculum: ['cambridge', 'ib'],
      timezone: 'Africa/Nairobi',
      currency: 'KES',
      currencySymbol: 'KSh',
      currentAcademicYearId: 'ay2025',
      currentTermId: 'term2',
      plan: 'standard',        // Subscription plan: core | standard | premium | enterprise
      addOns: [],              // Extra paid add-on modules
      slug: 'innolearn',        // Used for subdomain: innolearn.innolearn.com
      isActive: true,
      createdAt: '2020-01-01T00:00:00.000Z'
    }]);

    /* SECTIONS */
    set('sections', [
      { id:'sec_kg',  schoolId:'sch1', name:'KG',        order:1, color:'#F59E0B', description:'Kindergarten – Early Years', grades:['KG1','KG2','KG3'], bellScheduleId:'bs_kg'  },
      { id:'sec_pri', schoolId:'sch1', name:'Primary',   order:2, color:'#10B981', description:'Primary School – Grades 1 to 6', grades:[1,2,3,4,5,6],   bellScheduleId:'bs_pri' },
      { id:'sec_sec', schoolId:'sch1', name:'Secondary', order:3, color:'#3B82F6', description:'Secondary School – Grades 7 to 13', grades:[7,8,9,10,11,12,13], bellScheduleId:'bs_sec' }
    ]);

    /* BELL SCHEDULES — one per section, fully editable in Timetable → Bell Schedules tab */
    set('bell_schedules', [
      {
        id: 'bs_kg', schoolId: 'sch1', sectionId: 'sec_kg',
        name: 'KG Bell Schedule', lessonDuration: 40,
        periods: [
          { p:1,    start:'07:30', end:'08:10', isBreak:false, label:'Period 1' },
          { p:2,    start:'08:10', end:'08:50', isBreak:false, label:'Period 2' },
          { p:'B1', start:'08:50', end:'09:10', isBreak:true,  label:'Morning Break' },
          { p:3,    start:'09:10', end:'09:50', isBreak:false, label:'Period 3' },
          { p:4,    start:'09:50', end:'10:30', isBreak:false, label:'Period 4' },
          { p:'L',  start:'10:30', end:'11:10', isBreak:true,  label:'Lunch' },
          { p:5,    start:'11:10', end:'11:50', isBreak:false, label:'Period 5' },
          { p:6,    start:'11:50', end:'12:30', isBreak:false, label:'Period 6' }
        ]
      },
      {
        id: 'bs_pri', schoolId: 'sch1', sectionId: 'sec_pri',
        name: 'Primary Bell Schedule', lessonDuration: 40,
        periods: [
          { p:1,    start:'07:30', end:'08:10', isBreak:false, label:'Period 1' },
          { p:2,    start:'08:10', end:'08:50', isBreak:false, label:'Period 2' },
          { p:3,    start:'08:50', end:'09:30', isBreak:false, label:'Period 3' },
          { p:'B1', start:'09:30', end:'09:50', isBreak:true,  label:'Morning Break' },
          { p:4,    start:'09:50', end:'10:30', isBreak:false, label:'Period 4' },
          { p:5,    start:'10:30', end:'11:10', isBreak:false, label:'Period 5' },
          { p:6,    start:'11:10', end:'11:50', isBreak:false, label:'Period 6' },
          { p:'L',  start:'11:50', end:'12:30', isBreak:true,  label:'Lunch Break' },
          { p:7,    start:'12:30', end:'13:10', isBreak:false, label:'Period 7' }
        ]
      },
      {
        id: 'bs_sec', schoolId: 'sch1', sectionId: 'sec_sec',
        name: 'Secondary Bell Schedule', lessonDuration: 60,
        periods: [
          { p:1,   start:'07:30', end:'08:30', isBreak:false, label:'Period 1' },
          { p:2,   start:'08:30', end:'09:30', isBreak:false, label:'Period 2' },
          { p:3,   start:'09:30', end:'10:30', isBreak:false, label:'Period 3' },
          { p:'B', start:'10:30', end:'11:00', isBreak:true,  label:'Short Break' },
          { p:4,   start:'11:00', end:'12:00', isBreak:false, label:'Period 4' },
          { p:5,   start:'12:00', end:'13:00', isBreak:false, label:'Period 5' },
          { p:'L', start:'13:00', end:'14:00', isBreak:true,  label:'Lunch Break' },
          { p:6,   start:'14:00', end:'15:00', isBreak:false, label:'Period 6' },
          { p:7,   start:'15:00', end:'16:00', isBreak:false, label:'Period 7' }
        ]
      }
    ]);

    /* ACADEMIC YEARS */
    set('academicYears', [{
      id: 'ay2025',
      schoolId: 'sch1',
      name: '2024 – 2025',
      startDate: '2025-01-06',
      endDate: '2025-11-28',
      isCurrent: true,
      terms: [
        { id: 'term1', name: 'Term 1', startDate: '2025-01-06', endDate: '2025-03-28', isCurrent: false },
        { id: 'term2', name: 'Term 2', startDate: '2025-04-28', endDate: '2025-07-25', isCurrent: true },
        { id: 'term3', name: 'Term 3', startDate: '2025-09-01', endDate: '2025-11-28', isCurrent: false }
      ]
    }, {
      id: 'ay2024',
      schoolId: 'sch1',
      name: '2023 – 2024',
      startDate: '2024-01-08',
      endDate: '2024-11-29',
      isCurrent: false,
      terms: [
        { id: 'ay24t1', name: 'Term 1', startDate: '2024-01-08', endDate: '2024-03-29', isCurrent: false },
        { id: 'ay24t2', name: 'Term 2', startDate: '2024-04-29', endDate: '2024-07-26', isCurrent: false },
        { id: 'ay24t3', name: 'Term 3', startDate: '2024-09-02', endDate: '2024-11-29', isCurrent: false }
      ]
    }]);

    /* USERS */
    set('users', [
      /* ── SUPER ADMIN ── */
      { id:'u_super',  schoolId:'sch1', role:'superadmin', primaryRole:'superadmin', roles:['superadmin'], name:'System Administrator', email:'superadmin@innolearn.edu.ke', password:'super123', phone:'+254 722 000 000', avatar:null, isActive:true, lastLogin:'2025-04-23T08:00:00Z', createdAt:'2020-01-01T00:00:00Z' },
      /* ── PRINCIPAL / ADMIN ── */
      { id:'u_admin1', schoolId:'sch1', role:'admin', primaryRole:'admin', roles:['admin'], name:'Mwalimu Ndolo', email:'admin@innolearn.edu.ke', password:'admin123', phone:'+254 722 000 001', avatar:null, isActive:true, lastLogin:'2025-04-23T08:00:00Z', createdAt:'2020-01-01T00:00:00Z' },
      { id:'u_admin2', schoolId:'sch1', role:'admin', primaryRole:'admin', roles:['admin'], name:'Mr. David Kariuki', email:'vice@innolearn.edu.ke', password:'admin123', phone:'+254 722 000 002', avatar:null, isActive:true, lastLogin:'2025-04-22T09:00:00Z', createdAt:'2020-01-01T00:00:00Z' },
      /* ── SECTION HEADS ── */
      { id:'u_sh_kg',  schoolId:'sch1', role:'section_head', primaryRole:'section_head', roles:['section_head'], name:'Ms. Rose Akinyi', email:'head.kg@innolearn.edu.ke', password:'section123', phone:'+254 722 010 001', avatar:null, isActive:true, sectionId:'sec_kg',  lastLogin:'2025-04-23T07:30:00Z', createdAt:'2021-01-01T00:00:00Z' },
      { id:'u_sh_pri', schoolId:'sch1', role:'section_head', primaryRole:'section_head', roles:['section_head'], name:'Mr. Collins Kimani', email:'head.primary@innolearn.edu.ke', password:'section123', phone:'+254 722 010 002', avatar:null, isActive:true, sectionId:'sec_pri', lastLogin:'2025-04-23T07:35:00Z', createdAt:'2021-01-01T00:00:00Z' },
      { id:'u_sh_sec', schoolId:'sch1', role:'section_head', primaryRole:'section_head', roles:['section_head','teacher'], name:'Dr. Amira Osei', email:'head.secondary@innolearn.edu.ke', password:'section123', phone:'+254 722 010 003', avatar:null, isActive:true, sectionId:'sec_sec', lastLogin:'2025-04-23T07:40:00Z', createdAt:'2020-08-01T00:00:00Z' },
      /* ── TIMETABLER ── */
      { id:'u_ttbl1', schoolId:'sch1', role:'timetabler', primaryRole:'timetabler', roles:['timetabler'], name:'Mr. Kevin Njoroge', email:'timetabler@innolearn.edu.ke', password:'timetable123', phone:'+254 722 010 010', avatar:null, isActive:true, lastLogin:'2025-04-23T07:50:00Z', createdAt:'2023-01-01T00:00:00Z' },
      /* ── DEPUTY PRINCIPAL ── */
      { id:'u_dp1',   schoolId:'sch1', role:'deputy_principal', primaryRole:'deputy_principal', roles:['deputy_principal'], name:'Mr. Thomas Wangila', email:'deputy@innolearn.edu.ke', password:'deputy123', phone:'+254 722 010 020', avatar:null, isActive:true, lastLogin:'2025-04-23T07:45:00Z', createdAt:'2021-01-01T00:00:00Z' },
      /* ── DISCIPLINE COMMITTEE ── */
      { id:'u_dc1',   schoolId:'sch1', role:'discipline_committee', primaryRole:'discipline_committee', roles:['discipline_committee'], name:'Mrs. Patricia Nduta', email:'discipline@innolearn.edu.ke', password:'discipline123', phone:'+254 722 010 021', avatar:null, isActive:true, lastLogin:'2025-04-23T07:50:00Z', createdAt:'2022-01-01T00:00:00Z' },
      /* ── ADMISSIONS OFFICER ── */
      { id:'u_adm1',   schoolId:'sch1', role:'admissions_officer', primaryRole:'admissions_officer', roles:['admissions_officer'], name:'Ms. Joy Wambua', email:'admissions@innolearn.edu.ke', password:'admissions123', phone:'+254 722 020 001', avatar:null, isActive:true, lastLogin:'2025-04-23T08:15:00Z', createdAt:'2022-01-01T00:00:00Z' },
      /* ── TEACHERS (u_tch1 = Sarah Smith is also exams_officer — multi-role demo) ── */
      { id:'u_tch1',  schoolId:'sch1', role:'teacher', primaryRole:'teacher', roles:['teacher','exams_officer'], name:'Ms. Sarah Smith', email:'sarah.smith@innolearn.edu.ke', password:'teacher123', phone:'+254 722 100 001', avatar:null, isActive:true, lastLogin:'2025-04-23T07:45:00Z', createdAt:'2021-01-01T00:00:00Z' },
      { id:'u_tch2',  schoolId:'sch1', role:'teacher', primaryRole:'teacher', roles:['teacher'], name:'Mr. James Ochieng', email:'james.ochieng@innolearn.edu.ke', password:'teacher123', phone:'+254 722 100 002', avatar:null, isActive:true, lastLogin:'2025-04-23T07:50:00Z', createdAt:'2021-01-01T00:00:00Z' },
      { id:'u_tch3',  schoolId:'sch1', role:'teacher', primaryRole:'teacher', roles:['teacher'], name:'Ms. Priya Wanjiru', email:'priya.wanjiru@innolearn.edu.ke', password:'teacher123', phone:'+254 722 100 003', avatar:null, isActive:true, lastLogin:'2025-04-22T07:30:00Z', createdAt:'2021-06-01T00:00:00Z' },
      { id:'u_tch4',  schoolId:'sch1', role:'teacher', primaryRole:'teacher', roles:['teacher'], name:'Dr. Ahmed Hassan', email:'ahmed.hassan@innolearn.edu.ke', password:'teacher123', phone:'+254 722 100 004', avatar:null, isActive:true, lastLogin:'2025-04-23T08:10:00Z', createdAt:'2020-08-01T00:00:00Z' },
      { id:'u_tch5',  schoolId:'sch1', role:'teacher', primaryRole:'teacher', roles:['teacher'], name:'Mrs. Grace Kamau', email:'grace.kamau@innolearn.edu.ke', password:'teacher123', phone:'+254 722 100 005', avatar:null, isActive:true, lastLogin:'2025-04-22T15:00:00Z', createdAt:'2022-01-01T00:00:00Z' },
      { id:'u_tch6',  schoolId:'sch1', role:'teacher', primaryRole:'teacher', roles:['teacher'], name:'Mr. Raj Patel', email:'raj.patel@innolearn.edu.ke', password:'teacher123', phone:'+254 722 100 006', avatar:null, isActive:true, lastLogin:'2025-04-21T08:00:00Z', createdAt:'2022-06-01T00:00:00Z' },
      { id:'u_tch7',  schoolId:'sch1', role:'teacher', primaryRole:'teacher', roles:['teacher'], name:'Ms. Fatuma Ngugi', email:'fatuma.ngugi@innolearn.edu.ke', password:'teacher123', phone:'+254 722 100 007', avatar:null, isActive:true, lastLogin:'2025-04-23T07:55:00Z', createdAt:'2023-01-01T00:00:00Z' },
      { id:'u_tch8',  schoolId:'sch1', role:'teacher', primaryRole:'teacher', roles:['teacher'], name:'Mr. Kevin Otieno', email:'kevin.otieno@innolearn.edu.ke', password:'teacher123', phone:'+254 722 100 008', avatar:null, isActive:true, lastLogin:'2025-04-22T09:00:00Z', createdAt:'2023-06-01T00:00:00Z' },
      /* ── FINANCE ── */
      { id:'u_fin1',  schoolId:'sch1', role:'finance', primaryRole:'finance', roles:['finance'], name:'Ms. Nancy Njeri', email:'finance@innolearn.edu.ke', password:'finance123', phone:'+254 722 200 001', avatar:null, isActive:true, lastLogin:'2025-04-23T08:30:00Z', createdAt:'2020-01-01T00:00:00Z' },
      /* ── HR ── */
      { id:'u_hr1',   schoolId:'sch1', role:'hr', primaryRole:'hr', roles:['hr'], name:'Mr. Peter Muthoni', email:'hr@innolearn.edu.ke', password:'hr123', phone:'+254 722 030 001', avatar:null, isActive:true, lastLogin:'2025-04-22T09:00:00Z', createdAt:'2021-06-01T00:00:00Z' },
      /* ── PARENTS ── */
      { id:'u_par1',  schoolId:'sch1', role:'parent', primaryRole:'parent', roles:['parent'], name:'Mr. & Mrs. Johnson', email:'parent1@innolearn.edu.ke', password:'parent123', phone:'+254 722 300 001', avatar:null, isActive:true, lastLogin:'2025-04-22T20:00:00Z', createdAt:'2022-01-01T00:00:00Z' },
      { id:'u_par2',  schoolId:'sch1', role:'parent', primaryRole:'parent', roles:['parent'], name:'Mrs. Achieng Omondi', email:'parent2@innolearn.edu.ke', password:'parent123', phone:'+254 722 300 002', avatar:null, isActive:true, lastLogin:'2025-04-21T19:00:00Z', createdAt:'2022-01-01T00:00:00Z' },
      { id:'u_par3',  schoolId:'sch1', role:'parent', primaryRole:'parent', roles:['parent'], name:'Dr. Suresh Patel', email:'parent3@innolearn.edu.ke', password:'parent123', phone:'+254 722 300 003', avatar:null, isActive:true, lastLogin:'2025-04-20T18:00:00Z', createdAt:'2022-06-01T00:00:00Z' },
      { id:'u_par4',  schoolId:'sch1', role:'parent', primaryRole:'parent', roles:['parent'], name:'Ms. Wanjiku Mwangi', email:'parent4@innolearn.edu.ke', password:'parent123', phone:'+254 722 300 004', avatar:null, isActive:true, lastLogin:'2025-04-19T18:00:00Z', createdAt:'2023-01-01T00:00:00Z' },
      /* ── STUDENTS ── */
      { id:'u_stu1',  schoolId:'sch1', role:'student', primaryRole:'student', roles:['student'], name:'Emily Johnson', email:'student1@innolearn.edu.ke', password:'student123', phone:'+254 722 400 001', avatar:null, isActive:true, lastLogin:'2025-04-23T07:00:00Z', createdAt:'2022-01-10T00:00:00Z' },
      { id:'u_stu2',  schoolId:'sch1', role:'student', primaryRole:'student', roles:['student'], name:'Brian Omondi', email:'student2@innolearn.edu.ke', password:'student123', phone:'+254 722 400 002', avatar:null, isActive:true, lastLogin:'2025-04-23T07:05:00Z', createdAt:'2022-01-10T00:00:00Z' },
      { id:'u_stu3',  schoolId:'sch1', role:'student', primaryRole:'student', roles:['student'], name:'Anika Patel', email:'student3@innolearn.edu.ke', password:'student123', phone:'+254 722 400 003', avatar:null, isActive:true, lastLogin:'2025-04-22T17:00:00Z', createdAt:'2022-06-10T00:00:00Z' },
      { id:'u_stu4',  schoolId:'sch1', role:'student', primaryRole:'student', roles:['student'], name:'Kevin Mwangi', email:'student4@innolearn.edu.ke', password:'student123', phone:'+254 722 400 004', avatar:null, isActive:true, lastLogin:'2025-04-23T07:10:00Z', createdAt:'2023-01-10T00:00:00Z' }
    ]);

    /* SUBJECTS */
    set('subjects', [
      { id: 'sbj1',  schoolId: 'sch1', name: 'English Language',   code: 'ENG',  department: 'Languages',    color: '#3B82F6', credits: 5, isCore: true,  curriculum: ['cambridge','ib','local'] },
      { id: 'sbj2',  schoolId: 'sch1', name: 'Mathematics',        code: 'MATH', department: 'Sciences',     color: '#EF4444', credits: 5, isCore: true,  curriculum: ['cambridge','ib','local'] },
      { id: 'sbj3',  schoolId: 'sch1', name: 'Biology',            code: 'BIO',  department: 'Sciences',     color: '#10B981', credits: 4, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj4',  schoolId: 'sch1', name: 'Chemistry',          code: 'CHEM', department: 'Sciences',     color: '#8B5CF6', credits: 4, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj5',  schoolId: 'sch1', name: 'Physics',            code: 'PHY',  department: 'Sciences',     color: '#F59E0B', credits: 4, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj6',  schoolId: 'sch1', name: 'History',            code: 'HIST', department: 'Humanities',   color: '#EC4899', credits: 3, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj7',  schoolId: 'sch1', name: 'Geography',          code: 'GEO',  department: 'Humanities',   color: '#14B8A6', credits: 3, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj8',  schoolId: 'sch1', name: 'Computer Science',   code: 'CS',   department: 'Technology',   color: '#6366F1', credits: 4, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj9',  schoolId: 'sch1', name: 'Physical Education', code: 'PE',   department: 'Sports',       color: '#F97316', credits: 2, isCore: true,  curriculum: ['cambridge','ib','local'] },
      { id: 'sbj10', schoolId: 'sch1', name: 'Art & Design',       code: 'ART',  department: 'Arts',         color: '#D946EF', credits: 3, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj11', schoolId: 'sch1', name: 'French',             code: 'FRE',  department: 'Languages',    color: '#0EA5E9', credits: 3, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj12', schoolId: 'sch1', name: 'Kiswahili',          code: 'KSW',  department: 'Languages',    color: '#22C55E', credits: 3, isCore: true,  curriculum: ['local'] },
      { id: 'sbj13', schoolId: 'sch1', name: 'Business Studies',   code: 'BUS',  department: 'Business',     color: '#A3E635', credits: 3, isCore: false, curriculum: ['cambridge'] },
      { id: 'sbj14', schoolId: 'sch1', name: 'Economics',          code: 'ECON', department: 'Business',     color: '#FB923C', credits: 3, isCore: false, curriculum: ['cambridge','ib'] },
      { id: 'sbj15', schoolId: 'sch1', name: 'Music',              code: 'MUS',  department: 'Arts',         color: '#E879F9', credits: 2, isCore: false, curriculum: ['cambridge','ib'] }
    ]);

    /* CLASSES */
    set('classes', [
      /* ── KG SECTION (no streams) ── */
      { id:'clsKG1', schoolId:'sch1', grade:'KG1', name:'KG 1', stream:'', level:-2, sectionId:'sec_kg',  homeroomTeacherId:'', capacity:20, room:'KG Block 1', academicYearId:'ay2025' },
      { id:'clsKG2', schoolId:'sch1', grade:'KG2', name:'KG 2', stream:'', level:-1, sectionId:'sec_kg',  homeroomTeacherId:'', capacity:20, room:'KG Block 2', academicYearId:'ay2025' },
      { id:'clsKG3', schoolId:'sch1', grade:'KG3', name:'KG 3', stream:'', level:0,  sectionId:'sec_kg',  homeroomTeacherId:'', capacity:20, room:'KG Block 3', academicYearId:'ay2025' },
      /* ── PRIMARY SECTION (Grade 1–6, A/B streams) ── */
      { id:'cls1a',  schoolId:'sch1', grade:1,  name:'Grade 1A',  stream:'A', level:1,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:30, room:'Room P101', academicYearId:'ay2025' },
      { id:'cls1b',  schoolId:'sch1', grade:1,  name:'Grade 1B',  stream:'B', level:1,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:30, room:'Room P102', academicYearId:'ay2025' },
      { id:'cls2a',  schoolId:'sch1', grade:2,  name:'Grade 2A',  stream:'A', level:2,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:30, room:'Room P103', academicYearId:'ay2025' },
      { id:'cls2b',  schoolId:'sch1', grade:2,  name:'Grade 2B',  stream:'B', level:2,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:30, room:'Room P104', academicYearId:'ay2025' },
      { id:'cls3a',  schoolId:'sch1', grade:3,  name:'Grade 3A',  stream:'A', level:3,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:32, room:'Room P201', academicYearId:'ay2025' },
      { id:'cls3b',  schoolId:'sch1', grade:3,  name:'Grade 3B',  stream:'B', level:3,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:32, room:'Room P202', academicYearId:'ay2025' },
      { id:'cls4a',  schoolId:'sch1', grade:4,  name:'Grade 4A',  stream:'A', level:4,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:32, room:'Room P203', academicYearId:'ay2025' },
      { id:'cls4b',  schoolId:'sch1', grade:4,  name:'Grade 4B',  stream:'B', level:4,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:32, room:'Room P204', academicYearId:'ay2025' },
      { id:'cls5a',  schoolId:'sch1', grade:5,  name:'Grade 5A',  stream:'A', level:5,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:32, room:'Room P301', academicYearId:'ay2025' },
      { id:'cls5b',  schoolId:'sch1', grade:5,  name:'Grade 5B',  stream:'B', level:5,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:32, room:'Room P302', academicYearId:'ay2025' },
      { id:'cls6a',  schoolId:'sch1', grade:6,  name:'Grade 6A',  stream:'A', level:6,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:32, room:'Room P303', academicYearId:'ay2025' },
      { id:'cls6b',  schoolId:'sch1', grade:6,  name:'Grade 6B',  stream:'B', level:6,  sectionId:'sec_pri', homeroomTeacherId:'', capacity:32, room:'Room P304', academicYearId:'ay2025' },
      /* ── SECONDARY SECTION (Grade 7–13, existing + Grade 13) ── */
      { id:'cls7a',  schoolId:'sch1', grade:7,  name:'Grade 7A',  stream:'A', level:7,  sectionId:'sec_sec', homeroomTeacherId:'tch1', capacity:35, room:'Room 101', academicYearId:'ay2025' },
      { id:'cls7b',  schoolId:'sch1', grade:7,  name:'Grade 7B',  stream:'B', level:7,  sectionId:'sec_sec', homeroomTeacherId:'tch2', capacity:35, room:'Room 102', academicYearId:'ay2025' },
      { id:'cls8a',  schoolId:'sch1', grade:8,  name:'Grade 8A',  stream:'A', level:8,  sectionId:'sec_sec', homeroomTeacherId:'tch3', capacity:35, room:'Room 103', academicYearId:'ay2025' },
      { id:'cls8b',  schoolId:'sch1', grade:8,  name:'Grade 8B',  stream:'B', level:8,  sectionId:'sec_sec', homeroomTeacherId:'tch4', capacity:35, room:'Room 104', academicYearId:'ay2025' },
      { id:'cls9a',  schoolId:'sch1', grade:9,  name:'Grade 9A',  stream:'A', level:9,  sectionId:'sec_sec', homeroomTeacherId:'tch5', capacity:35, room:'Room 201', academicYearId:'ay2025' },
      { id:'cls9b',  schoolId:'sch1', grade:9,  name:'Grade 9B',  stream:'B', level:9,  sectionId:'sec_sec', homeroomTeacherId:'tch6', capacity:35, room:'Room 202', academicYearId:'ay2025' },
      { id:'cls10a', schoolId:'sch1', grade:10, name:'Grade 10A', stream:'A', level:10, sectionId:'sec_sec', homeroomTeacherId:'tch7', capacity:32, room:'Room 203', academicYearId:'ay2025' },
      { id:'cls10b', schoolId:'sch1', grade:10, name:'Grade 10B', stream:'B', level:10, sectionId:'sec_sec', homeroomTeacherId:'tch8', capacity:32, room:'Room 204', academicYearId:'ay2025' },
      { id:'cls11a', schoolId:'sch1', grade:11, name:'Grade 11A', stream:'A', level:11, sectionId:'sec_sec', homeroomTeacherId:'tch1', capacity:30, room:'Room 301', academicYearId:'ay2025' },
      { id:'cls11b', schoolId:'sch1', grade:11, name:'Grade 11B', stream:'B', level:11, sectionId:'sec_sec', homeroomTeacherId:'tch2', capacity:30, room:'Room 302', academicYearId:'ay2025' },
      { id:'cls12a', schoolId:'sch1', grade:12, name:'Grade 12A', stream:'A', level:12, sectionId:'sec_sec', homeroomTeacherId:'tch3', capacity:28, room:'Room 303', academicYearId:'ay2025' },
      { id:'cls12b', schoolId:'sch1', grade:12, name:'Grade 12B', stream:'B', level:12, sectionId:'sec_sec', homeroomTeacherId:'tch4', capacity:28, room:'Room 304', academicYearId:'ay2025' },
      { id:'cls13a', schoolId:'sch1', grade:13, name:'Grade 13A', stream:'A', level:13, sectionId:'sec_sec', homeroomTeacherId:'',    capacity:25, room:'Room 305', academicYearId:'ay2025' },
      { id:'cls13b', schoolId:'sch1', grade:13, name:'Grade 13B', stream:'B', level:13, sectionId:'sec_sec', homeroomTeacherId:'',    capacity:25, room:'Room 306', academicYearId:'ay2025' }
    ]);

    /* CLASS SUBJECTS — which subjects are taught in each class.
       These are the columns shown in the Subject Enrollment matrix.
       Core subjects appear in every class; electives vary by grade level. */
    const _csMap = {
      cls7a:  ['sbj1','sbj2','sbj3','sbj6','sbj7','sbj8','sbj9','sbj10','sbj11','sbj12','sbj15'],
      cls7b:  ['sbj1','sbj2','sbj3','sbj6','sbj7','sbj8','sbj9','sbj10','sbj11','sbj12','sbj15'],
      cls8a:  ['sbj1','sbj2','sbj3','sbj6','sbj7','sbj8','sbj9','sbj10','sbj11','sbj12','sbj15'],
      cls8b:  ['sbj1','sbj2','sbj3','sbj6','sbj7','sbj8','sbj9','sbj10','sbj11','sbj12','sbj15'],
      cls9a:  ['sbj1','sbj2','sbj3','sbj4','sbj6','sbj7','sbj8','sbj9','sbj12','sbj13','sbj14'],
      cls9b:  ['sbj1','sbj2','sbj3','sbj4','sbj6','sbj7','sbj8','sbj9','sbj12','sbj13','sbj14'],
      cls10a: ['sbj1','sbj2','sbj3','sbj4','sbj5','sbj6','sbj7','sbj8','sbj9','sbj12','sbj13','sbj14'],
      cls10b: ['sbj1','sbj2','sbj3','sbj4','sbj5','sbj6','sbj7','sbj8','sbj9','sbj12','sbj13','sbj14'],
      cls11a: ['sbj1','sbj2','sbj3','sbj4','sbj5','sbj6','sbj8','sbj9','sbj10','sbj11','sbj12','sbj13','sbj14'],
      cls11b: ['sbj1','sbj2','sbj3','sbj4','sbj5','sbj6','sbj8','sbj9','sbj10','sbj11','sbj12','sbj13','sbj14'],
      cls12a: ['sbj1','sbj2','sbj3','sbj4','sbj5','sbj6','sbj8','sbj9','sbj10','sbj12','sbj13','sbj14','sbj15'],
      cls12b: ['sbj1','sbj2','sbj3','sbj4','sbj5','sbj6','sbj8','sbj9','sbj10','sbj12','sbj13','sbj14','sbj15'],
    };
    const _csRows = [];
    Object.entries(_csMap).forEach(([classId, subjIds]) => {
      subjIds.forEach(subjectId => {
        _csRows.push({ id:`cs_${classId}_${subjectId}`, schoolId:'sch1', classId, subjectId, academicYearId:'ay2025' });
      });
    });
    set('class_subjects', _csRows);

    /* TEACHERS */
    set('teachers', [
      { id: 'tch1', schoolId: 'sch1', userId: 'u_tch1', staffId: 'MIS-TCH-001', firstName: 'Sarah', lastName: 'Smith', gender: 'Female', dateOfBirth: '1985-03-12', nationality: 'British', qualification: 'M.Ed English Literature', specialization: 'English Language & Literature', subjects: ['sbj1','sbj11'], homeroomClass: 'cls7a', joinDate: '2021-01-10', contractType: 'permanent', status: 'active', salary: 180000, workloadHours: 24, phone: '+254 722 100 001', email: 'sarah.smith@innolearn.edu.ke', address: 'Kilimani, Nairobi', emergencyContact: 'John Smith +44 7700 900 000', createdAt: '2021-01-10T00:00:00Z' },
      { id: 'tch2', schoolId: 'sch1', userId: 'u_tch2', staffId: 'MIS-TCH-002', firstName: 'James', lastName: 'Ochieng', gender: 'Male', dateOfBirth: '1980-05-01', nationality: 'Kenyan', qualification: 'B.Sc Mathematics, PGCE', specialization: 'Pure & Applied Mathematics', subjects: ['sbj2','sbj14'], homeroomClass: 'cls7b', joinDate: '2021-01-10', contractType: 'permanent', status: 'active', salary: 165000, workloadHours: 26, phone: '+254 722 100 002', email: 'james.ochieng@innolearn.edu.ke', address: 'South B, Nairobi', emergencyContact: 'Mary Ochieng +254 722 500 001', createdAt: '2021-01-10T00:00:00Z' },
      { id: 'tch3', schoolId: 'sch1', userId: 'u_tch3', staffId: 'MIS-TCH-003', firstName: 'Priya', lastName: 'Wanjiru', gender: 'Female', dateOfBirth: '1988-11-05', nationality: 'Indian-Kenyan', qualification: 'M.Sc Biology', specialization: 'Life Sciences & Environmental Studies', subjects: ['sbj3','sbj7'], homeroomClass: 'cls8a', joinDate: '2021-06-01', contractType: 'permanent', status: 'active', salary: 160000, workloadHours: 22, phone: '+254 722 100 003', email: 'priya.wanjiru@innolearn.edu.ke', address: 'Karen, Nairobi', emergencyContact: 'Raj Wanjiru +254 722 500 002', createdAt: '2021-06-01T00:00:00Z' },
      { id: 'tch4', schoolId: 'sch1', userId: 'u_tch4', staffId: 'MIS-TCH-004', firstName: 'Ahmed', lastName: 'Hassan', gender: 'Male', dateOfBirth: '1975-02-18', nationality: 'Somali-Kenyan', qualification: 'PhD Physics', specialization: 'Physics & Chemistry', subjects: ['sbj4','sbj5'], homeroomClass: 'cls8b', joinDate: '2020-08-01', contractType: 'permanent', status: 'active', salary: 210000, workloadHours: 20, phone: '+254 722 100 004', email: 'ahmed.hassan@innolearn.edu.ke', address: 'Eastleigh, Nairobi', emergencyContact: 'Halima Hassan +254 722 500 003', createdAt: '2020-08-01T00:00:00Z' },
      { id: 'tch5', schoolId: 'sch1', userId: 'u_tch5', staffId: 'MIS-TCH-005', firstName: 'Grace', lastName: 'Kamau', gender: 'Female', dateOfBirth: '1990-04-28', nationality: 'Kenyan', qualification: 'B.A History, PGCE', specialization: 'History & Social Studies', subjects: ['sbj6','sbj12'], homeroomClass: 'cls9a', joinDate: '2022-01-10', contractType: 'permanent', status: 'active', salary: 145000, workloadHours: 24, phone: '+254 722 100 005', email: 'grace.kamau@innolearn.edu.ke', address: 'Westlands, Nairobi', emergencyContact: 'Peter Kamau +254 722 500 004', createdAt: '2022-01-10T00:00:00Z' },
      { id: 'tch6', schoolId: 'sch1', userId: 'u_tch6', staffId: 'MIS-TCH-006', firstName: 'Raj', lastName: 'Patel', gender: 'Male', dateOfBirth: '1983-04-30', nationality: 'Indian', qualification: 'M.Sc Computer Science', specialization: 'Computer Science & ICT', subjects: ['sbj8'], homeroomClass: 'cls9b', joinDate: '2022-06-01', contractType: 'contract', status: 'active', salary: 175000, workloadHours: 20, phone: '+254 722 100 006', email: 'raj.patel@innolearn.edu.ke', address: 'Parklands, Nairobi', emergencyContact: 'Meena Patel +254 722 500 005', createdAt: '2022-06-01T00:00:00Z' },
      { id: 'tch7', schoolId: 'sch1', userId: 'u_tch7', staffId: 'MIS-TCH-007', firstName: 'Fatuma', lastName: 'Ngugi', gender: 'Female', dateOfBirth: '1992-06-08', nationality: 'Kenyan', qualification: 'B.A Business, CPA', specialization: 'Business Studies & Economics', subjects: ['sbj13','sbj14'], homeroomClass: 'cls10a', joinDate: '2023-01-10', contractType: 'permanent', status: 'active', salary: 140000, workloadHours: 22, phone: '+254 722 100 007', email: 'fatuma.ngugi@innolearn.edu.ke', address: 'Embakasi, Nairobi', emergencyContact: 'Hassan Ngugi +254 722 500 006', createdAt: '2023-01-10T00:00:00Z' },
      { id: 'tch8', schoolId: 'sch1', userId: 'u_tch8', staffId: 'MIS-TCH-008', firstName: 'Kevin', lastName: 'Otieno', gender: 'Male', dateOfBirth: '1987-12-20', nationality: 'Kenyan', qualification: 'B.Ed Physical Education', specialization: 'Physical Education & Sports', subjects: ['sbj9','sbj10'], homeroomClass: 'cls10b', joinDate: '2023-06-01', contractType: 'permanent', status: 'active', salary: 130000, workloadHours: 28, phone: '+254 722 100 008', email: 'kevin.otieno@innolearn.edu.ke', address: 'Langata, Nairobi', emergencyContact: 'Jane Otieno +254 722 500 007', createdAt: '2023-06-01T00:00:00Z' }
    ]);

    /* STUDENTS
       enrolledSubjectIds — individual subject enrollment per student.
       Core (always): sbj1=ENG, sbj2=MATH, sbj9=PE, sbj12=KSW
       Electives vary per student choice.                          */
    set('students', [
      /* Grade 10A */
      { id: 'stu1',  schoolId: 'sch1', userId: 'u_stu1', admissionNo: 'MIS-2022-001', firstName: 'Emily',   lastName: 'Johnson',  gender: 'Female', dateOfBirth: '2010-04-28', nationality: 'British',  bloodGroup: 'O+',  classId: 'cls10a', status: 'active', enrollmentDate: '2022-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj5','sbj8','sbj9','sbj12'], guardians: [{userId:'u_par1', name:'Mr. & Mrs. Johnson', relation:'Parents', phone:'+254 722 300 001', email:'parent1@innolearn.edu.ke', isPrimary:true}], medicalInfo: {conditions:'Mild asthma', allergies:'Pollen', medications:'Ventolin inhaler (as needed)', doctorName:'Dr. Otieno', doctorPhone:'+254 722 600 001', emergencyContact:'+254 722 300 001'}, createdAt:'2022-01-10T00:00:00Z' },
      { id: 'stu2',  schoolId: 'sch1', userId: 'u_stu2', admissionNo: 'MIS-2022-002', firstName: 'Brian',   lastName: 'Omondi',   gender: 'Male',   dateOfBirth: '2010-04-29', nationality: 'Kenyan',   bloodGroup: 'A+',  classId: 'cls10a', status: 'active', enrollmentDate: '2022-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj5','sbj8','sbj9','sbj12'], guardians: [{userId:'u_par2', name:'Mrs. Achieng Omondi', relation:'Mother', phone:'+254 722 300 002', email:'parent2@innolearn.edu.ke', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Njoroge', doctorPhone:'+254 722 600 002', emergencyContact:'+254 722 300 002'}, createdAt:'2022-01-10T00:00:00Z' },
      { id: 'stu3',  schoolId: 'sch1', admissionNo: 'MIS-2022-003', firstName: 'Chloe',   lastName: 'Kimani',   gender: 'Female', dateOfBirth: '2010-01-22', nationality: 'Kenyan',   bloodGroup: 'B+',  classId: 'cls10a', status: 'active', enrollmentDate: '2022-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj3','sbj6','sbj9','sbj12'], guardians: [{name:'Mr. Kimani', relation:'Father', phone:'+254 722 301 001', email:'kimani.f@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Omondi', doctorPhone:'+254 722 600 003', emergencyContact:'+254 722 301 001'}, createdAt:'2022-01-10T00:00:00Z' },
      { id: 'stu4',  schoolId: 'sch1', admissionNo: 'MIS-2022-004', firstName: 'Ethan',   lastName: 'Mwangi',   gender: 'Male',   dateOfBirth: '2010-09-11', nationality: 'Kenyan',   bloodGroup: 'AB+', classId: 'cls10a', status: 'active', enrollmentDate: '2022-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj4','sbj14','sbj9','sbj12'], guardians: [{name:'Mrs. Wanjiku Mwangi', relation:'Mother', phone:'+254 722 302 001', email:'parent4@innolearn.edu.ke', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'Nuts', medications:'EpiPen', doctorName:'Dr. Kamau', doctorPhone:'+254 722 600 004', emergencyContact:'+254 722 302 001'}, createdAt:'2022-01-10T00:00:00Z' },
      /* Grade 10B */
      { id: 'stu5',  schoolId: 'sch1', userId: 'u_stu3', admissionNo: 'MIS-2022-005', firstName: 'Anika',   lastName: 'Patel',    gender: 'Female', dateOfBirth: '2010-05-28', nationality: 'Indian',   bloodGroup: 'O-',  classId: 'cls10b', status: 'active', enrollmentDate: '2022-06-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj3','sbj4','sbj9','sbj12'], guardians: [{userId:'u_par3', name:'Dr. Suresh Patel', relation:'Father', phone:'+254 722 300 003', email:'parent3@innolearn.edu.ke', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Sharma', doctorPhone:'+254 722 600 005', emergencyContact:'+254 722 300 003'}, createdAt:'2022-06-10T00:00:00Z' },
      { id: 'stu6',  schoolId: 'sch1', admissionNo: 'MIS-2022-006', firstName: 'Omar',    lastName: 'Farah',    gender: 'Male',   dateOfBirth: '2010-11-03', nationality: 'Somali',   bloodGroup: 'A-',  classId: 'cls10b', status: 'active', enrollmentDate: '2022-06-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj5','sbj14','sbj9','sbj12'], guardians: [{name:'Mr. Ali Farah', relation:'Father', phone:'+254 722 303 001', email:'ali.farah@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Hassan', doctorPhone:'+254 722 600 006', emergencyContact:'+254 722 303 001'}, createdAt:'2022-06-10T00:00:00Z' },
      { id: 'stu7',  schoolId: 'sch1', admissionNo: 'MIS-2022-007', firstName: 'Sophie',  lastName: 'Ndegwa',   gender: 'Female', dateOfBirth: '2010-02-17', nationality: 'Kenyan',   bloodGroup: 'B-',  classId: 'cls10b', status: 'active', enrollmentDate: '2022-06-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj6','sbj10','sbj9','sbj12'], guardians: [{name:'Mrs. Ndegwa', relation:'Mother', phone:'+254 722 304 001', email:'ndegwa.m@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'Dairy', medications:'None', doctorName:'Dr. Wambua', doctorPhone:'+254 722 600 007', emergencyContact:'+254 722 304 001'}, createdAt:'2022-06-10T00:00:00Z' },
      /* Grade 9A */
      { id: 'stu8',  schoolId: 'sch1', admissionNo: 'MIS-2023-001', firstName: 'Liam',    lastName: 'Kariuki',  gender: 'Male',   dateOfBirth: '2011-04-09', nationality: 'Kenyan',   bloodGroup: 'O+',  classId: 'cls9a',  status: 'active', enrollmentDate: '2023-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj3','sbj6','sbj9','sbj12'], guardians: [{name:'Mr. John Kariuki', relation:'Father', phone:'+254 722 305 001', email:'john.kariuki@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Mwangi', doctorPhone:'+254 722 600 008', emergencyContact:'+254 722 305 001'}, createdAt:'2023-01-10T00:00:00Z' },
      { id: 'stu9',  schoolId: 'sch1', admissionNo: 'MIS-2023-002', firstName: 'Zara',    lastName: 'Ahmed',    gender: 'Female', dateOfBirth: '2011-08-21', nationality: 'Ethiopian', bloodGroup: 'A+', classId: 'cls9a',  status: 'active', enrollmentDate: '2023-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj4','sbj7','sbj9','sbj12'], guardians: [{name:'Dr. Amina Ahmed', relation:'Mother', phone:'+254 722 306 001', email:'amina.ahmed@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Tesfaye', doctorPhone:'+254 722 600 009', emergencyContact:'+254 722 306 001'}, createdAt:'2023-01-10T00:00:00Z' },
      { id: 'stu10', schoolId: 'sch1', admissionNo: 'MIS-2023-003', firstName: 'Kai',     lastName: 'Muturi',   gender: 'Male',   dateOfBirth: '2011-12-06', nationality: 'Kenyan',   bloodGroup: 'B+',  classId: 'cls9a',  status: 'active', enrollmentDate: '2023-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj8','sbj13','sbj9','sbj12'], guardians: [{name:'Mrs. Muturi', relation:'Mother', phone:'+254 722 307 001', email:'muturi.w@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Ouma', doctorPhone:'+254 722 600 010', emergencyContact:'+254 722 307 001'}, createdAt:'2023-01-10T00:00:00Z' },
      /* Grade 9B */
      { id: 'stu11', schoolId: 'sch1', admissionNo: 'MIS-2023-004', firstName: 'Mia',     lastName: 'Wafula',   gender: 'Female', dateOfBirth: '2011-06-14', nationality: 'Kenyan',   bloodGroup: 'O+',  classId: 'cls9b',  status: 'active', enrollmentDate: '2023-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj10','sbj15','sbj9','sbj12'], guardians: [{name:'Mr. Samuel Wafula', relation:'Father', phone:'+254 722 308 001', email:'sam.wafula@email.com', isPrimary:true}], medicalInfo: {conditions:'Eczema', allergies:'None', medications:'Hydrocortisone cream', doctorName:'Dr. Ngugi', doctorPhone:'+254 722 600 011', emergencyContact:'+254 722 308 001'}, createdAt:'2023-01-10T00:00:00Z' },
      { id: 'stu12', schoolId: 'sch1', userId: 'u_stu4', admissionNo: 'MIS-2023-005', firstName: 'Kevin',   lastName: 'Mwangi',   gender: 'Male',   dateOfBirth: '2011-10-30', nationality: 'Kenyan',   bloodGroup: 'AB+', classId: 'cls9b',  status: 'active', enrollmentDate: '2023-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj5','sbj8','sbj9','sbj12'], guardians: [{userId:'u_par4', name:'Ms. Wanjiku Mwangi', relation:'Mother', phone:'+254 722 300 004', email:'parent4@innolearn.edu.ke', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Muriu', doctorPhone:'+254 722 600 012', emergencyContact:'+254 722 300 004'}, createdAt:'2023-01-10T00:00:00Z' },
      /* Grade 8A */
      { id: 'stu13', schoolId: 'sch1', admissionNo: 'MIS-2024-001', firstName: 'Isla',    lastName: 'Njoroge',  gender: 'Female', dateOfBirth: '2012-02-28', nationality: 'Kenyan',   bloodGroup: 'A+',  classId: 'cls8a',  status: 'active', enrollmentDate: '2024-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj3','sbj11','sbj9','sbj12'], guardians: [{name:'Mr. Njoroge', relation:'Father', phone:'+254 722 309 001', email:'njoroge.g@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Gitau', doctorPhone:'+254 722 600 013', emergencyContact:'+254 722 309 001'}, createdAt:'2024-01-10T00:00:00Z' },
      { id: 'stu14', schoolId: 'sch1', admissionNo: 'MIS-2024-002', firstName: 'Daniel',  lastName: 'Abdi',     gender: 'Male',   dateOfBirth: '2012-05-12', nationality: 'Kenyan',   bloodGroup: 'B+',  classId: 'cls8a',  status: 'active', enrollmentDate: '2024-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj6','sbj7','sbj9','sbj12'], guardians: [{name:'Mr. Hassan Abdi', relation:'Father', phone:'+254 722 310 001', email:'hassan.abdi@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Mohamed', doctorPhone:'+254 722 600 014', emergencyContact:'+254 722 310 001'}, createdAt:'2024-01-10T00:00:00Z' },
      /* Grade 8B */
      { id: 'stu15', schoolId: 'sch1', admissionNo: 'MIS-2024-003', firstName: 'Layla',   lastName: 'Gitonga',  gender: 'Female', dateOfBirth: '2012-09-07', nationality: 'Kenyan',   bloodGroup: 'O+',  classId: 'cls8b',  status: 'active', enrollmentDate: '2024-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj10','sbj15','sbj9','sbj12'], guardians: [{name:'Mrs. Gitonga', relation:'Mother', phone:'+254 722 311 001', email:'gitonga.r@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Kamau', doctorPhone:'+254 722 600 015', emergencyContact:'+254 722 311 001'}, createdAt:'2024-01-10T00:00:00Z' },
      /* Grade 11A */
      { id: 'stu16', schoolId: 'sch1', admissionNo: 'MIS-2021-001', firstName: 'Noah',    lastName: 'Odhiambo', gender: 'Male',   dateOfBirth: '2009-01-18', nationality: 'Kenyan',   bloodGroup: 'A+',  classId: 'cls11a', status: 'active', enrollmentDate: '2021-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj4','sbj5','sbj8','sbj9','sbj12'], guardians: [{name:'Mr. Odhiambo', relation:'Father', phone:'+254 722 312 001', email:'odhiambo.j@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Otieno', doctorPhone:'+254 722 600 016', emergencyContact:'+254 722 312 001'}, createdAt:'2021-01-10T00:00:00Z' },
      { id: 'stu17', schoolId: 'sch1', admissionNo: 'MIS-2021-002', firstName: 'Amara',   lastName: 'Diallo',   gender: 'Female', dateOfBirth: '2009-04-25', nationality: 'Guinean',  bloodGroup: 'B+',  classId: 'cls11a', status: 'active', enrollmentDate: '2021-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj3','sbj6','sbj11','sbj9','sbj12'], guardians: [{name:'Mr. Mamadou Diallo', relation:'Father', phone:'+254 722 313 001', email:'diallo.m@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'Shellfish', medications:'None', doctorName:'Dr. Kone', doctorPhone:'+254 722 600 017', emergencyContact:'+254 722 313 001'}, createdAt:'2021-01-10T00:00:00Z' },
      /* Grade 12A */
      { id: 'stu18', schoolId: 'sch1', admissionNo: 'MIS-2020-001', firstName: 'Lucas',   lastName: 'Kiprotich',gender: 'Male',   dateOfBirth: '2008-07-30', nationality: 'Kenyan',   bloodGroup: 'O+',  classId: 'cls12a', status: 'active', enrollmentDate: '2020-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj4','sbj5','sbj8','sbj9','sbj12'], guardians: [{name:'Mr. Kiprotich', relation:'Father', phone:'+254 722 314 001', email:'kiprotich.p@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Kosgey', doctorPhone:'+254 722 600 018', emergencyContact:'+254 722 314 001'}, createdAt:'2020-01-10T00:00:00Z' },
      { id: 'stu19', schoolId: 'sch1', admissionNo: 'MIS-2020-002', firstName: 'Sofia',   lastName: 'Mensah',   gender: 'Female', dateOfBirth: '2008-11-14', nationality: 'Ghanaian', bloodGroup: 'A+',  classId: 'cls12a', status: 'active', enrollmentDate: '2020-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj3','sbj13','sbj14','sbj9','sbj12'], guardians: [{name:'Dr. Kwame Mensah', relation:'Father', phone:'+254 722 315 001', email:'mensah.k@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Asante', doctorPhone:'+254 722 600 019', emergencyContact:'+254 722 315 001'}, createdAt:'2020-01-10T00:00:00Z' },
      { id: 'stu20', schoolId: 'sch1', admissionNo: 'MIS-2020-003', firstName: 'Jamal',   lastName: 'Nyamweya', gender: 'Male',   dateOfBirth: '2008-03-05', nationality: 'Kenyan',   bloodGroup: 'AB-', classId: 'cls12b', status: 'active', enrollmentDate: '2020-01-10', photo: null, enrolledSubjectIds: ['sbj1','sbj2','sbj8','sbj13','sbj14','sbj9','sbj12'], guardians: [{name:'Mrs. Nyamweya', relation:'Mother', phone:'+254 722 316 001', email:'nyamweya.g@email.com', isPrimary:true}], medicalInfo: {conditions:'None', allergies:'None', medications:'None', doctorName:'Dr. Bosire', doctorPhone:'+254 722 600 020', emergencyContact:'+254 722 316 001'}, createdAt:'2020-01-10T00:00:00Z' }
    ]);

    /* TIMETABLE */
    const PERIODS = [
      {period:1, start:'07:30', end:'08:30'},
      {period:2, start:'08:30', end:'09:30'},
      {period:3, start:'09:30', end:'10:30'},
      {period:4, start:'11:00', end:'12:00'},
      {period:5, start:'12:00', end:'13:00'},
      {period:6, start:'14:00', end:'15:00'},
      {period:7, start:'15:00', end:'16:00'}
    ];
    /* Period time map for seed data (mirrors timetable.js PERIODS) */
    const _PT = {
      1:{start:'07:30',end:'08:30'}, 2:{start:'08:30',end:'09:30'},
      3:{start:'09:30',end:'10:30'}, 4:{start:'11:00',end:'12:00'},
      5:{start:'12:00',end:'13:00'}, 6:{start:'14:00',end:'15:00'},
      7:{start:'15:00',end:'16:00'}
    };
    function _slot(day,period,subjectId,teacherId,room){
      return {day,period,subjectId,teacherId,room,start:_PT[period].start,end:_PT[period].end};
    }

    set('timetable', [
      { id:'tt_10a', schoolId:'sch1', classId:'cls10a', academicYearId:'ay2025', termId:'term2',
        slots:[
          _slot(0,1,'sbj1','tch1','Room 203'), _slot(0,2,'sbj2','tch2','Room 203'),
          _slot(0,3,'sbj5','tch4','Physics Lab'), _slot(0,4,'sbj8','tch6','ICT Lab 1'),
          _slot(0,5,'sbj9','tch8','PE Hall / Field'),
          _slot(1,1,'sbj2','tch2','Room 203'), _slot(1,2,'sbj3','tch3','Science Lab 1'),
          _slot(1,3,'sbj1','tch1','Room 203'), _slot(1,4,'sbj6','tch5','Room 203'),
          _slot(1,5,'sbj14','tch7','Room 203'),
          _slot(2,1,'sbj4','tch4','Chemistry Lab'), _slot(2,2,'sbj2','tch2','Room 203'),
          _slot(2,3,'sbj7','tch3','Room 203'), _slot(2,4,'sbj1','tch1','Room 203'),
          _slot(2,5,'sbj8','tch6','ICT Lab 1'),
          _slot(3,1,'sbj5','tch4','Physics Lab'), _slot(3,2,'sbj14','tch7','Room 203'),
          _slot(3,3,'sbj2','tch2','Room 203'), _slot(3,4,'sbj3','tch3','Science Lab 1'),
          _slot(3,5,'sbj6','tch5','Room 203'),
          _slot(4,1,'sbj1','tch1','Room 203'), _slot(4,2,'sbj4','tch4','Chemistry Lab'),
          _slot(4,3,'sbj2','tch2','Room 203'), _slot(4,4,'sbj9','tch8','PE Hall / Field'),
          _slot(4,5,'sbj7','tch3','Room 203')
        ]
      },
      /* Grade 9A timetable */
      { id:'tt_9a', schoolId:'sch1', classId:'cls9a', academicYearId:'ay2025', termId:'term2',
        slots:[
          _slot(0,1,'sbj1','tch1','Room 105'), _slot(0,2,'sbj2','tch2','Room 105'),
          _slot(0,3,'sbj3','tch3','Science Lab 2'), _slot(0,4,'sbj8','tch6','ICT Lab 1'),
          _slot(0,5,'sbj9','tch8','PE Hall / Field'),
          _slot(1,1,'sbj6','tch5','Room 105'), _slot(1,2,'sbj2','tch2','Room 105'),
          _slot(1,3,'sbj1','tch1','Room 105'), _slot(1,4,'sbj4','tch4','Chemistry Lab'),
          _slot(1,5,'sbj12','tch5','Room 105'),
          _slot(2,1,'sbj3','tch3','Science Lab 2'), _slot(2,2,'sbj8','tch6','ICT Lab 1'),
          _slot(2,3,'sbj2','tch2','Room 105'), _slot(2,4,'sbj1','tch1','Room 105'),
          _slot(2,5,'sbj6','tch5','Room 105'),
          _slot(3,1,'sbj4','tch4','Chemistry Lab'), _slot(3,2,'sbj1','tch1','Room 105'),
          _slot(3,3,'sbj3','tch3','Science Lab 2'), _slot(3,4,'sbj2','tch2','Room 105'),
          _slot(3,5,'sbj9','tch8','PE Hall / Field'),
          _slot(4,1,'sbj2','tch2','Room 105'), _slot(4,2,'sbj12','tch5','Room 105'),
          _slot(4,3,'sbj4','tch4','Chemistry Lab'), _slot(4,4,'sbj1','tch1','Room 105'),
          _slot(4,5,'sbj8','tch6','ICT Lab 1')
        ]
      },
      /* Grade 11A timetable */
      { id:'tt_11a', schoolId:'sch1', classId:'cls11a', academicYearId:'ay2025', termId:'term2',
        slots:[
          _slot(0,1,'sbj1','tch1','Room 301'), _slot(0,2,'sbj2','tch2','Room 301'),
          _slot(0,3,'sbj4','tch4','Chemistry Lab'), _slot(0,4,'sbj13','tch7','Room 301'),
          _slot(0,5,'sbj9','tch8','PE Hall / Field'),
          _slot(1,1,'sbj2','tch2','Room 301'), _slot(1,2,'sbj1','tch1','Room 301'),
          _slot(1,3,'sbj5','tch4','Physics Lab'), _slot(1,4,'sbj14','tch2','Room 301'),
          _slot(1,5,'sbj8','tch6','ICT Lab 1'),
          _slot(2,1,'sbj4','tch4','Chemistry Lab'), _slot(2,2,'sbj13','tch7','Room 301'),
          _slot(2,3,'sbj1','tch1','Room 301'), _slot(2,4,'sbj2','tch2','Room 301'),
          _slot(2,5,'sbj12','tch5','Room 301'),
          _slot(3,1,'sbj5','tch4','Physics Lab'), _slot(3,2,'sbj2','tch2','Room 301'),
          _slot(3,3,'sbj14','tch2','Room 301'), _slot(3,4,'sbj1','tch1','Room 301'),
          _slot(3,5,'sbj9','tch8','PE Hall / Field'),
          _slot(4,1,'sbj1','tch1','Room 301'), _slot(4,2,'sbj4','tch4','Chemistry Lab'),
          _slot(4,3,'sbj2','tch2','Room 301'), _slot(4,4,'sbj13','tch7','Room 301'),
          _slot(4,5,'sbj8','tch6','ICT Lab 1')
        ]
      }
    ]);

    /* ATTENDANCE — Grade 10A, Grade 9A, Grade 11A */
    const attendanceDays = ['2025-04-14','2025-04-15','2025-04-16','2025-04-17','2025-04-22','2025-04-23'];
    const stu10a = ['stu1','stu2','stu3','stu4'];
    const stu9a  = ['stu8','stu9','stu10'];
    const stu11a = ['stu16','stu17'];
    const attRecords = [];
    attendanceDays.forEach((date, di) => {
      /* 10A */
      const records10a = stu10a.map(sid => ({
        studentId: sid,
        status: (sid==='stu1'&&di===2)?'absent':(sid==='stu3'&&di===4)?'late':'present',
        note: (sid==='stu1'&&di===2)?'Sick leave':'',
        markedAt:`${date}T08:05:00Z`, markedBy:'tch1'
      }));
      attRecords.push({ id:`att_10a_${di}`, schoolId:'sch1', classId:'cls10a', date, termId:'term2', academicYearId:'ay2025', records:records10a, markedAt:`${date}T08:05:00Z`, markedBy:'tch7' });
      /* 9A */
      const records9a = stu9a.map(sid => ({
        studentId: sid,
        status: (sid==='stu10'&&di===1)?'absent':(sid==='stu8'&&di===3)?'late':'present',
        note: '',
        markedAt:`${date}T08:10:00Z`, markedBy:'tch5'
      }));
      attRecords.push({ id:`att_9a_${di}`, schoolId:'sch1', classId:'cls9a', date, termId:'term2', academicYearId:'ay2025', records:records9a, markedAt:`${date}T08:10:00Z`, markedBy:'tch5' });
      /* 11A */
      const records11a = stu11a.map(sid => ({
        studentId: sid,
        status: (sid==='stu17'&&di===5)?'absent':'present',
        note: '',
        markedAt:`${date}T08:00:00Z`, markedBy:'tch1'
      }));
      attRecords.push({ id:`att_11a_${di}`, schoolId:'sch1', classId:'cls11a', date, termId:'term2', academicYearId:'ay2025', records:records11a, markedAt:`${date}T08:00:00Z`, markedBy:'tch1' });
    });
    set('attendance', attRecords);

    /* GRADES / ASSESSMENTS */
    set('grades', [
      /* Emily Johnson (stu1) — Grade 10A */
      { id:'gr1',  schoolId:'sch1', studentId:'stu1', subjectId:'sbj1', classId:'cls10a', termId:'term1', teacherId:'tch1', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:82, grade:'B+', percentage:82, comments:'Good work, improve essay structure', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr2',  schoolId:'sch1', studentId:'stu1', subjectId:'sbj2', classId:'cls10a', termId:'term1', teacherId:'tch2', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:91, grade:'A',  percentage:91, comments:'Excellent! Strong analytical skills', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr3',  schoolId:'sch1', studentId:'stu1', subjectId:'sbj5', classId:'cls10a', termId:'term1', teacherId:'tch4', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:78, grade:'B',  percentage:78, comments:'Review circuits chapter', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr4',  schoolId:'sch1', studentId:'stu1', subjectId:'sbj8', classId:'cls10a', termId:'term1', teacherId:'tch6', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:88, grade:'B+', percentage:88, comments:'Excellent programming project', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr5',  schoolId:'sch1', studentId:'stu1', subjectId:'sbj1', classId:'cls10a', termId:'term2', teacherId:'tch1', type:'test',     name:'Mid-Term Test',  maxScore:50,  score:43, grade:'A',  percentage:86, comments:'Impressive improvement', date:'2025-06-05', createdAt:'2025-06-05T00:00:00Z' },
      { id:'gr6',  schoolId:'sch1', studentId:'stu1', subjectId:'sbj2', classId:'cls10a', termId:'term2', teacherId:'tch2', type:'test',     name:'Mid-Term Test',  maxScore:50,  score:47, grade:'A+', percentage:94, comments:'Outstanding performance', date:'2025-06-05', createdAt:'2025-06-05T00:00:00Z' },
      /* Brian Omondi (stu2) */
      { id:'gr7',  schoolId:'sch1', studentId:'stu2', subjectId:'sbj1', classId:'cls10a', termId:'term1', teacherId:'tch1', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:74, grade:'B',  percentage:74, comments:'Good improvement over last term', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr8',  schoolId:'sch1', studentId:'stu2', subjectId:'sbj2', classId:'cls10a', termId:'term1', teacherId:'tch2', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:69, grade:'C+', percentage:69, comments:'More practice needed on algebra', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr9',  schoolId:'sch1', studentId:'stu2', subjectId:'sbj5', classId:'cls10a', termId:'term1', teacherId:'tch4', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:85, grade:'B+', percentage:85, comments:'Strong physics understanding', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr10', schoolId:'sch1', studentId:'stu2', subjectId:'sbj8', classId:'cls10a', termId:'term1', teacherId:'tch6', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:92, grade:'A',  percentage:92, comments:'Top performer in CS', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      /* Chloe Kimani (stu3) */
      { id:'gr11', schoolId:'sch1', studentId:'stu3', subjectId:'sbj1', classId:'cls10a', termId:'term1', teacherId:'tch1', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:95, grade:'A+', percentage:95, comments:'Exceptional writing skills', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr12', schoolId:'sch1', studentId:'stu3', subjectId:'sbj2', classId:'cls10a', termId:'term1', teacherId:'tch2', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:88, grade:'B+', percentage:88, comments:'Very good performance', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      /* Ethan Mwangi (stu4) */
      { id:'gr13', schoolId:'sch1', studentId:'stu4', subjectId:'sbj1', classId:'cls10a', termId:'term1', teacherId:'tch1', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:71, grade:'B',  percentage:71, comments:'Keep up the hard work', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr14', schoolId:'sch1', studentId:'stu4', subjectId:'sbj2', classId:'cls10a', termId:'term1', teacherId:'tch2', type:'exam',     name:'Term 1 Exam',    maxScore:100, score:83, grade:'B+', percentage:83, comments:'Good logical thinking', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      /* Homework/project entries */
      { id:'gr15', schoolId:'sch1', studentId:'stu1', subjectId:'sbj2', classId:'cls10a', termId:'term2', teacherId:'tch2', type:'homework', name:'Calculus Set 3',  maxScore:20,  score:18, grade:'A',  percentage:90, comments:'Well done', date:'2025-05-10', createdAt:'2025-05-10T00:00:00Z' },
      { id:'gr16', schoolId:'sch1', studentId:'stu2', subjectId:'sbj8', classId:'cls10a', termId:'term2', teacherId:'tch6', type:'project',  name:'Web App Project', maxScore:100, score:96, grade:'A+', percentage:96, comments:'Excellent app design', date:'2025-05-20', createdAt:'2025-05-20T00:00:00Z' },
      /* Grade 9A — Liam Kariuki (stu8) */
      { id:'gr20', schoolId:'sch1', studentId:'stu8', subjectId:'sbj1', classId:'cls9a', termId:'term1', teacherId:'tch1', type:'exam', name:'Term 1 Exam', maxScore:100, score:77, grade:'B', percentage:77, comments:'Good writing, work on vocabulary', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr21', schoolId:'sch1', studentId:'stu8', subjectId:'sbj2', classId:'cls9a', termId:'term1', teacherId:'tch2', type:'exam', name:'Term 1 Exam', maxScore:100, score:84, grade:'B+', percentage:84, comments:'Strong algebra skills', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr22', schoolId:'sch1', studentId:'stu8', subjectId:'sbj3', classId:'cls9a', termId:'term1', teacherId:'tch3', type:'exam', name:'Term 1 Exam', maxScore:100, score:71, grade:'B', percentage:71, comments:'Solid understanding of ecosystems', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      /* Grade 9A — Zara Ahmed (stu9) */
      { id:'gr23', schoolId:'sch1', studentId:'stu9', subjectId:'sbj1', classId:'cls9a', termId:'term1', teacherId:'tch1', type:'exam', name:'Term 1 Exam', maxScore:100, score:93, grade:'A', percentage:93, comments:'Outstanding essay writing', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr24', schoolId:'sch1', studentId:'stu9', subjectId:'sbj2', classId:'cls9a', termId:'term1', teacherId:'tch2', type:'exam', name:'Term 1 Exam', maxScore:100, score:79, grade:'B', percentage:79, comments:'Good, focus more on geometry proofs', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr25', schoolId:'sch1', studentId:'stu9', subjectId:'sbj4', classId:'cls9a', termId:'term1', teacherId:'tch4', type:'exam', name:'Term 1 Exam', maxScore:100, score:88, grade:'B+', percentage:88, comments:'Excellent lab work', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      /* Grade 9A — Kai Muturi (stu10) */
      { id:'gr26', schoolId:'sch1', studentId:'stu10', subjectId:'sbj1', classId:'cls9a', termId:'term1', teacherId:'tch1', type:'exam', name:'Term 1 Exam', maxScore:100, score:65, grade:'C+', percentage:65, comments:'Needs more practice with comprehension', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr27', schoolId:'sch1', studentId:'stu10', subjectId:'sbj2', classId:'cls9a', termId:'term1', teacherId:'tch2', type:'exam', name:'Term 1 Exam', maxScore:100, score:90, grade:'A', percentage:90, comments:'Excellent in all topics', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr28', schoolId:'sch1', studentId:'stu10', subjectId:'sbj8', classId:'cls9a', termId:'term1', teacherId:'tch6', type:'exam', name:'Term 1 Exam', maxScore:100, score:97, grade:'A+', percentage:97, comments:'Top of class in CS', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      /* Grade 11A — Noah Odhiambo (stu16) */
      { id:'gr30', schoolId:'sch1', studentId:'stu16', subjectId:'sbj1', classId:'cls11a', termId:'term1', teacherId:'tch1', type:'exam', name:'Term 1 Exam', maxScore:100, score:80, grade:'B+', percentage:80, comments:'Mature analytical writing', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr31', schoolId:'sch1', studentId:'stu16', subjectId:'sbj2', classId:'cls11a', termId:'term1', teacherId:'tch2', type:'exam', name:'Term 1 Exam', maxScore:100, score:75, grade:'B', percentage:75, comments:'Good, needs to review calculus', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr32', schoolId:'sch1', studentId:'stu16', subjectId:'sbj4', classId:'cls11a', termId:'term1', teacherId:'tch4', type:'exam', name:'Term 1 Exam', maxScore:100, score:89, grade:'B+', percentage:89, comments:'Very strong in Chemistry', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr33', schoolId:'sch1', studentId:'stu16', subjectId:'sbj5', classId:'cls11a', termId:'term1', teacherId:'tch4', type:'exam', name:'Term 1 Exam', maxScore:100, score:83, grade:'B+', percentage:83, comments:'Good understanding of mechanics', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      /* Grade 11A — Amara Diallo (stu17) */
      { id:'gr34', schoolId:'sch1', studentId:'stu17', subjectId:'sbj1', classId:'cls11a', termId:'term1', teacherId:'tch1', type:'exam', name:'Term 1 Exam', maxScore:100, score:96, grade:'A+', percentage:96, comments:'Exceptional! Scholarship material', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr35', schoolId:'sch1', studentId:'stu17', subjectId:'sbj2', classId:'cls11a', termId:'term1', teacherId:'tch2', type:'exam', name:'Term 1 Exam', maxScore:100, score:68, grade:'C+', percentage:68, comments:'Needs additional support in differentiation', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      { id:'gr36', schoolId:'sch1', studentId:'stu17', subjectId:'sbj3', classId:'cls11a', termId:'term1', teacherId:'tch3', type:'exam', name:'Term 1 Exam', maxScore:100, score:91, grade:'A', percentage:91, comments:'Outstanding environmental awareness', date:'2025-03-25', createdAt:'2025-03-25T00:00:00Z' },
      /* Mid-term tests Term 2 */
      { id:'gr40', schoolId:'sch1', studentId:'stu8',  subjectId:'sbj1', classId:'cls9a',  termId:'term2', teacherId:'tch1', type:'test', name:'Mid-Term Test', maxScore:50, score:39, grade:'B+', percentage:78, comments:'Good improvement', date:'2025-06-05', createdAt:'2025-06-05T00:00:00Z' },
      { id:'gr41', schoolId:'sch1', studentId:'stu16', subjectId:'sbj1', classId:'cls11a', termId:'term2', teacherId:'tch1', type:'test', name:'Mid-Term Test', maxScore:50, score:42, grade:'A',  percentage:84, comments:'Consistent performance', date:'2025-06-05', createdAt:'2025-06-05T00:00:00Z' }
    ]);

    /* FEE STRUCTURES */
    set('feeStructures', [{
      id: 'fs1', schoolId: 'sch1', name: 'Secondary School Fees – Term 2 2025',
      academicYearId: 'ay2025', termId: 'term2',
      classIds: ['cls7a','cls7b','cls8a','cls8b','cls9a','cls9b','cls10a','cls10b','cls11a','cls11b','cls12a','cls12b'],
      items: [
        { id:'fi1', name:'Tuition Fee',        amount: 85000, isOptional: false, category:'tuition' },
        { id:'fi2', name:'Activity Fee',       amount: 5000,  isOptional: false, category:'activity' },
        { id:'fi3', name:'Technology Levy',    amount: 3000,  isOptional: false, category:'technology' },
        { id:'fi4', name:'Sports Fee',         amount: 2000,  isOptional: false, category:'sports' },
        { id:'fi5', name:'Transport (Term)',   amount: 15000, isOptional: true,  category:'transport' },
        { id:'fi6', name:'Boarding (Term)',    amount: 45000, isOptional: true,  category:'boarding' }
      ],
      dueDate: '2025-05-15', currency: 'KES', createdAt: '2025-04-10T00:00:00Z'
    }]);

    /* INVOICES */
    set('invoices', [
      { id:'inv1', schoolId:'sch1', studentId:'stu1', invoiceNo:'MIS-INV-2025-001', feeStructureId:'fs1', termId:'term2', academicYearId:'ay2025', totalAmount:95000, paidAmount:95000, balance:0, status:'paid', dueDate:'2025-05-15', items:[{name:'Tuition Fee',amount:85000},{name:'Activity Fee',amount:5000},{name:'Technology Levy',amount:3000},{name:'Sports Fee',amount:2000}], payments:[{id:'pay1', amount:95000, date:'2025-05-10', method:'bank_transfer', reference:'MPESA-ABC123', recordedBy:'u_fin1'}], createdAt:'2025-04-10T00:00:00Z' },
      { id:'inv2', schoolId:'sch1', studentId:'stu2', invoiceNo:'MIS-INV-2025-002', feeStructureId:'fs1', termId:'term2', academicYearId:'ay2025', totalAmount:95000, paidAmount:50000, balance:45000, status:'partial', dueDate:'2025-05-15', items:[{name:'Tuition Fee',amount:85000},{name:'Activity Fee',amount:5000},{name:'Technology Levy',amount:3000},{name:'Sports Fee',amount:2000}], payments:[{id:'pay2', amount:50000, date:'2025-05-08', method:'mpesa', reference:'MPESA-DEF456', recordedBy:'u_fin1'}], createdAt:'2025-04-10T00:00:00Z' },
      { id:'inv3', schoolId:'sch1', studentId:'stu3', invoiceNo:'MIS-INV-2025-003', feeStructureId:'fs1', termId:'term2', academicYearId:'ay2025', totalAmount:110000, paidAmount:110000, balance:0, status:'paid', dueDate:'2025-05-15', items:[{name:'Tuition Fee',amount:85000},{name:'Activity Fee',amount:5000},{name:'Technology Levy',amount:3000},{name:'Sports Fee',amount:2000},{name:'Transport (Term)',amount:15000}], payments:[{id:'pay3', amount:110000, date:'2025-04-28', method:'bank_transfer', reference:'RTG-GHI789', recordedBy:'u_fin1'}], createdAt:'2025-04-10T00:00:00Z' },
      { id:'inv4', schoolId:'sch1', studentId:'stu4', invoiceNo:'MIS-INV-2025-004', feeStructureId:'fs1', termId:'term2', academicYearId:'ay2025', totalAmount:95000, paidAmount:0,     balance:95000, status:'overdue', dueDate:'2025-05-15', items:[{name:'Tuition Fee',amount:85000},{name:'Activity Fee',amount:5000},{name:'Technology Levy',amount:3000},{name:'Sports Fee',amount:2000}], payments:[], createdAt:'2025-04-10T00:00:00Z' },
      { id:'inv5', schoolId:'sch1', studentId:'stu5', invoiceNo:'MIS-INV-2025-005', feeStructureId:'fs1', termId:'term2', academicYearId:'ay2025', totalAmount:95000, paidAmount:95000, balance:0, status:'paid', dueDate:'2025-05-15', items:[{name:'Tuition Fee',amount:85000},{name:'Activity Fee',amount:5000},{name:'Technology Levy',amount:3000},{name:'Sports Fee',amount:2000}], payments:[{id:'pay5', amount:95000, date:'2025-05-01', method:'cheque', reference:'CHQ-001234', recordedBy:'u_fin1'}], createdAt:'2025-04-10T00:00:00Z' }
    ]);

    /* MESSAGES / ANNOUNCEMENTS */
    set('messages', [
      { id:'msg1', schoolId:'sch1', senderId:'u_admin1', senderName:'Dr. Elizabeth Mwangi', recipients:['all'], subject:'Term 2 Academic Calendar Update', body:'Dear Community,\n\nPlease note the following important dates for Term 2 2025:\n\n• Mid-Term Break: June 13–20, 2025\n• Term 2 Exams: July 7–18, 2025\n• End of Term: July 25, 2025\n• Prize Giving Day: July 23, 2025\n\nWe wish all students the very best in their studies.\n\nDr. Elizabeth Mwangi\nPrincipal, InnoLearn International School', type:'announcement', isRead:{}, createdAt:'2025-04-28T09:00:00Z' },
      { id:'msg2', schoolId:'sch1', senderId:'u_tch1', senderName:'Ms. Sarah Smith', recipients:['u_par1','u_par2','u_par3','u_par4'], subject:'Grade 10A – English Assignment Due', body:'Dear Parents,\n\nThis is a reminder that the English Literature essay on "To Kill a Mockingbird" is due on Friday, 25 April 2025. Students should submit 1,500–2,000 words covering the theme of justice.\n\nPlease encourage your child to finalize their work.\n\nBest regards,\nMs. Sarah Smith\nEnglish Teacher', type:'direct', isRead:{}, createdAt:'2025-04-21T10:30:00Z' },
      { id:'msg3', schoolId:'sch1', senderId:'u_admin1', senderName:'Dr. Elizabeth Mwangi', recipients:['teachers'], subject:'Staff Meeting – Wednesday 30 April', body:'Dear Staff,\n\nThere will be a compulsory staff meeting on Wednesday, 30 April 2025 at 3:30 PM in the Conference Room.\n\nAgenda:\n1. Term 2 progress review\n2. Academic Calendar updates\n3. Parent-Teacher Conference planning\n4. AOB\n\nAttendance is mandatory. Please confirm receipt.\n\nDr. Mwangi', type:'announcement', isRead:{}, createdAt:'2025-04-23T08:00:00Z' },
      { id:'msg4', schoolId:'sch1', senderId:'u_par1', senderName:'Mr. & Mrs. Johnson', recipients:['u_tch1'], subject:'Re: Emily\'s attendance on 16 April', body:'Dear Ms. Smith,\n\nThank you for notifying us about Emily\'s absence on April 16. She had a severe asthma episode that required a doctor\'s visit. Please find the medical note attached.\n\nShe is now fully recovered and back in school.\n\nKind regards,\nMr. & Mrs. Johnson', type:'direct', isRead:{'u_tch1': true}, createdAt:'2025-04-17T15:00:00Z' },
      { id:'msg5', schoolId:'sch1', senderId:'u_admin1', senderName:'Dr. Elizabeth Mwangi', recipients:['parents'], subject:'Parent-Teacher Conference – Saturday 10 May', body:'Dear Parents,\n\nWe are pleased to invite you to our Term 2 Parent-Teacher Conference on Saturday, 10 May 2025 from 8:00 AM – 1:00 PM.\n\nAppointment booking will open on Monday, 28 April via the school portal.\n\nWe look forward to seeing you.\n\nDr. Elizabeth Mwangi\nPrincipal', type:'announcement', isRead:{}, createdAt:'2025-04-22T12:00:00Z' }
    ]);

    /* EVENTS */
    set('events', [
      { id:'ev1',  schoolId:'sch1', title:'Term 2 Begins',                  type:'academic',  startDate:'2026-04-28', endDate:'2026-04-28', allDay:true,  location:'School',          targetAudience:['all'],     description:'First day of Term 2 2025-2026.', createdBy:'u_admin1', createdAt:'2026-03-01T00:00:00Z' },
      { id:'ev2',  schoolId:'sch1', title:'Staff Meeting',                   type:'meeting',   startDate:'2026-04-30', endDate:'2026-04-30', allDay:false, startTime:'15:30', endTime:'17:00', location:'Conference Room',  targetAudience:['teachers'],description:'Compulsory staff meeting. Agenda: Term 2 review.', createdBy:'u_admin1', createdAt:'2026-04-23T00:00:00Z' },
      { id:'ev3',  schoolId:'sch1', title:'Parent-Teacher Conference',        type:'meeting',   startDate:'2026-05-10', endDate:'2026-05-10', allDay:false, startTime:'08:00', endTime:'13:00', location:'School Hall',     targetAudience:['parents','teachers'], description:'Term 2 Parent-Teacher Conference. Book appointments via portal.', createdBy:'u_admin1', createdAt:'2026-04-22T00:00:00Z' },
      { id:'ev4',  schoolId:'sch1', title:'Fee Deadline – Term 2',            type:'finance',   startDate:'2026-05-15', endDate:'2026-05-15', allDay:true,  location:'Finance Office',  targetAudience:['parents'], description:'Term 2 fee payment deadline.', createdBy:'u_fin1',   createdAt:'2026-04-10T00:00:00Z' },
      { id:'ev5',  schoolId:'sch1', title:'Inter-School Sports Day',          type:'activity',  startDate:'2026-05-24', endDate:'2026-05-24', allDay:true,  location:'School Grounds',  targetAudience:['all'],     description:'Annual inter-school athletics and team sports competition.', createdBy:'u_tch8', createdAt:'2026-04-15T00:00:00Z' },
      { id:'ev6',  schoolId:'sch1', title:'Mid-Term Break',                   type:'holiday',   startDate:'2026-06-13', endDate:'2026-06-20', allDay:true,  location:'',                targetAudience:['all'],     description:'Mid-Term holiday break.', createdBy:'u_admin1', createdAt:'2026-03-01T00:00:00Z' },
      { id:'ev7',  schoolId:'sch1', title:'Term 2 Examinations',              type:'exam',      startDate:'2026-07-07', endDate:'2026-07-18', allDay:true,  location:'Exam Halls',      targetAudience:['all'],     description:'Term 2 end-of-term examinations for all grades.', createdBy:'u_admin1', createdAt:'2026-04-01T00:00:00Z' },
      { id:'ev8',  schoolId:'sch1', title:'Prize Giving Day',                 type:'activity',  startDate:'2026-07-23', endDate:'2026-07-23', allDay:false, startTime:'10:00', endTime:'13:00', location:'School Auditorium', targetAudience:['all'], description:'Annual Prize Giving ceremony. All parents warmly invited.', createdBy:'u_admin1', createdAt:'2026-04-01T00:00:00Z' },
      { id:'ev9',  schoolId:'sch1', title:'End of Term 2',                    type:'academic',  startDate:'2026-07-25', endDate:'2026-07-25', allDay:true,  location:'School',          targetAudience:['all'],     description:'Last day of Term 2.', createdBy:'u_admin1', createdAt:'2026-03-01T00:00:00Z' },
      { id:'ev10', schoolId:'sch1', title:'Science & Technology Fair',        type:'activity',  startDate:'2026-06-06', endDate:'2026-06-06', allDay:false, startTime:'09:00', endTime:'15:00', location:'Main Hall', targetAudience:['all'], description:'Annual science fair showcasing student projects.', createdBy:'u_tch4', createdAt:'2026-04-20T00:00:00Z' }
    ]);

    /* ─── BEHAVIOUR SETTINGS ─────────────────────────────────────────
       Singleton record. All behaviour system parameters are stored here
       and are fully editable by admin in Behaviour → Settings.
    ─────────────────────────────────────────────────────────────── */
    set('behaviour_settings', [{
      id: 'beh_cfg', schoolId: 'sch1',
      halfTermWeeks: 7,              // weeks per half-term
      demeritWindow: 'halfterm',     // 'halfterm' | 'term' — window for stage threshold counting
      housePointsOnDemerit: true,    // demerits also remove house points
      showDemeritToStudent: false,   // whether students see demerit detail
      seriousIncidentThreshold: 5,   // |points| >= this value requires a mandatory note
      /* ── Standard Behaviour Matrix (fixed point values — sourced from SAA BPS v2) ── */
      matrix: [
        /* Classroom & Academic */
        { id:'ca_m1',  cat:'Classroom & Academic',           label:'Outstanding contribution to class discussion',          type:'merit',   pts:2  },
        { id:'ca_m2',  cat:'Classroom & Academic',           label:'Full and focused engagement throughout lesson',         type:'merit',   pts:1  },
        { id:'ca_m3',  cat:'Classroom & Academic',           label:'Exceptional quality of written or practical work',      type:'merit',   pts:3  },
        { id:'ca_m4',  cat:'Classroom & Academic',           label:'Consistent homework completion over a full week',       type:'merit',   pts:2  },
        { id:'ca_m5',  cat:'Classroom & Academic',           label:'Helping a peer understand a concept unprompted',        type:'merit',   pts:2  },
        { id:'ca_m6',  cat:'Classroom & Academic',           label:'Creative or innovative approach to a task',             type:'merit',   pts:3  },
        { id:'ca_m7',  cat:'Classroom & Academic',           label:'Taking intellectual risk — challenge question',         type:'merit',   pts:2  },
        { id:'ca_m8',  cat:'Classroom & Academic',           label:'Outstanding Global Perspectives research',              type:'merit',   pts:4  },
        { id:'ca_m9',  cat:'Classroom & Academic',           label:'Achieving a personal best in assessment',               type:'merit',   pts:3  },
        { id:'ca_m10', cat:'Classroom & Academic',           label:'Demonstrating Cambridge learner attributes',            type:'merit',   pts:2  },
        { id:'ca_m11', cat:'Classroom & Academic',           label:'Submitting work ahead of deadline, well-presented',     type:'merit',   pts:1  },
        { id:'ca_m12', cat:'Classroom & Academic',           label:'Asking a deep enquiry-based question',                  type:'merit',   pts:1  },
        { id:'ca_d1',  cat:'Classroom & Academic',           label:'Arriving late to class without valid reason',           type:'demerit', pts:-1 },
        { id:'ca_d2',  cat:'Classroom & Academic',           label:'Unprepared for lesson (no books/equipment)',            type:'demerit', pts:-1 },
        { id:'ca_d3',  cat:'Classroom & Academic',           label:'Off-task, disengaged, or disrupting others',            type:'demerit', pts:-2 },
        { id:'ca_d4',  cat:'Classroom & Academic',           label:'Eating or drinking in class without permission',        type:'demerit', pts:-1 },
        { id:'ca_d5',  cat:'Classroom & Academic',           label:'Leaving class without permission',                      type:'demerit', pts:-2 },
        { id:'ca_d6',  cat:'Classroom & Academic',           label:'Incomplete homework (first instance)',                  type:'demerit', pts:-1 },
        { id:'ca_d7',  cat:'Classroom & Academic',           label:'Persistent refusal to engage in learning',              type:'demerit', pts:-3 },
        { id:'ca_d8',  cat:'Classroom & Academic',           label:'Writing on or defacing school materials',               type:'demerit', pts:-2 },
        { id:'ca_d9',  cat:'Classroom & Academic',           label:'Academic dishonesty (copying, plagiarism)',             type:'demerit', pts:-5 },
        { id:'ca_d10', cat:'Classroom & Academic',           label:'Cheating in a formal test or exam',                     type:'demerit', pts:-8 },
        /* Corridors & Common Areas */
        { id:'co_m1',  cat:'Corridors & Common Areas',       label:'Holding door open or assisting staff unprompted',       type:'merit',   pts:2  },
        { id:'co_m2',  cat:'Corridors & Common Areas',       label:'Picking up litter without being asked',                 type:'merit',   pts:2  },
        { id:'co_m3',  cat:'Corridors & Common Areas',       label:'Representing the school with pride to a visitor',       type:'merit',   pts:3  },
        { id:'co_m4',  cat:'Corridors & Common Areas',       label:'Calm, purposeful movement between lessons',             type:'merit',   pts:1  },
        { id:'co_m5',  cat:'Corridors & Common Areas',       label:'Supporting a peer who appears upset or lost',           type:'merit',   pts:3  },
        { id:'co_m6',  cat:'Corridors & Common Areas',       label:'Reporting a safety hazard to a staff member',           type:'merit',   pts:2  },
        { id:'co_d1',  cat:'Corridors & Common Areas',       label:'Running in corridors or stairwells',                    type:'demerit', pts:-1 },
        { id:'co_d2',  cat:'Corridors & Common Areas',       label:'Shouting or excessive noise in corridors',              type:'demerit', pts:-1 },
        { id:'co_d3',  cat:'Corridors & Common Areas',       label:'Pushing, jostling, or rough play in corridors',         type:'demerit', pts:-2 },
        { id:'co_d4',  cat:'Corridors & Common Areas',       label:'Loitering in restricted areas without permission',      type:'demerit', pts:-1 },
        { id:'co_d5',  cat:'Corridors & Common Areas',       label:'Littering in corridors or open areas',                  type:'demerit', pts:-2 },
        { id:'co_d6',  cat:'Corridors & Common Areas',       label:'Defacing walls, doors or noticeboards',                 type:'demerit', pts:-4 },
        { id:'co_d7',  cat:'Corridors & Common Areas',       label:'Vandalism of school property',                          type:'demerit', pts:-8 },
        { id:'co_d8',  cat:'Corridors & Common Areas',       label:'Entering out-of-bounds areas',                          type:'demerit', pts:-2 },
        /* Sports, PE & Extracurricular */
        { id:'sp_m1',  cat:'Sports, PE & Extracurricular',   label:'Demonstrating sportsmanship and fair play',             type:'merit',   pts:3  },
        { id:'sp_m2',  cat:'Sports, PE & Extracurricular',   label:'Outstanding effort in PE',                              type:'merit',   pts:2  },
        { id:'sp_m3',  cat:'Sports, PE & Extracurricular',   label:'Representing school in a sports competition',           type:'merit',   pts:5  },
        { id:'sp_m4',  cat:'Sports, PE & Extracurricular',   label:'Notable achievement in inter-school competition',       type:'merit',   pts:4  },
        { id:'sp_m5',  cat:'Sports, PE & Extracurricular',   label:'Leading a warm-up or drill when invited',               type:'merit',   pts:2  },
        { id:'sp_m6',  cat:'Sports, PE & Extracurricular',   label:'Consistent ECA attendance (per term)',                  type:'merit',   pts:2  },
        { id:'sp_m7',  cat:'Sports, PE & Extracurricular',   label:'Organising or helping run a school event',              type:'merit',   pts:4  },
        { id:'sp_m8',  cat:'Sports, PE & Extracurricular',   label:'Supporting a struggling teammate',                      type:'merit',   pts:2  },
        { id:'sp_m9',  cat:'Sports, PE & Extracurricular',   label:'Mentoring a junior student in sport (KS5)',             type:'merit',   pts:4  },
        { id:'sp_d1',  cat:'Sports, PE & Extracurricular',   label:'Repeated failure to bring PE kit',                      type:'demerit', pts:-2 },
        { id:'sp_d2',  cat:'Sports, PE & Extracurricular',   label:'Unsportsmanlike conduct — taunting or mocking',         type:'demerit', pts:-3 },
        { id:'sp_d3',  cat:'Sports, PE & Extracurricular',   label:'Dangerous play — deliberate fouling',                   type:'demerit', pts:-4 },
        { id:'sp_d4',  cat:'Sports, PE & Extracurricular',   label:'Refusing to follow coach instructions',                 type:'demerit', pts:-3 },
        { id:'sp_d5',  cat:'Sports, PE & Extracurricular',   label:'Causing deliberate injury during activity',             type:'demerit', pts:-8 },
        { id:'sp_d6',  cat:'Sports, PE & Extracurricular',   label:'Leaving premises during ECA without permission',        type:'demerit', pts:-5 },
        { id:'sp_d7',  cat:'Sports, PE & Extracurricular',   label:'Using sports equipment dangerously unsupervised',       type:'demerit', pts:-2 },
        { id:'sp_d8',  cat:'Sports, PE & Extracurricular',   label:'Abusing or damaging sports equipment',                  type:'demerit', pts:-4 },
        /* Interpersonal Relationships */
        { id:'ip_m1',  cat:'Interpersonal Relationships',    label:'Resolving a disagreement calmly without staff',         type:'merit',   pts:3  },
        { id:'ip_m2',  cat:'Interpersonal Relationships',    label:'Standing up for a peer being excluded unfairly',        type:'merit',   pts:4  },
        { id:'ip_m3',  cat:'Interpersonal Relationships',    label:'Welcoming and supporting a new student',                type:'merit',   pts:3  },
        { id:'ip_m4',  cat:'Interpersonal Relationships',    label:'Consistent kindness and consideration',                 type:'merit',   pts:2  },
        { id:'ip_m5',  cat:'Interpersonal Relationships',    label:'Proactively reporting a safeguarding concern',          type:'merit',   pts:3  },
        { id:'ip_m6',  cat:'Interpersonal Relationships',    label:'Acting as peer mentor or tutor',                        type:'merit',   pts:4  },
        { id:'ip_m7',  cat:'Interpersonal Relationships',    label:'Treating all staff and visitors with courtesy',         type:'merit',   pts:2  },
        { id:'ip_m8',  cat:'Interpersonal Relationships',    label:'Contributing positively to a group project',            type:'merit',   pts:2  },
        { id:'ip_m9',  cat:'Interpersonal Relationships',    label:'Demonstrating empathy during a difficult situation',    type:'merit',   pts:3  },
        { id:'ip_d1',  cat:'Interpersonal Relationships',    label:'Rude or disrespectful language to a peer',              type:'demerit', pts:-2 },
        { id:'ip_d2',  cat:'Interpersonal Relationships',    label:'Rude or disrespectful language to a staff member',      type:'demerit', pts:-4 },
        { id:'ip_d3',  cat:'Interpersonal Relationships',    label:'Deliberate exclusion or social isolation',              type:'demerit', pts:-3 },
        { id:'ip_d4',  cat:'Interpersonal Relationships',    label:'Low-level verbal bullying (name-calling)',               type:'demerit', pts:-4 },
        { id:'ip_d5',  cat:'Interpersonal Relationships',    label:'Sustained or repeated bullying',                        type:'demerit', pts:-10},
        { id:'ip_d6',  cat:'Interpersonal Relationships',    label:'Physical aggression — pushing/shoving (no injury)',     type:'demerit', pts:-5 },
        { id:'ip_d7',  cat:'Interpersonal Relationships',    label:'Physical assault causing injury',                       type:'demerit', pts:-15},
        { id:'ip_d8',  cat:'Interpersonal Relationships',    label:'Threatening behaviour or intimidation',                 type:'demerit', pts:-10},
        { id:'ip_d9',  cat:'Interpersonal Relationships',    label:'Cyberbullying or online harassment',                    type:'demerit', pts:-10},
        { id:'ip_d10', cat:'Interpersonal Relationships',    label:'Public display of romantic affection',                  type:'demerit', pts:-2 },
        { id:'ip_d11', cat:'Interpersonal Relationships',    label:'Discrimination based on race, gender or religion',      type:'demerit', pts:-15},
        { id:'ip_d12', cat:'Interpersonal Relationships',    label:'Theft from a peer or the school',                       type:'demerit', pts:-10},
        /* School Rules, Safety & Property */
        { id:'sr_m1',  cat:'School Rules, Safety & Property',label:'Full term of 100% punctuality',                         type:'merit',   pts:5  },
        { id:'sr_m2',  cat:'School Rules, Safety & Property',label:'Consistent exemplary uniform standard (per term)',      type:'merit',   pts:3  },
        { id:'sr_m3',  cat:'School Rules, Safety & Property',label:'Reporting a safety hazard immediately',                 type:'merit',   pts:2  },
        { id:'sr_m4',  cat:'School Rules, Safety & Property',label:'Returning borrowed equipment in excellent condition',   type:'merit',   pts:2  },
        { id:'sr_m5',  cat:'School Rules, Safety & Property',label:'Perfect attendance for a full term',                   type:'merit',   pts:5  },
        { id:'sr_m6',  cat:'School Rules, Safety & Property',label:'Outstanding conduct on an off-site trip',               type:'merit',   pts:4  },
        { id:'sr_m7',  cat:'School Rules, Safety & Property',label:'Caring for shared spaces',                              type:'merit',   pts:1  },
        { id:'sr_m8',  cat:'School Rules, Safety & Property',label:'Helping to set up or clear away for school event',      type:'merit',   pts:3  },
        { id:'sr_d1',  cat:'School Rules, Safety & Property',label:'Arriving late to school without valid reason',          type:'demerit', pts:-1 },
        { id:'sr_d2',  cat:'School Rules, Safety & Property',label:'Unauthorised absence from school',                      type:'demerit', pts:-3 },
        { id:'sr_d3',  cat:'School Rules, Safety & Property',label:'Uniform non-compliance (minor)',                        type:'demerit', pts:-1 },
        { id:'sr_d4',  cat:'School Rules, Safety & Property',label:'Persistent uniform non-compliance after warnings',      type:'demerit', pts:-3 },
        { id:'sr_d5',  cat:'School Rules, Safety & Property',label:'Chewing gum on school premises',                        type:'demerit', pts:-1 },
        { id:'sr_d6',  cat:'School Rules, Safety & Property',label:'Littering on school grounds',                           type:'demerit', pts:-2 },
        { id:'sr_d7',  cat:'School Rules, Safety & Property',label:'Using mobile phone during class (KS3/4)',               type:'demerit', pts:-2 },
        { id:'sr_d8',  cat:'School Rules, Safety & Property',label:'Using mobile phone during class (KS5, after warning)',  type:'demerit', pts:-1 },
        { id:'sr_d9',  cat:'School Rules, Safety & Property',label:'Bringing a prohibited item to school',                  type:'demerit', pts:-4 },
        { id:'sr_d10', cat:'School Rules, Safety & Property',label:'Misuse of school digital platforms',                    type:'demerit', pts:-4 },
        { id:'sr_d11', cat:'School Rules, Safety & Property',label:'Leaving premises without authorised exit slip',         type:'demerit', pts:-3 },
        { id:'sr_d12', cat:'School Rules, Safety & Property',label:'Running in or around the school building',              type:'demerit', pts:-1 },
        { id:'sr_d13', cat:'School Rules, Safety & Property',label:'Playing in wet or hazardous conditions',                type:'demerit', pts:-2 },
        { id:'sr_d14', cat:'School Rules, Safety & Property',label:'Substance use on premises',                             type:'demerit', pts:-15},
        { id:'sr_d15', cat:'School Rules, Safety & Property',label:'Possession of dangerous items or weapons',              type:'demerit', pts:-15},
        /* Dining Hall & Shared Spaces */
        { id:'di_m1',  cat:'Dining Hall & Shared Spaces',    label:'Queuing patiently, allowing younger students first',   type:'merit',   pts:2  },
        { id:'di_m2',  cat:'Dining Hall & Shared Spaces',    label:'Clearing table and leaving dining area tidy',          type:'merit',   pts:2  },
        { id:'di_m3',  cat:'Dining Hall & Shared Spaces',    label:'Polite and patient with dining staff',                 type:'merit',   pts:1  },
        { id:'di_m4',  cat:'Dining Hall & Shared Spaces',    label:'Assisting a student with difficulty in queue',         type:'merit',   pts:2  },
        { id:'di_d1',  cat:'Dining Hall & Shared Spaces',    label:'Queue jumping or aggressive queuing',                  type:'demerit', pts:-2 },
        { id:'di_d2',  cat:'Dining Hall & Shared Spaces',    label:'Eating or drinking in class or corridors',             type:'demerit', pts:-1 },
        { id:'di_d3',  cat:'Dining Hall & Shared Spaces',    label:'Leaving dining area untidy deliberately',              type:'demerit', pts:-2 },
        { id:'di_d4',  cat:'Dining Hall & Shared Spaces',    label:'Wasting food deliberately',                            type:'demerit', pts:-1 },
        { id:'di_d5',  cat:'Dining Hall & Shared Spaces',    label:'Ordering food from outside without SLT permission',    type:'demerit', pts:-2 },
        { id:'di_d6',  cat:'Dining Hall & Shared Spaces',    label:'Talking to strangers at the gate',                     type:'demerit', pts:-3 },
        /* Digital Citizenship & Technology */
        { id:'dt_m1',  cat:'Digital Citizenship & Technology',label:'Using school platforms responsibly, helping peers',   type:'merit',   pts:2  },
        { id:'dt_m2',  cat:'Digital Citizenship & Technology',label:'Citing AI tools or online sources correctly',         type:'merit',   pts:2  },
        { id:'dt_m3',  cat:'Digital Citizenship & Technology',label:'Reporting inappropriate digital content',             type:'merit',   pts:3  },
        { id:'dt_m4',  cat:'Digital Citizenship & Technology',label:'Producing creative digital project beyond minimum',   type:'merit',   pts:3  },
        { id:'dt_m5',  cat:'Digital Citizenship & Technology',label:'Responsible use of technology in class project',      type:'merit',   pts:2  },
        { id:'dt_d1',  cat:'Digital Citizenship & Technology',label:'Using device for non-academic purposes in lessons',   type:'demerit', pts:-2 },
        { id:'dt_d2',  cat:'Digital Citizenship & Technology',label:'Accessing inappropriate websites on school network',  type:'demerit', pts:-4 },
        { id:'dt_d3',  cat:'Digital Citizenship & Technology',label:'Recording staff or students without consent',         type:'demerit', pts:-5 },
        { id:'dt_d4',  cat:'Digital Citizenship & Technology',label:'Sharing another student\'s image without consent',    type:'demerit', pts:-8 },
        { id:'dt_d5',  cat:'Digital Citizenship & Technology',label:'Cyberbullying',                                       type:'demerit', pts:-10},
        { id:'dt_d6',  cat:'Digital Citizenship & Technology',label:'Bypassing school internet filter or firewall',        type:'demerit', pts:-5 },
        { id:'dt_d7',  cat:'Digital Citizenship & Technology',label:'Submitting unacknowledged AI-generated work',         type:'demerit', pts:-5 },
        /* Leadership & Community Service */
        { id:'lc_m1',  cat:'Leadership & Community Service', label:'School leadership role (per term)',                    type:'merit',   pts:10 },
        { id:'lc_m2',  cat:'Leadership & Community Service', label:'Organising or leading a school event or charity',      type:'merit',   pts:6  },
        { id:'lc_m3',  cat:'Leadership & Community Service', label:'Completing a structured community service project',    type:'merit',   pts:8  },
        { id:'lc_m4',  cat:'Leadership & Community Service', label:'Leading a presentation at assembly',                   type:'merit',   pts:4  },
        { id:'lc_m5',  cat:'Leadership & Community Service', label:'Serving as Student Ambassador or tour guide',          type:'merit',   pts:4  },
        { id:'lc_m6',  cat:'Leadership & Community Service', label:'Contributing to school newsletter or magazine',        type:'merit',   pts:3  },
        { id:'lc_m7',  cat:'Leadership & Community Service', label:'Notable result in national or international competition',type:'merit',  pts:8  },
        { id:'lc_m8',  cat:'Leadership & Community Service', label:'Sixth Form Peer Mentor, per term (KS5)',               type:'merit',   pts:6  },
        { id:'lc_m9',  cat:'Leadership & Community Service', label:'Initiating an environmental or sustainability project', type:'merit',  pts:6  }
      ],
      /* ── Behaviour categories (8 SAA BPS v2 defaults + any admin-created custom ones) ──
         matCat links to matrix item cat field; customPoints used for non-matrix custom categories */
      categories: [
        { id:'cat_ca', name:'Classroom & Academic',           matCat:'Classroom & Academic',            icon:'fas fa-chalkboard-teacher', color:'#2563EB', isDefault:true },
        { id:'cat_co', name:'Corridors & Common Areas',       matCat:'Corridors & Common Areas',         icon:'fas fa-walking',            color:'#7C3AED', isDefault:true },
        { id:'cat_sp', name:'Sports, PE & Extracurricular',   matCat:'Sports, PE & Extracurricular',     icon:'fas fa-running',            color:'#059669', isDefault:true },
        { id:'cat_ip', name:'Interpersonal Relationships',    matCat:'Interpersonal Relationships',      icon:'fas fa-users',              color:'#D97706', isDefault:true },
        { id:'cat_sr', name:'School Rules, Safety & Property',matCat:'School Rules, Safety & Property',  icon:'fas fa-shield-alt',         color:'#DC2626', isDefault:true },
        { id:'cat_di', name:'Dining Hall & Shared Spaces',    matCat:'Dining Hall & Shared Spaces',      icon:'fas fa-utensils',           color:'#0891B2', isDefault:true },
        { id:'cat_dt', name:'Digital Citizenship & Technology',matCat:'Digital Citizenship & Technology',icon:'fas fa-laptop',             color:'#6366F1', isDefault:true },
        { id:'cat_lc', name:'Leadership & Community Service', matCat:'Leadership & Community Service',   icon:'fas fa-trophy',             color:'#F59E0B', isDefault:true }
      ],
      /* ── Merit milestones (cumulative merit points — matching SAA BPS v2) ── */
      meritMilestones: [
        { id:'mm1', name:'Bronze Award',      threshold:25,  badge:'🥉', color:'#92400E', description:'Awarded for reaching 25 merit points',  ks5Only:false },
        { id:'mm2', name:'Silver Award',      threshold:50,  badge:'🥈', color:'#475569', description:'Awarded for reaching 50 merit points',  ks5Only:false },
        { id:'mm3', name:'Gold Award',        threshold:100, badge:'🥇', color:'#B45309', description:'Awarded for reaching 100 merit points', ks5Only:false },
        { id:'mm4', name:"Principal's Award", threshold:200, badge:'🏅', color:'#7C3AED', description:'Exceptional character and contribution', ks5Only:false },
        { id:'mm5', name:'Platinum Award',    threshold:300, badge:'🏆', color:'#0E7490', description:'Outstanding achievement — KS5 highest honour', ks5Only:true }
      ],
      /* ── Demerit intervention stages (cumulative per half-term — SAA BPS v2) ── */
      demeritStages: [
        { stage:1, threshold:5,  label:'Stage 1 — Pastoral Check-in',     action:'Class Teacher pastoral check-in with student.',         notifyParent:false, color:'#F59E0B', who:'Class Teacher'          },
        { stage:2, threshold:10, label:'Stage 2 — KS Coordinator Review',  action:'Key Stage Coordinator reviews behaviour record.',       notifyParent:true,  color:'#F97316', who:'KS Coordinator'         },
        { stage:3, threshold:20, label:'Stage 3 — Pastoral Support Plan',  action:'Pastoral Support Plan initiated. Parent meeting.',      notifyParent:true,  color:'#EF4444', who:'Pastoral Lead'           },
        { stage:4, threshold:35, label:'Stage 4 — Leadership Referral',    action:'Formal referral to Deputy Principal and parents.',      notifyParent:true,  color:'#DC2626', who:'Deputy Principal'        },
        { stage:5, threshold:50, label:'Stage 5 — Disciplinary Panel',     action:'Full disciplinary committee review. Panel convened.',   notifyParent:true,  color:'#7F1D1D', who:'Principal / Committee'   }
      ],
      /* ── Houses (SAA: Impala, Simba, Twiga, Chui) ── */
      houses: [
        { id:'yellow', name:'Impala', color:'#F59E0B', bg:'#FFFBEB', border:'#FCD34D', badge:'🦌' },
        { id:'red',    name:'Simba',  color:'#EF4444', bg:'#FEF2F2', border:'#FCA5A5', badge:'🦁' },
        { id:'green',  name:'Twiga',  color:'#22C55E', bg:'#F0FDF4', border:'#86EFAC', badge:'🦒' },
        { id:'blue',   name:'Chui',   color:'#3B82F6', bg:'#EFF6FF', border:'#93C5FD', badge:'🐆' }
      ],
      /* ── Detention types ── */
      detentionTypes: [
        { id:'det1', name:'Saturday Detention',  dayOfWeek:6,    startTime:'08:00', endTime:'12:00', location:'Library',   supervisor:'' },
        { id:'det2', name:'Lunchtime Detention', dayOfWeek:null, startTime:'12:30', endTime:'13:00', location:'Classroom', supervisor:'' }
      ],
      /* ── Key Stages (admin-configurable grade groupings) ── */
      keyStages: [
        { id:'ks_ey', name:'Early Years', grades:['KG1','KG2','KG3'], section:'KG',       color:'#F59E0B' },
        { id:'ks1',   name:'KS1',         grades:[1,2,3],              section:'Primary',   color:'#10B981' },
        { id:'ks2',   name:'KS2',         grades:[4,5,6],              section:'Primary',   color:'#3B82F6' },
        { id:'ks3',   name:'KS3',         grades:[7,8,9],              section:'Secondary', color:'#8B5CF6' },
        { id:'ks4',   name:'KS4',         grades:[10,11],              section:'Secondary', color:'#EF4444' },
        { id:'ks5',   name:'KS5',         grades:[12,13],              section:'Secondary', color:'#F97316' }
      ],
      createdAt: '2025-01-01T00:00:00Z'
    }]);

    /* ─── BEHAVIOUR INCIDENTS ────────────────────────────────────────
       One record per logged incident. type: 'merit' | 'demerit'.
       points: positive for merit, negative for demerit.
       housePoints: contribution to house cup (same sign as points).
    ─────────────────────────────────────────────────────────────── */
    set('behaviour_incidents', [
      /* ── Merits (using matrix behaviourId) ── */
      { id:'bi001', schoolId:'sch1', studentId:'stu1',  type:'merit',   behaviourId:'ca_m3',  categoryName:'Classroom & Academic',           points:3,  housePoints:3,  note:'Exceptional Chemistry project — highest score in year group.',          reportedBy:'u_tch4', reportedByName:'Dr. Ahmed Hassan',  date:'2025-04-30', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-04-30T10:00:00Z' },
      { id:'bi002', schoolId:'sch1', studentId:'stu9',  type:'merit',   behaviourId:'ip_m6',  categoryName:'Interpersonal Relationships',     points:4,  housePoints:4,  note:'Organised a study group and mentored three classmates all week.',         reportedBy:'u_tch1', reportedByName:'Ms. Sarah Smith',   date:'2025-05-02', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-02T09:00:00Z' },
      { id:'bi003', schoolId:'sch1', studentId:'stu17', type:'merit',   behaviourId:'ca_m3',  categoryName:'Classroom & Academic',           points:3,  housePoints:3,  note:'Outstanding English essay — A+ and commended by External Assessor.',     reportedBy:'u_tch1', reportedByName:'Ms. Sarah Smith',   date:'2025-05-05', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-05T11:00:00Z' },
      { id:'bi004', schoolId:'sch1', studentId:'stu10', type:'merit',   behaviourId:'ca_m9',  categoryName:'Classroom & Academic',           points:3,  housePoints:3,  note:'Scored 97% in Computer Science — highest in school this term.',          reportedBy:'u_tch6', reportedByName:'Mr. Raj Patel',      date:'2025-05-06', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-06T08:00:00Z' },
      { id:'bi005', schoolId:'sch1', studentId:'stu3',  type:'merit',   behaviourId:'ip_m3',  categoryName:'Interpersonal Relationships',     points:3,  housePoints:3,  note:'Volunteered to mentor and support a new student for two full weeks.',    reportedBy:'u_tch1', reportedByName:'Ms. Sarah Smith',   date:'2025-05-08', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-08T14:00:00Z' },
      { id:'bi006', schoolId:'sch1', studentId:'stu16', type:'merit',   behaviourId:'ca_m9',  categoryName:'Classroom & Academic',           points:3,  housePoints:3,  note:'Remarkable improvement in Mathematics — grade rose from D to B.',        reportedBy:'u_tch2', reportedByName:'Mr. James Ochieng', date:'2025-05-10', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-10T09:00:00Z' },
      { id:'bi011', schoolId:'sch1', studentId:'stu1',  type:'merit',   behaviourId:'lc_m4',  categoryName:'Leadership & Community Service', points:4,  housePoints:4,  note:'Led the peer revision session for Mathematics — highly praised.',         reportedBy:'u_tch2', reportedByName:'Mr. James Ochieng', date:'2025-05-12', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-12T14:00:00Z' },
      { id:'bi012', schoolId:'sch1', studentId:'stu8',  type:'merit',   behaviourId:'ip_m6',  categoryName:'Interpersonal Relationships',     points:4,  housePoints:4,  note:'Peer tutoring — spent lunchtime helping a struggling classmate.',         reportedBy:'u_tch3', reportedByName:'Ms. Priya Wanjiru', date:'2025-05-14', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-14T12:00:00Z' },
      /* ── Demerits (using matrix behaviourId) ── */
      { id:'bi007', schoolId:'sch1', studentId:'stu2',  type:'demerit', behaviourId:'sr_d1',  categoryName:'School Rules, Safety & Property',points:-1, housePoints:-1, note:'Arrived 15 minutes late to morning registration without excuse.',         reportedBy:'u_tch2', reportedByName:'Mr. James Ochieng', date:'2025-04-29', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-04-29T08:00:00Z' },
      { id:'bi008', schoolId:'sch1', studentId:'stu4',  type:'demerit', behaviourId:'ip_d1',  categoryName:'Interpersonal Relationships',     points:-2, housePoints:-2, note:'Used disrespectful language towards the classroom assistant.',            reportedBy:'u_tch1', reportedByName:'Ms. Sarah Smith',   date:'2025-05-01', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-01T11:00:00Z' },
      { id:'bi009', schoolId:'sch1', studentId:'stu4',  type:'demerit', behaviourId:'ca_d7',  categoryName:'Classroom & Academic',           points:-3, housePoints:-3, note:'Repeatedly disrupted the lesson after two verbal warnings.',              reportedBy:'u_tch4', reportedByName:'Dr. Ahmed Hassan',  date:'2025-05-07', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:1,    status:'active', parentNotified:false, createdAt:'2025-05-07T10:00:00Z' },
      { id:'bi010', schoolId:'sch1', studentId:'stu6',  type:'demerit', behaviourId:'sr_d3',  categoryName:'School Rules, Safety & Property',points:-1, housePoints:-1, note:'Found out of uniform during morning inspection without permission note.',  reportedBy:'u_tch3', reportedByName:'Ms. Priya Wanjiru', date:'2025-05-09', termId:'term2', academicYearId:'ay2025', milestoneReached:null, stageReached:null, status:'active', parentNotified:false, createdAt:'2025-05-09T08:30:00Z' }
    ]);

    /* ─── DETENTIONS ─────────────────────────────────────────────────
       Scheduled detention sessions. status: scheduled | completed | cancelled
    ─────────────────────────────────────────────────────────────── */
    set('detentions', []);

    /* ─── BEHAVIOUR APPEALS ─────────────────────────────────────────
       status: 'pending' | 'escalated' | 'accepted' | 'rejected'
       When pending: incident status = 'appealing'
       When accepted: incident status = 'overturned'
       When rejected: incident status = 'active'
    ─────────────────────────────────────────────────────────────── */
    set('behaviour_appeals', []);

    /* ── Assign houses to existing students (SAA: Impala/Simba/Twiga/Chui) ── */
    const _houseMap = {
      stu1:'red',  stu2:'blue', stu3:'yellow',stu4:'green', stu5:'red',
      stu6:'blue', stu7:'yellow',stu8:'green',stu9:'red',  stu10:'blue',
      stu11:'yellow',stu12:'green',stu13:'red', stu14:'blue',stu15:'yellow',
      stu16:'green', stu17:'red', stu18:'blue',stu19:'yellow',stu20:'green'
    };
    set('students', get('students').map(s => ({...s, houseId: _houseMap[s.id] || null})));

    /* ─── TEACHER ASSIGNMENTS ───────────────────────────────────────
       Each record = which teacher teaches which subject in which class,
       and how many periods per week that lesson runs.
       This is the source of truth for the auto-generation engine.
    ─────────────────────────────────────────────────────────────── */
    set('teacher_assignments', [
      /* ── tch1 – Sarah Smith (English Language, French) ── */
      {id:'ta001',teacherId:'tch1',subjectId:'sbj1',classId:'cls7a', periodsPerWeek:5},
      {id:'ta002',teacherId:'tch1',subjectId:'sbj1',classId:'cls8a', periodsPerWeek:5},
      {id:'ta003',teacherId:'tch1',subjectId:'sbj1',classId:'cls10a',periodsPerWeek:5},
      {id:'ta004',teacherId:'tch1',subjectId:'sbj1',classId:'cls11a',periodsPerWeek:5},
      {id:'ta005',teacherId:'tch1',subjectId:'sbj11',classId:'cls7a',periodsPerWeek:3},
      {id:'ta006',teacherId:'tch1',subjectId:'sbj11',classId:'cls7b',periodsPerWeek:3},
      /* ── tch2 – James Ochieng (Mathematics, Economics) ── */
      {id:'ta010',teacherId:'tch2',subjectId:'sbj2',classId:'cls7a', periodsPerWeek:5},
      {id:'ta011',teacherId:'tch2',subjectId:'sbj2',classId:'cls7b', periodsPerWeek:5},
      {id:'ta012',teacherId:'tch2',subjectId:'sbj2',classId:'cls8a', periodsPerWeek:5},
      {id:'ta013',teacherId:'tch2',subjectId:'sbj2',classId:'cls10a',periodsPerWeek:5},
      {id:'ta014',teacherId:'tch2',subjectId:'sbj14',classId:'cls11a',periodsPerWeek:3},
      {id:'ta015',teacherId:'tch2',subjectId:'sbj14',classId:'cls11b',periodsPerWeek:3},
      /* ── tch3 – Priya Wanjiru (Biology, Geography) ── */
      {id:'ta020',teacherId:'tch3',subjectId:'sbj3',classId:'cls9a', periodsPerWeek:4},
      {id:'ta021',teacherId:'tch3',subjectId:'sbj3',classId:'cls9b', periodsPerWeek:4},
      {id:'ta022',teacherId:'tch3',subjectId:'sbj3',classId:'cls10a',periodsPerWeek:4},
      {id:'ta023',teacherId:'tch3',subjectId:'sbj3',classId:'cls10b',periodsPerWeek:4},
      {id:'ta024',teacherId:'tch3',subjectId:'sbj7',classId:'cls8a', periodsPerWeek:3},
      {id:'ta025',teacherId:'tch3',subjectId:'sbj7',classId:'cls8b', periodsPerWeek:3},
      {id:'ta026',teacherId:'tch3',subjectId:'sbj7',classId:'cls10a',periodsPerWeek:3},
      /* ── tch4 – Ahmed Hassan (Chemistry, Physics) ── */
      {id:'ta030',teacherId:'tch4',subjectId:'sbj4',classId:'cls10a',periodsPerWeek:4},
      {id:'ta031',teacherId:'tch4',subjectId:'sbj4',classId:'cls10b',periodsPerWeek:4},
      {id:'ta032',teacherId:'tch4',subjectId:'sbj4',classId:'cls11a',periodsPerWeek:4},
      {id:'ta033',teacherId:'tch4',subjectId:'sbj4',classId:'cls11b',periodsPerWeek:4},
      {id:'ta034',teacherId:'tch4',subjectId:'sbj5',classId:'cls9a', periodsPerWeek:4},
      {id:'ta035',teacherId:'tch4',subjectId:'sbj5',classId:'cls9b', periodsPerWeek:4},
      {id:'ta036',teacherId:'tch4',subjectId:'sbj5',classId:'cls10a',periodsPerWeek:4},
      /* ── tch5 – Grace Kamau (History, Kiswahili) ── */
      {id:'ta040',teacherId:'tch5',subjectId:'sbj6',classId:'cls8a', periodsPerWeek:3},
      {id:'ta041',teacherId:'tch5',subjectId:'sbj6',classId:'cls8b', periodsPerWeek:3},
      {id:'ta042',teacherId:'tch5',subjectId:'sbj6',classId:'cls9a', periodsPerWeek:3},
      {id:'ta043',teacherId:'tch5',subjectId:'sbj6',classId:'cls9b', periodsPerWeek:3},
      {id:'ta044',teacherId:'tch5',subjectId:'sbj12',classId:'cls7a',periodsPerWeek:3},
      {id:'ta045',teacherId:'tch5',subjectId:'sbj12',classId:'cls7b',periodsPerWeek:3},
      {id:'ta046',teacherId:'tch5',subjectId:'sbj12',classId:'cls8a',periodsPerWeek:3},
      /* ── tch6 – Raj Patel (Computer Science) ── */
      {id:'ta050',teacherId:'tch6',subjectId:'sbj8',classId:'cls9a', periodsPerWeek:3},
      {id:'ta051',teacherId:'tch6',subjectId:'sbj8',classId:'cls9b', periodsPerWeek:3},
      {id:'ta052',teacherId:'tch6',subjectId:'sbj8',classId:'cls10a',periodsPerWeek:3},
      {id:'ta053',teacherId:'tch6',subjectId:'sbj8',classId:'cls10b',periodsPerWeek:3},
      /* ── tch7 – Fatuma Ngugi (Business Studies, Economics) ── */
      {id:'ta060',teacherId:'tch7',subjectId:'sbj13',classId:'cls11a',periodsPerWeek:3},
      {id:'ta061',teacherId:'tch7',subjectId:'sbj13',classId:'cls11b',periodsPerWeek:3},
      {id:'ta062',teacherId:'tch7',subjectId:'sbj13',classId:'cls12a',periodsPerWeek:3},
      {id:'ta063',teacherId:'tch7',subjectId:'sbj13',classId:'cls12b',periodsPerWeek:3},
      {id:'ta064',teacherId:'tch7',subjectId:'sbj14',classId:'cls10a',periodsPerWeek:3},
      {id:'ta065',teacherId:'tch7',subjectId:'sbj14',classId:'cls10b',periodsPerWeek:3},
      /* ── tch8 – Kevin Otieno (Physical Education, Art & Design) ── */
      {id:'ta070',teacherId:'tch8',subjectId:'sbj9',classId:'cls7a', periodsPerWeek:2},
      {id:'ta071',teacherId:'tch8',subjectId:'sbj9',classId:'cls7b', periodsPerWeek:2},
      {id:'ta072',teacherId:'tch8',subjectId:'sbj9',classId:'cls8a', periodsPerWeek:2},
      {id:'ta073',teacherId:'tch8',subjectId:'sbj9',classId:'cls8b', periodsPerWeek:2},
      {id:'ta074',teacherId:'tch8',subjectId:'sbj9',classId:'cls9a', periodsPerWeek:2},
      {id:'ta075',teacherId:'tch8',subjectId:'sbj9',classId:'cls9b', periodsPerWeek:2},
      {id:'ta076',teacherId:'tch8',subjectId:'sbj9',classId:'cls10a',periodsPerWeek:2},
      {id:'ta077',teacherId:'tch8',subjectId:'sbj9',classId:'cls10b',periodsPerWeek:2},
      {id:'ta078',teacherId:'tch8',subjectId:'sbj10',classId:'cls7a',periodsPerWeek:2},
      {id:'ta079',teacherId:'tch8',subjectId:'sbj10',classId:'cls7b',periodsPerWeek:2},
      {id:'ta080',teacherId:'tch8',subjectId:'sbj10',classId:'cls8a',periodsPerWeek:2},
      {id:'ta081',teacherId:'tch8',subjectId:'sbj10',classId:'cls8b',periodsPerWeek:2},
    ]);

    /* ─── TIMETABLE GENERATION RULES ───────────────────────────────
       Single record — constraints used by the auto-generation engine.
    ─────────────────────────────────────────────────────────────── */
    set('timetable_rules', [{
      id: 'rules1',
      schoolId: 'sch1',
      /* Teacher constraints */
      maxConsecutivePeriods: 3,       // max back-to-back lessons for a teacher
      avoidTeacherGaps: true,         // try to keep teacher schedules compact
      maxTeacherPeriodsPerDay: 6,     // teacher daily cap
      /* Class constraints */
      maxClassPeriodsPerDay: 7,       // class daily cap (all 7 lesson slots)
      maxSameSubjectPerDay: 2,        // same subject max times per day
      /* Distribution */
      evenDistribution: true,         // spread subjects across all 5 days
      coreSubjectsEarly: true,        // place Maths & English in first 3 periods
      /* Special */
      allowDoubleLesson: false,       // consecutive same-subject slots
      respectRoomCapacity: false,     /* future: check class size vs room capacity */
      multiBuilding: false            /* future: travel time between buildings */
    }]);

    /* ─── ASSESSMENT TYPES (Grade Weight Configuration) ────────────
       Admin configures assessment categories, each with a weight (%).
       typeCodes: which grade.type strings map to this category.
       Weights are normalized at runtime when some types are absent.
    ─────────────────────────────────────────────────────────────── */
    set('assessment_types', [
      { id:'at1', schoolId:'sch1', name:'End of Term Exam',              code:'EXAM', typeCodes:['exam'],                weight:60, isActive:true, order:1, createdAt:'2025-01-01T00:00:00Z' },
      { id:'at2', schoolId:'sch1', name:'Continuous Assessment Test',    code:'CAT',  typeCodes:['test','quiz','cat'],   weight:30, isActive:true, order:2, createdAt:'2025-01-01T00:00:00Z' },
      { id:'at3', schoolId:'sch1', name:'Homework & Assignments',        code:'HW',   typeCodes:['homework','project'],  weight:10, isActive:true, order:3, createdAt:'2025-01-01T00:00:00Z' }
    ]);

    /* ─── GRADE SCALES ──────────────────────────────────────────────
       A school may have multiple grade scales.
       applyToGrades: array of grade level numbers (as strings) this scale covers.
       ranges: sorted descending by min.
    ─────────────────────────────────────────────────────────────── */
    set('grade_scales', [
      {
        id:'gs1', schoolId:'sch1', name:'Upper School Scale (Grades 9–12)',
        applyToGrades:['9','10','11','12'],
        ranges:[
          {min:90, max:100, grade:'A+', points:12, remarks:'Exceptional'},
          {min:80, max:89,  grade:'A',  points:11, remarks:'Excellent'},
          {min:75, max:79,  grade:'B+', points:10, remarks:'Very Good'},
          {min:70, max:74,  grade:'B',  points:9,  remarks:'Good'},
          {min:65, max:69,  grade:'C+', points:8,  remarks:'Above Average'},
          {min:60, max:64,  grade:'C',  points:7,  remarks:'Average'},
          {min:55, max:59,  grade:'D+', points:6,  remarks:'Below Average'},
          {min:50, max:54,  grade:'D',  points:5,  remarks:'Pass'},
          {min:0,  max:49,  grade:'F',  points:0,  remarks:'Fail'}
        ],
        createdAt:'2025-01-01T00:00:00Z'
      },
      {
        id:'gs2', schoolId:'sch1', name:'Junior School Scale (Grades 7–8)',
        applyToGrades:['7','8'],
        ranges:[
          {min:90, max:100, grade:'EE', points:4, remarks:'Exceeds Expectations'},
          {min:75, max:89,  grade:'ME', points:3, remarks:'Meets Expectations'},
          {min:50, max:74,  grade:'AE', points:2, remarks:'Approaching Expectations'},
          {min:0,  max:49,  grade:'BE', points:1, remarks:'Below Expectations'}
        ],
        createdAt:'2025-01-01T00:00:00Z'
      }
    ]);

    /* ─── REPORT CARDS ──────────────────────────────────────────────
       One record per student per term. status: draft | published | restricted
    ─────────────────────────────────────────────────────────────── */
    set('report_cards', []);

    /* ─── SUBJECT COMMENTS ──────────────────────────────────────────
       Subject teacher comment per student per subject per term.
    ─────────────────────────────────────────────────────────────── */
    set('subject_comments', []);

    /* ─── LESSON PLANS ──────────────────────────────────────────────
       Scheme of work: teacher enters topics by week.
       status: planned | in_progress | completed
    ─────────────────────────────────────────────────────────────── */
    set('lesson_plans', [
      { id:'lp1',  schoolId:'sch1', teacherId:'tch1', subjectId:'sbj1',  classId:'cls10a', termId:'term1', academicYearId:'ay2025', week:1,  topic:'Introduction to Literary Analysis',  chapter:'Unit 1',   objectives:'Understand what literary analysis is and the key elements of fiction', materials:'Textbook Ch.1, sample essays',        status:'completed',   createdAt:'2025-01-10T00:00:00Z' },
      { id:'lp2',  schoolId:'sch1', teacherId:'tch1', subjectId:'sbj1',  classId:'cls10a', termId:'term1', academicYearId:'ay2025', week:2,  topic:'Narrative Voice & Perspective',       chapter:'Unit 1',   objectives:'Identify first-person vs third-person narration and its effect on the reader', materials:'Novel excerpts, worksheet',  status:'completed',   createdAt:'2025-01-17T00:00:00Z' },
      { id:'lp3',  schoolId:'sch1', teacherId:'tch1', subjectId:'sbj1',  classId:'cls10a', termId:'term1', academicYearId:'ay2025', week:3,  topic:'Theme & Symbolism',                   chapter:'Unit 2',   objectives:'Identify major themes and symbols in a given text', materials:'To Kill a Mockingbird, reading guide',               status:'completed',   createdAt:'2025-01-24T00:00:00Z' },
      { id:'lp4',  schoolId:'sch1', teacherId:'tch2', subjectId:'sbj2',  classId:'cls10a', termId:'term2', academicYearId:'ay2025', week:1,  topic:'Differentiation: Basic Rules',         chapter:'Ch. 5',    objectives:'Apply power rule and sum rule to differentiate polynomial functions', materials:'Textbook Ch.5, scientific calculator', status:'completed',   createdAt:'2025-04-28T00:00:00Z' },
      { id:'lp5',  schoolId:'sch1', teacherId:'tch2', subjectId:'sbj2',  classId:'cls10a', termId:'term2', academicYearId:'ay2025', week:2,  topic:'Differentiation: Chain & Product Rule', chapter:'Ch. 5',   objectives:'Apply chain rule and product rule to composite and product functions', materials:'Textbook Ch.5, past papers',         status:'completed',   createdAt:'2025-05-05T00:00:00Z' },
      { id:'lp6',  schoolId:'sch1', teacherId:'tch2', subjectId:'sbj2',  classId:'cls10a', termId:'term2', academicYearId:'ay2025', week:3,  topic:'Integration: Indefinite Integrals',    chapter:'Ch. 6',    objectives:'Compute indefinite integrals using basic rules', materials:'Textbook Ch.6',                                      status:'in_progress', createdAt:'2025-05-12T00:00:00Z' },
      { id:'lp7',  schoolId:'sch1', teacherId:'tch2', subjectId:'sbj2',  classId:'cls10a', termId:'term2', academicYearId:'ay2025', week:4,  topic:'Integration: Definite Integrals & Area', chapter:'Ch. 6',  objectives:'Evaluate definite integrals and apply to area calculations', materials:'Textbook Ch.6, graph paper',                  status:'planned',     createdAt:'2025-05-12T00:00:00Z' },
      { id:'lp8',  schoolId:'sch1', teacherId:'tch4', subjectId:'sbj5',  classId:'cls10a', termId:'term2', academicYearId:'ay2025', week:1,  topic:'Electric Fields',                      chapter:'Ch. 4',    objectives:'Define electric field and calculate field strength for point charges', materials:'Textbook Ch.4, simulation software', status:'completed',   createdAt:'2025-04-28T00:00:00Z' },
      { id:'lp9',  schoolId:'sch1', teacherId:'tch4', subjectId:'sbj5',  classId:'cls10a', termId:'term2', academicYearId:'ay2025', week:2,  topic:'Electric Potential',                   chapter:'Ch. 4',    objectives:'Calculate electric potential energy and relate to field strength', materials:'Textbook, lab equipment',                  status:'in_progress', createdAt:'2025-05-05T00:00:00Z' }
    ]);

    /* ─── ADMISSION SETTINGS ────────────────────────────────────────
       Singleton config record. Drives auto-numbering, online form
       token, and the configurable admission checklist.
    ─────────────────────────────────────────────────────────────── */
    set('admission_settings', [{
      id: 'adm_cfg',
      schoolId: 'sch1',
      /* Auto-numbering */
      admissionNoPrefix: 'MIS',
      admissionNoYear:   '2025',
      nextSeqNumber:     21,            // next new student gets MIS-2025-021
      zeroPad:           3,             // pad sequence to 3 digits
      /* Online public form */
      onlineFormEnabled: true,
      onlineFormToken:   'mis2025open', // appears in the shareable URL
      onlineFormTitle:   'Apply to InnoLearn International School',
      onlineFormDeadline:'2025-08-31',
      /* Checklist items (admin can reorder / add / remove) */
      checklistItems: [
        { id:'birth_cert',  label:'Birth Certificate',            required:true  },
        { id:'prev_report', label:'Previous School Report Card',  required:true  },
        { id:'medical',     label:'Medical / Immunization Form',  required:false },
        { id:'interview',   label:'Interview Completed',          required:true  },
        { id:'reg_fee',     label:'Registration Fee Paid',        required:true  },
        { id:'photos',      label:'Passport Photos (2 copies)',   required:false },
        { id:'id_copy',     label:'Parent/Guardian ID Copy',      required:false }
      ],
      /* Default subject assignment: use the class's curriculum subjects */
      autoAssignSubjects: true,
      createdAt: '2025-01-01T00:00:00Z'
    }]);

    /* ─── APPLICATIONS ──────────────────────────────────────────────
       One record per applicant. Stays separate from students until
       status = 'enrolled', at which point a students record is created.
       source:  'manual' | 'bulk' | 'online'
       status:  'draft' | 'pending' | 'approved' | 'rejected' | 'enrolled'
    ─────────────────────────────────────────────────────────────── */
    set('applications', [
      /* ── PENDING (manual) ── */
      {
        id:'adm001', schoolId:'sch1', source:'manual',
        status:'pending', academicYearId:'ay2025',
        firstName:'Amani', lastName:'Oduya', gender:'Male',
        dateOfBirth:'2011-03-18', nationality:'Kenyan', bloodGroup:'O+',
        applyingForGrade:9, applyingForStream:'A', applyingForTerm:'term2',
        previousSchool:'Nairobi Academy', previousClass:'Grade 8',
        previousPerformance:'B+', previousAverage:78,
        guardians:[{ name:'Mr. Charles Oduya', relation:'Father', phone:'+254 722 501 001', email:'charles.oduya@email.com', isPrimary:true }],
        medicalInfo:{ conditions:'None', allergies:'None', medications:'None' },
        checklist:{ birth_cert:true, prev_report:true, medical:false, interview:true, reg_fee:false, photos:false, id_copy:true },
        notes:'Strong Math background. Interested in Sciences stream.',
        reviewedBy:null, reviewedAt:null, rejectionReason:null,
        assignedClass:null, assignedAdmissionNo:null, studentId:null,
        submittedAt:'2025-04-10T09:30:00Z', createdAt:'2025-04-10T09:30:00Z'
      },
      /* ── PENDING (online) ── */
      {
        id:'adm002', schoolId:'sch1', source:'online',
        status:'pending', academicYearId:'ay2025',
        firstName:'Zoe', lastName:'Acheampong', gender:'Female',
        dateOfBirth:'2012-07-09', nationality:'Ghanaian-Kenyan', bloodGroup:'A+',
        applyingForGrade:8, applyingForStream:'A', applyingForTerm:'term3',
        previousSchool:'Westlands Primary', previousClass:'Grade 7', previousPerformance:'A',
        previousAverage:89,
        guardians:[{ name:'Dr. Kweku Acheampong', relation:'Father', phone:'+254 733 502 001', email:'kweku.a@gmail.com', isPrimary:true }],
        medicalInfo:{ conditions:'Mild asthma', allergies:'Pollen', medications:'Inhaler as needed' },
        checklist:{ birth_cert:true, prev_report:true, medical:true, interview:false, reg_fee:false, photos:true, id_copy:false },
        notes:'Applied via online form. Awaiting interview scheduling.',
        reviewedBy:null, reviewedAt:null, rejectionReason:null,
        assignedClass:null, assignedAdmissionNo:null, studentId:null,
        submittedAt:'2025-04-15T14:22:00Z', createdAt:'2025-04-15T14:22:00Z'
      },
      /* ── PENDING (bulk upload) ── */
      {
        id:'adm003', schoolId:'sch1', source:'bulk',
        status:'pending', academicYearId:'ay2025',
        firstName:'Marcus', lastName:'Gitonga', gender:'Male',
        dateOfBirth:'2013-01-25', nationality:'Kenyan', bloodGroup:'B+',
        applyingForGrade:7, applyingForStream:'B', applyingForTerm:'term3',
        previousSchool:'Embakasi Primary', previousClass:'Grade 6', previousPerformance:'B',
        previousAverage:72,
        guardians:[{ name:'Mrs. Faith Gitonga', relation:'Mother', phone:'+254 711 503 001', email:'faith.gitonga@email.com', isPrimary:true }],
        medicalInfo:{ conditions:'None', allergies:'None', medications:'None' },
        checklist:{ birth_cert:true, prev_report:true, medical:false, interview:false, reg_fee:false, photos:false, id_copy:false },
        notes:'Imported via bulk upload — Term 3 2025 intake.',
        reviewedBy:null, reviewedAt:null, rejectionReason:null,
        assignedClass:null, assignedAdmissionNo:null, studentId:null,
        submittedAt:'2025-04-20T08:00:00Z', createdAt:'2025-04-20T08:00:00Z'
      },
      /* ── APPROVED (ready to enroll) ── */
      {
        id:'adm004', schoolId:'sch1', source:'manual',
        status:'approved', academicYearId:'ay2025',
        firstName:'Priya', lastName:'Sharma', gender:'Female',
        dateOfBirth:'2009-11-12', nationality:'Indian', bloodGroup:'AB+',
        applyingForGrade:11, applyingForStream:'A', applyingForTerm:'term2',
        previousSchool:'Delhi Public School', previousClass:'Grade 10', previousPerformance:'A+',
        previousAverage:94,
        guardians:[{ name:'Mr. Ravi Sharma', relation:'Father', phone:'+254 722 504 001', email:'ravi.sharma@email.com', isPrimary:true }],
        medicalInfo:{ conditions:'None', allergies:'Penicillin', medications:'None' },
        checklist:{ birth_cert:true, prev_report:true, medical:true, interview:true, reg_fee:true, photos:true, id_copy:true },
        notes:'All requirements complete. Approved for Grade 11A — Sciences.',
        reviewedBy:'u_admin1', reviewedAt:'2025-04-22T10:00:00Z', rejectionReason:null,
        assignedClass:'cls11a', assignedAdmissionNo:'MIS-2025-021', studentId:null,
        submittedAt:'2025-04-08T11:00:00Z', createdAt:'2025-04-08T11:00:00Z'
      },
      /* ── REJECTED ── */
      {
        id:'adm005', schoolId:'sch1', source:'online',
        status:'rejected', academicYearId:'ay2025',
        firstName:'David', lastName:'Kamau', gender:'Male',
        dateOfBirth:'2008-05-30', nationality:'Kenyan', bloodGroup:'O-',
        applyingForGrade:12, applyingForStream:'A', applyingForTerm:'term2',
        previousSchool:'Strathmore School', previousClass:'Grade 11', previousPerformance:'C',
        previousAverage:55,
        guardians:[{ name:'Mr. Peter Kamau', relation:'Father', phone:'+254 700 505 001', email:'peter.kamau@email.com', isPrimary:true }],
        medicalInfo:{ conditions:'None', allergies:'None', medications:'None' },
        checklist:{ birth_cert:true, prev_report:true, medical:false, interview:true, reg_fee:false, photos:false, id_copy:false },
        notes:'',
        reviewedBy:'u_admin1', reviewedAt:'2025-04-18T14:00:00Z',
        rejectionReason:'Academic performance below our Grade 12 entry threshold of 65%. Encouraged to re-apply after improving grades.',
        assignedClass:null, assignedAdmissionNo:null, studentId:null,
        submittedAt:'2025-04-05T16:00:00Z', createdAt:'2025-04-05T16:00:00Z'
      },
      /* ── ENROLLED (converted to student) ── */
      {
        id:'adm006', schoolId:'sch1', source:'manual',
        status:'enrolled', academicYearId:'ay2025',
        firstName:'Sophia', lastName:'Mutua', gender:'Female',
        dateOfBirth:'2012-09-03', nationality:'Kenyan', bloodGroup:'A+',
        applyingForGrade:8, applyingForStream:'B', applyingForTerm:'term2',
        previousSchool:'Light Academy', previousClass:'Grade 7', previousPerformance:'A',
        previousAverage:87,
        guardians:[{ name:'Mrs. Lucy Mutua', relation:'Mother', phone:'+254 722 506 001', email:'lucy.mutua@email.com', isPrimary:true }],
        medicalInfo:{ conditions:'None', allergies:'None', medications:'None' },
        checklist:{ birth_cert:true, prev_report:true, medical:true, interview:true, reg_fee:true, photos:true, id_copy:true },
        notes:'Enrolled. Student profile created.',
        reviewedBy:'u_admin1', reviewedAt:'2025-04-01T09:00:00Z', rejectionReason:null,
        assignedClass:'cls8b', assignedAdmissionNo:'MIS-2025-020', studentId:'stu15',
        submittedAt:'2025-03-28T10:00:00Z', createdAt:'2025-03-28T10:00:00Z'
      },
      /* ── DRAFT ── */
      {
        id:'adm007', schoolId:'sch1', source:'manual',
        status:'draft', academicYearId:'ay2025',
        firstName:'James', lastName:'Ndung\'u', gender:'Male',
        dateOfBirth:'2011-06-14', nationality:'Kenyan', bloodGroup:'',
        applyingForGrade:9, applyingForStream:'', applyingForTerm:'term3',
        previousSchool:'', previousClass:'', previousPerformance:'', previousAverage:null,
        guardians:[{ name:'Mr. Thomas Ndungu', relation:'Father', phone:'+254 722 507 001', email:'', isPrimary:true }],
        medicalInfo:{ conditions:'', allergies:'', medications:'' },
        checklist:{ birth_cert:false, prev_report:false, medical:false, interview:false, reg_fee:false, photos:false, id_copy:false },
        notes:'Incomplete — parent to complete remaining details.',
        reviewedBy:null, reviewedAt:null, rejectionReason:null,
        assignedClass:null, assignedAdmissionNo:null, studentId:null,
        submittedAt:null, createdAt:'2025-04-23T15:00:00Z'
      }
    ]);

    /* ─── EXAM SCHEDULES ───────────────────────────────────────────────
       One record per individual subject exam sitting.
       status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
    ─────────────────────────────────────────────────────────────── */
    set('exam_schedules', [
      /* Term 2 Exams — 7–18 July 2025 */
      { id:'ex001', schoolId:'sch1', termId:'term2', academicYearId:'ay2025', title:'Term 2 Examination',
        classId:'cls10a', subjectId:'sbj1', teacherId:'tch1',
        date:'2025-07-07', startTime:'08:00', endTime:'10:00', duration:120, room:'Exam Hall A',
        maxMarks:100, passMark:50, instructions:'No talking. No phones. Bring 2 pens.', status:'scheduled',
        createdBy:'u_tch1', createdAt:'2025-05-01T00:00:00Z' },
      { id:'ex002', schoolId:'sch1', termId:'term2', academicYearId:'ay2025', title:'Term 2 Examination',
        classId:'cls10a', subjectId:'sbj2', teacherId:'tch2',
        date:'2025-07-08', startTime:'08:00', endTime:'10:30', duration:150, room:'Exam Hall A',
        maxMarks:100, passMark:50, instructions:'Calculator allowed. No formula sheets.', status:'scheduled',
        createdBy:'u_admin1', createdAt:'2025-05-01T00:00:00Z' },
      { id:'ex003', schoolId:'sch1', termId:'term2', academicYearId:'ay2025', title:'Term 2 Examination',
        classId:'cls10a', subjectId:'sbj5', teacherId:'tch4',
        date:'2025-07-09', startTime:'08:00', endTime:'10:00', duration:120, room:'Science Lab 1',
        maxMarks:100, passMark:50, instructions:'Calculator and formula sheet allowed.', status:'scheduled',
        createdBy:'u_admin1', createdAt:'2025-05-01T00:00:00Z' },
      { id:'ex004', schoolId:'sch1', termId:'term2', academicYearId:'ay2025', title:'Term 2 Examination',
        classId:'cls10a', subjectId:'sbj8', teacherId:'tch6',
        date:'2025-07-10', startTime:'08:00', endTime:'10:00', duration:120, room:'ICT Lab 1',
        maxMarks:100, passMark:50, instructions:'Practical exam on school computers.', status:'scheduled',
        createdBy:'u_admin1', createdAt:'2025-05-01T00:00:00Z' },
      { id:'ex005', schoolId:'sch1', termId:'term2', academicYearId:'ay2025', title:'Term 2 Examination',
        classId:'cls10b', subjectId:'sbj1', teacherId:'tch1',
        date:'2025-07-07', startTime:'11:00', endTime:'13:00', duration:120, room:'Exam Hall B',
        maxMarks:100, passMark:50, instructions:'No talking. No phones. Bring 2 pens.', status:'scheduled',
        createdBy:'u_admin1', createdAt:'2025-05-01T00:00:00Z' },
      { id:'ex006', schoolId:'sch1', termId:'term2', academicYearId:'ay2025', title:'Term 2 Examination',
        classId:'cls10b', subjectId:'sbj2', teacherId:'tch2',
        date:'2025-07-08', startTime:'11:00', endTime:'13:30', duration:150, room:'Exam Hall B',
        maxMarks:100, passMark:50, instructions:'Calculator allowed.', status:'scheduled',
        createdBy:'u_admin1', createdAt:'2025-05-01T00:00:00Z' },
      /* Mid-Term Tests — completed */
      { id:'ex007', schoolId:'sch1', termId:'term2', academicYearId:'ay2025', title:'Mid-Term Test',
        classId:'cls10a', subjectId:'sbj1', teacherId:'tch1',
        date:'2025-06-05', startTime:'08:00', endTime:'09:00', duration:60, room:'Room 203',
        maxMarks:50, passMark:25, instructions:'Open book. No internet.', status:'completed',
        createdBy:'u_tch1', createdAt:'2025-05-10T00:00:00Z' },
      { id:'ex008', schoolId:'sch1', termId:'term2', academicYearId:'ay2025', title:'Mid-Term Test',
        classId:'cls10a', subjectId:'sbj2', teacherId:'tch2',
        date:'2025-06-05', startTime:'10:00', endTime:'11:00', duration:60, room:'Room 203',
        maxMarks:50, passMark:25, instructions:'Calculator allowed.', status:'completed',
        createdBy:'u_tch2', createdAt:'2025-05-10T00:00:00Z' },
      { id:'ex009', schoolId:'sch1', termId:'term1', academicYearId:'ay2025', title:'Term 1 Examination',
        classId:'cls10a', subjectId:'sbj1', teacherId:'tch1',
        date:'2025-03-25', startTime:'08:00', endTime:'10:00', duration:120, room:'Exam Hall A',
        maxMarks:100, passMark:50, instructions:'No talking. No phones.', status:'completed',
        createdBy:'u_admin1', createdAt:'2025-01-20T00:00:00Z' },
      { id:'ex010', schoolId:'sch1', termId:'term1', academicYearId:'ay2025', title:'Term 1 Examination',
        classId:'cls10a', subjectId:'sbj2', teacherId:'tch2',
        date:'2025-03-25', startTime:'11:00', endTime:'13:30', duration:150, room:'Exam Hall A',
        maxMarks:100, passMark:50, instructions:'Calculator allowed.', status:'completed',
        createdBy:'u_admin1', createdAt:'2025-01-20T00:00:00Z' }
    ]);

    /* ─── LEAVE REQUESTS ─────────────────────────────────────────────
       type: annual | sick | emergency | maternity | paternity | unpaid
       status: pending | approved | rejected
    ─────────────────────────────────────────────────────────────── */
    set('leave_requests', [
      { id:'lv001', schoolId:'sch1', teacherId:'tch3', type:'sick',     startDate:'2025-04-16', endDate:'2025-04-17', days:2,
        reason:'Severe flu and fever. Doctor recommended 2 days rest.', status:'approved',
        approvedBy:'u_admin1', approvedAt:'2025-04-15T16:00:00Z', rejectionReason:null, substituteTeacherId:'tch1',
        createdAt:'2025-04-15T10:00:00Z' },
      { id:'lv002', schoolId:'sch1', teacherId:'tch5', type:'annual',   startDate:'2025-06-13', endDate:'2025-06-20', days:6,
        reason:'Family vacation during mid-term break.', status:'approved',
        approvedBy:'u_admin1', approvedAt:'2025-05-20T09:00:00Z', rejectionReason:null, substituteTeacherId:null,
        createdAt:'2025-05-18T00:00:00Z' },
      { id:'lv003', schoolId:'sch1', teacherId:'tch7', type:'emergency', startDate:'2025-05-02', endDate:'2025-05-02', days:1,
        reason:'Family emergency — parent hospitalized.', status:'approved',
        approvedBy:'u_admin2', approvedAt:'2025-05-02T07:30:00Z', rejectionReason:null, substituteTeacherId:'tch2',
        createdAt:'2025-05-02T07:00:00Z' },
      { id:'lv004', schoolId:'sch1', teacherId:'tch6', type:'annual',   startDate:'2025-07-28', endDate:'2025-08-08', days:10,
        reason:'Annual leave. Travel abroad.', status:'pending',
        approvedBy:null, approvedAt:null, rejectionReason:null, substituteTeacherId:null,
        createdAt:'2025-04-25T00:00:00Z' },
      { id:'lv005', schoolId:'sch1', teacherId:'tch8', type:'sick',     startDate:'2025-04-10', endDate:'2025-04-10', days:1,
        reason:'Back injury from sports session.', status:'approved',
        approvedBy:'u_admin1', approvedAt:'2025-04-10T09:00:00Z', rejectionReason:null, substituteTeacherId:'tch5',
        createdAt:'2025-04-10T08:30:00Z' },
      { id:'lv006', schoolId:'sch1', teacherId:'tch4', type:'annual',   startDate:'2025-05-05', endDate:'2025-05-07', days:3,
        reason:'Conference attendance — International Physics Educators Summit, Mombasa.', status:'rejected',
        approvedBy:'u_admin1', approvedAt:'2025-04-30T00:00:00Z', rejectionReason:'Too close to mid-terms. Please reapply during break.', substituteTeacherId:null,
        createdAt:'2025-04-28T00:00:00Z' }
    ]);

    /* ─── PAYROLL ─────────────────────────────────────────────────────
       status: draft | processed | paid
    ─────────────────────────────────────────────────────────────── */
    set('payroll', [
      /* April 2025 — processed */
      { id:'pay_apr_tch1', schoolId:'sch1', teacherId:'tch1', month:'April', year:2025, payPeriod:'2025-04',
        basicSalary:180000, allowances:{housing:18000,transport:5000,medical:3000}, deductions:{paye:35000,nhif:1700,nssf:200,other:0},
        grossSalary:206000, netSalary:169100, status:'paid', paymentDate:'2025-04-28', paymentMethod:'bank_transfer', createdAt:'2025-04-25T00:00:00Z' },
      { id:'pay_apr_tch2', schoolId:'sch1', teacherId:'tch2', month:'April', year:2025, payPeriod:'2025-04',
        basicSalary:165000, allowances:{housing:16500,transport:5000,medical:3000}, deductions:{paye:30000,nhif:1700,nssf:200,other:0},
        grossSalary:189500, netSalary:157600, status:'paid', paymentDate:'2025-04-28', paymentMethod:'bank_transfer', createdAt:'2025-04-25T00:00:00Z' },
      { id:'pay_apr_tch3', schoolId:'sch1', teacherId:'tch3', month:'April', year:2025, payPeriod:'2025-04',
        basicSalary:160000, allowances:{housing:16000,transport:5000,medical:3000}, deductions:{paye:28500,nhif:1700,nssf:200,other:0},
        grossSalary:184000, netSalary:153600, status:'paid', paymentDate:'2025-04-28', paymentMethod:'bank_transfer', createdAt:'2025-04-25T00:00:00Z' },
      { id:'pay_apr_tch4', schoolId:'sch1', teacherId:'tch4', month:'April', year:2025, payPeriod:'2025-04',
        basicSalary:210000, allowances:{housing:21000,transport:5000,medical:3000}, deductions:{paye:46000,nhif:1700,nssf:200,other:0},
        grossSalary:239000, netSalary:191100, status:'paid', paymentDate:'2025-04-28', paymentMethod:'bank_transfer', createdAt:'2025-04-25T00:00:00Z' },
      { id:'pay_apr_tch5', schoolId:'sch1', teacherId:'tch5', month:'April', year:2025, payPeriod:'2025-04',
        basicSalary:145000, allowances:{housing:14500,transport:5000,medical:3000}, deductions:{paye:24500,nhif:1700,nssf:200,other:0},
        grossSalary:162500, netSalary:136100, status:'paid', paymentDate:'2025-04-28', paymentMethod:'bank_transfer', createdAt:'2025-04-25T00:00:00Z' },
      { id:'pay_apr_tch6', schoolId:'sch1', teacherId:'tch6', month:'April', year:2025, payPeriod:'2025-04',
        basicSalary:175000, allowances:{housing:17500,transport:5000,medical:3000}, deductions:{paye:33000,nhif:1700,nssf:200,other:0},
        grossSalary:195500, netSalary:160600, status:'paid', paymentDate:'2025-04-28', paymentMethod:'bank_transfer', createdAt:'2025-04-25T00:00:00Z' },
      { id:'pay_apr_tch7', schoolId:'sch1', teacherId:'tch7', month:'April', year:2025, payPeriod:'2025-04',
        basicSalary:140000, allowances:{housing:14000,transport:5000,medical:3000}, deductions:{paye:23000,nhif:1700,nssf:200,other:0},
        grossSalary:157000, netSalary:132100, status:'paid', paymentDate:'2025-04-28', paymentMethod:'bank_transfer', createdAt:'2025-04-25T00:00:00Z' },
      { id:'pay_apr_tch8', schoolId:'sch1', teacherId:'tch8', month:'April', year:2025, payPeriod:'2025-04',
        basicSalary:130000, allowances:{housing:13000,transport:5000,medical:3000}, deductions:{paye:20000,nhif:1700,nssf:200,other:0},
        grossSalary:148000, netSalary:126100, status:'paid', paymentDate:'2025-04-28', paymentMethod:'bank_transfer', createdAt:'2025-04-25T00:00:00Z' },
      /* May 2025 — drafted */
      { id:'pay_may_tch1', schoolId:'sch1', teacherId:'tch1', month:'May', year:2025, payPeriod:'2025-05',
        basicSalary:180000, allowances:{housing:18000,transport:5000,medical:3000}, deductions:{paye:35000,nhif:1700,nssf:200,other:0},
        grossSalary:206000, netSalary:169100, status:'draft', paymentDate:null, paymentMethod:'bank_transfer', createdAt:'2025-05-25T00:00:00Z' },
      { id:'pay_may_tch2', schoolId:'sch1', teacherId:'tch2', month:'May', year:2025, payPeriod:'2025-05',
        basicSalary:165000, allowances:{housing:16500,transport:5000,medical:3000}, deductions:{paye:30000,nhif:1700,nssf:200,other:0},
        grossSalary:189500, netSalary:157600, status:'draft', paymentDate:null, paymentMethod:'bank_transfer', createdAt:'2025-05-25T00:00:00Z' }
    ]);

    /* ─── HR DOCUMENTS ───────────────────────────────────────────────
       type: contract | appraisal | certificate | id_copy | other
    ─────────────────────────────────────────────────────────────── */
    set('hr_documents', [
      { id:'hrd001', schoolId:'sch1', teacherId:'tch1', type:'contract',   title:'Employment Contract – Sarah Smith',    fileName:'contract_tch1.pdf',  fileSize:'245 KB', uploadedBy:'u_admin1', expiryDate:null,         createdAt:'2021-01-10T00:00:00Z' },
      { id:'hrd002', schoolId:'sch1', teacherId:'tch1', type:'certificate', title:'M.Ed English Literature – Edinburgh',  fileName:'med_tch1.pdf',        fileSize:'1.2 MB', uploadedBy:'u_tch1',   expiryDate:null,         createdAt:'2021-01-10T00:00:00Z' },
      { id:'hrd003', schoolId:'sch1', teacherId:'tch2', type:'contract',   title:'Employment Contract – James Ochieng',  fileName:'contract_tch2.pdf',  fileSize:'240 KB', uploadedBy:'u_admin1', expiryDate:null,         createdAt:'2021-01-10T00:00:00Z' },
      { id:'hrd004', schoolId:'sch1', teacherId:'tch4', type:'contract',   title:'Employment Contract – Ahmed Hassan',   fileName:'contract_tch4.pdf',  fileSize:'238 KB', uploadedBy:'u_admin1', expiryDate:null,         createdAt:'2020-08-01T00:00:00Z' },
      { id:'hrd005', schoolId:'sch1', teacherId:'tch4', type:'certificate', title:'PhD Physics – University of Nairobi',  fileName:'phd_tch4.pdf',        fileSize:'2.1 MB', uploadedBy:'u_tch4',   expiryDate:null,         createdAt:'2020-08-01T00:00:00Z' },
      { id:'hrd006', schoolId:'sch1', teacherId:'tch6', type:'contract',   title:'Contract – Raj Patel (2-year)',         fileName:'contract_tch6.pdf',  fileSize:'220 KB', uploadedBy:'u_admin1', expiryDate:'2026-06-30', createdAt:'2022-06-01T00:00:00Z' },
      { id:'hrd007', schoolId:'sch1', teacherId:'tch3', type:'appraisal',  title:'Annual Appraisal 2024 – Priya Wanjiru',fileName:'appraisal_tch3_2024.pdf', fileSize:'180 KB', uploadedBy:'u_admin2', expiryDate:null, createdAt:'2024-12-01T00:00:00Z' },
      { id:'hrd008', schoolId:'sch1', teacherId:'tch1', type:'appraisal',  title:'Annual Appraisal 2024 – Sarah Smith',  fileName:'appraisal_tch1_2024.pdf', fileSize:'175 KB', uploadedBy:'u_admin2', expiryDate:null, createdAt:'2024-12-01T00:00:00Z' }
    ]);

    /* ── SUBSTITUTIONS (runtime data — starts empty) ── */
    set('substitutions', []);

    /* ── ROLE PERMISSIONS (default permission matrix — editable by Super Admin in Settings) ── */
    const _perms = (v,c,e,d,a) => ({ view:v, create:c, edit:e, delete:d, approve:a });
    const _full  = () => _perms(true,true,true,true,true);
    const _view  = () => _perms(true,false,false,false,false);
    const _none  = () => _perms(false,false,false,false,false);
    const _ve    = () => _perms(true,false,true,false,false);
    const _vec   = () => _perms(true,true,true,false,false);
    const _vea   = () => _perms(true,false,true,false,true);
    const _va    = () => _perms(true,false,false,false,true);

    /* Sub-module key lists — must match _SUB_MODULES in settings.js */
    const _SUBS = {
      admissions:    ['admissions.applications','admissions.bulk_upload','admissions.online_form','admissions.adm_settings'],
      students:      ['students.profile','students.subjects','students.grades','students.attendance','students.finance','students.medical','students.behavior'],
      teachers:      ['teachers.profile','teachers.classes','teachers.performance'],
      classes:       ['classes.roster','classes.enrollment'],
      subjects:      ['subjects.catalogue','subjects.assignments'],
      timetable:     ['timetable.view_tt','timetable.edit_tt','timetable.rules'],
      attendance:    ['attendance.mark','attendance.records','attendance.att_reports'],
      academics:     ['academics.gradebook','academics.report_cards','academics.lesson_plans','academics.grade_scales','academics.assessment_types'],
      exams:         ['exams.schedule','exams.announce','exams.results'],
      finance:       ['finance.invoices','finance.payments','finance.fee_structures','finance.fin_reports'],
      communication: ['communication.inbox','communication.send_msg'],
      events:        ['events.calendar','events.manage_events'],
      reports:       ['reports.rpt_academic','reports.rpt_finance','reports.rpt_attendance','reports.rpt_admissions'],
      hr:            ['hr.staff','hr.salary','hr.leave','hr.documents'],
      settings:      ['settings.school_info','settings.academic','settings.users','settings.roles','settings.sections','settings.system'],
      behaviour:     ['behaviour.dashboard','behaviour.log','behaviour.register','behaviour.detentions','behaviour.appeals','behaviour.settings'],
    };
    /* Build sub-module entries — default perm with optional per-key overrides */
    const _sub = (mod, def, ov={}) =>
      Object.fromEntries(_SUBS[mod].map(k => [k, ov[k] !== undefined ? ov[k] : {...def}]));

    const _roleDefaults = {
      /* ── SuperAdmin — full access to everything ── */
      superadmin: {
        dashboard:_full(),
        admissions:_full(),    ..._sub('admissions',_full()),
        students:_full(),      ..._sub('students',_full()),
        teachers:_full(),      ..._sub('teachers',_full()),
        classes:_full(),       ..._sub('classes',_full()),
        subjects:_full(),      ..._sub('subjects',_full()),
        timetable:_full(),     ..._sub('timetable',_full()),
        attendance:_full(),    ..._sub('attendance',_full()),
        academics:_full(),     ..._sub('academics',_full()),
        exams:_full(),         ..._sub('exams',_full()),
        finance:_full(),       ..._sub('finance',_full()),
        communication:_full(), ..._sub('communication',_full()),
        events:_full(),        ..._sub('events',_full()),
        reports:_full(),       ..._sub('reports',_full()),
        hr:_full(),            ..._sub('hr',_full()),
        settings:_full(),      ..._sub('settings',_full()),
        behaviour:_full(),     ..._sub('behaviour',_full()),
      },

      /* ── Principal (admin) ── */
      admin: {
        dashboard:_view(),
        admissions:_perms(true,true,true,false,true),
          ..._sub('admissions',_vec(),{
            'admissions.adm_settings':_view(),
          }),
        students:_ve(),
          ..._sub('students',_view(),{
            'students.profile':_ve(), 'students.behavior':_ve(),
          }),
        teachers:_ve(),
          ..._sub('teachers',_view(),{
            'teachers.profile':_ve(),
          }),
        classes:_vec(),        ..._sub('classes',_vec()),
        subjects:_vec(),       ..._sub('subjects',_vec()),
        timetable:_view(),
          ..._sub('timetable',_view(),{
            'timetable.edit_tt':_none(), 'timetable.rules':_none(),
          }),
        attendance:_view(),    ..._sub('attendance',_view()),
        academics:_view(),
          ..._sub('academics',_view(),{
            'academics.grade_scales':_vec(), 'academics.assessment_types':_vec(),
          }),
        exams:_va(),
          ..._sub('exams',_view(),{
            'exams.announce':_vec(), 'exams.results':_va(),
          }),
        finance:_view(),       ..._sub('finance',_view()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_vec(),         ..._sub('events',_vec()),
        reports:_view(),       ..._sub('reports',_view()),
        hr:_view(),            ..._sub('hr',_view()),
        settings:_ve(),
          ..._sub('settings',_view(),{
            'settings.school_info':_vec(), 'settings.academic':_vec(), 'settings.system':_none(),
          }),
        behaviour:_full(),
          ..._sub('behaviour',_full()),
      },

      /* ── Section Head ── */
      section_head: {
        dashboard:_view(),
        admissions:_vec(),
          ..._sub('admissions',_vec(),{
            'admissions.bulk_upload':_none(), 'admissions.adm_settings':_none(),
          }),
        students:_ve(),
          ..._sub('students',_view(),{
            'students.profile':_ve(), 'students.behavior':_ve(),
            'students.finance':_none(), 'students.medical':_none(),
          }),
        teachers:_ve(),
          ..._sub('teachers',_view(),{
            'teachers.profile':_ve(),
          }),
        classes:_ve(),         ..._sub('classes',_ve()),
        subjects:_view(),      ..._sub('subjects',_view()),
        timetable:_view(),
          ..._sub('timetable',_view(),{
            'timetable.edit_tt':_none(), 'timetable.rules':_none(),
          }),
        attendance:_view(),    ..._sub('attendance',_view()),
        academics:_ve(),
          ..._sub('academics',_view(),{
            'academics.gradebook':_vec(), 'academics.grade_scales':_view(), 'academics.assessment_types':_view(),
          }),
        exams:_view(),         ..._sub('exams',_view()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_vec(),         ..._sub('events',_vec()),
        reports:_view(),
          ..._sub('reports',_view(),{
            'reports.rpt_finance':_none(), 'reports.rpt_admissions':_none(),
          }),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_vec(),
          ..._sub('behaviour',_vec(),{
            'behaviour.settings':_none(), 'behaviour.appeals':_vec(),
          }),
      },

      /* ── Teacher ── */
      teacher: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_view(),
          ..._sub('students',_view(),{
            'students.grades':_vec(), 'students.finance':_none(), 'students.medical':_none(),
          }),
        teachers:_none(),
          ..._sub('teachers',_none(),{
            'teachers.profile':_view(), 'teachers.classes':_view(),
          }),
        classes:_view(),       ..._sub('classes',_view(),{'classes.enrollment':_none()}),
        subjects:_view(),      ..._sub('subjects',_view()),
        timetable:_view(),
          ..._sub('timetable',_view(),{
            'timetable.edit_tt':_none(), 'timetable.rules':_none(),
          }),
        attendance:_vec(),
          ..._sub('attendance',_vec(),{
            'attendance.att_reports':_view(),
          }),
        academics:_vec(),
          ..._sub('academics',_vec(),{
            'academics.report_cards':_view(), 'academics.grade_scales':_view(), 'academics.assessment_types':_view(),
          }),
        exams:_view(),         ..._sub('exams',_view()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_view(),        ..._sub('events',_view(),{'events.manage_events':_none()}),
        reports:_view(),
          ..._sub('reports',_view(),{
            'reports.rpt_finance':_none(), 'reports.rpt_admissions':_none(),
          }),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_vec(),
          ..._sub('behaviour',_vec(),{
            'behaviour.settings':_none(), 'behaviour.detentions':_view(),
            'behaviour.appeals':_vec(),
          }),
      },

      /* ── Admissions Officer ── */
      admissions_officer: {
        dashboard:_view(),
        admissions:_perms(true,true,true,false,true),
          ..._sub('admissions',_vec(),{
            'admissions.applications':_perms(true,true,true,false,true),
            'admissions.adm_settings':_none(),
          }),
        students:_view(),
          ..._sub('students',_none(),{
            'students.profile':_view(),
          }),
        teachers:_none(),      ..._sub('teachers',_none()),
        classes:_view(),       ..._sub('classes',_view(),{'classes.enrollment':_none()}),
        subjects:_none(),      ..._sub('subjects',_none()),
        timetable:_none(),     ..._sub('timetable',_none()),
        attendance:_none(),    ..._sub('attendance',_none()),
        academics:_none(),     ..._sub('academics',_none()),
        exams:_none(),         ..._sub('exams',_none()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_view(),        ..._sub('events',_view(),{'events.manage_events':_none()}),
        reports:_none(),
          ..._sub('reports',_none(),{
            'reports.rpt_admissions':_view(),
          }),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_none(),     ..._sub('behaviour',_none()),
      },

      /* ── Exams Officer ── */
      exams_officer: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_view(),
          ..._sub('students',_view(),{
            'students.finance':_none(), 'students.medical':_none(), 'students.behavior':_none(),
          }),
        teachers:_none(),
          ..._sub('teachers',_none(),{
            'teachers.profile':_view(), 'teachers.classes':_view(),
          }),
        classes:_view(),       ..._sub('classes',_view()),
        subjects:_view(),      ..._sub('subjects',_view()),
        timetable:_view(),     ..._sub('timetable',_view(),{'timetable.edit_tt':_none(),'timetable.rules':_none()}),
        attendance:_none(),    ..._sub('attendance',_none()),
        academics:_view(),
          ..._sub('academics',_view(),{
            'academics.gradebook':_view(), 'academics.lesson_plans':_none(),
          }),
        exams:_full(),         ..._sub('exams',_full()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_view(),        ..._sub('events',_view(),{'events.manage_events':_none()}),
        reports:_view(),
          ..._sub('reports',_view(),{
            'reports.rpt_finance':_none(), 'reports.rpt_attendance':_none(), 'reports.rpt_admissions':_none(),
          }),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_none(),     ..._sub('behaviour',_none()),
      },

      /* ── Finance ── */
      finance: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_view(),
          ..._sub('students',_none(),{
            'students.profile':_view(), 'students.finance':_view(),
          }),
        teachers:_none(),      ..._sub('teachers',_none()),
        classes:_none(),       ..._sub('classes',_none()),
        subjects:_none(),      ..._sub('subjects',_none()),
        timetable:_none(),     ..._sub('timetable',_none()),
        attendance:_none(),    ..._sub('attendance',_none()),
        academics:_none(),     ..._sub('academics',_none()),
        exams:_none(),         ..._sub('exams',_none()),
        finance:_perms(true,true,true,false,true), ..._sub('finance',_perms(true,true,true,false,true)),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_view(),        ..._sub('events',_view(),{'events.manage_events':_none()}),
        reports:_view(),
          ..._sub('reports',_none(),{
            'reports.rpt_finance':_view(),
          }),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_none(),     ..._sub('behaviour',_none()),
      },

      /* ── HR ── */
      hr: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_none(),      ..._sub('students',_none()),
        teachers:_vec(),
          ..._sub('teachers',_vec(),{
            'teachers.performance':_view(),
          }),
        classes:_none(),       ..._sub('classes',_none()),
        subjects:_none(),      ..._sub('subjects',_none()),
        timetable:_none(),     ..._sub('timetable',_none()),
        attendance:_none(),    ..._sub('attendance',_none()),
        academics:_none(),     ..._sub('academics',_none()),
        exams:_none(),         ..._sub('exams',_none()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_view(),        ..._sub('events',_view(),{'events.manage_events':_none()}),
        reports:_view(),
          ..._sub('reports',_none(),{
            'reports.rpt_attendance':_view(),
          }),
        hr:_full(),            ..._sub('hr',_full()),
        settings:_none(),
          ..._sub('settings',_none(),{
            'settings.users':_view(),
          }),
        behaviour:_none(),     ..._sub('behaviour',_none()),
      },

      /* ── Parent ── */
      parent: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_view(),
          ..._sub('students',_view(),{
            'students.medical':_none(), 'students.behavior':_none(),
          }),
        teachers:_none(),      ..._sub('teachers',_none()),
        classes:_none(),       ..._sub('classes',_none()),
        subjects:_none(),      ..._sub('subjects',_none()),
        timetable:_view(),     ..._sub('timetable',_view(),{'timetable.edit_tt':_none(),'timetable.rules':_none()}),
        attendance:_view(),
          ..._sub('attendance',_none(),{
            'attendance.records':_view(),
          }),
        academics:_view(),
          ..._sub('academics',_view(),{
            'academics.gradebook':_view(), 'academics.report_cards':_view(),
            'academics.lesson_plans':_none(), 'academics.grade_scales':_none(), 'academics.assessment_types':_none(),
          }),
        exams:_view(),
          ..._sub('exams',_view(),{'exams.announce':_none()}),
        finance:_view(),
          ..._sub('finance',_none(),{
            'finance.invoices':_view(), 'finance.payments':_view(),
          }),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_view(),        ..._sub('events',_view(),{'events.manage_events':_none()}),
        reports:_none(),       ..._sub('reports',_none()),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_view(),
          ..._sub('behaviour',_none(),{
            'behaviour.dashboard':_view(), 'behaviour.register':_view(),
            'behaviour.appeals':_vec(),
          }),
      },

      /* ── Timetabler — full timetable control, no other modules ── */
      timetabler: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_none(),      ..._sub('students',_none()),
        teachers:_none(),      ..._sub('teachers',_none()),
        classes:_view(),       ..._sub('classes',_view(),{'classes.enrollment':_none()}),
        subjects:_view(),      ..._sub('subjects',_view()),
        timetable:_full(),
          ..._sub('timetable',_full()),
        attendance:_none(),    ..._sub('attendance',_none()),
        academics:_none(),     ..._sub('academics',_none()),
        exams:_none(),         ..._sub('exams',_none()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_none(),        ..._sub('events',_none()),
        reports:_none(),       ..._sub('reports',_none()),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_none(),     ..._sub('behaviour',_none()),
      },

      /* ── Student ── */
      student: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_view(),
          ..._sub('students',_none(),{
            'students.profile':_view(), 'students.subjects':_view(),
            'students.grades':_view(), 'students.attendance':_view(),
          }),
        teachers:_none(),      ..._sub('teachers',_none()),
        classes:_none(),       ..._sub('classes',_none()),
        subjects:_none(),      ..._sub('subjects',_none()),
        timetable:_view(),     ..._sub('timetable',_view(),{'timetable.edit_tt':_none(),'timetable.rules':_none()}),
        attendance:_view(),
          ..._sub('attendance',_none(),{
            'attendance.records':_view(),
          }),
        academics:_view(),
          ..._sub('academics',_view(),{
            'academics.gradebook':_view(), 'academics.report_cards':_view(),
            'academics.lesson_plans':_none(), 'academics.grade_scales':_none(), 'academics.assessment_types':_none(),
          }),
        exams:_view(),         ..._sub('exams',_view()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_view(),        ..._sub('events',_view(),{'events.manage_events':_none()}),
        reports:_none(),       ..._sub('reports',_none()),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_view(),
          ..._sub('behaviour',_none(),{
            'behaviour.dashboard':_view(), 'behaviour.appeals':_vec(),
          }),
      },

      /* ── Deputy Principal — leads pastoral / discipline committee ── */
      deputy_principal: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_view(),
          ..._sub('students',_view(),{
            'students.finance':_none(), 'students.behavior':_vec(),
          }),
        teachers:_view(),      ..._sub('teachers',_view()),
        classes:_view(),       ..._sub('classes',_view(),{'classes.enrollment':_none()}),
        subjects:_none(),      ..._sub('subjects',_none()),
        timetable:_none(),     ..._sub('timetable',_none()),
        attendance:_view(),    ..._sub('attendance',_view(),{'attendance.mark':_none()}),
        academics:_view(),
          ..._sub('academics',_view(),{
            'academics.lesson_plans':_none(), 'academics.grade_scales':_none(), 'academics.assessment_types':_none(),
          }),
        exams:_none(),         ..._sub('exams',_none()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_vec(),         ..._sub('events',_vec()),
        reports:_view(),
          ..._sub('reports',_view(),{
            'reports.rpt_finance':_none(), 'reports.rpt_admissions':_none(),
          }),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_full(),
          ..._sub('behaviour',_full(),{
            'behaviour.settings':_view(),
          }),
      },

      /* ── Discipline Committee member ── */
      discipline_committee: {
        dashboard:_view(),
        admissions:_none(),    ..._sub('admissions',_none()),
        students:_view(),
          ..._sub('students',_view(),{
            'students.finance':_none(), 'students.medical':_view(), 'students.behavior':_vec(),
          }),
        teachers:_none(),
          ..._sub('teachers',_none(),{
            'teachers.profile':_view(), 'teachers.classes':_view(),
          }),
        classes:_view(),       ..._sub('classes',_view(),{'classes.enrollment':_none()}),
        subjects:_none(),      ..._sub('subjects',_none()),
        timetable:_none(),     ..._sub('timetable',_none()),
        attendance:_none(),    ..._sub('attendance',_none()),
        academics:_none(),     ..._sub('academics',_none()),
        exams:_none(),         ..._sub('exams',_none()),
        finance:_none(),       ..._sub('finance',_none()),
        communication:_vec(),  ..._sub('communication',_vec()),
        events:_view(),        ..._sub('events',_view(),{'events.manage_events':_none()}),
        reports:_view(),
          ..._sub('reports',_none(),{
            'reports.rpt_attendance':_view(), 'reports.rpt_academic':_view(),
          }),
        hr:_none(),            ..._sub('hr',_none()),
        settings:_none(),      ..._sub('settings',_none()),
        behaviour:_vec(),
          ..._sub('behaviour',_vec(),{
            'behaviour.settings':_none(),
          }),
      },
    };

    const _roleLabels = {
      superadmin:'Super Admin', admin:'Principal', section_head:'Section Head',
      teacher:'Teacher', admissions_officer:'Admissions Officer', exams_officer:'Exams Officer',
      finance:'Finance', hr:'HR', timetabler:'Timetabler', parent:'Parent', student:'Student',
      deputy_principal:'Deputy Principal', discipline_committee:'Discipline Committee'
    };
    const _roleColors = {
      superadmin:'#DC2626', admin:'#2563EB', section_head:'#7C3AED', teacher:'#059669',
      admissions_officer:'#D97706', exams_officer:'#0891B2', finance:'#BE185D',
      hr:'#64748B', timetabler:'#8B5CF6', parent:'#16A34A', student:'#F59E0B',
      deputy_principal:'#0F172A', discipline_committee:'#BE123C'
    };

    set('role_permissions', Object.entries(_roleDefaults).map(([roleKey, permissions]) => ({
      id:`rp_${roleKey}`, schoolId:'sch1', roleKey, roleName:_roleLabels[roleKey]||roleKey,
      color:_roleColors[roleKey]||'#64748B',
      isSystem:['superadmin','parent','student'].includes(roleKey),
      permissions
    })));

    /* AUDIT LOG — starts empty; populated at runtime */
    if (!DB.get('audit_log').length) set('audit_log', []);

    _markSeeded();
    console.log('InnoLearn seed data loaded (v' + SEED_VERSION + ').');
  }

  return { get, getById, query, insert, update, delete: remove, set, reset, isSeeded, seed,
           syncFromServer, pushToServer, setToken, clearToken };
})();

/* Auto-seed on first load or when version changes */
if (!DB.isSeeded()) DB.seed();

/* ============================================================
   SchoolContext — Live accessor for the current school record,
   term, and academic year.  Replaces all hardcoded 'term2' /
   'ay2025' fallbacks throughout the app.
   ============================================================ */
const SchoolContext = (() => {
  /** Raw school record (first record in schools collection) */
  function school() {
    return DB.get('schools')[0] || {};
  }

  /** ID of the currently active term, e.g. 'term2' */
  function currentTermId() {
    return school().currentTermId || '';
  }

  /** ID of the current academic year, e.g. 'ay2025' */
  function currentAcYearId() {
    return school().currentAcademicYearId || '';
  }

  /** Full term object for the currently active term */
  function currentTerm() {
    return DB.getById('terms', currentTermId()) || {};
  }

  /** Full academic year object for the current year */
  function currentAcYear() {
    return DB.getById('academicYears', currentAcYearId()) || {};
  }

  return { school, currentTermId, currentAcYearId, currentTerm, currentAcYear };
})();

/* ============================================================
   ENUMS — Canonical value sets for every status/type field.
   Always read from here; never use string literals inline.
   ============================================================ */
const ENUMS = Object.freeze({
  studentStatus:      ['active','inactive','graduated','transferred','withdrawn'],
  incidentType:       ['merit','demerit'],
  appealStatus:       ['pending','escalated','accepted','rejected'],
  invoiceStatus:      ['unpaid','partial','paid','overdue'],
  attendanceStatus:   ['present','absent','late','excused'],
  applicationStatus:  ['inquiry','application','review','interview','decision','enrolled','rejected','draft'],
  gender:             ['Male','Female','Other','Prefer not to say'],
  paymentMethod:      ['cash','bank_transfer','mpesa','cheque','online','other'],
  userRole: [
    'superadmin','admin','teacher','section_head','deputy_principal',
    'discipline_committee','finance','parent','student',
    'admissions_officer','exams_officer','hr','timetabler'
  ],
  examStatus:         ['scheduled','in_progress','completed','cancelled'],
  leaveStatus:        ['pending','approved','rejected'],
  payrollStatus:      ['draft','processed','paid'],
});
