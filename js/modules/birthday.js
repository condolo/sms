/* ============================================================
   InnoLearn — Birthday Module
   Detects student & staff birthdays, greets, notifies, and
   surfaces them in the dashboard, calendar, and notification bell.
   ============================================================ */

const Birthday = (() => {

  /* ── Helpers ─────────────────────────────────────────────── */

  function _mmdd(dateStr) {
    if (!dateStr) return null;
    const p = dateStr.split('-');
    return p.length === 3 ? `${p[1]}-${p[2]}` : null;
  }

  function _todayMmdd() {
    const t = new Date();
    return `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  }

  function _daysUntil(dateStr) {
    const now = new Date(); now.setHours(0,0,0,0);
    const p   = dateStr.split('-');
    let bday  = new Date(now.getFullYear(), +p[1]-1, +p[2]);
    if (bday < now) bday.setFullYear(now.getFullYear()+1);
    return Math.round((bday - now) / 86400000);
  }

  function _turningAge(dateStr) {
    const now   = new Date();
    const born  = new Date(dateStr);
    const age   = now.getFullYear() - born.getFullYear();
    const mmddNow  = _todayMmdd();
    const mmddBorn = _mmdd(dateStr);
    // If birthday hasn't occurred yet in current year they are still age-1
    return mmddBorn >= mmddNow ? age : age + 1;
  }

  function _ordinal(n) {
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return (s[(v-20)%10] || s[v] || s[0]);
  }

  function _fmtMmdd(mmdd) {
    if (!mmdd) return '';
    const [m, d] = mmdd.split('-');
    return new Date(2000, +m-1, +d).toLocaleDateString('en-KE', { month:'short', day:'numeric' });
  }

  /* ── Data ────────────────────────────────────────────────── */

  function _getAllPeople() {
    const people = [];
    const classes = DB.get('classes');

    DB.get('students').filter(s => s.status === 'active' && s.dateOfBirth).forEach(s => {
      const cls = classes.find(c => c.id === s.classId);
      people.push({
        id: s.id, userId: s.userId,
        name: `${s.firstName} ${s.lastName}`,
        dob: s.dateOfBirth, type: 'student',
        subtitle: cls?.name || 'Student',
        initials: `${s.firstName[0]}${s.lastName[0]}`,
      });
    });

    DB.get('teachers').filter(t => t.status === 'active' && t.dateOfBirth).forEach(t => {
      people.push({
        id: t.id, userId: t.userId,
        name: `${t.firstName} ${t.lastName}`,
        dob: t.dateOfBirth, type: 'staff',
        subtitle: t.specialization || 'Staff',
        initials: `${t.firstName[0]}${t.lastName[0]}`,
      });
    });

    return people;
  }

  /* ── Public query API ────────────────────────────────────── */

  function todaysBirthdays() {
    const today = _todayMmdd();
    return _getAllPeople()
      .filter(p => _mmdd(p.dob) === today)
      .map(p => ({ ...p, daysUntil: 0, turningAge: _turningAge(p.dob) }));
  }

  function upcomingBirthdays(days = 7) {
    return _getAllPeople()
      .filter(p => { const d = _daysUntil(p.dob); return d > 0 && d <= days; })
      .map(p => ({ ...p, daysUntil: _daysUntil(p.dob), turningAge: _turningAge(p.dob) }))
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }

  function birthdaysOnDate(year, month, day) {
    const mmdd = `${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return _getAllPeople().filter(p => _mmdd(p.dob) === mmdd);
  }

  /* ── Dashboard card ─────────────────────────────────────── */

  function dashboardCard() {
    const today    = todaysBirthdays();
    const upcoming = upcomingBirthdays(7);
    if (today.length === 0 && upcoming.length === 0) return '';

    const todayHtml = today.map(p => `
      <div class="bday-today-row">
        <div class="bday-avatar bday-avatar-today">${p.initials}</div>
        <div class="bday-info">
          <div class="bday-name">
            ${p.name}
            <span class="bday-age-badge">Turns ${p.turningAge}!</span>
          </div>
          <div class="bday-sub">
            <i class="fas fa-${p.type==='staff'?'chalkboard-teacher':'graduation-cap'}"></i>
            ${p.type==='staff'?'Staff · '+p.subtitle:p.subtitle}
          </div>
        </div>
        <span class="bday-cake-icon">🎂</span>
      </div>`).join('');

    const upcomingHtml = upcoming.map(p => `
      <div class="bday-upcoming-row">
        <div class="bday-avatar bday-avatar-upcoming">${p.initials}</div>
        <div class="bday-info">
          <div class="bday-name bday-name-sm">${p.name}</div>
          <div class="bday-sub">${p.type==='staff'?'Staff':p.subtitle}</div>
        </div>
        <div class="bday-countdown">
          <div class="bday-days">${p.daysUntil}d</div>
          <div class="bday-date-sm">${_fmtMmdd(_mmdd(p.dob))}</div>
        </div>
      </div>`).join('');

    return `
    <div class="card bday-card">
      <div class="card-header">
        <div class="card-title bday-card-title">
          <i class="fas fa-birthday-cake"></i> Birthdays
        </div>
        <span class="bday-date-label">${new Date().toLocaleDateString('en-KE',{weekday:'short',month:'short',day:'numeric'})}</span>
      </div>

      ${today.length ? `
      <div class="bday-section-label bday-label-today">🎉 Today</div>
      ${todayHtml}` : ''}

      ${upcoming.length ? `
      <div class="bday-section-label bday-label-upcoming" style="${today.length?'margin-top:14px':''}">
        <i class="fas fa-calendar-alt"></i> Coming up
      </div>
      ${upcomingHtml}` : ''}
    </div>`;
  }

  /* ── Notification bell injection ─────────────────────────── */

  function _injectNotifications(birthdays) {
    if (!birthdays.length) return;
    const list  = document.getElementById('notifications-list');
    const badge = document.getElementById('notif-badge');
    if (!list) return;

    const html = birthdays.map(p => `
      <div class="notif-item bday-notif-item">
        <div class="notif-icon bday-notif-icon">🎂</div>
        <div class="notif-body">
          <p><strong>${p.name}</strong>'s Birthday 🎉</p>
          <span>${p.type==='staff'?'Staff':p.subtitle} · Turns ${p.turningAge} today</span>
        </div>
      </div>`).join('');

    list.innerHTML = html + list.innerHTML;

    if (badge) {
      const cur = parseInt(badge.textContent || '0', 10);
      badge.textContent  = cur + birthdays.length;
      badge.style.display = 'flex';
    }
  }

  /* ── Birthday modal (own birthday) ──────────────────────── */

  function _showOwnBirthdayModal(person) {
    openModal(`
    <div style="text-align:center;padding:36px 28px 28px">
      <div style="font-size:60px;line-height:1;margin-bottom:8px">🎂</div>
      <div style="font-size:28px;margin-bottom:18px">🎉 🎊 🎈</div>
      <h2 style="font-size:24px;font-weight:800;color:var(--gray-900);margin-bottom:8px">
        Happy Birthday, ${person.name.split(' ')[0]}!
      </h2>
      <p style="font-size:15px;color:var(--gray-500);line-height:1.7;margin-bottom:20px">
        InnoLearn &amp; the entire <strong>InnoLearn team</strong> wishes you a<br>
        wonderful <strong>${person.turningAge}${_ordinal(person.turningAge)} birthday</strong>! 🌟
      </p>
      <div style="background:linear-gradient(135deg,#fdf2f8,#ede9fe);border-radius:14px;padding:16px 20px;margin-bottom:24px">
        <p style="font-size:13px;color:var(--gray-600);margin:0;line-height:1.8">
          May this year bring you joy, growth, and every success<br>you deserve. You are valued and appreciated! 🙌
        </p>
      </div>
      <button class="btn" onclick="_closeModal()"
        style="padding:11px 36px;font-size:15px;background:linear-gradient(135deg,#EC4899,#8B5CF6);color:#fff;border:none">
        <i class="fas fa-heart"></i> Thank you! 💖
      </button>
    </div>`, 'sm');
  }

  /* ── Init — called once on login ─────────────────────────── */

  function init() {
    const user = Auth.currentUser;
    if (!user) return;

    const today = todaysBirthdays();
    if (!today.length) return;

    // Own birthday greeting (modal)
    const mine = today.find(p => p.userId === user.id);
    if (mine) setTimeout(() => _showOwnBirthdayModal(mine), 900);

    // Toast notifications for staff about others' birthdays
    const staffRoles = ['superadmin','admin','teacher','deputy','discipline','section_sec','hr'];
    if (staffRoles.includes(user.role)) {
      today.filter(p => p.userId !== user.id).forEach((p, i) => {
        setTimeout(() => {
          showToast(`🎂 Today is ${p.name}'s birthday! (${p.type==='staff'?'Staff':p.subtitle})`, 'info');
        }, 1800 + i * 900);
      });
    }

    // Inject into notification bell
    _injectNotifications(today);
  }

  return { init, todaysBirthdays, upcomingBirthdays, birthdaysOnDate, dashboardCard };
})();
