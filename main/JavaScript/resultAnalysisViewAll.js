(() => {
  const $ = selector => document.querySelector(selector);
  const labels = { PENDING: 'Pending', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected' };
  const statusClass = { PENDING: 'aa-status--pending', IN_PROGRESS: 'aa-status--progress', SUBMITTED: 'aa-status--submitted', APPROVED: 'aa-status--approved' };
  const safe = value => String(value ?? '').trim() || 'Unknown';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatDate = value => { if (!value) return 'Unknown'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; };
  const dueState = (value, status) => { const due = value ? new Date(value) : null, hours = due ? (due.getTime() - Date.now()) / 36e5 : Infinity; if (!due || !['PENDING', 'IN_PROGRESS'].includes(status)) return ''; return hours < 0 ? 'aa-due--late' : hours < 24 ? 'aa-due--soon' : ''; };
  const dueLabel = (value, status) => { if (!value) return 'Unknown'; const state = dueState(value, status); return { text: formatDate(value), overdue: state === 'aa-due--late' }; };
  async function init() {
    const initialBody = $('#taskRows'); if (initialBody) initialBody.innerHTML = '<tr><td colspan="7" class="aa-empty">Đang tải dữ liệu...</td></tr>';
    $('#staticPagination')?.remove();
    const user = await AAIR.guard(); if (!user) return;
    window.AAIRNavbar?.mount(user);
    const table = $('table'), head = table?.querySelector('thead tr'), body = $('#taskRows'); table?.classList.add('aa-table'); table?.closest('div.bg-white')?.classList.add('aa-table-shell');
    if (head) head.innerHTML = '<th>Document</th><th>Session</th><th>Annotator</th><th>Type</th><th>Status</th><th>Due date</th><th>Action</th>';
    const allRows = await AAIR.request('/tasks');
    // Do not discard sessions by name. A real manager-created session may be
    // named "test"; the API already scopes the rows to this Analyst.
    const rows = allRows.filter(row => String(row.assignee || '').trim().toLowerCase() !== 'yes');
    const session = $('#sessionFilter'), status = $('#statusFilter'), search = $('#taskSearch');
    [...new Set(rows.map(row => row.session_name).filter(Boolean))].sort().forEach(value => session.add(new Option(value, value)));
    [...new Set(rows.map(row => row.status).filter(Boolean))].sort().forEach(value => status.add(new Option(labels[value] || value, value)));
    const pager = document.createElement('div'); pager.className = 'aa-pagination'; table.parentElement.append(pager); let page = 0;
    const render = () => {
      const query = search.value.trim().toLocaleLowerCase(); const filtered = rows.filter(row => (!query || Object.values(row).filter(value => typeof value !== 'object').join(' ').toLocaleLowerCase().includes(query)) && (!session.value || row.session_name === session.value) && (!status.value || row.status === status.value));
      const pageSize = 10, pages = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(page, pages - 1); body.replaceChildren(); const visible = filtered.slice(page * pageSize, page * pageSize + pageSize);
      if (!visible.length) { const tr = body.insertRow(); const td = tr.insertCell(); td.colSpan = 7; td.className = 'aa-empty'; td.textContent = 'No matching tasks.'; }
      visible.forEach(row => {
        const tr = body.insertRow(); const documentCell = tr.insertCell(); documentCell.textContent = safe(row.document_title); documentCell.title = safe(row.document_title);
        tr.insertCell().textContent = safe(row.session_name); tr.insertCell().textContent = safe(row.assignee);
        const typeCell = tr.insertCell(), typeBadge = document.createElement('span'); typeBadge.className = 'aa-type-badge'; typeBadge.textContent = 'AI'; typeCell.append(typeBadge); const statusCell = tr.insertCell(), badge = document.createElement('span'); badge.className = `aa-status ${statusClass[row.status] || 'aa-status--pending'}`; badge.textContent = labels[row.status] || safe(row.status); statusCell.append(badge);
        const dueCell = tr.insertCell(); const due = dueLabel(row.due_at, row.status); dueCell.className = dueState(row.due_at, row.status); dueCell.append(document.createTextNode(due.text)); if (due.overdue) { const overdue = document.createElement('span'); overdue.className = 'aa-overdue-badge'; overdue.textContent = 'Overdue'; dueCell.append(overdue); }
        const actionCell = tr.insertCell(), button = document.createElement('button'); button.className = `aa-button${due.overdue ? ' aa-button--urgent' : ''}`; button.type = 'button'; button.textContent = due.overdue ? 'Continue' : row.status === 'APPROVED' ? 'View' : 'Open'; button.onclick = () => location.assign(`Task.html?id=${row.id}`); actionCell.append(button);
      });
      pager.replaceChildren(); if (pages > 1) { const previous = document.createElement('button'), next = document.createElement('button'); previous.textContent = '‹'; next.textContent = '›'; previous.disabled = page === 0; next.disabled = page >= pages - 1; previous.onclick = () => { page -= 1; render(); }; next.onclick = () => { page += 1; render(); }; const copy = document.createElement('span'); copy.textContent = `${filtered.length ? page * pageSize + 1 : 0}–${Math.min((page + 1) * pageSize, filtered.length)} / ${filtered.length}`; pager.append(previous, copy, next); }
    };
    search.oninput = () => { page = 0; render(); }; session.onchange = status.onchange = () => { page = 0; render(); }; render();
  }
  init().catch(error => { const body = $('#taskRows'); if (body) body.innerHTML = `<tr><td colspan="7" class="aa-empty">${String(error.message || 'Unable to load data.')} <button class="aa-button" onclick="location.reload()">Retry</button></td></tr>`; });
})();
