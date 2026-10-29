window.AAIRResultAnalysisDashboard = async function ({ request, notice, go, user }) {
    const $ = id => document.getElementById(id);
    const number = value => Number(value || 0);
    const displayNumber = value => new Intl.NumberFormat('en-US').format(number(value));
    const localIso = value => value.toISOString().slice(0, 19);
    const statusLabels = { PENDING: 'Pending', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected' };
    const friendlyLabel = value => ({ revenue: 'Revenue', profit: 'Profit', assets: 'Assets' }[String(value || '').toLowerCase()] || String(value || 'Unknown').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formatDate = value => { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; };
    const formatRangeDate = value => `${value.getDate()} ${monthNames[value.getMonth()]} ${value.getFullYear()}`;
    const greeting = hour => hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
    const range = () => { const selected = $('analystRangeSelect').value, now = new Date(); if (selected === 'all') return { from: null, to: now, label: 'All time' }; const from = new Date(now); from.setHours(0, 0, 0, 0); if (selected === 'today') return { from, to: now, label: `${formatRangeDate(from)} – ${formatRangeDate(now)}` }; from.setDate(now.getDate() - Number(selected)); return { from, to: now, label: `${formatRangeDate(from)} – ${formatRangeDate(now)}` }; };
    function metric(id, value) { $(id).textContent = displayNumber(value); }
    function textCell(value, className = '') { const cell = document.createElement('td'); cell.textContent = value == null || value === '' ? '—' : String(value); if (className) cell.className = className; return cell; }
    function emptyRow(body, columns, message) { body.replaceChildren(); const row = document.createElement('tr'); const cell = textCell(message, 'analyst-empty-cell'); cell.colSpan = columns; row.append(cell); body.append(row); }
    function statusPill(status) { const pill = document.createElement('span'), normalized = String(status || '').toUpperCase(); const type = normalized.toLowerCase().replace('_', '-'); pill.className = `analyst-status-badge analyst-status-badge--${type === 'submitted' ? 'submitted' : type === 'approved' ? 'approved' : 'default'}`; pill.textContent = statusLabels[normalized] || normalized || '—'; return pill; }
    function bars(host, values, label, value, kind) { host.replaceChildren(); const max = Math.max(1, ...values.map(value)); if (!values.length) { host.textContent = 'No data for the selected range.'; return; } values.forEach(item => { const row = document.createElement('div'); row.className = 'analyst-bar-row'; const head = document.createElement('div'); head.className = 'analyst-bar-head'; const name = document.createElement('span'); name.textContent = label(item); const count = document.createElement('strong'); count.textContent = displayNumber(value(item)); head.append(name, count); const track = document.createElement('div'); track.className = 'analyst-bar-track'; const fill = document.createElement('div'); const status = String(item.status || '').toLowerCase(); const fillKind = kind === 'status' ? (status === 'submitted' ? 'submitted' : status === 'approved' ? 'approved' : status === 'overdue' ? 'overdue' : 'other') : 'labels'; fill.className = `analyst-bar-fill analyst-bar-fill--${fillKind}`; fill.style.width = `${Math.max(2, value(item) / max * 100)}%`; track.append(fill); row.append(head, track); host.append(row); }); }
    async function load() {
        const selected = range(); $('analystDashboardState').textContent = 'Updating dashboard…';
        try {
            const query = selected.from ? `?from=${encodeURIComponent(localIso(selected.from))}&to=${encodeURIComponent(localIso(selected.to))}` : '';
            const [statistics, tasks] = await Promise.all([
                request(`/statistics${query}`).catch(() => ({})),
                request('/tasks'),
            ]);
            const taskDate = task => new Date(task.updated_at || task.created_at || 0);
            const inRange = task => !selected.from || taskDate(task) >= selected.from;
            const scopedTasks = (Array.isArray(tasks) ? tasks : []).filter(inRange);
            const statusTotals = scopedTasks.reduce((counts, task) => {
                const status = String(task.status || 'PENDING').toUpperCase();
                counts[status] = (counts[status] || 0) + 1;
                return counts;
            }, {});
            const statuses = Object.entries(statusTotals).map(([status, total]) => ({ status, total }));
            const totalTasks = scopedTasks.length;
            const inProgress = scopedTasks.filter(task => ['PENDING', 'IN_PROGRESS', 'REJECTED'].includes(String(task.status || '').toUpperCase())).length;
            const overdue = scopedTasks.filter(task => task.due_at && new Date(task.due_at) < new Date() && String(task.status || '').toUpperCase() !== 'APPROVED').length;
            const productivityMap = new Map();
            scopedTasks.forEach(task => {
                const username = task.assignee || task.assignee_username || 'Unassigned';
                const entry = productivityMap.get(username) || { username, completed_tasks: 0, overdue_tasks: 0 };
                if (String(task.status || '').toUpperCase() === 'APPROVED') entry.completed_tasks += 1;
                if (task.due_at && new Date(task.due_at) < new Date() && String(task.status || '').toUpperCase() !== 'APPROVED') entry.overdue_tasks += 1;
                productivityMap.set(username, entry);
            });
            const productivity = [...productivityMap.values()];
            const taskDetails = await Promise.all(scopedTasks.map(task => request(`/tasks/${task.id}`).catch(() => task)));
            const labelCounts = new Map();
            taskDetails.forEach(task => (Array.isArray(task.labels) ? task.labels : []).forEach(label => {
                const labelName = label.label_name || label.indicator_name || label.name;
                if (labelName) labelCounts.set(labelName, (labelCounts.get(labelName) || 0) + 1);
            }));
            const labels = [...labelCounts.entries()].map(([label_name, total]) => ({ label_name, total }));
            const totals = statusTotals;
            const labelsTotal = labels.reduce((sum, item) => sum + number(item.total), 0);
            metric('metricTotalTasks', totalTasks); metric('metricSubmitted', totals.SUBMITTED); metric('metricApproved', totals.APPROVED); metric('metricOverdue', overdue); $('overdueMetric').classList.toggle('is-alert', overdue > 0);
            const recent = scopedTasks.sort((a, b) => taskDate(b) - taskDate(a)).slice(0, 10); const taskBody = $('recentTasks'); taskBody.replaceChildren(); if (!recent.length) emptyRow(taskBody, 4, 'No tasks in the selected range.');
            recent.forEach(task => { const row = document.createElement('tr'); row.addEventListener('click', () => go(`Task.html?id=${task.id}`)); const status = document.createElement('td'); status.append(statusPill(task.status)); row.append(textCell(task.document_title || task.document_name), textCell(task.assignee || task.assignee_username), status, textCell(formatDate(task.updated_at || task.created_at))); taskBody.append(row); });
            const productivityBody = $('userProductivity'); productivityBody.replaceChildren(); if (!productivity.length) emptyRow(productivityBody, 3, 'No productivity data.'); productivity.slice(0, 10).forEach(item => { const row = document.createElement('tr'); const overdueCell = document.createElement('td'); const overdueValue = number(item.overdue_tasks); if (overdueValue > 0) { const badge = document.createElement('span'); badge.className = 'analyst-overdue-count'; badge.textContent = displayNumber(overdueValue); overdueCell.append(badge); } else overdueCell.textContent = '0'; row.append(textCell(item.username || 'Unassigned'), textCell(item.completed_tasks), overdueCell); productivityBody.append(row); });
            $('analystDashboardState').textContent = totalTasks ? `Updated ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}` : 'No data in the selected range.';
        } catch (error) { $('analystDashboardState').textContent = `Unable to load data: ${error.message}`; ['metricTotalTasks', 'metricSubmitted', 'metricApproved', 'metricOverdue'].forEach(id => { $(id).textContent = '—'; }); emptyRow($('recentTasks'), 4, 'Unable to load tasks. Try again.'); emptyRow($('userProductivity'), 3, 'Unable to load productivity. Try again.'); notice(error.message, true); }
    }
    const currentUser = user || await window.AAIR?.guard?.(); if (currentUser) $('analystTitle').textContent = `${greeting(new Date().getHours())}, ${currentUser.username || 'Analyst'}`;
    $('analystRefresh').addEventListener('click', load); await load();
};
