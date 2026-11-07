// Sticky Navigation and Shadow on Scroll
const nav = document.getElementById('top-nav');
if (nav && !document.body.classList.contains('home-page')) window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        nav.classList.add('bg-white/90', 'backdrop-blur-xl', 'shadow-md', 'py-2');
        nav.classList.remove('bg-transparent', 'py-4');
    } else {
        nav.classList.remove('bg-white/90', 'backdrop-blur-xl', 'shadow-md', 'py-2');
        nav.classList.add('bg-transparent', 'py-4');
    }
});

// Scroll Reveal Animation
if ('IntersectionObserver' in window) {
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.reveal').forEach(reveal => {
    revealObserver.observe(reveal);
});
} else {
    document.querySelectorAll('.reveal').forEach(reveal => reveal.classList.add('active'));
}

// Micro-interaction for buttons
if (!document.body.classList.contains('home-page')) document.querySelectorAll('button, a').forEach(el => {
    el.addEventListener('mousedown', () => el.classList.add('scale-95'));
    el.addEventListener('mouseup', () => el.classList.remove('scale-95'));
    el.addEventListener('mouseleave', () => el.classList.remove('scale-95'));
});

// Enhance the Home header with keyboard-accessible mobile navigation.
const homeMenu = document.getElementById('homeMenuToggle');
if (homeMenu && nav) {
    document.body.classList.add('has-home-menu');
    const setMenu = open => {
        nav.classList.toggle('is-menu-open', open);
        homeMenu.setAttribute('aria-expanded', String(open));
        homeMenu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    };
    homeMenu.addEventListener('click', () => setMenu(!nav.classList.contains('is-menu-open')));
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
    document.addEventListener('click', event => { if (!nav.contains(event.target)) setMenu(false); });
    nav.addEventListener('keydown', event => {
        if (event.key === 'Escape' && nav.classList.contains('is-menu-open')) {
            setMenu(false); homeMenu.focus();
        }
    });
}
const homeYear = document.getElementById('homeYear');
if (homeYear) homeYear.textContent = String(new Date().getFullYear());

// Track section positions so navigation also follows keyboard and manual scrolling.
if (document.body.classList.contains('home-page') && nav) {
    const sectionLinks = [...nav.querySelectorAll('a[href^="#"]')];
    const sections = sectionLinks.map(link => document.getElementById(link.hash.slice(1)));
    let pendingFrame = null;
    const updateSection = () => {
        pendingFrame = null;
        const activationLine = nav.offsetHeight + 96;
        let activeIndex = -1;
        sections.forEach((section, index) => {
            if (section && section.getBoundingClientRect().top <= activationLine) activeIndex = index;
        });
        sectionLinks.forEach((link, index) => {
            if (index === activeIndex) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    };
    const scheduleUpdate = () => {
        if (pendingFrame === null) pendingFrame = requestAnimationFrame(updateSection);
    };
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    updateSection();
}


// Interactive team category filtering
const teamFilterButtons = document.querySelectorAll('.team-filter-btn');
const teamCards = document.querySelectorAll('.team-card, .team-director-card');

if (teamFilterButtons.length && teamCards.length) {
    teamFilterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;
            teamFilterButtons.forEach(b => {
                const isActive = b === btn;
                b.classList.toggle('is-active', isActive);
                b.setAttribute('aria-selected', String(isActive));
            });
            teamCards.forEach(card => {
                const cats = (card.dataset.category || '').split(/\s+/);
                const match = filter === 'all' || cats.includes(filter);
                card.style.display = match ? '' : 'none';
            });
        });
    });
}


// Toggle view more members
const teamToggleMoreBtn = document.getElementById('teamToggleMoreBtn');
if (teamToggleMoreBtn) {
    const extraCards = document.querySelectorAll('.team-card-extra');
    teamToggleMoreBtn.addEventListener('click', () => {
        const isExpanded = teamToggleMoreBtn.getAttribute('aria-expanded') === 'true';
        const willExpand = !isExpanded;
        extraCards.forEach(card => card.classList.toggle('is-expanded', willExpand));
        teamToggleMoreBtn.setAttribute('aria-expanded', String(willExpand));
        const textSpan = teamToggleMoreBtn.querySelector('.team-toggle-text');
        const arrowSpan = teamToggleMoreBtn.querySelector('.team-toggle-arrow');
        if (textSpan) textSpan.textContent = willExpand ? 'Show less' : `View all members (${extraCards.length + 3})`;
        if (arrowSpan) arrowSpan.textContent = willExpand ? '↑' : '↓';
    });
}
