/* ============================================================
   SchoolSync — Communication Module
   ============================================================ */

const Communication = (() => {
  let _selected = null;
  let _tab = 'inbox';

  function render() {
    App.setBreadcrumb('<i class="fas fa-comment-dots"></i> Communication');
    _renderLayout();
  }

  function _renderLayout() {
    const user     = Auth.currentUser;
    const allMsgs  = DB.get('messages');
    const inbox    = allMsgs.filter(m => m.recipients.includes('all') || m.recipients.includes(user.role+'s') || m.recipients.includes(user.id)).reverse();
    const sent     = allMsgs.filter(m => m.senderId === user.id).reverse();
    const shown    = _tab === 'inbox' ? inbox : sent;
    const selected = _selected ? allMsgs.find(m => m.id === _selected) : null;

    App.renderPage(`
    <div class="page-header">
      <div class="page-title"><h1>Communication Hub</h1><p>${inbox.length} messages in inbox</p></div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="Communication.composeModal()"><i class="fas fa-pen"></i> Compose</button>
        ${Auth.isAdmin() ? `<button class="btn btn-secondary" onclick="Communication.announceModal()"><i class="fas fa-bullhorn"></i> Announcement</button>` : ''}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:360px 1fr;gap:16px;height:calc(100vh - 220px);min-height:500px">
      <!-- Message List -->
      <div class="card mb-0" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div class="tabs" style="margin:0;padding:0 16px;border-bottom:2px solid var(--gray-200)">
          <button class="tab-btn ${_tab==='inbox'?'active':''}" onclick="Communication.setTab('inbox')">Inbox <span style="background:var(--primary);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px">${inbox.length}</span></button>
          <button class="tab-btn ${_tab==='sent'?'active':''}"  onclick="Communication.setTab('sent')">Sent</button>
        </div>
        <div class="msg-list" style="flex:1;overflow-y:auto">
          ${shown.length ? shown.map(m => `
          <div class="msg-item ${!m.isRead?.[user.id] ? 'unread' : ''} ${_selected===m.id?'selected':''}" onclick="Communication.select('${m.id}')" style="${_selected===m.id?'background:var(--primary-light);':''}">
            <div class="avatar-circle" style="background:var(--primary);width:36px;height:36px;font-size:14px;flex-shrink:0">${m.senderName.charAt(0)}</div>
            <div style="flex:1;min-width:0">
              <div class="msg-subject">${m.subject}</div>
              <div class="msg-preview">${m.body.replace(/\n/g,' ')}</div>
              <div class="msg-sender">${m.senderName}</div>
            </div>
            <div class="msg-time">${_timeAgo(m.createdAt)}</div>
          </div>`).join('') : `<div class="empty-state" style="padding:40px"><i class="fas fa-inbox"></i><h3>No messages</h3></div>`}
        </div>
      </div>

      <!-- Message Thread -->
      <div class="card mb-0" style="overflow-y:auto;padding:0">
        ${selected ? `
        <div class="msg-thread">
          <div class="msg-thread-header">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
              <h2 style="margin:0">${selected.subject}</h2>
              ${selected.senderId === user.id || Auth.isAdmin() ? `<button class="btn btn-sm btn-danger btn-icon" onclick="Communication.deleteMessage('${selected.id}')" title="Delete message"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <div style="font-size:13px;color:var(--gray-400);margin-top:6px">
              From: <strong>${selected.senderName}</strong> · ${fmtDate(selected.createdAt)}
              <span style="margin-left:12px">To: <strong>${_recipientLabel(selected.recipients)}</strong></span>
            </div>
          </div>
          <div class="msg-bubble ${selected.senderId === user.id ? 'mine' : ''}">
            <div class="msg-bubble-meta">
              <div class="avatar-circle" style="background:var(--primary);width:28px;height:28px;font-size:11px">${selected.senderName.charAt(0)}</div>
              <strong>${selected.senderName}</strong>
              <span>${fmtDate(selected.createdAt)}</span>
              <span class="badge badge-${selected.type==='announcement'?'warning':'primary'}" style="margin-left:auto">${selected.type}</span>
            </div>
            <p>${selected.body}</p>
          </div>

          ${Auth.isAdmin() || Auth.isTeacher() || Auth.isParent() ? `
          <div style="margin-top:20px;border-top:1px solid var(--gray-100);padding-top:16px">
            <div style="font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:10px">Reply</div>
            <textarea id="reply-body" rows="3" style="width:100%;padding:10px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical" placeholder="Type your reply…"></textarea>
            <button class="btn btn-primary" style="margin-top:8px" onclick="Communication.sendReply('${selected.id}')"><i class="fas fa-paper-plane"></i> Send Reply</button>
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

  function select(id) {
    _selected = id;
    const user = Auth.currentUser;
    const msg  = DB.getById('messages', id);
    if (msg && !msg.isRead?.[user.id]) {
      DB.update('messages', id, { isRead: { ...(msg.isRead||{}), [user.id]: true } });
    }
    _renderLayout();
  }

  function setTab(tab) {
    _tab = tab;
    _selected = null;
    _renderLayout();
  }

  function sendReply(originalId) {
    const body = document.getElementById('reply-body')?.value?.trim();
    if (!body) return showToast('Please enter a reply.', 'warning');
    const orig = DB.getById('messages', originalId);
    const user = Auth.currentUser;
    DB.insert('messages', {
      schoolId:'sch1', senderId: user.id, senderName: user.name,
      recipients: [orig.senderId],
      subject: `Re: ${orig.subject}`, body,
      type: 'direct', isRead: {}
    });
    showToast('Reply sent.', 'success');
    _renderLayout();
  }

  function composeModal() {
    const users = DB.get('users').filter(u => u.id !== Auth.currentUser.id);
    openModal(`
    <div class="modal-header"><h3><i class="fas fa-pen"></i> New Message</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Communication.send(event)">
      <div class="form-field mb-12"><label>To *</label><select name="recipient" required>
        <option value="">Select recipient…</option>
        <optgroup label="Groups">
          <option value="all">Everyone</option>
          <option value="teachers">All Teachers</option>
          <option value="parents">All Parents</option>
          <option value="students">All Students</option>
        </optgroup>
        <optgroup label="Individual Users">
          ${users.map(u=>`<option value="${u.id}">${u.name} (${u.role})</option>`).join('')}
        </optgroup>
      </select></div>
      <div class="form-field mb-12"><label>Subject *</label><input name="subject" required placeholder="Message subject…"></div>
      <div class="form-field mb-12"><label>Message *</label><textarea name="body" required rows="5" placeholder="Write your message…"></textarea></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Send Message</button>
      </div>
    </form>`, 'sm');
  }

  function announceModal() {
    openModal(`
    <div class="modal-header"><h3><i class="fas fa-bullhorn"></i> School Announcement</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <form class="modal-body" onsubmit="Communication.sendAnnouncement(event)">
      <div class="form-field mb-12"><label>Audience *</label><select name="audience">
        <option value="all">Everyone (Students, Parents, Teachers)</option>
        <option value="teachers">Teachers Only</option>
        <option value="parents">Parents Only</option>
        <option value="students">Students Only</option>
      </select></div>
      <div class="form-field mb-12"><label>Subject *</label><input name="subject" required placeholder="Announcement title…"></div>
      <div class="form-field mb-12"><label>Message *</label><textarea name="body" required rows="6" placeholder="Write your announcement…"></textarea></div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-bullhorn"></i> Send Announcement</button>
      </div>
    </form>`, 'sm');
  }

  function send(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const user = Auth.currentUser;
    DB.insert('messages', {
      schoolId:'sch1', senderId:user.id, senderName:user.name,
      recipients: [fd.get('recipient')],
      subject: fd.get('subject'), body: fd.get('body'),
      type:'direct', isRead:{}
    });
    showToast('Message sent successfully.', 'success');
    _closeModal(); _tab = 'sent'; _renderLayout();
  }

  function sendAnnouncement(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const user = Auth.currentUser;
    DB.insert('messages', {
      schoolId:'sch1', senderId:user.id, senderName:user.name,
      recipients: [fd.get('audience')],
      subject: fd.get('subject'), body: fd.get('body'),
      type:'announcement', isRead:{}
    });
    showToast('Announcement sent to all recipients.', 'success');
    _closeModal(); _renderLayout();
  }

  function deleteMessage(id) {
    confirmAction('Delete this message? This cannot be undone.', () => {
      DB.remove('messages', id);
      _selected = null;
      showToast('Message deleted.', 'info');
      _renderLayout();
    });
  }

  function _recipientLabel(recipients) {
    const map = { all:'Everyone', teachers:'All Teachers', parents:'All Parents', students:'All Students' };
    if (!recipients || !recipients.length) return 'Unknown';
    const r = recipients[0];
    if (map[r]) return map[r];
    const u = DB.getById('users', r);
    return u ? u.name : r;
  }

  function _timeAgo(d) {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff/60000);
    if (m < 60) return m+'m ago';
    const h = Math.floor(m/60);
    if (h < 24) return h+'h ago';
    return Math.floor(h/24)+'d ago';
  }

  return { render, select, setTab, sendReply, composeModal, announceModal, send, sendAnnouncement, deleteMessage };
})();
