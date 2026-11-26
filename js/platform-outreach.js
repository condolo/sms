/* ============================================================
   Msingi Platform — Outreach workspace
   Plain JS by design: /platform is the standalone operator console.
   ============================================================ */

let _outreachTab = 'leads';
let _outreachConfig = { ready: false, sender: {}, dailyLimit: 25 };
let _outreachLeadPage = 1;
let _outreachTemplatePage = 1;
let _outreachCampaignPage = 1;
const OUTREACH_PAGE_SIZE = 20;
let _outreachLeadQuery = '';
let _outreachLeadStatus = '';
const _outreachLeadCache = new Map();

function _outreachPager(pagination, onPrev, onNext) {
  if (!pagination || pagination.pages <= 1) return '';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-top:1px solid var(--line-soft);font-size:12px;color:var(--muted);">
    <span>Page ${pagination.page} of ${pagination.pages} · ${pagination.total} total</span>
    <div style="display:flex;gap:8px;">
      <button class="pa-btn pa-btn-sm" ${pagination.page <= 1 ? 'disabled' : ''} onclick="${onPrev}">Previous</button>
      <button class="pa-btn pa-btn-sm" ${pagination.page >= pagination.pages ? 'disabled' : ''} onclick="${onNext}">Next</button>
    </div>
  </div>`;
}

function outreachTemplatePage(delta) { _outreachTemplatePage = Math.max(1, _outreachTemplatePage + delta); renderOutreachTemplates(); }
function outreachCampaignPage(delta) { _outreachCampaignPage = Math.max(1, _outreachCampaignPage + delta); renderOutreachCampaigns(); }

function clearOutreachSession() {
  document.getElementById('pa-modal-bg')?.remove();
  _outreachLeadCache.clear();
  _outreachTemplatePage = 1;
  _outreachCampaignPage = 1;
  _outreachPreviousFocus = null;
}

const OUTREACH_LEAD_STATUSES = [
  ['new', 'New'], ['contacted', 'Contacted'], ['replied', 'Replied'],
  ['interested', 'Interested'], ['demo_booked', 'Demo booked'],
  ['not_interested', 'Not interested'], ['unsubscribed', 'Unsubscribed'],
  ['bounced', 'Bounced'], ['invalid', 'Invalid'],
];

function _outreachDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _outreachDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', {
    timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' EAT';
}

function _outreachStatusLabel(value) {
  return String(value || '').replace(/_/g, ' ');
}

let _outreachPreviousFocus = null;

function outreachModalKeys(event) {
  if (event.key === 'Escape') { closeModal(); return; }
  if (event.key !== 'Tab') return;
  const modal = document.getElementById('pa-modal-bg')?.querySelector('.pa-modal');
  if (!modal) return;
  const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')].filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function _outreachModal(title, body, wide = false) {
  document.getElementById('pa-modal-bg')?.remove();
  _outreachPreviousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'pa-modal-bg';
  backdrop.id = 'pa-modal-bg';
  backdrop.setAttribute('onkeydown', 'outreachModalKeys(event)');
  backdrop.innerHTML = `<div class="pa-modal${wide ? ' pa-modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="outreach-modal-title">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px;">
      <h3 id="outreach-modal-title" style="margin:0;">${_esc(title)}</h3>
      <button class="pa-btn pa-btn-icon" onclick="closeModal()" aria-label="Close"><i class="fas fa-times"></i></button>
    </div>
    ${body}
  </div>`;
  document.body.appendChild(backdrop);
  const focusTarget = backdrop.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
  focusTarget?.focus();
}

async function renderOutreach() {
  const main = document.getElementById('pa-content');
  main.innerHTML = '<div class="pa-loading"><i class="fas fa-circle-notch fa-spin"></i> Loading outreach…</div>';
  try {
    _outreachConfig = (await api('GET', '/outreach/config')).data;
    main.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:20px;">
        <div>
          <h3 style="font-size:18px;letter-spacing:-.02em;margin:0 0 6px;">Prospect school outreach</h3>
          <p style="font-size:13px;color:var(--muted);margin:0;max-width:680px;line-height:1.6;">Import school contacts, prepare branded templates and run a controlled three-touch sequence. Marking a lead replied, unsubscribed or demo-booked stops future emails automatically.</p>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          ${_can('*') ? '<button class="pa-btn" onclick="openOutreachSettings()"><i class="fas fa-gear"></i> Outreach settings</button>' : ''}
          <div class="pa-pill ${_outreachConfig.ready ? 'resolved' : 'draft'}"><i class="fas ${_outreachConfig.ready ? 'fa-circle-check' : 'fa-triangle-exclamation'}" style="margin-right:6px;"></i>${_outreachConfig.ready ? 'Sending configured' : 'Sending disabled'}</div>
        </div>
      </div>
      ${_outreachConfig.ready ? '' : `<div class="pa-error" style="margin:0 0 20px;"><strong>Sending is off.</strong> ${_can('*') ? 'Open Outreach settings to enable it and add a monitored Reply-To address.' : 'Ask a platform owner to enable it and add a monitored Reply-To address in Outreach settings.'} You can still import leads and prepare templates.</div>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;" role="tablist" aria-label="Outreach sections">
        <button class="pa-btn ${_outreachTab === 'leads' ? 'primary' : ''}" role="tab" aria-selected="${_outreachTab === 'leads'}" onclick="outreachSwitchTab('leads')"><i class="fas fa-school"></i> Leads</button>
        <button class="pa-btn ${_outreachTab === 'templates' ? 'primary' : ''}" role="tab" aria-selected="${_outreachTab === 'templates'}" onclick="outreachSwitchTab('templates')"><i class="fas fa-palette"></i> Templates</button>
        <button class="pa-btn ${_outreachTab === 'campaigns' ? 'primary' : ''}" role="tab" aria-selected="${_outreachTab === 'campaigns'}" onclick="outreachSwitchTab('campaigns')"><i class="fas fa-paper-plane"></i> Campaigns</button>
        <button class="pa-btn ${_outreachTab === 'suppressions' ? 'primary' : ''}" role="tab" aria-selected="${_outreachTab === 'suppressions'}" onclick="outreachSwitchTab('suppressions')"><i class="fas fa-ban"></i> Suppressions</button>
      </div>
      <div id="outreach-panel"></div>`;
    await _renderOutreachTab();
  } catch (error) {
    main.innerHTML = `<div class="pa-error">${_esc(error.message || 'Could not load outreach.')}</div>`;
  }
}

function openOutreachSettings() {
  const settings = _outreachConfig.settings || {};
  _outreachModal('Outreach settings', `
    <form id="outreach-settings-form" onsubmit="event.preventDefault();outreachSaveSettings();">
      <div class="pa-panel" style="padding:14px;margin:0 0 16px;">
        <label style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--text);">
          <input id="outreach-enabled" type="checkbox" ${settings.enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--primary);">
          Enable outreach sending
        </label>
        <p style="font-size:11px;color:var(--muted);margin:7px 0 0 26px;line-height:1.6;">When disabled, due emails are held safely instead of sent.</p>
      </div>
      <div class="pa-field"><label for="outreach-reply-to">Monitored Reply-To</label><input id="outreach-reply-to" type="email" value="${_esc(settings.replyTo || '')}" placeholder="sales@msingi.io"><p style="font-size:11px;color:var(--faint);margin:5px 0 0;">Replies go to this human inbox. Required when sending is enabled.</p></div>
      <div class="pa-form-row"><div class="pa-field"><label for="outreach-from-name">Sender display name</label><input id="outreach-from-name" maxlength="120" value="${_esc(settings.fromName || '')}"></div><div class="pa-field"><label for="outreach-from-role">Sender role</label><input id="outreach-from-role" maxlength="120" value="${_esc(settings.fromRole || '')}"></div></div>
      <div class="pa-field"><label for="outreach-logo-url">Logo URL</label><input id="outreach-logo-url" type="url" maxlength="500" value="${_esc(settings.logoUrl || '')}"></div>
      <div class="pa-form-row"><div class="pa-field"><label for="outreach-phone">Call / WhatsApp phone</label><input id="outreach-phone" maxlength="50" value="${_esc(settings.phone || '')}"></div><div class="pa-field"><label for="outreach-daily-limit">Daily sending limit</label><input id="outreach-daily-limit" type="number" min="1" max="100" value="${Number(settings.dailyLimit) || 25}"></div></div>
      <div class="pa-field"><label for="outreach-trust-line">Trust line</label><input id="outreach-trust-line" maxlength="300" value="${_esc(settings.trustLine || '')}"></div>
      <div class="pa-field"><label for="outreach-pricing-line">Pricing line</label><input id="outreach-pricing-line" maxlength="300" value="${_esc(settings.pricingLine || '')}"></div>
      <div class="pa-form-row"><div class="pa-field"><label for="outreach-legal-name">Legal sender name</label><input id="outreach-legal-name" maxlength="200" value="${_esc(settings.legalName || '')}"></div><div class="pa-field"><label for="outreach-postal-address">Postal address</label><input id="outreach-postal-address" maxlength="300" value="${_esc(settings.postalAddress || '')}"></div></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;"><button type="button" class="pa-btn" onclick="closeModal()">Cancel</button><button class="pa-btn primary" type="submit"><i class="fas fa-save"></i> Save settings</button></div>
    </form>`, true);
}

async function outreachSaveSettings() {
  const value = id => document.getElementById(id)?.value.trim() || '';
  const input = {
    enabled: document.getElementById('outreach-enabled')?.checked === true,
    replyTo: value('outreach-reply-to'),
    fromName: value('outreach-from-name'),
    fromRole: value('outreach-from-role'),
    logoUrl: value('outreach-logo-url'),
    phone: value('outreach-phone'),
    dailyLimit: Number(value('outreach-daily-limit') || 25),
    trustLine: value('outreach-trust-line'),
    pricingLine: value('outreach-pricing-line'),
    legalName: value('outreach-legal-name'),
    postalAddress: value('outreach-postal-address'),
  };
  try {
    _outreachConfig.settings = (await api('PUT', '/outreach/settings', input)).data;
    _outreachConfig.dailyLimit = _outreachConfig.settings.dailyLimit;
    closeModal();
    toast('Outreach settings saved.', 'success');
    renderOutreach();
  } catch (error) {
    toast(error.message || 'Could not save outreach settings.', 'error');
  }
}

function outreachSwitchTab(tab) {
  _outreachTab = tab;
  renderOutreach();
}

async function _renderOutreachTab() {
  if (_outreachTab === 'templates') return renderOutreachTemplates();
  if (_outreachTab === 'campaigns') return renderOutreachCampaigns();
  if (_outreachTab === 'suppressions') return renderOutreachSuppressions();
  return renderOutreachLeads();
}

async function renderOutreachLeads() {
  const panel = document.getElementById('outreach-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="pa-loading">Loading leads…</div>';
  try {
    const query = new URLSearchParams({ page: String(_outreachLeadPage), pageSize: '50' });
    if (_outreachLeadQuery) query.set('q', _outreachLeadQuery);
    if (_outreachLeadStatus) query.set('status', _outreachLeadStatus);
    const [statsResponse, result] = await Promise.all([
      api('GET', '/outreach/leads/stats'),
      api('GET', '/outreach/leads?' + query.toString()),
    ]);
    const stats = statsResponse.data || {};
    const leads = result.data || [];
    _outreachLeadCache.clear();
    leads.forEach(lead => _outreachLeadCache.set(lead.id, lead));
    const pagination = result.pagination || { page: 1, pages: 1, total: 0 };
    const statCard = (label, value) => `<div class="pa-stat-card"><div class="pa-stat-label">${label}</div><div class="pa-stat-value">${Number(value || 0)}</div></div>`;
    panel.innerHTML = `
      <div class="pa-stats outreach-stats">
        ${statCard('Total prospects', stats.total)}
        ${statCard('Contacted', stats.contacted)}
        ${statCard('Replied / interested', stats.replied)}
        ${statCard('Demos booked', stats.demos)}
        ${statCard('Unsubscribed', stats.unsubscribed)}
      </div>
      <div class="pa-card">
        <div class="pa-card-header">
          <h3>Leads (${pagination.total})</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${_can('outreach.manage') ? '<button class="pa-btn" onclick="openOutreachImport()"><i class="fas fa-file-import"></i> Import CSV</button><button class="pa-btn" onclick="openOutreachLead()"><i class="fas fa-plus"></i> Add lead</button>' : ''}
          </div>
        </div>
        <div style="display:flex;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line-soft);flex-wrap:wrap;">
          <input id="outreach-search" class="pa-input" style="flex:1;min-width:220px;" placeholder="Search school, contact, email or phone" value="${_esc(_outreachLeadQuery)}" onkeydown="if(event.key==='Enter'){_outreachLeadPage=1;_outreachLeadQuery=this.value.trim();renderOutreachLeads();}">
          <select class="pa-input" style="max-width:190px;" onchange="_outreachLeadPage=1;_outreachLeadStatus=this.value;renderOutreachLeads();">
            <option value="">All statuses</option>
            ${OUTREACH_LEAD_STATUSES.map(([value, label]) => `<option value="${value}" ${_outreachLeadStatus === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <button class="pa-btn" aria-label="Search leads" onclick="_outreachLeadPage=1;_outreachLeadQuery=document.getElementById('outreach-search').value.trim();renderOutreachLeads();"><i class="fas fa-search"></i></button>
        </div>
        <div class="pa-table-wrap">
          <table class="pa-table outreach-leads-table">
            <thead><tr><th>School</th><th>Contact</th><th>Status</th><th>Next follow-up</th><th>Actions</th></tr></thead>
            <tbody>${leads.length ? leads.map(_outreachLeadRow).join('') : `<tr><td colspan="5"><div class="pa-empty"><i class="fas fa-school"></i><p>${(_outreachLeadQuery || _outreachLeadStatus) ? 'No leads match these filters.' : 'No leads yet. Import a CSV to get started.'}</p></div></td></tr>`}</tbody>
          </table>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-top:1px solid var(--line-soft);font-size:12px;color:var(--muted);">
          <span>Page ${pagination.page} of ${pagination.pages}</span>
          <div style="display:flex;gap:8px;">
            <button class="pa-btn pa-btn-sm" ${pagination.page <= 1 ? 'disabled' : ''} onclick="_outreachLeadPage--;renderOutreachLeads();">Previous</button>
            <button class="pa-btn pa-btn-sm" ${pagination.page >= pagination.pages ? 'disabled' : ''} onclick="_outreachLeadPage++;renderOutreachLeads();">Next</button>
          </div>
        </div>
      </div>`;
  } catch (error) {
    panel.innerHTML = `<div class="pa-error">${_esc(error.message || 'Could not load leads.')}</div>`;
  }
}

function _outreachLeadRow(lead) {
  return `<tr>
    <td><strong style="color:var(--text);">${_esc(lead.schoolName)}</strong><div style="font-size:11px;color:var(--faint);margin-top:3px;">${_esc([lead.city, lead.country].filter(Boolean).join(', ') || lead.curriculum || '—')}</div><div style="font-size:11px;color:var(--faint);margin-top:2px;">Owner: ${_esc(lead.ownerName || 'Unassigned')}</div></td>
    <td>${_esc(lead.contactName || 'School office')}<div style="font-size:11px;color:var(--faint);margin-top:3px;">${_esc(lead.email)}</div></td>
    <td><span class="pa-pill ${_esc(lead.status)}">${_esc(_outreachStatusLabel(lead.status))}</span></td>
    <td>${_outreachDate(lead.nextFollowUpAt)}</td>
    <td><button class="pa-btn pa-btn-sm" onclick="openOutreachLead('${_esc(lead.id)}')"><i class="fas fa-eye"></i> Open</button></td>
  </tr>`;
}

function openOutreachImport() {
  _outreachModal('Import prospect schools', `
    <p>Paste CSV data with <strong>school_name</strong> and <strong>email</strong> columns. Optional columns: contact_name, phone, role, city, country, school_size, curriculum, website, source, notes.</p>
    <div class="pa-field"><label for="outreach-csv">CSV data</label><textarea id="outreach-csv" class="pa-input" rows="9" style="resize:vertical;font-family:ui-monospace,monospace;font-size:12px;" placeholder="school_name,email,contact_name,role,city,curriculum&#10;Example School,office@example.com,,Principal,Nairobi,CBC"></textarea></div>
    <div style="display:flex;justify-content:space-between;gap:10px;margin-top:16px;">
      <button class="pa-btn" onclick="outreachDownloadSample()"><i class="fas fa-download"></i> Sample CSV</button>
      <div style="display:flex;gap:8px;"><button class="pa-btn" onclick="closeModal()">Cancel</button><button class="pa-btn primary" onclick="outreachImportCsv()"><i class="fas fa-file-import"></i> Import</button></div>
    </div>`);
}

function outreachDownloadSample() {
  const sample = 'school_name,email,contact_name,role,city,country,school_size,curriculum,website,source,notes\nExample School,office@example.com,,Principal,Nairobi,Kenya,500,CBC,https://example.school,Manual,Interested in a term-end review\n';
  const url = URL.createObjectURL(new Blob([sample], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'msingi-prospect-schools.csv';
  link.click();
  URL.revokeObjectURL(url);
}

async function outreachImportCsv() {
  const csv = document.getElementById('outreach-csv')?.value.trim();
  if (!csv) return toast('Paste CSV data first.', 'error');
  try {
    const result = (await api('POST', '/outreach/leads/import', { csv })).data;
    const details = (result.errors || []).map(item => `Row ${item.row}: ${item.message}`).join('\n');
    closeModal();
    toast(`Imported ${result.created} new, updated ${result.updated}, skipped ${result.skipped}, suppressed ${result.suppressed}.`, 'success');
    if (result.errorCount) _outreachModal('Import completed with errors', `<p>Showing the first ${(result.errors || []).length} of ${result.errorCount} failed row(s).</p><pre style="white-space:pre-wrap;font-size:12px;background:var(--surface-2);padding:12px;border-radius:8px;">${_esc(details)}</pre>`);
    _outreachLeadPage = 1;
    renderOutreachLeads();
  } catch (error) {
    toast(error.message || 'Import failed.', 'error');
  }
}

async function openOutreachLead(id) {
  try {
    let lead = id ? { ...(_outreachLeadCache.get(id) || {}) } : {
      id: '', schoolName: '', contactName: '', email: '', phone: '', role: '', city: '', country: '', schoolSize: '', curriculum: '', website: '', source: 'Manual', ownerName: '', status: 'new', nextFollowUpAt: '', demoRequestId: '', notes: [],
    };
    let stale = false;
    if (id) {
      try {
        const detail = (await api('GET', '/outreach/leads/' + encodeURIComponent(id))).data;
        if (detail?.id) lead = { ...lead, ...detail };
        else if (!lead.id) throw new Error('Lead details were not returned.');
      } catch (error) {
        if (!lead.id || (error.status && error.status < 500)) throw error;
        stale = true;
        toast('Could not refresh this lead; showing loaded list details in read-only mode.', 'info');
      }
    }
    let demoRequests = [];
    try { demoRequests = (await api('GET', '/demo-requests?limit=500')).requests || []; } catch (error) { if (error?.status === 401 || error?.message === 'PLATFORM_SESSION_EXPIRED') throw error; /* optional picker */ }
    const statusOptions = OUTREACH_LEAD_STATUSES.map(([value, label]) => `<option value="${value}" ${lead.status === value ? 'selected' : ''}>${label}</option>`).join('');
    const notes = (lead.notes || []).slice().reverse().map(note => `<div style="border-left:3px solid var(--primary);padding:8px 12px;margin-bottom:8px;background:var(--surface-2);border-radius:6px;"><p style="margin:0 0 4px;font-size:12px;font-weight:700;">${_esc(note.authorName)} · ${_outreachDateTime(note.createdAt)}</p><p style="margin:0;font-size:13px;white-space:pre-wrap;">${_esc(note.body)}</p></div>`).join('') || '<p style="font-size:12px;color:var(--faint);">No notes yet.</p>';
    _outreachModal(id ? 'Lead details' : 'Add lead', `
      <form id="outreach-lead-form" onsubmit="event.preventDefault();outreachSaveLead('${_esc(lead.id)}');">
        <div class="pa-form-row"><div class="pa-field"><label>School name</label><input name="schoolName" required maxlength="200" value="${_esc(lead.schoolName)}"></div><div class="pa-field"><label>Contact name</label><input name="contactName" maxlength="160" value="${_esc(lead.contactName)}"></div></div>
        <div class="pa-form-row"><div class="pa-field"><label>Email</label><input name="email" type="email" required maxlength="300" value="${_esc(lead.email)}"></div><div class="pa-field"><label>Phone</label><input name="phone" maxlength="50" value="${_esc(lead.phone)}"></div></div>
        <div class="pa-form-row"><div class="pa-field"><label>Role</label><input name="role" maxlength="100" value="${_esc(lead.role)}" placeholder="Principal, Director, School office…"></div><div class="pa-field"><label>Status</label><select name="status">${statusOptions}</select></div></div>
        <div class="pa-form-row"><div class="pa-field"><label>City</label><input name="city" maxlength="100" value="${_esc(lead.city)}"></div><div class="pa-field"><label>Country</label><input name="country" maxlength="100" value="${_esc(lead.country)}"></div></div>
        <div class="pa-form-row"><div class="pa-field"><label>School size</label><input name="schoolSize" maxlength="60" value="${_esc(lead.schoolSize)}"></div><div class="pa-field"><label>Curriculum</label><input name="curriculum" maxlength="120" value="${_esc(lead.curriculum)}"></div></div>
        <div class="pa-form-row"><div class="pa-field"><label>Owner</label><input name="ownerName" maxlength="160" value="${_esc(lead.ownerName)}"></div><div class="pa-field"><label>Next follow-up</label><input name="nextFollowUpAt" type="date" value="${_esc(lead.nextFollowUpAt ? String(lead.nextFollowUpAt).slice(0, 10) : '')}"></div></div>
        <div class="pa-field"><label>Demo request</label><input name="demoRequestId" list="outreach-demo-list" maxlength="120" value="${_esc(lead.demoRequestId)}" placeholder="Search by school name or paste an ID"><datalist id="outreach-demo-list">${demoRequests.map(request => `<option value="${_esc(request.id)}">${_esc(request.schoolName || request.email || request.id)}</option>`).join('')}</datalist></div>
        ${id ? `<p style="font-size:11px;color:var(--faint);margin:8px 0 0;">Lead ID: <code>${_esc(lead.id)}</code> <button type="button" class="pa-btn pa-btn-sm" onclick="outreachCopyText('${_esc(lead.id)}')"><i class="fas fa-copy"></i> Copy</button></p>` : ''}
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;"><button type="button" class="pa-btn" onclick="closeModal()">Cancel</button><button class="pa-btn primary" type="submit"><i class="fas fa-save"></i> Save lead</button></div>
      </form>
      ${id ? `<div style="margin-top:22px;border-top:1px solid var(--line);padding-top:18px;"><h4 style="font-size:13px;margin:0 0 10px;">Activity notes</h4>${lead.importNotes ? `<div style="margin-bottom:12px;padding:10px 12px;background:var(--warning-tint);border-radius:8px;font-size:12px;line-height:1.6;"><strong>Imported note:</strong> ${_esc(lead.importNotes)}</div>` : ''}${notes}<div class="pa-field"><label for="outreach-note">Add note</label><textarea id="outreach-note" class="pa-input" rows="3" maxlength="4000" placeholder="Call outcome, reply summary, next action…"></textarea></div><button class="pa-btn" style="margin-top:10px;" onclick="outreachAddNote('${_esc(lead.id)}')"><i class="fas fa-plus"></i> Add note</button></div>` : ''}
    `, true);
    if (stale) {
      const modal = document.getElementById('pa-modal-bg')?.querySelector('.pa-modal');
      modal?.insertAdjacentHTML('afterbegin', '<div style="margin:0 0 16px;padding:10px 12px;background:var(--warning-tint);border-radius:8px;font-size:12px;line-height:1.6;color:#b54708;">These details came from the loaded list and could not be refreshed. The form is read-only to prevent stale edits.</div>');
      modal?.querySelectorAll('input, select, textarea, button[type="submit"], button[onclick^="outreachAddNote"]').forEach(control => { control.disabled = true; });
    }
  } catch (error) {
    toast(error.message || 'Could not open lead.', 'error');
  }
}

async function outreachCopyText(value) {
  try { await navigator.clipboard.writeText(value); toast('Copied.', 'success'); }
  catch (error) { toast('Could not copy automatically.', 'error'); }
}

async function outreachSaveLead(id) {
  const form = document.getElementById('outreach-lead-form');
  if (!form) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.nextFollowUpAt) data.nextFollowUpAt = new Date(data.nextFollowUpAt + 'T09:00:00').toISOString();
  else data.nextFollowUpAt = null;
  try {
    if (id) await api('PATCH', '/outreach/leads/' + encodeURIComponent(id), data);
    else await api('POST', '/outreach/leads', data);
    closeModal();
    toast(id ? 'Lead updated.' : 'Lead added.', 'success');
    renderOutreachLeads();
  } catch (error) {
    toast(error.message || 'Could not save lead.', 'error');
  }
}

async function outreachAddNote(id) {
  const body = document.getElementById('outreach-note')?.value.trim();
  if (!body) return toast('Write a note first.', 'error');
  try {
    await api('POST', `/outreach/leads/${encodeURIComponent(id)}/notes`, { body });
    toast('Note added.', 'success');
    openOutreachLead(id);
  } catch (error) {
    toast(error.message || 'Could not add note.', 'error');
  }
}

async function renderOutreachTemplates() {
  const panel = document.getElementById('outreach-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="pa-loading">Loading templates…</div>';
  try {
    const result = await api('GET', `/outreach/templates?page=${_outreachTemplatePage}&pageSize=${OUTREACH_PAGE_SIZE}`);
    const templates = result.data || [];
    panel.innerHTML = `<div class="pa-card"><div class="pa-card-header"><h3>Branded email templates</h3>${_can('outreach.manage') ? '<button class="pa-btn primary" onclick="openOutreachTemplate()"><i class="fas fa-plus"></i> New template</button>' : ''}</div>
      <div style="padding:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
        ${(templates || []).map(template => `<div class="pa-panel" style="margin:0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;"><div><span class="pa-pill ${template.category === 'followup' ? 'waiting' : 'open'}">${_esc(template.category)}</span><h3 style="margin:10px 0 6px;">${_esc(template.name)}</h3></div></div>
          <p style="font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 10px;">${_esc(template.description || '')}</p>
          <p style="font-size:12px;color:var(--text);margin:0 0 14px;"><strong>${_esc(template.subject)}</strong></p>
          <div style="display:flex;gap:7px;flex-wrap:wrap;"><button class="pa-btn pa-btn-sm" onclick="outreachPreviewTemplate('${_esc(template.id)}')"><i class="fas fa-eye"></i> Preview</button>${_can('outreach.manage') ? `<button class="pa-btn pa-btn-sm" onclick="openOutreachTemplate('${_esc(template.id)}')"><i class="fas fa-pen"></i> Edit</button>` : ''}${_can('outreach.send') ? `<button class="pa-btn pa-btn-sm" onclick="outreachOpenTest('${_esc(template.id)}')"><i class="fas fa-paper-plane"></i> Test</button>` : ''}</div>
        </div>`).join('')}
      </div>
      ${_outreachPager(result.pagination, 'outreachTemplatePage(-1)', 'outreachTemplatePage(1)')}
    </div>`;
  } catch (error) {
    panel.innerHTML = `<div class="pa-error">${_esc(error.message || 'Could not load templates.')}</div>`;
  }
}

async function openOutreachTemplate(id) {
  try {
    const template = id ? (await api('GET', '/outreach/templates/' + encodeURIComponent(id))).data : {
      id: '', name: '', description: '', category: 'initial', subject: '', preheader: '', headline: '', intro: '', benefits: [{ title: '', body: '' }], ctaLabel: 'Book a 30-minute demo', ctaUrl: '{{demo_url}}', closing: '',
    };
    const benefits = [0, 1, 2].map(index => {
      const benefit = template.benefits?.[index] || { title: '', body: '' };
      return `<div class="pa-panel" style="padding:14px;margin:0;"><div style="font-size:11px;font-weight:700;color:var(--faint);margin-bottom:8px;">BENEFIT ${index + 1}${index > 0 ? ' (optional)' : ''}</div><div class="pa-field"><label>Title</label><input name="benefitTitle${index}" maxlength="120" value="${_esc(benefit.title)}"></div><div class="pa-field" style="margin-top:8px;"><label>Description</label><input name="benefitBody${index}" maxlength="500" value="${_esc(benefit.body)}"></div></div>`;
    }).join('');
    _outreachModal(id ? 'Edit template' : 'New template', `
      <form id="outreach-template-form" onsubmit="event.preventDefault();outreachSaveTemplate('${_esc(template.id)}');">
        <div class="pa-form-row"><div class="pa-field"><label>Name</label><input name="name" required maxlength="120" value="${_esc(template.name)}"></div><div class="pa-field"><label>Type</label><select name="category"><option value="initial" ${template.category === 'initial' ? 'selected' : ''}>Initial email</option><option value="followup" ${template.category === 'followup' ? 'selected' : ''}>Follow-up</option></select></div></div>
        <div class="pa-field"><label>Description</label><input name="description" maxlength="300" value="${_esc(template.description)}"></div>
        <div class="pa-field"><label>Subject</label><input name="subject" required maxlength="200" value="${_esc(template.subject)}"></div>
        <div class="pa-field"><label>Preheader</label><input name="preheader" maxlength="300" value="${_esc(template.preheader)}"></div>
        <div class="pa-field"><label>Headline</label><input name="headline" required maxlength="200" value="${_esc(template.headline)}"></div>
        <div class="pa-field"><label>Introduction</label><textarea name="intro" required rows="4" maxlength="3000" class="pa-input" style="resize:vertical;">${_esc(template.intro)}</textarea></div>
        <div style="display:grid;gap:10px;">${benefits}</div>
        <div class="pa-form-row"><div class="pa-field"><label>CTA label</label><input name="ctaLabel" required maxlength="80" value="${_esc(template.ctaLabel)}"></div><div class="pa-field"><label>CTA URL</label><input name="ctaUrl" required maxlength="500" value="${_esc(template.ctaUrl)}"></div></div>
        <div class="pa-field"><label>Closing</label><textarea name="closing" required rows="3" maxlength="2000" class="pa-input" style="resize:vertical;">${_esc(template.closing)}</textarea></div>
        <p style="font-size:11px;color:var(--faint);line-height:1.6;margin:10px 0 0;">Placeholders: {{first_name}}, {{school_name}}, {{city}}, {{country}}, {{curriculum}}, {{sender_name}}, {{demo_url}}, {{platform_url}}.</p>
        <div style="display:flex;justify-content:space-between;gap:8px;margin-top:18px;flex-wrap:wrap;">${id ? `<button type="button" class="pa-btn" onclick="outreachPreviewTemplate('${_esc(template.id)}')"><i class="fas fa-eye"></i> Preview saved</button>` : '<span></span>'}<div style="display:flex;gap:8px;"><button type="button" class="pa-btn" onclick="closeModal()">Cancel</button><button class="pa-btn primary" type="submit"><i class="fas fa-save"></i> Save template</button></div></div>
      </form>`, true);
  } catch (error) {
    toast(error.message || 'Could not open template.', 'error');
  }
}

async function outreachSaveTemplate(id) {
  const form = document.getElementById('outreach-template-form');
  if (!form) return;
  const raw = Object.fromEntries(new FormData(form).entries());
  const input = { ...raw, benefits: [0, 1, 2].map(index => ({ title: raw[`benefitTitle${index}`] || '', body: raw[`benefitBody${index}`] || '' })).filter(item => item.title.trim() || item.body.trim()) };
  delete input.benefitTitle0; delete input.benefitTitle1; delete input.benefitTitle2;
  delete input.benefitBody0; delete input.benefitBody1; delete input.benefitBody2;
  try {
    if (id) await api('PATCH', '/outreach/templates/' + encodeURIComponent(id), input);
    else await api('POST', '/outreach/templates', input);
    closeModal();
    toast('Template saved.', 'success');
    renderOutreachTemplates();
  } catch (error) {
    toast(error.message || 'Could not save template.', 'error');
  }
}

async function outreachPreviewTemplate(id, leadId = '') {
  try {
    const preview = (await api('POST', `/outreach/templates/${encodeURIComponent(id)}/preview`, { leadId: leadId || undefined })).data;
    const leads = (await api('GET', '/outreach/leads?pageSize=100')).data || [];
    _outreachModal('Email preview', `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="pa-btn pa-btn-sm primary" onclick="outreachSetPreviewWidth('desktop')">Desktop</button>
        <button class="pa-btn pa-btn-sm" onclick="outreachSetPreviewWidth('mobile')">Mobile</button>
        <select class="pa-input" style="max-width:260px;" onchange="outreachPreviewTemplate('${_esc(id)}', this.value)"><option value="">Sample data</option>${leads.map(lead => `<option value="${_esc(lead.id)}" ${leadId === lead.id ? 'selected' : ''}>${_esc(lead.schoolName)}</option>`).join('')}</select>
      </div>
      ${leadId ? '' : '<p style="font-size:11px;color:var(--faint);margin:0 0 10px;">Previewing sample data. Choose a lead to test real merge fields.</p>'}
      <div style="background:#e8eaf3;padding:12px;border-radius:10px;"><div id="outreach-preview-frame" style="width:100%;height:560px;overflow:auto;border-radius:8px;background:#fff;"></div></div>
      <p style="font-size:12px;color:var(--muted);margin:12px 0 0;"><strong>Subject:</strong> ${_esc(preview.subject)}</p>`, true);
    const frame = document.getElementById('outreach-preview-frame');
    const shadow = frame.attachShadow({ mode: 'open' });
    const documentPreview = new DOMParser().parseFromString(preview.html, 'text/html');
    shadow.innerHTML = `${documentPreview.head.innerHTML}${documentPreview.body.innerHTML}`;
  } catch (error) {
    toast(error.message || 'Could not render preview.', 'error');
  }
}

function outreachSetPreviewWidth(width) {
  const frame = document.getElementById('outreach-preview-frame');
  if (frame) frame.style.width = width === 'mobile' ? 'min(375px,100%)' : '100%';
}

function outreachOpenTest(id) {
  _outreachModal('Send a test email', `<p>Send the saved template to an internal inbox before launching a campaign.</p><div class="pa-field"><label>Test recipient</label><input id="outreach-test-email" type="email" placeholder="you@msingi.io"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;"><button class="pa-btn" onclick="closeModal()">Cancel</button><button class="pa-btn primary" onclick="outreachSendTest('${_esc(id)}')"><i class="fas fa-paper-plane"></i> Send test</button></div>`);
}

async function outreachSendTest(id) {
  const to = document.getElementById('outreach-test-email')?.value.trim();
  if (!to) return toast('Enter a test email address.', 'error');
  try {
    await api('POST', `/outreach/templates/${encodeURIComponent(id)}/test`, { to });
    closeModal();
    toast('Test email sent.', 'success');
  } catch (error) {
    toast(error.message || 'Test email failed.', 'error');
  }
}

async function renderOutreachCampaigns() {
  const panel = document.getElementById('outreach-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="pa-loading">Loading campaigns…</div>';
  try {
    const result = await api('GET', `/outreach/campaigns?page=${_outreachCampaignPage}&pageSize=${OUTREACH_PAGE_SIZE}`);
    const campaigns = result.data || [];
    panel.innerHTML = `<div class="pa-card"><div class="pa-card-header"><h3>Campaigns</h3>${_can('outreach.manage') ? '<button class="pa-btn primary" onclick="openOutreachCampaign()"><i class="fas fa-plus"></i> New campaign</button>' : ''}</div>
      ${(campaigns || []).length ? `<div class="pa-table-wrap"><table class="pa-table"><thead><tr><th>Campaign</th><th>Status</th><th>Recipients</th><th>Emails</th><th>Failed</th><th>Launch</th><th>Actions</th></tr></thead><tbody>${campaigns.map(campaign => `<tr><td><strong>${_esc(campaign.name)}</strong><div style="font-size:11px;color:var(--faint);margin-top:3px;">${campaign.steps?.length || 0} email sequence · ${_esc(campaign.audience)}</div></td><td><span class="pa-pill ${_esc(campaign.status)}">${_esc(campaign.status)}</span></td><td>${campaign.stats?.recipients || 0}</td><td>${campaign.stats?.sent || 0}</td><td>${campaign.stats?.failed || 0}</td><td>${_outreachDateTime(campaign.scheduledAt)}</td><td><button class="pa-btn pa-btn-sm" onclick="openOutreachCampaignDetail('${_esc(campaign.id)}')"><i class="fas fa-eye"></i> Open</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="pa-empty"><i class="fas fa-paper-plane"></i><p>No campaigns yet. Start with the three-touch default sequence.</p></div>'}
      ${_outreachPager(result.pagination, 'outreachCampaignPage(-1)', 'outreachCampaignPage(1)')}
    </div>`;
  } catch (error) {
    panel.innerHTML = `<div class="pa-error">${_esc(error.message || 'Could not load campaigns.')}</div>`;
  }
}

async function openOutreachCampaign() {
  try {
    const templates = (await api('GET', '/outreach/templates')).data || [];
    const initial = templates.filter(template => template.category === 'initial');
    const followups = templates.filter(template => template.category === 'followup');
    const options = (list, defaultKey) => list.map(template => `<option value="${_esc(template.id)}" ${template.key === defaultKey ? 'selected' : ''}>${_esc(template.name)}</option>`).join('');
    _outreachModal('New outreach campaign', `<form id="outreach-campaign-form" onsubmit="event.preventDefault();outreachCreateCampaign();">
      <div class="pa-field"><label>Campaign name</label><input name="name" required maxlength="160" placeholder="November prospect schools"></div>
      <div class="pa-field"><label>Email 1 — introduction</label><select name="template1" required>${options(initial, 'general-intro')}</select></div>
      <div class="pa-field"><label>Email 2 — day 4</label><select name="template2" required>${options(followups, 'followup-value')}</select></div>
      <div class="pa-field"><label>Email 3 — day 9</label><select name="template3" required>${options(followups, 'followup-close')}</select></div>
      <div class="pa-field"><label>Selected lead IDs (optional)</label><textarea name="leadIds" rows="3" class="pa-input" placeholder="Leave blank for all eligible prospects. Otherwise paste IDs copied from lead details, separated by commas or new lines."></textarea><p style="font-size:11px;color:var(--faint);margin:5px 0 0;">Open a lead to copy its ID.</p></div>
      <div class="pa-field"><label>Daily sending limit</label><input name="dailyLimit" type="number" min="1" max="100" value="${_outreachConfig.dailyLimit || 25}"><p style="font-size:11px;color:var(--faint);margin:5px 0 0;">Recommended: 25–35 per day on the current SMTP account.</p></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;"><button type="button" class="pa-btn" onclick="closeModal()">Cancel</button><button class="pa-btn primary" type="submit"><i class="fas fa-plus"></i> Create draft</button></div>
    </form>`, true);
  } catch (error) {
    toast(error.message || 'Could not open campaign builder.', 'error');
  }
}

async function outreachCreateCampaign() {
  const form = document.getElementById('outreach-campaign-form');
  if (!form) return;
  const raw = Object.fromEntries(new FormData(form).entries());
  const leadIds = String(raw.leadIds || '').split(/[\s,]+/).map(value => value.trim()).filter(Boolean);
  try {
    await api('POST', '/outreach/campaigns', { name: raw.name, templateIds: [raw.template1, raw.template2, raw.template3], dailyLimit: Number(raw.dailyLimit), ...(leadIds.length ? { leadIds } : {}) });
    closeModal();
    toast('Campaign draft created.', 'success');
    renderOutreachCampaigns();
  } catch (error) {
    toast(error.message || 'Could not create campaign.', 'error');
  }
}

let _outreachSendPage = 1;
let _outreachSendStatus = '';

async function openOutreachCampaignDetail(id, page = 1, status = '') {
  try {
    _outreachSendPage = page;
    _outreachSendStatus = status;
    const query = new URLSearchParams({ page: String(page), pageSize: '200' });
    if (status) query.set('status', status);
    const campaign = (await api('GET', '/outreach/campaigns/' + encodeURIComponent(id) + '?' + query.toString())).data;
    const stats = campaign.stats || {};
    const actions = [];
    if (['paused', 'attention'].includes(campaign.status) && _can('outreach.send')) actions.push(`<button class="pa-btn primary" onclick="outreachCampaignAction('${_esc(campaign.id)}','resume')"><i class="fas fa-play"></i> Resume</button>`);
    if (campaign.status === 'draft' && _can('outreach.send')) actions.push(`<button class="pa-btn primary" onclick="outreachOpenLaunch('${_esc(campaign.id)}', ${Number(campaign.dailyLimit) || 25})"><i class="fas fa-play"></i> Launch</button>`);
    if (campaign.status === 'running' && _can('outreach.send')) actions.push(`<button class="pa-btn" onclick="outreachCampaignAction('${_esc(campaign.id)}','pause')"><i class="fas fa-pause"></i> Pause</button>`);
    if (['draft', 'running', 'paused', 'attention', 'launching'].includes(campaign.status) && _can('outreach.send')) actions.push(`<button class="pa-btn danger" onclick="outreachCampaignAction('${_esc(campaign.id)}','cancel')"><i class="fas fa-times"></i> Cancel</button>`);
    const sends = (campaign.sends || []).map(send => `<tr><td>${_esc(send.lead?.schoolName || send.schoolName)}<div style="font-size:11px;color:var(--faint);">${_esc(send.email)}</div></td><td>Email ${send.stepIndex + 1}</td><td><span class="pa-pill ${_esc(send.status)}">${_esc(send.status)}</span></td><td>${_outreachDateTime(send.sentAt || send.runAt)}</td><td>${_esc(send.lastError || send.skipReason || '—')}</td><td>${['failed', 'needs_review', 'held'].includes(send.status) && _can('outreach.send') ? `<button class="pa-btn pa-btn-sm" onclick="outreachRetrySend('${_esc(send.id)}')">Retry</button>` : ''}${send.status === 'sent' && _can('outreach.manage') ? `<button class="pa-btn pa-btn-sm" onclick="outreachRecordOutcome('${_esc(send.id)}','replied')">Replied</button> <button class="pa-btn pa-btn-sm" onclick="outreachRecordOutcome('${_esc(send.id)}','bounced')">Bounced</button> <button class="pa-btn pa-btn-sm" onclick="outreachRecordOutcome('${_esc(send.id)}','unsubscribed')">Unsubscribed</button>` : ''}</td></tr>`).join('');
    _outreachModal(campaign.name, `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">${actions.join('')}</div>
      <div class="pa-stats" style="margin-bottom:18px;"><div class="pa-stat-card"><div class="pa-stat-label">Recipients</div><div class="pa-stat-value">${stats.recipients || 0}</div></div><div class="pa-stat-card"><div class="pa-stat-label">Emails</div><div class="pa-stat-value">${stats.total || 0}</div></div><div class="pa-stat-card"><div class="pa-stat-label">Queued</div><div class="pa-stat-value">${stats.queued || 0}</div></div><div class="pa-stat-card"><div class="pa-stat-label">Failed</div><div class="pa-stat-value">${stats.failed || 0}</div></div></div>
      <p style="font-size:12px;color:var(--muted);margin:0 0 14px;">Status: <strong>${_esc(campaign.status)}</strong> · Daily limit: <strong>${campaign.dailyLimit}</strong> · Launch: ${_outreachDateTime(campaign.scheduledAt)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <select class="pa-input" style="max-width:180px;" onchange="openOutreachCampaignDetail('${_esc(campaign.id)}', 1, this.value)">
          <option value="">All send statuses</option>
          ${['queued', 'sending', 'sent', 'failed', 'skipped', 'held', 'needs_review'].map(value => `<option value="${value}" ${status === value ? 'selected' : ''}>${value.replace(/_/g, ' ')}</option>`).join('')}
        </select>
        <span style="font-size:12px;color:var(--muted);align-self:center;">Showing ${campaign.sends?.length || 0} of ${campaign.sendPage?.total || 0} email records</span>
      </div>
      <div class="pa-table-wrap" style="max-height:420px;overflow:auto;"><table class="pa-table"><thead><tr><th>School</th><th>Step</th><th>Status</th><th>When (EAT)</th><th>Detail</th><th></th></tr></thead><tbody>${sends || '<tr><td colspan="6">No email records match this filter.</td></tr>'}</tbody></table></div>
      ${campaign.sendPage && campaign.sendPage.pages > 1 ? `<div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;font-size:12px;"><span>Page ${campaign.sendPage.page} of ${campaign.sendPage.pages}</span><div style="display:flex;gap:8px;"><button class="pa-btn pa-btn-sm" ${campaign.sendPage.page <= 1 ? 'disabled' : ''} onclick="openOutreachCampaignDetail('${_esc(campaign.id)}', ${campaign.sendPage.page - 1}, '${_esc(status)}')">Previous</button><button class="pa-btn pa-btn-sm" ${campaign.sendPage.page >= campaign.sendPage.pages ? 'disabled' : ''} onclick="openOutreachCampaignDetail('${_esc(campaign.id)}', ${campaign.sendPage.page + 1}, '${_esc(status)}')">Next</button></div></div>` : ''}`, true);
  } catch (error) {
    toast(error.message || 'Could not open campaign.', 'error');
  }
}

function outreachOpenLaunch(id, savedLimit = _outreachConfig.dailyLimit || 25) {
  const eat = new Date(Date.now() + 15 * 60 * 1000 + 3 * 60 * 60 * 1000);
  eat.setUTCMinutes(Math.ceil(eat.getUTCMinutes() / 15) * 15, 0, 0);
  const value = eat.toISOString().slice(0, 16);
  _outreachModal('Launch campaign', `<p>Start time is Africa/Nairobi (EAT). Emails are spread across weekdays, 08:00–16:00 EAT. Every send re-checks suppression and lead status.</p><div class="pa-field"><label for="outreach-launch-at">Start time (EAT)</label><input id="outreach-launch-at" type="datetime-local" value="${value}"></div><div class="pa-field" style="margin-top:12px;"><label for="outreach-launch-limit">Daily limit (saved: ${Number(savedLimit) || 25})</label><input id="outreach-launch-limit" type="number" min="1" max="100" value="${Number(savedLimit) || 25}"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;"><button class="pa-btn" onclick="closeModal()">Cancel</button><button class="pa-btn primary" onclick="outreachLaunchCampaign('${_esc(id)}')"><i class="fas fa-play"></i> Confirm launch</button></div>`);
}

async function outreachLaunchCampaign(id) {
  const at = document.getElementById('outreach-launch-at')?.value;
  const dailyLimit = Number(document.getElementById('outreach-launch-limit')?.value || 25);
  if (!at) return toast('Choose a launch time.', 'error');
  try {
    const result = (await api('POST', `/outreach/campaigns/${encodeURIComponent(id)}/launch`, { scheduledAt: new Date(`${at}:00+03:00`).toISOString(), dailyLimit })).data;
    closeModal();
    toast(`Campaign queued for ${result.leads} schools (${result.sends} emails). Skipped: ${result.skipped || 0}${result.overflow ? ` · over limit: ${result.overflow}` : ''}.`, 'success');
    renderOutreachCampaigns();
  } catch (error) {
    toast(error.message || 'Could not launch campaign.', 'error');
  }
}

async function outreachCampaignAction(id, action) {
  try {
    await api('POST', `/outreach/campaigns/${encodeURIComponent(id)}/${action}`, {});
    toast(`Campaign ${action === 'cancel' ? 'cancelled' : action + 'd'}.`, 'success');
    openOutreachCampaignDetail(id);
  } catch (error) {
    toast(error.message || 'Campaign action failed.', 'error');
  }
}

async function outreachRetrySend(id) {
  try {
    await api('POST', `/outreach/sends/${encodeURIComponent(id)}/retry`, {});
    toast('Send queued for retry.', 'success');
    closeModal();
    renderOutreachCampaigns();
  } catch (error) {
    toast(error.message || 'Retry failed.', 'error');
  }
}

async function outreachRecordOutcome(id, outcome) {
  try {
    await api('POST', `/outreach/sends/${encodeURIComponent(id)}/outcome`, { outcome });
    toast('Outcome recorded. Future emails to this lead have stopped.', 'success');
    closeModal();
    renderOutreachCampaigns();
  } catch (error) {
    toast(error.message || 'Could not record outcome.', 'error');
  }
}

let _outreachSuppressionPage = 1;
let _outreachSuppressionQuery = '';

async function renderOutreachSuppressions() {
  const panel = document.getElementById('outreach-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="pa-loading">Loading suppressions…</div>';
  try {
    const query = new URLSearchParams({ page: String(_outreachSuppressionPage), pageSize: '100' });
    if (_outreachSuppressionQuery) query.set('q', _outreachSuppressionQuery);
    const result = await api('GET', '/outreach/suppressions?' + query.toString());
    const data = result.data || [];
    const pagination = result.pagination || { page: 1, pages: 1, total: 0 };
    panel.innerHTML = `<div class="pa-card"><div class="pa-card-header"><h3>Suppressed addresses (${pagination.total})</h3>${_can('outreach.manage') ? '<button class="pa-btn primary" onclick="openOutreachSuppression()"><i class="fas fa-plus"></i> Add address</button>' : ''}</div>
      <div style="display:flex;gap:8px;padding:14px 18px;border-bottom:1px solid var(--line-soft);flex-wrap:wrap;">
        <input class="pa-input" style="flex:1;min-width:220px;" placeholder="Search email address" value="${_esc(_outreachSuppressionQuery)}" onkeydown="if(event.key==='Enter'){_outreachSuppressionPage=1;_outreachSuppressionQuery=this.value.trim();renderOutreachSuppressions();}">
        <button class="pa-btn" onclick="_outreachSuppressionPage=1;_outreachSuppressionQuery=this.previousElementSibling.value.trim();renderOutreachSuppressions();"><i class="fas fa-search"></i></button>
      </div>
      ${data.length ? `<div class="pa-table-wrap"><table class="pa-table"><thead><tr><th>Email</th><th>Reason</th><th>Added</th></tr></thead><tbody>${data.map(item => `<tr><td>${_esc(item.email)}</td><td><span class="pa-pill ${_esc(item.reason)}">${_esc(item.reason)}</span></td><td>${_outreachDate(item.createdAt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="pa-empty"><i class="fas fa-ban"></i><p>No suppressed addresses match.</p></div>'}
      <div style="display:flex;justify-content:space-between;gap:12px;padding:14px 18px;border-top:1px solid var(--line-soft);font-size:12px;color:var(--muted);"><span>Showing ${data.length} of ${pagination.total}</span><div style="display:flex;gap:8px;"><button class="pa-btn pa-btn-sm" ${pagination.page <= 1 ? 'disabled' : ''} onclick="_outreachSuppressionPage--;renderOutreachSuppressions();">Previous</button><button class="pa-btn pa-btn-sm" ${pagination.page >= pagination.pages ? 'disabled' : ''} onclick="_outreachSuppressionPage++;renderOutreachSuppressions();">Next</button></div></div>
    </div>`;
  } catch (error) {
    panel.innerHTML = `<div class="pa-error">${_esc(error.message || 'Could not load suppressions.')}</div>`;
  }
}

function openOutreachSuppression() {
  _outreachModal('Suppress an address', `<p>Outreach email to this address will stop immediately, including queued follow-ups.</p>
    <div class="pa-field"><label for="outreach-suppress-email">Email address</label><input id="outreach-suppress-email" type="email" placeholder="office@example.com"></div>
    <div class="pa-field" style="margin-top:12px;"><label for="outreach-suppress-reason">Reason</label><select id="outreach-suppress-reason"><option value="manual">Manual</option><option value="bounced">Bounced</option><option value="complaint">Complaint</option><option value="unsubscribed">Unsubscribed</option></select></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;"><button class="pa-btn" onclick="closeModal()">Cancel</button><button class="pa-btn primary" onclick="outreachAddSuppression()"><i class="fas fa-ban"></i> Suppress</button></div>`);
}

async function outreachAddSuppression() {
  const email = document.getElementById('outreach-suppress-email')?.value.trim();
  const reason = document.getElementById('outreach-suppress-reason')?.value || 'manual';
  if (!email) return toast('Enter an email address.', 'error');
  try {
    await api('POST', '/outreach/suppressions', { email, reason });
    closeModal();
    toast('Address suppressed.', 'success');
    renderOutreachSuppressions();
  } catch (error) {
    toast(error.message || 'Could not suppress address.', 'error');
  }
}
