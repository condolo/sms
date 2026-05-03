/* ============================================================
   InnoLearn — Communication Module
   Messages and announcements are stored in MongoDB via /api/messages
   so they persist across all devices and sessions.
   Notification emails are sent server-side to all recipients.
   Falls back to localStorage DB when the server is unavailable.
   ============================================================ */

const Communication = (() => {
  let _selected = null;
  let _tab      = 'inbox';
  let _msgs     = [];        // current loaded messages
  let _total    = 0;
  let _loading  = false;

  /* ── Public entry point ──────────────────────────────────── */
  function render() {
    App.setBreadcrumb('<i class="fas fa-comment-dots"></i> Communication');
    _load();
  }

  /* ── Load messages from server (or localStorage fallback) ── */
  async function _load() {
    _loading = true;
    _renderLayout();  // show skeleton while loading

    try {
      const result = await API.messages.list({ tab: _tab, limit: 100 });
      _msgs  = result.data || result;
      _total = result.pagination?.total ?? _msgs.length;
    } catch (_err) {
      // Offline fallback — read from localStorage DB
      const user    = Auth.currentUser;
      const allMsgs = DB.get('messages') || [];
      if (_tab === 'sent') {
        _msgs = allMsgs.filter(m => m.senderId === user.id).reverse();
      } else {
        _msgs = allMsgs.filter(m =>
          m.recipients?.includes('all') ||
          m.recipients?.includes(user.role + 's') ||
          m.recipients?.includes(user.id)
        ).reverse();
      }
      _total = _msgs.length;
    }

    _loading = false;
    _renderLayout();
  }

  /* ── Main layout ──────────────────────────────────────────── */
  function _renderLayout() {
    const user     = Auth.currentUser;
    const shown    = _msgs;
    const selected = _selected ? _msgs.find(m => m.id === _selected || m._id === _selected) : null;

    App.renderPage(`
    <div class="page-header">
      <div class="page-title">
        <h1>Communication Hub</h1>
        <p>${_tab === 'inbox' ? `${_total} message${_total !== 1 ? 's' : ''} in inbox` : 'Sent messages'}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="Communication.composeModal()">
          <i class="fas fa-pen"></i> Compose
        </button>
        ${Auth.isAdmin() || Auth.currentUser?.role === 'deputy_principal' ? `
        <button class="btn btn-secondary" onclick="Communication.announceModal()">
          <i class="fas fa-bullhorn"></i> Announcement
        </button>` : ''}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:360px 1fr;gap:16px;height:calc(100vh - 220px);min-height:500px">
      <!-- Message List -->
      <div class="card mb-0" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div class="tabs" style="margin:0;padding:0 16px;border-bottom:2px solid var(--gray-200)">
          <button class="tab-btn ${_tab === 'inbox' ? 'active' : ''}" onclick="Communication.setTab('inbox')">
            Inbox
            ${_tab === 'inbox' && _total > 0 ? `<span style="background:var(--primary);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px">${_total}</span>` : ''}
          </button>
          <button class="tab-btn ${_tab === 'sent' ? 'active' : ''}" onclick="Communication.setTab('sent')">Sent</button>
        </div>

        <div class="msg-list" style="flex:1;overflow-y:auto">
          ${_loading ? `
            ${[1,2,3].map(() => `
            <div class="msg-item" style="pointer-events:none">
              <div style="width:36px;height:36px;border-radius:50%;background:#e5e7eb;flex-shrink:0"></div>
              <div style="flex:1">
                <div style="height:12px;background:#e5e7eb;border-radius:4px;width:70%;margin-bottom:6px"></div>
                <div style="height:10px;background:#f3f4f6;border-radius:4px;width:90%;margin-bottom:4px"></div>
                <div style="height:10px;background:#f3f4f6;border-radius:4px;width:40%"></div>
              </div>
            </div>`).join('')}
          ` : shown.length ? shown.map(m => `
          <div class="msg-item ${!m.isRead?.[user.id] ? 'unread' : ''} ${_selected === (m.id || m._id) ? 'selected' : ''}"
               onclick="Communication.select('${m.id || m._id}')"
               style="${_selected === (m.id || m._id) ? 'background:var(--primary-light);' : ''}">
            <div class="avatar-circle" style="background:var(--primary);width:36px;height:36px;font-size:14px;flex-shrink:0">
              ${(m.senderName || '?').charAt(0)}
            </div>
            <div style="flex:1;min-width:0">
              <div class="msg-subject">${m.subject}</div>
              <div class="msg-preview">${(m.body || '').replace(/\n/g,' ')}</div>
              <div class="msg-sender">${m.senderName || ''}</div>
            </div>
            <div class="msg-time">${_timeAgo(m.createdAt)}</div>
          </div>`).join('') : `
          <div class="empty-state" style="padding:40px">
            <i class="fas fa-inbox"></i>
            <h3>No messages</h3>
          </div>`}
        </div>
      </div>

      <!-- Message Thread -->
      <div class="card mb-0" style="overflow-y:auto;padding:0">
        ${selected ? `
        <div class="msg-thread">
          <div class="msg-thread-header">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
              <h2 style="margin:0">${selected.subject}</h2>
              ${selected.senderId === user.id || Auth.isAdmin() ? `
              <button class="btn btn-sm btn-danger btn-icon"
                      onclick="Communication.deleteMessage('${selected.id || selected._id}')"
                      title="Delete message">
                <i class="fas fa-trash"></i>
              </button>` : ''}
            </div>
            <div style="font-size:13px;color:var(--gray-400);margin-top:6px">
              From: <strong>${selected.senderName}</strong> · ${fmtDate(selected.createdAt)}
              <span style="margin-left:12px">To: <strong>${_recipientLabel(selected.recipients)}</strong></span>
            </div>
          </div>

          <div class="msg-bubble ${selected.senderId === user.id ? 'mine' : ''}">
            <div class="msg-bubble-meta">
              <div class="avatar-circle" style="background:var(--primary);width:28px;height:28px;font-size:11px">
                ${(selected.senderName || '?').charAt(0)}
              </div>
              <strong>${selected.senderName}</strong>
              <span>${fmtDate(selected.createdAt)}</span>
              <span class="badge badge-${selected.type === 'announcement' ? 'warning' : 'primary'}" style="margin-left:auto">
                ${selected.type || 'direct'}
              </span>
            </div>
            <p style="white-space:pre-wrap">${selected.body}</p>
          </div>

          ${Auth.isAdmin() || Auth.isTeacher() || Auth.isParent() ? `
          <div style="margin-top:20px;border-top:1px solid var(--gray-100);padding-top:16px">
            <div style="font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:10px">Reply</div>
            <textarea id="reply-body" rows="3"
              style="width:100%;padding:10px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical"
              placeholder="Type your reply…"></textarea>
            <button class="btn btn-primary" style="margin-top:8px"
                    onclick="Communication.sendReply('${selected.id || selected._id}')">
              <i class="fas fa-paper-plane"></i> Send Reply
            </button>
          </div>` : ''}
        </div>` : `
        <div class="empty-state" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <i class="fas fa-envelope-open" style="font-size:48px;color:var(--gray-300);margin-bottom:16px"></i>
          <h3>Select a message to read</h3>
          <p>Choose a message from the list on the left.</p>
        </div>`}
      </div>
    </div>
    `);
  }

  /* ── Select message + mark read ──────────────────────────── */
  async function select(id) {
    _selected = id;
    const msg = _msgs.find(m => m.id === id || m._id === id);
    const uid = Auth.currentUser.id;
    if (msg && !msg.isRead?.[uid]) {
      if (!msg.isRead) msg.isRead = {};
      msg.isRead[uid] = true;
      // Persist read status to server (non-blocking)
      API.messages.markRead(id).catch(() => {
        DB.update('messages', id, { isRead: { ...(msg.isRead || {}), [uid]: true } });
      });
    }
    _renderLayout();
  }

  /* ── Tab switch ──────────────────────────────────────────── */
  function setTab(tab) {
    _tab      = tab;
    _selected = null;
    _msgs     = [];
    _load();
  }

  /* ── Reply ───────────────────────────────────────────────── */
  async function sendReply(originalId) {
    const body = document.getElementById('reply-body')?.value?.trim();
    if (!body) return showToast('Please enter a reply.', 'warning');

    const orig = _msgs.find(m => m.id === originalId || m._id === originalId);
    const user = Auth.currentUser;
    const btn  = document.querySelector('[onclick*="sendReply"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…'; }

    try {
      await API.messages.send({
        subject:    `Re: ${orig?.subject || ''}`,
        body,
        recipients: [orig?.senderId],
        type:       'direct',
      });
      showToast('Reply sent — recipient notified by email.', 'success');
    } catch (_err) {
      DB.insert('messages', {
        schoolId: user.schoolId || 'sch1', senderId: user.id, senderName: user.name,
        recipients: [orig?.senderId], subject: `Re: ${orig?.subject || ''}`,
        body, type: 'direct', isRead: {}
      });
      showToast('Reply saved offline — will sync when connected.', 'info');
    }
    _load();
  }

  /* ── Compose modal ───────────────────────────────────────── */
  function composeModal() {
    const users = DB.get('users').filter(u => u.id !== Auth.currentUser.id);
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-pen"></i> New Message</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Communication.send(event)">
      <div class="form-field mb-12"><label>To *</label>
        <select name="recipient" required>
          <option value="">Select recipient…</option>
          <optgroup label="Groups">
            <option value="all">Everyone</option>
            <option value="teachers">All Teachers</option>
            <option value="parents">All Parents</option>
            <option value="students">All Students</option>
            <option value="staff">All Staff</option>
          </optgroup>
          <optgroup label="Individual Users">
            ${users.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('')}
          </optgroup>
        </select>
      </div>
      <div class="form-field mb-12"><label>Subject *</label>
        <input name="subject" required placeholder="Message subject…">
      </div>
      <div class="form-field mb-12"><label>Message *</label>
        <textarea name="body" required rows="5" placeholder="Write your message…"></textarea>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#1d4ed8">
        <i class="fas fa-info-circle"></i> Recipients will receive an email notification.
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:4px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="send-msg-btn">
          <i class="fas fa-paper-plane"></i> Send Message
        </button>
      </div>
    </form>`, 'sm');
  }

  /* ── Announcement modal ──────────────────────────────────── */
  function announceModal() {
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-bullhorn"></i> School Announcement</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <form class="modal-body" onsubmit="Communication.sendAnnouncement(event)">
      <div class="form-field mb-12"><label>Audience *</label>
        <select name="audience">
          <option value="all">Everyone (Students, Parents, Teachers, Staff)</option>
          <option value="teachers">Teachers Only</option>
          <option value="parents">Parents Only</option>
          <option value="students">Students Only</option>
          <option value="staff">Staff Only</option>
        </select>
      </div>
      <div class="form-field mb-12"><label>Subject *</label>
        <input name="subject" required placeholder="Announcement title…">
      </div>
      <div class="form-field mb-12"><label>Message *</label>
        <textarea name="body" required rows="6" placeholder="Write your announcement…"></textarea>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#1d4ed8">
        <i class="fas fa-info-circle"></i> All recipients will receive an email notification.
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:4px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="announce-btn">
          <i class="fas fa-bullhorn"></i> Send Announcement
        </button>
      </div>
    </form>`, 'sm');
  }

  /* ── Send direct message ─────────────────────────────────── */
  async function send(e) {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const btn = document.getElementById('send-msg-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…'; }

    try {
      await API.messages.send({
        subject:    fd.get('subject'),
        body:       fd.get('body'),
        recipients: [fd.get('recipient')],
        type:       'direct',
      });
      showToast('Message sent — recipient notified by email.', 'success');
    } catch (_err) {
      const user = Auth.currentUser;
      DB.insert('messages', {
        schoolId: user.schoolId || 'sch1', senderId: user.id, senderName: user.name,
        recipients: [fd.get('recipient')],
        subject: fd.get('subject'), body: fd.get('body'),
        type: 'direct', isRead: {}
      });
      showToast('Message saved offline — will sync when server is available.', 'info');
    }

    _closeModal();
    _tab = 'sent';
    _load();
  }

  /* ── Send announcement ───────────────────────────────────── */
  async function sendAnnouncement(e) {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const btn = document.getElementById('announce-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…'; }

    try {
      await API.messages.send({
        subject:    fd.get('subject'),
        body:       fd.get('body'),
        recipients: [fd.get('audience')],
        type:       'announcement',
      });
      showToast('Announcement sent — all recipients notified by email.', 'success');
    } catch (_err) {
      const user = Auth.currentUser;
      DB.insert('messages', {
        schoolId: user.schoolId || 'sch1', senderId: user.id, senderName: user.name,
        recipients: [fd.get('audience')],
        subject: fd.get('subject'), body: fd.get('body'),
        type: 'announcement', isRead: {}
      });
      showToast('Announcement saved offline — will sync when server is available.', 'info');
    }

    _closeModal();
    _tab = 'sent';
    _load();
  }

  /* ── Delete message ──────────────────────────────────────── */
  function deleteMessage(id) {
    confirmAction('Delete this message? This cannot be undone.', async () => {
      try {
        await API.messages.remove(id);
      } catch (_err) {
        DB.remove('messages', id);
      }
      _selected = null;
      _msgs = _msgs.filter(m => m.id !== id && m._id !== id);
      _total = Math.max(0, _total - 1);
      showToast('Message deleted.', 'info');
      _renderLayout();
    });
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function _recipientLabel(recipients) {
    const map = {
      all: 'Everyone', teachers: 'All Teachers', parents: 'All Parents',
      students: 'All Students', staff: 'All Staff'
    };
    if (!recipients || !recipients.length) return 'Unknown';
    const r = recipients[0];
    if (map[r]) return map[r];
    const u = DB.getById('users', r);
    return u ? u.name : r;
  }

  function _timeAgo(d) {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  return { render, select, setTab, sendReply, composeModal, announceModal, send, sendAnnouncement, deleteMessage };
})();
