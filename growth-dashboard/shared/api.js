/**
 * API Configuration
 * 鍔ㄦ€佽幏鍙?API 鍦板潃锛屾敮鎸佸鐜閮ㄧ讲
 */

/**
 * 鍔ㄦ€佽幏鍙?API 鍩虹 URL
 * 浼樺厛绾э細
 * 1. window.API_CONFIG.baseUrl (杩愯鏃堕厤缃?
 * 2. window.location.origin (鍚屾簮閮ㄧ讲)
 * 3. 寮€鍙戠幆澧冨洖閫€ (localhost:3003)
 */
const getApiBaseUrl = () => {
    if (typeof window !== 'undefined' && window.API_CONFIG?.baseUrl) {
        return window.API_CONFIG.baseUrl;
    }

    if (typeof window !== 'undefined' && window.location) {
        const { protocol, hostname, port, origin } = window.location;
        const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

        if (isLocalHost && port && port !== '3003') {
            return `${protocol}//${hostname}:3003`;
        }

        if (origin && origin !== 'null' && !origin.includes('file://')) {
            return origin;
        }
    }

    return 'http://localhost:3003';
};

const API_BASE_URL = getApiBaseUrl();

/**
 * 閰嶇疆 API (渚涘閮ㄨ皟鐢?
 * @param {Object} config - 閰嶇疆瀵硅薄
 * @param {string} config.baseUrl - API 鍩虹 URL
 */
window.configureApi = (config) => {
    window.API_CONFIG = window.API_CONFIG || {};
    Object.assign(window.API_CONFIG, config);
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeTextToHtml(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function buildApiUrl(path = '') {
    const safePath = String(path || '').trim();
    if (!safePath) return API_BASE_URL;
    if (/^(https?:)?\/\//i.test(safePath)) return safePath;
    return safePath.startsWith('/') ? `${API_BASE_URL}${safePath}` : `${API_BASE_URL}/${safePath}`;
}

function buildMediaUrl(path = '') {
    const safePath = String(path || '').trim();
    if (!safePath) return '';
    if (/^(https?:)?\/\//i.test(safePath) || safePath.startsWith('data:') || safePath.startsWith('blob:')) {
        return safePath;
    }
    return buildApiUrl(safePath);
}

function getAccessTokenSafe() {
    try {
        return localStorage ? localStorage.getItem('sb-access-token') : null;
    } catch (error) {
        return null;
    }
}

function getJsonAuthHeaders(extraHeaders = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...extraHeaders
    };
    const token = getAccessTokenSafe();
    if (token && !headers.Authorization) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

function ensureFallbackToastContainer() {
    if (typeof document === 'undefined') return null;

    let container = document.getElementById('fallback-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'fallback-toast-container';
        container.className = 'fixed top-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none';
        document.body.appendChild(container);
    }
    return container;
}

function showFallbackToast(message, type = 'info', duration = 2200) {
    const container = ensureFallbackToastContainer();
    if (!container) return;

    const colorMap = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-slate-700'
    };

    const toast = document.createElement('div');
    toast.className = `${colorMap[type] || colorMap.info} text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg opacity-0 translate-y-[-6px] transition-all duration-200`;
    toast.textContent = String(message || '操作完成');
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-y-[-6px]');
        toast.classList.add('opacity-100', 'translate-y-0');
    });

    setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-[-6px]');
        setTimeout(() => toast.remove(), 220);
    }, Math.max(1200, Number(duration) || 2200));
}

if (typeof window !== 'undefined' && typeof window.showPageToast !== 'function') {
    window.showPageToast = showFallbackToast;
}

let confirmDialogResolver = null;
let lastConfirmFocusedElement = null;

function ensureConfirmDialog() {
    if (typeof document === 'undefined') return null;

    let dialog = document.getElementById('global-confirm-dialog');
    if (dialog) return dialog;

    dialog = document.createElement('div');
    dialog.id = 'global-confirm-dialog';
    dialog.className = 'fixed inset-0 z-[10000] hidden items-center justify-center px-4';
    dialog.innerHTML = `
        <div data-confirm-backdrop class="absolute inset-0 bg-black/45 backdrop-blur-[2px]"></div>
        <div class="relative w-full max-w-md rounded-[1.5rem] border border-[#efebe0] bg-white p-6 shadow-[0_25px_80px_-24px_rgba(0,0,0,0.35)]">
            <div class="flex items-start gap-3">
                <div class="mt-0.5 flex h-11 w-11 items-center justify-center rounded-full bg-[#fff4e6] text-[#d97706]">
                    <span class="material-icons-round text-[22px]">help</span>
                </div>
                <div class="min-w-0 flex-1">
                    <h3 data-confirm-title class="text-lg font-bold text-[#3d3327]">确认操作</h3>
                    <p data-confirm-message class="mt-2 text-sm leading-6 text-[#6b5f50]">请确认是否继续。</p>
                </div>
            </div>
            <div class="mt-6 flex justify-end gap-3">
                <button type="button" data-confirm-cancel class="rounded-full border border-[#eadfcb] px-4 py-2 text-sm font-semibold text-[#7a6d5f] transition hover:bg-[#faf5ec] focus:outline-none focus:ring-2 focus:ring-[#f0c48f]">
                    取消
                </button>
                <button type="button" data-confirm-accept class="rounded-full bg-[#ef8f32] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#df7f22] focus:outline-none focus:ring-2 focus:ring-[#f0c48f]">
                    确认
                </button>
            </div>
        </div>
    `;

    const cleanup = (result) => {
        dialog.classList.add('hidden');
        dialog.classList.remove('flex');
        document.body.classList.remove('overflow-hidden');
        const resolver = confirmDialogResolver;
        confirmDialogResolver = null;
        if (lastConfirmFocusedElement && typeof lastConfirmFocusedElement.focus === 'function') {
            lastConfirmFocusedElement.focus();
        }
        lastConfirmFocusedElement = null;
        if (typeof resolver === 'function') {
            resolver(Boolean(result));
        }
    };

    dialog.querySelector('[data-confirm-backdrop]')?.addEventListener('click', () => cleanup(false));
    dialog.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => cleanup(false));
    dialog.querySelector('[data-confirm-accept]')?.addEventListener('click', () => cleanup(true));

    dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            cleanup(false);
        }
    });

    document.body.appendChild(dialog);
    return dialog;
}

function showConfirmDialog(options = {}) {
    const dialog = ensureConfirmDialog();
    if (!dialog) return Promise.resolve(false);

    if (typeof confirmDialogResolver === 'function') {
        confirmDialogResolver(false);
    }

    const title = String(options.title || '确认操作').trim() || '确认操作';
    const message = String(options.message || options.text || '请确认是否继续。').trim() || '请确认是否继续。';
    const confirmText = String(options.confirmText || '确认').trim() || '确认';
    const cancelText = String(options.cancelText || '取消').trim() || '取消';

    const titleEl = dialog.querySelector('[data-confirm-title]');
    const messageEl = dialog.querySelector('[data-confirm-message]');
    const cancelBtn = dialog.querySelector('[data-confirm-cancel]');
    const acceptBtn = dialog.querySelector('[data-confirm-accept]');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (cancelBtn) cancelBtn.textContent = cancelText;
    if (acceptBtn) acceptBtn.textContent = confirmText;

    lastConfirmFocusedElement = document.activeElement;
    dialog.classList.remove('hidden');
    dialog.classList.add('flex');
    document.body.classList.add('overflow-hidden');

    setTimeout(() => {
        acceptBtn?.focus();
    }, 0);

    return new Promise((resolve) => {
        confirmDialogResolver = resolve;
    });
}

function clearAuthAndRedirect() {
    try {
        localStorage.removeItem('sb-access-token');
        localStorage.removeItem('sb-refresh-token');
        localStorage.removeItem('user');
        localStorage.removeItem('user-role');
    } catch (e) {}
    if (typeof window.showPageToast === 'function') {
        window.showPageToast('登录已过期，请重新登录', 'error', 1400);
    }
    window.setTimeout(() => {
        window.location.href = '../index.html';
    }, 180);
}

function decodeJwtPayloadSafe(token) {
    try {
        const payloadPart = String(token || '').split('.')[1];
        if (!payloadPart) return null;
        const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        return JSON.parse(atob(padded));
    } catch (error) {
        console.warn('Decode JWT payload failed:', error);
        return null;
    }
}

function getStoredUserSafe() {
    try {
        const userStr = localStorage.getItem('user');
        if (!userStr) return null;
        return JSON.parse(userStr);
    } catch (error) {
        console.warn('Parse localStorage user failed:', error);
        return null;
    }
}

function getSessionUserId() {
    const user = getStoredUserSafe();
    const fromUser = String(user?.id || '').trim();
    if (fromUser) return fromUser;

    const token = getAccessTokenSafe();
    if (!token) return null;

    const payload = decodeJwtPayloadSafe(token);
    const fromToken = String(payload?.sub || payload?.user_id || '').trim();
    return fromToken || null;
}

function hasActiveSession() {
    return Boolean(getSessionUserId() || getAccessTokenSafe());
}

const TEACHER_PAGE_TRANSITION_KEY = '__teacher_page_transition__';

function isTeacherPagePath() {
    const pathName = String(window.location?.pathname || '').toLowerCase();
    return pathName.includes('/teacher/');
}

function ensureTeacherNavigationStyles() {
    if (typeof document === 'undefined' || document.getElementById('teacher-navigation-effects-style')) return;

    const style = document.createElement('style');
    style.id = 'teacher-navigation-effects-style';
    style.textContent = `
        html.teacher-icons-pending .material-icons,
        html.teacher-icons-pending .material-icons-round,
        html.teacher-icons-pending .material-symbols-outlined {
            opacity: 0;
        }

        html.teacher-icons-ready .material-icons,
        html.teacher-icons-ready .material-icons-round,
        html.teacher-icons-ready .material-symbols-outlined {
            opacity: 1;
            transition: opacity .18s ease;
        }

        body.teacher-page-enter {
            opacity: 0;
            transform: translateY(8px);
        }

        body.teacher-page-enter.teacher-page-enter-active {
            opacity: 1;
            transform: translateY(0);
            transition: opacity .26s ease, transform .26s ease;
        }

        body.teacher-page-leave {
            opacity: 0;
            transform: translateY(8px);
            transition: opacity .18s ease, transform .18s ease;
        }

        @media (prefers-reduced-motion: reduce) {
            html.teacher-icons-ready .material-icons,
            html.teacher-icons-ready .material-icons-round,
            html.teacher-icons-ready .material-symbols-outlined,
            body.teacher-page-enter.teacher-page-enter-active,
            body.teacher-page-leave {
                transition: none;
            }
        }
    `;
    document.head.appendChild(style);
}

function markTeacherIconsReady() {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.classList.remove('teacher-icons-pending');
    html.classList.add('teacher-icons-ready');
}

function initTeacherIconLoadingGuard() {
    if (typeof window === 'undefined' || !isTeacherPagePath()) return;

    ensureTeacherNavigationStyles();
    document.documentElement.classList.add('teacher-icons-pending');

    const fallbackTimer = new Promise((resolve) => setTimeout(resolve, 1200));
    if (document.fonts && typeof document.fonts.load === 'function') {
        Promise.race([
            Promise.all([
                document.fonts.load('24px Material Icons'),
                document.fonts.load('24px Material Icons Round'),
                document.fonts.load('24px Material Symbols Outlined')
            ]),
            fallbackTimer
        ]).finally(markTeacherIconsReady);
        return;
    }

    if (document.readyState === 'complete') {
        markTeacherIconsReady();
    } else {
        window.addEventListener('load', markTeacherIconsReady, { once: true });
    }
}

function playTeacherPageEnterTransitionIfNeeded() {
    if (typeof window === 'undefined' || !isTeacherPagePath()) return;

    let shouldAnimate = false;
    try {
        shouldAnimate = sessionStorage.getItem(TEACHER_PAGE_TRANSITION_KEY) === '1';
        if (shouldAnimate) sessionStorage.removeItem(TEACHER_PAGE_TRANSITION_KEY);
    } catch (error) {
        shouldAnimate = false;
    }
    if (!shouldAnimate) return;

    const run = () => {
        const body = document.body;
        if (!body) return;
        body.classList.add('teacher-page-enter');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                body.classList.add('teacher-page-enter-active');
            });
        });
        setTimeout(() => {
            body.classList.remove('teacher-page-enter', 'teacher-page-enter-active');
        }, 320);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
}

function tryNavigateWithTeacherTransition(path, useReplace) {
    if (typeof window === 'undefined' || !isTeacherPagePath()) return false;
    const body = document.body;
    if (!body) return false;

    try {
        sessionStorage.setItem(TEACHER_PAGE_TRANSITION_KEY, '1');
    } catch (error) {}

    body.classList.add('teacher-page-leave');
    window.setTimeout(() => {
        if (useReplace) {
            window.location.replace(path);
            return;
        }
        window.location.href = path;
    }, 170);
    return true;
}

const TEACHER_ROUTE_PATTERNS = [
    /^dashboard\.html(?:\?.*)?$/,
    /^analytics\.html(?:\?.*)?$/,
    /^students\.html(?:\?.*)?$/,
    /^student-profile\.html\?id=[^\s]+$/,
    /^submissions\.html(?:\?.*)?$/,
    /^settings\.html(?:\?.*)?$/,
    /^\.\.\/index\.html$/
];

function isAllowedTeacherRoute(path) {
    const safePath = String(path || '').trim();
    if (!safePath) return false;
    return TEACHER_ROUTE_PATTERNS.some((pattern) => pattern.test(safePath));
}

function navigateTeacher(path, options = {}) {
    const fallback = String(options.fallback || 'dashboard.html');
    const safePath = isAllowedTeacherRoute(path) ? String(path).trim() : fallback;
    const useReplace = Boolean(options.replace);
    const useTransition = options.animate !== false;

    if (useTransition && tryNavigateWithTeacherTransition(safePath, useReplace)) {
        return;
    }

    if (useReplace) {
        window.location.replace(safePath);
        return;
    }
    window.location.href = safePath;
}

function bindTeacherNavigation(root = document) {
    if (!root || root.__teacherNavigationBound) return;
    root.__teacherNavigationBound = true;

    root.addEventListener('click', (event) => {
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const target = event.target?.closest?.('[data-teacher-nav]');
        if (target) {
            const path = target.getAttribute('data-teacher-nav');
            if (!path) return;

            const replace = target.getAttribute('data-teacher-nav-replace') === 'true';
            event.preventDefault();
            navigateTeacher(path, { replace });
            return;
        }

        const anchor = event.target?.closest?.('a[href]');
        if (!anchor) return;
        if (anchor.target && anchor.target !== '_self') return;
        if (anchor.hasAttribute('download')) return;

        const href = String(anchor.getAttribute('href') || '').trim();
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        if (!isAllowedTeacherRoute(href)) return;

        event.preventDefault();
        navigateTeacher(href);
    });
}

function normalizeTeacherHeaderLayer(root = document) {
    if (!root || typeof window === 'undefined') return;

    const pathName = String(window.location?.pathname || '').toLowerCase();
    if (!pathName.includes('/teacher/')) return;

    const header = root.querySelector('[data-teacher-header="true"]')
        || root.querySelector('main > header.sticky')
        || root.querySelector('main header.sticky');
    if (!header) return;

    header.classList.remove('z-10', 'bg-background-light/90', 'dark:bg-background-dark/90', 'backdrop-blur-sm');
    header.classList.add('z-50', 'bg-background-light', 'dark:bg-background-dark');
}

function getTeacherTimeGreetingPrefix() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return '早上好';
    if (hour >= 11 && hour < 14) return '中午好';
    if (hour >= 14 && hour < 18) return '下午好';
    return '晚上好';
}

function buildTeacherAvatarFallback(userId, displayName = '老师') {
    const seed = String(displayName || userId || 'teacher').slice(0, 24);
    return `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=e6dac6`;
}

async function fetchTeacherIdentity(teacherId) {
    const safeTeacherId = String(teacherId || '').trim();
    if (!safeTeacherId) return { profile: null, classInfo: null };

    try {
        const [profileRes, classRes] = await Promise.all([
            apiFetch(API_BASE_URL + `/api/teacher/${encodeURIComponent(safeTeacherId)}/profile`),
            apiFetch(API_BASE_URL + `/api/teacher/${encodeURIComponent(safeTeacherId)}/class`)
        ]);

        let profile = null;
        let classInfo = null;

        if (profileRes.ok) {
            profile = await profileRes.json().catch(() => null);
        }
        if (classRes.ok) {
            classInfo = await classRes.json().catch(() => null);
        }

        return { profile, classInfo };
    } catch (error) {
        console.error('Fetch teacher identity failed:', error);
        return { profile: null, classInfo: null };
    }
}

function applyTeacherIdentityToPage(identity = {}, options = {}) {
    const user = options.user || getStoredUserSafe() || {};
    const teacherId = String(options.teacherId || getSessionUserId() || '').trim();
    const profile = identity.profile || {};
    const classInfo = identity.classInfo || {};

    const displayName = String(profile.full_name || user?.user_metadata?.full_name || user?.full_name || '').trim() || '老师';
    const schoolName = String(classInfo.school_name || profile.school_name || '').trim();
    const className = String(classInfo.name || profile.class_name || '').trim();
    const classDisplay = schoolName && className ? `${schoolName} · ${className}` : (className || schoolName || '教师工作台');

    const greetingEl = options.greetingElementId ? document.getElementById(options.greetingElementId) : null;
    if (greetingEl) {
        greetingEl.textContent = `${getTeacherTimeGreetingPrefix()}, ${displayName} \u{1F44B}`;
    }

    const subtitleEl = options.subtitleElementId ? document.getElementById(options.subtitleElementId) : null;
    if (subtitleEl) {
        const suffix = String(options.subtitleSuffix || '').trim();
        subtitleEl.textContent = suffix ? `${classDisplay} 路 ${suffix}` : classDisplay;
    }

    const brandContextEl = options.brandContextElementId ? document.getElementById(options.brandContextElementId) : null;
    if (brandContextEl) {
        brandContextEl.textContent = className || '教师工作台';
    }

    const nameEl = options.nameElementId ? document.getElementById(options.nameElementId) : null;
    if (nameEl) {
        nameEl.textContent = displayName;
    }

    const avatarEl = options.avatarElementId ? document.getElementById(options.avatarElementId) : null;
    if (avatarEl) {
        const avatarUrl = String(profile.avatar_url || user?.user_metadata?.avatar_url || '').trim();
        const fallback = buildTeacherAvatarFallback(teacherId, displayName);
        avatarEl.src = avatarUrl || fallback;
        avatarEl.alt = `${displayName}澶村儚`;
        avatarEl.onerror = () => {
            avatarEl.onerror = null;
            avatarEl.src = fallback;
        };
    }

    return { displayName, classDisplay, profile, classInfo };
}

async function hydrateTeacherIdentity(options = {}) {
    const teacherId = String(options.teacherId || getSessionUserId() || '').trim();
    if (!teacherId) return null;
    const identity = await fetchTeacherIdentity(teacherId);
    applyTeacherIdentityToPage(identity, { ...options, teacherId });
    return identity;
}

window.getStoredUserSafe = getStoredUserSafe;
window.getSessionUserId = getSessionUserId;
window.hasActiveSession = hasActiveSession;
window.isAllowedTeacherRoute = isAllowedTeacherRoute;
window.navigateTeacher = navigateTeacher;
window.bindTeacherNavigation = bindTeacherNavigation;
window.normalizeTeacherHeaderLayer = normalizeTeacherHeaderLayer;
window.fetchTeacherIdentity = fetchTeacherIdentity;
window.applyTeacherIdentityToPage = applyTeacherIdentityToPage;
window.hydrateTeacherIdentity = hydrateTeacherIdentity;

if (typeof document !== 'undefined') {
    initTeacherIconLoadingGuard();
    playTeacherPageEnterTransitionIfNeeded();
    bindTeacherNavigation(document);
    normalizeTeacherHeaderLayer(document);
}

async function apiFetch(url, options = {}) {
    const token = getAccessTokenSafe();
    if (!options.headers) {
        options.headers = {};
    }
    if (token) {
        options.headers.Authorization = 'Bearer ' + token;
    }

    const response = await fetch(url, options);

    // Handle expired token
    if (response.status === 401) {
        try {
            const data = await response.clone().json();
            const errorMsg = (data.error || '').toLowerCase();
            if (errorMsg.includes('杩囨湡') || errorMsg.includes('expired') ||
                errorMsg.includes('invalid') || errorMsg.includes('unauthorized')) {
                clearAuthAndRedirect();
            }
        } catch (e) {}
    }

    return response;
}

// ============================================
// API Helper Functions
// ============================================

/**
 * 璺ㄩ〉闈?Summary 缂撳瓨
 * 閬垮厤姣忎釜椤甸潰閮介噸澶嶈姹?/api/student/{id}/summary
 * 浣跨敤 sessionStorage锛孴TL 5 鍒嗛挓
 */
const SUMMARY_CACHE_TTL = 5 * 60 * 1000;

async function getCachedSummary(userId) {
    if (!userId) return null;
    const cacheKey = `summary_cache_${userId}`;
    try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
            const cached = JSON.parse(raw);
            if (Date.now() - cached.ts < SUMMARY_CACHE_TTL) {
                return cached.data;
            }
            sessionStorage.removeItem(cacheKey);
        }
    } catch (_) {}

    // Cache miss 鈥?fetch from API
    try {
        const res = await apiFetch(API_BASE_URL + `/api/student/${encodeURIComponent(userId)}/summary`);
        if (!res.ok) return null;
        const data = await res.json();
        try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
        } catch (_) {}
        return data;
    } catch (_) {
        return null;
    }
}

function invalidateSummaryCache(userId) {
    if (!userId) return;
    try { sessionStorage.removeItem(`summary_cache_${userId}`); } catch (_) {}
}

window.getCachedSummary = getCachedSummary;
window.invalidateSummaryCache = invalidateSummaryCache;

async function apiGet(endpoint) {
    const response = await apiFetch(buildApiUrl(endpoint));
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Request failed');
    }
    return response.json();
}

async function apiPost(endpoint, data) {
    const response = await apiFetch(buildApiUrl(endpoint), {
        method: 'POST',
        headers: getJsonAuthHeaders(),
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Request failed');
    }
    return response.json();
}

window.API_BASE_URL = API_BASE_URL;
window.apiFetch = apiFetch;
window.apiGet = apiGet;
window.apiPost = apiPost;
window.buildApiUrl = buildApiUrl;
window.buildMediaUrl = buildMediaUrl;
window.escapeHtml = escapeHtml;
window.safeTextToHtml = safeTextToHtml;
window.getAccessTokenSafe = getAccessTokenSafe;
window.getJsonAuthHeaders = getJsonAuthHeaders;
window.showConfirmDialog = showConfirmDialog;
window.confirmAsync = (message, options = {}) => showConfirmDialog({ ...options, message });
