window.AAIRManualNavbar = (() => {
  function roleLabel(role) {
    const labels = {
      ADMIN: 'Administrator', MANAGER: 'Manager', USER: 'User',
      AI_LABELER: 'AI Labeler', MANUAL_LABELER: 'Manual Labeler',
      REVIEWER: 'Reviewer', RESULT_ANALYST: 'Result Analyst', TERMINOLOGY: 'Terminology'
    };
    return labels[String(role || 'MANUAL_LABELER').toUpperCase()] || 'User';
  }
  async function init() {
    const mount = document.querySelector('[data-manual-navbar-mount]');
    if (!mount) return;
    const source = new URL('../HTML/User/ManualLabeling/navbar.html', document.currentScript?.src || location.href);
    const response = await fetch(source);
    if (!response.ok) throw new Error('Unable to load the shared header.');
    mount.innerHTML = await response.text();
    const header = mount.querySelector('[data-manual-navbar]');
    const page = location.pathname.split('/').pop() || 'Dashboard.html';
    header.querySelectorAll('[data-page]').forEach(link => link.classList.toggle('is-active', link.dataset.page === page));
    header.querySelector('[data-manual-logout]').addEventListener('click', () => {
      if (confirm('Are you sure you want to log out?')) window.AAIR?.logout();
    });
    try {
      const user = await window.AAIR?.guard();
      if (!user) return;
      const username = user.username || 'User';
      header.querySelector('[data-manual-avatar]').textContent = username.slice(0, 2).toUpperCase();
      header.querySelector('[data-manual-username]').textContent = username;
      header.querySelector('[data-manual-role]').textContent = roleLabel(user.role);
    } catch { /* API guard owns login redirect and errors. */ }
  }
  const ready = init();
  return { ready };
})();
