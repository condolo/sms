/* ============================================================
   Msingi — Demo School Full Data Seed
   Populates realistic data ONLY into the demo school (sch_demo).
   Every other school is completely untouched.

   DATA SCOPE (insert-only — never overwrites existing records):
   ─────────────────────────────────────────────────────────────
   • 9 classes  (3 Primary: Std 4A-6A, 4 Secondary: Form 1A-4A, 2 A-Level: Form 5A-6A)
   • 18 subjects (14 core + 4 A-Level: Pure Maths, Mechanics, Stats, Economics)
   • 9 additional teachers (+ the existing u_demo_teacher)
   • 20 students distributed across all classes
   • 25 behaviour incidents (merits + demerits)
   • 20 fee invoices — Term 2 2026
   • 14 payments  (mix: fully paid, partial, outstanding)
   • 205 timetable slots (7 classes, full week)
   • 8 admissions at various pipeline stages
   • 96 class-subject links (curriculum per class)
   • ~163 student-subject enrollments
   • 4 subject enrollment rules (min/max per section)
   • 12 library books + 8 loans (3 active, 2 overdue, 3 returned)   [v4.30.0]
   • 3 transport routes + 8 student assignments                      [v4.30.0]
   • 2 hostels + 6 rooms + 6 active residents                        [v4.30.0]
   ============================================================ */
'use strict';

const crypto   = require('crypto');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const SCHOOL_ID = 'sch_demo';
const YEAR      = new Date().getFullYear();
const AY_ID     = `ay_${SCHOOL_ID}_${YEAR}`;
const T2_ID     = 't2_demo';
const SEC_PRI   = `sec_primary_${SCHOOL_ID}`;
const SEC_SEC   = `sec_secondary_${SCHOOL_ID}`;
const SEC_AL    = `sec_alevel_${SCHOOL_ID}`;
const ADMIN_ID  = 'u_demo_admin';

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

function upsert(Model, id, data) {
  // Insert-only: creates if not exists, skips if already there.
  return Model.updateOne(
    { id },
    { $setOnInsert: { id, schoolId: SCHOOL_ID, ...data } },
    { upsert: true }
  );
}

/* ── Shared hashed password for demo teachers ─────────────────── */
let _demoHash = null;
async function _hash() {
  if (!_demoHash) _demoHash = await bcrypt.hash('Demo2025!', 10);
  return _demoHash;
}

/* ════════════════════════════════════════════════════════════════
   STATIC REFERENCE DATA
════════════════════════════════════════════════════════════════ */

/* ── Classes ── */
const CLASSES = [
  { id:'cls_demo_4a',  name:'Standard 4A', year:'Standard 4', sectionId:SEC_PRI, sectionKey:'primary',   order:1, status:'active' },
  { id:'cls_demo_5a',  name:'Standard 5A', year:'Standard 5', sectionId:SEC_PRI, sectionKey:'primary',   order:2, status:'active' },
  { id:'cls_demo_6a',  name:'Standard 6A', year:'Standard 6', sectionId:SEC_PRI, sectionKey:'primary',   order:3, status:'active' },
  { id:'cls_demo_f1a', name:'Form 1A',     year:'Form 1',     sectionId:SEC_SEC, sectionKey:'secondary', order:4, status:'active' },
  { id:'cls_demo_f2a', name:'Form 2A',     year:'Form 2',     sectionId:SEC_SEC, sectionKey:'secondary', order:5, status:'active' },
  { id:'cls_demo_f3a', name:'Form 3A',     year:'Form 3',     sectionId:SEC_SEC, sectionKey:'secondary', order:6, status:'active' },
  { id:'cls_demo_f4a', name:'Form 4A',     year:'Form 4',     sectionId:SEC_SEC, sectionKey:'secondary', order:7, status:'active' },
  { id:'cls_demo_f5a', name:'Form 5A',     year:'Form 5',     sectionId:SEC_AL,  sectionKey:'alevel',    order:8, status:'active' },
  { id:'cls_demo_f6a', name:'Form 6A',     year:'Form 6',     sectionId:SEC_AL,  sectionKey:'alevel',    order:9, status:'active' },
];

/* ── Departments ── */
const DEPARTMENTS = [
  { id:'dept_demo_lang', name:'Languages',                    code:'LANG', color:'#0EA5E9', order:1, hodName:'Ms. Agnes Otieno',    hodId:'tch_demo_3',  hodUserId:'u_demo_t3',  description:'English Language and Kiswahili' },
  { id:'dept_demo_math', name:'Mathematics',                  code:'MATH', color:'#6366F1', order:2, hodName:'Mr. Peter Kamau',     hodId:'tch_demo_2',  hodUserId:'u_demo_t2',  description:'Pure and applied mathematics' },
  { id:'dept_demo_sci',  name:'Sciences',                     code:'SCI',  color:'#10B981', order:3, hodName:'Ms. Judith Njoroge',  hodId:'tch_demo_5',  hodUserId:'u_demo_t5',  description:'Physics, Chemistry, Biology and integrated Science' },
  { id:'dept_demo_hum',  name:'Humanities',                   code:'HUM',  color:'#F59E0B', order:4, hodName:'Ms. Dorothy Chebet',  hodId:'tch_demo_7',  hodUserId:'u_demo_t7',  description:'History, Geography, Social Studies and Religious Education' },
  { id:'dept_demo_tbs',  name:'Technical & Business Studies', code:'TBS',  color:'#F97316', order:5, hodName:'Mr. Samuel Maina',    hodId:'tch_demo_8',  hodUserId:'u_demo_t8',  description:'Business Studies and ICT' },
  { id:'dept_demo_pe',   name:'Physical Education',           code:'PE',   color:'#EC4899', order:6, hodName:'Mr. Joseph Kipchoge', hodId:'tch_demo_10', hodUserId:'u_demo_t10', description:'PE, Sports and Games' },
];

/* ── Subjects (with departmentId, sections array, isCompulsory) ── */
const SUBJECTS = [
  /* ── Offered at all levels ─────────────────────────────────── */
  { id:'subj_demo_math', name:'Mathematics',              code:'MATH',  departmentId:'dept_demo_math', sections:['all'],                      isCompulsory:true  },
  { id:'subj_demo_eng',  name:'English Language',         code:'ENG',   departmentId:'dept_demo_lang', sections:['all'],                      isCompulsory:true  },
  { id:'subj_demo_kisw', name:'Kiswahili',                code:'KSW',   departmentId:'dept_demo_lang', sections:['all'],                      isCompulsory:true  },
  { id:'subj_demo_cre',  name:'CRE',                      code:'CRE',   departmentId:'dept_demo_hum',  sections:['all'],                      isCompulsory:false },
  { id:'subj_demo_pe',   name:'PE & Sports',              code:'PE',    departmentId:'dept_demo_pe',   sections:['all'],                      isCompulsory:false },
  { id:'subj_demo_ict',  name:'ICT',                      code:'ICT',   departmentId:'dept_demo_tbs',  sections:['all'],                      isCompulsory:false },
  /* ── Primary only ──────────────────────────────────────────── */
  { id:'subj_demo_sci',  name:'Science',                  code:'SCI',   departmentId:'dept_demo_sci',  sections:['primary'],                  isCompulsory:true  },
  { id:'subj_demo_ss',   name:'Social Studies',           code:'SS',    departmentId:'dept_demo_hum',  sections:['primary'],                  isCompulsory:false },
  /* ── Secondary + A-Level ───────────────────────────────────── */
  { id:'subj_demo_phy',  name:'Physics',                  code:'PHY',   departmentId:'dept_demo_sci',  sections:['secondary','alevel'],       isCompulsory:false },
  { id:'subj_demo_chem', name:'Chemistry',                code:'CHEM',  departmentId:'dept_demo_sci',  sections:['secondary','alevel'],       isCompulsory:false },
  { id:'subj_demo_bio',  name:'Biology',                  code:'BIO',   departmentId:'dept_demo_sci',  sections:['secondary','alevel'],       isCompulsory:false },
  { id:'subj_demo_hist', name:'History & Government',     code:'HIST',  departmentId:'dept_demo_hum',  sections:['secondary','alevel'],       isCompulsory:false },
  { id:'subj_demo_geo',  name:'Geography',                code:'GEO',   departmentId:'dept_demo_hum',  sections:['secondary','alevel'],       isCompulsory:false },
  { id:'subj_demo_bs',   name:'Business Studies',         code:'BS',    departmentId:'dept_demo_tbs',  sections:['secondary','alevel'],       isCompulsory:false },
  /* ── A-Level only ──────────────────────────────────────────── */
  { id:'subj_demo_pmath',name:'Pure Mathematics',         code:'PMATH', departmentId:'dept_demo_math', sections:['alevel'],                   isCompulsory:false },
  { id:'subj_demo_mech', name:'Mechanics',                code:'MECH',  departmentId:'dept_demo_math', sections:['alevel'],                   isCompulsory:false },
  { id:'subj_demo_stat', name:'Statistics & Probability', code:'STAT',  departmentId:'dept_demo_math', sections:['alevel'],                   isCompulsory:false },
  { id:'subj_demo_eco',  name:'Economics',                code:'ECO',   departmentId:'dept_demo_tbs',  sections:['alevel'],                   isCompulsory:false },
];

/* ── Additional teachers (9 — u_demo_teacher already exists) ── */
const EXTRA_TEACHERS = [
  { id:'u_demo_t2',  name:'Mr. Peter Kamau',      email:'pkamau@demo.msingi.io',    subjects:['subj_demo_math','subj_demo_sci'] },
  { id:'u_demo_t3',  name:'Ms. Agnes Otieno',     email:'aotieno@demo.msingi.io',   subjects:['subj_demo_eng','subj_demo_cre']  },
  { id:'u_demo_t4',  name:'Mr. Collins Waweru',   email:'cwaweru@demo.msingi.io',   subjects:['subj_demo_kisw','subj_demo_ss']  },
  { id:'u_demo_t5',  name:'Ms. Judith Njoroge',   email:'jnjoroge@demo.msingi.io',  subjects:['subj_demo_phy','subj_demo_chem'] },
  { id:'u_demo_t6',  name:'Mr. Francis Ochieng',  email:'fochieng@demo.msingi.io',  subjects:['subj_demo_bio','subj_demo_sci']  },
  { id:'u_demo_t7',  name:'Ms. Dorothy Chebet',   email:'dchebet@demo.msingi.io',   subjects:['subj_demo_hist','subj_demo_geo'] },
  { id:'u_demo_t8',  name:'Mr. Samuel Maina',     email:'smaina@demo.msingi.io',    subjects:['subj_demo_bs','subj_demo_cre']   },
  { id:'u_demo_t9',  name:'Ms. Lilian Wairimu',   email:'lwairimu@demo.msingi.io',  subjects:['subj_demo_ict','subj_demo_math'] },
  { id:'u_demo_t10', name:'Mr. Joseph Kipchoge',  email:'jkipchoge@demo.msingi.io', subjects:['subj_demo_pe','subj_demo_ss']    },
];

/* ── Teacher profiles for the teachers collection ── */
const TEACHER_PROFILES = [
  { id:'tch_demo_1',  userId:'u_demo_teacher', firstName:'Demo',    lastName:'Teacher',  title:'Mr.',  email:'teacher@demo.msingi.io', gender:'male',   staffId:'TCH-001', staffType:'teacher', departmentId:'dept_demo_math', subjects:['subj_demo_math'],                                      contractType:'full_time', status:'active',   joinDate:'2024-01-15', extraRoles:[] },
  { id:'tch_demo_2',  userId:'u_demo_t2',      firstName:'Peter',   lastName:'Kamau',    title:'Mr.',  email:'pkamau@demo.msingi.io',   gender:'male',   staffId:'TCH-002', staffType:'teacher', departmentId:'dept_demo_math', subjects:['subj_demo_math','subj_demo_pmath','subj_demo_mech','subj_demo_stat'], contractType:'full_time', status:'active',   joinDate:'2023-09-01', extraRoles:['hod'] },
  { id:'tch_demo_3',  userId:'u_demo_t3',      firstName:'Agnes',   lastName:'Otieno',   title:'Ms.',  email:'aotieno@demo.msingi.io',  gender:'female', staffId:'TCH-003', staffType:'teacher', departmentId:'dept_demo_lang', subjects:['subj_demo_eng','subj_demo_cre'],                         contractType:'full_time', status:'active',   joinDate:'2022-01-10', extraRoles:['hod','class_teacher'], formClassId:'cls_demo_f1a' },
  { id:'tch_demo_4',  userId:'u_demo_t4',      firstName:'Collins', lastName:'Waweru',   title:'Mr.',  email:'cwaweru@demo.msingi.io',  gender:'male',   staffId:'TCH-004', staffType:'teacher', departmentId:'dept_demo_lang', subjects:['subj_demo_kisw','subj_demo_ss'],                         contractType:'full_time', status:'active',   joinDate:'2023-01-05', extraRoles:[] },
  { id:'tch_demo_5',  userId:'u_demo_t5',      firstName:'Judith',  lastName:'Njoroge',  title:'Ms.',  email:'jnjoroge@demo.msingi.io', gender:'female', staffId:'TCH-005', staffType:'teacher', departmentId:'dept_demo_sci',  subjects:['subj_demo_phy','subj_demo_chem'],                        contractType:'full_time', status:'active',   joinDate:'2021-08-20', extraRoles:['hod','exam_officer'] },
  { id:'tch_demo_6',  userId:'u_demo_t6',      firstName:'Francis', lastName:'Ochieng',  title:'Mr.',  email:'fochieng@demo.msingi.io', gender:'male',   staffId:'TCH-006', staffType:'teacher', departmentId:'dept_demo_sci',  subjects:['subj_demo_bio','subj_demo_sci'],                         contractType:'full_time', status:'active',   joinDate:'2022-09-01', extraRoles:[] },
  { id:'tch_demo_7',  userId:'u_demo_t7',      firstName:'Dorothy', lastName:'Chebet',   title:'Ms.',  email:'dchebet@demo.msingi.io',  gender:'female', staffId:'TCH-007', staffType:'teacher', departmentId:'dept_demo_hum',  subjects:['subj_demo_hist','subj_demo_geo'],                        contractType:'full_time', status:'on_leave', joinDate:'2020-03-01', extraRoles:['hod','timetabler'] },
  { id:'tch_demo_8',  userId:'u_demo_t8',      firstName:'Samuel',  lastName:'Maina',    title:'Mr.',  email:'smaina@demo.msingi.io',   gender:'male',   staffId:'TCH-008', staffType:'teacher', departmentId:'dept_demo_tbs',  subjects:['subj_demo_bs','subj_demo_cre','subj_demo_eco'],          contractType:'full_time', status:'active',   joinDate:'2023-04-10', extraRoles:['hod'] },
  { id:'tch_demo_9',  userId:'u_demo_t9',      firstName:'Lilian',  lastName:'Wairimu',  title:'Ms.',  email:'lwairimu@demo.msingi.io', gender:'female', staffId:'TCH-009', staffType:'teacher', departmentId:'dept_demo_tbs',  subjects:['subj_demo_ict','subj_demo_math'],                        contractType:'full_time', status:'active',   joinDate:'2024-02-01', extraRoles:[] },
  { id:'tch_demo_10', userId:'u_demo_t10',     firstName:'Joseph',  lastName:'Kipchoge', title:'Mr.',  email:'jkipchoge@demo.msingi.io',gender:'male',   staffId:'TCH-010', staffType:'teacher', departmentId:'dept_demo_pe',   subjects:['subj_demo_pe','subj_demo_ss'],                           contractType:'full_time', status:'active',   joinDate:'2021-09-01', extraRoles:['hod'] },
];

/* ── Students (20) ── */
const STUDENTS = [
  /* Form 1A */
  { id:'std_demo_1',  firstName:'Amara',     lastName:'Osei',       gender:'female', classId:'cls_demo_f1a', sectionId:SEC_SEC, dob:'2012-03-14', parent:'Mrs. Abena Osei',    pEmail:'abena.osei@gmail.com',   pPhone:'+254 712 001 001', adm:'ADM-2026-00001', status:'active',   fees:35000, paid:35000 },
  { id:'std_demo_2',  firstName:'James',     lastName:'Mwangi',     gender:'male',   classId:'cls_demo_f1a', sectionId:SEC_SEC, dob:'2012-07-22', parent:'Mr. John Mwangi',    pEmail:'john.mwangi@gmail.com',  pPhone:'+254 722 001 002', adm:'ADM-2026-00002', status:'active',   fees:35000, paid:17500 },
  { id:'std_demo_3',  firstName:'Fatima',    lastName:'Al-Hassan',  gender:'female', classId:'cls_demo_f1a', sectionId:SEC_SEC, dob:'2012-11-05', parent:'Mr. Hassan Omar',    pEmail:'hassan.omar@gmail.com',  pPhone:'+254 733 001 003', adm:'ADM-2026-00003', status:'active',   fees:35000, paid:0     },
  /* Form 2A */
  { id:'std_demo_4',  firstName:'David',     lastName:'Mutai',      gender:'male',   classId:'cls_demo_f2a', sectionId:SEC_SEC, dob:'2011-05-18', parent:'Mr. Kipchoge Mutai', pEmail:'kipchoge.mutai@yahoo.com',pPhone:'+254 722 002 001', adm:'ADM-2025-00012', status:'active',   fees:35000, paid:35000 },
  { id:'std_demo_5',  firstName:'Grace',     lastName:'Waweru',     gender:'female', classId:'cls_demo_f2a', sectionId:SEC_SEC, dob:'2011-09-30', parent:'Mr. Peter Waweru',  pEmail:'peter.waweru@gmail.com', pPhone:'+254 711 002 002', adm:'ADM-2025-00015', status:'active',   fees:35000, paid:35000 },
  { id:'std_demo_6',  firstName:'Samuel',    lastName:'Karimi',     gender:'male',   classId:'cls_demo_f2a', sectionId:SEC_SEC, dob:'2011-02-14', parent:'Ms. Jane Karimi',   pEmail:'jane.karimi@gmail.com',  pPhone:'+254 755 002 003', adm:'ADM-2025-00018', status:'active',   fees:35000, paid:20000 },
  /* Form 3A */
  { id:'std_demo_7',  firstName:'Naledi',    lastName:'Dlamini',    gender:'female', classId:'cls_demo_f3a', sectionId:SEC_SEC, dob:'2010-06-12', parent:'Mr. Bongani Dlamini',pEmail:'bongani.dlamini@gmail.com',pPhone:'+254 700 003 001', adm:'ADM-2024-00007', status:'active',   fees:38000, paid:38000 },
  { id:'std_demo_8',  firstName:'Kevin',     lastName:'Kamau',      gender:'male',   classId:'cls_demo_f3a', sectionId:SEC_SEC, dob:'2010-10-04', parent:'Ms. Lucy Kamau',    pEmail:'lucy.kamau@gmail.com',   pPhone:'+254 721 003 002', adm:'ADM-2024-00009', status:'active',   fees:38000, paid:38000 },
  { id:'std_demo_9',  firstName:'Aisha',     lastName:'Mombasa',    gender:'female', classId:'cls_demo_f3a', sectionId:SEC_SEC, dob:'2010-01-27', parent:'Mr. Ali Mombasa',   pEmail:'ali.mombasa@gmail.com',  pPhone:'+254 733 003 003', adm:'ADM-2024-00011', status:'active',   fees:38000, paid:19000 },
  /* Form 4A */
  { id:'std_demo_10', firstName:'Brian',     lastName:'Onyango',    gender:'male',   classId:'cls_demo_f4a', sectionId:SEC_SEC, dob:'2009-08-16', parent:'Mr. Otieno Onyango',pEmail:'otieno.onyango@yahoo.com', pPhone:'+254 722 004 001', adm:'ADM-2023-00003', status:'active',   fees:40000, paid:40000 },
  { id:'std_demo_11', firstName:'Miriam',    lastName:'Gitau',      gender:'female', classId:'cls_demo_f4a', sectionId:SEC_SEC, dob:'2009-04-09', parent:'Dr. Paul Gitau',    pEmail:'paul.gitau@gmail.com',   pPhone:'+254 711 004 002', adm:'ADM-2023-00005', status:'active',   fees:40000, paid:40000 },
  /* Standard 4A */
  { id:'std_demo_12', firstName:'Josphat',   lastName:'Kiplagat',   gender:'male',   classId:'cls_demo_4a',  sectionId:SEC_PRI, dob:'2015-03-22', parent:'Mr. Kibet Kiplagat',pEmail:'kibet.kiplagat@gmail.com', pPhone:'+254 722 005 001', adm:'ADM-2026-00010', status:'active',   fees:22000, paid:22000 },
  { id:'std_demo_13', firstName:'Faith',     lastName:'Mwangi',     gender:'female', classId:'cls_demo_4a',  sectionId:SEC_PRI, dob:'2015-07-11', parent:'Mr. George Mwangi', pEmail:'george.mwangi@yahoo.com', pPhone:'+254 733 005 002', adm:'ADM-2026-00011', status:'active',   fees:22000, paid:11000 },
  { id:'std_demo_14', firstName:'Solomon',   lastName:'Auma',       gender:'male',   classId:'cls_demo_4a',  sectionId:SEC_PRI, dob:'2015-11-08', parent:'Mrs. Beatrice Auma',pEmail:'beatrice.auma@gmail.com', pPhone:'+254 700 005 003', adm:'ADM-2026-00012', status:'active',   fees:22000, paid:0     },
  /* Standard 5A */
  { id:'std_demo_15', firstName:'Patience',  lastName:'Adhiambo',   gender:'female', classId:'cls_demo_5a',  sectionId:SEC_PRI, dob:'2014-05-19', parent:'Mr. Ouma Adhiambo', pEmail:'ouma.adhiambo@gmail.com', pPhone:'+254 711 006 001', adm:'ADM-2025-00030', status:'active',   fees:22000, paid:22000 },
  { id:'std_demo_16', firstName:'Michael',   lastName:'Njenga',     gender:'male',   classId:'cls_demo_5a',  sectionId:SEC_PRI, dob:'2014-02-03', parent:'Mr. Charles Njenga',pEmail:'charles.njenga@gmail.com', pPhone:'+254 722 006 002', adm:'ADM-2025-00032', status:'active',   fees:22000, paid:22000 },
  { id:'std_demo_17', firstName:'Rose',      lastName:'Kamau',      gender:'female', classId:'cls_demo_5a',  sectionId:SEC_PRI, dob:'2014-08-25', parent:'Mr. Anthony Kamau', pEmail:'anthony.kamau@yahoo.com', pPhone:'+254 733 006 003', adm:'ADM-2025-00035', status:'active',   fees:22000, paid:15000 },
  /* Standard 6A */
  { id:'std_demo_18', firstName:'Joseph',    lastName:'Omondi',     gender:'male',   classId:'cls_demo_6a',  sectionId:SEC_PRI, dob:'2013-01-14', parent:'Mrs. Mary Omondi',  pEmail:'mary.omondi@gmail.com',   pPhone:'+254 722 007 001', adm:'ADM-2024-00022', status:'active',   fees:24000, paid:24000 },
  { id:'std_demo_19', firstName:'Christine', lastName:'Chebet',     gender:'female', classId:'cls_demo_6a',  sectionId:SEC_PRI, dob:'2013-05-30', parent:'Mr. Ruto Chebet',   pEmail:'ruto.chebet@gmail.com',   pPhone:'+254 711 007 002', adm:'ADM-2024-00025', status:'active',   fees:24000, paid:24000 },
  { id:'std_demo_20', firstName:'Emmanuel',  lastName:'Wekesa',     gender:'male',   classId:'cls_demo_6a',  sectionId:SEC_PRI, dob:'2013-09-17', parent:'Mr. Daniel Wekesa', pEmail:'daniel.wekesa@gmail.com', pPhone:'+254 700 007 003', adm:'ADM-2024-00028', status:'active',   fees:24000, paid:12000 },
];

/* ── Behaviour incidents ── */
const now = new Date().toISOString();
const d = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

const BEHAVIOUR = [
  { id:'beh_demo_1',  studentId:'std_demo_1',  type:'merit',   severity:null,     title:'Outstanding Academic Performance', description:'Achieved top score in Mathematics end-of-term test — 98%.', points:10, date:d(5) },
  { id:'beh_demo_2',  studentId:'std_demo_2',  type:'demerit', severity:'low',    title:'Late Arrival',                     description:'Arrived 20 minutes late without a valid reason.',           points:-3, date:d(8) },
  { id:'beh_demo_3',  studentId:'std_demo_3',  type:'demerit', severity:'medium', title:'Missing Homework (3 times)',        description:'Failed to submit homework assignments three consecutive weeks.', points:-5, date:d(10) },
  { id:'beh_demo_4',  studentId:'std_demo_4',  type:'merit',   severity:null,     title:'Sports Achievement',               description:'Represented school in regional athletics and won silver medal.', points:15, date:d(3) },
  { id:'beh_demo_5',  studentId:'std_demo_5',  type:'merit',   severity:null,     title:'Community Service',                description:'Volunteered to lead school clean-up drive during Environmental Day.', points:8, date:d(12) },
  { id:'beh_demo_6',  studentId:'std_demo_6',  type:'demerit', severity:'medium', title:'Disruptive Behaviour in Class',    description:'Repeatedly disrupted Mathematics lesson — warned twice by teacher.', points:-5, date:d(6) },
  { id:'beh_demo_7',  studentId:'std_demo_7',  type:'merit',   severity:null,     title:'Subject Prize — Chemistry',        description:'Highest scoring student in Chemistry mid-term examination.',  points:12, date:d(14) },
  { id:'beh_demo_8',  studentId:'std_demo_8',  type:'demerit', severity:'low',    title:'Uniform Violation',                description:'Found out of school uniform on two occasions this term.',    points:-2, date:d(9) },
  { id:'beh_demo_9',  studentId:'std_demo_9',  type:'demerit', severity:'high',   title:'Bullying Incident',               description:'Involved in intimidation of a younger student — parent notified.', points:-15, date:d(20) },
  { id:'beh_demo_10', studentId:'std_demo_9',  type:'neutral', severity:null,     title:'Counselling Session Completed',   description:'Completed mandatory counselling following earlier bullying incident.', points:0, date:d(15) },
  { id:'beh_demo_11', studentId:'std_demo_10', type:'merit',   severity:null,     title:'Prefect — Head Boy',              description:'Elected Head Boy by student body and appointed by principal.',points:20, date:d(45) },
  { id:'beh_demo_12', studentId:'std_demo_11', type:'merit',   severity:null,     title:'Debate Team Captain',             description:'Led school debate team to win inter-school championships.',   points:15, date:d(30) },
  { id:'beh_demo_13', studentId:'std_demo_12', type:'merit',   severity:null,     title:'Perfect Attendance — Term 1',     description:'Achieved full attendance for the entire Term 1 2026.',       points:5,  date:d(21) },
  { id:'beh_demo_14', studentId:'std_demo_13', type:'demerit', severity:'low',    title:'Lost Library Book',               description:'Failed to return library book for 4 weeks — replacement required.', points:-3, date:d(7) },
  { id:'beh_demo_15', studentId:'std_demo_14', type:'demerit', severity:'medium', title:'Fighting',                       description:'Involved in physical altercation during break — suspended 1 day.', points:-10, date:d(18) },
  { id:'beh_demo_16', studentId:'std_demo_15', type:'merit',   severity:null,     title:'Art & Design Prize',             description:'First place in Primary Art Competition — county level.',      points:10, date:d(25) },
  { id:'beh_demo_17', studentId:'std_demo_16', type:'demerit', severity:'low',    title:'Incomplete Classwork',           description:'Left Science assignment incomplete twice this term.',         points:-3, date:d(11) },
  { id:'beh_demo_18', studentId:'std_demo_17', type:'merit',   severity:null,     title:'Academic Improvement',           description:'Improved overall grade from C to B+ over the last term.',    points:8,  date:d(4) },
  { id:'beh_demo_19', studentId:'std_demo_18', type:'merit',   severity:null,     title:'Eco Club President',             description:'Founded and leads the school Eco Club — 45 members.',        points:12, date:d(60) },
  { id:'beh_demo_20', studentId:'std_demo_19', type:'demerit', severity:'low',    title:'Talking During Assembly',        description:'Reprimanded for talking during morning assembly.',            points:-2, date:d(13) },
  { id:'beh_demo_21', studentId:'std_demo_20', type:'merit',   severity:null,     title:'Helped Classmate with Revision', description:'Organised peer tutoring sessions for Std 6 students.',       points:6,  date:d(16) },
  { id:'beh_demo_22', studentId:'std_demo_2',  type:'demerit', severity:'medium', title:'Phone in Class',                 description:'Caught using phone during English lesson — phone confiscated.', points:-5, date:d(22) },
  { id:'beh_demo_23', studentId:'std_demo_6',  type:'merit',   severity:null,     title:'Science Fair Project',           description:'Won 2nd place at school science fair — built water filtration model.', points:10, date:d(35) },
  { id:'beh_demo_24', studentId:'std_demo_1',  type:'merit',   severity:null,     title:'Peer Mentoring',                 description:'Actively mentoring two Form 1 students in Mathematics.',      points:8,  date:d(28) },
  { id:'beh_demo_25', studentId:'std_demo_10', type:'merit',   severity:null,     title:'KCSE Mock Excellence',           description:'Scored 80+ points in KCSE mock examination — top of form.',  points:25, date:d(40) },
];

/* ── Timetable — Form 1A full week ── */
const PERIODS_SEC = ['1','2','3','Break','4','5','6'];
const PERIODS_PRI = ['1','2','Break','3','4','5'];

const F1A_TIMETABLE = [
  // Monday
  { day:'monday',    period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F1A' },
  { day:'monday',    period:'2', periodNumber:2, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F1A' },
  { day:'monday',    period:'3', periodNumber:3, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F1A' },
  { day:'monday',    period:'4', periodNumber:4, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'F1A' },
  { day:'monday',    period:'5', periodNumber:5, subjectId:'subj_demo_hist', subject:'History & Government',teacherId:'u_demo_t7',  room:'F1A' },
  { day:'monday',    period:'6', periodNumber:6, subjectId:'subj_demo_pe',   subject:'PE & Sports',         teacherId:'u_demo_t10', room:'Field' },
  // Tuesday
  { day:'tuesday',   period:'1', periodNumber:1, subjectId:'subj_demo_phy',  subject:'Physics',             teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'tuesday',   period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F1A' },
  { day:'tuesday',   period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F1A' },
  { day:'tuesday',   period:'4', periodNumber:4, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'tuesday',   period:'5', periodNumber:5, subjectId:'subj_demo_geo',  subject:'Geography',           teacherId:'u_demo_t7',  room:'F1A' },
  { day:'tuesday',   period:'6', periodNumber:6, subjectId:'subj_demo_ict',  subject:'ICT',                 teacherId:'u_demo_t9',  room:'Computer Lab' },
  // Wednesday
  { day:'wednesday', period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F1A' },
  { day:'wednesday', period:'2', periodNumber:2, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F1A' },
  { day:'wednesday', period:'3', periodNumber:3, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'wednesday', period:'4', periodNumber:4, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F1A' },
  { day:'wednesday', period:'5', periodNumber:5, subjectId:'subj_demo_bs',   subject:'Business Studies',    teacherId:'u_demo_t8',  room:'F1A' },
  { day:'wednesday', period:'6', periodNumber:6, subjectId:'subj_demo_cre',  subject:'CRE',                 teacherId:'u_demo_t3',  room:'F1A' },
  // Thursday
  { day:'thursday',  period:'1', periodNumber:1, subjectId:'subj_demo_phy',  subject:'Physics',             teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'thursday',  period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F1A' },
  { day:'thursday',  period:'3', periodNumber:3, subjectId:'subj_demo_hist', subject:'History & Government',teacherId:'u_demo_t7',  room:'F1A' },
  { day:'thursday',  period:'4', periodNumber:4, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F1A' },
  { day:'thursday',  period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',                 teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'thursday',  period:'6', periodNumber:6, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  // Friday
  { day:'friday',    period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F1A' },
  { day:'friday',    period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F1A' },
  { day:'friday',    period:'3', periodNumber:3, subjectId:'subj_demo_geo',  subject:'Geography',           teacherId:'u_demo_t7',  room:'F1A' },
  { day:'friday',    period:'4', periodNumber:4, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'friday',    period:'5', periodNumber:5, subjectId:'subj_demo_bs',   subject:'Business Studies',    teacherId:'u_demo_t8',  room:'F1A' },
  { day:'friday',    period:'6', periodNumber:6, subjectId:'subj_demo_pe',   subject:'PE & Sports',         teacherId:'u_demo_t10', room:'Field' },
];

const STD4A_TIMETABLE = [
  { day:'monday',    period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P4A' },
  { day:'monday',    period:'2', periodNumber:2, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P4A' },
  { day:'monday',    period:'3', periodNumber:3, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P4A' },
  { day:'monday',    period:'4', periodNumber:4, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P4A' },
  { day:'monday',    period:'5', periodNumber:5, subjectId:'subj_demo_pe',   subject:'PE & Sports',      teacherId:'u_demo_t10', room:'Field' },
  { day:'tuesday',   period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P4A' },
  { day:'tuesday',   period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P4A' },
  { day:'tuesday',   period:'3', periodNumber:3, subjectId:'subj_demo_ss',   subject:'Social Studies',   teacherId:'u_demo_t10', room:'P4A' },
  { day:'tuesday',   period:'4', periodNumber:4, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P4A' },
  { day:'tuesday',   period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',              teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'wednesday', period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P4A' },
  { day:'wednesday', period:'2', periodNumber:2, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P4A' },
  { day:'wednesday', period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P4A' },
  { day:'wednesday', period:'4', periodNumber:4, subjectId:'subj_demo_cre',  subject:'CRE',              teacherId:'u_demo_t3',  room:'P4A' },
  { day:'wednesday', period:'5', periodNumber:5, subjectId:'subj_demo_ss',   subject:'Social Studies',   teacherId:'u_demo_t10', room:'P4A' },
  { day:'thursday',  period:'1', periodNumber:1, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P4A' },
  { day:'thursday',  period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P4A' },
  { day:'thursday',  period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P4A' },
  { day:'thursday',  period:'4', periodNumber:4, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P4A' },
  { day:'thursday',  period:'5', periodNumber:5, subjectId:'subj_demo_pe',   subject:'PE & Sports',      teacherId:'u_demo_t10', room:'Field' },
  { day:'friday',    period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P4A' },
  { day:'friday',    period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P4A' },
  { day:'friday',    period:'3', periodNumber:3, subjectId:'subj_demo_ss',   subject:'Social Studies',   teacherId:'u_demo_t10', room:'P4A' },
  { day:'friday',    period:'4', periodNumber:4, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P4A' },
  { day:'friday',    period:'5', periodNumber:5, subjectId:'subj_demo_cre',  subject:'CRE',              teacherId:'u_demo_t3',  room:'P4A' },
];

/* ── Timetable — Standard 5A (primary, 5 lesson periods/day) ── */
const STD5A_TIMETABLE = [
  { day:'monday',    period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P5A' },
  { day:'monday',    period:'2', periodNumber:2, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P5A' },
  { day:'monday',    period:'3', periodNumber:3, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P5A' },
  { day:'monday',    period:'4', periodNumber:4, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P5A' },
  { day:'monday',    period:'5', periodNumber:5, subjectId:'subj_demo_pe',   subject:'PE & Sports',      teacherId:'u_demo_t10', room:'Field' },
  { day:'tuesday',   period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P5A' },
  { day:'tuesday',   period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P5A' },
  { day:'tuesday',   period:'3', periodNumber:3, subjectId:'subj_demo_ss',   subject:'Social Studies',   teacherId:'u_demo_t10', room:'P5A' },
  { day:'tuesday',   period:'4', periodNumber:4, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P5A' },
  { day:'tuesday',   period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',              teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'wednesday', period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t9',  room:'P5A' },
  { day:'wednesday', period:'2', periodNumber:2, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P5A' },
  { day:'wednesday', period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P5A' },
  { day:'wednesday', period:'4', periodNumber:4, subjectId:'subj_demo_cre',  subject:'CRE',              teacherId:'u_demo_t8',  room:'P5A' },
  { day:'wednesday', period:'5', periodNumber:5, subjectId:'subj_demo_ss',   subject:'Social Studies',   teacherId:'u_demo_t10', room:'P5A' },
  { day:'thursday',  period:'1', periodNumber:1, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P5A' },
  { day:'thursday',  period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P5A' },
  { day:'thursday',  period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P5A' },
  { day:'thursday',  period:'4', periodNumber:4, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P5A' },
  { day:'thursday',  period:'5', periodNumber:5, subjectId:'subj_demo_pe',   subject:'PE & Sports',      teacherId:'u_demo_t10', room:'Field' },
  { day:'friday',    period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P5A' },
  { day:'friday',    period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P5A' },
  { day:'friday',    period:'3', periodNumber:3, subjectId:'subj_demo_ss',   subject:'Social Studies',   teacherId:'u_demo_t10', room:'P5A' },
  { day:'friday',    period:'4', periodNumber:4, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P5A' },
  { day:'friday',    period:'5', periodNumber:5, subjectId:'subj_demo_cre',  subject:'CRE',              teacherId:'u_demo_t8',  room:'P5A' },
];

/* ── Timetable — Standard 6A (primary, 5 lesson periods/day) ── */
const STD6A_TIMETABLE = [
  { day:'monday',    period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P6A' },
  { day:'monday',    period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t9',  room:'P6A' },
  { day:'monday',    period:'3', periodNumber:3, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P6A' },
  { day:'monday',    period:'4', periodNumber:4, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P6A' },
  { day:'monday',    period:'5', periodNumber:5, subjectId:'subj_demo_pe',   subject:'PE & Sports',      teacherId:'u_demo_t10', room:'Field' },
  { day:'tuesday',   period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t9',  room:'P6A' },
  { day:'tuesday',   period:'2', periodNumber:2, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P6A' },
  { day:'tuesday',   period:'3', periodNumber:3, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P6A' },
  { day:'tuesday',   period:'4', periodNumber:4, subjectId:'subj_demo_ss',   subject:'Social Studies',   teacherId:'u_demo_t10', room:'P6A' },
  { day:'tuesday',   period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',              teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'wednesday', period:'1', periodNumber:1, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P6A' },
  { day:'wednesday', period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P6A' },
  { day:'wednesday', period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P6A' },
  { day:'wednesday', period:'4', periodNumber:4, subjectId:'subj_demo_ss',   subject:'Social Studies',   teacherId:'u_demo_t10', room:'P6A' },
  { day:'wednesday', period:'5', periodNumber:5, subjectId:'subj_demo_cre',  subject:'CRE',              teacherId:'u_demo_t8',  room:'P6A' },
  { day:'thursday',  period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P6A' },
  { day:'thursday',  period:'2', periodNumber:2, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P6A' },
  { day:'thursday',  period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P6A' },
  { day:'thursday',  period:'4', periodNumber:4, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P6A' },
  { day:'thursday',  period:'5', periodNumber:5, subjectId:'subj_demo_pe',   subject:'PE & Sports',      teacherId:'u_demo_t10', room:'Field' },
  { day:'friday',    period:'1', periodNumber:1, subjectId:'subj_demo_sci',  subject:'Science',          teacherId:'u_demo_t6',  room:'P6A' },
  { day:'friday',    period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',      teacherId:'u_demo_t2',  room:'P6A' },
  { day:'friday',    period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language', teacherId:'u_demo_t3',  room:'P6A' },
  { day:'friday',    period:'4', periodNumber:4, subjectId:'subj_demo_kisw', subject:'Kiswahili',        teacherId:'u_demo_t4',  room:'P6A' },
  { day:'friday',    period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',              teacherId:'u_demo_t9',  room:'Computer Lab' },
];

/* ── Timetable — Form 2A (secondary, 6 lesson periods/day) ── */
const F2A_TIMETABLE = [
  { day:'monday',    period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F2A' },
  { day:'monday',    period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t9',  room:'F2A' },
  { day:'monday',    period:'3', periodNumber:3, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F2A' },
  { day:'monday',    period:'4', periodNumber:4, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'monday',    period:'5', periodNumber:5, subjectId:'subj_demo_hist', subject:'History & Government',teacherId:'u_demo_t7',  room:'F2A' },
  { day:'monday',    period:'6', periodNumber:6, subjectId:'subj_demo_pe',   subject:'PE & Sports',         teacherId:'u_demo_t10', room:'Field' },
  { day:'tuesday',   period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t9',  room:'F2A' },
  { day:'tuesday',   period:'2', periodNumber:2, subjectId:'subj_demo_phy',  subject:'Physics',             teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'tuesday',   period:'3', periodNumber:3, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'tuesday',   period:'4', periodNumber:4, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F2A' },
  { day:'tuesday',   period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',                 teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'tuesday',   period:'6', periodNumber:6, subjectId:'subj_demo_bs',   subject:'Business Studies',    teacherId:'u_demo_t8',  room:'F2A' },
  { day:'wednesday', period:'1', periodNumber:1, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F2A' },
  { day:'wednesday', period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t9',  room:'F2A' },
  { day:'wednesday', period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F2A' },
  { day:'wednesday', period:'4', periodNumber:4, subjectId:'subj_demo_hist', subject:'History & Government',teacherId:'u_demo_t7',  room:'F2A' },
  { day:'wednesday', period:'5', periodNumber:5, subjectId:'subj_demo_geo',  subject:'Geography',           teacherId:'u_demo_t7',  room:'F2A' },
  { day:'wednesday', period:'6', periodNumber:6, subjectId:'subj_demo_cre',  subject:'CRE',                 teacherId:'u_demo_t8',  room:'F2A' },
  { day:'thursday',  period:'1', periodNumber:1, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'thursday',  period:'2', periodNumber:2, subjectId:'subj_demo_phy',  subject:'Physics',             teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'thursday',  period:'3', periodNumber:3, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t9',  room:'F2A' },
  { day:'thursday',  period:'4', periodNumber:4, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F2A' },
  { day:'thursday',  period:'5', periodNumber:5, subjectId:'subj_demo_bs',   subject:'Business Studies',    teacherId:'u_demo_t8',  room:'F2A' },
  { day:'thursday',  period:'6', periodNumber:6, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'friday',    period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t9',  room:'F2A' },
  { day:'friday',    period:'2', periodNumber:2, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F2A' },
  { day:'friday',    period:'3', periodNumber:3, subjectId:'subj_demo_geo',  subject:'Geography',           teacherId:'u_demo_t7',  room:'F2A' },
  { day:'friday',    period:'4', periodNumber:4, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'friday',    period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',                 teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'friday',    period:'6', periodNumber:6, subjectId:'subj_demo_pe',   subject:'PE & Sports',         teacherId:'u_demo_t10', room:'Field' },
];

/* ── Timetable — Form 3A (secondary, 6 lesson periods/day) ── */
const F3A_TIMETABLE = [
  { day:'monday',    period:'1', periodNumber:1, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F3A' },
  { day:'monday',    period:'2', periodNumber:2, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F3A' },
  { day:'monday',    period:'3', periodNumber:3, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'monday',    period:'4', periodNumber:4, subjectId:'subj_demo_geo',  subject:'Geography',           teacherId:'u_demo_t7',  room:'F3A' },
  { day:'monday',    period:'5', periodNumber:5, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F3A' },
  { day:'monday',    period:'6', periodNumber:6, subjectId:'subj_demo_pe',   subject:'PE & Sports',         teacherId:'u_demo_t10', room:'Field' },
  { day:'tuesday',   period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F3A' },
  { day:'tuesday',   period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F3A' },
  { day:'tuesday',   period:'3', periodNumber:3, subjectId:'subj_demo_phy',  subject:'Physics',             teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'tuesday',   period:'4', periodNumber:4, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'tuesday',   period:'5', periodNumber:5, subjectId:'subj_demo_bs',   subject:'Business Studies',    teacherId:'u_demo_t8',  room:'F3A' },
  { day:'tuesday',   period:'6', periodNumber:6, subjectId:'subj_demo_ict',  subject:'ICT',                 teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'wednesday', period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F3A' },
  { day:'wednesday', period:'2', periodNumber:2, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'wednesday', period:'3', periodNumber:3, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F3A' },
  { day:'wednesday', period:'4', periodNumber:4, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F3A' },
  { day:'wednesday', period:'5', periodNumber:5, subjectId:'subj_demo_hist', subject:'History & Government',teacherId:'u_demo_t7',  room:'F3A' },
  { day:'wednesday', period:'6', periodNumber:6, subjectId:'subj_demo_cre',  subject:'CRE',                 teacherId:'u_demo_t8',  room:'F3A' },
  { day:'thursday',  period:'1', periodNumber:1, subjectId:'subj_demo_phy',  subject:'Physics',             teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'thursday',  period:'2', periodNumber:2, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'thursday',  period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F3A' },
  { day:'thursday',  period:'4', periodNumber:4, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F3A' },
  { day:'thursday',  period:'5', periodNumber:5, subjectId:'subj_demo_geo',  subject:'Geography',           teacherId:'u_demo_t7',  room:'F3A' },
  { day:'thursday',  period:'6', periodNumber:6, subjectId:'subj_demo_bs',   subject:'Business Studies',    teacherId:'u_demo_t8',  room:'F3A' },
  { day:'friday',    period:'1', periodNumber:1, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'friday',    period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F3A' },
  { day:'friday',    period:'3', periodNumber:3, subjectId:'subj_demo_hist', subject:'History & Government',teacherId:'u_demo_t7',  room:'F3A' },
  { day:'friday',    period:'4', periodNumber:4, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F3A' },
  { day:'friday',    period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',                 teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'friday',    period:'6', periodNumber:6, subjectId:'subj_demo_pe',   subject:'PE & Sports',         teacherId:'u_demo_t10', room:'Field' },
];

/* ── Timetable — Form 4A (secondary, 6 lesson periods/day) ── */
const F4A_TIMETABLE = [
  { day:'monday',    period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F4A' },
  { day:'monday',    period:'2', periodNumber:2, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'monday',    period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F4A' },
  { day:'monday',    period:'4', periodNumber:4, subjectId:'subj_demo_hist', subject:'History & Government',teacherId:'u_demo_t7',  room:'F4A' },
  { day:'monday',    period:'5', periodNumber:5, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'monday',    period:'6', periodNumber:6, subjectId:'subj_demo_pe',   subject:'PE & Sports',         teacherId:'u_demo_t10', room:'Field' },
  { day:'tuesday',   period:'1', periodNumber:1, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F4A' },
  { day:'tuesday',   period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F4A' },
  { day:'tuesday',   period:'3', periodNumber:3, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F4A' },
  { day:'tuesday',   period:'4', periodNumber:4, subjectId:'subj_demo_phy',  subject:'Physics',             teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'tuesday',   period:'5', periodNumber:5, subjectId:'subj_demo_geo',  subject:'Geography',           teacherId:'u_demo_t7',  room:'F4A' },
  { day:'tuesday',   period:'6', periodNumber:6, subjectId:'subj_demo_bs',   subject:'Business Studies',    teacherId:'u_demo_t8',  room:'F4A' },
  { day:'wednesday', period:'1', periodNumber:1, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F4A' },
  { day:'wednesday', period:'2', periodNumber:2, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F4A' },
  { day:'wednesday', period:'3', periodNumber:3, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'wednesday', period:'4', periodNumber:4, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'wednesday', period:'5', periodNumber:5, subjectId:'subj_demo_ict',  subject:'ICT',                 teacherId:'u_demo_t9',  room:'Computer Lab' },
  { day:'wednesday', period:'6', periodNumber:6, subjectId:'subj_demo_hist', subject:'History & Government',teacherId:'u_demo_t7',  room:'F4A' },
  { day:'thursday',  period:'1', periodNumber:1, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F4A' },
  { day:'thursday',  period:'2', periodNumber:2, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F4A' },
  { day:'thursday',  period:'3', periodNumber:3, subjectId:'subj_demo_kisw', subject:'Kiswahili',           teacherId:'u_demo_t4',  room:'F4A' },
  { day:'thursday',  period:'4', periodNumber:4, subjectId:'subj_demo_geo',  subject:'Geography',           teacherId:'u_demo_t7',  room:'F4A' },
  { day:'thursday',  period:'5', periodNumber:5, subjectId:'subj_demo_phy',  subject:'Physics',             teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'thursday',  period:'6', periodNumber:6, subjectId:'subj_demo_cre',  subject:'CRE',                 teacherId:'u_demo_t8',  room:'F4A' },
  { day:'friday',    period:'1', periodNumber:1, subjectId:'subj_demo_bs',   subject:'Business Studies',    teacherId:'u_demo_t8',  room:'F4A' },
  { day:'friday',    period:'2', periodNumber:2, subjectId:'subj_demo_bio',  subject:'Biology',             teacherId:'u_demo_t6',  room:'Lab 2' },
  { day:'friday',    period:'3', periodNumber:3, subjectId:'subj_demo_math', subject:'Mathematics',         teacherId:'u_demo_t2',  room:'F4A' },
  { day:'friday',    period:'4', periodNumber:4, subjectId:'subj_demo_eng',  subject:'English Language',    teacherId:'u_demo_t3',  room:'F4A' },
  { day:'friday',    period:'5', periodNumber:5, subjectId:'subj_demo_chem', subject:'Chemistry',           teacherId:'u_demo_t5',  room:'Lab 1' },
  { day:'friday',    period:'6', periodNumber:6, subjectId:'subj_demo_pe',   subject:'PE & Sports',         teacherId:'u_demo_t10', room:'Field' },
];

/* ── Admissions pipeline (8 applicants in various stages) ── */
const ADMISSIONS = [
  { id:'adm_demo_1', firstName:'Lena',    lastName:'Korir',    stage:'application', applyingForClass:'Form 1A', ref:'APP-2026-001', notes:'Applied online via website.',           stageDate:d(14), phone:'+254 712 100 001', email:'lena.korir@gmail.com',    priority:false },
  { id:'adm_demo_2', firstName:'Mark',    lastName:'Simiyu',   stage:'application', applyingForClass:'Form 1A', ref:'APP-2026-002', notes:'Parent visited school and was given form.', stageDate:d(10), phone:'+254 733 100 002', email:'mark.simiyu@yahoo.com',   priority:false },
  { id:'adm_demo_3', firstName:'Stacy',   lastName:'Nkirote',  stage:'assessment',  applyingForClass:'Form 2A', ref:'APP-2026-003', notes:'Assessment scheduled for next Monday.',   stageDate:d(7),  phone:'+254 722 100 003', email:'stacy.nkirote@gmail.com', priority:true  },
  { id:'adm_demo_4', firstName:'Patrick', lastName:'Otieno',   stage:'offer',       applyingForClass:'Form 3A', ref:'APP-2026-004', notes:'Offer letter sent. Awaiting acceptance.',stageDate:d(3),  phone:'+254 711 100 004', email:'patrick.otieno@gmail.com',priority:true  },
  { id:'adm_demo_5', firstName:'Wanjiru', lastName:'Njambi',   stage:'offer',       applyingForClass:'Standard 4A', ref:'APP-2026-005', notes:'Transfer from Nairobi Primary. Offer sent.', stageDate:d(5), phone:'+254 700 100 005', email:'wanjiru.njambi@gmail.com',priority:false },
  { id:'adm_demo_6', firstName:'Abdi',    lastName:'Warsame',  stage:'enrolled',    applyingForClass:'Form 1A', ref:'APP-2026-006', notes:'Fully enrolled. Student record created.', stageDate:d(21), phone:'+254 733 100 006', email:'abdi.warsame@gmail.com',  priority:false },
  { id:'adm_demo_7', firstName:'Cynthia', lastName:'Momanyi',  stage:'enrolled',    applyingForClass:'Standard 5A', ref:'APP-2026-007', notes:'Enrolled mid-term. All docs received.', stageDate:d(30), phone:'+254 722 100 007', email:'cynthia.momanyi@gmail.com',priority:false },
  { id:'adm_demo_8', firstName:'Daniel',  lastName:'Barasa',   stage:'enquiry',     applyingForClass:'Form 4A', ref:'APP-2026-008', notes:'Initial enquiry — brochure sent by email.', stageDate:d(2), phone:'+254 711 100 008', email:'daniel.barasa@gmail.com', priority:false },
];

/* ── Class-curriculum: which subjects each class offers ────────
   isCompulsoryForClass = all students in this class must take it.
   Elective = false: visible for enrollment but not auto-assigned.
   ────────────────────────────────────────────────────────────── */
const _cs = (classId, subjectId, isCompulsoryForClass) => ({ classId, subjectId, isCompulsoryForClass });

const CLASS_SUBJECTS = [
  /* Primary — Standard 4A, 5A, 6A (identical curriculum) */
  ...['cls_demo_4a','cls_demo_5a','cls_demo_6a'].flatMap(c => [
    _cs(c,'subj_demo_math',true),  _cs(c,'subj_demo_eng',true),
    _cs(c,'subj_demo_kisw',true),  _cs(c,'subj_demo_sci',true),
    _cs(c,'subj_demo_ss',  true),  _cs(c,'subj_demo_cre',true),
    _cs(c,'subj_demo_pe',  true),  _cs(c,'subj_demo_ict',false),
  ]),
  /* Secondary — Form 1A, 2A (compulsory core + electives) */
  ...['cls_demo_f1a','cls_demo_f2a'].flatMap(c => [
    _cs(c,'subj_demo_math',true),  _cs(c,'subj_demo_eng',true),
    _cs(c,'subj_demo_kisw',true),  _cs(c,'subj_demo_phy',true),
    _cs(c,'subj_demo_chem',true),  _cs(c,'subj_demo_bio',true),
    _cs(c,'subj_demo_hist',true),  _cs(c,'subj_demo_cre',true),
    _cs(c,'subj_demo_geo', false), _cs(c,'subj_demo_bs', false),
    _cs(c,'subj_demo_ict', false), _cs(c,'subj_demo_pe', false),
  ]),
  /* Secondary — Form 3A, 4A (KCSE: 3 compulsory + electives → 8 total) */
  ...['cls_demo_f3a','cls_demo_f4a'].flatMap(c => [
    _cs(c,'subj_demo_math',true),  _cs(c,'subj_demo_eng',true),
    _cs(c,'subj_demo_kisw',true),  _cs(c,'subj_demo_phy', false),
    _cs(c,'subj_demo_chem',false), _cs(c,'subj_demo_bio', false),
    _cs(c,'subj_demo_hist',false), _cs(c,'subj_demo_geo', false),
    _cs(c,'subj_demo_bs',  false), _cs(c,'subj_demo_cre', false),
    _cs(c,'subj_demo_ict', false), _cs(c,'subj_demo_pe',  false),
  ]),
  /* A-Level — Form 5A, 6A (all elective; rules min 3 max 4) */
  ...['cls_demo_f5a','cls_demo_f6a'].flatMap(c => [
    _cs(c,'subj_demo_pmath',false), _cs(c,'subj_demo_mech', false),
    _cs(c,'subj_demo_stat', false), _cs(c,'subj_demo_eco',  false),
    _cs(c,'subj_demo_phy',  false), _cs(c,'subj_demo_chem', false),
    _cs(c,'subj_demo_bio',  false), _cs(c,'subj_demo_hist', false),
    _cs(c,'subj_demo_geo',  false), _cs(c,'subj_demo_bs',   false),
    _cs(c,'subj_demo_eng',  false), _cs(c,'subj_demo_ict',  false),
  ]),
];

/* ── Subject enrollment rules — min/max per section (like bell schedule) ── */
const SUBJECT_RULES = [
  { id:'sr_demo_primary',    section:'primary',    minSubjects:6, maxSubjects:8,  notes:'CBC Primary — compulsory core is 7; ICT optional' },
  { id:'sr_demo_secondary1', section:'secondary',  minSubjects:7, maxSubjects:10, notes:'Form 1-2: all 8 compulsory + optional extras' },
  { id:'sr_demo_kcse',       classPattern:'f[34]', minSubjects:7, maxSubjects:9,  notes:'KCSE Form 3-4: 3 core + min 4 electives = 7 min, 9 max' },
  { id:'sr_demo_alevel',     section:'alevel',     minSubjects:3, maxSubjects:4,  notes:'A-Level: minimum 3, maximum 4 subjects per student' },
];

/* ── Student subject enrollments (existing 20 demo students) ────
   Format: { students[], classId, subjects[] }
   Compulsory subjects + realistic elective choices.
   ─────────────────────────────────────────────────────────────── */
const ENROLLMENTS = [
  /* Form 1A — full compulsory block */
  { students:['std_demo_1','std_demo_2','std_demo_3'], classId:'cls_demo_f1a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_phy','subj_demo_chem','subj_demo_bio','subj_demo_hist','subj_demo_cre'] },
  /* Form 2A — full compulsory block + Geography elective */
  { students:['std_demo_4','std_demo_5'], classId:'cls_demo_f2a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_phy','subj_demo_chem','subj_demo_bio','subj_demo_hist','subj_demo_cre','subj_demo_geo'] },
  { students:['std_demo_6'], classId:'cls_demo_f2a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_phy','subj_demo_chem','subj_demo_bio','subj_demo_hist','subj_demo_cre','subj_demo_bs'] },
  /* Form 3A — 3 core + 5 electives = 8 (KCSE sciences track) */
  { students:['std_demo_7','std_demo_8'], classId:'cls_demo_f3a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_phy','subj_demo_chem','subj_demo_bio','subj_demo_hist','subj_demo_geo'] },
  { students:['std_demo_9'], classId:'cls_demo_f3a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_phy','subj_demo_chem','subj_demo_bio','subj_demo_bs','subj_demo_cre'] },
  /* Form 4A — 8 KCSE subjects */
  { students:['std_demo_10','std_demo_11'], classId:'cls_demo_f4a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_phy','subj_demo_chem','subj_demo_bio','subj_demo_geo','subj_demo_hist'] },
  /* Primary Std 4A — 7 compulsory + ICT */
  { students:['std_demo_12','std_demo_13','std_demo_14'], classId:'cls_demo_4a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_sci','subj_demo_ss','subj_demo_cre','subj_demo_pe','subj_demo_ict'] },
  /* Primary Std 5A — same */
  { students:['std_demo_15','std_demo_16','std_demo_17'], classId:'cls_demo_5a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_sci','subj_demo_ss','subj_demo_cre','subj_demo_pe','subj_demo_ict'] },
  /* Primary Std 6A — same */
  { students:['std_demo_18','std_demo_19','std_demo_20'], classId:'cls_demo_6a',
    subjects:['subj_demo_math','subj_demo_eng','subj_demo_kisw','subj_demo_sci','subj_demo_ss','subj_demo_cre','subj_demo_pe','subj_demo_ict'] },
];

/* ── Library books (12) ──────────────────────────────────────── */
/* available = copies minus any active/overdue loans */
const LIBRARY_BOOKS = [
  { id:'lb_demo_1',  title:'A Grain of Wheat',                  author:'Ngũgĩ wa Thiongʼo',        isbn:'978-0-141-18679-2', category:'Literature',  copies:4, available:3, location:'Shelf A1', publisher:'Heinemann',  publishYear:1967 },
  { id:'lb_demo_2',  title:'Things Fall Apart',                  author:'Chinua Achebe',              isbn:'978-0-385-47454-2', category:'Literature',  copies:5, available:4, location:'Shelf A1', publisher:'Heinemann',  publishYear:1958 },
  { id:'lb_demo_3',  title:'Weep Not, Child',                    author:'Ngũgĩ wa Thiongʼo',        isbn:'978-0-141-18681-5', category:'Literature',  copies:3, available:3, location:'Shelf A2', publisher:'Heinemann',  publishYear:1964 },
  { id:'lb_demo_4',  title:'KCSE Mathematics Revision Guide',    author:'S. K. Mwakisha',             isbn:'',                  category:'Mathematics', copies:8, available:7, location:'Shelf B1', publisher:'EAEP',       publishYear:2022 },
  { id:'lb_demo_5',  title:'Biology for Secondary Schools',      author:'Nzomo Mutuku',               isbn:'978-9966-47-200-1', category:'Sciences',    copies:6, available:5, location:'Shelf C1', publisher:'EAEP',       publishYear:2021 },
  { id:'lb_demo_6',  title:'Secondary Chemistry Book 4',         author:'J. Njoroge & M. Weru',       isbn:'978-9966-47-131-8', category:'Sciences',    copies:5, available:4, location:'Shelf C2', publisher:'EAEP',       publishYear:2020 },
  { id:'lb_demo_7',  title:'The River Between',                  author:'Ngũgĩ wa Thiongʼo',        isbn:'978-0-435-90162-8', category:'Literature',  copies:3, available:3, location:'Shelf A2', publisher:'Heinemann',  publishYear:1965 },
  { id:'lb_demo_8',  title:'History of East Africa',             author:'B. A. Ogot',                 isbn:'',                  category:'History',     copies:4, available:4, location:'Shelf D1', publisher:'EAEP',       publishYear:2019 },
  { id:'lb_demo_9',  title:'Physics for High Schools',           author:'J. K. Kariuki',              isbn:'978-9966-47-090-8', category:'Sciences',    copies:6, available:6, location:'Shelf C3', publisher:'EAEP',       publishYear:2021 },
  { id:'lb_demo_10', title:'Mastering English Grammar',          author:'R. Thomson & A. Martinet',   isbn:'978-0-19-431343-3', category:'Languages',   copies:4, available:4, location:'Shelf E1', publisher:'OUP',        publishYear:1986 },
  { id:'lb_demo_11', title:'Business Studies Simplified',        author:'P. Kimondo',                 isbn:'978-9966-47-175-2', category:'Business',    copies:5, available:5, location:'Shelf F1', publisher:'EAEP',       publishYear:2022 },
  { id:'lb_demo_12', title:'Oxford Atlas for East Africa',       author:'Oxford University Press',    isbn:'978-0-19-849870-0', category:'Geography',   copies:3, available:3, location:'Shelf D2', publisher:'OUP',        publishYear:2020 },
];

/* ── Library loans (8) — 3 active, 2 overdue, 3 returned ──────
   Active   → lb_demo_1 (std_demo_1), lb_demo_4 (std_demo_4), lb_demo_5 (std_demo_7)
   Overdue  → lb_demo_2 (std_demo_2, 15 days), lb_demo_6 (std_demo_8, 10 days)
   Returned → lb_demo_3, lb_demo_7, lb_demo_9
   ─────────────────────────────────────────────────────────────── */
const futureDue = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const pastDue   = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

const LIBRARY_LOANS = [
  /* Active */
  { id:'ll_demo_1', bookId:'lb_demo_1', bookTitle:'A Grain of Wheat',               borrowerId:'std_demo_1',  borrowerType:'student', borrowerName:'Amara Osei',         borrowerClass:'Form 1A',     issuedAt:d(7),  dueDate:futureDue(7),  status:'active',   fineAmount:0,   finePaid:false },
  { id:'ll_demo_2', bookId:'lb_demo_4', bookTitle:'KCSE Mathematics Revision Guide', borrowerId:'std_demo_4',  borrowerType:'student', borrowerName:'David Mutai',        borrowerClass:'Form 2A',     issuedAt:d(10), dueDate:futureDue(11), status:'active',   fineAmount:0,   finePaid:false },
  { id:'ll_demo_3', bookId:'lb_demo_5', bookTitle:'Biology for Secondary Schools',   borrowerId:'std_demo_7',  borrowerType:'student', borrowerName:'Naledi Dlamini',     borrowerClass:'Form 3A',     issuedAt:d(5),  dueDate:futureDue(9),  status:'active',   fineAmount:0,   finePaid:false },
  /* Overdue */
  { id:'ll_demo_4', bookId:'lb_demo_2', bookTitle:'Things Fall Apart',               borrowerId:'std_demo_2',  borrowerType:'student', borrowerName:'James Mwangi',       borrowerClass:'Form 1A',     issuedAt:d(25), dueDate:pastDue(15),   status:'overdue',  fineAmount:150, finePaid:false },
  { id:'ll_demo_5', bookId:'lb_demo_6', bookTitle:'Secondary Chemistry Book 4',      borrowerId:'std_demo_8',  borrowerType:'student', borrowerName:'Kevin Kamau',        borrowerClass:'Form 3A',     issuedAt:d(20), dueDate:pastDue(10),   status:'overdue',  fineAmount:100, finePaid:false },
  /* Returned */
  { id:'ll_demo_6', bookId:'lb_demo_3', bookTitle:'Weep Not, Child',                 borrowerId:'std_demo_3',  borrowerType:'student', borrowerName:'Fatima Al-Hassan',   borrowerClass:'Form 1A',     issuedAt:d(35), dueDate:pastDue(2),    status:'returned', fineAmount:20,  finePaid:true,  returnedAt:d(1),  daysOverdue:2 },
  { id:'ll_demo_7', bookId:'lb_demo_7', bookTitle:'The River Between',               borrowerId:'std_demo_5',  borrowerType:'student', borrowerName:'Grace Waweru',       borrowerClass:'Form 2A',     issuedAt:d(30), dueDate:pastDue(6),    status:'returned', fineAmount:60,  finePaid:false, returnedAt:d(4),  daysOverdue:2 },
  { id:'ll_demo_8', bookId:'lb_demo_9', bookTitle:'Physics for High Schools',        borrowerId:'std_demo_10', borrowerType:'student', borrowerName:'Brian Onyango',      borrowerClass:'Form 4A',     issuedAt:d(21), dueDate:pastDue(1),    status:'returned', fineAmount:0,   finePaid:false, returnedAt:d(2),  daysOverdue:0 },
];

/* ── Transport routes (3) ────────────────────────────────────── */
const TRANSPORT_ROUTES = [
  { id:'tr_demo_1', name:'Westlands Express',       origin:'Westlands Roundabout',   destination:'Msingi Academy', stops:['Sarit Centre','ABC Place','Village Market','Ridgeways'], departureTime:'06:15', arrivalTime:'07:15', vehicleType:'bus',  vehicleReg:'KDH 485Z', driverName:'Mr. John Nderitu',    driverPhone:'+254 712 345 678', capacity:40, feePerTerm:12000, notes:'Morning pickup serving Westlands, Parklands and Ridgeways.' },
  { id:'tr_demo_2', name:'Eastlands Shuttle',        origin:'Pipeline Stage',         destination:'Msingi Academy', stops:['Embakasi','Donholm','Umoja','Jogoo Road'],               departureTime:'06:30', arrivalTime:'07:20', vehicleType:'bus',  vehicleReg:'KBZ 921F', driverName:'Mr. Peter Muthoni',   driverPhone:'+254 722 567 890', capacity:33, feePerTerm:10000, notes:'Serves Eastlands — Embakasi, Donholm and Umoja zones.' },
  { id:'tr_demo_3', name:'Karen & Langata Runner',   origin:'Karen Shopping Centre',  destination:'Msingi Academy', stops:['Hardy','Langata Road','Bomas Junction'],                departureTime:'06:45', arrivalTime:'07:30', vehicleType:'van',  vehicleReg:'KCY 033M', driverName:'Mr. David Kiprotich', driverPhone:'+254 733 901 234', capacity:14, feePerTerm:14000, notes:'Premium van service for Karen, Hardy and Langata students.' },
];

/* ── Transport assignments (8) ───────────────────────────────── */
const TRANSPORT_ASSIGNMENTS = [
  { id:'ta_demo_1', routeId:'tr_demo_1', routeName:'Westlands Express',     studentId:'std_demo_1',  studentName:'Amara Osei',          studentClass:'Form 1A',      pickupStop:'Village Market',          direction:'both', status:'active' },
  { id:'ta_demo_2', routeId:'tr_demo_2', routeName:'Eastlands Shuttle',      studentId:'std_demo_4',  studentName:'David Mutai',         studentClass:'Form 2A',      pickupStop:'Donholm',                 direction:'both', status:'active' },
  { id:'ta_demo_3', routeId:'tr_demo_3', routeName:'Karen & Langata Runner', studentId:'std_demo_7',  studentName:'Naledi Dlamini',      studentClass:'Form 3A',      pickupStop:'Hardy',                   direction:'both', status:'active' },
  { id:'ta_demo_4', routeId:'tr_demo_1', routeName:'Westlands Express',     studentId:'std_demo_10', studentName:'Brian Onyango',       studentClass:'Form 4A',      pickupStop:'Ridgeways',               direction:'both', status:'active' },
  { id:'ta_demo_5', routeId:'tr_demo_1', routeName:'Westlands Express',     studentId:'std_demo_11', studentName:'Miriam Gitau',        studentClass:'Form 4A',      pickupStop:'Sarit Centre',            direction:'both', status:'active' },
  { id:'ta_demo_6', routeId:'tr_demo_2', routeName:'Eastlands Shuttle',      studentId:'std_demo_15', studentName:'Patience Adhiambo',   studentClass:'Standard 5A',  pickupStop:'Umoja',                   direction:'both', status:'active' },
  { id:'ta_demo_7', routeId:'tr_demo_3', routeName:'Karen & Langata Runner', studentId:'std_demo_18', studentName:'Joseph Omondi',       studentClass:'Standard 6A',  pickupStop:'Bomas Junction',          direction:'both', status:'active' },
  { id:'ta_demo_8', routeId:'tr_demo_3', routeName:'Karen & Langata Runner', studentId:'std_demo_19', studentName:'Christine Chebet',    studentClass:'Standard 6A',  pickupStop:'Karen Shopping Centre',   direction:'both', status:'active' },
];

/* ── Hostels (2) + rooms (6) + assignments (6 active residents) ─ */
const HOSTELS = [
  { id:'h_demo_boys',  name:"Boys' Hostel",  gender:'male',   type:'boarding', capacity:120, warden:'Mr. George Ochieng', phone:'+254 722 888 001', location:'North Wing, Block B', feePerTerm:18000, notes:'3 dormitories, common room and study hall.' },
  { id:'h_demo_girls', name:"Girls' Hostel", gender:'female', type:'boarding', capacity:100, warden:'Ms. Sarah Wanjiku',  phone:'+254 711 888 002', location:'South Wing, Block C', feePerTerm:18000, notes:'2 dormitories and a common room.' },
];

/* occupied counts must match HOSTEL_ASSIGNMENTS active records */
const HOSTEL_ROOMS = [
  { id:'hr_demo_b101', hostelId:'h_demo_boys',  hostelName:"Boys' Hostel",  roomNumber:'B101', floor:'Ground Floor', type:'dormitory',    capacity:20, gender:'male',   occupied:2, notes:'East wing dormitory' },
  { id:'hr_demo_b102', hostelId:'h_demo_boys',  hostelName:"Boys' Hostel",  roomNumber:'B102', floor:'Ground Floor', type:'dormitory',    capacity:20, gender:'male',   occupied:2, notes:'West wing dormitory' },
  { id:'hr_demo_b103', hostelId:'h_demo_boys',  hostelName:"Boys' Hostel",  roomNumber:'B103', floor:'First Floor',  type:'dormitory',    capacity:20, gender:'male',   occupied:0, notes:'Upper dormitory' },
  { id:'hr_demo_g201', hostelId:'h_demo_girls', hostelName:"Girls' Hostel", roomNumber:'G201', floor:'Ground Floor', type:'dormitory',    capacity:20, gender:'female', occupied:2, notes:'Main girls dormitory' },
  { id:'hr_demo_g202', hostelId:'h_demo_girls', hostelName:"Girls' Hostel", roomNumber:'G202', floor:'Ground Floor', type:'dormitory',    capacity:20, gender:'female', occupied:0, notes:'Second dormitory' },
  { id:'hr_demo_g203', hostelId:'h_demo_girls', hostelName:"Girls' Hostel", roomNumber:'G203', floor:'First Floor',  type:'semi-private', capacity:4,  gender:'female', occupied:0, notes:'Upper semi-private rooms' },
];

const HOSTEL_ASSIGNMENTS = [
  { id:'ha_demo_1', hostelId:'h_demo_boys',  hostelName:"Boys' Hostel",  roomId:'hr_demo_b101', roomNumber:'B101', studentId:'std_demo_10', studentName:'Brian Onyango',   studentClass:'Form 4A',      bedNumber:'B1', status:'active' },
  { id:'ha_demo_2', hostelId:'h_demo_boys',  hostelName:"Boys' Hostel",  roomId:'hr_demo_b101', roomNumber:'B101', studentId:'std_demo_4',  studentName:'David Mutai',     studentClass:'Form 2A',      bedNumber:'B2', status:'active' },
  { id:'ha_demo_3', hostelId:'h_demo_boys',  hostelName:"Boys' Hostel",  roomId:'hr_demo_b102', roomNumber:'B102', studentId:'std_demo_6',  studentName:'Samuel Karimi',   studentClass:'Form 2A',      bedNumber:'C1', status:'active' },
  { id:'ha_demo_4', hostelId:'h_demo_boys',  hostelName:"Boys' Hostel",  roomId:'hr_demo_b102', roomNumber:'B102', studentId:'std_demo_8',  studentName:'Kevin Kamau',     studentClass:'Form 3A',      bedNumber:'C2', status:'active' },
  { id:'ha_demo_5', hostelId:'h_demo_girls', hostelName:"Girls' Hostel", roomId:'hr_demo_g201', roomNumber:'G201', studentId:'std_demo_7',  studentName:'Naledi Dlamini',  studentClass:'Form 3A',      bedNumber:'G1', status:'active' },
  { id:'ha_demo_6', hostelId:'h_demo_girls', hostelName:"Girls' Hostel", roomId:'hr_demo_g201', roomNumber:'G201', studentId:'std_demo_11', studentName:'Miriam Gitau',    studentClass:'Form 4A',      bedNumber:'G2', status:'active' },
];

/* ════════════════════════════════════════════════════════════════
   MAIN EXPORT
════════════════════════════════════════════════════════════════ */
async function seedDemoData() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) return;

  try {
    const Class     = _model('classes');
    const Subject   = _model('subjects');
    const User      = _model('users');
    const Student   = _model('students');
    const Behaviour = _model('behaviour_incidents');
    const Timetable = _model('timetable');
    const Invoice   = _model('invoices');
    const Payment   = _model('payments');
    const Admission = _model('admissions');

    const hash = await _hash();
    const nowISO = new Date().toISOString();

    /* 1. Classes — upsert + ensure status field is set on existing docs */
    await Promise.all(CLASSES.map(c =>
      upsert(Class, c.id, { ...c, academicYearId: AY_ID, createdBy: ADMIN_ID, updatedBy: ADMIN_ID })
    ));
    // Patch existing classes that were seeded before status field was added
    await Class.updateMany(
      { schoolId: SCHOOL_ID, id: { $in: CLASSES.map(c => c.id) }, status: { $exists: false } },
      { $set: { status: 'active' } }
    );

    /* 2. Departments */
    const Dept = _model('departments');
    await Promise.all(DEPARTMENTS.map(d =>
      upsert(Dept, d.id, { ...d, isActive: true, createdBy: ADMIN_ID, updatedBy: ADMIN_ID })
    ));

    /* 2b. Subjects (with departmentId, sections, isCompulsory) */
    await Promise.all(SUBJECTS.map(s =>
      upsert(Subject, s.id, { ...s, isActive: true, createdBy: ADMIN_ID })
    ));
    // Patch existing subjects seeded without departmentId/sections/isCompulsory
    await Promise.all(SUBJECTS.map(s =>
      Subject.updateOne(
        { id: s.id, schoolId: SCHOOL_ID, $or: [{ departmentId: { $exists: false } }, { sections: { $exists: false } }] },
        { $set: { departmentId: s.departmentId, sections: s.sections, isCompulsory: s.isCompulsory } }
      )
    ));

    /* 3. Extra teachers (users) */
    await Promise.all(EXTRA_TEACHERS.map(t =>
      User.updateOne({ id: t.id }, {
        $setOnInsert: {
          id: t.id, schoolId: SCHOOL_ID, name: t.name, email: t.email,
          password: hash, role: 'teacher', primaryRole: 'teacher', roles: ['teacher'],
          subjects: t.subjects, isActive: true, mustChangePassword: false,
          passwordChangedAt: nowISO, createdAt: nowISO,
        }
      }, { upsert: true })
    ));

    /* 3b. Teacher profiles (teachers collection) — always write to repair stale docs */
    const Teacher = _model('teachers');
    await Promise.all(TEACHER_PROFILES.map(t =>
      Teacher.updateOne(
        { id: t.id, schoolId: SCHOOL_ID },
        {
          $set:         { ...t, schoolId: SCHOOL_ID, updatedBy: ADMIN_ID, updatedAt: nowISO },
          $setOnInsert: { createdBy: ADMIN_ID, createdAt: nowISO },
        },
        { upsert: true }
      )
    ));

    /* 4. Students */
    await Promise.all(STUDENTS.map(s => {
      const { fees, paid, adm, dob, parent, pEmail, pPhone, ...rest } = s;
      return upsert(Student, s.id, {
        ...rest,
        admissionNumber: adm,
        dateOfBirth:     dob,
        parentName:      parent,
        parentEmail:     pEmail,
        parentPhone:     pPhone,
        enrollmentDate:  nowISO.slice(0, 10),
        createdBy:       ADMIN_ID,
        updatedBy:       ADMIN_ID,
      });
    }));

    /* 5. Behaviour incidents */
    await Promise.all(BEHAVIOUR.map(b =>
      upsert(Behaviour, b.id, { ...b, status: 'open', createdBy: ADMIN_ID })
    ));

    /* 6. Timetable — Form 1A */
    await Promise.all(F1A_TIMETABLE.map((slot, i) =>
      upsert(Timetable, `tt_demo_f1a_${i}`, {
        ...slot, classId: 'cls_demo_f1a', className: 'Form 1A', isActive: true,
        academicYearId: AY_ID, termId: T2_ID,
      })
    ));

    /* 7. Timetable — Standard 4A */
    await Promise.all(STD4A_TIMETABLE.map((slot, i) =>
      upsert(Timetable, `tt_demo_4a_${i}`, {
        ...slot, classId: 'cls_demo_4a', className: 'Standard 4A', isActive: true,
        academicYearId: AY_ID, termId: T2_ID,
      })
    ));

    /* 7b. Timetable — Standard 5A */
    await Promise.all(STD5A_TIMETABLE.map((slot, i) =>
      upsert(Timetable, `tt_demo_5a_${i}`, {
        ...slot, classId: 'cls_demo_5a', className: 'Standard 5A', isActive: true,
        academicYearId: AY_ID, termId: T2_ID,
      })
    ));

    /* 7c. Timetable — Standard 6A */
    await Promise.all(STD6A_TIMETABLE.map((slot, i) =>
      upsert(Timetable, `tt_demo_6a_${i}`, {
        ...slot, classId: 'cls_demo_6a', className: 'Standard 6A', isActive: true,
        academicYearId: AY_ID, termId: T2_ID,
      })
    ));

    /* 7d. Timetable — Form 2A */
    await Promise.all(F2A_TIMETABLE.map((slot, i) =>
      upsert(Timetable, `tt_demo_f2a_${i}`, {
        ...slot, classId: 'cls_demo_f2a', className: 'Form 2A', isActive: true,
        academicYearId: AY_ID, termId: T2_ID,
      })
    ));

    /* 7e. Timetable — Form 3A */
    await Promise.all(F3A_TIMETABLE.map((slot, i) =>
      upsert(Timetable, `tt_demo_f3a_${i}`, {
        ...slot, classId: 'cls_demo_f3a', className: 'Form 3A', isActive: true,
        academicYearId: AY_ID, termId: T2_ID,
      })
    ));

    /* 7f. Timetable — Form 4A */
    await Promise.all(F4A_TIMETABLE.map((slot, i) =>
      upsert(Timetable, `tt_demo_f4a_${i}`, {
        ...slot, classId: 'cls_demo_f4a', className: 'Form 4A', isActive: true,
        academicYearId: AY_ID, termId: T2_ID,
      })
    ));

    /* 7g. Patch existing F1A + Std4A slots that lack className/subject fields */
    await _model('timetable').updateMany(
      { schoolId: SCHOOL_ID, classId: 'cls_demo_f1a', className: { $exists: false } },
      { $set: { className: 'Form 1A' } }
    );
    await _model('timetable').updateMany(
      { schoolId: SCHOOL_ID, classId: 'cls_demo_4a', className: { $exists: false } },
      { $set: { className: 'Standard 4A' } }
    );

    /* 8. Invoices + payments */
    const term  = 'Term 2';
    const yearS = String(YEAR);
    const due   = `${YEAR}-04-30`;

    await Promise.all(STUDENTS.map(async (s, idx) => {
      const invId    = `inv_demo_${s.id}`;
      const invNum   = `INV-${YEAR}-${String(idx + 1).padStart(6, '0')}`;
      const balance  = s.fees - s.paid;
      const status   = balance <= 0 ? 'paid' : s.paid > 0 ? 'partial' : 'unpaid';

      await upsert(Invoice, invId, {
        studentId:     s.id,
        title:         `${term} ${yearS} — School Fees`,
        feeType:       'tuition',
        amount:        s.fees,
        amountPaid:    s.paid,
        balance,
        status,
        invoiceNumber: invNum,
        dueDate:       due,
        academicYearId: AY_ID,
        termId:        T2_ID,
        createdBy:     ADMIN_ID,
      });

      /* Payment record only if something was paid */
      if (s.paid > 0) {
        const rcpNum = `RCP-${YEAR}-${String(idx + 1).padStart(6, '0')}`;
        await upsert(Payment, `pay_demo_${s.id}`, {
          invoiceId:     invId,
          studentId:     s.id,
          amount:        s.paid,
          method:        ['mpesa', 'bank_transfer', 'cash', 'cheque'][idx % 4],
          receiptNumber: rcpNum,
          date:          d(crypto.randomInt(1, 31)),
          note:          'Term 2 fees payment',
          createdBy:     ADMIN_ID,
        });
      }
    }));

    /* 9. Admissions */
    await Promise.all(ADMISSIONS.map(a =>
      upsert(Admission, a.id, {
        firstName:        a.firstName,
        lastName:         a.lastName,
        stage:            a.stage,
        applyingForClass: a.applyingForClass,
        applicationRef:   a.ref,
        notes:            a.notes,
        phone:            a.phone,
        email:            a.email,
        priority:         a.priority,
        appliedAt:        a.stageDate,
        stageHistory:     [{ stage: a.stage, date: a.stageDate, changedBy: ADMIN_ID, notes: a.notes }],
        createdBy:        ADMIN_ID,
      })
    ));

    /* 10. Events */
    const Event = _model('events');
    const EVENTS = [
      { id:'evt_demo_1',  title:'Term 2 Opening Day',         startDate:`${YEAR}-04-28`, endDate:`${YEAR}-04-28`, type:'academic', category:'term',     color:'#4f46e5', allDay:true, audience:['all'],  description:'First day of Term 2. All students and staff should report by 7:30 AM.' },
      { id:'evt_demo_2',  title:'Parent-Teacher Conference',  startDate:`${YEAR}-05-10`, endDate:`${YEAR}-05-10`, type:'academic', category:'meeting',  color:'#0891b2', allDay:false, audience:['all'], description:'Mid-term PT conference for all classes. Parents to book slots in advance.' },
      { id:'evt_demo_3',  title:'Sports Day',                 startDate:`${YEAR}-05-24`, endDate:`${YEAR}-05-24`, type:'event',    category:'sports',   color:'#16a34a', allDay:true, audience:['all'],  description:'Annual inter-house sports competition. All houses competing for the championship.' },
      { id:'evt_demo_4',  title:'Mid-Term Break',             startDate:`${YEAR}-06-06`, endDate:`${YEAR}-06-08`, type:'holiday',  category:'break',    color:'#d97706', allDay:true, audience:['all'],  description:'Mid-term holiday. School resumes Monday 11 June.' },
      { id:'evt_demo_5',  title:'Science & Innovation Fair',  startDate:`${YEAR}-06-20`, endDate:`${YEAR}-06-20`, type:'event',    category:'academic', color:'#7c3aed', allDay:true, audience:['all'],  description:'Annual science fair open to all secondary students. Entries due by June 13.' },
      { id:'evt_demo_6',  title:'Staff Meeting — Admin',      startDate:`${YEAR}-05-07`, endDate:`${YEAR}-05-07`, type:'admin',    category:'meeting',  color:'#dc2626', allDay:false, audience:['staff'],'description':'Monthly all-staff briefing. Agenda: term progress, upcoming events, HR updates.' },
      { id:'evt_demo_7',  title:'KCSE Mock Examinations',     startDate:`${YEAR}-06-23`, endDate:`${YEAR}-06-28`, type:'academic', category:'exam',     color:'#0f766e', allDay:true, audience:['secondary'], description:'Form 4 KCSE mock examinations. Normal timetable suspended for Form 4A.' },
      { id:'evt_demo_8',  title:'Cultural Day',               startDate:`${YEAR}-07-05`, endDate:`${YEAR}-07-05`, type:'event',    category:'cultural', color:'#be185d', allDay:true, audience:['all'],  description:'Annual cultural festival celebrating diversity. Students to come in cultural attire.' },
      { id:'evt_demo_9',  title:'Term 2 Closing Day',         startDate:`${YEAR}-08-09`, endDate:`${YEAR}-08-09`, type:'academic', category:'term',     color:'#4f46e5', allDay:true, audience:['all'],  description:'Last day of Term 2. Report cards distributed. School closes at 12:00 PM.' },
      { id:'evt_demo_10', title:'Teacher Training Day',       startDate:`${YEAR}-04-27`, endDate:`${YEAR}-04-27`, type:'admin',    category:'training', color:'#dc2626', allDay:true, audience:['staff'], description:'Mandatory CPD day for all teaching staff before Term 2 opening.' },
    ];
    await Promise.all(EVENTS.map(e => upsert(Event, e.id, e)));

    /* 11. HR — payroll */
    const Payroll = _model('payroll');
    const PAYROLL_PERIOD = `${YEAR}-04`;
    const PAYROLL_STAFF = [
      { staffId:'u_demo_teacher', staffName:'Demo Teacher',     basicSalary:65000, allowances:12000, deductions:8500 },
      { staffId:'u_demo_t2',      staffName:'Mr. Peter Kamau',  basicSalary:60000, allowances:10000, deductions:7800 },
      { staffId:'u_demo_t3',      staffName:'Ms. Agnes Otieno', basicSalary:58000, allowances:10000, deductions:7500 },
      { staffId:'u_demo_t4',      staffName:'Mr. Collins Waweru', basicSalary:58000, allowances:9000, deductions:7200 },
      { staffId:'u_demo_t5',      staffName:'Ms. Judith Njoroge',basicSalary:72000, allowances:15000, deductions:9800 },
      { staffId:'u_demo_t6',      staffName:'Mr. Francis Ochieng',basicSalary:60000, allowances:10000, deductions:7800 },
      { staffId:'u_demo_t7',      staffName:'Ms. Dorothy Chebet',basicSalary:58000, allowances:9000, deductions:7200 },
      { staffId:'u_demo_t8',      staffName:'Mr. Samuel Maina', basicSalary:56000, allowances:9000, deductions:7000 },
      { staffId:'u_demo_t9',      staffName:'Ms. Lilian Wairimu',basicSalary:60000, allowances:10000, deductions:7800 },
      { staffId:'u_demo_t10',     staffName:'Mr. Joseph Kipchoge',basicSalary:56000, allowances:8000, deductions:6800 },
    ];
    await Promise.all(PAYROLL_STAFF.map(p => {
      const grossSalary = p.basicSalary + p.allowances;
      const netSalary   = grossSalary - p.deductions;
      return upsert(Payroll, `pay_${p.staffId}_${PAYROLL_PERIOD}`, {
        ...p, payPeriod: PAYROLL_PERIOD, grossSalary, netSalary,
      });
    }));

    /* 11b. HR — payroll for current month (May 2026) so the UI shows data by default */
    const PAYROLL_PERIOD_CUR = `${YEAR}-05`;
    await Promise.all(PAYROLL_STAFF.map(p => {
      const grossSalary = p.basicSalary + p.allowances;
      const netSalary   = grossSalary - p.deductions;
      return upsert(Payroll, `pay_${p.staffId}_${PAYROLL_PERIOD_CUR}`, {
        ...p, payPeriod: PAYROLL_PERIOD_CUR, grossSalary, netSalary,
      });
    }));

    /* 12. HR — leave requests */
    const Leave = _model('leave_requests');
    const LEAVES = [
      { id:'lr_demo_1', staffId:'u_demo_t3', staffName:'Ms. Agnes Otieno', type:'sick',    startDate:d(15), endDate:d(13), days:3, reason:'Medical leave — flu and fever.',           status:'approved', resolvedBy:'Demo Admin' },
      { id:'lr_demo_2', staffId:'u_demo_t7', staffName:'Ms. Dorothy Chebet',type:'annual',  startDate:d(5),  endDate:d(3),  days:3, reason:'Annual leave — personal travel.',          status:'approved', resolvedBy:'Demo Admin' },
      { id:'lr_demo_3', staffId:'u_demo_t6', staffName:'Mr. Francis Ochieng',type:'emergency',startDate:d(2), endDate:d(2), days:1, reason:'Family emergency — urgent travel.',        status:'pending',  resolvedBy:null },
      { id:'lr_demo_4', staffId:'u_demo_t2', staffName:'Mr. Peter Kamau',   type:'annual',  startDate:`${YEAR}-06-09`, endDate:`${YEAR}-06-11`, days:3, reason:'Mid-term holiday extension.', status:'pending', resolvedBy:null },
    ];
    await Promise.all(LEAVES.map(l => upsert(Leave, l.id, l)));

    /* 13. Class subjects — curriculum per class (which subjects each class offers) */
    const ClassSubject = _model('class_subjects');
    await Promise.all(CLASS_SUBJECTS.map(cs => {
      const csId = `cs_${cs.classId.replace('cls_demo_', '')}_${cs.subjectId.replace('subj_demo_', '')}`;
      return upsert(ClassSubject, csId, {
        ...cs, academicYearId: AY_ID, isActive: true, createdBy: ADMIN_ID,
      });
    }));

    /* 14. Student subject enrollments — flatten ENROLLMENTS groups into individual records */
    const StudentSubject = _model('student_subjects');
    const enrollmentDocs = ENROLLMENTS.flatMap(group =>
      group.students.flatMap(studentId =>
        group.subjects.map(subjectId => ({
          studentId, subjectId, classId: group.classId,
          academicYearId: AY_ID, enrolledAt: nowISO, enrolledBy: ADMIN_ID,
        }))
      )
    );
    await Promise.all(enrollmentDocs.map((e, i) =>
      upsert(StudentSubject, `ss_demo_${i}`, e)
    ));

    /* 15. Subject enrollment rules (min/max subjects per section — like bell schedule) */
    const SubjectRule = _model('subject_rules');
    await Promise.all(SUBJECT_RULES.map(r =>
      upsert(SubjectRule, r.id, { ...r, createdBy: ADMIN_ID })
    ));

    /* 16. Patch departments — always write hodId/hodUserId so legacy docs are repaired */
    await Promise.all(DEPARTMENTS.map(d =>
      Dept.updateOne(
        { id: d.id, schoolId: SCHOOL_ID },
        { $set: { hodId: d.hodId, hodUserId: d.hodUserId } }
      )
    ));

    /* 17. Always-update subject sections — fixes docs seeded before alevel section existed */
    await Promise.all(SUBJECTS.map(s =>
      Subject.updateOne(
        { id: s.id, schoolId: SCHOOL_ID },
        { $set: { sections: s.sections } }
      )
    ));

    /* 18. Library — books + loans */
    const LibBook = _model('library_books');
    const LibLoan = _model('library_loans');
    await Promise.all(LIBRARY_BOOKS.map(b =>
      upsert(LibBook, b.id, { ...b, createdBy: ADMIN_ID, createdAt: nowISO, updatedAt: nowISO })
    ));
    await Promise.all(LIBRARY_LOANS.map(l =>
      upsert(LibLoan, l.id, { ...l, createdBy: ADMIN_ID, createdAt: nowISO })
    ));

    /* 19. Transport — routes + assignments */
    const TrRoute  = _model('transport_routes');
    const TrAssign = _model('transport_assignments');
    await Promise.all(TRANSPORT_ROUTES.map(r =>
      upsert(TrRoute, r.id, { ...r, status:'active', createdBy: ADMIN_ID, createdAt: nowISO, updatedAt: nowISO })
    ));
    await Promise.all(TRANSPORT_ASSIGNMENTS.map(a =>
      upsert(TrAssign, a.id, { ...a, startDate: `${YEAR}-04-28`, createdBy: ADMIN_ID, createdAt: nowISO, updatedAt: nowISO })
    ));

    /* 20. Hostel — hostels + rooms + assignments */
    const Hostel     = _model('hostels');
    const HostelRoom = _model('hostel_rooms');   // NOTE: NOT 'rooms' — that belongs to timetable
    const HostelAsgn = _model('hostel_assignments');
    await Promise.all(HOSTELS.map(h =>
      upsert(Hostel, h.id, { ...h, status:'active', createdBy: ADMIN_ID, createdAt: nowISO, updatedAt: nowISO })
    ));
    await Promise.all(HOSTEL_ROOMS.map(r =>
      upsert(HostelRoom, r.id, { ...r, status:'active', createdBy: ADMIN_ID, createdAt: nowISO, updatedAt: nowISO })
    ));
    await Promise.all(HOSTEL_ASSIGNMENTS.map(a =>
      upsert(HostelAsgn, a.id, { ...a, startDate: `${YEAR}-01-10`, createdBy: ADMIN_ID, createdAt: nowISO, updatedAt: nowISO })
    ));

    console.log('[seed-demo-data] ✓ 9 classes · 6 departments · 18 subjects · 10 teacher profiles · 9 teacher users · 20 students · 25 behaviour · 20 invoices · 14 payments · 205 timetable slots (7 classes) · 8 admissions · 10 events · 20 payroll (Apr+May) · 4 leave · 96 class-subjects · ' + enrollmentDocs.length + ' enrollments · 4 subject-rules · 12 library books · 8 loans · 3 transport routes · 8 transport assignments · 2 hostels · 6 rooms · 6 hostel residents');

  } catch (err) {
    console.warn('[seed-demo-data] Warning:', err.message);
  }
}

module.exports = { seedDemoData };
