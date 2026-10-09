(function () {
    const html = document.documentElement;
    const bootStartedAt = Number(html.dataset.loadingBootAt || Date.now());
    const MIN_OVERLAY_MS = 520;
    const MAX_WAIT_MS = 2200;
    const SURFACE_SELECTORS = [
        'main > section',
        'main > div',
        'main .metric-card',
        'main .chart-container',
        'main .bg-beige-card',
        'main .bg-surface-light',
        'main .bg-neutral-surface',
        'main .rounded-2xl',
        'main [class*="rounded-["]'
    ];
    const SLOT_CONFIG = [
        { selector: '#timeline-container', minHeight: 420, kind: 'timeline' },
        { selector: '#dreams-cards-container', minHeight: 220, kind: 'cards' },
        { selector: '#obstacle-list', minHeight: 220, kind: 'list' },
        { selector: '#student-dreams', minHeight: 72, kind: 'chips' },
        { selector: '#insight-list', minHeight: 180, kind: 'list' },
        { selector: '#word-cloud-stage', minHeight: 240, kind: 'cards' }
    ];

    function annotateSurfaces() {
        const seen = new Set();
        const surfaces = [];
        SURFACE_SELECTORS.forEach((selector) => {
            try {
                document.querySelectorAll(selector).forEach((el) => {
                    if (seen.has(el)) return;
                    if (el.closest('[data-loading-slot]')) return;
                    seen.add(el);
                    surfaces.push(el);
                });
            } catch (error) {}
        });

        surfaces.slice(0, 24).forEach((el, index) => {
            el.setAttribute('data-loading-surface', '');
            el.style.setProperty('--surface-index', String(index));
        });
    }

    function createSkeleton(kind) {
        if (kind === 'cards') {
            return '<div class="ui-slot-skeleton ui-slot-skeleton--cards" data-skeleton-marker="1"><div class="ui-slot-skeleton__card"></div><div class="ui-slot-skeleton__card"></div></div>';
        }
        if (kind === 'table') {
            return '<div class="ui-slot-skeleton ui-slot-skeleton--table" data-skeleton-marker="1"><div class="ui-slot-skeleton__row"></div><div class="ui-slot-skeleton__row"></div><div class="ui-slot-skeleton__row"></div></div>';
        }
        if (kind === 'timeline') {
            return '<div class="ui-slot-skeleton ui-slot-skeleton--timeline" data-skeleton-marker="1"><div class="ui-slot-skeleton__row"></div><div class="ui-slot-skeleton__row"></div><div class="ui-slot-skeleton__row"></div></div>';
        }
        if (kind === 'chips') {
            return '<div class="ui-slot-skeleton" data-skeleton-marker="1"><div class="ui-slot-skeleton__pill"></div></div>';
        }
        return '<div class="ui-slot-skeleton" data-skeleton-marker="1"><div class="ui-slot-skeleton__row is-medium"></div><div class="ui-slot-skeleton__row"></div><div class="ui-slot-skeleton__row is-short"></div></div>';
    }

    function looksLoaded(el) {
        if (!el) return false;
        if (!el.querySelector('[data-skeleton-marker="1"]')) return true;

        const meaningfulChildren = Array.from(el.children).filter((child) => !child.hasAttribute('data-skeleton-marker') && !child.classList.contains('ui-slot-skeleton'));
        if (meaningfulChildren.length > 0) return true;

        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!text) return false;
        const waitingTokens = ['loading', 'load', 'pending', 'sync', 'refresh'];
        return !waitingTokens.some((token) => text.includes(token));
    }

    function prepareSlots() {
        SLOT_CONFIG.forEach((config) => {
            document.querySelectorAll(config.selector).forEach((el) => {
                el.setAttribute('data-loading-slot', '');
                el.style.setProperty('--slot-min-height', config.minHeight + 'px');
                el.classList.add('is-waiting');
                if (!el.querySelector('[data-skeleton-marker="1"]')) {
                    el.insertAdjacentHTML('afterbegin', createSkeleton(config.kind));
                }

                const observer = new MutationObserver(() => {
                    if (!looksLoaded(el)) return;
                    el.classList.remove('is-waiting');
                    el.classList.add('is-loaded');
                    el.querySelectorAll('[data-skeleton-marker="1"]').forEach((node) => node.remove());
                    observer.disconnect();
                });
                observer.observe(el, { childList: true, subtree: true, characterData: true });

                setTimeout(() => {
                    if (!looksLoaded(el)) return;
                    el.classList.remove('is-waiting');
                    el.classList.add('is-loaded');
                    el.querySelectorAll('[data-skeleton-marker="1"]').forEach((node) => node.remove());
                    observer.disconnect();
                }, MAX_WAIT_MS);
            });
        });
    }

    function whenWindowLoaded() {
        return new Promise((resolve) => {
            if (document.readyState === 'complete') {
                resolve();
                return;
            }
            window.addEventListener('load', resolve, { once: true });
        });
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function finishShell() {
        const elapsed = Date.now() - bootStartedAt;
        const remaining = Math.max(0, MIN_OVERLAY_MS - elapsed);
        return wait(remaining).then(() => {
            html.classList.remove('ui-shell-pending');
            html.classList.add('ui-shell-ready');
            document.body.classList.add('ui-page-ready');
            setTimeout(() => html.classList.remove('ui-shell-ready'), 460);
        });
    }

    function init() {
        annotateSurfaces();
        prepareSlots();

        Promise.race([
            whenWindowLoaded(),
            wait(MAX_WAIT_MS)
        ]).then(finishShell);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
