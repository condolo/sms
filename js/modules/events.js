/* ============================================================
   InnoLearn — Events & Calendar Module
   ============================================================ */

const Events = (() => {
  let _year  = new Date().getFullYear();
  let _month = new Date().getMonth();
  let _view  = 'calendar'; // 'calendar' | 'list'

  const TYPE_COLORS = {
    academic:'academic', exam:'exam', holiday:'holiday',
    activity:'activity', meeting:'meeting', finance:'finance'
  };

  function render() {
    App.setBreadcrumb('<i class="fas fa-calendar"></i> Events & Calendar');
    _renderPage();
  }

  function _renderPage() {
    const events    = DB.get('events').sort((a,b) => new Date(a.startDate) - new Date(b.startDate));
    const upcoming  = events.filter(e => new Date(e.startDate) >= new Date()).slice(0,5);
    const monthName = new Date(_year, _month).toLocaleDateString('en', {month:'long', year:'numeric'});

    App.renderPage(`
    <div class="page-header">
      <div class="page-title"><h1>Events & Calendar</h1><p>${events.length} events this academic year</p></div>
      <div class="page-actions">
        <div style="display:flex;border:1.5px solid var(--gray-200);border-radius:6px;overflow:hidden">
          <button class="btn btn-sm ${_view==='calendar'?'btn-primary':'btn-secondary'}" style="border-radius:0;border:none" onclick="Events.setView('calendar')"><i class="fas fa-calendar"></i></button>
          <button class="btn btn-sm ${_view==='list'?'btn-primary':'btn-secondary'}" style="border-radius:0;border:none" onclick="Events.setView('list')"><i class="fas fa-list"></i></button>
        </div>
        ${Auth.isAdmin() ? `<button class="btn btn-primary" onclick="Events.addModal()"><i class="fas fa-plus"></i> Add Event</button>` : ''}
      </div>
    </div>

    <div class="grid-2" style="align-items:start">
      <div style="grid-column:1/-1">
        ${_view === 'calendar' ? _calendarHTML(events) : _listHTML(events)}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <div class="card-title"><i class="fas fa-clock" style="color:var(--primary)"></i> Upcoming Events</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${Object.keys(TYPE_COLORS).map(t=>`<span class="cal-event ${t}" style="font-size:11px">${t}</span>`).join('')}
        </div>
      </div>
      ${upcoming.length ? upcoming.map(ev => `
      <div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--gray-100)">
        <div style="width:48px;height:48px;border-radius:12px;background:var(--primary-light);color:var(--primary);display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">
          <div style="font-size:18px;line-height:1">${new Date(ev.startDate).getDate()}</div>
          <div style="font-size:10px;text-transform:uppercase">${new Date(ev.startDate).toLocaleDateString('en',{month:'short'})}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--gray-800)">${ev.title}</div>
          <div style="font-size:12px;color:var(--gray-400);margin-top:2px">
            ${ev.allDay ? 'All day' : `${ev.startTime||''} – ${ev.endTime||''}`}
            ${ev.location ? ` · ${ev.location}` : ''}
          </div>
        </div>
        <span class="cal-event ${ev.type}" style="flex-shrink:0">${ev.type}</span>
        ${Auth.isAdmin() ? `<div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-secondary btn-icon" onclick="Events.editModal('${ev.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon" onclick="Events.delete('${ev.id}')"><i class="fas fa-trash"></i></button>
        </div>` : ''}
      </div>`).join('') : '<div class="empty-state" style="padding:20px"><i class="fas fa-calendar-times"></i><p>No upcoming events</p></div>'}
    </div>
    `);
  }

  function _calendarHTML(events) {
    const monthName = new Date(_year, _month).toLocaleDateString('en', {month:'long', year:'numeric'});
    const firstDay  = new Date(_year, _month, 1).getDay();
    const daysInMonth = new Date(_year, _month+1, 0).getDate();
    const today = new Date();
    const cells = [];

    for (let i = 0; i < firstDay; i++) cells.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${_year}-${String(_month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayEvents = events.filter(e => e.startDate === dateStr || (e.startDate <= dateStr && e.endDate >= dateStr));
      const bdayPeople = typeof Birthday !== 'undefined' ? Birthday.birthdaysOnDate(_year, _month+1, d) : [];
      cells.push({ day: d, dateStr, events: dayEvents, bdayPeople, isToday: today.getDate()===d && today.getMonth()===_month && today.getFullYear()===_year });
    }

    return `
    <div class="card mb-0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <button class="btn btn-secondary btn-sm" onclick="Events.prevMonth()"><i class="fas fa-chevron-left"></i></button>
        <h3 style="font-size:16px;font-weight:700">${monthName}</h3>
        <button class="btn btn-secondary btn-sm" onclick="Events.nextMonth()"><i class="fas fa-chevron-right"></i></button>
      </div>
      <div class="calendar-grid">
        ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="cal-day-hd">${d}</div>`).join('')}
        ${cells.map(c => c.day === null
          ? `<div class="cal-day other-month"></div>`
          : `<div class="cal-day ${c.isToday?'today':''}">
              <div class="cal-date">${c.day}${c.bdayPeople && c.bdayPeople.length ? `<span class="cal-bday-dot" onclick="event.stopPropagation();Events.viewBirthdays(${_year},${_month+1},${c.day})">🎂</span>` : ''}</div>
              <div class="cal-events">
                ${c.events.slice(0,3).map(e=>`<div class="cal-event ${e.type}" title="${e.title}" onclick="Events.viewEvent('${e.id}')">${e.title}</div>`).join('')}
                ${c.events.length > 3 ? `<div style="font-size:10px;color:var(--gray-400);font-weight:600">+${c.events.length-3} more</div>` : ''}
              </div>
            </div>`
        ).join('')}
      </div>
      ${cells.every(c => !c.events || c.events.length === 0) ? `<div style="text-align:center;padding:20px 0 8px;color:var(--gray-400);font-size:13px"><i class="fas fa-calendar-times" style="margin-right:6px"></i>No events in ${monthName}</div>` : ''}
    </div>`;
  }

  function _listHTML(events) {
    const grouped = {};
    events.forEach(e => {
      const month = new Date(e.startDate).toLocaleDateString('en',{month:'long',year:'numeric'});
      if (!grouped[month]) grouped[month] = [];
      grouped[month].push(e);
    });

    return `<div class="card mb-0">
      ${Object.keys(grouped).map(month => `
      <div style="margin-bottom:20px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--gray-500);margin-bottom:10px">${month}</div>
        ${grouped[month].map(ev=>`
        <div style="display:flex;gap:14px;padding:10px 0;border-bottom:1px solid var(--gray-100)" onclick="Events.viewEvent('${ev.id}')" style="cursor:pointer">
          <div style="width:40px;text-align:center;flex-shrink:0">
            <div style="font-size:18px;font-weight:800;color:var(--primary)">${new Date(ev.startDate).getDate()}</div>
            <div style="font-size:10px;color:var(--gray-400);text-transform:uppercase">${new Date(ev.startDate).toLocaleDateString('en',{month:'short'})}</div>
          </div>
          <div style="flex:1;border-left:3px solid;border-color:${_typeColor(ev.type)};padding-left:12px">
            <div style="font-size:13.5px;font-weight:600;color:var(--gray-800)">${ev.title}</div>
            <div style="font-size:12px;color:var(--gray-400);margin-top:2px">${ev.allDay?'All day':`${ev.startTime||''}–${ev.endTime||''}`} · ${ev.location||'School'}</div>
          </div>
          <span class="cal-event ${ev.type}">${ev.type}</span>
          ${Auth.isAdmin()?`<div style="display:flex;gap:4px"><button class="btn btn-sm btn-secondary btn-icon" onclick="event.stopPropagation();Events.editModal('${ev.id}')"><i class="fas fa-edit"></i></button><button class="btn btn-sm btn-danger btn-icon" onclick="event.stopPropagation();Events.delete('${ev.id}')"><i class="fas fa-trash"></i></button></div>`:''}
        </div>`).join('')}
      </div>`).join('') || '<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>No events</h3></div>'}
    </div>`;
  }

  function _typeColor(type) {
    return {academic:'#3B82F6',exam:'#DC2626',holiday:'#059669',activity:'#7C3AED',meeting:'#D97706',finance:'#0891B2'}[type]||'#64748B';
  }

  function viewEvent(id) {
    const ev = DB.getById('events', id);
    if (!ev) return;
    openModal(`
    <div class="modal-header">
      <h3>${ev.title}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <span class="cal-event ${ev.type}" style="font-size:12px;margin-bottom:16px;display:inline-block">${ev.type}</span>
      <div class="info-list">
        <div class="info-item"><div class="info-icon"><i class="fas fa-calendar"></i></div><div><div class="info-label">Date</div><div class="info-value">${fmtDate(ev.startDate)}${ev.endDate!==ev.startDate?' – '+fmtDate(ev.endDate):''}</div></div></div>
        ${!ev.allDay?`<div class="info-item"><div class="info-icon"><i class="fas fa-clock"></i></div><div><div class="info-label">Time</div><div class="info-value">${ev.startTime||''} – ${ev.endTime||''}</div></div></div>`:''}
        ${ev.location?`<div class="info-item"><div class="info-icon"><i class="fas fa-map-marker-alt"></i></div><div><div class="info-label">Location</div><div class="info-value">${ev.location}</div></div></div>`:''}
        <div class="info-item"><div class="info-icon"><i class="fas fa-users"></i></div><div><div class="info-label">Audience</div><div class="info-value">${ev.targetAudience?.join(', ')||'All'}</div></div></div>
      </div>
      ${ev.description?`<div style="margin-top:16px;padding:14px;background:var(--gray-50);border-radius:8px;font-size:13px;color:var(--gray-700);line-height:1.7">${ev.description}</div>`:''}
    </div>`, 'sm');
  }

  function viewBirthdays(year, month, day) {
    const people = typeof Birthday !== 'undefined' ? Birthday.birthdaysOnDate(year, month, day) : [];
    if (!people.length) return;
    const dateLabel = new Date(year, month-1, day).toLocaleDateString('en-KE', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    openModal(`
    <div class="modal-header">
      <h3>🎂 Birthdays — ${dateLabel}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body" style="padding-top:8px">
      ${people.map(p => {
        const isToday = (() => { const t = new Date(); return t.getDate()===day && t.getMonth()+1===month; })();
        const age = year - new Date(p.dob).getFullYear();
        return `
        <div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--gray-100)">
          <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#EC4899,#8B5CF6);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;box-shadow:0 3px 10px rgba(236,72,153,.25)">
            ${p.initials}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;color:var(--gray-800)">${p.name}</div>
            <div style="font-size:12px;color:var(--gray-400);margin-top:2px">
              <i class="fas fa-${p.type==='staff'?'chalkboard-teacher':'graduation-cap'}" style="margin-right:4px"></i>
              ${p.type==='staff' ? 'Staff · '+p.subtitle : p.subtitle}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${isToday
              ? `<span style="background:linear-gradient(135deg,#EC4899,#8B5CF6);color:#fff;font-size:11px;font-weight:700;border-radius:20px;padding:3px 10px">Turns ${age}! 🎉</span>`
              : `<span style="font-size:13px;font-weight:700;color:var(--primary)">Age ${age}</span>`
            }
          </div>
        </div>`;
      }).join('')}
      <div style="margin-top:16px;padding:12px 16px;background:linear-gradient(135deg,#fdf2f8,#ede9fe);border-radius:10px;text-align:center;font-size:13px;color:var(--gray-600)">
        ${people.length === 1
          ? `🎂 <strong>${people[0].name.split(' ')[0]}</strong> celebrates their birthday on this day`
          : `🎂 <strong>${people.length} people</strong> share this birthday`}
      </div>
    </div>`, 'sm');
  }

  function addModal(prefill) {
    openModal(_formHTML(null, prefill), 'sm');
  }

  function editModal(id) {
    openModal(_formHTML(DB.getById('events', id)), 'sm');
  }

  function _formHTML(ev, prefill) {
    const isEdit = !!ev;
    return `
    <div class="modal-header">
      <h3>${isEdit ? 'Edit Event' : 'Add Event'}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Events.save(event,'${ev?.id||''}')">
      <div class="form-field mb-12"><label>Title *</label><input name="title" required value="${ev?.title||prefill?.title||''}"></div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Start Date *</label><input type="date" name="startDate" required value="${ev?.startDate||prefill?.date||new Date().toISOString().split('T')[0]}"></div>
        <div class="form-field"><label>End Date</label><input type="date" name="endDate" value="${ev?.endDate||ev?.startDate||''}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Start Time</label><input type="time" name="startTime" value="${ev?.startTime||''}"></div>
        <div class="form-field"><label>End Time</label><input type="time" name="endTime" value="${ev?.endTime||''}"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label>Type</label><select name="type">
          ${Object.keys(TYPE_COLORS).map(t=>`<option value="${t}" ${ev?.type===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
        <div class="form-field"><label>Location</label><input name="location" value="${ev?.location||''}"></div>
      </div>
      <div class="form-field mb-12"><label>Audience</label><select name="audience">
        <option value="all" ${ev?.targetAudience?.[0]==='all'?'selected':''}>Everyone</option>
        <option value="teachers" ${ev?.targetAudience?.[0]==='teachers'?'selected':''}>Teachers</option>
        <option value="parents"  ${ev?.targetAudience?.[0]==='parents'?'selected':''}>Parents</option>
        <option value="students" ${ev?.targetAudience?.[0]==='students'?'selected':''}>Students</option>
      </select></div>
      <div class="form-field mb-12"><label>Description</label><textarea name="description" rows="3">${ev?.description||''}</textarea></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${isEdit?'Update':'Add'} Event</button>
      </div>
    </form>`;
  }

  function save(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      schoolId:'sch1', title:fd.get('title'),
      startDate:fd.get('startDate'), endDate:fd.get('endDate')||fd.get('startDate'),
      startTime:fd.get('startTime'), endTime:fd.get('endTime'),
      allDay: !fd.get('startTime'),
      type:fd.get('type'), location:fd.get('location'),
      targetAudience:[fd.get('audience')],
      description:fd.get('description'),
      createdBy: Auth.currentUser.id
    };
    if (id) { DB.update('events',id,data); showToast('Event updated.','success'); }
    else     { DB.insert('events',data);   showToast('Event added.','success'); }
    // Navigate the calendar to the month of the saved event so it appears immediately
    if (data.startDate) {
      const parts = data.startDate.split('-');
      if (parts.length === 3) {
        _year  = parseInt(parts[0], 10);
        _month = parseInt(parts[1], 10) - 1; // 0-indexed
      }
    }
    _closeModal(); _renderPage();
  }

  function deleteEvent(id) {
    const ev = DB.getById('events',id);
    confirmAction(`Delete "${ev?.title}"?`, () => { DB.delete('events',id); showToast('Event deleted.','success'); _renderPage(); });
  }

  function prevMonth() { if (_month === 0) { _month=11; _year--; } else _month--; _renderPage(); }
  function nextMonth() { if (_month === 11) { _month=0; _year++; } else _month++; _renderPage(); }
  function setView(v) { _view = v; _renderPage(); }

  return { render, viewEvent, viewBirthdays, addModal, editModal, save, delete: deleteEvent, prevMonth, nextMonth, setView };
})();
