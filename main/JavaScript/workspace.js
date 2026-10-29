/* Bind API data to the tables, cards and editors in main/HTML. No separate UI. */
(async () => {
    'use strict';
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const text = el => el?.textContent.replace(/\s+/g, ' ').trim() || '';
    const page = location.pathname.split('/').pop();
    const request = AAIR.request;
    const tableStyles = new WeakMap();
    const taskSuccessNotices = new Set(['Lưu dữ liệu thành công.', 'Data saved successfully.', 'Submit task thành công.', 'Task submitted successfully.']);
    let noticeTimer;
    let user;
    function notice(message, error = false) {
        // The application only uses toasts for explicit Save and Submit successes.
        if (!error && !taskSuccessNotices.has(message)) return;
        let el = $('#apiNotice');
        if (!el) {
            el = document.createElement('p'); el.id = 'apiNotice';
            el.style.transition = 'transform 300ms ease, opacity 300ms ease';
            el.onclick = () => { clearTimeout(noticeTimer); el.remove(); };
            document.body.append(el);
        }
        el.className = error
            ? 'fixed left-1/2 top-1/2 z-[200] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white px-6 py-4 text-center shadow-xl text-sm'
            : 'fixed top-4 right-4 z-[200] max-w-lg rounded-lg border bg-white px-5 py-3 shadow-lg text-sm';
        el.setAttribute('role', error ? 'alert' : 'status'); el.setAttribute('aria-live', error ? 'assertive' : 'polite');
        clearTimeout(noticeTimer);
        el.style.transform = error ? 'translate(-50%, -50%)' : 'translateX(0)'; el.style.opacity = '1';
        el.style.color = error ? '#b91c1c' : '#166534'; el.textContent = message;
        noticeTimer = setTimeout(() => {
            if (!error) el.style.transform = 'translateX(calc(100% + 2rem))';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 5000);
    }
    const busy = new WeakSet();
    async function run(button, fn) {
        if (button?.disabled || (button && busy.has(button))) return;
        if (button) { busy.add(button); button.setAttribute('aria-busy','true'); button.style.pointerEvents='none'; }
        try { await fn(); } catch (error) { notice(error.message, true); }
        finally { if (button) { busy.delete(button); button.removeAttribute('aria-busy'); button.style.pointerEvents=''; } }
    }
    function bind(button, fn) {
        if (!button) return;
        button.removeAttribute('onclick'); button.type = 'button';
        button.onclick = () => run(button, fn);
    }
    function buttons(pattern, root = document) { return $$('button', root).filter(b => pattern.test(text(b))); }
    function bindText(pattern, fn, root) { buttons(pattern, root).forEach(b => bind(b, () => fn(b))); }
    function unavailable(el, message = 'Chức năng này chưa có API hỗ trợ.') {
        if (!el) return;
        el.removeAttribute('onclick'); el.disabled = true; el.title = message;
        el.setAttribute('aria-label', `${text(el)} — ${message}`); el.style.opacity = '0.5';
    }
    const date = value => value ? new Date(value).toLocaleString('vi-VN') : '—';
    const userRoleLabels = { ADMIN: 'Admin', MANAGER: 'Manager', AI_LABELER: 'AI Labeler', MANUAL_LABELER: 'Manual Labeler', REVIEWER: 'Reviewer', RESULT_ANALYST: 'Analyst', TERMINOLOGY: 'Terminology', LABELER: 'Labeler', ANALYST: 'Analyst' };
    const userRoleLabel = value => userRoleLabels[String(value || '').toUpperCase()] || String(value || 'User');
    const userDate = value => { const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) return '—'; const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${parsed.getDate()} ${months[parsed.getMonth()]} ${parsed.getFullYear()}, ${String(parsed.getHours()).padStart(2,'0')}:${String(parsed.getMinutes()).padStart(2,'0')}`; };
    function userBadge(label, tone) { const badge = document.createElement('span'); badge.className = `users-badge users-badge--${tone}`; badge.textContent = label; return badge; }
    const userRoleBadge = value => userBadge(userRoleLabel(value), String(value || '').toLowerCase());
    const userStatusBadge = row => {
        if (row?.is_active === false) return userBadge('INACTIVE', 'inactive');
        const workload = String(row?.status || '').toUpperCase();
        if (workload === 'BUSY') return userBadge('BUSY', 'busy');
        if (workload === 'AVAILABLE') return userBadge('AVAILABLE', 'available');
        return userBadge('Active', 'active');
    };
    function formattedLabelValue(labelName, value) {
        const input = String(value ?? '');
        if (/year|năm/i.test(labelName || '')) return input;
        const match = input.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?=\s|$)/i);
        if (!match) return input;
        const token = match[1];
        let formatted;
        if (/^-?\d+$/.test(token)) {
            if (token.replace('-', '').length < 5) return input;
            formatted = BigInt(token).toLocaleString('vi-VN');
        } else {
            const number = Number(token);
            if (!Number.isFinite(number) || Math.abs(number) < 10000) return input;
            formatted = number.toLocaleString('vi-VN', { maximumFractionDigits: 4 });
        }
        return formatted + input.slice(token.length);
    }
    function splitLabelValue(value, explicitSourceLabel) {
        const input = String(value ?? '');
        const marker = input.match(/\n\s*Nhãn nguồn:\s*/i);
        const sourceLabel = String(explicitSourceLabel ?? (marker ? input.slice(marker.index + marker[0].length) : '')).trim();
        return {
            editableValue: (marker ? input.slice(0, marker.index).trimEnd() : input).replace(/\s+text$/i, '').trim(),
            sourceLabel,
        };
    }
    function dueDateToIso(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
        if (!match) throw new Error('Vui lòng chọn ngày hết hạn hợp lệ.');
        const [, year, month, day] = match;
        const parsed = new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 0);
        if (parsed.getFullYear() !== Number(year) || parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day))
            throw new Error('Ngày hết hạn không hợp lệ.');
        return { parsed, iso: `${year}-${month}-${day}T23:59:00` };
    }
    const status = row => (row.is_active === false ? 'INACTIVE' : (row.status ?? (row.is_active ? 'ACTIVE' : '—')));
    const go = file => location.assign(file);
    function options(select, values, all = false) {
        if (!select) return;
        select.replaceChildren();
        if (all) select.add(new Option('All', ''));
        for (const value of values) {
            const [key, label] = Array.isArray(value) ? value : [value, value];
            select.add(new Option(label, key));
        }
    }
    function download(blob, name) {
        const url = URL.createObjectURL(blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    const exportJson = (value, name) => download(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), name);
    async function documentFile(row) {
        download(await request(`/documents/${row.id}/file`, { blob: true }), row.original_name || row.title);
    }
    function action(label, callback) {
        const b = document.createElement('button'); b.className = 'p-1 mx-1 text-primary hover:underline';
        b.title = label; b.setAttribute('aria-label',label);
        if (['edit_note','delete','visibility','edit','block','check_circle'].includes(label)) {
            const icon=document.createElement('span');icon.className='material-symbols-outlined text-[20px]';icon.textContent=label;b.append(icon);
        } else b.textContent=label;
        bind(b, callback); return b;
    }
    function avatarNode(row, sizeClass = 'w-9 h-9') {
        const holder=document.createElement('span');
        holder.className=`${sizeClass} user-avatar user-avatar--${String(row.role || 'user').toLowerCase()} shrink-0 overflow-hidden rounded-full inline-flex items-center justify-center font-bold`;
        holder.textContent=(row.username||'?').slice(0,2).toUpperCase();
        return holder;
    }
    function userIdentity(row) {
        const wrap=document.createElement('span');wrap.className='inline-flex items-center gap-3';
        const name=document.createElement('span');name.textContent=row.username;name.className='font-medium text-on-surface';
        wrap.append(avatarNode(row),name);return wrap;
    }
    const requestFrame=callback=>typeof window.requestAnimationFrame==='function'
        ? window.requestAnimationFrame(callback)
        : window.setTimeout(callback,0);
    const cancelFrame=id=>{
        if(typeof window.cancelAnimationFrame==='function')window.cancelAnimationFrame(id);
        else window.clearTimeout(id);
    };
    function setupTaskWorkspace() {
        const workspace=$('main');
        const pdfPane=workspace?.children[0];
        const dataPane=workspace?.children[1];
        if(!workspace||!pdfPane||!dataPane||!$('#pdfViewer',pdfPane))return;

        const storageKey=`aair.taskWorkspace.pdfPaneWidth.${document.body.classList.contains('manual-task-page')?'manual-v2':'default'}`;
        const defaultWidth=document.body.classList.contains('manual-task-page')?56:58;
        const clamp=value=>Math.min(80,Math.max(30,Number(value)||defaultWidth));
        let width=clamp(localStorage.getItem(storageKey));
        let frame=0;
        pdfPane.classList.add('workspace-pdf-pane');
        dataPane.classList.add('workspace-data-pane');
        $('#pdfViewer',pdfPane).parentElement?.classList.add('workspace-pdf-viewport');
        workspace.style.setProperty('--pdf-pane-width',`${width}%`);

        const splitter=document.createElement('button');
        splitter.type='button';
        splitter.className='task-workspace-splitter';
        splitter.title='Kéo để thay đổi chiều rộng vùng PDF';
        splitter.setAttribute('role','separator');
        splitter.setAttribute('aria-label','Thay đổi chiều rộng vùng PDF');
        splitter.setAttribute('aria-orientation','vertical');
        splitter.setAttribute('aria-valuemin','30');
        splitter.setAttribute('aria-valuemax','80');
        splitter.setAttribute('aria-valuenow',String(Math.round(width)));
        dataPane.before(splitter);

        const applyWidth=(next,persist=false)=>{
            width=clamp(next);
            cancelFrame(frame);
            frame=requestFrame(()=>{
                workspace.style.setProperty('--pdf-pane-width',`${width}%`);
                splitter.setAttribute('aria-valuenow',String(Math.round(width)));
                window.dispatchEvent(new Event('resize'));
            });
            if(persist)localStorage.setItem(storageKey,String(width));
        };
        const move=event=>{
            const bounds=workspace.getBoundingClientRect();
            applyWidth((event.clientX-bounds.left)/bounds.width*100);
        };
        const stop=event=>{
            if(splitter.hasPointerCapture(event.pointerId))splitter.releasePointerCapture(event.pointerId);
            document.body.classList.remove('task-workspace-resizing');
            applyWidth(width,true);
        };
        splitter.addEventListener('pointerdown',event=>{
            splitter.setPointerCapture(event.pointerId);
            document.body.classList.add('task-workspace-resizing');
            move(event);
        });
        splitter.addEventListener('pointermove',event=>{
            if(splitter.hasPointerCapture(event.pointerId))move(event);
        });
        splitter.addEventListener('pointerup',stop);
        splitter.addEventListener('pointercancel',stop);
        splitter.addEventListener('keydown',event=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
            event.preventDefault();
            const next=event.key==='Home'?30:event.key==='End'?80:width+(event.key==='ArrowLeft'?-2:2);
            applyWidth(next,true);
        });
        $$('[data-pdf-action]',pdfPane).forEach(button=>bind(button,()=>{
            const iframe=$('#pdfViewer',pdfPane);
            const viewer=iframe?.contentWindow?.PDFViewerApplication?.pdfViewer;
            const action=button.dataset.pdfAction;
            if(!viewer)return;
            if(action==='fit-width')viewer.currentScaleValue='page-width';
            if(action==='fit-page')viewer.currentScaleValue='page-fit';
            if(action==='rotate')viewer.pagesRotation=(viewer.pagesRotation+90)%360;
            if(action==='search')iframe.contentWindow?.document.querySelector('#viewFind')?.click();
        }));
    }
    function setupDocumentSidebar(options={}) {
        const sidebar=options.sidebar||document.querySelector('body > aside');
        const workspace=options.workspace||$('main');
        if(!sidebar||!workspace)return;

        const storagePrefix=options.storagePrefix||'aair.taskWorkspace.documentSidebar';
        const widthKey=`${storagePrefix}Width`;
        const expandedKey=`${storagePrefix}ExpandedWidth`;
        const defaultWidth=options.defaultWidth||157;
        const clamp=value=>Math.min(320,Math.max(80,Number(value)||defaultWidth));
        const savedRaw=localStorage.getItem(widthKey);
        const saved=savedRaw===null?defaultWidth:Number(savedRaw);
        let width=saved===0?0:clamp(saved);
        let expandedWidth=clamp(localStorage.getItem(expandedKey)||width||defaultWidth);
        let frame=0;
        let startX=0;
        let moved=false;

        const handle=document.createElement('button');
        handle.type='button';
        handle.className=`document-sidebar-handle${options.handleClass?` ${options.handleClass}`:''}`;
        handle.setAttribute('role','separator');
        handle.setAttribute('aria-label','Thay đổi chiều rộng danh sách tài liệu');
        handle.setAttribute('aria-orientation','vertical');
        handle.setAttribute('aria-valuemin','0');
        handle.setAttribute('aria-valuemax','320');
        const icon=document.createElement('span');
        icon.className='material-symbols-outlined';
        handle.append(icon);
        document.body.append(handle);

        const render=(next,persist=false)=>{
            width=next<=40?0:clamp(next);
            if(width>0)expandedWidth=width;
            cancelFrame(frame);
            frame=requestFrame(()=>{
                document.body.style.setProperty('--document-sidebar-width',`${width}px`);
                document.body.classList.toggle('document-sidebar-collapsed',width===0);
                handle.setAttribute('aria-valuenow',String(Math.round(width)));
                handle.setAttribute('aria-expanded',String(width>0));
                handle.title=width>0?'Kéo để đổi chiều rộng; bấm để thu gọn':'Bấm để mở danh sách tài liệu';
                icon.textContent=width>0?'chevron_left':'chevron_right';
                if(options.toggleButton){
                    options.toggleButton.setAttribute('aria-expanded',String(width>0));
                    options.toggleButton.setAttribute('aria-label',width>0?'Thu gọn danh sách tài liệu':'Mở danh sách tài liệu');
                    options.toggleButton.title=width>0?'Thu gọn danh sách tài liệu':'Mở danh sách tài liệu';
                    const toggleIcon=$('.material-symbols-outlined',options.toggleButton);
                    if(toggleIcon)toggleIcon.textContent=width>0?'chevron_left':'chevron_right';
                }
                window.dispatchEvent(new Event('resize'));
            });
            if(persist){
                localStorage.setItem(widthKey,String(width));
                if(width>0)localStorage.setItem(expandedKey,String(expandedWidth));
            }
        };
        const toggle=()=>render(width===0?expandedWidth:0,true);
        const move=event=>{
            moved=moved||Math.abs(event.clientX-startX)>3;
            render(event.clientX);
        };
        const stop=event=>{
            if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
            document.body.classList.remove('document-sidebar-resizing');
            render(width,true);
        };
        handle.addEventListener('pointerdown',event=>{
            if(event.button!==0)return;
            startX=event.clientX;moved=false;
            handle.setPointerCapture(event.pointerId);
            document.body.classList.add('document-sidebar-resizing');
        });
        handle.addEventListener('pointermove',event=>{
            if(handle.hasPointerCapture(event.pointerId))move(event);
        });
        handle.addEventListener('pointerup',event=>{
            stop(event);
            if(!moved)toggle();
        });
        handle.addEventListener('pointercancel',stop);
        handle.addEventListener('keydown',event=>{
            if(['Enter',' '].includes(event.key)){event.preventDefault();toggle();return;}
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
            event.preventDefault();
            const next=event.key==='Home'?0:event.key==='End'?320:width+(event.key==='ArrowLeft'?-12:12);
            render(next,true);
        });
        options.toggleButton?.addEventListener('click',toggle);
        render(width);
        return {toggle,render,get width(){return width;}};
    }
    // Keep the existing table and its cell styles; replace only its records.
    function table(el, columns, rows, actions, bodyTarget) {
        if (!el) return;
        const head = $('thead tr', el), body = bodyTarget || $('tbody', el) || el.createTBody();
        const oldCells = $$('tr:first-child td', body);
        const styles = tableStyles.get(el) || oldCells.map(c => c.className);
        const headStyle = $('th', el)?.className || 'px-4 py-3 text-left';
        head?.replaceChildren(...columns.map(([name]) => {
            const th = document.createElement('th'); th.className = headStyle; th.textContent = name; return th;
        }));
        body.replaceChildren();
        for (const row of rows) {
            const tr = document.createElement('tr'); tr.className = 'hover:bg-surface-container/30 transition-colors';
            columns.forEach(([, value], index) => {
                const td = document.createElement('td'); td.className = styles[index] || 'px-4 py-3 text-sm';
                if (value === '$actions') td.append(...actions(row));
                else {
                    const result = typeof value === 'function' ? value(row) : row[value];
                    if (result instanceof Node) td.append(result); else td.textContent = result ?? '—';
                }
                tr.append(td);
            });
            body.append(tr);
        }
        if (!rows.length) {
            const tr = body.insertRow(), td = tr.insertCell(); td.colSpan = columns.length;
            td.className = 'px-4 py-6 text-center text-on-surface-variant'; td.textContent = 'No data available.';
        }
    }
    function formatDocumentTable(el) {
        if (!el?.classList.contains('document-table')) return;
        $$('tbody tr', el).forEach(tr => {
            const cells = $$('td', tr);
            if (cells.length < 4) return;
            cells[0].classList.add('document-id');
            const fileName = cells[1].textContent.trim();
            const name = document.createElement('span'); name.className = 'document-name'; name.title = fileName; name.textContent = fileName; cells[1].replaceChildren(name);
            cells[2].classList.add('document-date');
            $$('button',cells[3]).forEach(button => {button.classList.add('document-action');const icon=text(button);const label=icon==='visibility'?'View':icon==='edit'?'Edit':icon==='delete'?'Delete':icon;button.title=label;button.setAttribute('aria-label',label);if(label==='Delete')button.classList.add('document-delete');});
        });
    }
    function formatSessionDate(value) {
        if (!value) return '—';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return '—';
        return new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}).format(parsed);
    }
    function formatSessionTable(el) {
        if (!el?.classList.contains('session-table')) return;
        $$('tbody tr', el).forEach(tr => {
            const cells = $$('td', tr);
            if (cells.length < 8) return;
            cells[0].classList.add('session-secondary');
            const sessionName = cells[1].textContent.trim() || 'Untitled session';
            const session = document.createElement('span'); session.className = 'session-name'; session.textContent = sessionName; session.title = sessionName; cells[1].replaceChildren(session);
            const typeText = cells[2].textContent.trim().toUpperCase();
            const type = document.createElement('span'); type.className = 'session-type-badge'; type.textContent = typeText === 'MANUAL' ? 'Manual' : typeText || '—'; cells[2].replaceChildren(type);
            const usersText = cells[3].textContent.trim(); const users = usersText && usersText !== '—' ? usersText.split(',').map(v => v.trim()).filter(Boolean) : [];
            const usersWrap = document.createElement('div'); usersWrap.className = 'session-users';
            if (!users.length) { const empty = document.createElement('span'); empty.className = 'session-empty'; empty.textContent = '—'; usersWrap.append(empty); }
            else { users.slice(0, 2).forEach(user => { const avatar = document.createElement('span'); avatar.className = 'session-avatar'; avatar.title = user; avatar.textContent = user.slice(0,2).toUpperCase(); usersWrap.append(avatar); }); if (users.length > 2) { const more = document.createElement('span'); more.className = 'session-user-more'; more.textContent = `+${users.length - 2}`; more.title = users.slice(2).join(', '); usersWrap.append(more); } }
            cells[3].replaceChildren(usersWrap);
            const due = cells[4].textContent.trim(); cells[4].classList.add('session-date'); cells[4].title = due && due !== '—' ? `Due date: ${due}` : 'No due date';
            if (due && due !== '—' && !Number.isNaN(new Date(due).getTime()) && new Date(due) < new Date()) { cells[4].classList.add('session-overdue'); cells[4].title = `Overdue · ${due}`; }
            const rawStatus = cells[5].textContent.trim().toUpperCase(); const status = document.createElement('span'); status.className = `session-status-badge session-status-badge--${rawStatus.toLowerCase() || 'draft'}`; status.textContent = rawStatus === 'ACTIVE' ? 'Active' : rawStatus === 'CLOSED' ? 'Closed' : 'Draft'; cells[5].replaceChildren(status);
            cells[6].classList.add('session-date');
            const actionButtons = $$('button', cells[7]); const actionWrap = document.createElement('div'); actionWrap.className = 'session-actions'; actionButtons.forEach(button => { const raw = text(button).trim(); const label = raw === 'edit' ? 'Edit' : raw === 'Tasks' ? 'Tasks' : raw === 'Start' ? 'Start' : raw === 'Close' ? 'Close' : raw; button.classList.add('session-action'); button.title = label; button.setAttribute('aria-label', label); if (label === 'Close') button.classList.add('session-close'); actionWrap.append(button); }); cells[7].replaceChildren(actionWrap);
        });
    }
    function formatTaskListTable(el) {
        if (!el?.classList.contains('task-list-table')) return;
        const statusLabels={PENDING:'Pending',IN_PROGRESS:'In progress',SUBMITTED:'Submitted',APPROVED:'Approved',REJECTED:'Rejected'};
        const statusClasses={PENDING:'pending',IN_PROGRESS:'progress',SUBMITTED:'submitted',APPROVED:'approved',REJECTED:'rejected'};
        $$('tbody tr',el).forEach(tr=>{
            const cells=$$('td',tr); if(cells.length<5)return;
            const documentLink=$('a',cells[0]); if(documentLink)documentLink.classList.add('cell-primary');
            const reviewerConflictIndex=cells.length===8?6:-1;
            const typeIndex=cells.length>=7?3:-1, statusIndex=cells.length>=7?4:2, dueIndex=cells.length>=7?5:3, actionIndex=cells.length-1;
            if(typeIndex>=0){const rawType=cells[typeIndex].textContent.trim().toUpperCase();const type=document.createElement('span');type.className='task-type';type.textContent=rawType==='AI_ASSISTED'?'AI-assisted':rawType==='MANUAL'?'Manual':rawType||'—';cells[typeIndex].replaceChildren(type);}
            const rawStatus=cells[statusIndex].textContent.trim().toUpperCase();const status=document.createElement('span');status.className=`task-status task-status--${statusClasses[rawStatus]||'pending'}`;status.textContent=statusLabels[rawStatus]||'Pending';cells[statusIndex].replaceChildren(status);
            const due=cells[dueIndex].textContent.trim();cells[dueIndex].classList.add('task-due');cells[dueIndex].title=due&&due!=='—'?`Due date: ${due}`:'No due date';const parsed=new Date(due);if(due&&due!=='—'&&!Number.isNaN(parsed.getTime())){const days=(parsed.getTime()-Date.now())/86400000;if(days<0){cells[dueIndex].classList.add('task-due--overdue');cells[dueIndex].textContent='Overdue';cells[dueIndex].title=`Overdue · ${due}`;}else if(days<=2){cells[dueIndex].classList.add('task-due--soon');cells[dueIndex].textContent=`Due in ${Math.max(1,Math.ceil(days))} days`;}}
            if(reviewerConflictIndex>=0){const raw=cells[reviewerConflictIndex].textContent.trim();const count=Number(raw);const conflict=document.createElement('span');conflict.className=`task-conflicts${Number.isFinite(count)&&count>0?' task-conflicts--active':''}`;conflict.textContent=Number.isFinite(count)&&count>0?`${count} conflict${count===1?'':'s'}`:'None';cells[reviewerConflictIndex].replaceChildren(conflict);}
            const action=$('button',cells[actionIndex]);if(action){action.classList.add('task-action');const label=text(action).trim();action.title=label;action.setAttribute('aria-label',label);}
        });
    }
    function listTable(rows, columns, actions, filterFields = [], config = {}) {
        const el = config.table || $('table');
        const search = config.search || $('input[placeholder^="Search"]:not(#modalContent input)');
        const selects = (config.selects || $$('header select')).filter(Boolean);
        const filterValue = (spec, row) => {
            const field = Array.isArray(spec) ? spec[0] : spec;
            return typeof field === 'function' ? field(row) : row[field];
        };
        const filterOptions = spec => Array.isArray(spec) && spec[1]
            ? spec[1]
            : [...new Set(rows.map(r => filterValue(spec, r)).filter(Boolean))].sort();
        let current = 0, folderFilter = '', sortIndex = config.defaultSortIndex ?? -1, sortDirection = config.defaultSortDirection ?? 1;
        selects.forEach((select, index) => {
            const field = filterFields[index];
            if (field) options(select, filterOptions(field), true);
            else { options(select, [], true); select.disabled = true; }
        });
        const pagers = config.pagers || buttons(/^(chevron_left|chevron_right|[1-6])$/);
        const render = () => {
            if(page==='Session.html'){
                const metrics=[rows.length,rows.filter(r=>r.status==='ACTIVE').length,rows.filter(r=>r.status==='DRAFT').length,rows.filter(r=>r.status==='CLOSED').length];
                $$('[data-session-stat]').forEach((value,index)=>{ value.textContent=String(metrics[index] ?? 0); });
                const count=$('[data-session-count]'); if(count) count.textContent=`${rows.length} ${rows.length === 1 ? 'session' : 'sessions'}`;
            }
            if(page==='DocumentManagement.html'){
                const types=['','PDF'];
                $$('.folder-card').forEach((card,index)=>{
                    if(index>=types.length){card.hidden=true;return;}
                    const type=types[index];$('h3',card).textContent=type||'All Files';
                    const count=rows.filter(r=>!type||String(r.document_type).toUpperCase()===type).length;
                    $('p',card).textContent=`${count} Files`;
                    const footer=card.lastElementChild;if(footer&&!footer.contains($('h3',card)))footer.textContent='';
                    card.onclick=()=>{folderFilter=type;current=0;const filter=selects[0];if(filter)filter.value=type;render();};
                    const countLabel=document.querySelector('[data-document-count]');if(countLabel)countLabel.textContent=rows.length+' files uploaded';
                });
            }
            const query = search?.value.toLocaleLowerCase().trim() || '';
            let filtered = rows.filter(row => Object.values(row).filter(v => typeof v !== 'object').join(' ').toLocaleLowerCase().includes(query)
                && selects.every((s, i) => !s.value || String(filterValue(filterFields[i], row)) === s.value));
            if(sortIndex>=0){
                const key=config.sortKeys?.[sortIndex] ?? columns[sortIndex]?.[1];
                filtered=[...filtered].sort((left,right)=>{
                    const a=typeof key==='function'?key(left):left[key],b=typeof key==='function'?key(right):right[key];
                    return String(a??'').localeCompare(String(b??''),'vi',{numeric:true,sensitivity:'base'})*sortDirection;
                });
            }
            const pages = Math.max(1, Math.ceil(filtered.length / 10)); current = Math.min(current, pages - 1);
            const visible=filtered.slice(current * 10, current * 10 + 10).map((row,index)=>config.numbered?{...row,__rowNumber:current*10+index+1}:row);
            table(el, columns, visible, actions, config.body);
            formatDocumentTable(el);
            formatSessionTable(el);
            formatTaskListTable(el);
            if(config.sortable)$$('thead th',el).forEach((th,index)=>{
                if(!config.sortKeys?.[index])return;
                th.style.cursor='pointer';th.title='Sắp xếp cột này';th.setAttribute('aria-sort',sortIndex===index?(sortDirection===1?'ascending':'descending'):'none');
                const indicator=document.createElement('span');indicator.className='table-sort-indicator material-symbols-outlined';indicator.textContent=sortIndex===index?(sortDirection===1?'arrow_upward':'arrow_downward'):'unfold_more';th.append(indicator);
                th.onclick=()=>{sortDirection=sortIndex===index?-sortDirection:1;sortIndex=index;current=0;render();};
            });
            pagers.forEach(b => {
                const label = text(b), number = Number(label);
                b.hidden = number > pages;
                b.disabled = label === 'chevron_left' ? current === 0 : label === 'chevron_right' ? current === pages - 1 : number === current + 1;
                b.setAttribute('aria-current', number === current + 1 ? 'page' : 'false');
            });
            if(page==='Session.html') pagers.forEach(b => { if (pages <= 1) b.hidden = true; });
            if(page==='Session.html') { const footer=$('.session-pagination'); if(footer) footer.hidden=pages<=1; }
            if(config.paginationContainer) config.paginationContainer.hidden=pages<=1;
            $$('p,span').filter(p => p.children.length === 0 && /^Showing\b/.test(text(p))).forEach(p => { p.textContent = `Showing ${filtered.length ? current * 10 + 1 : 0}–${Math.min((current + 1) * 10, filtered.length)} / ${filtered.length}`; });
        };
        search?.addEventListener('input', () => { current = 0; render(); });
        selects.forEach(s => s.addEventListener('change', () => { current = 0; folderFilter=''; render(); }));
        pagers.forEach(b => bind(b, () => { current = text(b) === 'chevron_left' ? current - 1 : text(b) === 'chevron_right' ? current + 1 : Number(text(b)) - 1; render(); }));
        render();
        return { reload(next) {
            rows = next;
            selects.forEach((select,index)=>{const field=filterFields[index];if(field){const value=select.value;options(select,filterOptions(field),true);select.value=[...select.options].some(o=>o.value===value)?value:'';}});
            render();
        } };
    }
    function modalOpen() { if ($('#modalOverlay')?.classList.contains('hidden')) window.toggleModal(); }
    function modalClose() { if ($('#modalOverlay') && !$('#modalOverlay').classList.contains('hidden')) window.toggleModal(); }
    function fieldLabel(field, label) {
        const l = $('label', field.parentElement); if (l) l.textContent = label;
        field.setAttribute('aria-label', label);
    }
    function required(field, label) {
        if (!field.value.trim()) throw new Error(`Vui lòng nhập ${label}.`);
        return field.value.trim();
    }
    async function termsPage() {
        if (window.AAIRTerminologyPage) return window.AAIRTerminologyPage({request,notice,user});
        let rows = await request('/terms'), editing = null;
        const term = $('input[placeholder="e.g. Operating Income"]');
        const definition = $('textarea'), category = $('main select');
        const state = $('#termStatus');
        state.value = 'ACTIVE';
        const reset = () => { editing = null; term.value = ''; definition.value = ''; category.selectedIndex = 0; state.value = 'ACTIVE'; };
        const edit = row => { editing = row.id; term.value = row.term; definition.value = row.definition; state.value = row.status;
            if (![...category.options].some(o => o.value === row.category)) category.add(new Option(row.category, row.category));
            category.value = row.category || category.options[0].value; term.focus(); };
        const refresh = async () => { rows = await request('/terms'); list.reload(rows); };
        const list = listTable(rows, [['Financial Term','term'], ['Definition','definition'], ['Category','category'], ['Status','status'], ['Last Updated', r => date(r.updated_at)], ['Actions','$actions']], row => [
            action('edit_note', () => edit(row)), action('delete', async () => { if (confirm(`Xóa thuật ngữ “${row.term}”?`)) { await request(`/terms/${row.id}`, {method:'DELETE'}); if (editing === row.id) reset(); await refresh(); } }),
        ], ['category','status']);
        bindText(/^Save Term$/, async () => {
            const json = { term: required(term, 'thuật ngữ'), definition: required(definition, 'định nghĩa'), category: category.selectedIndex ? category.value : '', status: state.value };
            if (!['ACTIVE','INACTIVE'].includes(json.status)) throw new Error('Status phải là ACTIVE hoặc INACTIVE.');
            await request(editing ? `/terms/${editing}` : '/terms', { method: editing ? 'PUT' : 'POST', json });
            reset(); await refresh(); notice('Đã lưu thuật ngữ.');
        });
        bindText(/^Cancel$/, reset);
        $('#csvFileInput').addEventListener('change', e => run(e.target, async () => {
            const file = e.target.files[0]; if (!file) return;
            const records = parseCsv(await file.text());
            const header = records.shift()?.map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase());
            if (!header?.includes('term') || !header.includes('definition')) throw new Error('CSV cần cột term, definition; có thể thêm category, status.');
            const imports = records.filter(r => r.some(Boolean)).map(r => Object.fromEntries(header.map((h,i) => [h, r[i] || ''])));
            if (imports.some(r => !r.term.trim() || !r.definition.trim() || !['ACTIVE','INACTIVE'].includes(r.status || 'ACTIVE'))) throw new Error('CSV có dòng thiếu term/definition hoặc status không hợp lệ.');
            let saved = 0;
            try { for (const row of imports) { await request('/terms', {method:'POST', json:{...row, status: row.status || 'ACTIVE'}}); saved++; } }
            catch (error) { throw new Error(`Đã nhập ${saved}/${imports.length} dòng; dừng ở dòng ${saved + 2}: ${error.message}`); }
            finally { await refresh(); e.target.value = ''; }
            notice(`Đã nhập ${saved} thuật ngữ.`);
        }));
    }
    function parseCsv(source) {
        const rows = []; let row = [], value = '', quoted = false;
        for (let i = 0; i < source.length; i++) {
            const c = source[i];
            if (c === '"') { if (quoted && source[i+1] === '"') { value += '"'; i++; } else quoted = !quoted; }
            else if (c === ',' && !quoted) { row.push(value); value = ''; }
            else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && source[i+1] === '\n') i++; row.push(value); rows.push(row); row=[]; value=''; }
            else value += c;
        }
        if (quoted) throw new Error('CSV có dấu ngoặc kép chưa đóng.');
        if (value || row.length) { row.push(value); rows.push(row); } return rows;
    }
    async function promptsPage() {
        let editing = null;
        const systemPrompt = await request('/prompts/system-default').catch(() => '');
        const modal = $('#modalContent'), name = $('input', modal), [description, content] = $$('textarea', modal), [active, model] = $$('select', modal);
        fieldLabel(active, 'Status'); options(active, [['true','ACTIVE'],['false','INACTIVE']]);
        const save = buttons(/^Create Prompt$/, modal)[0];
        const reset = () => { editing = null; name.value = ''; description.value = ''; content.value = systemPrompt; active.value = 'true'; model.selectedIndex = 0; save.textContent = 'Create Prompt'; };
        const edit = row => {
            editing = row.id; name.value = row.name; description.value = row.description || ''; content.value = row.content;
            active.value = String(row.is_active);
            if (row.model && ![...model.options].some(o => o.value === row.model)) model.add(new Option(row.model, row.model));
            model.value = row.model || model.options[0].value; save.textContent = 'Save Prompt'; modalOpen();
        };
        const refresh = async () => list.reload(await request('/prompts'));
        const list = listTable(await request('/prompts'), [['Prompt','name'],['Purpose','description'],['Model','model'],['Status',status],['Updated',r=>date(r.updated_at)],['Action','$actions']], row => [
            action('edit',()=>edit(row)), action(row.is_active ? 'Disable' : 'Enable', async()=>{ await request(`/prompts/${row.id}`,{method:'PUT',json:{name:row.name,description:row.description,content:row.content,model:row.model,active:!row.is_active}}); await refresh(); }),
            action('delete',async()=>{if(confirm(`Xóa prompt “${row.name}”?`)){await request(`/prompts/${row.id}`,{method:'DELETE'});await refresh();}}),
        ], [status]);
        bindText(/New Prompt/, () => { reset(); modalOpen(); });
        bind(save, async () => {
            await request(editing ? `/prompts/${editing}` : '/prompts', {method: editing ? 'PUT':'POST', json:{name:required(name,'tên prompt'),description:description.value,content:required(content,'nội dung prompt'),model:model.selectedIndex ? model.value : '',active:active.value==='true'}});
            modalClose(); reset(); await refresh(); notice('Đã lưu prompt.');
        });
    }
    async function usersPage() {
        const canManageUsers = ['ADMIN','MANAGER'].includes(user.role);
        const endpoint = canManageUsers ? '/users' : '/assignees';
        const refresh = async () => list.reload(await request(endpoint));
        const roles = canManageUsers ? await request('/roles') : [];
        const usersTable = $('main table'); usersTable?.classList.add('users-table');
        const search = $('input[placeholder^="Search"]:not(#modalContent input)');
        if (search) { search.classList.add('users-search'); search.placeholder = 'Search users…'; }
        const filters = $$('header select'); filters.forEach(select => select.classList.add('filter-select'));
        const paginationContainer = usersTable?.nextElementSibling;
        const list = listTable(await request(endpoint), [['#',r=>r.__rowNumber],['Username',userIdentity],['Email','email'],['Role',r=>userRoleBadge(r.role)],['Status',r=>canManageUsers ? userStatusBadge(r) : status(r)],['Created',r=>userDate(r.created_at)],['Actions','$actions']], row => canManageUsers ? [
            (() => { const button = action('edit',()=>edit(row)); button.classList.add('users-action'); button.title = 'Edit user'; button.setAttribute('aria-label','Edit user'); return button; })(),
            (() => { const label = row.is_active ? 'Deactivate user' : 'Activate user'; const button = action(row.is_active?'block':'check_circle',async()=>{
                if (!confirm(`${row.is_active?'Deactivate':'Activate'} user ${row.username}?`)) return;
                await request(`/users/${row.id}`,{method:'PUT',json:{role:row.role,active:!row.is_active}}); await refresh();
            }); button.classList.add('users-action', 'users-action--toggle'); button.title = label; button.setAttribute('aria-label', label); if (Number(row.id) === Number(user.id)) { button.disabled = true; button.title = 'You cannot deactivate your own account'; } return button; })(),
        ] : [], canManageUsers ? [[r=>r.role, roles], r=>status(r)] : ['role', r=>'ACTIVE'], {numbered:true,sortable:true,sortKeys:[null,'username','email',r=>r.role,r=>status(r),'created_at',null],search,selects:filters,paginationContainer});
        const modal=$('#modalContent'), [username,unused,email] = $$('input:not([type="checkbox"])',modal), role=$('select',modal);
        let editing=null;
        fieldLabel(username,'Username'); username.placeholder='e.g. manager02';
        unused.parentElement.hidden=true;
        fieldLabel(email,'Gmail'); email.placeholder='username@gmail.com'; email.type='email';
        fieldLabel(role,'Role'); options(role,roles);
        role.insertBefore(new Option('— Không chọn —',''), role.firstChild);
        const save=buttons(/^Create$/,modal)[0];
        const reset=()=>{editing=null;username.value='';username.disabled=false;email.value='';email.disabled=false;role.value='MANAGER';save.textContent='Create';$('h3',modal).textContent='Create User';};
        function edit(row){reset();editing=row;username.value=row.username;username.disabled=true;email.value=row.email||'';email.disabled=true;if(![...role.options].some(o=>o.value===row.role))role.add(new Option(row.role,row.role));role.value=row.role;save.textContent='Save';$('h3',modal).textContent='Edit User';modalOpen();}
        bindText(/^New$|New Manager|New User|New user/,()=>{reset();modalOpen();});
        bind(save,async()=>{
            const isEditing=Boolean(editing);
            const json=editing?{role:role.value,active:editing.is_active}:{username:required(username,'tên tài khoản'),email:required(email,'Gmail'),role:role.value};
            await request(editing?`/users/${editing.id}`:'/users',{method:editing?'PUT':'POST',json});
            modalClose();reset();await refresh();
            notice(isEditing?'Đã cập nhật tài khoản.':'Đã tạo tài khoản, gửi email và làm mới bảng.');
        });
    }
    async function documentsPage() {
        const documentTable=$('table'); documentTable?.classList.add('document-table');
        const documentDate=value=>{if(!value)return 'Date unavailable';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Date unavailable':new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(parsed);};
        let pendingFiles=[];
        const refresh = async()=>list.reload([...pendingFiles.map((file,index)=>({id:-(index+1),title:file.name,original_name:file.name,document_type:'PDF',uploaded_by_username:user.username,created_at:new Date().toISOString(),status:'NEW',pending:true})),...await request('/documents')]);
        const list=listTable(await request('/documents'),[['ID','id'],['File Name','title'],['Upload Date',r=>documentDate(r.created_at)],['Actions','$actions']],row=>row.pending?[]:[
            action('visibility',()=>documentFile(row)),action('edit',async()=>{
                const title=prompt('Tên tài liệu',row.title);if(title===null)return;if(!title.trim())throw new Error('Tên tài liệu không được trống.');
                await request(`/documents/${row.id}`,{method:'PUT',json:{title:title.trim(),documentType:row.document_type}});await refresh();
            }),action('delete',async()=>{if(confirm(`Xóa tài liệu “${row.title}”?`)){await request(`/documents/${row.id}`,{method:'DELETE'});await refresh();}}),
        ],['document_type'],{table:documentTable,sortable:true,sortKeys:[null,'title',r=>r.created_at,null],defaultSortIndex:2,defaultSortDirection:-1,paginationContainer:$('#documentPagination')});
        const input=$('#documentInput');input.accept='.pdf,application/pdf';input.multiple=true;
        const saveButton=$('#saveDocumentsButton');
        const syncSaveState=()=>{saveButton.disabled=!pendingFiles.length;saveButton.setAttribute('aria-disabled',String(saveButton.disabled));saveButton.classList.toggle('opacity-50',saveButton.disabled);saveButton.classList.toggle('cursor-not-allowed',saveButton.disabled);};
        syncSaveState();
        input.addEventListener('change',()=>run(input,async()=>{
            const files=[...input.files];if(!files.length)return;
            try {
                const invalid=files.find(file=>!/\.pdf$/i.test(file.name)||file.size===0||file.size>50*1024*1024);
                if(invalid)throw new Error(`File “${invalid.name}” không hợp lệ. Chỉ chọn PDF có nội dung, tối đa 50 MB mỗi file.`);
                pendingFiles.push(...files);syncSaveState();await refresh();
            } finally {input.value='';}
        }));
        bind(saveButton,async()=>{
            if(!pendingFiles.length)return;
            const files=[...pendingFiles];let uploaded=0;
            for(const file of files){const data=new FormData();data.append('file',file);data.append('metadata',new Blob([JSON.stringify({title:file.name,documentType:'PDF'})],{type:'application/json'}));await request('/documents',{method:'POST',body:data});uploaded++;}
            pendingFiles=[];syncSaveState();notice(`Đã lưu ${uploaded} tài liệu vào cơ sở dữ liệu.`);window.location.reload();
        });
        window.addEventListener('beforeunload',event=>{if(!pendingFiles.length)return;event.preventDefault();event.returnValue='Xác nhận lưu thay đổi?';});
    }
    async function sessionsPage() {
        // Use the assignment endpoint so availability is calculated from active sessions,
        // even when the users.status column has not been refreshed yet.
        const [documents, userRows] = await Promise.all([request('/documents'),request('/assignees')]);
        const assignees=(userRows||[]).filter(row=>['USER','AI_LABELER','MANUAL_LABELER','REVIEWER','RESULT_ANALYST'].includes(String(row.role||'').toUpperCase()));
        const modal=$('#modalContent'), name=$('input[placeholder^="e.g."]',modal), description=$('textarea',modal);
        const lists=$$('div.max-h-48',modal);
        const [documentList,typeList,memberList]=lists;
        const selected=container=>$$('input:checked',container).map(i=>i.value);
        let editing=null, createdId=null, pendingTasks=[];
        const save=buttons(/^Create Session$/,modal)[0];
        function checkList(container,rows,key,radio=false){
            container.replaceChildren(...rows.map(row=>{
                const label=document.createElement('label');label.className='flex items-center gap-3 px-4 py-3 border-b border-outline-variant cursor-pointer';
                const input=document.createElement('input');input.type=radio?'radio':'checkbox';input.name=key;input.value=row.id;input.className='rounded border-outline-variant text-primary';
                const span=document.createElement('span');span.textContent=row.name;label.append(input,span);return label;
            }));
        }
        checkList(documentList,documents.map(d=>({id:d.id,name:d.title})),'documents');
        checkList(typeList,[{id:'MANUAL',name:'Manual labeling'},{id:'AI',name:'AI labeling'}],'sessionType',true);
        $('input',typeList).checked=true;
        const modelSection=typeList.parentElement;
        $('p',modelSection).textContent='Session Type';
        $$('p',modelSection)[1].textContent='Chọn gán nhãn AI, thủ công hoặc cả hai.';
        const modelSearch=$('input[placeholder="Search AI models..."]',modal);modelSearch.parentElement.hidden=true;
        const assignmentRoleLabel=u=>u.role==='RESULT_ANALYST'?'RESULT ANALYST':u.role==='REVIEWER'?'REVIEWER':u.role;
        checkList(memberList,assignees.map(u=>({id:u.id,name:`${u.username} — ${assignmentRoleLabel(u)}`})),'members');
        const userSection=memberList.parentElement;
        const userSearchRow=memberList.previousElementSibling;
        userSearchRow?.remove();
        const userCountSpan=$$('span',userSection).find(s=>/Selected$/.test(text(s)));

        const manualAssignContainer=document.createElement('div');
        manualAssignContainer.id='manualAssignContainer';
        manualAssignContainer.className='space-y-4';
        manualAssignContainer.innerHTML=`
            <div class="space-y-1.5">
                <label class="text-label-md text-on-surface-variant uppercase tracking-wider font-bold">
                    Manual Labeler 1 <span class="text-error font-normal">*</span>
                </label>
                <select id="manualLabeler1" class="w-full px-4 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-body-md cursor-pointer">
                    <option value="">Select user...</option>
                </select>
            </div>
            <div class="space-y-1.5">
                <label class="text-label-md text-on-surface-variant uppercase tracking-wider font-bold">
                    Manual Labeler 2 <span class="text-error font-normal">*</span>
                </label>
                <select id="manualLabeler2" class="w-full px-4 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-body-md cursor-pointer">
                    <option value="">Select user...</option>
                </select>
            </div>
            <div class="space-y-1.5">
                <label class="text-label-md text-on-surface-variant uppercase tracking-wider font-bold">
                    Reviewer <span class="text-error font-normal">*</span>
                </label>
                <select id="manualReviewer" class="w-full px-4 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-body-md cursor-pointer">
                    <option value="">Select user...</option>
                </select>
            </div>
        `;
        userSection.appendChild(manualAssignContainer);

        const aiAssignContainer=document.createElement('div');
        aiAssignContainer.id='aiAssignContainer';
        aiAssignContainer.className='space-y-4';
        aiAssignContainer.innerHTML=`
            <div class="space-y-1.5">
                <label class="text-label-md text-on-surface-variant uppercase tracking-wider font-bold">
                    AI Labeler <span class="text-error font-normal">*</span>
                </label>
                <select id="aiLabeler" class="w-full px-4 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-body-md cursor-pointer">
                    <option value="">Select user...</option>
                </select>
            </div>
            <div class="space-y-1.5">
                <label class="text-label-md text-on-surface-variant uppercase tracking-wider font-bold">
                    Result Analyst <span class="text-error font-normal">*</span>
                </label>
                <select id="aiReviewer" class="w-full px-4 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-body-md cursor-pointer">
                    <option value="">Select user...</option>
                </select>
            </div>
        `;
        userSection.appendChild(aiAssignContainer);

        const m1Select=$('#manualLabeler1',manualAssignContainer);
        const m2Select=$('#manualLabeler2',manualAssignContainer);
        const reviewerSelect=$('#manualReviewer',manualAssignContainer);

        const aiLabelerSelect=$('#aiLabeler',aiAssignContainer);
        const aiReviewerSelect=$('#aiReviewer',aiAssignContainer);

        let currentAssignees=assignees;
        const roleOf=user=>String(user?.role||'').toUpperCase();
        const isUnavailable=user=>user?.is_active===false||String(user?.status||'UNKNOWN').toUpperCase()!=='AVAILABLE';
        const selectableUser=user=>['USER','AI_LABELER','MANUAL_LABELER','REVIEWER','RESULT_ANALYST'].includes(roleOf(user));
        const canManual=user=>selectableUser(user)&&['USER','MANUAL_LABELER'].includes(roleOf(user));
        const canAi=user=>selectableUser(user)&&['USER','AI_LABELER'].includes(roleOf(user));
        const canManualReview=user=>selectableUser(user)&&['USER','REVIEWER'].includes(roleOf(user));
        const canAiReview=user=>selectableUser(user)&&['USER','RESULT_ANALYST'].includes(roleOf(user));
        let manualLabelers=currentAssignees.filter(canManual);
        let aiLabelers=currentAssignees.filter(canAi);
        let manualReviewers=currentAssignees.filter(canManualReview);
        let aiReviewers=currentAssignees.filter(canAiReview);

        function formatUserOptionLabel(user){
            if(!user)return '';
            const status=user.is_active===false?'INACTIVE':String(user.status||'UNKNOWN').toUpperCase();
            return `${user.username} — ${status}`;
        }

        function populateSelect(select,users,defaultLabel){
            const currentVal=select.value;
            select.replaceChildren();
            const defaultOpt=document.createElement('option');
            defaultOpt.value='';
            defaultOpt.textContent=defaultLabel;
            select.appendChild(defaultOpt);
            for(const u of users){
                const opt=document.createElement('option');
                opt.value=String(u.id);
                opt.textContent=formatUserOptionLabel(u);
                opt.disabled=isUnavailable(u);
                if(String(u.id)===currentVal)opt.selected=true;
                select.appendChild(opt);
            }
        }

        function populateManualOptions(){
            populateSelect(m1Select,manualLabelers,'Select user...');
            populateSelect(m2Select,manualLabelers,'Select user...');
            populateSelect(reviewerSelect,manualReviewers,'Select user...');
            syncAssignmentOptions();
        }

        function populateAiOptions(){
            populateSelect(aiLabelerSelect,aiLabelers,'Select user...');
            populateSelect(aiReviewerSelect,aiReviewers,'Select user...');
            syncAiAssignmentOptions();
        }

        function renderAssignmentDropdowns(assigneeList=currentAssignees){
            currentAssignees=assigneeList||[];
            manualLabelers=currentAssignees.filter(canManual);
            aiLabelers=currentAssignees.filter(canAi);
            manualReviewers=currentAssignees.filter(canManualReview);
            aiReviewers=currentAssignees.filter(canAiReview);
            populateManualOptions();
            populateAiOptions();
        }
        window.renderAssignmentDropdowns=renderAssignmentDropdowns;

        function syncAssignmentOptions(){
            const val1=m1Select.value;
            const val2=m2Select.value;
            const valRev=reviewerSelect.value;

            $$('option',m1Select).forEach(opt=>{
                if(!opt.value)return;
                const taken=(opt.value===val2 && val2!=='')||(opt.value===valRev && valRev!=='');
                const user=manualLabelers.find(u=>String(u.id)===opt.value);
                opt.disabled=isUnavailable(user)||taken;
                if(user){
                    const label=formatUserOptionLabel(user);
                    opt.textContent=taken?`${label} (Selected)`:label;
                }
            });

            $$('option',m2Select).forEach(opt=>{
                if(!opt.value)return;
                const taken=(opt.value===val1 && val1!=='')||(opt.value===valRev && valRev!=='');
                const user=manualLabelers.find(u=>String(u.id)===opt.value);
                opt.disabled=isUnavailable(user)||taken;
                if(user){
                    const label=formatUserOptionLabel(user);
                    opt.textContent=taken?`${label} (Selected)`:label;
                }
            });

            $$('option',reviewerSelect).forEach(opt=>{
                if(!opt.value)return;
                const taken=(opt.value===val1 && val1!=='')||(opt.value===val2 && val2!=='');
                const user=manualReviewers.find(u=>String(u.id)===opt.value);
                opt.disabled=isUnavailable(user)||taken;
                if(user){
                    const label=formatUserOptionLabel(user);
                    opt.textContent=taken?`${label} (Selected)`:label;
                }
            });

            const count=[val1,val2,valRev].filter(Boolean).length;
            if(userCountSpan && !manualAssignContainer.hidden)userCountSpan.textContent=`${count} Selected`;
        }

        function syncAiAssignmentOptions(){
            const valAi=aiLabelerSelect.value;
            const valRev=aiReviewerSelect.value;

            $$('option',aiLabelerSelect).forEach(opt=>{
                if(!opt.value)return;
                const taken=(opt.value===valRev && valRev!=='');
                const user=aiLabelers.find(u=>String(u.id)===opt.value);
                opt.disabled=isUnavailable(user)||taken;
                if(user){
                    const label=formatUserOptionLabel(user);
                    opt.textContent=taken?`${label} (Selected)`:label;
                }
            });

            $$('option',aiReviewerSelect).forEach(opt=>{
                if(!opt.value)return;
                const taken=(opt.value===valAi && valAi!=='');
                const user=aiReviewers.find(u=>String(u.id)===opt.value);
                opt.disabled=isUnavailable(user)||taken;
                if(user){
                    const label=formatUserOptionLabel(user);
                    opt.textContent=taken?`${label} (Selected)`:label;
                }
            });

            const count=[valAi,valRev].filter(Boolean).length;
            if(userCountSpan && !aiAssignContainer.hidden)userCountSpan.textContent=`${count} Selected`;
        }

        m1Select.addEventListener('change',()=>{
            if(m1Select.value && m1Select.value===m2Select.value)m2Select.value='';
            if(m1Select.value && m1Select.value===reviewerSelect.value)reviewerSelect.value='';
            syncAssignmentOptions();
        });
        m2Select.addEventListener('change',()=>{
            if(m2Select.value && m2Select.value===m1Select.value)m1Select.value='';
            if(m2Select.value && m2Select.value===reviewerSelect.value)reviewerSelect.value='';
            syncAssignmentOptions();
        });
        reviewerSelect.addEventListener('change',()=>{
            if(reviewerSelect.value && reviewerSelect.value===m1Select.value)m1Select.value='';
            if(reviewerSelect.value && reviewerSelect.value===m2Select.value)m2Select.value='';
            syncAssignmentOptions();
        });

        aiLabelerSelect.addEventListener('change',()=>{
            if(aiLabelerSelect.value && aiLabelerSelect.value===aiReviewerSelect.value)aiReviewerSelect.value='';
            syncAiAssignmentOptions();
        });
        aiReviewerSelect.addEventListener('change',()=>{
            if(aiReviewerSelect.value && aiReviewerSelect.value===aiLabelerSelect.value)aiLabelerSelect.value='';
            syncAiAssignmentOptions();
        });

        renderAssignmentDropdowns(currentAssignees);

        let previousType='MANUAL';
        const syncSessionType=()=>{
            const type=selected(typeList)[0]||'MANUAL';
            if(type!==previousType){
                if(type==='AI'){
                    m1Select.value='';
                    m2Select.value='';
                    reviewerSelect.value='';
                    syncAssignmentOptions();
                }else{
                    aiLabelerSelect.value='';
                    aiReviewerSelect.value='';
                    syncAiAssignmentOptions();
                }
                previousType=type;
            }
            if(type==='AI'){
                manualAssignContainer.hidden=true;
                aiAssignContainer.hidden=false;
                if(userSearchRow)userSearchRow.hidden=true;
                memberList.hidden=true;
                syncAiAssignmentOptions();
            }else{
                manualAssignContainer.hidden=false;
                aiAssignContainer.hidden=true;
                if(userSearchRow)userSearchRow.hidden=true;
                memberList.hidden=true;
                syncAssignmentOptions();
            }
        };
        typeList.addEventListener('change',syncSessionType);
        syncSessionType();

        for(const container of lists){
            const section=container.parentElement, search=$('input[placeholder^="Search"]',section);
            search?.addEventListener('input',()=>$$('label',container).forEach(l=>l.hidden=!text(l).toLowerCase().includes(search.value.toLowerCase())));
            bindText(/^Select All$/,()=>$$('input[type="checkbox"]',container).forEach(i=>i.checked=true),section);
            if(container===typeList)buttons(/^Select All$/,section).forEach(b=>b.hidden=true);
            container.addEventListener('change',()=>{
                const counter=$$('span',section).find(s=>/Selected$/.test(text(s)));if(counter && container!==memberList)counter.textContent=`${selected(container).length} Selected`;
            });
        }
        const startDate=$('#sessionStartDate',modal), dueDate=$('#sessionDueDate',modal);
        startDate.closest('[class~="space-y-1.5"]').hidden=true;
        dueDate.setAttribute('aria-label','Session due date');dueDate.required=true;
        const setDueDateMinimum=()=>{
            const tomorrow=new Date();
            tomorrow.setHours(0,0,0,0);
            tomorrow.setDate(tomorrow.getDate()+1);
            const month=String(tomorrow.getMonth()+1).padStart(2,'0');
            const day=String(tomorrow.getDate()).padStart(2,'0');
            dueDate.min=`${tomorrow.getFullYear()}-${month}-${day}`;
        };
        const dueLabel=$('label',dueDate.parentElement.parentElement);if(dueLabel)dueLabel.textContent='Session Due Date *';
        const reset=()=>{
            editing=null;name.value='';description.value='';dueDate.value='';setDueDateMinimum();name.disabled=false;description.disabled=false;
            $$('input',documentList).forEach(i=>i.checked=false);$$('input',memberList).forEach(i=>i.checked=false);
            documentList.parentElement.hidden=false;typeList.parentElement.hidden=false;dueDate.parentElement.parentElement.hidden=false;
            m1Select.value='';m2Select.value='';reviewerSelect.value='';
            aiLabelerSelect.value='';aiReviewerSelect.value='';
            const typeInputs=$$('input',typeList);if(typeInputs[0])typeInputs[0].checked=true;
            previousType='MANUAL';
            syncSessionType();
            save.textContent='Create Session';$('h3',modal).textContent='Create Session';
        };
        const edit=row=>{
            reset();editing=row;name.value=row.name;description.value=row.description||'';name.disabled=true;description.disabled=true;
            documentList.parentElement.hidden=true;typeList.parentElement.hidden=true;dueDate.parentElement.parentElement.hidden=true;
            manualAssignContainer.hidden=true;aiAssignContainer.hidden=true;if(userSearchRow)userSearchRow.hidden=false;memberList.hidden=false;
            $$('input',memberList).forEach(i=>i.checked=row.members.some(m=>String(m.id)===i.value));save.textContent='Save Members';$('h3',modal).textContent='Assign Users';modalOpen();
        };
        const reloadAssignees=async()=>{
            try{
                const fetchedRows=await request('/assignees');
                const fetched=(fetchedRows||[]).filter(row=>['USER','AI_LABELER','MANUAL_LABELER','REVIEWER','RESULT_ANALYST'].includes(String(row.role||'').toUpperCase()));
                renderAssignmentDropdowns(fetched);
                checkList(memberList,currentAssignees.map(u=>({id:u.id,name:`${u.username} — ${assignmentRoleLabel(u)}`})),'members');
            }catch{}
        };
        const refresh=async()=>{list.reload(await request('/sessions'));await reloadAssignees();};
        const sessionTable=$('#sessionTable') || $('table'); sessionTable?.classList.add('session-table');
        const list=listTable(await request('/sessions'),[['ID','id'],['Session','name'],['Type','session_type'],['Assigned Users',r=>(r.members||[]).map(m=>m.username).join(', ')||'—'],['Due Date',r=>formatSessionDate(r.due_at)],['Status','status'],['Created',r=>formatSessionDate(r.created_at)],['Actions','$actions']],row=>[
            action('edit',()=>edit(row)),action('Tasks',async()=>{
                const tasks=(await request('/tasks')).filter(t=>t.session_id===row.id);
                exportJson(tasks,`session-${row.id}-tasks.json`);notice(`${tasks.length} tasks were exported with their assignments.`);
            }),...(row.status==='CLOSED'?[]:[action(row.status==='DRAFT'?'Start':'Close',async()=>{
                if(!confirm(`${row.status==='DRAFT'?'Start':'Close'} session “${row.name}”?`))return;
                await request(`/sessions/${row.id}/status`,{method:'PATCH',json:{status:row.status==='DRAFT'?'ACTIVE':'CLOSED'}});await refresh();
            })]),
        ],[['status',[['ACTIVE','Active'],['DRAFT','Draft'],['CLOSED','Closed']]]]);
        // Hide the static empty-state card; the actual table supplies its empty state.
        $$('h3').filter(h=>/No AI sessions/.test(text(h))).forEach(h=>h.parentElement.hidden=true);
        bindText(/New Session|Create First Session/,async()=>{reset();modalOpen();await reloadAssignees();});
        bind(save,async()=>{
            const userIds=selected(memberList).map(Number);
            if(editing){await request(`/sessions/${editing.id}/members`,{method:'PUT',json:{userIds}});modalClose();await refresh();notice('Đã cập nhật thành viên.');return;}
            const type=selected(typeList)[0]||'MANUAL', docIds=selected(documentList).map(Number);

            if(type==='MANUAL'){
                required(name,'tên phiên');
                required(dueDate,'ngày hết hạn');
                if(dueDate.value<dueDate.min)throw new Error('Ngày hết hạn phải ở tương lai.');
                const sessionDue=dueDateToIso(dueDate.value);
                if(sessionDue.parsed<=new Date())throw new Error('Ngày hết hạn phải ở tương lai.');
                if(!docIds.length)throw new Error('Vui lòng chọn ít nhất một tài liệu PDF.');

                if(!m1Select.value)throw new Error('Vui lòng chọn Manual Labeler 1.');
                if(!m2Select.value)throw new Error('Vui lòng chọn Manual Labeler 2.');
                if(!reviewerSelect.value)throw new Error('Vui lòng chọn Reviewer.');

                const m1Id=Number(m1Select.value);
                const m2Id=Number(m2Select.value);
                const revId=Number(reviewerSelect.value);

                const chosenIds=[m1Id,m2Id,revId].filter(Boolean);
                if(new Set(chosenIds).size!==chosenIds.length)throw new Error('Không được chọn trùng người dùng giữa các vai trò.');

                const m1User=currentAssignees.find(u=>u.id===m1Id);
                const m2User=currentAssignees.find(u=>u.id===m2Id);
                const revUser=currentAssignees.find(u=>u.id===revId);

                const hasRole=(candidate,...roles)=>candidate&&roles.includes(String(candidate.role||'').toUpperCase());
                if(!hasRole(m1User,'USER','MANUAL_LABELER'))throw new Error('Manual Labeler 1 phải là tài khoản USER hoặc MANUAL_LABELER.');
                if(!hasRole(m2User,'USER','MANUAL_LABELER'))throw new Error('Manual Labeler 2 phải là tài khoản USER hoặc MANUAL_LABELER.');
                if(!hasRole(revUser,'USER','REVIEWER'))throw new Error('Reviewer phải là tài khoản USER hoặc REVIEWER.');

                const manualLabelerIds=[m1Id,m2Id];

                const payload={
                    name:name.value.trim(),
                    description:description.value?description.value.trim():null,
                    sessionType:'MANUAL',
                    dueAt:sessionDue.iso,
                    documents:docIds,
                    manualLabelerIds,
                    aiLabelerId:null,
                    reviewerId:revId,
                    assistanceMode:'NONE'
                };

                await request('/sessions',{method:'POST',json:payload});
                modalClose();reset();await refresh();notice('Đã tạo session thành công');
                return;
            }

            if(type==='AI'){
                required(name,'tên phiên');
                required(dueDate,'ngày hết hạn');
                if(dueDate.value<dueDate.min)throw new Error('Ngày hết hạn phải ở tương lai.');
                const sessionDue=dueDateToIso(dueDate.value);
                if(sessionDue.parsed<=new Date())throw new Error('Ngày hết hạn phải ở tương lai.');
                if(!docIds.length)throw new Error('Vui lòng chọn ít nhất một tài liệu PDF.');

                if(!aiLabelerSelect.value)throw new Error('Vui lòng chọn AI Labeler.');
                if(!aiReviewerSelect.value)throw new Error('Vui lòng chọn Result Analyst.');

                const aiId=Number(aiLabelerSelect.value);
                const revId=Number(aiReviewerSelect.value);

                if(aiId===revId)throw new Error('Không được chọn trùng người dùng giữa các vai trò.');

                const aiUser=currentAssignees.find(u=>u.id===aiId);
                const revUser=currentAssignees.find(u=>u.id===revId);

                const hasRole=(candidate,...roles)=>candidate&&roles.includes(String(candidate.role||'').toUpperCase());
                if(!hasRole(aiUser,'USER','AI_LABELER'))throw new Error('AI Labeler phải là tài khoản USER hoặc AI_LABELER.');
                if(!hasRole(revUser,'USER','RESULT_ANALYST'))throw new Error('Result Analyst phải là tài khoản USER hoặc RESULT_ANALYST.');

                const payload={
                    name:name.value.trim(),
                    description:description.value?description.value.trim():null,
                    sessionType:'AI',
                    dueAt:sessionDue.iso,
                    documents:docIds,
                    manualLabelerIds:[],
                    aiLabelerId:aiId,
                    reviewerId:revId,
                    assistanceMode:'AI_ASSISTED'
                };

                await request('/sessions',{method:'POST',json:payload});
                modalClose();reset();await refresh();notice('Đã tạo session thành công');
                return;
            }
        });
    }
    async function taskList() {
        const rows=(await request('/tasks')).filter(row=>user.role!=='REVIEWER'||String(row.task_type||row.type||'').toUpperCase()==='MANUAL');
        const taskIdOf=row=>row.task_id??row.id;
        const isLabeler=['MANUAL_LABELER','LABELER','AI_LABELER'].includes(user.role);
        const isReviewer=user.role==='REVIEWER';
        if(isReviewer){
            const conflictCounts=new Map();
            const cases=await request('/review-cases').catch(()=>[]);
            await Promise.all(cases.map(async reviewCase=>{
                let detail=reviewCase;
                if(!Array.isArray(detail.fields)&&detail.id)detail=await request(`/review-cases/${detail.id}`).catch(()=>reviewCase);
                const count=Array.isArray(detail.fields)?detail.fields.filter(field=>String(field.comparisonType||'').toUpperCase()!=='EXACT').length:Number(detail.conflict_count??detail.conflicts??0)||0;
                [detail.left_task_id,detail.right_task_id].filter(Boolean).forEach(taskId=>conflictCounts.set(String(taskId),count));
                conflictCounts.set(`case:${reviewCase.id}`,count);
            }));
            rows.forEach(row=>{if(row.conflict_count==null)row.conflict_count=conflictCounts.get(String(taskIdOf(row)))??0;});
            if(page==='ViewAll.html'){
                const tableTarget=$('#taskTable'),body=$('#taskRows');
                const caseByTask=new Map();cases.forEach(reviewCase=>[reviewCase.left_task_id,reviewCase.right_task_id].filter(Boolean).forEach(taskId=>caseByTask.set(String(taskId),reviewCase)));
                const statusLabel={PENDING:'Pending',IN_PROGRESS:'In progress',SUBMITTED:'Submitted',APPROVED:'Approved',COMPLETED:'Completed',REJECTED:'Rejected'};
                const statusClass={PENDING:'pending',IN_PROGRESS:'progress',SUBMITTED:'submitted',APPROVED:'approved',COMPLETED:'approved',REJECTED:'rejected'};
                const formatDate=value=>{if(!value)return '—';const parsed=new Date(value);if(Number.isNaN(parsed.getTime()))return '—';return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(parsed);};
                tableTarget?.classList.add('task-list-table');
                if(body){
                    body.replaceChildren();
                    const groups=new Map();
                    rows.forEach(task=>{
                        const key=`${task.document_id??task.document_title??'document'}::${task.session_id??task.session_name??'session'}`;
                        if(!groups.has(key))groups.set(key,[]);
                        groups.get(key).push(task);
                    });
                    [...groups.values()].forEach(group=>{
                        const ordered=[...group].sort((left,right)=>String(left.assignee||'').localeCompare(String(right.assignee||'')));
                        const reviewTask=ordered.find(task=>String(task.status||'').toUpperCase()==='SUBMITTED')||ordered.find(task=>String(task.status||'').toUpperCase()==='IN_PROGRESS')||ordered[0];
                        const taskId=taskIdOf(reviewTask),status=String(reviewTask.status||'PENDING').toUpperCase(),reviewCase=caseByTask.get(String(taskId));
                        const documentTitle=reviewTask.document_title||'Untitled document';
                        const targetId=reviewCase?.id??taskId;
                        const actionText=status==='SUBMITTED'?'Review':status==='APPROVED'?'View':status==='PENDING'?'Start':'Continue';
                        const conflict=reviewCase?conflictCounts.get(`case:${reviewCase.id}`)??0:Math.max(...group.map(task=>Number(task.conflict_count)||0));
                        const row=body.insertRow();
                        const doc=row.insertCell();const docLink=document.createElement('a');docLink.className='cell-primary';docLink.href=`Task.html?id=${encodeURIComponent(targetId)}`;docLink.textContent=documentTitle;docLink.title=documentTitle;doc.append(docLink);
                        row.insertCell().textContent=reviewTask.session_name||'—';
                        row.insertCell().textContent=ordered.map(task=>task.assignee||task.assignee_username).filter(Boolean).join(' / ')||'—';
                        row.insertCell().textContent='Manual';
                        const statusCell=row.insertCell();[...new Set(ordered.map(task=>String(task.status||'PENDING').toUpperCase()))].forEach(taskStatus=>{const badge=document.createElement('span');badge.className=`task-status task-status--${statusClass[taskStatus]||'pending'}`;badge.textContent=statusLabel[taskStatus]||taskStatus;statusCell.append(badge);});
                        row.insertCell().textContent=formatDate(ordered.map(task=>task.due_at).filter(Boolean).sort()[0]);
                        const conflictCell=row.insertCell();const conflictBadge=document.createElement('span');conflictBadge.className=`task-conflicts${conflict?' task-conflicts--active':''}`;conflictBadge.textContent=conflict?`${conflict} conflict${conflict===1?'':'s'}`:'None';conflictCell.append(conflictBadge);
                        const actionCell=row.insertCell();actionCell.className='task-action-cell';const actionLink=document.createElement('a');actionLink.className=`task-action task-action--${actionText.toLowerCase()}`;actionLink.href=docLink.href;actionLink.textContent=actionText;actionCell.append(actionLink);
                    });
                    if(!rows.length){const empty=body.insertRow().insertCell();empty.colSpan=8;empty.className='task-empty-state';empty.textContent='No review tasks assigned.';}
                }
                $('#taskPagination')?.parentElement?.setAttribute('hidden','');
                return;
            }
        }
        if(isLabeler && page==='ViewAll.html'){
            const tableTarget=$('#taskTable'), body=$('#taskRows'), search=$('#taskSearch'), sessionSelect=$('#taskSessionFilter'), statusSelect=$('#taskStatusFilter'), pagination=$('#taskPagination')?.parentElement;
            const statusLabels={PENDING:'Pending',IN_PROGRESS:'In progress',SUBMITTED:'Submitted',APPROVED:'Approved',REJECTED:'Returned'};
            const statusPriority={PENDING:0,IN_PROGRESS:1,REJECTED:2,SUBMITTED:3,APPROVED:4};
            const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
            const dateValue=value=>{const parsed=new Date(value||'');return Number.isNaN(parsed.getTime())?null:parsed;};
            const formatDate=value=>{const parsed=dateValue(value);if(!parsed)return 'No due date';return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(parsed);};
            const statusOf=row=>String(row.status||'PENDING').toUpperCase();
            const isOverdue=row=>{const due=dateValue(row.due_at);return Boolean(due&&due.getTime()<Date.now()&&statusOf(row)!=='APPROVED');};
            const sessionKey=row=>String(row.session_id??row.session_name??'unassigned');
            const sessionName=row=>row.session_name||'Unassigned session';
            const actionFor=status=>status==='PENDING'?['Start','task-action--start']:['Continue','task-action--continue'];
            const renderAction=(row)=>{const status=statusOf(row);if(status==='SUBMITTED'||status==='APPROVED')return ['View','task-action--view'];if(status==='PENDING')return ['Start','task-action--start'];return ['Continue','task-action--continue'];};
            const populateSessions=()=>{const current=sessionSelect?.value||'';if(!sessionSelect)return;const options=[...new Map(rows.map(row=>[sessionKey(row),sessionName(row)])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'en',{sensitivity:'base'}));sessionSelect.replaceChildren(new Option('All',''),...options.map(([value,label])=>new Option(label,value)));sessionSelect.value=options.some(([value])=>value===current)?current:'';};
            const setActive=(selector,attribute,value)=>$$(selector).forEach(button=>{button.classList.toggle('is-active',button.dataset[attribute]===value);});
            let statusFilter='',dueFilter='',sortMode='priority';
            populateSessions();
            const render=()=>{
                const query=(search?.value||'').trim().toLocaleLowerCase();
                const filtered=rows.filter(row=>{
                    const status=statusOf(row),dueMatch=!dueFilter||(dueFilter==='OVERDUE'?isOverdue(row):!isOverdue(row));
                    const sessionMatch=!sessionSelect?.value||sessionKey(row)===sessionSelect.value;
                    const text=[row.document_title,row.session_name,row.assignee,statusLabels[status]].filter(Boolean).join(' ').toLocaleLowerCase();
                    return (!statusFilter||status===statusFilter)&&dueMatch&&sessionMatch&&(!query||text.includes(query));
                });
                const groups=new Map();filtered.forEach(row=>{const key=sessionKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);});
                const groupItems=[...groups.entries()].map(([key,items])=>{const due=items.map(row=>dateValue(row.due_at)).filter(Boolean).sort((a,b)=>a-b)[0]||null;const completed=items.filter(row=>statusOf(row)==='APPROVED').length;const overdue=Boolean(due&&due.getTime()<Date.now()&&completed<items.length);const itemPriority=Math.min(...items.map(row=>statusPriority[statusOf(row)]??5));return {key,items,due,completed,overdue,itemPriority};});
                groupItems.sort((a,b)=>{if(sortMode==='due')return (a.due?.getTime()??Infinity)-(b.due?.getTime()??Infinity);if(sortMode==='status')return a.itemPriority-b.itemPriority;const overdueOrder=Number(b.overdue)-Number(a.overdue);return overdueOrder||a.itemPriority-b.itemPriority||(a.due?.getTime()??Infinity)-(b.due?.getTime()??Infinity);});
                body.replaceChildren();
                groupItems.forEach(group=>{
                    const header=body.insertRow();header.className='task-session-header';const cell=header.insertCell();cell.colSpan=5;const unfinished=group.items.filter(row=>statusOf(row)!=='APPROVED');const submitted=group.items.filter(row=>statusOf(row)==='SUBMITTED').length;const statusText=group.completed===group.items.length?'Completed':group.overdue?'Overdue':unfinished.length&&unfinished.every(row=>statusOf(row)==='SUBMITTED')?'Submitted':'In progress';const statusClass=statusText==='Completed'?'task-session-header__meta--complete':statusText==='Overdue'?'task-session-header__meta--overdue':'';const percent=group.items.length?Math.round((group.completed+submitted)/group.items.length*100):0;const progressText=`${group.completed} approved · ${submitted} submitted · ${group.items.length} total`;cell.innerHTML=`<div class="task-session-header__top"><span class="task-session-header__name">${escapeHtml(sessionName(group.items[0]))}</span><span class="task-session-header__meta ${statusClass}">Due ${escapeHtml(formatDate(group.due))} · ${statusText} · ${progressText}</span></div><div class="task-session-progress" aria-label="${escapeHtml(progressText)}"><span style="width:${percent}%"></span></div>`;
                    group.items.sort((a,b)=>{const priority=(statusPriority[statusOf(a)]??5)-(statusPriority[statusOf(b)]??5);if(priority)return priority;return (dateValue(b.updated_at||b.created_at)?.getTime()??0)-(dateValue(a.updated_at||a.created_at)?.getTime()??0);}).forEach(row=>{const tr=body.insertRow();tr.className='task-session-file';const status=statusOf(row),action=renderAction(row),taskId=taskIdOf(row),documentCell=tr.insertCell(),statusCell=tr.insertCell(),dueCell=tr.insertCell(),updatedCell=tr.insertCell(),actionCell=tr.insertCell();const link=document.createElement('a');link.className='cell-primary';link.href=`Task.html?id=${encodeURIComponent(taskId)}`;link.textContent=row.document_title||'Untitled document';link.title=link.textContent;documentCell.append(link);const badge=document.createElement('span');badge.className=`task-status task-status--${status==='SUBMITTED'?'awaiting-review':status==='REJECTED'?'returned':status.toLowerCase()}`;badge.textContent=statusLabels[status]||statusLabels.PENDING;statusCell.append(badge);const due=dateValue(row.due_at),overdue=Boolean(due&&due.getTime()<Date.now()&&status!=='APPROVED');dueCell.textContent=due?formatDate(row.due_at):'—';dueCell.className=`task-due${overdue?' task-due--overdue':''}`;if(overdue)dueCell.title='Overdue';const updated=row.updated_at||row.created_at||row.updatedAt;updatedCell.textContent=updated?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(updated)):'—';const actionLink=document.createElement('a');actionLink.className=`task-action ${action[1]}`;actionLink.href=link.href;actionLink.textContent=action[0];actionCell.className='task-action-cell';actionCell.append(actionLink);});
                });
                if(!groupItems.length){const row=body.insertRow(),cell=row.insertCell();cell.colSpan=5;cell.className='task-empty-state';cell.textContent=rows.length?'No tasks match the selected filters.':'You have no tasks assigned right now.';}
                if(pagination)pagination.hidden=true;
                const count=$('[data-task-count]');if(count)count.textContent=`${filtered.length} task${filtered.length===1?'':'s'} assigned to you`;
            };
            $$('[data-task-status]').forEach(button=>button.addEventListener('click',()=>{statusFilter=button.dataset.taskStatus||'';setActive('[data-task-status]','taskStatus',statusFilter);render();}));
            $$('[data-task-due]').forEach(button=>button.addEventListener('click',()=>{dueFilter=button.dataset.taskDue||'';setActive('[data-task-due]','taskDue',dueFilter);render();}));
            search?.addEventListener('input',render);sessionSelect?.addEventListener('change',render);statusSelect?.addEventListener('change',event=>{statusFilter=event.target.value;render();});$('#taskSortSelect')?.addEventListener('change',event=>{sortMode=event.target.value;render();});
            $('#clearTaskFilters')?.addEventListener('click',()=>{if(search)search.value='';if(sessionSelect)sessionSelect.value='';statusFilter='';dueFilter='';sortMode='priority';const sort=$('#taskSortSelect');if(sort)sort.value=sortMode;setActive('[data-task-status]','taskStatus','');setActive('[data-task-due]','taskDue','');render();});
            render();
            return;
        }
        const formatTaskDate=value=>{if(!value)return '—';const parsed=new Date(value);if(Number.isNaN(parsed.getTime()))return '—';const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const pad=number=>String(number).padStart(2,'0');return `${parsed.getDate()} ${months[parsed.getMonth()]} ${parsed.getFullYear()}, ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;};
        const tableTarget=$('#taskTable');
        tableTarget?.classList.add('task-list-table');
        const pageTargets=tableTarget?{
            table:tableTarget,
            body:$('#taskRows'),
            search:$('#taskSearch'),
            selects:[$('#taskSessionFilter'),$('#taskStatusFilter')],
            pagers:$('#taskPagination')?$$('button',$('#taskPagination')):[],
            paginationContainer:$('#taskPagination')?.parentElement,
        }:{};
        const documentCell=row=>{const link=document.createElement('a');link.href=`Task.html?id=${encodeURIComponent(taskIdOf(row))}`;link.textContent=row.document_title||'Untitled document';return link;};
        const columns=isLabeler?[['Document',documentCell],['Session','session_name'],['Status','status'],['Due',r=>formatTaskDate(r.due_at)],['Action','$actions']]:isReviewer?[['Document',documentCell],['Session','session_name'],['Annotator','assignee'],['Type','task_type'],['Status','status'],['Due',r=>formatTaskDate(r.due_at)],['Conflicts',r=>r.conflict_count??r.conflicts??0],['Action','$actions']]:[['Document',documentCell],['Session','session_name'],['Annotator','assignee'],['Type','task_type'],['Status','status'],['Due',r=>formatTaskDate(r.due_at)],['Action','$actions']];
        const list=listTable(rows,columns,row=>{
            const status=String(row.status||'PENDING').toUpperCase();const label=status==='PENDING'?'Start':status==='IN_PROGRESS'?'Continue':status==='SUBMITTED'?'Review':status==='APPROVED'?'View':'Open';const taskId=taskIdOf(row);return [action(label,()=>go(`Task.html?id=${encodeURIComponent(taskId)}`))];
        },['session_name','status'],{...pageTargets,table:tableTarget,numbered:false});
        const count=$('[data-task-count]');if(count)count.textContent=`${rows.length} task${rows.length===1?'':'s'} assigned to you`;
    }
    async function legacyResultAnalysisPage() {
        window.AAIRSharedHeader?.mount(user);
        const logoutButton=$('#raLogout');
        logoutButton?.addEventListener('click',()=>{
            if(window.confirm('Are you sure you want to log out?')) AAIR.logout();
        });
        setupDocumentSidebar({
            sidebar:$('#raDocuments'),
            workspace:$('.ra-layout'),
            storagePrefix:'aair.resultAnalysis.documentSidebar',
            defaultWidth:156,
            handleClass:'document-sidebar-handle--analysis'
        });
        const qs=new URLSearchParams(location.search);
        const requestedId=qs.get('id');
        // Keep all API-scoped Analyst tasks, including sessions named "test".
        const tasks=(await request('/tasks')).filter(task=>String(task.assignee||task.assigned_to||'').trim().toLowerCase()!=='yes');
        const taskSelect=$('#raTaskSelect');
        const durationEl=$('#raSessionDuration');
        let currentTimerSessionId=Symbol('initial');
        let sessionTimerInterval=null;
        const formatSessionDuration=totalSeconds=>{
            const s=Math.max(0,Math.floor(totalSeconds));
            const hours=Math.floor(s/3600);
            const minutes=Math.floor((s%3600)/60);
            const seconds=s%60;
            return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
        };
        window.AAIR=window.AAIR||{};window.AAIR.formatSessionDuration=formatSessionDuration;
        const updateSessionTimer=task=>{
            const sessionId=task?.session_id??null;
            const startedAt=task?.session_started_at??null;
            if(sessionId===currentTimerSessionId)return;
            currentTimerSessionId=sessionId;
            if(sessionTimerInterval){clearInterval(sessionTimerInterval);sessionTimerInterval=null;}
            if(!durationEl)return;
            if(!startedAt){durationEl.textContent='—:—:—';durationEl.title='Session has not started';return;}
            const startMs=new Date(startedAt).getTime();
            if(isNaN(startMs)){durationEl.textContent='—:—:—';return;}
            durationEl.title=`Bắt đầu: ${startedAt}`;
            const tick=()=>{
                const elapsedSec=Math.max(0,Math.floor((Date.now()-startMs)/1000));
                durationEl.textContent=formatSessionDuration(elapsedSec);
            };
            tick();
            sessionTimerInterval=window.setInterval(tick,1000);
        };
        const documents=$('#raDocumentList');
        const modelASelect=$('#raModelA');
        const modelBSelect=$('#raModelB');
        const resultsA=$('#raResultsA');
        const resultsB=$('#raResultsB');
        const note=$('#raNote');
        const noteCompare=$('#raNoteCompare');
        const correctionPrompt=$('#raCorrectionPrompt');
        const originalPrompt=$('#raOriginalPrompt');
        const correctionResult=$('#raCorrectionResult');
        const pdf=$('#raPdf');
        const pdfEmpty=$('#raPdfEmpty');
        const state={tasks,task:null,rows:[],models:[],modelA:'',modelB:'',analyzed:false,page:1,pdfUrl:null,noteRow:null,noteCompare:null,redoRunId:null,completionGuard:null};
        const fieldLabels={company_name:'Company Name',ticker:'Ticker',industry:'Industry',report_period:'Report Period',report_year:'Report Year',revenue:'Revenue'};
        const value=row=>row?.indicator_value??row?.label_value??row?.value??'No value';
        const fieldLabel=row=>fieldLabels[key(row)]||row?.indicator_name||row?.label_name||'Unnamed field';
        const key=row=>String(row?.indicator_name??row?.label_name??row?.term??'').trim().toLowerCase();
        const modelKey=row=>row?.run_id?`run::${row.run_id}`:`saved::${row?.provider||'AI'}::${row?.model||row?.provider||'Model'}`;
        const pct=row=>{const n=Number(row?.confidence);return Number.isFinite(n)?`${Math.round(n<=1?n*100:n)}%`:'—';};
        const name=task=>task?.document_title||task?.title||`Document #${task?.id||''}`;
        const pageCount=task=>{
            const total=task?.page_count??task?.pageCount??task?.total_pages??task?.document_page_count??task?.document?.page_count??task?.pages;
            return Array.isArray(total)?total.length:(total||'—');
        };
        const setMessage=message=>{const el=$('#raMessage');if(el)el.textContent=message||'';};
        const selectTask=(id)=>{
            const next=tasks.find(row=>String(row.id)===String(id))||tasks[0];
            if(!next)return;
            state.task=next;state.analyzed=false;state.page=1;
            taskSelect.value=String(next.id);
            $('#raSession').textContent=next.session_name||'AI Results';
            $('#raType').textContent=next.task_type||'AI';
            $('#raDocumentTitle').textContent=name(next);
            $('#raPageLabel').textContent=`Page 1 / ${pageCount(next)}`;
            updateSessionTimer(next);
            renderDocuments();
            loadTaskResults();
        };
        const renderDocuments=()=>{
            documents.replaceChildren();
            tasks.forEach(row=>{
                const button=document.createElement('button');
                button.type='button';button.className=state.task?.id===row.id?'active':'';button.dataset.taskId=String(row.id);
                button.title=name(row);
            const label=document.createElement('span');label.innerHTML=`${name(row)}<small>${row.session_name||'Unknown session'} · Task #${row.id}</small>`;button.dataset.status=row.status==='APPROVED'||row.status==='SUBMITTED'?'done':'pending';
            button.append(label);button.onclick=()=>selectTask(row.id);documents.append(button);
            });
        };
        const renderModels=()=>{
            const fill=select=>{select.replaceChildren(new Option('Select a result source',''),...state.models.map(model=>new Option(`${model.provider} · ${model.model}${model.runId?` · ${String(model.runId).slice(0,8)}`:''}`,model.key)));select.disabled=state.models.length<1;};
            fill(modelASelect);fill(modelBSelect);
            state.modelA=state.modelA||state.models[0]?.key||'';state.modelB=state.modelB||state.models[1]?.key||'';
            if(state.modelA===state.modelB&&state.models[1])state.modelB=state.models[1].key;
            modelASelect.value=state.modelA;modelBSelect.value=state.modelB;
        };
        const rowsFor=model=>state.rows.filter(row=>modelKey(row)===model);
        const rowFor=(rows,indicator)=>rows.find(row=>key(row)===indicator);
        const draw=(target,rows,other,side)=>{
            target.replaceChildren();
            if(!rows.length){
                const empty=document.createElement('div');empty.className='ra-empty-results';
                const icon=document.createElement('span');icon.className='material-symbols-outlined';icon.textContent='compare_arrows';
                const title=document.createElement('b');title.textContent='Select a result source to compare';
                const hint=document.createElement('span');hint.textContent='Choose a source from the dropdown above.';
                empty.append(icon,title,hint);target.append(empty);return;
            }
            rows.forEach(row=>{
                const compare=rowFor(other,key(row));
                const different=state.analyzed&&(!compare||String(value(row))!==String(value(compare)));
                const card=document.createElement('article');card.className=`ra-result${different?' different':''}`;
                const top=document.createElement('div');top.className='ra-result__top';
                const title=document.createElement('div');const label=document.createElement('span');label.className='ra-label';label.textContent='Indicator';
                const strong=document.createElement('strong');strong.textContent=fieldLabel(row);strong.title=row.indicator_name||row.label_name||'';title.append(label,strong);top.append(title);
                if(different){const badge=document.createElement('span');badge.className='ra-difference';badge.textContent='Different';top.append(badge);}
                const valueLabel=document.createElement('span');valueLabel.className='ra-label';valueLabel.textContent=`Value ${side}`;
                const parsed=splitLabelValue(value(row),row.source_label||row.source_text);const valueText=document.createElement('div');valueText.className='ra-value';const valueNode=document.createElement('div');valueNode.textContent=parsed.editableValue||'No value';valueText.append(valueNode);if(parsed.sourceLabel){const sourceText=document.createElement('small');sourceText.className='ra-source-text';sourceText.textContent=`Source: ${parsed.sourceLabel}`;valueText.append(sourceText);}
                const meta=document.createElement('div');meta.className='ra-meta';
                const confidence=document.createElement('span');confidence.textContent=`Confidence ${pct(row)}`;
                const source=document.createElement('button');source.className='ra-source';source.type='button';source.textContent=`Page ${row.source_page||'—'} · Go to page`;
                source.onclick=event=>{event.stopPropagation();openPage(row.source_page);};
                meta.append(confidence,source);card.append(top,valueLabel,valueText,meta);
                card.onclick=()=>openNote(row,compare);target.append(card);
            });
        };
        const renderResults=()=>{
            const a=rowsFor(state.modelA),b=rowsFor(state.modelB);
            const selectedA=state.models.find(model=>model.key===state.modelA),selectedB=state.models.find(model=>model.key===state.modelB);
            const metaA=$('#raModelAMeta'),metaB=$('#raModelBMeta');if(metaA)metaA.textContent=selectedA?`${selectedA.provider} · ${selectedA.model}`:'';if(metaB)metaB.textContent=selectedB?`${selectedB.provider} · ${selectedB.model}`:'';
            draw(resultsA,a,b,'A');draw(resultsB,b,a,'B');
            const all=[...new Set([...a,...b].map(key).filter(Boolean))];
            const differences=state.analyzed?all.filter(indicator=>{const left=rowFor(a,indicator),right=rowFor(b,indicator);return !left||!right||String(value(left))!==String(value(right));}):[];
            const differenceCount=$('#raDifferenceCount');if(differenceCount)differenceCount.textContent=String(differences.length);
            $('.ra-footer')?.classList.toggle('has-differences',differences.length>0);
        };
        const pdfViewerUrl=page=>`/resource/pdfjs/viewer.html?file=${encodeURIComponent(state.pdfUrl)}#page=${page}&zoom=page-width`;
        const openPage=page=>{
            const next=Number(page);if(!Number.isInteger(next)||next<1)return;
            if(!state.pdfUrl){setMessage('The PDF is still loading. Please try again.');return;}
            state.page=next;
            $('#raPageLabel').textContent=`Page ${next} / ${pageCount(state.task)}`;
            let moved=false;
            try{
                const viewer=pdf.contentWindow?.AAIRPdfViewer||pdf.contentWindow?.PDFViewerApplication?.pdfViewer;
                if(viewer){viewer.currentPageNumber=next;moved=true;}
            }catch{}
            if(!moved)pdf.src=pdfViewerUrl(next);
            pdf.scrollIntoView?.({block:'nearest',inline:'nearest'});
        };
        const loadPdf=async()=>{
            if(state.pdfUrl)URL.revokeObjectURL(state.pdfUrl);state.pdfUrl=null;
            pdf.removeAttribute('src');pdf.hidden=true;pdfEmpty.hidden=false;
            if(!state.task?.document_id)return;
            const blob=await request(`/documents/${state.task.document_id}/file`,{blob:true});
            state.pdfUrl=URL.createObjectURL(blob);pdf.src=pdfViewerUrl(state.page);pdf.hidden=false;pdfEmpty.hidden=true;
        };
        const loadTaskResults=async()=>{
            const taskId=state.task.id;
            const [detail,aiRows]=await Promise.all([
                request(`/tasks/${taskId}`),
                request(`/tasks/${taskId}/ai-results`,{suppressAuthRedirect:true}).catch(()=>[]),
            ]);
            if(state.task.id!==taskId)return;
            state.task=Object.assign(state.task,detail);
            // Analysis compares only persisted AI runs. Manual/task labels are saved
            // separately and must not appear as a selectable "Saved result" source.
            state.rows=Array.isArray(aiRows)?aiRows.filter(row=>row?.run_id):[];
            state.models=[...new Map(state.rows.map(row=>[modelKey(row),{key:modelKey(row),provider:row.provider||'AI',model:row.model||row.provider||'Model',runId:row.run_id||null}])).values()];
            state.modelA='';state.modelB='';renderModels();syncModelOptions();renderResults();setMessage('');
            try{await loadPdf();}catch(error){setMessage(error.message); }
            await state.completionGuard?.refresh();
        };
        const openNote=(row,compare)=>{
            state.noteRow=row;state.noteCompare=compare;state.redoRunId=null;note.hidden=false;
            noteCompare.replaceChildren();
            [[state.modelA,value(row)],[state.modelB,compare?value(compare):'Missing result']].forEach(([model,result])=>{const box=document.createElement('div');const provider=document.createElement('span');provider.textContent=model||'Model';const content=document.createElement('b');content.textContent=String(result);box.append(provider,content);noteCompare.append(box);});
            correctionPrompt.value=`Check indicator ${row.indicator_name||row.label_name||''} on page ${row.source_page||''}. Read the source label accurately, do not infer values, and return JSON with value, unit, source_page, source_label, and confidence.`;
            originalPrompt.value='Extract financial indicators from the report and always include value, unit, source_page, source_label, and confidence.';
            correctionResult.textContent='';
        };
        taskSelect.replaceChildren(...tasks.map(row=>new Option(`${name(row)} · Task #${row.id}`,String(row.id))));
        const initial=tasks.find(row=>String(row.id)===String(requestedId))||tasks[0];
        if(!initial){setMessage('No assigned task.');return;}
        taskSelect.onchange=()=>selectTask(taskSelect.value);
        const syncModelOptions=()=>{[...modelBSelect.options].forEach(option=>{option.disabled=option.value===state.modelA;});[...modelASelect.options].forEach(option=>{option.disabled=option.value===state.modelB;});const analyze=$('#raAnalyze');const blocked=!state.modelA||!state.modelB||state.modelA===state.modelB;analyze.disabled=blocked;analyze.title=blocked?'Select a task and two result sources.':'Analyze differences between the two sources';};
        modelASelect.onchange=()=>{state.modelA=modelASelect.value;if(state.modelA===state.modelB)state.modelB=[...modelBSelect.options].find(option=>!option.disabled&&option.value!==state.modelA)?.value||'';state.analyzed=false;syncModelOptions();renderResults();};
        modelBSelect.onchange=()=>{state.modelB=modelBSelect.value;if(state.modelA===state.modelB){setMessage('The two models must be different result sources.');state.analyzed=false;}syncModelOptions();renderResults();};
        $('#raAnalyze').onclick=()=>{state.analyzed=Boolean(state.modelA&&state.modelB&&state.modelA!==state.modelB);renderResults();setMessage(state.analyzed?'Differences between the two models have been analyzed.':'Select two different result sources.');};
        const saveNote=document.createElement('button');saveNote.type='button';saveNote.className='ra-secondary-button';saveNote.textContent='Save NOTE';correctionResult.after(saveNote);
        const confirmRedo=document.createElement('button');confirmRedo.type='button';confirmRedo.className='ra-secondary-button';confirmRedo.hidden=true;confirmRedo.textContent='Confirm redo result';saveNote.after(confirmRedo);
        saveNote.onclick=async()=>{if(!state.task||!state.noteRow)return;const noteText=correctionPrompt.value.trim();if(!noteText){setMessage('Enter a NOTE explaining the error.');return;}await request(`/analysis/tasks/${state.task.id}/fields/${encodeURIComponent(key(state.noteRow))}`,{method:'PUT',json:{note:noteText,redoRunId:null,redoConfirmed:false}});await state.completionGuard?.refresh();setMessage('NOTE saved for the field.');};
        confirmRedo.onclick=async()=>{if(!state.task||!state.noteRow||!state.redoRunId)return;await request(`/analysis/tasks/${state.task.id}/fields/${encodeURIComponent(key(state.noteRow))}`,{method:'PUT',json:{note:null,redoRunId:state.redoRunId,redoConfirmed:true}});confirmRedo.hidden=true;await state.completionGuard?.refresh();setMessage('Redo result confirmed.');};
        $('#raCloseNote').onclick=()=>{note.hidden=true;};
        $('#raRunCorrection').onclick=async()=>{
            if(!state.task||!correctionPrompt.value.trim())return;
            const button=$('#raRunCorrection');button.disabled=true;correctionResult.textContent='Running AI again…';
            try{const selected=state.models.find(model=>model.key===state.modelA);const provider=selected?.provider||'Gemini';const response=await request(`/tasks/${state.task.id}/run-ai`,{method:'POST',json:{provider,prompt:correctionPrompt.value}});state.redoRunId=response?.runId||null;confirmRedo.hidden=!state.redoRunId;correctionResult.textContent=`AI reran ${response?.labels?.length||0} indicators with ${response?.provider||provider}. Review and confirm the redo result.`;}catch(error){correctionResult.textContent=error.message;}finally{button.disabled=false;}
        };
        $('#raImprovePrompt').onclick=()=>{originalPrompt.value=`${originalPrompt.value.trim()} For each indicator, compare the source label in the same context; do not infer values; always return value, unit, source_page, source_label, and confidence.`;};
        window.addEventListener('pagehide',()=>{if(state.pdfUrl)URL.revokeObjectURL(state.pdfUrl);if(sessionTimerInterval)clearInterval(sessionTimerInterval);});
        state.completionGuard=AAIR.SessionCompletion?.create({button:$('#raCompleteAnalysis'),loadStatus:()=>request(`/session-completion${state.task?.session_id?`?sessionId=${state.task.session_id}`:''}`),findItem:item=>$(`[data-task-id="${item.id}"]`,documents),blockedTitle:'Resolve all differences in all documents before completing the analysis'});
        $('#raCompleteAnalysis').onclick=async()=>{if(state.completionGuard&&!await state.completionGuard.ensure('Analysis cannot be completed yet'))return;await request('/analysis/complete',{method:'POST',json:{sessionId:state.task?.session_id||null}});await state.completionGuard?.refresh();setMessage('The session analysis is complete.');};
        syncModelOptions();selectTask(initial.id);
    }
    async function taskPage() {
        if (user?.role === 'ADMIN') {
            await request('/tasks').catch(() => []);
            go('Dashboard.html');
            return;
        }
        if(document.body.matches('.ai-task-page,.manual-task-page')){
            setupDocumentSidebar();
            setupTaskWorkspace();
        }
        if(user?.role==='RESULT_ANALYST'&&document.body.classList.contains('result-analysis-page')){await legacyResultAnalysisPage();return;}
        // The old processing strip contained static demo values, not live API progress.
        $('#processingPanel')?.remove();
        const [tasks,prompts,systemPrompt]=await Promise.all([
            request('/tasks'),
            ['AI_LABELER','MANUAL_LABELER'].includes(user.role)
                ?request('/prompts/options',{suppressAuthRedirect:true}).catch(()=>[])
                :Promise.resolve([]),
            ['AI_LABELER','MANUAL_LABELER'].includes(user.role)
                ?request('/prompts/system-default',{suppressAuthRedirect:true}).catch(()=> '')
                :Promise.resolve(''),
        ]);
        const id=new URLSearchParams(location.search).get('id');
        const reviewerTasks=user.role==='REVIEWER'?tasks.filter(t=>String(t.task_type||t.type||'').toUpperCase()==='MANUAL'):tasks;
        const initial=id?reviewerTasks.find(t=>String(t.id)===id):reviewerTasks.find(t=>user.role==='REVIEWER'?t.status==='SUBMITTED':!['APPROVED','SUBMITTED'].includes(t.status))||reviewerTasks[0];
        const item=$('.document-item'), container=$('#documentList')||item?.parentElement, template=item?.cloneNode(true);
        const documentButtons=new Map();
        const selectAll=$('#selectAll'), selectedCounter=$('#selectedCounter'), selectedCount=$('#selectedCount');
        let selectionMode=false;
        const documentCheckboxes=()=>container?$$('.document-checkbox',container):[];
        const updateSelection=()=>{
            const checkboxes=documentCheckboxes(), count=checkboxes.filter(checkbox=>checkbox.checked).length;
            if(selectAll){selectAll.checked=checkboxes.length>0&&count===checkboxes.length;selectAll.indeterminate=count>0&&count<checkboxes.length;}
            selectedCounter?.classList.toggle('hidden',!selectionMode);
            if(selectedCount)selectedCount.textContent=`${count} document${count!==1?'s':''}`;
        };
        selectAll?.addEventListener('change',()=>{
            selectionMode=selectAll.checked;selectAll.indeterminate=false;
            documentCheckboxes().forEach(checkbox=>{checkbox.classList.toggle('hidden',!selectionMode);checkbox.checked=selectionMode;});
            updateSelection();
        });
        const dotStateKey=taskId=>`aair:document-dot-state:${taskId}`;
        const dotStateLabel={saved:'Saved','ai-pending':'AI run – not saved',none:'Not run yet'};
        const readDocumentSaveState=taskId=>{try{return localStorage.getItem(dotStateKey(taskId))||'none';}catch{return'none';}};
        const setDocumentSaveState=(taskId,state)=>{
            const next=state||'none';
            try{localStorage.setItem(dotStateKey(taskId),next);}catch{}
            const dot=documentButtons.get(Number(taskId))?.querySelector('.document-status-dot');
            if(dot){dot.dataset.saveState=next;dot.title=dotStateLabel[next]||dotStateLabel.none;}
        };
        const addDocumentStatusLegend=sidebar=>{
            if(!sidebar||sidebar.querySelector('.document-status-legend'))return;
            const legend=document.createElement('div');legend.className='document-status-legend';
            legend.innerHTML='<span class="document-status-legend__item document-status-legend__item--saved"><i></i>Saved</span><span class="document-status-legend__item document-status-legend__item--pending"><i></i>AI run, not saved</span><span class="document-status-legend__item document-status-legend__item--none"><i></i>Not run yet</span>';
            sidebar.append(legend);
        };
        if(container){
            addDocumentStatusLegend(container.closest('aside'));
            container.replaceChildren();
            for(const row of tasks){
                const entry=document.createElement('div');entry.className='flex w-full items-center gap-2 px-2';
                const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='document-checkbox hidden h-4 w-4 shrink-0 rounded border-outline-variant text-primary focus:ring-primary';
                checkbox.setAttribute('aria-label',`Select ${row.document_title||'document'}`);checkbox.addEventListener('change',updateSelection);
                const b=template.cloneNode(true);b.removeAttribute('data-pdf');b.removeAttribute('onclick');
                b.classList.add('flex-1','min-w-0');
                b.replaceChildren();
                const icon=document.createElement('span');icon.className='material-symbols-outlined text-[16px]';icon.textContent='picture_as_pdf';
                const label=document.createElement('span');label.className='truncate';label.textContent=row.document_title;
                const states={PENDING:'Pending',IN_PROGRESS:'Pending',SUBMITTED:'Completed',APPROVED:'Completed',REJECTED:'Error'};
                const statusLabel=states[row.status]||'Pending';
                const statusDot=document.createElement('span');statusDot.className='document-status-dot';const savedState=readDocumentSaveState(row.id);statusDot.dataset.saveState=savedState;statusDot.title=dotStateLabel[savedState]||dotStateLabel.none;b.dataset.status=row.status||'PENDING';
                b.append(icon,label,statusDot);b.title=row.document_title;b.setAttribute('aria-label',`Open document ${row.document_title} - ${statusLabel}`);
                bind(b,()=>loadTask(row));documentButtons.set(row.id,b);entry.append(checkbox,b);container.append(entry);
            }
        }
        updateSelection();
        const heading=$$('main h2,main h3').find(h=>['Extracted Information','Thông tin trích xuất'].includes(text(h)));
        let panel=$('[data-annotation-panel]')||heading?.closest('[data-annotation-panel]')||heading?.parentElement;
        const reviewBodies=$$('main .overflow-y-auto').filter(el=>$('input[type="checkbox"]',el));
        if(!panel)panel=reviewBodies[0];
        if(!panel)throw new Error('Không tìm thấy vùng nhãn của tác vụ.');
        const normalizedRole=String(user?.role||'').trim().toUpperCase().replace(/[\s-]+/g,'_');
        const isManualLabeler=normalizedRole==='MANUAL_LABELER';
        const labeler=['AI_LABELER','MANUAL_LABELER'].includes(normalizedRole);
        let readonly=!labeler;
        const cards=[];
        let pdfPageCount=null,queueAutoSave=()=>{},flushAutoSave=async()=>{};
        const clearCards=()=>{
            cards.length=0;
            if(heading){const keep=[...panel.children].filter(c=>c===heading||c.classList.contains('annotation-panel-save')||c.contains(heading)||$$('h2,h3',c).some(h=>['Document Information','Document Info','Thông tin tài liệu'].includes(text(h))));[...panel.children].filter(c=>!keep.includes(c)).forEach(c=>c.remove());}
            else panel.replaceChildren();
        };
        function addLabel(row={labelName:'',labelValue:'',sourceLabel:'',sourcePage:null,confidence:null}){
            const card=document.createElement('article');card.className='annotation-field-card annotation-field-card--legacy';
            const parts=splitLabelValue(row.labelValue,row.sourceLabel);
            const top=document.createElement('div');top.className='annotation-field-card__top';
            const friendlyLabels={company_name:'Tên công ty',industry:'Ngành nghề',report_period:'Kỳ báo cáo',report_year:'Năm báo cáo',revenue:'Doanh thu',total_assets:'Tổng tài sản',equity:'Vốn chủ sở hữu',cfo:'Dòng tiền từ HĐKD',cfi:'Dòng tiền từ HĐĐT',cff:'Dòng tiền từ HĐTC',net_cash_flow:'Dòng tiền thuần'};
            const key=String(row.labelName||'').trim().toLowerCase();
            const labelBlock=document.createElement('span');labelBlock.className='annotation-field-name';
            const friendly=document.createElement('strong');friendly.textContent=friendlyLabels[key]||row.labelName||'Field mới';
            const technical=document.createElement('small');technical.textContent=row.labelName||'field_key';labelBlock.append(friendly,technical);
            const termInput=document.createElement('input');termInput.type='text';termInput.value=row.labelName||'';termInput.maxLength=150;termInput.setAttribute('aria-label','Tên field');termInput.className='annotation-term-input';termInput.disabled=readonly;termInput.hidden=true;
            const stateBadge=document.createElement('span');stateBadge.className='annotation-status';
            const editButton=document.createElement('button');editButton.type='button';editButton.className='annotation-icon-button';editButton.title=readonly?'Bấm Mở khóa để chỉnh sửa':'Sửa field';editButton.disabled=readonly;editButton.innerHTML='<span class="material-symbols-outlined">edit</span>';
            const confirmButton=document.createElement('button');confirmButton.type='button';confirmButton.className='annotation-icon-button annotation-icon-button--confirm';confirmButton.title='Xác nhận (Enter)';confirmButton.innerHTML='<span class="material-symbols-outlined">check</span>';
            top.append(labelBlock,termInput,stateBadge,editButton,confirmButton);
            const valueInput=document.createElement('textarea');valueInput.value=parts.editableValue;valueInput.placeholder='Enter value...';valueInput.maxLength=20000;valueInput.rows=1;valueInput.setAttribute('aria-label','Field value');valueInput.className='annotation-definition-input';valueInput.disabled=readonly;
            const valueTools=document.createElement('div');valueTools.className='annotation-definition-tools';
            const expandButton=document.createElement('button');expandButton.type='button';expandButton.className='annotation-definition-expand';expandButton.innerHTML='<span class="material-symbols-outlined">open_in_full</span><span>Xem toàn bộ</span>';expandButton.title='Mở rộng vùng Definition';
            valueTools.append(expandButton);
            const chips=document.createElement('div');chips.className='annotation-definition-chips';chips.hidden=key!=='industry';
            const meta=document.createElement('div');meta.className='annotation-field-card__meta';
            const pageInput=document.createElement('input');pageInput.type='number';pageInput.min='1';pageInput.max=String(pdfPageCount||9999);pageInput.step='1';pageInput.required=true;pageInput.value=row.sourcePage==null?'':String(row.sourcePage);pageInput.setAttribute('aria-label','Source Page');pageInput.setAttribute('aria-readonly','true');pageInput.readOnly=true;pageInput.title='Click to jump to this PDF page';pageInput.className='annotation-page-input';pageInput.disabled=false;pageInput.hidden=true;
            const pageButton=document.createElement('button');pageButton.type='button';pageButton.className='annotation-page-chip';pageButton.title='Đến trang nguồn trong PDF';
            const confidence=document.createElement('span');confidence.className='annotation-confidence';const confidencePct=row.confidence==null?null:Math.round(row.confidence*100);confidence.textContent=`AI ${confidencePct==null?'—':`${confidencePct}%`}`;confidence.dataset.level=confidencePct==null?'unknown':confidencePct>=90?'high':confidencePct>=70?'medium':'low';
            const currentValue=parts.editableValue.trim();const suspicious=(key==='report_period'&&currentValue&&/^fy$/i.test(currentValue))||(key==='report_year'&&currentValue&&!/^\d{4}$/.test(currentValue))||(key==='revenue'&&currentValue&&!/[\d]/.test(currentValue));
            const warning=document.createElement('span');warning.className='annotation-warning';warning.hidden=!suspicious;warning.title='Giá trị cần kiểm tra lại với tài liệu nguồn.';warning.innerHTML='<span class="material-symbols-outlined">warning</span>';
            meta.append(pageButton,pageInput,confidence,warning);
            const sourceLabel=document.createElement('div');sourceLabel.className='annotation-source-label';sourceLabel.hidden=!parts.sourceLabel;sourceLabel.innerHTML='<strong>Source label</strong><span></span>';sourceLabel.querySelector('span').textContent=parts.sourceLabel||'';
            const hasSavedValue=Boolean(row.labelName||row.labelValue||row.sourcePage);
            const saveState=document.createElement('span');saveState.className='annotation-save-state';
            const cardState={termInput,valueInput,pageInput,sourceLabel:parts.sourceLabel,confidence:row.confidence,saveState,dirty:false,saved:hasSavedValue,confirmed:false};
            const paintState=()=>{const state=readonly?'Read-only':cardState.confirmed?'Approved':cardState.dirty?'Edited':hasSavedValue?'Pending review':'Empty';stateBadge.textContent=state;stateBadge.dataset.state=readonly?'readonly':cardState.confirmed?'confirmed':cardState.dirty?'edited':'pending';saveState.textContent=readonly?'Read-only':cardState.dirty?'Unsaved':cardState.saved?'Saved':'Empty';pageButton.textContent=pageInput.value?`Page ${pageInput.value}`:'No source page';pageButton.disabled=!pageInput.value;};
            const changed=()=>{if(readonly)return;cardState.dirty=true;cardState.confirmed=false;saveState.dataset.state='dirty';paintState();queueAutoSave(cardState);};
            const renderValueMeta=()=>{chips.replaceChildren(...valueInput.value.split(';').map(item=>item.trim()).filter(Boolean).slice(0,12).map(item=>{const chip=document.createElement('span');chip.textContent=item;return chip;}));};
            const autoGrow=()=>{valueInput.style.height='auto';const maxHeight=card.classList.contains('is-expanded')?Math.max(360,valueInput.scrollHeight):360;valueInput.style.height=`${Math.max(140,Math.min(valueInput.scrollHeight,maxHeight))}px`;valueInput.style.overflowY=valueInput.scrollHeight>maxHeight?'auto':'hidden';renderValueMeta();};
            expandButton.onclick=()=>{card.classList.toggle('is-expanded');const expanded=card.classList.contains('is-expanded');expandButton.querySelector('span:last-child').textContent=expanded?'Thu gọn':'Xem toàn bộ';expandButton.querySelector('.material-symbols-outlined').textContent=expanded?'close_fullscreen':'open_in_full';autoGrow();};
            const jumpToSource=()=>{const raw=Number(pageInput.value);if(!Number.isFinite(raw))return;const max=pdfPageCount||Number(pageInput.max)||9999;const page=Math.min(max,Math.max(1,Math.trunc(raw)));pageInput.value=String(page);const iframe=$('#pdfViewer');const viewer=iframe?.contentWindow?.PDFViewerApplication?.pdfViewer;if(viewer){viewer.currentPageNumber=page;return;}if(iframe?.src)iframe.src=iframe.src.replace(/#.*/,'')+`#page=${page}&zoom=page-width`;};
            const original={term:termInput.value,value:valueInput.value,page:pageInput.value};
            editButton.onclick=()=>{if(card.classList.contains('is-editing')){termInput.value=original.term;valueInput.value=original.value;pageInput.value=original.page;valueInput.readOnly=true;pageInput.readOnly=true;cardState.dirty=false;card.classList.remove('is-editing');labelBlock.hidden=false;termInput.hidden=true;pageInput.hidden=true;paintState();return;}card.classList.add('is-editing');labelBlock.hidden=true;termInput.hidden=false;termInput.disabled=readonly;valueInput.readOnly=false;pageInput.readOnly=true;pageInput.hidden=false;termInput.focus();};
            confirmButton.onclick=()=>{cardState.confirmed=true;changed();paintState();};
            const definitionLabel=document.createElement('label');definitionLabel.className='annotation-legacy-label';definitionLabel.textContent='Definition';
            pageButton.onclick=jumpToSource;pageInput.addEventListener('click',jumpToSource);pageInput.addEventListener('change',()=>{jumpToSource();changed();});pageInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jumpToSource();changed();}});
            termInput.addEventListener('input',changed);valueInput.addEventListener('input',()=>{autoGrow();changed();});
            valueInput.addEventListener('keydown',event=>{if(event.key==='Escape'&&card.classList.contains('is-editing')){editButton.click();return;}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();confirmButton.click();}if(event.key==='Tab'&&!event.shiftKey){const index=cards.indexOf(cardState);const next=cards[index+1];if(next){event.preventDefault();next.valueInput.focus();}}});
            card.append(top,definitionLabel,valueInput,meta,sourceLabel);paintState();cards.push(cardState);panel.append(card);autoGrow();return valueInput;
        }
        const editor={
            get value(){return JSON.stringify(cards.map(c=>{const label={labelName:c.termInput.value.trim(),labelValue:c.valueInput.value,sourcePage:c.pageInput.value?Number(c.pageInput.value):null,confidence:c.confidence};if(c.sourceLabel)label.sourceLabel=c.sourceLabel;return label;}).filter(c=>c.labelName||c.labelValue));},
            set value(value){clearCards();const rows=JSON.parse(value);rows.forEach(addLabel);if(!rows.length&&labeler)addLabel();const saveDock=panel.querySelector('.annotation-panel-save');if(saveDock)panel.append(saveDock);},
            get readOnly(){return readonly;},
            set readOnly(value){readonly=value;cards.forEach(c=>{c.termInput.disabled=readonly;c.valueInput.readOnly=readonly;c.pageInput.disabled=false;c.pageInput.readOnly=true;c.saveState.textContent=readonly?'Read-only':c.dirty?'Unsaved':c.saved?'Saved':'Empty';});},
            focus(){cards[0]?.valueInput.focus();},
        };
        editor.value='[]';
        reviewBodies.slice(1).forEach(body=>body.replaceChildren());
        // Other extraction/status panels contain mock results and are unavailable until an inference API exists.
        $$('main h2,main h3').filter(h=>['Extraction Status','Processing Details'].includes(text(h))).forEach(h=>{
            const section=h.parentElement;[...section.children].filter(c=>c!==h).forEach(c=>c.remove());const p=document.createElement('p');p.textContent='No AI processing data yet.';section.append(p);
        });
        $$('main h3').filter(h=>['Document Information','Document Info','Thông tin tài liệu'].includes(text(h))).forEach(h=>{while(h.nextSibling)h.nextSibling.remove();});
        // Result comparison has two extraction panels; no synthetic second result.
        $$('main h2,main h3').filter(h=>text(h)==='Extracted Information'&&h!==heading).forEach(h=>{
            while(h.nextSibling)h.nextSibling.remove();const p=document.createElement('p');p.textContent='Task results are displayed in the annotation area.';h.parentElement.append(p);
        });
        const modelSelect=$('header select');
        const aiHeader=$$('main h2').find(h=>text(h)==='AI Extraction')?.parentElement;
        const aiContent=aiHeader?.parentElement?.querySelector('.overflow-y-auto');
        const promptSelect=$('#aiPromptSelect');
        if(modelSelect && ['AI_LABELER','MANUAL_LABELER'].includes(user.role)){
            const models=user.role==='MANUAL_LABELER'?['Gemini']:['Gemini','Claude','ChatGPT','Groq'];
            options(modelSelect,models.map(model=>[model,model]));
            modelSelect.insertBefore(new Option('Choose Model',''),modelSelect.firstChild);modelSelect.value=user.role==='MANUAL_LABELER'?'Gemini':'';modelSelect.disabled=false;
            const updatePrompts=()=>{
                if(!promptSelect)return;
                const rows=prompts.filter(row=>row.is_active!==false && ['Gemini','Claude','ChatGPT','Groq'].includes(String(row.model||'')));
                promptSelect.replaceChildren(new Option('System default prompt','__default__'),...rows.map(row=>new Option(`${row.name} · ${row.model||'Any model'}`,String(row.id))));
                if(!rows.some(row=>String(row.id)===promptSelect.value))promptSelect.value='__default__';
            };
            updatePrompts();
            promptSelect?.addEventListener('change',()=>{
                const row=prompts.find(item=>String(item.id)===promptSelect.value);
                if(!row?.model)return;
                const model=String(row.model);
                if([...modelSelect.options].some(option=>option.value===model))modelSelect.value=model;
                updatePrompts();
                promptSelect.value=String(row.id);
                    const runButton=buttons(/Run AI|Chạy AI/)[0];
                if(runButton){
                    runButton.disabled=false;
                    runButton.style.opacity='';
                    runButton.title='';
                }
            });
            modelSelect.addEventListener('change',()=>{updatePrompts();if(modelSelect.value)notice(`Đã chọn model ${modelSelect.value}.`);});
        }else if(modelSelect){options(modelSelect,[],true);modelSelect.disabled=true;}
        if(!initial){
            buttons(/Save|Submit|Nộp bài|Approve|Analyze/).forEach(b=>unavailable(b,'No task assigned.'));
            notice(id?'Task not found or access denied.':'No task assigned.',Boolean(id));return;
        }
        let task, fileUrl, workTimer, completionGuard, loadSequence=0;
        const title=$('#sessionTitle');
        const type=null;
        const docHeading=$$('main h3').find(h=>['Document Information','Document Info','Thông tin tài liệu'].includes(text(h)));
        let docInfo;
        if(docHeading){while(docHeading.nextSibling)docHeading.nextSibling.remove();docInfo=document.createElement('p');docHeading.after(docInfo);docHeading.textContent='Document Info';}
        if(heading)heading.textContent='Extracted Information';
        const renderTask=()=>{
            editor.value=JSON.stringify(task.labels.map(l=>({labelName:l.label_name,labelValue:l.label_value,sourcePage:l.source_page,sourceLabel:l.source_label||l.sourceLabel||'',confidence:l.confidence})),null,2);
            // Manual labelers must be able to correct extracted values in their
            // assigned fields. Other roles keep the submitted/approved lock.
            editor.readOnly=!labeler||(!isManualLabeler&&['SUBMITTED','APPROVED'].includes(task.status));
            document.title=`${task.document_title} — ${task.status}`;
        };
        const refresh=async()=>{task=await request(`/tasks/${task.id}`);renderTask();};
        async function loadTask(row){
            const sequence=++loadSequence;
            if(task&&task.id!==row.id)await flushAutoSave();
            if(workTimer)await workTimer.stop('MANUAL');
            const loadedTask=await request(`/tasks/${row.id}`);
            if(sequence!==loadSequence)return;
            task=loadedTask;
            if(labeler&&!task.labels?.length){
                const aiRows=await request(`/tasks/${row.id}/ai-results`,{suppressAuthRedirect:true}).catch(()=>[]);
                if(Array.isArray(aiRows)&&aiRows.length){
                    const latestRun=aiRows[0].run_id;
                    task.labels=aiRows.filter(item=>item.run_id===latestRun).reverse().map(item=>({label_name:item.indicator_name,label_value:item.indicator_value,source_page:item.source_page,source_label:item.source_label||item.sourceLabel||'',confidence:item.confidence}));
                }
            }
            pdfPageCount=null;
            const persistedDotState=readDocumentSaveState(task.id);
            setDocumentSaveState(task.id,persistedDotState!=='none'?persistedDotState:(task.labels?.length?'saved':'none'));
            try { history.replaceState(null,'',`?id=${row.id}`); } catch { /* Embedded preview or fixture URL. */ }
            if(title)title.textContent=row.session_name||task.document_title;
            if(type)type.textContent=task.task_type;
            if(docInfo)docInfo.textContent=task.document_title;
            renderTask();
            documentButtons.forEach((button,taskId)=>{
                const selected=taskId===row.id;
                button.classList.toggle('bg-surface-container',selected);button.classList.toggle('text-primary',selected);
                button.setAttribute('aria-current',selected?'true':'false');
            });
            const iframe=$('#pdfViewer');
            if(iframe){iframe.removeAttribute('src');iframe.srcdoc='<p style="font-family:sans-serif;padding:24px">Đang tải tài liệu PDF…</p>';}
            try {
                const blob=await request(`/documents/${task.document_id}/file`,{blob:true});
                if(sequence!==loadSequence)return;
                if(fileUrl)URL.revokeObjectURL(fileUrl);
                fileUrl=URL.createObjectURL(blob);
                if(iframe){
                    const viewerUrl=`/resource/pdfjs/viewer.html?file=${encodeURIComponent(fileUrl)}&title=${encodeURIComponent(task.document_title)}#page=1&zoom=page-width`;
                    const openedTaskId=task.id;
                    iframe.onload=()=>{
                        if(sequence!==loadSequence||task.id!==openedTaskId)return;
                        const addPdfControls=()=>{
                            const documentInFrame=iframe.contentDocument;
                            const toolbar=documentInFrame?.querySelector('#toolbarViewerRight');
                            if(!toolbar||documentInFrame.querySelector('[data-aair-pdf-control]'))return;
                            [['fit-width','fit_width','Vừa chiều rộng'],['fit-page','fit_screen','Vừa toàn trang'],['rotate','rotate_right','Xoay trang']].forEach(([action,icon,title])=>{
                                const button=documentInFrame.createElement('button');button.type='button';button.dataset.aairPdfControl=action;button.title=title;button.className='toolbarButton';const iconNode=documentInFrame.createElement('span');iconNode.className='material-symbols-outlined';iconNode.textContent=icon;button.append(iconNode);
                                button.onclick=()=>{const viewer=iframe.contentWindow?.PDFViewerApplication?.pdfViewer;if(!viewer)return;if(action==='fit-width')viewer.currentScaleValue='page-width';if(action==='fit-page')viewer.currentScaleValue='page-fit';if(action==='rotate')viewer.pagesRotation=(viewer.pagesRotation+90)%360;};toolbar.append(button);
                            });
                        };
                        let attempts=0;
                        const syncPageCount=()=>{
                            if(task.id!==openedTaskId)return;
                            const viewer=iframe.contentWindow?.PDFViewerApplication?.pdfViewer;
                            if(viewer) viewer.currentScaleValue='page-width';
                            const count=Number(iframe.contentWindow?.PDFViewerApplication?.pdfDocument?.numPages||0);
                            if(count>0){pdfPageCount=count;cards.forEach(card=>{card.pageInput.max=String(count);card.pageInput.title=`Trang hợp lệ: 1-${count}`;});addPdfControls();return;}
                            if(++attempts<30)setTimeout(syncPageCount,200);
                        };
                        syncPageCount();
                    };
                    iframe.removeAttribute('srcdoc');iframe.src=viewerUrl;iframe.title=task.document_title;
                }
                if(labeler && !['SUBMITTED','APPROVED'].includes(task.status) && AAIR.createWorkTimer) workTimer=AAIR.createWorkTimer({taskId:task.id});
                notice(`Đã mở tài liệu ${task.document_title}.`);
                if(completionGuard)await completionGuard.refresh();
            } catch(error) {
                if(iframe)iframe.srcdoc=`<p style="font-family:sans-serif;padding:24px;color:#b91c1c">Không tải được tài liệu PDF.</p>`;
                throw error;
            }
        }
        await loadTask(initial);
        const submitTaskButton=buttons(/^(Submit Task|Nộp bài)$/)[0]; if(submitTaskButton)submitTaskButton.setAttribute('aria-label','Submit Task');
        if(window.AAIR.SessionCompletion&&submitTaskButton){
            completionGuard=AAIR.SessionCompletion.create({
                button:submitTaskButton,
                loadStatus:()=>request(`/session-completion${task?.session_id?`?sessionId=${task.session_id}`:''}`),
                findItem:documentStatus=>documentButtons.get(Number(documentStatus.id)),
                blockedTitle:status=>{const documents=Array.isArray(status.documents)?status.documents:[],total=documents.length||tasks.filter(item=>String(item.session_id)===String(task?.session_id)).length,done=documents.filter(item=>item.status==='done'||['SUBMITTED','APPROVED','COMPLETED'].includes(String(item.status||'').toUpperCase())).length;return total?`Cần lưu cả ${total} tài liệu (đã lưu ${done}/${total})`:`Còn ${(status.missingItems||[]).length} tài liệu chưa hoàn tất`;},
                onStatus:status=>{
                    const reported=Array.isArray(status.documents)?status.documents:[];
                    const fallbackTasks=tasks.filter(item=>String(item.session_id)===String(task?.session_id));
                    const sessionTasks=reported.length?reported:fallbackTasks;
                    const total=sessionTasks.length,done=sessionTasks.filter(item=>item.status==='done'||['SUBMITTED','APPROVED','COMPLETED'].includes(item.status)).length;
                    const percent=total?Math.round(done/total*100):0;
                    const progress=$('#sessionProgressTrack'),bar=$('#sessionProgressBar'),label=$('#sessionProgressText');
                    if(progress)progress.setAttribute('aria-valuenow',String(percent));
                    if(bar)bar.style.width=`${percent}%`;
                    if(label)label.textContent=`${done}/${total} documents · ${percent}%`;
                    const submitButton=buttons(/^(Submit Task|Nộp bài)$/)[0];
                    if(submitButton){submitButton.classList.toggle('session-ready',percent===100);submitButton.title=percent===100?'All documents are saved. You can submit this session.':'Save all documents before submitting.';}
                }
            });
            await completionGuard.refresh();
        }
        window.addEventListener('pagehide',()=>{if(fileUrl)URL.revokeObjectURL(fileUrl);});
        const runAiButton=buttons(/Run AI|Chạy AI/)[0];
        if(runAiButton && ['AI_LABELER','MANUAL_LABELER'].includes(user.role)){ runAiButton.setAttribute('aria-label','Run AI');
            // Manual labelers can explicitly run the background Gemini extraction.
            // Keep the model fixed so this action does not depend on assistance_mode
            // or expose a model choice that is not supported by the manual workflow.
            if(normalizedRole==='MANUAL_LABELER' && modelSelect)modelSelect.value='Gemini';
            const updateRunAiState=()=>{
                const blocked=['SUBMITTED','APPROVED'].includes(String(task?.status||'').toUpperCase());
                runAiButton.disabled=blocked||!modelSelect?.value;
                runAiButton.style.opacity=runAiButton.disabled?'0.5':'';
                runAiButton.title=blocked?'This task is read-only.':runAiButton.disabled?'Select a model before running AI.':'';
            };
            modelSelect?.addEventListener('change',updateRunAiState);updateRunAiState();
            bind(runAiButton,async()=>{
                if(!modelSelect?.value)throw new Error('Select a model before running AI.');
                if(cards.some(card=>card.dirty)&&!window.confirm('Run AI sẽ thay thế dữ liệu chưa lưu. Bạn có muốn tiếp tục không?'))return;
                const oldMarkup=runAiButton.innerHTML;
                runAiButton.disabled=true;runAiButton.classList.add('is-running');runAiButton.innerHTML='<span class="task-button-label">Running AI…</span>';
                try{
                    const selectedPrompt=prompts.find(item=>String(item.id)===promptSelect?.value);
                    const prompt=selectedPrompt?.content||systemPrompt;
                    const provider=normalizedRole==='MANUAL_LABELER'?'Gemini':modelSelect.value;
                    const result=await request(`/tasks/${task.id}/run-ai`,{method:'POST',json:{provider,prompt:prompt||null}});
                    editor.value=JSON.stringify(result.labels||[]);editor.readOnly=false;
                    setDocumentSaveState(task.id,'ai-pending');
                    cards.forEach(card=>{card.dirty=true;card.saveState.dataset.state='dirty';card.saveState.textContent='Unsaved';});
                    if(toolbarSaveButton){toolbarSaveButton.disabled=false;toolbarSaveButton.classList.add('is-dirty');}
                    queueAutoSave();
                    notice(`Extracted ${result.labels?.length||0} fields using ${result.provider}. Review them and click Save.`);
                }finally{runAiButton.innerHTML=oldMarkup;runAiButton.disabled=false;runAiButton.classList.remove('is-running');updateRunAiState();}
            });
        }else if(runAiButton)unavailable(runAiButton,'Chỉ AI Labeler được chạy mô hình AI.');
        function labels(){
            let data;try{data=JSON.parse(editor.value);}catch{throw new Error('Nhãn phải là JSON hợp lệ.');}
            if(!Array.isArray(data)||data.length>500||data.some(l=>!l||typeof l.labelName!=='string'||!l.labelName.trim()||l.labelName.length>150||!(l.labelValue==null||typeof l.labelValue==='string')||(l.labelValue?.length||0)>20000||!Number.isInteger(l.sourcePage)||l.sourcePage<1||(pdfPageCount&&l.sourcePage>pdfPageCount)||!(l.confidence==null||typeof l.confidence==='number'&&l.confidence>=0&&l.confidence<=1)))throw new Error(`Mỗi chỉ tiêu cần tên, giá trị, trang nguồn từ 1${pdfPageCount?`-${pdfPageCount}`:''} và confidence từ 0 đến 1 (hoặc null); tối đa 500 chỉ tiêu.`);
            return data;
        }
        let manualSaveButton=null;
        const toolbarSaveButton=$('#taskSaveButton');
        const setButtonLabel=(button,label)=>{const target=button?.querySelector('.task-button-label');if(target)target.textContent=label;else if(button)button.textContent=label;};
        const save=async(showNotice=true,track=true,refreshAfter=true)=>{
            const data=labels();
            if(['PENDING','REJECTED'].includes(task.status)){await request(`/tasks/${task.id}/start`,{method:'POST'});task.status='IN_PROGRESS';}
            await request(`/tasks/${task.id}/labels`,{method:'PUT',json:{labels:data}});if(refreshAfter)await refresh();
            if(completionGuard)await completionGuard.refresh();
            if(track&&workTimer)await workTimer.stop('SAVE',true);
            if(showNotice)notice('Data saved successfully.');
        };
        if(labeler && panel && !aiContent){
            manualSaveButton=toolbarSaveButton||document.createElement('button');
            if(!toolbarSaveButton){const saveWrap=document.createElement('div');saveWrap.className='annotation-panel-save';manualSaveButton.type='button';manualSaveButton.textContent='Save';manualSaveButton.className='annotation-save-button';manualSaveButton.setAttribute('aria-label','Save');saveWrap.append(manualSaveButton);panel.append(saveWrap);}
            manualSaveButton.onclick=async()=>{if(manualSaveButton.disabled)return;manualSaveButton.disabled=true;manualSaveButton.classList.remove('is-dirty');setButtonLabel(manualSaveButton,'Saving…');try{await save();setDocumentSaveState(task.id,'saved');cards.forEach(card=>{card.dirty=false;card.saved=true;card.saveState.dataset.state='saved';card.saveState.textContent='Saved';});}catch(error){manualSaveButton.disabled=false;manualSaveButton.classList.add('is-dirty');setButtonLabel(manualSaveButton,'Save');throw error;}setButtonLabel(manualSaveButton,'Save');};
        }
        let autoSaveTimer=null,autoSavePromise=Promise.resolve();
        const setSaveState=(state,message)=>cards.filter(card=>card.dirty).forEach(card=>{card.saveState.dataset.state=state;card.saveState.textContent=message;});
        const performAutoSave=async()=>{
            if(readonly||!cards.some(card=>card.dirty))return false;
            setSaveState('saving','Saving…');
            try{
                await save(false,false,false);
                setDocumentSaveState(task.id,'saved');
                cards.forEach(card=>{if(card.dirty){card.dirty=false;card.saved=true;card.saveState.dataset.state='saved';card.saveState.textContent='Saved';}});
                return true;
            }catch(error){setSaveState('error','Save failed');notice(error.message,true);throw error;}
        };
        flushAutoSave=async()=>{
            if(autoSaveTimer){clearTimeout(autoSaveTimer);autoSaveTimer=null;}
            autoSavePromise=autoSavePromise.then(performAutoSave,performAutoSave);return autoSavePromise;
        };
        queueAutoSave=()=>{
            if(autoSaveTimer)clearTimeout(autoSaveTimer);
            if(manualSaveButton){manualSaveButton.disabled=false;manualSaveButton.classList.add('is-dirty');return;}
            if(aiContent){if(toolbarSaveButton){toolbarSaveButton.disabled=false;toolbarSaveButton.classList.add('is-dirty');}return;}
            autoSaveTimer=setTimeout(()=>{autoSaveTimer=null;autoSavePromise=autoSavePromise.then(performAutoSave,performAutoSave);},1000);
        };
        bindText(/^(Submit Task|Nộp bài)$/,async()=>{if(!labels().length)throw new Error('Add at least one field before submitting.');await flushAutoSave();if(['PENDING','REJECTED'].includes(task.status))await save(false,false,false);if(completionGuard&&!await completionGuard.ensure('Unable to submit the task'))return;await request(`/tasks/${task.id}/submit`,{method:'POST'});if(workTimer)await workTimer.stop('SUBMIT');await refresh();if(completionGuard)await completionGuard.refresh();notice('Task submitted successfully.');});
        if(labeler){
            const saveDock=panel.querySelector('.annotation-panel-save');
            if(saveDock) panel.append(saveDock);
        }
        if(aiContent){
            const topHeader=$$('header')[1];
            buttons(/^Edit$/,topHeader).forEach(button=>button.remove());
            const saveButton=toolbarSaveButton||document.createElement('button');
            if(!toolbarSaveButton){const saveWrap=document.createElement('div');saveWrap.className='annotation-panel-save';saveButton.type='button';saveButton.className='annotation-save-button ai-save-results';saveButton.textContent='Save';saveButton.setAttribute('aria-label','Save');saveWrap.append(saveButton);aiContent.append(saveWrap);}
            bind(saveButton,async()=>{saveButton.disabled=true;saveButton.classList.remove('is-dirty');setButtonLabel(saveButton,'Saving…');try{await save();setDocumentSaveState(task.id,'saved');if(user.role==='MANUAL_LABELER')exportJson(labels(),`task-${task.id}-labels.json`);}finally{setButtonLabel(saveButton,'Save');saveButton.disabled=false;}});
        }
        if(reviewBodies.length){
            const firstHeader=reviewBodies[0].previousElementSibling;if(firstHeader)firstHeader.textContent=`${initial.assignee||'Annotator'} — ${task.task_type}`;
            const history=reviewBodies[1];
            if(history){const header=history.previousElementSibling;if(header)header.textContent='Review History';
                const renderReviews=()=>{history.replaceChildren();for(const review of task.reviews){const p=document.createElement('p');p.className='p-4 border-b text-sm';p.textContent=`${review.reviewer} — ${review.decision}: ${review.feedback||''}`;history.append(p);}};
                renderReviews();
            }
        }
        bindText(/Approve Review/,async()=>{
            const answer=prompt('Nhập APPROVED để duyệt hoặc REJECTED để yêu cầu sửa:','APPROVED');if(answer===null)return;
            const decision=answer.trim().toUpperCase();if(!['APPROVED','REJECTED'].includes(decision))throw new Error('Quyết định phải là APPROVED hoặc REJECTED.');
            const feedback=prompt(decision==='REJECTED'?'Lý do yêu cầu sửa (bắt buộc):':'Nhận xét (không bắt buộc):','');if(feedback===null)return;
            await request(`/tasks/${task.id}/review`,{method:'POST',json:{decision,feedback}});await refresh();notice(`Đã lưu kết quả: ${decision}.`);
        });
        bindText(/^Analyze$/,()=>{exportJson({taskId:task.id,status:task.status,labels:task.labels,reviews:task.reviews},`task-${task.id}-analysis.json`);notice(`Đã xuất ${task.labels.length} nhãn và ${task.reviews.length} quyết định kiểm duyệt.`);});
        notice(`${task.document_title} — ${task.status}`);
    }
    async function logsPage() {
        let pageIndex=0,rows=await request('/audit-logs');
        const search=$('input[placeholder^="Search"]'),filters=$$('header select');
        const show=row=>{
            const drawer=$('#detail-drawer');
            const content=$('.overflow-y-auto',drawer);
            if(content){const pre=document.createElement('pre');pre.className='p-4 text-sm whitespace-pre-wrap';pre.textContent=JSON.stringify(row,null,2);content.replaceChildren(pre);}
            window.openDrawer();
        };
        const columns=[['Timestamp',r=>date(r.created_at)],['User','username'],['Resource','resource_type'],['Resource ID','resource_id'],['Action','action'],['Details','$actions']];
        const next=buttons(/^chevron_right$/)[0],previous=buttons(/^chevron_left$/)[0];
        buttons(/^[1-6]$/).forEach(b=>b.hidden=true);
        const render=()=>{
            const query=search.value.toLowerCase().trim();
            const filtered=rows.filter(r=>Object.values(r).join(' ').toLowerCase().includes(query)&&filters.every((s,i)=>!s.value||r[i===0?'resource_type':'action']===s.value));
            table($('table'),columns,filtered,r=>[action('View',()=>show(r))]);
            previous.disabled=pageIndex===0;next.disabled=rows.length<100;
            $$('p,span').filter(p=>p.children.length===0&&/^Showing/.test(text(p))).forEach(p=>p.textContent=`Trang ${pageIndex+1}: ${filtered.length} bản ghi`);
        };
        const configureFilters=()=>filters.forEach((s,i)=>options(s,[...new Set(rows.map(r=>r[i===0?'resource_type':'action']))].sort(),true));
        configureFilters();search.addEventListener('input',render);filters.forEach(s=>s.addEventListener('change',render));
        bind(next,async()=>{const batch=await request(`/audit-logs?page=${pageIndex+1}`);pageIndex++;rows=batch;configureFilters();render();});
        bind(previous,async()=>{const batch=await request(`/audit-logs?page=${pageIndex-1}`);pageIndex--;rows=batch;configureFilters();render();});render();
        buttons(/Block IP|Related Activities/).forEach(b=>unavailable(b));
    }
    async function permissionsPage() {
        if (window.AAIRPermissionsPage) return window.AAIRPermissionsPage({request,notice,user});
        const [roles,users]=await Promise.all([request('/roles'),request('/users')]);
        const roleNames={ADMIN:'Administrator',MANAGER:'Manager'};
        const roleFeatures={
            ADMIN:new Set(['DASHBOARD','USER_MANAGEMENT','PERMISSION_MANAGEMENT','AUDIT_LOGS']),
            MANAGER:new Set(['DASHBOARD','USER_MANAGEMENT','PERMISSION_MANAGEMENT','DOCUMENTS','SESSIONS','TASKS','STATISTICS'])
        };
        const roleCards=new Map();
        $$('main h4').filter(h=>['Administrator','Manager','User'].includes(text(h))).forEach(h=>{
            const card=h.closest('.group'); if (!card) return;
            const name=text(h);
            const role=name==='Administrator'?'ADMIN':name==='Manager'?'MANAGER':'USER';
            roleCards.set(role,card);
            const count=$$('p',card).find(p=>/Members/.test(text(p)));
            const assigned=role==='USER'?users.filter(u=>!roles.includes(u.role)):users.filter(u=>u.role===role);
            if(count) count.textContent=`${assigned.length} Members`;
            const footer=count?.parentElement?.parentElement,avatars=footer?.firstElementChild;
            if(avatars){
                avatars.replaceChildren(...assigned.slice(0,3).map(member=>avatarNode(member,'w-6 h-6')));
                if(assigned.length>3){const more=document.createElement('span');more.className='w-6 h-6 rounded-full bg-surface-container-highest border-2 border-white inline-flex items-center justify-center text-[8px] font-bold';more.textContent=`+${assigned.length-3}`;avatars.append(more);}
            }
            if(role!=='USER') card.onclick=()=>selectRole(role);
        });
        const summary=$$('h3').find(h=>/Permission Summary|User Roles/.test(text(h)));
        if(summary)summary.textContent='Permission Summary';
        const matrix=$$('h3').find(h=>/Access Matrix|Account Role & Status/.test(text(h)));
        if(matrix)matrix.textContent='Access Matrix';
        const summaryValues={};
        $$('main').forEach(main=>$$('span',main).forEach(span=>{
            const label=span.parentElement?.querySelector('span')?.textContent?.trim();
            if(label)summaryValues[label]=span;
        }));
        const selectedRoleNode=$$('main span').find(s=>text(s)==='Administrator'&&s.parentElement?.querySelector('span')?.textContent?.includes('Selected Role'));
        const enabledNode=$$('main span').find(s=>text(s).includes('Actions'));
        const restrictedNode=$$('main span').find(s=>text(s)==='None');
        const coverageNode=$$('main span').find(s=>text(s).includes('%'));
        const saveButton=buttons(/Save Changes/)[0];
        const tbody=$('table tbody');
        let selectedRole='ADMIN', snapshot=null, changes=new Map();

        function setCardState() {
            for(const [role,card] of roleCards) {
                if(role==='USER') continue;
                card.classList.toggle('border-2',role===selectedRole);
                card.classList.toggle('border-primary',role===selectedRole);
                card.classList.toggle('border',role!==selectedRole);
            }
        }
        function renderSnapshot(data) {
            snapshot=data; changes=new Map();
            if(selectedRoleNode)selectedRoleNode.textContent=roleNames[selectedRole];
            if(enabledNode)enabledNode.textContent=`${data.enabledPermissions} Actions`;
            if(restrictedNode)restrictedNode.textContent=data.restrictedFeatures?`${data.restrictedFeatures} Features`:'None';
            if(coverageNode)coverageNode.textContent=`${data.coverage}%`;
            const progress=$$('main div').find(d=>d.classList.contains('bg-primary')&&d.classList.contains('h-full')&&d.classList.contains('w-full'));
            if(progress){progress.classList.remove('w-full');progress.style.width=`${data.coverage}%`;}
            if(!tbody)return;
            tbody.replaceChildren(...data.features.map(feature=>{
                const tr=document.createElement('tr');tr.className='hover:bg-surface-container-low/30 transition-colors group';
                const td=document.createElement('td');td.className='px-6 py-4 sticky left-0 bg-white/95 backdrop-blur-sm z-10';
                td.textContent=feature.label;tr.append(td);
                for(const actionName of ['READ','WRITE','EXECUTE','DELETE']){
                    const cell=document.createElement('td');cell.className='px-4 py-4 text-center';
                    const input=document.createElement('input');input.type='checkbox';input.checked=Boolean(feature.actions[actionName]);
                    input.className='w-5 h-5 rounded border-outline-variant text-primary focus:ring-primary/20';
                    input.setAttribute('aria-label',`${actionName} ${feature.key}`);
                    const editable=user.role==='ADMIN' && roleFeatures[selectedRole].has(feature.key);
                    input.disabled=!editable;
                    input.onchange=()=>changes.set(`${feature.key}:${actionName}`,{feature:feature.key,action:actionName,enabled:input.checked});
                    cell.append(input);tr.append(cell);
                }
                return tr;
            }));
        }
        async function selectRole(role) {
            selectedRole=role; setCardState();
            renderSnapshot(await request(`/permissions?role=${encodeURIComponent(role)}`));
            if(saveButton)saveButton.disabled=user.role!=='ADMIN';
        }
        if(saveButton)saveButton.disabled=user.role!=='ADMIN';
        bind(saveButton,async()=>{
            if(user.role!=='ADMIN'||!snapshot)return;
            const permissions=[...changes.values()];
            if(!permissions.length){notice('Không có thay đổi permission.');return;}
            const data=await request(`/permissions/${selectedRole}`,{method:'PUT',json:{permissions}});
            renderSnapshot(data); notice('Đã lưu thay đổi permission.');
        });
        await selectRole(selectedRole);
    }
    async function dashboardPage() {
        if (user.role === 'TERMINOLOGY' && window.AAIRTerminologyDashboardPage) {
            return window.AAIRTerminologyDashboardPage({request,user});
        }
        const data=await request('/dashboard');
        const role=user.role;
        const greeting=$$('header h2').find(h=>/^Good (Morning|Afternoon|Evening)/.test(text(h)));if(greeting){const currentGreeting=window.AAIRGreeting?.getGreeting?.(new Date())||'Good Morning,';greeting.textContent=`${currentGreeting} ${user.username}`;}
        let rows=await request(role==='ADMIN'?'/audit-logs':role==='TERMINOLOGY'?'/terms':'/tasks');
        if(document.body.classList.contains('manual-labeling-dashboard')){
            const taskPriority={PENDING:0,IN_PROGRESS:1,REJECTED:2,SUBMITTED:3,APPROVED:4};
            rows=[...rows].sort((left,right)=>{const a=String(left.status||'PENDING').toUpperCase(),b=String(right.status||'PENDING').toUpperCase();const priority=(taskPriority[a]??5)-(taskPriority[b]??5);if(priority)return priority;const leftDate=new Date(left.updated_at||left.created_at||left.updatedAt||0).getTime(),rightDate=new Date(right.updated_at||right.created_at||right.updatedAt||0).getTime();return rightDate-leftDate;});
            const total=rows.length;
            const pending=rows.filter(row=>['PENDING','IN_PROGRESS','REJECTED'].includes(String(row.status||'').toUpperCase())).length;
            const submitted=rows.filter(row=>String(row.status||'').toUpperCase()==='SUBMITTED').length;
            const completed=rows.filter(row=>String(row.status||'').toUpperCase()==='APPROVED').length;
            const resumableTask=rows.find(row=>['IN_PROGRESS','REJECTED'].includes(String(row.status||'').toUpperCase()));
            const assignedSessions=new Set(rows.map(row=>row.session_id).filter(value=>value!=null)).size;
            const percent=total?Math.round(completed/total*100):0;
            $('#assignedSessionsValue').textContent=String(assignedSessions);
            $('#pendingTasksValue').textContent=String(pending);
            $('#submittedTasksValue').textContent=String(submitted);
            $('#completedTasksValue').textContent=String(completed);
            $('#overallProgressValue').textContent=`${percent}%`;
            const submittedText=`${completed} approved · ${submitted} submitted`;
            $('#overallProgressSub').textContent=submittedText;
            $('#overallProgressBar')?.style.setProperty('width',`${percent}%`);
            const dashboardState=$('#manualDashboardState');
            if(dashboardState){
                dashboardState.hidden=false;
                dashboardState.textContent=pending===0&&submitted>0
                    ? `All assigned work has been submitted. ${submitted} task${submitted===1?' is':'s are'} waiting for reviewer approval.`
                    : pending>0 ? `${pending} task${pending===1?'':'s'} still need${pending===1?'s':''} your attention.`
                    : 'No tasks are currently assigned to you.';
            }
            const taskStatusLabels={PENDING:'Pending',IN_PROGRESS:'In progress',SUBMITTED:'Submitted',APPROVED:'Approved',REJECTED:'Rejected'};
            const taskStatusClasses={PENDING:'pending',IN_PROGRESS:'progress',SUBMITTED:'submitted',APPROVED:'approved',REJECTED:'rejected'};
            const relativeTaskTime=value=>{const parsed=new Date(value||'');if(Number.isNaN(parsed.getTime()))return '—';const seconds=Math.max(0,Math.round((Date.now()-parsed.getTime())/1000));if(seconds<60)return 'Just now';if(seconds<3600)return `${Math.floor(seconds/60)} min ago`;if(seconds<86400)return `${Math.floor(seconds/3600)} hr ago`;return `${Math.floor(seconds/86400)} days ago`;};
            const formatDue=value=>{const parsed=new Date(value||'');return Number.isNaN(parsed.getTime())?'—':new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric'}).format(parsed);};
            const tasksBody=$('#myTasksBody');if(tasksBody){tasksBody.innerHTML=rows.slice(0,5).map(row=>{const status=String(row.status||'PENDING').toUpperCase();const updated=row.updated_at||row.created_at||row.updatedAt;const due=row.due_at||row.dueAt;const action=status==='APPROVED'||status==='SUBMITTED'?'View':status==='PENDING'?'Start':'Continue';return `<tr class="my-task-row" tabindex="0" data-task-id="${row.id||''}"><td>${row.document_title||'Untitled document'}</td><td>${row.session_name||'Unassigned session'}</td><td><span class="my-task-status my-task-status--${taskStatusClasses[status]||'pending'}">${taskStatusLabels[status]||'Pending'}</span></td><td>${formatDue(due)}</td><td title="${updated||''}">${relativeTaskTime(updated)}</td><td><a href="Task.html?id=${row.id||''}" class="text-primary font-semibold hover:underline">${action}</a></td></tr>`;}).join('')||'<tr><td colspan="6">No tasks assigned.</td></tr>';tasksBody.querySelectorAll('.my-task-row').forEach(row=>{const open=()=>go(`Task.html?id=${row.dataset.taskId}`);row.addEventListener('click',event=>{if(event.target.closest('a'))return;open();});row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});});}
            tasksBody?.querySelectorAll('.my-task-row').forEach(rowElement=>{const item=rows.find(row=>String(row.id)===rowElement.dataset.taskId);if(!item)return;const status=String(item.status||'PENDING').toUpperCase();const actionLink=$('a',rowElement);const documentCell=$('td',rowElement);const updated=item.updated_at||item.created_at||item.updatedAt;if(documentCell){documentCell.classList.add('my-task-document-cell');documentCell.title=item.document_title||'Untitled document';}if(actionLink){const label=status==='APPROVED'||status==='SUBMITTED'?'View':status==='PENDING'?'Start':'Continue';actionLink.textContent=label;actionLink.classList.add('my-task-action');if(label==='View')actionLink.classList.add('my-task-action--view');}const updatedCell=$$('td',rowElement)[4];if(updatedCell){const parsed=new Date(updated);updatedCell.title=Number.isNaN(parsed.getTime())?'Exact time unavailable':new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(parsed);}});
            $$('[data-dashboard-link]').forEach(card=>{const open=()=>{location.href=card.dataset.dashboardLink;};card.addEventListener('click',open);card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});});
            const continueButton=$('#continueLastSession');
            if(continueButton){
                continueButton.disabled=!resumableTask;
                continueButton.setAttribute('aria-disabled',String(!resumableTask));
                continueButton.title=resumableTask?'Tiếp tục tác vụ đang làm dở':'Chưa có tác vụ nào đang làm dở';
                if(resumableTask)bind(continueButton,()=>go(`Task.html?id=${resumableTask.id}`));
            }
            bind($('#refreshDashboard'),()=>location.reload());
            return;
        }
        // All dashboard designs have their KPI cards in the first grid.
        const grid=$('main .grid');
        if(grid){
            if(role==='ADMIN' && grid.children[2]){
                const auditCard=grid.children[2];
                if(!auditCard.querySelector('.admin-audit-icon')){
                    const auditHeader=auditCard.querySelector('.flex.justify-between.items-start');
                    if(auditHeader){
                        const auditIcon=document.createElement('div');
                        auditIcon.className='p-2 bg-secondary-container/20 rounded-lg text-secondary admin-audit-icon';
                        auditIcon.innerHTML='<span class="material-symbols-outlined">list_alt</span>';
                        auditHeader.prepend(auditIcon);
                    }
                }
            }
            const entries=Object.entries(data);
            [...grid.children].forEach((card,index)=>{card.classList.add('admin-kpi-card');
                const value=$('h3[class*="32px"],h3[class*="headline"],p[class*="headline-md"],p[class*="text-3xl"],span[class*="text-3xl"]',card)
                    || $$('h3,p',card).find(e=>/^\d/.test(text(e)));
                if(!value)return;
                const entry=entries[index];value.textContent=entry?String(entry[1]):'—';value.classList.add('admin-kpi-value');
                const label=value.previousElementSibling;if(label){const adminLabels=['Total Accounts','Active Accounts','Audit Events','Security Alerts'];label.textContent=role==='ADMIN'?(adminLabels[index]||'No data available.'):entry?entry[0]:'No data available';label.classList.add('admin-kpi-label');}
                $$('svg',card).filter(s=>!s.classList.contains('admin-security-svg')).forEach(s=>s.hidden=true);
                if(role==='ADMIN' && index===2){card.querySelectorAll('svg,.absolute').forEach(element=>element.remove());}
                $$('span,p,div',card).filter(e=>e!==value&&e!==label&&!e.contains(value)&&!e.contains(label)&&!e.querySelector('.admin-audit-icon')&&/\+\d|%|STABLE|Critical|Action Required|Last 7 Days|^add\s+\d/i.test(text(e))).forEach(e=>e.textContent='');
            });
        }
        if(role==='ADMIN'){
            const adminGrid=$('main .grid');
            $$('main .admin-mini-chart h3').forEach(heading=>replacePanel(heading,['No data available.']));
            const securityCard=adminGrid?.children[3];
            const detailText=(row,action)=>{const raw=String(row.details||row.description||'').trim();const generic=(action||'Activity').replaceAll('_',' ').toLowerCase()+' event';if(raw&&raw.toLowerCase()!==generic)return raw;return ({CREATE:'Created a new record',UPDATE:'Updated record details',RESOLVE_FIELD:'Resolved a review field',DELETE:'Deleted a record',LOGIN_FAILED:'Failed login attempt',LOCK:'Account locked',LOGIN:'Signed in',LOGOUT:'Signed out',EXPORT:'Exported audit data',IMPORT:'Imported data',SAVE_LABELS:'Saved label updates',START:'Started a labeling task'}[action]||'Recorded audit activity');};
            const auditRows=rows.map((row,index)=>({
                id:row.id??index,
                time:row.created_at||row.timestamp||row.logged_at||row.updated_at,
                user:row.username||row.user||'Unknown',
                role:({ADMIN:'Admin',MANAGER:'Manager',REVIEWER:'Reviewer',LABELER:'Labeler',MANUAL_LABELER:'Labeler',ANALYST:'Analyst',RESULT_ANALYST:'Analyst'}[row.role||row.user_role]||row.role||'User'),
                resource:row.resource_type||row.resource||'SYSTEM',
                resourceId:row.resource_id??row.id??'—',
                action:String(row.action||'UNKNOWN').toUpperCase(),
                details:detailText(row,String(row.action||'UNKNOWN').toUpperCase())
            }));
            const actionTone=action=>({CREATE:'create',UPDATE:'update',RESOLVE_FIELD:'update',DELETE:'delete',LOGIN_FAILED:'security',LOCK:'security',LOGIN:'login',LOGOUT:'login',EXPORT:'export',IMPORT:'export'}[action]||'neutral');
            const timeValue=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?null:date;};
            const fullTime=value=>{const date=timeValue(value);return date?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date):'Timestamp unavailable';};
            const relativeTime=value=>{const date=timeValue(value);if(!date)return '—';const seconds=Math.max(0,Math.round((Date.now()-date.getTime())/1000));if(seconds<60)return 'Just now';if(seconds<3600)return `${Math.floor(seconds/60)} min ago`;if(seconds<86400)return `${Math.floor(seconds/3600)} hr ago`;return `${Math.floor(seconds/86400)} days ago`;};
            const renderAdminAudit=()=>{
                const searchValue=($('#adminAuditSearch')?.value||'').toLowerCase();
                const selectedUser=$('#adminAuditUser')?.value||'all';
                const selectedAction=$('#adminAuditAction')?.value||'all';
                const selectedPeriod=$('#adminTimeFilter')?.value||'all';
                const limit={today:1,'7d':7,'30d':30,all:Infinity}[selectedPeriod];
                const now=Date.now();
                const filtered=auditRows.filter(row=>{
                    const date=timeValue(row.time);const inPeriod=!date||limit===Infinity||(now-date.getTime())/86400000<=limit;
                    const matchesSearch=!searchValue||[row.user,row.role,row.resource,row.action,row.details].join(' ').toLowerCase().includes(searchValue);
                    return inPeriod&&matchesSearch&&(selectedUser==='all'||row.user===selectedUser)&&(selectedAction==='all'||row.action===selectedAction);
                });
                                const tableEl=$('table',document);const body=tableEl?.querySelector('tbody');const head=tableEl?.querySelector('thead tr');if(!body||!head)return;
                tableEl.classList.add('admin-audit-table');head.innerHTML='<th>Time</th><th>User</th><th>Resource</th><th>Action</th><th>Details</th>';body.replaceChildren();
                filtered.slice(0,8).forEach(row=>{const tr=document.createElement('tr');tr.className='admin-audit-row';tr.tabIndex=0;const timeCell=document.createElement('td');timeCell.className='admin-audit-time';const time=document.createElement('time');time.dateTime=row.time||'';time.title=fullTime(row.time);time.textContent=relativeTime(row.time);timeCell.append(time);tr.append(timeCell);const userCell=document.createElement('td');userCell.innerHTML=`<span class="admin-audit-user"><i class="admin-audit-avatar">${row.user.slice(0,2).toUpperCase()}</i><span><strong>${row.user}</strong><span class="admin-role-badge">${row.role}</span></span></span>`;tr.append(userCell);const resourceCell=document.createElement('td');resourceCell.innerHTML=`<a class="admin-resource-link" href="#${row.resource}-${row.resourceId}">${row.resource} #${row.resourceId}</a>`;tr.append(resourceCell);const actionCell=document.createElement('td');actionCell.innerHTML=`<span class="admin-action-badge admin-action--${actionTone(row.action)}">${row.action.replaceAll('_',' ')}</span>`;tr.append(actionCell);const detailCell=document.createElement('td');detailCell.textContent=row.details;tr.append(detailCell);body.append(tr);});
                const alertCount=auditRows.filter(row=>['LOGIN_FAILED','LOCK'].includes(row.action)).length;const count=securityCard?.querySelector('[data-security-count]');if(count)count.textContent=String(alertCount);if(securityCard){securityCard.classList.toggle('admin-security-card--alert',alertCount>0);const state=securityCard.querySelector('.admin-security-state');const trend=securityCard.querySelector('.admin-kpi-trend');if(state){state.textContent=alertCount?'Action required':'All clear';const securityIcon=securityCard.querySelector('.admin-security-svg');if(securityIcon)securityIcon.innerHTML=alertCount?'<path d="M12 3 5 6v5c0 4.55 2.84 8.74 7 10 4.16-1.26 7-5.45 7-10V6l-7-3Z"></path><path d="M12 8v4M12 16h.01"></path>':'<path d="M12 3 5 6v5c0 4.55 2.84 8.74 7 10 4.16-1.26 7-5.45 7-10V6l-7-3Z"></path><path d="m9 12 2 2 4-4"></path>';}if(trend){trend.textContent=alertCount?`${alertCount} security event${alertCount===1?'':'s'} in 24 hours`:'All clear';}}
            };
            const userSelect=$('#adminAuditUser'),actionSelect=$('#adminAuditAction');[...new Set(auditRows.map(row=>row.user))].forEach(userName=>userSelect?.append(new Option(userName,userName)));[...new Set(auditRows.map(row=>row.action))].forEach(action=>actionSelect?.append(new Option(action,action)));['adminAuditSearch','adminAuditUser','adminAuditAction','adminTimeFilter'].forEach(id=>{const element=$(`#${id}`);element?.addEventListener(element.tagName==='SELECT'?'change':'input',renderAdminAudit);});
            renderAdminAudit();
            bindText(/View Full Audit/,()=>go('LogView.html'));
        }else if(role==='TERMINOLOGY'){
            table($('table'),[['Term','term'],['Category','category'],['Date',r=>date(r.updated_at)],['Status','status']],rows.slice(0,10));
            bindText(/View All|Details/,()=>go('BaseManagement.html'));
            const heading=$$('h3').find(h=>text(h)==='Category Distribution');
            if(heading)replacePanel(heading,Object.entries(rows.reduce((groups,r)=>{groups[r.category||'Other']=(groups[r.category||'Other']||0)+1;return groups;},{})).map(([k,v])=>`${k}: ${v}`));
        }else if(role==='MANAGER'){
            const managerTable=$('#managerTaskTable')||$('table');
            const managerFilter=$('#managerTimeFilter');
            const statusLabels={PENDING:'Pending',IN_PROGRESS:'In progress',SUBMITTED:'Submitted',APPROVED:'Approved',REJECTED:'Rejected',pending:'Pending',in_progress:'In progress',submitted:'Submitted',approved:'Approved',rejected:'Rejected'};
            const statusClasses={PENDING:'pending',IN_PROGRESS:'progress',SUBMITTED:'submitted',APPROVED:'approved',REJECTED:'rejected',pending:'pending',in_progress:'progress',submitted:'submitted',approved:'approved',rejected:'rejected'};
            const managerDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?null:date;};
            const managerRelative=value=>{const date=managerDate(value);if(!date)return 'Date unavailable';const days=Math.max(0,Math.floor((Date.now()-date.getTime())/86400000));return days===0?'Today':days===1?'1 day ago':days+' days ago';};
            const managerFullDate=value=>{const date=managerDate(value);return date?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):'Timestamp unavailable';};
            const managerInitials=name=>String(name||'User').slice(0,2).toUpperCase();
            const managerPeriodLimit=value=>({today:1,'7d':7,'30d':30,all:Infinity}[value]??30);
            const renderManagerActivity=()=>{
                const days=[...Array(7)].map((_,index)=>{const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()-(6-index));return date;});
                const counts=days.map(day=>rows.filter(row=>{const created=managerDate(row.created_at||row.createdAt);if(!created)return false;const value=new Date(created);value.setHours(0,0,0,0);return value.getTime()===day.getTime();}).length);
                const max=Math.max(1,...counts);
                const activity=document.querySelectorAll('.manager-day');
                activity.forEach((day,index)=>{const value=counts[index]||0;const label=day.querySelector('b');const bar=day.querySelector('i');const date=days[index];const dayName=new Intl.DateTimeFormat('en-US',{weekday:'short'}).format(date);if(label)label.textContent=String(value);if(bar)bar.style.height=(value?Math.max(12,Math.round(value/max*100)):0)+'%';const caption=day.querySelector('small');if(caption)caption.textContent=dayName;});
                const range=document.querySelector('#managerActivityRange');if(range)range.textContent='Last 7 days';
            };
            const renderManagerDashboard=()=>{['Total Tasks','Pending Review','Approved','In Progress'].forEach((label,index)=>{const node=document.querySelectorAll('.manager-kpi-label')[index];if(node)node.textContent=label;});
                const limit=managerPeriodLimit(managerFilter?.value||'30d');
                const visible=rows.filter(row=>{const date=managerDate(row.created_at||row.createdAt||row.updated_at);return !date||limit===Infinity||(Date.now()-date.getTime())/86400000<=limit;});
                const counts={total:visible.length,pending:visible.filter(row=>String(row.status||'').toUpperCase()==='SUBMITTED').length,progress:visible.filter(row=>String(row.status||'').toUpperCase()==='IN_PROGRESS').length,approved:visible.filter(row=>String(row.status||'').toUpperCase()==='APPROVED').length};
                Object.entries({total:counts.total,pending:counts.pending,progress:counts.progress,approved:counts.approved}).forEach(([key,value])=>{const node=document.querySelector('[data-manager-stat="'+key+'"]');if(node)node.textContent=String(value);});
                const approvedSub=document.querySelector('.manager-kpi-card:nth-child(3) .manager-kpi-sub strong');if(approvedSub)approvedSub.textContent=(counts.total?Math.round(counts.approved/counts.total*100):0)+'% of total tasks';
                if(managerTable){
                    const body=managerTable.querySelector('tbody');
                    if(body)body.innerHTML=visible.slice(0,10).map(row=>{const status=String(row.status||'PENDING');const assignee=row.assignee||row.assigned_to||'Unassigned';const role=String(assignee).toLowerCase().includes('ai')?'AI Labeler':'Manual Labeler';const id=row.id??'';return '<tr tabindex="0" data-task-id="'+id+'"><td><span class="manager-document" title="'+(row.document_title||'Untitled document')+'">'+(row.document_title||'Untitled document')+'</span></td><td><span class="manager-assignee"><i class="manager-avatar">'+managerInitials(assignee)+'</i><span><span class="manager-user-name">'+assignee+'</span><span class="manager-role">'+role+'</span></span></span></td><td><span class="manager-status manager-status--'+(statusClasses[status]||'pending')+'">'+(statusLabels[status]||'Pending')+'</span></td><td><time class="manager-created" title="'+managerFullDate(row.created_at||row.createdAt||row.updated_at)+'">'+managerRelative(row.created_at||row.createdAt||row.updated_at)+'</time></td></tr>';}).join('')||'<tr><td colspan="4" style="text-align:center;color:#64748b">No tasks in this period.</td></tr>';
                    body.querySelectorAll('tr[data-task-id]').forEach(row=>{row.addEventListener('click',()=>go('Task.html?id='+encodeURIComponent(row.dataset.taskId)));row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();row.click();}});});
                }
                const distribution=[visible.filter(row=>String(row.status||'').toUpperCase()==='PENDING').length,counts.progress,visible.filter(row=>String(row.status||'').toUpperCase()==='SUBMITTED').length,counts.approved];document.querySelectorAll('.manager-role-line').forEach((line,index)=>{const value=distribution[index]||0;const label=line.querySelector('b');const bar=line.querySelector('i');if(label)label.textContent=String(value);if(bar)bar.style.width=(counts.total?Math.round(value/counts.total*100):0)+'%';});
                renderManagerActivity();
            };
            managerFilter?.addEventListener('change',renderManagerDashboard);
            bind($('#managerRefresh'),async()=>{try{rows=await request('/tasks');renderManagerDashboard();notice('Dashboard refreshed.');}catch(error){notice(error.message,true);}});
            renderManagerDashboard();
            bindText(/View Detailed Logs/,()=>go('Session.html'));
        }else if(role==='AI_LABELER'){
            const statusLabels={PENDING:'Pending Review',IN_PROGRESS:'In progress',SUBMITTED:'Submitted',APPROVED:'Approved',REJECTED:'Rejected'};
            const statusClasses={PENDING:'pending',IN_PROGRESS:'progress',SUBMITTED:'submitted',APPROVED:'approved',REJECTED:'rejected'};
            const relative=value=>{const parsed=new Date(value||'');if(Number.isNaN(parsed.getTime()))return 'Recently';const seconds=Math.max(0,Math.round((Date.now()-parsed.getTime())/1000));if(seconds<3600)return 'Less than an hour ago';if(seconds<86400)return `${Math.floor(seconds/3600)} hours ago`;return `${Math.floor(seconds/86400)} days ago`;};
            const kpiGrid=$('main .grid');
            if(kpiGrid){kpiGrid.className='ai-kpi-grid';const daily=rows.length,pending=rows.filter(row=>['PENDING','IN_PROGRESS'].includes(String(row.status||'').toUpperCase())).length,approved=rows.filter(row=>String(row.status||'').toUpperCase()==='APPROVED').length,urgent=rows.filter(row=>{const due=new Date(row.due_at||'');return !Number.isNaN(due.getTime())&&due<new Date()&&!['APPROVED','SUBMITTED'].includes(String(row.status||'').toUpperCase());}).length;const cards=[['assignment','Daily Tasks',daily,'Assigned today'],['task_alt','Pending Review',pending,'All pending items'],['check_circle','Approved',approved,'Approved tasks'],['priority_high','Urgent Tasks',urgent,urgent?'Needs attention':'Nothing urgent']];kpiGrid.replaceChildren(...cards.map(([icon,label,value,sub])=>{const card=document.createElement('article');card.className='ai-kpi-card';card.innerHTML=`<div class="ai-kpi-card__icon"><span class="material-symbols-outlined">${icon}</span></div><p class="ai-kpi-card__label">${label}</p><strong class="ai-kpi-card__value">${value}</strong><p class="ai-kpi-card__sub">${sub}</p>`;return card;}));}
            const sessions=$$('h2,h3').find(h=>text(h)==='Current AI Labeling Sessions');
            if(sessions){const section=sessions.parentElement.parentElement;const cards=$('.grid',section);if(cards){cards.className='ai-session-list';cards.replaceChildren(...rows.slice(0,4).map(row=>{const card=document.createElement('article');const status=String(row.status||'PENDING').toUpperCase();const completed=Number(row.completed_sections||row.labeled_sections||0),total=Number(row.total_sections||row.sections_total||0),percent=total?Math.round(completed/total*100):0;const stage=row.stage||row.task_stage||(row.assistance_mode==='AI_ASSISTED'?'AI-assisted':'AI labeling');card.className='ai-session-card';card.innerHTML=`<div class="ai-session-card__top"><h3>${row.document_title||'Untitled document'}</h3><span class="ai-badge ai-badge--${statusClasses[status]||'pending'}">${statusLabels[status]||'Pending Review'}</span></div><div class="ai-session-card__meta"><div><span>Session</span><strong>${row.session_name||'—'}</strong></div><div><span>Status</span><strong><span class="ai-badge ai-badge--${statusClasses[status]||'pending'}">${statusLabels[status]||'Pending Review'}</span></strong></div><div><span>Stage</span><strong>${stage}</strong></div></div><div class="ai-session-card__progress"><div class="ai-session-card__progress-head"><span>Progress</span><span>${completed}/${total||0} sections · ${percent}%</span></div><div class="ai-session-card__bar"><span style="width:${percent}%"></span></div></div><a class="ai-session-card__action" href="Task.html?id=${row.id}">Continue</a>`;return card;}));}}
            const recentHeading=$$('h3,h4').find(h=>text(h)==='Recent Activity');
            if(recentHeading){replacePanel(recentHeading,[]);const container=recentHeading.parentElement.parentElement;const content=container.lastElementChild;if(content){content.className='ai-recent-list';content.innerHTML=rows.slice(0,5).map(row=>{const status=String(row.status||'PENDING').toUpperCase();return `<div class="ai-recent-item"><span class="ai-recent-document">${row.document_title||'Untitled document'} ${status.toLowerCase()}</span><span class="ai-badge ai-badge--${statusClasses[status]||'pending'}">${statusLabels[status]||'Pending Review'}</span><time>${relative(row.updated_at||row.created_at)}</time></div>`;}).join('')||'<p class="ai-empty">No recent activity.</p>';}}
        }else{
            $$('table').forEach(t=>table(t,[['Document','document_title'],['Assignee','assignee'],['Status','status'],['Action','$actions']],rows.slice(0,10),r=>[action('Open',()=>go(`Task.html?id=${r.id}`))]));
            bindText(/View All|Full Comparison|Full Audit/,()=>go('ViewAll.html'));
            bindText(/Continue/,()=>go(rows.length?`Task.html?id=${rows[0].id}`:'ViewAll.html'));
            const sessions=$$('h2,h3').find(h=>text(h)==='Current AI Labeling Sessions');
            if(sessions){const section=sessions.parentElement.parentElement;const cards=$('.grid',section);if(cards){
                const template=cards.firstElementChild.cloneNode(true);cards.replaceChildren();
                for(const row of rows.slice(0,3)){const card=template.cloneNode(true);const h=$('h4,h3',card);if(h)h.textContent=row.document_title;
                    $$('p',card).forEach((p,i)=>p.textContent=i===0?row.session_name:row.status);
                    $$('span',card).filter(s=>!s.classList.contains('material-symbols-outlined')).forEach(s=>s.textContent='');
                    bindText(/Continue/,()=>go(`Task.html?id=${row.id}`),card);cards.append(card);}
            }}
            $$('h3,h4').filter(h=>['Recent Activity','Top Reviewers','Recent Analysis Summary','Recent Error Overview'].includes(text(h))).forEach(h=>replacePanel(h,rows.slice(0,5).map(r=>`${r.document_title} — ${r.status}`)));
            $$('h3,h4').filter(h=>['Accuracy Trend','Annotation Distribution','Agreement Performance','Error Trend','Review Progress'].includes(text(h))).forEach(h=>replacePanel(h,['Chưa có dữ liệu cho chỉ số này.']));
        }
        buttons(/Last 30 Days/).forEach(b=>{b.textContent='All Time';unavailable(b,'API dashboard hiện trả số liệu toàn thời gian.');});
    }
    function replacePanel(heading,lines) {
        let container=heading.parentElement;
        if(container.children.length===1||container.className.includes('items-center'))container=container.parentElement;
        const keep=[...container.children].find(c=>c===heading||c.contains(heading));
        [...container.children].filter(c=>c!==keep).forEach(c=>c.remove());
        const content=document.createElement('div');content.className='p-4 text-sm space-y-2';
        for(const line of lines.length?lines:['Chưa có dữ liệu.']){const p=document.createElement('p');p.textContent=line;content.append(p);}container.append(content);
    }
    function statsIcon(name,size=22){
        const paths={
            assignment:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3.5h8M8 9h8M8 13h8M8 17h5"/>',
            task_alt:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
            view_week:'<rect x="4" y="5" width="4" height="14" rx="1"/><rect x="10" y="5" width="4" height="14" rx="1"/><rect x="16" y="5" width="4" height="14" rx="1"/>',
            warning:'<path d="m12 4 8 15H4L12 4Z"/><path d="M12 9v4M12 16h.01"/>',
            download:'<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
            compare_arrows:'<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>'
        };
        return `<svg class="stats-inline-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.assignment}</svg>`;
    }
    async function statisticsPage() {
        const statisticsRoot=$('main');
        if(statisticsRoot){
            statisticsRoot.replaceChildren();
            const loading=document.createElement('p');
            loading.className='workspace-api-loading';
            loading.textContent='Loading data…';
            statisticsRoot.append(loading);
        }
        const [data,tasks,assignees,sessions]=await Promise.all([request('/statistics'),request('/tasks'),request('/assignees'),request('/sessions')]);
        const main=$('main');
        main.className='manager-workflow';
        main.innerHTML=`<section class="manager-workflow__head"><div><h2>Statistics</h2><small>Labeling and review performance overview</small></div><div class="manager-filters"><label>Session<select id="statsSession"><option value="">All sessions</option></select></label><label>Assistance mode<select id="statsMode"><option value="">All modes</option><option value="NONE">Manual</option><option value="AI_ASSISTED">AI-assisted</option></select></label></div></section><section id="statsKpis" class="manager-kpis"></section><section class="manager-grid"><div class="manager-panel manager-panel--wide"><div class="manager-panel__head"><div><span>TEAM DELIVERY</span><h3>Progress by user and section</h3></div><button id="exportStatistics" class="manager-icon-button" type="button" title="Export statistics" aria-label="Export statistics">${statsIcon('download',18)}</button></div><div class="manager-table-wrap"><table><thead><tr><th>Assignee</th><th>Tasks</th><th>Sections</th><th>Progress</th><th>Overdue</th></tr></thead><tbody id="productivityBody"></tbody></table></div></div><div class="manager-panel"><div class="manager-panel__head"><div><span>TIME STUDY</span><h3>AI-assisted vs. manual</h3></div></div><div id="timeComparison" class="time-comparison"></div></div><div class="manager-panel manager-panel--wide"><div class="manager-panel__head"><div><span>DEADLINES</span><h3>Tasks requiring attention</h3></div><span id="overdueCount" class="danger-count"></span></div><div class="manager-table-wrap"><table><thead><tr><th>Document</th><th>Assignee</th><th>Mode</th><th>Status</th><th>Due date</th></tr></thead><tbody id="overdueBody"></tbody></table></div></div><div class="manager-panel"><div class="manager-panel__head"><div><span>PAIR REVIEW</span><h3>Create review case</h3></div></div><form id="reviewCaseForm" class="review-case-form"><label>Source A<select id="reviewLeft" required></select></label><label>Source B<select id="reviewRight" required></select></label><label>Reviewer<select id="reviewerSelect" required></select></label><label>Deadline<input id="reviewDue" lang="en-GB" type="datetime-local" required></label><button type="submit">${statsIcon('compare_arrows',18)}Create review case</button><p id="reviewCaseMessage"></p></form></div></section>`;
        const sessionSelect=$('#statsSession'),modeSelect=$('#statsMode');
        sessions.forEach(row=>sessionSelect.add(new Option(row.name,String(row.id))));
        const submittedManual=tasks.filter(row=>row.task_type==='MANUAL'&&row.session_id&&['SUBMITTED','APPROVED'].includes(row.status));
        const pairGroups=new Map();
        submittedManual.forEach(row=>{const key=`${row.session_id}:${row.document_id}`;const group=pairGroups.get(key)||[];group.push(row);pairGroups.set(key,group);});
        const eligible=submittedManual.filter(row=>new Set((pairGroups.get(`${row.session_id}:${row.document_id}`)||[]).map(item=>item.assigned_to)).size===2);
        const taskLabel=row=>`${row.document_title} · ${row.assignee||'Unassigned'} · #${row.id}`;
        const fillTaskSelect=(select,rows)=>select.replaceChildren(new Option('Select task',''),...rows.map(row=>new Option(taskLabel(row),String(row.id))));
        const sessionReviewers=new Map(sessions.map(session=>[String(session.id),(session.members||[]).filter(member=>member.role==='REVIEWER')]));
        fillTaskSelect($('#reviewLeft'),eligible);fillTaskSelect($('#reviewRight'),eligible);
        const populateReviewers=sessionId=>{const select=$('#reviewerSelect');select.replaceChildren(new Option('Select reviewer',''),...(sessionReviewers.get(String(sessionId))||[]).map(row=>new Option(row.username,String(row.id))));};
        $('#reviewLeft').addEventListener('change',event=>{const left=eligible.find(row=>String(row.id)===event.target.value);fillTaskSelect($('#reviewRight'),left?eligible.filter(row=>row.id!==left.id&&row.document_id===left.document_id&&String(row.session_id)===String(left.session_id)):eligible);populateReviewers(left?.session_id);});
        const statusTotals=Object.fromEntries(data.statuses.map(row=>[row.status,Number(row.total)]));
        const render=()=>{
            const sessionId=sessionSelect.value,mode=modeSelect.value;
            const sections=(data.sectionProgress||[]).filter(row=>(!sessionId||String(row.session_id)===sessionId)&&(!mode||row.assistance_mode===mode));
            const taskIds=new Set(sections.map(row=>row.task_id));
            const people=(data.userProductivity||[]).filter(row=>!sessionId||sections.some(section=>section.username===row.username));
            const reviewed=sections.filter(row=>row.section_status==='REVIEWED').length,totalSections=sections.filter(row=>row.field_key).length;
            $('#statsKpis').innerHTML=[['Total Tasks',taskIds.size||data.statuses.reduce((n,row)=>n+Number(row.total),0),'assignment','All tracked tasks'],['Approved',statusTotals.APPROVED||0,'task_alt','Tasks approved'],['Sections Completed',`${reviewed}/${totalSections}`,'view_week','Reviewed sections'],['Overdue Tasks',(data.overdueTasks||[]).length,'warning','Needs attention']].map(([label,value,icon,sub])=>`<article class="${label==='Overdue Tasks'&&Number(value)>0?'kpi-alert':''}"><span class="stats-icon">${statsIcon(icon,22)}</span><small>${label}</small><strong>${value}</strong><em>${sub}</em></article>`).join('');
            $('#productivityBody').innerHTML=people.length?people.map(row=>{const total=Number(row.saved_sections||0)+Number(row.submitted_sections||0)+Number(row.reviewed_sections||0),done=Number(row.reviewed_sections||0),percent=total?Math.round(done/total*100):0;return `<tr><td><b class="stats-person-name">${row.username||'Unassigned'}</b></td><td>${row.completed_tasks}/${row.assigned_tasks}</td><td>${done}/${total}</td><td><div class="progress-cell"><span style="width:${percent}%"></span></div><small>${percent}%</small></td><td><span class="${Number(row.overdue_tasks)?'status-overdue':'status-ok'}">${row.overdue_tasks||0}</span></td></tr>`;}).join(''):'<tr><td colspan="5">No matching data.</td></tr>';
        };
        const comparisons=data.timeComparison||[];const maxTime=Math.max(1,...comparisons.map(row=>Number(row.average_seconds)||0));
        const modeLabel=mode=>mode==='AI_ASSISTED'?'AI-assisted':'Manual';
        const formatStatsDate=value=>{if(!value)return '—';const parsed=new Date(value);if(Number.isNaN(parsed.getTime()))return '—';const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const pad=number=>String(number).padStart(2,'0');return `${parsed.getDate()} ${months[parsed.getMonth()]} ${parsed.getFullYear()}, ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;};
        const statusLabel={PENDING:'Pending',IN_PROGRESS:'In progress',SUBMITTED:'Submitted',APPROVED:'Approved',REJECTED:'Rejected'};
        const statusClass={PENDING:'pending',IN_PROGRESS:'progress',SUBMITTED:'submitted',APPROVED:'approved',REJECTED:'rejected'};
        const comparisonModes=['NONE','AI_ASSISTED'];const comparisonByMode=Object.fromEntries(comparisons.map(row=>[row.assistance_mode,row]));
        const availableComparisonModes=comparisonModes.filter(mode=>comparisonByMode[mode]);
        $('#timeComparison').innerHTML=availableComparisonModes.length?availableComparisonModes.map(mode=>{const row=comparisonByMode[mode];const seconds=Number(row.average_seconds||0);return `<div><header><b>${modeLabel(mode)}</b><span>${Math.round(seconds/60)} min avg · n=${Number(row.sample_size||0)}</span></header><span class="time-bar"><i style="width:${seconds/maxTime*100}%"></i></span><small>Median ${Math.round(Number(row.median_seconds||0)/60)} min</small></div>`;}).join(''):'<p class="manager-empty">No data available.</p>';
        const overdue=data.overdueTasks||[];$('#overdueCount').textContent=overdue.length?`${overdue.length} overdue`:'None overdue';$('#overdueBody').innerHTML=overdue.length?overdue.map(row=>`<tr><td><span class="stats-document-name">${row.document_title||'Untitled document'}</span></td><td><span class="stats-person-name">${row.username||'—'}</span></td><td><span class="mode-badge">${modeLabel(row.assistance_mode)}</span></td><td><span class="task-status task-status--${statusClass[row.status]||'pending'}">${statusLabel[row.status]||'Pending'}</span></td><td class="due-date">${formatStatsDate(row.due_at)}</td></tr>`).join(''):'<tr><td colspan="5"><span class="status-ok">No overdue tasks.</span></td></tr>';
        sessionSelect.addEventListener('change',render);modeSelect.addEventListener('change',render);render();
        bind($('#exportStatistics'),()=>exportJson(data,'aair-manager-statistics.json'));
        $('#reviewCaseForm').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{const leftId=Number($('#reviewLeft').value),rightId=Number($('#reviewRight').value),assignedTo=Number($('#reviewerSelect').value),due=$('#reviewDue').value;if(!leftId||!rightId||!assignedTo||!due)throw new Error('Select both sources, a reviewer, and a deadline.');await request('/review-cases',{method:'POST',json:{leftTaskId:leftId,rightTaskId:rightId,assignedTo,dueAt:`${due}:00`}});$('#reviewCaseMessage').textContent='Review case created and assigned to the reviewer.';});});
    }
    async function monitoringPage() {
        const logs=await request('/audit-logs');
        table($('table'),[['Timestamp',r=>date(r.created_at)],['User','username'],['Resource','resource_type'],['Action','action']],logs.slice(0,10));
        $$('main h3,main h4').filter(h=>['CPU & Memory Usage (24h)','API Latency vs GPU Load'].includes(text(h))).forEach(h=>replacePanel(h,['Chưa có API cung cấp số liệu giám sát.']));
        buttons(/^Restart$|^Logs$|filter_list/).forEach(b=>unavailable(b,'Chưa có API quản lý dịch vụ.'));
        bindText(/View All Full Logs/,()=>go('LogView.html'));
        $$('main h3').filter(h=>['RTMPose','Model Server','REST API','Database','Storage Service'].includes(text(h))).forEach(h=>{
            const card=h.closest('.bg-white')||h.parentElement.parentElement;
            $$('p,span',card).filter(e=>!e.classList.contains('material-symbols-outlined')).forEach(e=>{if(e.children.length===0)e.textContent='—';});
        });
        notice('API đang phản hồi. Chưa có API giám sát CPU/GPU, mô hình và dịch vụ.');
    }
    let main;
    let loadingOverlay;
    try {
        // System Monitoring is retired; remove its navigation entry everywhere,
        // including static admin pages that still contain the old template link.
        $$('a[href*="SystemMonitoring.html"]').forEach(link => {
            const separator = link.previousElementSibling;
            if (separator?.classList.contains('w-[1px]')) separator.remove();
            link.remove();
        });
        main=$('main');if(main)main.style.visibility='hidden';
        loadingOverlay=document.createElement('div');
        loadingOverlay.className='workspace-api-loading';
        loadingOverlay.textContent='Loading data…';
        document.body.append(loadingOverlay);
        // Clear sample rows immediately so network failures never look like real data.
        $$('tbody').forEach(body=>{const el=body.closest('table');tableStyles.set(el,$$('tr:first-child td',body).map(c=>c.className));const columns=$$('thead th',el).length;body.replaceChildren();const td=body.insertRow().insertCell();td.colSpan=columns||1;td.className='p-4';td.textContent='Loading data…';});
        user=await AAIR.guard();if(!user){loadingOverlay.remove();if(main)main.style.visibility='visible';return;}window.AAIRGuidelineModal?.init();
        $$('button.manual-navbar__logout, #logoutButton').forEach(button=>bind(button,()=>{if(confirm('Are you sure you want to log out?'))AAIR.logout();}));
        const profile=$('header .hidden.md\\:block');
        if(profile){const ps=$$('p',profile);const roleNames={ADMIN:'Administrator',MANAGER:'Manager',ANALYST:'Analyst',RESULT_ANALYST:'Analyst',AI_LABELER:'AI Labeler',MANUAL_LABELER:'Manual Labeler',REVIEWER:'Reviewer'};if(ps[0])ps[0].textContent=user.username;if(ps[1])ps[1].textContent=roleNames[user.role]||user.role;
            const avatar=profile.previousElementSibling;if(avatar){avatar.replaceChildren();const node=avatarNode(user,'w-full h-full');avatar.append(node);}
            const logout=document.createElement('button');
            logout.type='button';logout.setAttribute('aria-label','Log out');logout.title='Log out of the system';
            logout.className='ml-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/40 bg-white/15 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/70';
            const label=document.createElement('span');label.textContent='Log out';
            logout.append(label);bind(logout,()=>{if(confirm('Are you sure you want to log out?'))AAIR.logout();});
            profile.parentElement.append(logout);
        }
        if(page==='BaseManagement.html')await termsPage();
        else if(page==='Prompt.html')await promptsPage();
        else if(page==='ManagerManagement.html'||page==='UserManagement.html')await usersPage();
        else if(page==='DocumentManagement.html')await documentsPage();
        else if(page==='Session.html')await sessionsPage();
        else if(page==='ViewAll.html')await taskList();
        else if(page==='Task.html'&&document.body.classList.contains('review-page')) await request('/tasks').catch(()=>[]);
        else if(page==='Task.html')await taskPage();
        else if(page==='LogView.html')await logsPage();
        else if(page==='PermissionManagement.html')await permissionsPage();
        else if(page==='Dashboard.html'&&user.role==='RESULT_ANALYST'&&window.AAIRResultAnalysisDashboard)await window.AAIRResultAnalysisDashboard({request,user,notice,go});
        else if(page==='Dashboard.html')await dashboardPage();
        else if(page==='Statistics.html')await statisticsPage();
        else if(page==='SystemMonitoring.html')await monitoringPage();
        if(main)main.style.visibility='visible';
        loadingOverlay?.remove();
    }catch(error){
        loadingOverlay?.remove();
        if(main){
            main.replaceChildren();
            const state=document.createElement('section');state.className='workspace-api-error';
            const message=document.createElement('p');message.textContent=error.message||'Unable to load data.';
            const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.onclick=()=>location.reload();
            state.append(message,retry);main.append(state);main.style.visibility='visible';
        }
        notice(error.message,true);
    }
})();
















