(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

  function showMissingDialog(items, title = 'Cannot complete yet') {
    document.querySelector('.session-completion-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'session-completion-dialog';
    overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="completionDialogTitle">
      <header><span class="material-symbols-outlined">warning</span><div><strong id="completionDialogTitle">${escapeHtml(title)}</strong><small>Resolve the items below and try again.</small></div></header>
      <div class="session-completion-dialog__list">${items.map(item => {
        const detail = Array.isArray(item.detail) ? item.detail : [item.detail].filter(Boolean);
        return `<article><span class="material-symbols-outlined">picture_as_pdf</span><div><b>${escapeHtml(item.fileName)}</b><p>${detail.length ? escapeHtml(detail.join(', ')) : 'Incomplete'}</p></div></article>`;
      }).join('')}</div>
      <footer><button type="button">Understood</button></footer>
    </section>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('button').addEventListener('click', close);
    document.body.append(overlay);
    overlay.querySelector('button').focus();
  }

  function create({ button, loadStatus, findItem, onStatus, blockedTitle = 'Not all documents are complete' }) {
    let status = { allDone:false, documents:[], missingItems:[] };
    const paint = next => {
      status = next || status;
      for (const documentStatus of status.documents || []) {
        const item = findItem?.(documentStatus);
        item?.querySelector('.session-completion-dot')?.remove();
      }
      if (button) {
        const blocked = !status.allDone;
        const blockedMessage = typeof blockedTitle === 'function' ? blockedTitle(status) : blockedTitle;
        button.classList.toggle('session-submit-blocked', blocked);
        const terminal = button.dataset.terminalState === 'true';
        button.setAttribute('aria-disabled', String(blocked || terminal));
        button.title = terminal ? 'This task is read-only and waiting for review.' : blocked ? blockedMessage : '';
        button.disabled = terminal;
        let helper = button.parentElement?.querySelector('[data-session-completion-help]');
        if (!helper) {
          helper = document.createElement('span');
          helper.dataset.sessionCompletionHelp = 'true';
          helper.className = 'session-completion-help';
          button.parentElement?.append(helper);
        }
        helper.textContent = terminal ? button.title : blocked ? blockedMessage : '';
        helper.hidden = !(blocked || terminal);
        helper.id ||= `${button.id || 'session'}CompletionHelp`;
        button.setAttribute('aria-describedby', helper.id);
      }
      onStatus?.(status);
      return status;
    };
    const refresh = async () => paint(await loadStatus());
    const ensure = async title => {
      const fresh = await refresh();
      if (fresh.allDone) return true;
      const fallbackTitle = typeof blockedTitle === 'function' ? blockedTitle(fresh) : blockedTitle;
      showMissingDialog(fresh.missingItems || [], title || fallbackTitle);
      return false;
    };
    return { refresh, ensure, paint, get status() { return status; } };
  }

  window.AAIR = window.AAIR || {};
  window.AAIR.SessionCompletion = { create, showMissingDialog };
})();
