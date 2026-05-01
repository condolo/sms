/* ============================================================
   InnoLearn — Browser Test Layer
   Dev-mode only.  Activate by opening the app with ?tests=1
   in the URL, or call InnoLearnTests.run() in the console.

   Uses console.assert() — failures print to console as
   assertion errors without crashing the app.  A summary toast
   is shown at the end: "✓ N passed" or "✗ N failed".
   ============================================================ */

const InnoLearnTests = (() => {

  let _passed = 0;
  let _failed = 0;

  /* ── Internal assert wrapper ─────────────────────────────── */
  function _check(label, condition) {
    if (condition) {
      _passed++;
      console.log(`  ✓ ${label}`);
    } else {
      _failed++;
      console.error(`  ✗ FAIL: ${label}`);
      console.assert(false, label);
    }
  }

  /* ── Test suites ─────────────────────────────────────────── */

  function _testDB() {
    console.group('[InnoLearn Tests] DB Layer');

    /* insert + getById + remove round-trip */
    const rec = DB.insert('_test_col', { name: 'TestRecord', value: 42 });
    _check('DB.insert returns a record with id', !!rec && !!rec.id);
    _check('DB.insert auto-generates id',        typeof rec.id === 'string' && rec.id.length > 0);
    _check('DB.insert sets createdAt',           !!rec.createdAt);

    const fetched = DB.getById('_test_col', rec.id);
    _check('DB.getById retrieves inserted record', !!fetched && fetched.name === 'TestRecord');

    /* update */
    const updated = DB.update('_test_col', rec.id, { value: 99 });
    _check('DB.update merges partial data',       updated?.value === 99);
    _check('DB.update preserves other fields',    updated?.name === 'TestRecord');
    _check('DB.update sets updatedAt',            !!updated?.updatedAt);

    /* query */
    DB.insert('_test_col', { name: 'Another', value: 1 });
    const results = DB.query('_test_col', r => r.value === 99);
    _check('DB.query filters correctly',          results.length === 1 && results[0].id === rec.id);

    /* remove */
    DB.delete('_test_col', rec.id);
    _check('DB.delete removes record',            DB.getById('_test_col', rec.id) === null);

    /* set */
    DB.set('_test_col', []);
    _check('DB.set replaces collection',          DB.get('_test_col').length === 0);

    console.groupEnd();
  }

  function _testSchoolContext() {
    console.group('[InnoLearn Tests] SchoolContext');

    _check('SchoolContext exists',                typeof SchoolContext !== 'undefined');
    _check('school() returns an object',          typeof SchoolContext.school() === 'object');
    _check('school() has an id',                  !!SchoolContext.school().id);

    const termId = SchoolContext.currentTermId();
    _check('currentTermId() returns a string',    typeof termId === 'string');
    _check('currentTermId() is not empty',        termId.length > 0);

    const ayId = SchoolContext.currentAcYearId();
    _check('currentAcYearId() returns a string',  typeof ayId === 'string');
    _check('currentAcYearId() is not empty',      ayId.length > 0);

    console.groupEnd();
  }

  function _testGlobalUtils() {
    console.group('[InnoLearn Tests] Global Utilities');

    /* assert() */
    let threw = false;
    try { assert(false, 'test failure'); } catch (e) { threw = true; }
    _check('assert() throws on false',            threw);

    let didNotThrow = true;
    try { assert(true, 'should not throw'); } catch (e) { didNotThrow = false; }
    _check('assert() does not throw on true',     didNotThrow);

    /* safe() */
    let safeRan = false;
    safe(() => { safeRan = true; }, 'test-safe');
    _check('safe() runs the wrapped function',    safeRan);

    let safeDidNotThrow = true;
    try {
      safe(() => { throw new Error('boom'); }, 'test-error');
    } catch (e) { safeDidNotThrow = false; }
    _check('safe() catches errors without re-throwing', safeDidNotThrow);

    /* isOverlapping() */
    _check('isOverlapping: clear overlap',        isOverlapping('09:00','10:00','09:30','10:30') === true);
    _check('isOverlapping: contained within',     isOverlapping('09:00','11:00','09:30','10:30') === true);
    _check('isOverlapping: touching boundary',    isOverlapping('09:00','10:00','10:00','11:00') === false);
    _check('isOverlapping: no overlap before',    isOverlapping('07:00','08:00','09:00','10:00') === false);
    _check('isOverlapping: no overlap after',     isOverlapping('11:00','12:00','09:00','10:00') === false);
    _check('isOverlapping: identical ranges',     isOverlapping('09:00','10:00','09:00','10:00') === true);

    console.groupEnd();
  }

  function _testSeedData() {
    console.group('[InnoLearn Tests] Seed Data Integrity');

    /* Schools */
    const schools = DB.get('schools');
    _check('schools collection has exactly 1 record',   schools.length === 1);
    _check('school has currentTermId set',              !!schools[0].currentTermId);
    _check('school has currentAcademicYearId set',      !!schools[0].currentAcademicYearId);

    /* Users */
    const users = DB.get('users');
    _check('at least 5 demo users exist',               users.length >= 5);
    _check('superadmin user exists',                    !!users.find(u => u.role === 'superadmin'));
    _check('teacher user exists',                       !!users.find(u => u.role === 'teacher'));
    _check('parent user exists',                        !!users.find(u => u.role === 'parent'));
    _check('student user exists',                       !!users.find(u => u.role === 'student'));

    /* Students */
    const students = DB.get('students');
    _check('at least 10 students seeded',               students.length >= 10);
    students.forEach(s => {
      _check(`student ${s.id} has firstName`,           !!s.firstName);
      _check(`student ${s.id} has classId`,             !!s.classId);
    });

    /* Classes */
    const classes = DB.get('classes');
    _check('at least 3 classes seeded',                 classes.length >= 3);

    /* Behaviour settings */
    const bSettings = DB.get('behaviour_settings');
    _check('behaviour_settings has 1 record',           bSettings.length === 1);
    _check('matrix has items',                          (bSettings[0]?.matrix || []).length > 0);
    _check('categories have 8 defaults',
      (bSettings[0]?.categories || []).filter(c => c.isDefault).length === 8);
    _check('demeritStages are configured',              (bSettings[0]?.demeritStages || []).length > 0);
    _check('meritMilestones are configured',            (bSettings[0]?.meritMilestones || []).length > 0);

    /* Role permissions */
    const rp = DB.get('role_permissions');
    _check('role_permissions seeded',                   rp.length > 0);
    _check('superadmin role permission exists',         !!rp.find(r => r.roleKey === 'superadmin'));

    /* Audit log collection present */
    _check('audit_log collection exists (may be empty)', Array.isArray(DB.get('audit_log')));

    console.groupEnd();
  }

  function _testAuditLog() {
    console.group('[InnoLearn Tests] Audit Log');

    const before = DB.get('audit_log').length;
    _audit('TEST_ACTION', { source: 'InnoLearnTests', value: 'ok' });
    const after = DB.get('audit_log').length;
    _check('_audit() appends a record',             after === before + 1);

    const entry = DB.get('audit_log').find(a => a.action === 'TEST_ACTION');
    _check('audit entry has action field',          entry?.action === 'TEST_ACTION');
    _check('audit entry has performedAt',           !!entry?.performedAt);
    _check('audit entry has details',               entry?.details?.source === 'InnoLearnTests');

    /* Clean up test entry */
    DB.delete('audit_log', entry.id);

    console.groupEnd();
  }

  function _testBehaviourModule() {
    console.group('[InnoLearn Tests] Behaviour Module');

    _check('Behaviour module exists',               typeof Behaviour !== 'undefined');
    _check('Behaviour has render()',                typeof Behaviour.render === 'function');
    _check('Behaviour has logModal()',              typeof Behaviour.logModal === 'function');
    _check('Behaviour has saveIncidentNew()',       typeof Behaviour.saveIncidentNew === 'function');

    /* Matrix items have required fields */
    const cfg = DB.get('behaviour_settings')[0];
    const matrix = cfg?.matrix || [];
    if (matrix.length > 0) {
      const item = matrix[0];
      _check('matrix item has id',                 !!item.id);
      _check('matrix item has type',               item.type === 'merit' || item.type === 'demerit');
      _check('matrix item has pts (not points)',   item.pts !== undefined);
      _check('matrix item has cat',                !!item.cat);
    }

    /* Categories */
    const cats = cfg?.categories || [];
    _check('categories non-empty',                 cats.length > 0);
    const cat0 = cats[0];
    if (cat0) {
      _check('category has id',                    !!cat0.id);
      _check('category has name',                  !!cat0.name);
      _check('default category has matCat',        cat0.isDefault ? !!cat0.matCat : true);
    }

    console.groupEnd();
  }

  function _testENUMS() {
    console.group('[InnoLearn Tests] ENUMS');

    _check('ENUMS exists',                             typeof ENUMS !== 'undefined');
    _check('ENUMS is frozen (immutable)',              Object.isFrozen(ENUMS));
    _check('studentStatus has "active"',              ENUMS.studentStatus.includes('active'));
    _check('incidentType has "merit" and "demerit"',  ENUMS.incidentType.includes('merit') && ENUMS.incidentType.includes('demerit'));
    _check('appealStatus has 4 values',               ENUMS.appealStatus.length === 4);
    _check('invoiceStatus has "paid"',                ENUMS.invoiceStatus.includes('paid'));
    _check('userRole includes "superadmin"',          ENUMS.userRole.includes('superadmin'));
    _check('paymentMethod includes "mpesa"',          ENUMS.paymentMethod.includes('mpesa'));

    console.groupEnd();
  }

  function _testValidators() {
    console.group('[InnoLearn Tests] Validators');

    _check('Validators exists',                       typeof Validators !== 'undefined');

    /* student() — required fields */
    _check('student: rejects missing firstName',
      Validators.student({ lastName:'X', classId:'cls10a', status:'active' }) !== null);
    _check('student: rejects invalid status',
      Validators.student({ firstName:'A', lastName:'B', classId:'cls10a', status:'ACTIVE' }) !== null);
    _check('student: rejects non-existent classId',
      Validators.student({ firstName:'A', lastName:'B', classId:'nonexistent_cls', status:'active' }) !== null);

    /* student() — valid data should pass */
    const validClass = DB.get('classes')[0];
    if (validClass) {
      _check('student: accepts valid data',
        Validators.student({ firstName:'Test', lastName:'Student', classId: validClass.id, status:'active' }) === null);
    }

    /* user() — unique email */
    const existingUser = DB.get('users')[0];
    if (existingUser) {
      _check('user: rejects duplicate email',
        Validators.user({ name:'Test', email: existingUser.email, role:'teacher' }, 'nonexistent_id') !== null);
    }
    _check('user: rejects invalid role',
      Validators.user({ name:'Test', email:'test@test.com', role:'wizard' }) !== null);

    /* payment() */
    _check('payment: rejects null invoice',           Validators.payment(100, null) !== null);
    _check('payment: rejects zero amount',            Validators.payment(0, { status:'unpaid', paidAmount:0 }) !== null);
    _check('payment: rejects negative amount',        Validators.payment(-50, { status:'unpaid', paidAmount:0 }) !== null);
    _check('payment: rejects already-paid invoice',   Validators.payment(100, { status:'paid', paidAmount:500 }) !== null);
    _check('payment: accepts valid payment',          Validators.payment(100, { status:'unpaid', paidAmount:0 }) === null);

    /* timetableSlot() — missing subject */
    _check('timetableSlot: rejects missing subjectId',
      Validators.timetableSlot({ day:1, period:1, subjectId:'', teacherId:null }, 'tt1') !== null);
    _check('timetableSlot: rejects non-existent subjectId',
      Validators.timetableSlot({ day:1, period:1, subjectId:'sbj_nonexistent', teacherId:null }, 'tt1') !== null);

    /* canDeleteStudent() */
    const stuWithAppeals = DB.query('behaviour_appeals', a => ['pending','escalated'].includes(a.status))[0];
    if (stuWithAppeals) {
      _check('canDeleteStudent: blocks student with open appeals',
        Validators.canDeleteStudent(stuWithAppeals.studentId) !== null);
    }

    /* canDeleteClass() */
    const activeStudent = DB.get('students')[0];
    if (activeStudent?.classId) {
      _check('canDeleteClass: blocks class with enrolled students',
        Validators.canDeleteClass(activeStudent.classId) !== null);
    }

    /* canDeleteYear() */
    const currentYear = DB.get('academicYears').find(y => y.isCurrent);
    if (currentYear) {
      _check('canDeleteYear: blocks current academic year',
        Validators.canDeleteYear(currentYear.id) !== null);
    }

    console.groupEnd();
  }

  /* ── Public runner ───────────────────────────────────────── */
  function run() {
    _passed = 0;
    _failed = 0;
    console.group('%c[InnoLearn Tests] Running test suite…', 'font-weight:bold;color:#2563EB');
    console.time('Tests completed in');

    _testDB();
    _testSchoolContext();
    _testGlobalUtils();
    _testSeedData();
    _testAuditLog();
    _testBehaviourModule();
    _testENUMS();
    _testValidators();

    console.timeEnd('Tests completed in');
    const total = _passed + _failed;
    if (_failed === 0) {
      console.log(`%c✓ All ${total} tests passed`, 'color:#059669;font-weight:bold;font-size:14px');
      showToast(`Tests: ✓ ${total} passed`, 'success');
    } else {
      console.error(`✗ ${_failed} of ${total} tests FAILED`);
      showToast(`Tests: ✗ ${_failed} failed / ${_passed} passed — see console`, 'error');
    }
    console.groupEnd();
  }

  return { run };
})();

/* ── Auto-run when ?tests=1 is in the URL ───────────────────
   Delayed until after DOMContentLoaded so all modules are ready */
if (location.search.includes('tests=1')) {
  document.addEventListener('DOMContentLoaded', () => {
    /* Extra delay to let App.init() finish seeding and routing */
    setTimeout(() => InnoLearnTests.run(), 800);
  });
}
