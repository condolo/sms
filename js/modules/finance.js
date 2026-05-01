/* ============================================================
   InnoLearn — Finance Module
   ============================================================ */

const Finance = (() => {
  let _tab = 'invoices';

  function render() {
    App.setBreadcrumb('<i class="fas fa-coins"></i> Finance');
    if (Auth.isParent()) return _renderParentView();
    _renderMain();
  }

  function _renderMain() {
    const invoices   = DB.get('invoices');
    const totalBilled= invoices.reduce((s,i) => s+i.totalAmount, 0);
    const collected  = invoices.reduce((s,i) => s+i.paidAmount, 0);
    const outstanding= invoices.reduce((s,i) => s+i.balance, 0);
    const collRate   = totalBilled > 0 ? Math.round(collected/totalBilled*100) : 0;

    App.renderPage(`
    <div class="page-header">
      <div class="page-title"><h1>Financial Management</h1><p>Term 2 · 2024-2025</p></div>
      <div class="page-actions">
        ${Auth.isAdmin() || Auth.isFinance() ? `
        <button class="btn btn-primary" onclick="Finance.generateInvoicesModal()"><i class="fas fa-file-invoice"></i> Generate Invoices</button>
        <button class="btn btn-secondary" onclick="Finance.addStructureModal()"><i class="fas fa-cog"></i> Fee Structure</button>
        ` : ''}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-file-invoice-dollar"></i></div>
        <div class="stat-body">
          <div class="stat-value">${fmtMoney(totalBilled)}</div>
          <div class="stat-label">Total Billed (Term 2)</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
        <div class="stat-body">
          <div class="stat-value">${fmtMoney(collected)}</div>
          <div class="stat-label">Amount Collected</div>
          <div class="stat-change up">${collRate}% collection rate</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red"><i class="fas fa-exclamation-circle"></i></div>
        <div class="stat-body">
          <div class="stat-value">${fmtMoney(outstanding)}</div>
          <div class="stat-label">Outstanding Balance</div>
          <div class="stat-change down">${invoices.filter(i=>i.status==='overdue').length} overdue</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow"><i class="fas fa-percent"></i></div>
        <div class="stat-body">
          <div class="stat-value">${collRate}%</div>
          <div class="stat-label">Collection Rate</div>
          <div style="margin-top:6px"><div class="progress-bar"><div class="progress-fill ${collRate>=80?'success':'warning'}" style="width:${collRate}%"></div></div></div>
        </div>
      </div>
    </div>

    <!-- Invoice status chart -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title">Invoice Status Breakdown</div></div>
      <div style="height:160px;position:relative"><canvas id="finChart"></canvas></div>
    </div>

    <div class="tabs" id="fin-tabs">
      <button class="tab-btn ${_tab==='invoices'?'active':''}" onclick="Finance.setTab('invoices',this)">Invoices</button>
      <button class="tab-btn ${_tab==='overdue'?'active':''}"  onclick="Finance.setTab('overdue',this)">Overdue</button>
      <button class="tab-btn ${_tab==='paid'?'active':''}"     onclick="Finance.setTab('paid',this)">Paid</button>
      <button class="tab-btn ${_tab==='structure'?'active':''}"onclick="Finance.setTab('structure',this)">Fee Structure</button>
    </div>

    <div id="fin-content">${_tabContent(_tab)}</div>
    `);

    setTimeout(_buildFinanceChart, 100);
  }

  function _tabContent(tab) {
    const invoices = DB.get('invoices');
    const filtered = tab === 'overdue' ? invoices.filter(i => i.status === 'overdue' || i.status === 'partial') :
                     tab === 'paid'    ? invoices.filter(i => i.status === 'paid') :
                     tab === 'structure' ? null : invoices;

    if (tab === 'structure') return _feeStructureHTML();

    return `
    <div class="card mb-0">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Invoice No.</th><th>Student</th><th>Class</th><th>Total</th><th>Paid</th><th>Balance</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${filtered.length ? filtered.map(inv => {
              const stu = DB.getById('students', inv.studentId);
              const cls = stu ? DB.getById('classes', stu.classId) : null;
              return `<tr>
                <td class="monospace text-sm">${inv.invoiceNo}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="avatar-circle" style="background:var(--primary);width:28px;height:28px;font-size:11px">${stu?.firstName?.charAt(0)||'?'}</div>
                    <div style="font-size:13px;font-weight:600">${stu ? `${stu.firstName} ${stu.lastName}` : 'Unknown'}</div>
                  </div>
                </td>
                <td>${cls?.name||'—'}</td>
                <td style="font-weight:600">${fmtMoney(inv.totalAmount)}</td>
                <td style="color:var(--success);font-weight:600">${fmtMoney(inv.paidAmount)}</td>
                <td style="color:${inv.balance>0?'var(--danger)':'var(--success)'};font-weight:700">${fmtMoney(inv.balance)}</td>
                <td>${fmtDate(inv.dueDate)}</td>
                <td><span class="badge badge-${statusBadge(inv.status)}">${inv.status}</span></td>
                <td>
                  <div class="tbl-actions">
                    <button class="btn btn-sm btn-secondary" onclick="Finance.viewInvoice('${inv.id}')"><i class="fas fa-eye"></i></button>
                    ${(Auth.isAdmin()||Auth.isFinance()) && inv.balance > 0 ? `<button class="btn btn-sm btn-success" onclick="Finance.recordPaymentModal('${inv.id}')"><i class="fas fa-money-bill"></i> Pay</button>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="9"><div class="empty-state" style="padding:30px"><i class="fas fa-file-invoice"></i><h3>No invoices</h3></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function _feeStructureHTML() {
    const structure = DB.get('feeStructures')[0];
    if (!structure) return '<div class="empty-state"><i class="fas fa-cog"></i><h3>No fee structure configured</h3><button class="btn btn-primary" onclick="Finance.addStructureModal()">Set Up Fees</button></div>';
    const total = structure.items.filter(i=>!i.isOptional).reduce((s,i)=>s+i.amount,0);
    return `
    <div class="card mb-0">
      <div class="card-header">
        <div><div class="card-title">${structure.name}</div><div class="card-subtitle">Due: ${fmtDate(structure.dueDate)}</div></div>
        ${Auth.isAdmin()||Auth.isFinance()?`<button class="btn btn-sm btn-secondary" onclick="Finance.addStructureModal()"><i class="fas fa-edit"></i> Edit</button>`:''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:16px">
        ${structure.items.map(item=>`
        <div style="background:${item.isOptional?'var(--gray-50)':'var(--primary-light)'};border:1px solid ${item.isOptional?'var(--gray-200)':'#BFDBFE'};border-radius:var(--radius-sm);padding:14px">
          <div style="font-size:12px;font-weight:600;color:var(--gray-500)">${item.category.toUpperCase()} ${item.isOptional?'<span style="color:var(--warning)">(Optional)</span>':''}</div>
          <div style="font-size:13.5px;font-weight:700;color:var(--gray-800);margin-top:4px">${item.name}</div>
          <div style="font-size:18px;font-weight:800;color:var(--primary);margin-top:6px">${fmtMoney(item.amount)}</div>
        </div>`).join('')}
      </div>
      <div style="background:var(--gray-800);color:#fff;border-radius:var(--radius-sm);padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:14px;font-weight:600">Mandatory Total (per student)</span>
        <span style="font-size:20px;font-weight:800">${fmtMoney(total)}</span>
      </div>
    </div>`;
  }

  function setTab(tab, btn) {
    _tab = tab;
    document.querySelectorAll('#fin-tabs .tab-btn').forEach(b=>b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const el = document.getElementById('fin-content');
    if (el) el.innerHTML = _tabContent(tab);
    setTimeout(_buildFinanceChart, 100);
  }

  function recordPaymentModal(invoiceId) {
    const inv = DB.getById('invoices', invoiceId);
    const stu = inv ? DB.getById('students', inv.studentId) : null;
    openModal(`
    <div class="modal-header">
      <h3><i class="fas fa-money-bill-wave"></i> Record Payment</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      ${inv ? `<div style="background:var(--gray-50);border-radius:8px;padding:14px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600">${stu?.firstName} ${stu?.lastName}</div>
        <div style="font-size:12px;color:var(--gray-500)">${inv.invoiceNo} · Balance: <strong style="color:var(--danger)">${fmtMoney(inv.balance)}</strong></div>
      </div>` : ''}
      <form onsubmit="Finance.savePayment(event,'${invoiceId}')">
        <div class="form-row cols-2">
          <div class="form-field"><label>Amount (KSh) *</label><input type="number" name="amount" required min="1" max="${inv?.balance||999999}" value="${inv?.balance||''}"></div>
          <div class="form-field"><label>Payment Method</label><select name="method">
            <option value="mpesa">M-Pesa</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="card">Credit/Debit Card</option>
          </select></div>
        </div>
        <div class="form-row cols-2">
          <div class="form-field"><label>Reference/Receipt No.</label><input name="reference" placeholder="e.g. MPESA-ABC123"></div>
          <div class="form-field"><label>Date</label><input type="date" name="date" value="${new Date().toISOString().split('T')[0]}"></div>
        </div>
        <div class="form-field mb-12"><label>Notes</label><input name="notes" placeholder="Optional notes…"></div>
        <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
          <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-check"></i> Confirm Payment</button>
        </div>
      </form>
    </div>`, 'sm');
  }

  function savePayment(e, invoiceId) {
    e.preventDefault();
    if (!Auth.hasPermission('finance', 'create')) return showToast('You do not have permission to record payments.', 'error');
    const fd     = new FormData(e.target);
    const amount = Number(fd.get('amount'));
    const inv    = DB.getById('invoices', invoiceId);

    /* Validate everything before any DB write */
    const err = Validators.payment(amount, inv);
    if (err) return showToast(err, 'warning');

    const newPayment = { id: 'pay'+Date.now(), amount, date: fd.get('date'), method: fd.get('method'), reference: fd.get('reference'), notes: fd.get('notes'), recordedBy: Auth.currentUser.id };
    const newPaid    = inv.paidAmount + amount;
    const newBalance = Math.max(0, inv.totalAmount - newPaid);
    const newStatus  = newBalance === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

    DB.update('invoices', invoiceId, { paidAmount: newPaid, balance: newBalance, status: newStatus, payments: [...(inv.payments||[]), newPayment] });
    _audit('PAYMENT_RECORDED', {
      invoiceId,
      invoiceNo:  inv.invoiceNo,
      studentId:  inv.studentId,
      amount,
      method:     newPayment.method,
      reference:  newPayment.reference,
      before: { paidAmount: inv.paidAmount, balance: inv.balance, status: inv.status },
      after:  { paidAmount: newPaid, balance: newBalance, status: newStatus },
    });
    showToast(`Payment of ${fmtMoney(amount)} recorded. ${newBalance > 0 ? `Balance: ${fmtMoney(newBalance)}` : 'Fully paid!'}`, 'success');
    _closeModal();
    _renderMain();
  }

  function viewInvoice(id) {
    const inv = DB.getById('invoices', id);
    const stu = inv ? DB.getById('students', inv.studentId) : null;
    const cls = stu ? DB.getById('classes', stu.classId) : null;
    if (!inv) return;
    openModal(`
    <div class="modal-header">
      <h3>Invoice ${inv.invoiceNo}</h3>
      <button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
      <div style="display:flex;justify-content:space-between;margin-bottom:20px">
        <div><div style="font-size:18px;font-weight:800">${stu?.firstName} ${stu?.lastName}</div><div style="color:var(--gray-500);font-size:13px">${cls?.name||''} · ${stu?.admissionNo||''}</div></div>
        <span class="badge badge-${statusBadge(inv.status)}" style="font-size:13px;padding:6px 14px">${inv.status.toUpperCase()}</span>
      </div>
      ${inv.items.map(i=>`<div class="invoice-line"><span>${i.name}</span><span>${fmtMoney(i.amount)}</span></div>`).join('')}
      <div class="invoice-line total"><span>Total Amount</span><span>${fmtMoney(inv.totalAmount)}</span></div>
      <div class="invoice-line paid"><span>Amount Paid</span><span>${fmtMoney(inv.paidAmount)}</span></div>
      ${inv.balance > 0 ? `<div class="invoice-line balance"><span>Outstanding Balance</span><span>${fmtMoney(inv.balance)}</span></div>` : ''}
      ${inv.payments?.length ? `<div style="margin-top:16px"><div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:8px">Payments</div>
        ${inv.payments.map(p=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);font-size:13px">
          <span>${fmtDate(p.date)} · ${p.method?.replace('_',' ').toUpperCase()} · Ref: ${p.reference}</span>
          <span style="font-weight:700;color:var(--success)">${fmtMoney(p.amount)}</span>
        </div>`).join('')}</div>` : ''}
      ${(Auth.isAdmin()||Auth.isFinance()) && inv.balance > 0 ? `<div style="margin-top:16px"><button class="btn btn-success" onclick="Finance.recordPaymentModal('${inv.id}')"><i class="fas fa-money-bill"></i> Record Payment</button></div>` : ''}
    </div>`);
  }

  function generateInvoicesModal() {
    const structure = DB.get('feeStructures')[0];
    const students  = DB.query('students', s => s.status === 'active');
    const existing  = DB.get('invoices').map(i => i.studentId);
    const toGenerate= students.filter(s => !existing.includes(s.id));

    openModal(`
    <div class="modal-header"><h3>Generate Term 2 Invoices</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <div class="modal-body">
      <div style="background:var(--primary-light);border-radius:8px;padding:14px;margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;color:var(--primary)">${structure?.name||'Fee Structure'}</div>
        <div style="font-size:13px;color:var(--gray-600);margin-top:4px">
          ${toGenerate.length > 0 ? `${toGenerate.length} students without invoices.` : 'All active students already have invoices.'}
        </div>
      </div>
      ${toGenerate.length > 0 ? `
      <p style="font-size:13px;color:var(--gray-600)">This will generate invoices for ${toGenerate.length} student${toGenerate.length>1?'s':''} using the current fee structure.</p>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Finance.doGenerateInvoices()"><i class="fas fa-file-invoice"></i> Generate ${toGenerate.length} Invoices</button>
      </div>` : `<p style="color:var(--gray-500);font-size:13px">All students already have invoices for this term.</p>`}
    </div>`, 'sm');
  }

  function doGenerateInvoices() {
    const structure = DB.get('feeStructures')[0];
    if (!structure) return showToast('No fee structure found.', 'error');
    const students  = DB.query('students', s => s.status === 'active');
    const existing  = DB.get('invoices').map(i => i.studentId);
    const toGenerate= students.filter(s => !existing.includes(s.id));
    const mandItems = structure.items.filter(i => !i.isOptional);
    const total     = mandItems.reduce((s,i) => s+i.amount, 0);
    const count     = DB.get('invoices').length;

    toGenerate.forEach((s, idx) => {
      DB.insert('invoices', {
        schoolId:'sch1', studentId: s.id,
        invoiceNo: `MIS-INV-2025-${String(count+idx+1).padStart(3,'0')}`,
        feeStructureId: structure.id, termId:'term2', academicYearId:'ay2025',
        totalAmount: total, paidAmount: 0, balance: total,
        status: 'unpaid', dueDate: structure.dueDate,
        items: mandItems.map(i=>({name:i.name,amount:i.amount})),
        payments: []
      });
    });
    showToast(`${toGenerate.length} invoices generated.`, 'success');
    _closeModal(); _renderMain();
  }

  function addStructureModal() {
    openModal(`
    <div class="modal-header"><h3>Fee Structure</h3><button class="modal-close" onclick="_closeModal()"><i class="fas fa-times"></i></button></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--gray-500)">Edit fee structure items in the table below.</p>
      <div id="fee-items">
        ${(DB.get('feeStructures')[0]?.items||[]).map((item,i)=>`
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px" data-idx="${i}">
          <input value="${item.name}" placeholder="Item name" style="flex:1;padding:7px;border:1.5px solid var(--gray-200);border-radius:6px;font-size:13px">
          <input type="number" value="${item.amount}" placeholder="Amount" style="width:120px;padding:7px;border:1.5px solid var(--gray-200);border-radius:6px;font-size:13px">
          <label style="font-size:12px;white-space:nowrap;display:flex;gap:4px;align-items:center"><input type="checkbox" ${item.isOptional?'checked':''}> Optional</label>
          <button type="button" onclick="this.parentElement.remove()" class="btn btn-sm btn-danger btn-icon"><i class="fas fa-trash"></i></button>
        </div>`).join('')}
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="Finance.addFeeItemRow()"><i class="fas fa-plus"></i> Add Item</button>
      <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Finance.saveFeeStructure()"><i class="fas fa-save"></i> Save</button>
      </div>
    </div>`);
  }

  function addFeeItemRow() {
    const container = document.getElementById('fee-items');
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px';
    div.innerHTML = `<input placeholder="Item name" style="flex:1;padding:7px;border:1.5px solid var(--gray-200);border-radius:6px;font-size:13px">
      <input type="number" placeholder="Amount" style="width:120px;padding:7px;border:1.5px solid var(--gray-200);border-radius:6px;font-size:13px">
      <label style="font-size:12px;white-space:nowrap;display:flex;gap:4px;align-items:center"><input type="checkbox"> Optional</label>
      <button type="button" onclick="this.parentElement.remove()" class="btn btn-sm btn-danger btn-icon"><i class="fas fa-trash"></i></button>`;
    container.appendChild(div);
  }

  function saveFeeStructure() {
    const rows = document.querySelectorAll('#fee-items > div');
    const items = [...rows].map((row, i) => {
      const inputs = row.querySelectorAll('input');
      return { id:`fi${i+1}`, name:inputs[0].value, amount:Number(inputs[1].value)||0, isOptional:inputs[2].checked, category:'fee' };
    }).filter(i => i.name);
    const existing = DB.get('feeStructures')[0];
    if (existing) DB.update('feeStructures', existing.id, { items });
    else DB.insert('feeStructures', { schoolId:'sch1', name:'Fee Structure', termId:'term2', academicYearId:'ay2025', classIds:[], items, dueDate:'2025-05-15', currency:'KES' });
    showToast('Fee structure updated.', 'success');
    _closeModal(); _renderMain();
  }

  function _buildFinanceChart() {
    const ctx = document.getElementById('finChart');
    if (!ctx) return;
    const invoices = DB.get('invoices');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Paid','Partial','Overdue','Unpaid'],
        datasets:[{ data:[invoices.filter(i=>i.status==='paid').length, invoices.filter(i=>i.status==='partial').length, invoices.filter(i=>i.status==='overdue').length, invoices.filter(i=>i.status==='unpaid').length], backgroundColor:['#059669','#D97706','#DC2626','#94A3B8'], borderRadius:4 }]
      },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{ticks:{stepSize:1}}} }
    });
  }

  function _renderParentView() {
    const kids = DB.query('students', s => s.guardians?.some(g => g.userId === Auth.currentUser.id));
    const allInv = DB.get('invoices').filter(i => kids.map(k=>k.id).includes(i.studentId));

    App.renderPage(`
    <div class="page-header"><div class="page-title"><h1>Fee Payments</h1><p>Term 2 · 2024-2025</p></div></div>
    ${allInv.map(inv => {
      const stu = DB.getById('students', inv.studentId);
      return `<div class="invoice-card" style="margin-bottom:16px">
        <div class="invoice-header">
          <div>
            <div style="font-weight:700;font-size:15px">${stu?.firstName} ${stu?.lastName} — ${inv.invoiceNo}</div>
            <div style="font-size:12px;color:var(--gray-400)">Due: ${fmtDate(inv.dueDate)}</div>
          </div>
          <span class="badge badge-${statusBadge(inv.status)}">${inv.status.toUpperCase()}</span>
        </div>
        <div class="invoice-body">
          ${inv.items.map(i=>`<div class="invoice-line"><span>${i.name}</span><span>${fmtMoney(i.amount)}</span></div>`).join('')}
          <div class="invoice-line total"><span>Total</span><span>${fmtMoney(inv.totalAmount)}</span></div>
          <div class="invoice-line paid"><span>Paid</span><span>${fmtMoney(inv.paidAmount)}</span></div>
          ${inv.balance>0?`<div class="invoice-line balance"><span>Balance Due</span><span>${fmtMoney(inv.balance)}</span></div>`:''}
        </div>
        ${inv.payments?.length?`<div style="padding:14px 20px;border-top:1px solid var(--gray-100)">
          <div style="font-size:12px;font-weight:700;color:var(--gray-500);margin-bottom:6px">PAYMENTS RECEIVED</div>
          ${inv.payments.map(p=>`<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span>${fmtDate(p.date)} · ${p.method} · ${p.reference}</span><span style="color:var(--success);font-weight:600">${fmtMoney(p.amount)}</span></div>`).join('')}
        </div>`:''}
      </div>`;
    }).join('') || '<div class="empty-state"><i class="fas fa-file-invoice"></i><h3>No invoices found</h3></div>'}
    `);
  }

  return { render, setTab, recordPaymentModal, savePayment, viewInvoice, generateInvoicesModal, doGenerateInvoices, addStructureModal, addFeeItemRow, saveFeeStructure };
})();
