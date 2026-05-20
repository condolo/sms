/* ============================================================
   InnoLearn — Full Demo Seed
   Seeds InnoLearn International School with realistic data
   across ALL modules: students, teachers, classes, houses,
   attendance, behaviour, finance, grades, exams, subjects.

   Usage:
     node server/utils/seedSchool.js            (upsert / safe)
     node server/utils/seedSchool.js --wipe     (drop & rebuild)

   Requires MONGODB_URI in .env
   ============================================================ */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const WIPE = process.argv.includes('--wipe');

/* ── Generic model factory ──────────────────────────────────── */
function model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

/* ── Constants ─────────────────────────────────────────────── */
const S  = 'sch_innolearn_001';       // schoolId shorthand
const AY = `ay_${S}_2025`;            // academicYearId
const T2 = `t2_${S}`;                 // current termId (Term 2)

/* ── School ─────────────────────────────────────────────────── */
const SCHOOL = {
  id: S, slug: 'innolearn',
  name: 'InnoLearn International School', shortName: 'InnoLearn',
  type: 'International School', country: 'Kenya', city: 'Nairobi',
  currency: 'KES', timezone: 'Africa/Nairobi', plan: 'premium',
  addOns: [], isActive: true,
  curriculum: ['cambridge', 'ib'],
  sections:   ['kg', 'primary', 'secondary', 'alevel'],
  website: 'https://www.innolearn.edu.ke', trialEnds: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

/* ── Academic year ──────────────────────────────────────────── */
const ACADEMIC_YEAR = {
  id: AY, schoolId: S, name: '2025-2026', isCurrent: true,
  startDate: '2025-09-01', endDate: '2026-07-31',
  terms: [
    { id: `t1_${S}`, name: 'Term 1', startDate: '2025-09-01', endDate: '2025-12-15', isCurrent: false },
    { id: T2,        name: 'Term 2', startDate: '2026-01-08', endDate: '2026-04-10', isCurrent: true  },
    { id: `t3_${S}`, name: 'Term 3', startDate: '2026-04-27', endDate: '2026-07-11', isCurrent: false },
  ],
};

/* ── Houses ─────────────────────────────────────────────────── */
const HOUSES = [
  { id: `h_lion_${S}`,  schoolId: S, name: 'Lions',  color: '#DC2626', points: 420 },
  { id: `h_eagle_${S}`, schoolId: S, name: 'Eagles', color: '#2563EB', points: 385 },
  { id: `h_rhino_${S}`, schoolId: S, name: 'Rhinos', color: '#16A34A', points: 310 },
];
const H = { lion: `h_lion_${S}`, eagle: `h_eagle_${S}`, rhino: `h_rhino_${S}` };

/* ── Sections ───────────────────────────────────────────────── */
const SECTIONS = [
  { id: `sec_kg_${S}`,  schoolId: S, name: 'KG / Pre-Primary',     code: 'KG',  order: 1, sectionKey: 'kg'        },
  { id: `sec_pri_${S}`, schoolId: S, name: 'Primary',              code: 'PRI', order: 2, sectionKey: 'primary'   },
  { id: `sec_sec_${S}`, schoolId: S, name: 'Secondary',            code: 'SEC', order: 3, sectionKey: 'secondary' },
  { id: `sec_al_${S}`,  schoolId: S, name: 'Sixth Form / A-Level', code: 'AL',  order: 4, sectionKey: 'alevel'    },
];

/* ── Departments ────────────────────────────────────────────── */
const DEPT = {
  math: `dept_math_${S}`, eng: `dept_eng_${S}`,  sci: `dept_sci_${S}`,
  hum:  `dept_hum_${S}`,  mfl: `dept_mfl_${S}`,  ict: `dept_ict_${S}`,
  crt:  `dept_crt_${S}`,  pe:  `dept_pe_${S}`,   rs:  `dept_rs_${S}`,
};
const DEPARTMENTS = [
  { id: DEPT.math, schoolId: S, name: 'Mathematics',                  code: 'MATH', color: '#6366F1', hodName: 'Mr. James Omondi',   order: 1, isActive: true, description: 'Mathematics, Pure Maths, Statistics and Mechanics' },
  { id: DEPT.eng,  schoolId: S, name: 'English Language & Literature', code: 'ENG',  color: '#0EA5E9', hodName: 'Ms. Sarah Smith',     order: 2, isActive: true, description: 'English Language and English Literature' },
  { id: DEPT.sci,  schoolId: S, name: 'Sciences',                     code: 'SCI',  color: '#10B981', hodName: 'Mr. Samuel Kamau',    order: 3, isActive: true, description: 'Biology, Chemistry, Physics and General Science' },
  { id: DEPT.hum,  schoolId: S, name: 'Humanities & Social Sciences', code: 'HUM',  color: '#F97316', hodName: 'Ms. Grace Wanjiku',   order: 4, isActive: true, description: 'History, Geography, Social Studies and Economics' },
  { id: DEPT.mfl,  schoolId: S, name: 'Modern Foreign Languages',     code: 'MFL',  color: '#F59E0B', hodName: 'Ms. Mary Achieng',    order: 5, isActive: true, description: 'Kiswahili, French, Spanish and other modern languages' },
  { id: DEPT.ict,  schoolId: S, name: 'ICT & Computing',              code: 'ICT',  color: '#8B5CF6', hodName: 'Mr. David Otieno',    order: 6, isActive: true, description: 'Information & Communication Technology and Computer Science' },
  { id: DEPT.crt,  schoolId: S, name: 'Creatives',                    code: 'CRT',  color: '#EC4899', hodName: 'Ms. Faith Njeri',     order: 7, isActive: true, description: 'Art & Design, Music and Drama & Theatre' },
  { id: DEPT.pe,   schoolId: S, name: 'Physical Education',           code: 'PE',   color: '#06B6D4', hodName: '',                    order: 8, isActive: true, description: 'Physical Education and Sports' },
  { id: DEPT.rs,   schoolId: S, name: 'Religious Studies',            code: 'RS',   color: '#84CC16', hodName: '',                    order: 9, isActive: true, description: 'CRE, IRE and other religious studies' },
];

/* ── Subjects ───────────────────────────────────────────────── */
// Original 6 IDs preserved — referenced by grades, exams, teachers
const SUB = {
  math: `sub_math_${S}`, eng: `sub_eng_${S}`, sci: `sub_sci_${S}`,
  kis:  `sub_kis_${S}`,  ict: `sub_ict_${S}`, sst: `sub_sst_${S}`,
};
const SUBJECTS = [
  // Mathematics
  { id: SUB.math,            schoolId: S, departmentId: DEPT.math, name: 'Mathematics',     code: 'MATH',    shortName: 'Maths',    sections: ['primary','secondary','alevel'], isCompulsory: true,  color: '#6366F1', order: 1, isActive: true },
  { id: `sub_pmath_${S}`,   schoolId: S, departmentId: DEPT.math, name: 'Pure Mathematics', code: 'PMATH',   shortName: 'Pure Maths', sections: ['alevel'],                    isCompulsory: false, color: '#4F46E5', order: 2, isActive: true },
  { id: `sub_stats_${S}`,   schoolId: S, departmentId: DEPT.math, name: 'Statistics',       code: 'STATS',   shortName: 'Stats',    sections: ['alevel'],                    isCompulsory: false, color: '#818CF8', order: 3, isActive: true },
  { id: `sub_mech_${S}`,    schoolId: S, departmentId: DEPT.math, name: 'Mechanics',         code: 'MECH',    shortName: 'Mech',     sections: ['alevel'],                    isCompulsory: false, color: '#A5B4FC', order: 4, isActive: true },
  // English
  { id: SUB.eng,             schoolId: S, departmentId: DEPT.eng,  name: 'English Language', code: 'ENG',     shortName: 'Eng Lang', sections: ['all'],                       isCompulsory: true,  color: '#0EA5E9', order: 1, isActive: true },
  { id: `sub_lit_${S}`,     schoolId: S, departmentId: DEPT.eng,  name: 'English Literature', code: 'LIT',   shortName: 'Lit',      sections: ['secondary','alevel'],        isCompulsory: false, color: '#38BDF8', order: 2, isActive: true },
  // Sciences
  { id: SUB.sci,             schoolId: S, departmentId: DEPT.sci,  name: 'Science',           code: 'SCI',    shortName: 'Science',  sections: ['kg','primary'],              isCompulsory: true,  color: '#10B981', order: 1, isActive: true },
  { id: `sub_bio_${S}`,     schoolId: S, departmentId: DEPT.sci,  name: 'Biology',            code: 'BIO',    shortName: 'Bio',      sections: ['secondary','alevel'],        isCompulsory: false, color: '#34D399', order: 2, isActive: true },
  { id: `sub_chem_${S}`,    schoolId: S, departmentId: DEPT.sci,  name: 'Chemistry',          code: 'CHEM',   shortName: 'Chem',     sections: ['secondary','alevel'],        isCompulsory: false, color: '#6EE7B7', order: 3, isActive: true },
  { id: `sub_phys_${S}`,    schoolId: S, departmentId: DEPT.sci,  name: 'Physics',            code: 'PHYS',   shortName: 'Physics',  sections: ['secondary','alevel'],        isCompulsory: false, color: '#A7F3D0', order: 4, isActive: true },
  // Humanities
  { id: SUB.sst,             schoolId: S, departmentId: DEPT.hum,  name: 'Social Studies',    code: 'SST',    shortName: 'Soc St',   sections: ['primary'],                   isCompulsory: true,  color: '#F97316', order: 1, isActive: true },
  { id: `sub_hist_${S}`,    schoolId: S, departmentId: DEPT.hum,  name: 'History',            code: 'HIST',   shortName: 'History',  sections: ['secondary','alevel'],        isCompulsory: false, color: '#FB923C', order: 2, isActive: true },
  { id: `sub_geo_${S}`,     schoolId: S, departmentId: DEPT.hum,  name: 'Geography',          code: 'GEO',    shortName: 'Geo',      sections: ['secondary','alevel'],        isCompulsory: false, color: '#FDBA74', order: 3, isActive: true },
  { id: `sub_econ_${S}`,    schoolId: S, departmentId: DEPT.hum,  name: 'Economics',          code: 'ECON',   shortName: 'Econ',     sections: ['alevel'],                    isCompulsory: false, color: '#FED7AA', order: 4, isActive: true },
  // Modern Foreign Languages
  { id: SUB.kis,             schoolId: S, departmentId: DEPT.mfl,  name: 'Kiswahili',          code: 'KIS',    shortName: 'Kiswahili', sections: ['all'],                      isCompulsory: true,  color: '#F59E0B', order: 1, isActive: true },
  { id: `sub_fre_${S}`,     schoolId: S, departmentId: DEPT.mfl,  name: 'French',             code: 'FRE',    shortName: 'French',   sections: ['secondary','alevel'],        isCompulsory: false, color: '#FCD34D', order: 2, isActive: true },
  { id: `sub_spa_${S}`,     schoolId: S, departmentId: DEPT.mfl,  name: 'Spanish',            code: 'SPA',    shortName: 'Spanish',  sections: ['secondary','alevel'],        isCompulsory: false, color: '#FDE68A', order: 3, isActive: true },
  // ICT
  { id: SUB.ict,             schoolId: S, departmentId: DEPT.ict,  name: 'ICT',               code: 'ICT',    shortName: 'ICT',      sections: ['primary','secondary'],       isCompulsory: true,  color: '#8B5CF6', order: 1, isActive: true },
  { id: `sub_cs_${S}`,      schoolId: S, departmentId: DEPT.ict,  name: 'Computer Science',   code: 'CS',     shortName: 'Comp Sci', sections: ['secondary','alevel'],        isCompulsory: false, color: '#A78BFA', order: 2, isActive: true },
  // Creatives
  { id: `sub_art_${S}`,     schoolId: S, departmentId: DEPT.crt,  name: 'Art & Design',       code: 'ART',    shortName: 'Art',      sections: ['primary','secondary'],       isCompulsory: false, color: '#EC4899', order: 1, isActive: true },
  { id: `sub_music_${S}`,   schoolId: S, departmentId: DEPT.crt,  name: 'Music',              code: 'MUSIC',  shortName: 'Music',    sections: ['primary','secondary'],       isCompulsory: false, color: '#F472B6', order: 2, isActive: true },
  { id: `sub_drama_${S}`,   schoolId: S, departmentId: DEPT.crt,  name: 'Drama & Theatre',    code: 'DRAMA',  shortName: 'Drama',    sections: ['secondary'],                 isCompulsory: false, color: '#FBCFE8', order: 3, isActive: true },
  // PE
  { id: `sub_pe_${S}`,      schoolId: S, departmentId: DEPT.pe,   name: 'Physical Education', code: 'PE',     shortName: 'PE',       sections: ['all'],                       isCompulsory: true,  color: '#06B6D4', order: 1, isActive: true },
  // RS
  { id: `sub_cre_${S}`,     schoolId: S, departmentId: DEPT.rs,   name: 'Christian Religious Education', code: 'CRE', shortName: 'CRE', sections: ['primary','secondary'],  isCompulsory: false, color: '#84CC16', order: 1, isActive: true },
];

/* ── Teachers ───────────────────────────────────────────────── */
const TEACHERS = [
  { id: `tch_001_${S}`, staffId: 'STF-2026-00001', firstName: 'Sarah',   lastName: 'Smith',     email: 'sarah.smith@innolearn.edu.ke',   title: 'Ms',  gender: 'female', subjects: [SUB.eng, SUB.lit], houseId: H.lion,  section: 'primary',   status: 'active' },
  { id: `tch_002_${S}`, staffId: 'STF-2026-00002', firstName: 'James',   lastName: 'Omondi',    email: 'james.omondi@innolearn.edu.ke',  title: 'Mr',  gender: 'male',   subjects: [SUB.math, SUB.sci], houseId: H.eagle, section: 'secondary', status: 'active' },
  { id: `tch_003_${S}`, staffId: 'STF-2026-00003', firstName: 'Grace',   lastName: 'Wanjiku',   email: 'grace.wanjiku@innolearn.edu.ke', title: 'Ms',  gender: 'female', subjects: [SUB.sci, SUB.sst],  houseId: H.rhino, section: 'primary',   status: 'active' },
  { id: `tch_004_${S}`, staffId: 'STF-2026-00004', firstName: 'David',   lastName: 'Otieno',    email: 'david.otieno@innolearn.edu.ke',  title: 'Mr',  gender: 'male',   subjects: [SUB.math, SUB.ict], houseId: H.lion,  section: 'secondary', status: 'active' },
  { id: `tch_005_${S}`, staffId: 'STF-2026-00005', firstName: 'Faith',   lastName: 'Njeri',     email: 'faith.njeri@innolearn.edu.ke',   title: 'Ms',  gender: 'female', subjects: [SUB.kis, SUB.sst],  houseId: H.eagle, section: 'kg',        status: 'active' },
  { id: `tch_006_${S}`, staffId: 'STF-2026-00006', firstName: 'Samuel',  lastName: 'Kamau',     email: 'samuel.kamau@innolearn.edu.ke',  title: 'Mr',  gender: 'male',   subjects: [SUB.sci, SUB.math], houseId: H.rhino, section: 'alevel',    status: 'active' },
  { id: `tch_007_${S}`, staffId: 'STF-2026-00007', firstName: 'Mary',    lastName: 'Achieng',   email: 'mary.achieng@innolearn.edu.ke',  title: 'Ms',  gender: 'female', subjects: [SUB.eng, SUB.kis],  houseId: H.lion,  section: 'alevel',    status: 'active' },
  { id: `tch_008_${S}`, staffId: 'STF-2026-00008', firstName: 'John',    lastName: 'Mutua',     email: 'john.mutua@innolearn.edu.ke',    title: 'Mr',  gender: 'male',   subjects: [SUB.ict, SUB.math], houseId: H.eagle, section: 'primary',   status: 'active' },
];

/* ── Classes ────────────────────────────────────────────────── */
const CLS = {
  kg1:  `cls_kg1_${S}`, kg2:  `cls_kg2_${S}`,
  p1:   `cls_p1_${S}`,  p2:   `cls_p2_${S}`,  p3:  `cls_p3_${S}`,
  s1:   `cls_s1_${S}`,  s2:   `cls_s2_${S}`,  s3:  `cls_s3_${S}`,
  al1:  `cls_al1_${S}`, al2:  `cls_al2_${S}`,
};
const CLASSES = [
  { id: CLS.kg1, schoolId: S, name: 'Nursery A',    year: 'Nursery', room: 'Room 1',  section: 'kg',        sectionId: `sec_kg_${S}`,  teacherId: `tch_005_${S}`, teacherName: 'Ms. Faith Njeri',  academicYearId: AY, status: 'active', capacity: 20 },
  { id: CLS.kg2, schoolId: S, name: 'Reception B',  year: 'Recep',   room: 'Room 2',  section: 'kg',        sectionId: `sec_kg_${S}`,  teacherId: `tch_005_${S}`, teacherName: 'Ms. Faith Njeri',  academicYearId: AY, status: 'active', capacity: 20 },
  { id: CLS.p1,  schoolId: S, name: 'Grade 1A',     year: 'Gr 1',    room: 'Room 5',  section: 'primary',   sectionId: `sec_pri_${S}`, teacherId: `tch_001_${S}`, teacherName: 'Ms. Sarah Smith',  academicYearId: AY, status: 'active', capacity: 25 },
  { id: CLS.p2,  schoolId: S, name: 'Grade 2B',     year: 'Gr 2',    room: 'Room 6',  section: 'primary',   sectionId: `sec_pri_${S}`, teacherId: `tch_008_${S}`, teacherName: 'Mr. John Mutua',   academicYearId: AY, status: 'active', capacity: 25 },
  { id: CLS.p3,  schoolId: S, name: 'Grade 3A',     year: 'Gr 3',    room: 'Room 7',  section: 'primary',   sectionId: `sec_pri_${S}`, teacherId: `tch_003_${S}`, teacherName: 'Ms. Grace Wanjiku',academicYearId: AY, status: 'active', capacity: 25 },
  { id: CLS.s1,  schoolId: S, name: 'Form 1A',      year: 'F1',      room: 'Lab 1',   section: 'secondary', sectionId: `sec_sec_${S}`, teacherId: `tch_002_${S}`, teacherName: 'Mr. James Omondi', academicYearId: AY, status: 'active', capacity: 30 },
  { id: CLS.s2,  schoolId: S, name: 'Form 2B',      year: 'F2',      room: 'Lab 2',   section: 'secondary', sectionId: `sec_sec_${S}`, teacherId: `tch_004_${S}`, teacherName: 'Mr. David Otieno', academicYearId: AY, status: 'active', capacity: 30 },
  { id: CLS.s3,  schoolId: S, name: 'Form 3A',      year: 'F3',      room: 'Lab 3',   section: 'secondary', sectionId: `sec_sec_${S}`, teacherId: `tch_002_${S}`, teacherName: 'Mr. James Omondi', academicYearId: AY, status: 'active', capacity: 30 },
  { id: CLS.al1, schoolId: S, name: 'Lower Sixth',  year: 'L6',      room: 'Sixth 1', section: 'alevel',    sectionId: `sec_al_${S}`,  teacherId: `tch_006_${S}`, teacherName: 'Mr. Samuel Kamau', academicYearId: AY, status: 'active', capacity: 20 },
  { id: CLS.al2, schoolId: S, name: 'Upper Sixth',  year: 'U6',      room: 'Sixth 2', section: 'alevel',    sectionId: `sec_al_${S}`,  teacherId: `tch_007_${S}`, teacherName: 'Ms. Mary Achieng', academicYearId: AY, status: 'active', capacity: 20 },
];

/* ── Students (20) ──────────────────────────────────────────── */
// stu(n) helper
const stu = n => `stu_${String(n).padStart(3,'0')}_${S}`;
const adm = n => `ADM-2026-${String(n).padStart(5,'0')}`;

const STUDENTS = [
  // KG — 3 students
  { id: stu(1),  admissionNumber: adm(1),  firstName: 'Fatima',  lastName: 'Abdi',      gender: 'female', dateOfBirth: '2020-03-14', classId: CLS.kg1, className: 'Nursery A',   section: 'kg',        houseId: H.eagle, parentName: 'Mr. & Mrs. Abdi',     parentEmail: 'abdi@gmail.com',            parentPhone: '+254700111001', enrollmentDate: '2025-09-01', status: 'active' },
  { id: stu(2),  admissionNumber: adm(2),  firstName: 'Daniel',  lastName: 'Cheruiyot', gender: 'male',   dateOfBirth: '2019-11-22', classId: CLS.kg2, className: 'Reception B',  section: 'kg',        houseId: H.lion,  parentName: 'Mr. & Mrs. Cheruiyot', parentEmail: 'cheruiyot@gmail.com',       parentPhone: '+254700111002', enrollmentDate: '2025-09-01', status: 'active' },
  { id: stu(3),  admissionNumber: adm(3),  firstName: 'Felix',   lastName: 'Odipo',     gender: 'male',   dateOfBirth: '2019-07-05', classId: CLS.kg2, className: 'Reception B',  section: 'kg',        houseId: H.rhino, parentName: 'Mr. Odipo',            parentEmail: 'odipo@gmail.com',           parentPhone: '+254700111003', enrollmentDate: '2025-09-01', status: 'active' },
  // Primary — 6 students
  { id: stu(4),  admissionNumber: adm(4),  firstName: 'Emily',   lastName: 'Johnson',   gender: 'female', dateOfBirth: '2017-06-12', classId: CLS.p2,  className: 'Grade 2B',    section: 'primary',   houseId: H.lion,  parentName: 'Mr. & Mrs. Johnson',   parentEmail: 'parent1@innolearn.edu.ke', parentPhone: '+254700111004', enrollmentDate: '2024-09-01', status: 'active' },
  { id: stu(5),  admissionNumber: adm(5),  firstName: 'James',   lastName: 'Johnson',   gender: 'male',   dateOfBirth: '2018-02-28', classId: CLS.p1,  className: 'Grade 1A',    section: 'primary',   houseId: H.eagle, parentName: 'Mr. & Mrs. Johnson',   parentEmail: 'parent1@innolearn.edu.ke', parentPhone: '+254700111004', enrollmentDate: '2025-01-10', status: 'active' },
  { id: stu(6),  admissionNumber: adm(6),  firstName: 'Kevin',   lastName: 'Muthama',   gender: 'male',   dateOfBirth: '2018-09-17', classId: CLS.p1,  className: 'Grade 1A',    section: 'primary',   houseId: H.rhino, parentName: 'Mrs. Muthama',         parentEmail: 'muthama@gmail.com',        parentPhone: '+254700111006', enrollmentDate: '2025-09-01', status: 'active' },
  { id: stu(7),  admissionNumber: adm(7),  firstName: 'Nina',    lastName: 'Rotich',    gender: 'female', dateOfBirth: '2017-04-03', classId: CLS.p2,  className: 'Grade 2B',    section: 'primary',   houseId: H.rhino, parentName: 'Dr. Rotich',           parentEmail: 'rotich@gmail.com',         parentPhone: '+254700111007', enrollmentDate: '2024-09-01', status: 'active' },
  { id: stu(8),  admissionNumber: adm(8),  firstName: 'Priya',   lastName: 'Patel',     gender: 'female', dateOfBirth: '2016-12-30', classId: CLS.p3,  className: 'Grade 3A',    section: 'primary',   houseId: H.lion,  parentName: 'Mr. & Mrs. Patel',     parentEmail: 'patel@gmail.com',          parentPhone: '+254700111008', enrollmentDate: '2023-09-01', status: 'active' },
  { id: stu(9),  admissionNumber: adm(9),  firstName: 'Samuel',  lastName: 'Wekesa',    gender: 'male',   dateOfBirth: '2016-08-11', classId: CLS.p3,  className: 'Grade 3A',    section: 'primary',   houseId: H.eagle, parentName: 'Mr. Wekesa',           parentEmail: 'wekesa@gmail.com',         parentPhone: '+254700111009', enrollmentDate: '2023-09-01', status: 'active' },
  // Secondary — 8 students
  { id: stu(10), admissionNumber: adm(10), firstName: 'Michael', lastName: 'Omondi',    gender: 'male',   dateOfBirth: '2012-05-08', classId: CLS.s1,  className: 'Form 1A',     section: 'secondary', houseId: H.eagle, parentName: 'Mr. Omondi Sr.',       parentEmail: 'omondi.sr@gmail.com',      parentPhone: '+254700111010', enrollmentDate: '2026-01-07', status: 'active' },
  { id: stu(11), admissionNumber: adm(11), firstName: 'Omar',    lastName: 'Hassan',    gender: 'male',   dateOfBirth: '2012-11-15', classId: CLS.s1,  className: 'Form 1A',     section: 'secondary', houseId: H.eagle, parentName: 'Dr. & Mrs. Hassan',    parentEmail: 'hassan@gmail.com',         parentPhone: '+254700111011', enrollmentDate: '2026-01-07', status: 'active' },
  { id: stu(12), admissionNumber: adm(12), firstName: 'Amara',   lastName: 'Diallo',    gender: 'female', dateOfBirth: '2012-02-20', classId: CLS.s1,  className: 'Form 1A',     section: 'secondary', houseId: H.lion,  parentName: 'Ambassador Diallo',    parentEmail: 'diallo@gmail.com',         parentPhone: '+254700111012', enrollmentDate: '2026-01-07', status: 'active' },
  { id: stu(13), admissionNumber: adm(13), firstName: 'Aisha',   lastName: 'Kamau',     gender: 'female', dateOfBirth: '2011-07-04', classId: CLS.s2,  className: 'Form 2B',     section: 'secondary', houseId: H.rhino, parentName: 'Mrs. Kamau',           parentEmail: 'kamau.p@gmail.com',        parentPhone: '+254700111013', enrollmentDate: '2025-01-08', status: 'active' },
  { id: stu(14), admissionNumber: adm(14), firstName: 'Stella',  lastName: 'Atieno',    gender: 'female', dateOfBirth: '2011-03-19', classId: CLS.s2,  className: 'Form 2B',     section: 'secondary', houseId: H.lion,  parentName: 'Mr. & Mrs. Atieno',    parentEmail: 'atieno@gmail.com',         parentPhone: '+254700111014', enrollmentDate: '2025-01-08', status: 'active' },
  { id: stu(15), admissionNumber: adm(15), firstName: 'Brian',   lastName: 'Kiprotich', gender: 'male',   dateOfBirth: '2010-09-27', classId: CLS.s3,  className: 'Form 3A',     section: 'secondary', houseId: H.lion,  parentName: 'Mr. Kiprotich',        parentEmail: 'kiprotich@gmail.com',      parentPhone: '+254700111015', enrollmentDate: '2024-01-08', status: 'active' },
  { id: stu(16), admissionNumber: adm(16), firstName: 'Zara',    lastName: 'Osei',      gender: 'female', dateOfBirth: '2010-01-14', classId: CLS.s3,  className: 'Form 3A',     section: 'secondary', houseId: H.rhino, parentName: 'Prof. Osei',           parentEmail: 'osei@gmail.com',           parentPhone: '+254700111016', enrollmentDate: '2024-01-08', status: 'active' },
  { id: stu(17), admissionNumber: adm(17), firstName: 'Liam',    lastName: 'Ndegwa',    gender: 'male',   dateOfBirth: '2010-06-08', classId: CLS.s3,  className: 'Form 3A',     section: 'secondary', houseId: H.eagle, parentName: 'Mr. & Mrs. Ndegwa',    parentEmail: 'ndegwa@gmail.com',         parentPhone: '+254700111017', enrollmentDate: '2024-01-08', status: 'active' },
  // A-Level — 3 students
  { id: stu(18), admissionNumber: adm(18), firstName: 'Grace',   lastName: 'Njiri',     gender: 'female', dateOfBirth: '2008-04-16', classId: CLS.al1, className: 'Lower Sixth',  section: 'alevel',    houseId: H.eagle, parentName: 'Mrs. Njiri',           parentEmail: 'njiri@gmail.com',          parentPhone: '+254700111018', enrollmentDate: '2025-09-01', status: 'active' },
  { id: stu(19), admissionNumber: adm(19), firstName: 'Luke',    lastName: 'Kariuki',   gender: 'male',   dateOfBirth: '2008-10-01', classId: CLS.al1, className: 'Lower Sixth',  section: 'alevel',    houseId: H.eagle, parentName: 'Dr. Kariuki',          parentEmail: 'kariuki@gmail.com',        parentPhone: '+254700111019', enrollmentDate: '2025-09-01', status: 'active' },
  { id: stu(20), admissionNumber: adm(20), firstName: 'David',   lastName: 'Waweru',    gender: 'male',   dateOfBirth: '2007-12-25', classId: CLS.al2, className: 'Upper Sixth',  section: 'alevel',    houseId: H.rhino, parentName: 'Mr. & Mrs. Waweru',    parentEmail: 'waweru@gmail.com',         parentPhone: '+254700111020', enrollmentDate: '2024-09-01', status: 'active' },
];

/* ── Users ──────────────────────────────────────────────────── */
const USERS = [
  { id: 'u_super',   name: 'System Administrator',  email: 'superadmin@innolearn.edu.ke',    role: 'superadmin',          pw: 'super123',      roles: ['superadmin']          },
  { id: 'u_admin1',  name: 'Mwalimu Ndolo',          email: 'admin@innolearn.edu.ke',         role: 'admin',               pw: 'admin123',      roles: ['admin']               },
  { id: 'u_tch1',    name: 'Ms. Sarah Smith',        email: 'sarah.smith@innolearn.edu.ke',   role: 'teacher',             pw: 'teacher123',    roles: ['teacher']             },
  { id: 'u_par1',    name: 'Mr. & Mrs. Johnson',     email: 'parent1@innolearn.edu.ke',       role: 'parent',              pw: 'parent123',     roles: ['parent'],
    guardianOf: [stu(4), stu(5)] },   // linked to Emily & James Johnson
  { id: 'u_stu1',    name: 'Emily Johnson',          email: 'student1@innolearn.edu.ke',      role: 'student',             pw: 'student123',    roles: ['student']             },
  { id: 'u_fin1',    name: 'Ms. Nancy Njeri',        email: 'finance@innolearn.edu.ke',       role: 'finance',             pw: 'finance123',    roles: ['finance']             },
  { id: 'u_dp1',     name: 'Mr. Thomas Wangila',     email: 'deputy@innolearn.edu.ke',        role: 'deputy',              pw: 'deputy123',     roles: ['deputy']              },
  { id: 'u_dc1',     name: 'Mrs. Patricia Nduta',    email: 'discipline@innolearn.edu.ke',    role: 'discipline_committee',pw: 'discipline123', roles: ['discipline_committee']},
  { id: 'u_admin2',  name: 'Mr. David Kariuki',      email: 'vice@innolearn.edu.ke',          role: 'admin',               pw: 'admin123',      roles: ['admin']               },
  { id: 'u_sh_kg',   name: 'Ms. Rose Akinyi',        email: 'head.kg@innolearn.edu.ke',       role: 'section_head',        pw: 'section123',    roles: ['section_head'],       sectionAssigned: 'kg'        },
  { id: 'u_sh_pri',  name: 'Mr. Collins Kimani',     email: 'head.primary@innolearn.edu.ke',  role: 'section_head',        pw: 'section123',    roles: ['section_head'],       sectionAssigned: 'primary'   },
  { id: 'u_sh_sec',  name: 'Dr. Amira Osei',         email: 'head.secondary@innolearn.edu.ke',role: 'section_head',        pw: 'section123',    roles: ['section_head'],       sectionAssigned: 'secondary' },
  { id: 'u_hr1',     name: 'Mr. Peter Muthoni',      email: 'hr@innolearn.edu.ke',            role: 'hr',                  pw: 'hr123',         roles: ['hr']                  },
  { id: 'u_adm1',    name: 'Ms. Joy Wambua',         email: 'admissions@innolearn.edu.ke',    role: 'admissions_officer',  pw: 'admissions123', roles: ['admissions_officer']  },
];

/* ── Role permissions ───────────────────────────────────────── */
const ROLE_PERMISSIONS = [
  { id: `rp_sa_${S}`,  schoolId: S, roleKey: 'superadmin', permissions: { _all: { view: true, edit: true, delete: true, create: true } } },
  { id: `rp_adm_${S}`, schoolId: S, roleKey: 'admin',      permissions: { _all: { view: true, edit: true, delete: true, create: true } } },
];

/* ── Behaviour categories ───────────────────────────────────── */
const BEH_CATS = [
  { id: `bc_merit_${S}`,   schoolId: S, name: 'Academic Excellence', type: 'merit',   defaultPoints: 3 },
  { id: `bc_demer_${S}`,   schoolId: S, name: 'Disruption',           type: 'demerit', defaultPoints: -2 },
  { id: `bc_comm_${S}`,    schoolId: S, name: 'Community Service',    type: 'merit',   defaultPoints: 2 },
  { id: `bc_uniform_${S}`, schoolId: S, name: 'Uniform Violation',    type: 'demerit', defaultPoints: -1 },
  { id: `bc_leader_${S}`,  schoolId: S, name: 'Leadership',           type: 'merit',   defaultPoints: 3 },
];

/* ── Helpers ────────────────────────────────────────────────── */
function uid() { return require('crypto').randomUUID(); }

// Return a date string n working days before today
function workDay(daysBack) {
  const d = new Date();
  let count = 0;
  while (count < daysBack) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return d.toISOString().slice(0, 10);
}

// Generate last N working-day dates (oldest first)
function recentWorkDays(n) {
  const days = [];
  for (let i = n; i >= 1; i--) days.push(workDay(i));
  return days;
}

// Random integer in [min, max]
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Pick a random element
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ── Attendance (last 20 school days × all students) ────────── */
function buildAttendance() {
  const days    = recentWorkDays(20);
  const records = [];
  let   seq     = 1;

  for (const student of STUDENTS) {
    for (const date of days) {
      // 85% present, 8% late, 5% absent, 2% authorised
      const roll = rand(1, 100);
      const status =
        roll <= 85 ? 'present'           :
        roll <= 93 ? 'late'              :
        roll <= 98 ? 'absent'            : 'authorised_absence';

      records.push({
        id:        `att_${String(seq++).padStart(4,'0')}_${S}`,
        schoolId:  S,
        studentId: student.id,
        classId:   student.classId,
        date,
        status,
        period:    'AM',
        note:      status === 'authorised_absence' ? 'Medical appointment' : '',
        markedBy:  'u_admin1',
        updatedBy: 'u_admin1',
      });
    }
  }
  return records;
}

/* ── Behaviour incidents (40 records) ───────────────────────── */
function buildBehaviour() {
  const records = [];
  const days    = recentWorkDays(30);

  const meritTypes = [
    { type: 'merit', points: 3, behaviorType: 'Academic Excellence',      notes: 'Outstanding contribution in class discussion' },
    { type: 'merit', points: 2, behaviorType: 'Community Service',        notes: 'Helped organise school library' },
    { type: 'merit', points: 4, behaviorType: 'Leadership',               notes: 'Excellent leadership during group project' },
    { type: 'merit', points: 2, behaviorType: 'Academic Excellence',      notes: 'Consistent homework submission — full week' },
    { type: 'merit', points: 3, behaviorType: 'Leadership',               notes: 'Represented school in debate competition' },
    { type: 'merit', points: 1, behaviorType: 'Academic Excellence',      notes: 'Helped peer understand a difficult concept' },
  ];
  const demeritTypes = [
    { type: 'demerit', points: -2, behaviorType: 'Disruption',            notes: 'Talking during lesson — repeated warning' },
    { type: 'demerit', points: -1, behaviorType: 'Uniform Violation',     notes: 'Missing school tie' },
    { type: 'demerit', points: -1, behaviorType: 'Disruption',            notes: 'Late to class without valid reason' },
    { type: 'demerit', points: -3, behaviorType: 'Disruption',            notes: 'Persistent refusal to engage in lesson' },
    { type: 'demerit', points: -1, behaviorType: 'Uniform Violation',     notes: 'Incorrect uniform — shoes' },
  ];

  // Distribute 40 incidents across secondary/primary students
  const eligible = STUDENTS.filter(s => s.section !== 'kg');
  for (let i = 0; i < 40; i++) {
    const student = pick(eligible);
    const isMerit = i < 24; // 60% merits
    const template = pick(isMerit ? meritTypes : demeritTypes);
    records.push({
      id:           `beh_${String(i+1).padStart(3,'0')}_${S}`,
      schoolId:     S,
      studentId:    student.id,
      studentName:  `${student.firstName} ${student.lastName}`,
      classId:      student.classId,
      className:    student.className,
      houseId:      student.houseId,
      type:         template.type,
      behaviorType: template.behaviorType,
      points:       template.points,
      notes:        template.notes,
      date:         pick(days),
      awardedBy:    'u_admin1',
      status:       'active',
    });
  }
  return records;
}

/* ── Finance: invoices + payments ───────────────────────────── */
function buildFinance() {
  const invoices = [];
  const payments = [];
  const TUITION  = 45000; // KES per term

  STUDENTS.forEach((student, idx) => {
    const invId  = `inv_${String(idx+1).padStart(3,'0')}_${S}`;
    const invNum = `INV-2026-${String(idx+1).padStart(6,'0')}`;

    // Distribution: 8 paid, 7 partial, 5 unpaid
    const payState =
      idx < 8  ? 'paid'    :
      idx < 15 ? 'partial' : 'unpaid';

    const amountPaid =
      payState === 'paid'    ? TUITION :
      payState === 'partial' ? Math.round(TUITION * rand(30, 70) / 100) : 0;

    const balance = TUITION - amountPaid;

    invoices.push({
      id:            invId,
      schoolId:      S,
      studentId:     student.id,
      studentName:   `${student.firstName} ${student.lastName}`,
      className:     student.className,
      invoiceNumber: invNum,
      feeType:       'tuition',
      description:   'Term 2 2026 Tuition Fee',
      termId:        T2,
      academicYearId: AY,
      total:         TUITION,
      amountPaid,
      balance,
      status:        payState,
      currency:      'KES',
      dueDate:       '2026-02-14',
      issuedDate:    '2026-01-08',
      createdBy:     'u_fin1',
    });

    if (amountPaid > 0) {
      payments.push({
        id:            `pay_${String(idx+1).padStart(3,'0')}_${S}`,
        schoolId:      S,
        invoiceId:     invId,
        studentId:     student.id,
        studentName:   `${student.firstName} ${student.lastName}`,
        amount:        amountPaid,
        receiptNumber: `RCP-2026-${String(idx+1).padStart(6,'0')}`,
        method:        pick(['mpesa', 'bank_transfer', 'cash', 'cheque']),
        date:          workDay(rand(2, 15)),
        notes:         '',
        recordedBy:    'u_fin1',
      });
    }
  });

  return { invoices, payments };
}

/* ── Grades (CA for current term per student per subject) ─── */
function buildGrades() {
  const records = [];
  const ASSESSMENTS = [
    { type: 'CA1',      label: 'Continuous Assessment 1', maxScore: 30, weight: 1 },
    { type: 'CA2',      label: 'Continuous Assessment 2', maxScore: 30, weight: 1 },
    { type: 'midterm',  label: 'Mid-Term Test',           maxScore: 40, weight: 2 },
  ];
  // KG students have simpler assessments
  const KG_ASSESSMENTS = [
    { type: 'CA1', label: 'Term Assessment', maxScore: 100, weight: 1 },
  ];
  // Subjects by section
  const SEC_SUBJECTS   = [SUB.math, SUB.eng, SUB.sci, SUB.kis, SUB.ict];
  const ALEVEL_SUBJECTS = [SUB.math, SUB.eng, SUB.sci];
  const PRIMARY_SUBJS  = [SUB.math, SUB.eng, SUB.sci, SUB.kis, SUB.sst];
  const KG_SUBJS       = [SUB.eng, SUB.kis];

  let seq = 1;
  for (const student of STUDENTS) {
    const subjects =
      student.section === 'alevel'    ? ALEVEL_SUBJECTS :
      student.section === 'secondary' ? SEC_SUBJECTS    :
      student.section === 'primary'   ? PRIMARY_SUBJS   : KG_SUBJS;

    const assessments = student.section === 'kg' ? KG_ASSESSMENTS : ASSESSMENTS;

    for (const subjectId of subjects) {
      for (const asmnt of assessments) {
        // Realistic score range: 60-95% of maxScore
        const pct   = rand(60, 95);
        const score = Math.round(asmnt.maxScore * pct / 100);
        const pctVal = Math.round((score / asmnt.maxScore) * 100);
        const grade =
          pctVal >= 90 ? 'A*' : pctVal >= 80 ? 'A'  : pctVal >= 70 ? 'B'  :
          pctVal >= 60 ? 'C'  : pctVal >= 50 ? 'D'  : 'E';

        records.push({
          id:             `grd_${String(seq++).padStart(4,'0')}_${S}`,
          schoolId:       S,
          studentId:      student.id,
          subjectId,
          classId:        student.classId,
          className:      student.className,
          termId:         T2,
          academicYearId: AY,
          assessmentType: asmnt.type,
          label:          asmnt.label,
          score,
          maxScore:       asmnt.maxScore,
          percentage:     pctVal,
          grade,
          weight:         asmnt.weight,
          isPublished:    true,
          enteredBy:      'u_admin1',
        });
      }
    }
  }
  return records;
}

/* ── Exams + exam_results ────────────────────────────────────── */
function buildExams() {
  const exams   = [];
  const results = [];

  // 2 exams per class
  for (const cls of CLASSES) {
    const classSubs =
      cls.section === 'alevel'    ? [SUB.math, SUB.eng, SUB.sci]          :
      cls.section === 'secondary' ? [SUB.math, SUB.eng, SUB.sci, SUB.kis] :
      cls.section === 'primary'   ? [SUB.math, SUB.eng, SUB.sci]          :
      [SUB.eng, SUB.kis];

    const classStudents = STUDENTS.filter(s => s.classId === cls.id);

    for (const subjectId of classSubs) {
      const examId = `exam_${cls.id}_${subjectId}`;
      exams.push({
        id:             examId,
        schoolId:       S,
        classId:        cls.id,
        className:      cls.name,
        subjectId,
        title:          `Term 2 Mid-Term — ${cls.name}`,
        type:           'mid_term',
        termId:         T2,
        academicYearId: AY,
        maxScore:       100,
        date:           workDay(rand(5, 25)),
        status:         'published',
        isPublished:    true,
        ownerId:        cls.teacherId,
        createdBy:      'u_admin1',
      });

      // One result per student in this class
      for (const student of classStudents) {
        const absent = rand(1, 20) === 1; // ~5% absent
        const score  = absent ? null : rand(45, 98);
        const pct    = score != null ? Math.round((score / 100) * 100) : null;
        const grade  = pct == null ? null :
          pct >= 90 ? 'A*' : pct >= 80 ? 'A'  : pct >= 70 ? 'B'  :
          pct >= 60 ? 'C'  : pct >= 50 ? 'D'  : 'E';

        results.push({
          id:        `res_${examId}_${student.id}`,
          schoolId:  S,
          examId,
          studentId: student.id,
          classId:   cls.id,
          subjectId,
          score,
          maxScore:  100,
          percentage: pct,
          grade,
          markState: absent ? 'ABS' : 'present',
          absent,
          enteredBy: cls.teacherId,
        });
      }
    }
  }
  return { exams, results };
}

/* ── Admissions (pipeline samples) ─────────────────────────── */
const ADMISSIONS = [
  { id: `app_001_${S}`, schoolId: S, firstName: 'Olivia', lastName: 'Ndungu', dateOfBirth: '2012-08-15', gender: 'female', parentName: 'Mrs. Ndungu', parentEmail: 'ndungu@gmail.com', parentPhone: '+254700222001', applyingForClass: 'Form 2B', academicYear: '2026-2027', stage: 'application_received', applicationDate: workDay(5) },
  { id: `app_002_${S}`, schoolId: S, firstName: 'Ryan',   lastName: 'Obote',  dateOfBirth: '2014-03-22', gender: 'male',   parentName: 'Dr. Obote',   parentEmail: 'obote@gmail.com',  parentPhone: '+254700222002', applyingForClass: 'Grade 2B', academicYear: '2026-2027', stage: 'interview_scheduled', applicationDate: workDay(8) },
  { id: `app_003_${S}`, schoolId: S, firstName: 'Amina',  lastName: 'Sheikh',  dateOfBirth: '2008-06-10', gender: 'female', parentName: 'Sheikh',      parentEmail: 'sheikh@gmail.com', parentPhone: '+254700222003', applyingForClass: 'Lower Sixth', academicYear: '2026-2027', stage: 'offer_made', applicationDate: workDay(12) },
  { id: `app_004_${S}`, schoolId: S, firstName: 'Tom',    lastName: 'Njoroge', dateOfBirth: '2011-11-30', gender: 'male',   parentName: 'Mr. Njoroge', parentEmail: 'njoroge@gmail.com',parentPhone: '+254700222004', applyingForClass: 'Form 1A', academicYear: '2026-2027', stage: 'enrolled', applicationDate: workDay(20) },
];

/* ════════════════════════════════════════════════════════════════
   MAIN
   ════════════════════════════════════════════════════════════════ */
async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌  MONGODB_URI not set. Create a .env file first.');
    process.exit(1);
  }

  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(uri, { dbName: 'innolearn' });
  console.log('✅  Connected.\n');

  const School      = model('schools');
  const User        = model('users');
  const Sec         = model('sections');
  const AcYear      = model('academic_years');
  const Perm        = model('role_permissions');
  const House       = model('houses');
  const Department  = model('departments');
  const Subject     = model('subjects');
  const Teacher     = model('teachers');
  const Class      = model('classes');
  const Student    = model('students');
  const Attendance = model('attendance');
  const BehInc     = model('behaviour_incidents');
  const BehCat     = model('behaviour_categories');
  const Invoice    = model('invoices');
  const Payment    = model('payments');
  const Grade      = model('grades');
  const Exam       = model('exams');
  const ExamResult = model('exam_results');
  const Admission  = model('admissions');
  const Counter    = model('counters');

  /* ── WIPE ─────────────────────────────────────────────────── */
  if (WIPE) {
    console.log('🗑   Wiping existing InnoLearn data…');
    await Promise.all([
      School.deleteMany({ id: S }),
      User.deleteMany({ schoolId: S }),
      Sec.deleteMany({ schoolId: S }),
      AcYear.deleteMany({ schoolId: S }),
      Perm.deleteMany({ schoolId: S }),
      House.deleteMany({ schoolId: S }),
      Department.deleteMany({ schoolId: S }),
      Subject.deleteMany({ schoolId: S }),
      Teacher.deleteMany({ schoolId: S }),
      Class.deleteMany({ schoolId: S }),
      Student.deleteMany({ schoolId: S }),
      Attendance.deleteMany({ schoolId: S }),
      BehInc.deleteMany({ schoolId: S }),
      BehCat.deleteMany({ schoolId: S }),
      Invoice.deleteMany({ schoolId: S }),
      Payment.deleteMany({ schoolId: S }),
      Grade.deleteMany({ schoolId: S }),
      Exam.deleteMany({ schoolId: S }),
      ExamResult.deleteMany({ schoolId: S }),
      Admission.deleteMany({ schoolId: S }),
    ]);
    console.log('    Done.\n');
  }

  /* ── School ─────────────────────────────────────────────── */
  await School.updateOne({ id: S }, { $set: SCHOOL }, { upsert: true });
  console.log('🏫  School:', SCHOOL.name);

  /* ── Academic year ─────────────────────────────────────── */
  await AcYear.updateOne({ id: ACADEMIC_YEAR.id }, { $set: ACADEMIC_YEAR }, { upsert: true });
  console.log('📅  Academic year: 2025-2026');

  /* ── Sections ───────────────────────────────────────────── */
  for (const s of SECTIONS) {
    await Sec.updateOne({ id: s.id }, { $set: s }, { upsert: true });
  }
  console.log('📚  Sections:', SECTIONS.map(s => s.code).join(', '));

  /* ── Role permissions ───────────────────────────────────── */
  for (const rp of ROLE_PERMISSIONS) {
    await Perm.updateOne({ id: rp.id }, { $set: rp }, { upsert: true });
  }
  console.log('🔐  Role permissions seeded');

  /* ── Houses ─────────────────────────────────────────────── */
  for (const h of HOUSES) {
    await House.updateOne({ id: h.id }, { $set: h }, { upsert: true });
  }
  console.log('🏆  Houses:', HOUSES.map(h => h.name).join(', '));

  /* ── Departments ────────────────────────────────────────── */
  for (const d of DEPARTMENTS) {
    await Department.updateOne({ id: d.id }, { $set: d }, { upsert: true });
  }
  console.log('🏢  Departments:', DEPARTMENTS.map(d => d.name).join(', '));

  /* ── Subjects ───────────────────────────────────────────── */
  for (const s of SUBJECTS) {
    await Subject.updateOne({ id: s.id }, { $set: s }, { upsert: true });
  }
  console.log(`📖  Subjects: ${SUBJECTS.length} across ${DEPARTMENTS.length} departments`);

  /* ── Users ───────────────────────────────────────────────── */
  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.pw, 12);
    const doc = {
      id: u.id, schoolId: S,
      name: u.name, email: u.email.toLowerCase(),
      password: hashed, role: u.role,
      primaryRole: u.role, roles: u.roles ?? [u.role],
      isActive: true, createdAt: new Date().toISOString(),
    };
    if (u.guardianOf)     doc.guardianOf     = u.guardianOf;
    if (u.sectionAssigned) doc.sectionAssigned = u.sectionAssigned;
    await User.updateOne({ id: u.id }, { $set: doc }, { upsert: true });
    console.log(`   👤  ${u.role.padEnd(20)} ${u.email}`);
  }

  /* ── Teachers ───────────────────────────────────────────── */
  for (const t of TEACHERS) {
    await Teacher.updateOne({ id: t.id }, { $set: { ...t, schoolId: S } }, { upsert: true });
  }
  console.log(`👩‍🏫  Teachers seeded: ${TEACHERS.length}`);

  /* ── Classes ────────────────────────────────────────────── */
  for (const c of CLASSES) {
    await Class.updateOne({ id: c.id }, { $set: c }, { upsert: true });
  }
  console.log(`🏛   Classes seeded: ${CLASSES.length}`);

  /* ── Students ───────────────────────────────────────────── */
  for (const s of STUDENTS) {
    await Student.updateOne({ id: s.id }, { $set: { ...s, schoolId: S } }, { upsert: true });
  }
  console.log(`🎒  Students seeded: ${STUDENTS.length}`);

  /* ── Behaviour categories ───────────────────────────────── */
  for (const bc of BEH_CATS) {
    await BehCat.updateOne({ id: bc.id }, { $set: bc }, { upsert: true });
  }
  console.log(`📋  Behaviour categories: ${BEH_CATS.length}`);

  /* ── Attendance ─────────────────────────────────────────── */
  const attRecords = buildAttendance();
  for (const a of attRecords) {
    await Attendance.updateOne(
      { schoolId: S, studentId: a.studentId, date: a.date, period: a.period },
      { $set: a },
      { upsert: true }
    );
  }
  console.log(`📆  Attendance records: ${attRecords.length} (20 days × 20 students)`);

  /* ── Behaviour incidents ────────────────────────────────── */
  const behRecords = buildBehaviour();
  for (const b of behRecords) {
    await BehInc.updateOne({ id: b.id }, { $set: b }, { upsert: true });
  }
  console.log(`⚖️   Behaviour incidents: ${behRecords.length}`);

  /* ── Finance ────────────────────────────────────────────── */
  const { invoices, payments } = buildFinance();
  for (const inv of invoices) {
    await Invoice.updateOne({ id: inv.id }, { $set: inv }, { upsert: true });
  }
  for (const pay of payments) {
    await Payment.updateOne({ id: pay.id }, { $set: pay }, { upsert: true });
  }
  console.log(`💰  Invoices: ${invoices.length}  |  Payments: ${payments.length}`);

  /* ── Grades ─────────────────────────────────────────────── */
  const gradeRecords = buildGrades();
  for (const g of gradeRecords) {
    await Grade.updateOne({ id: g.id }, { $set: g }, { upsert: true });
  }
  console.log(`📊  Grade records: ${gradeRecords.length}`);

  /* ── Exams + results ────────────────────────────────────── */
  const { exams, results } = buildExams();
  for (const e of exams) {
    await Exam.updateOne({ id: e.id }, { $set: e }, { upsert: true });
  }
  for (const r of results) {
    await ExamResult.updateOne({ id: r.id }, { $set: r }, { upsert: true });
  }
  console.log(`📝  Exams: ${exams.length}  |  Exam results: ${results.length}`);

  /* ── Admissions pipeline ───────────────────────────────── */
  for (const a of ADMISSIONS) {
    await Admission.updateOne({ id: a.id }, { $set: a }, { upsert: true });
  }
  console.log(`📥  Admissions pipeline: ${ADMISSIONS.length}`);

  /* ── Update counters (avoid collisions on new records) ──── */
  const yr = new Date().getFullYear();
  await Promise.all([
    Counter.updateOne({ _id: `admission_${S}_${yr}` }, { $max: { seq: 20 } }, { upsert: true }),
    Counter.updateOne({ _id: `staff_${S}_${yr}`     }, { $max: { seq: 8  } }, { upsert: true }),
    Counter.updateOne({ _id: `invoice_${S}_${yr}`   }, { $max: { seq: 20 } }, { upsert: true }),
    Counter.updateOne({ _id: `receipt_${S}_${yr}`   }, { $max: { seq: 15 } }, { upsert: true }),
  ]);
  console.log('🔢  Counters updated');

  /* ── Summary ────────────────────────────────────────────── */
  console.log('\n✅  InnoLearn demo seeded successfully!');
  console.log('   Parent Mr. & Mrs. Johnson → linked to Emily + James Johnson');
  console.log('   Section heads → kg / primary / secondary sections assigned');
  console.log('   Teacher Ms. Sarah Smith → email matches teacher user account\n');
  console.log('   Demo credentials:');
  console.log('   admin@innolearn.edu.ke           admin123');
  console.log('   sarah.smith@innolearn.edu.ke     teacher123');
  console.log('   parent1@innolearn.edu.ke         parent123');
  console.log('   finance@innolearn.edu.ke         finance123');
  console.log('   head.secondary@innolearn.edu.ke  section123\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
