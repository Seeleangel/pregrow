class StudentSidebar extends HTMLElement {
    connectedCallback() {
        const currentPath = window.location.pathname;
        this.innerHTML = `
        <aside class="w-64 bg-surface-light dark:bg-surface-dark border-r border-[#efebe0] dark:border-[#4a4238] hidden md:flex flex-col z-20">
            <div class="p-6">
                <div class="flex items-center gap-3 text-primary-dark dark:text-primary">
                    <span class="material-icons-round text-3xl">psychology</span>
                    <span class="text-2xl font-bold font-display tracking-wide">Pregrow</span>
                </div>
            </div>
            <nav class="flex-1 px-4 space-y-2 mt-4">
                <a class="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 ${currentPath.includes('dashboard.html') ? 'bg-primary/10 text-primary-dark dark:bg-primary/20 dark:text-primary font-bold' : 'text-text-sub hover:bg-neutral-warm dark:hover:bg-white/5'}" href="dashboard.html">
                    <span class="material-icons-round">dashboard</span>
                    我的主页
                </a>
                <a class="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 ${currentPath.includes('portfolio.html') ? 'bg-primary/10 text-primary-dark dark:bg-primary/20 dark:text-primary font-bold' : 'text-text-sub hover:bg-neutral-warm dark:hover:bg-white/5'}" href="portfolio.html">
                    <span class="material-icons-round">auto_awesome</span>
                    期待档案
                </a>
                <a class="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 ${currentPath.includes('growth.html') ? 'bg-primary/10 text-primary-dark dark:bg-primary/20 dark:text-primary font-bold' : 'text-text-sub hover:bg-neutral-warm dark:hover:bg-white/5'}" href="growth.html">
                    <span class="material-icons-round">timeline</span>
                    成长足迹
                </a>
                <a class="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 ${currentPath.includes('challenge.html') ? 'bg-primary/10 text-primary-dark dark:bg-primary/20 dark:text-primary font-bold' : 'text-text-sub hover:bg-neutral-warm dark:hover:bg-white/5'}" href="challenge.html">
                    <span class="material-icons-round">extension</span>
                    乐观挑战
                </a>
                <a class="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 ${currentPath.includes('profile.html') ? 'bg-primary/10 text-primary-dark dark:bg-primary/20 dark:text-primary font-bold' : 'text-text-sub hover:bg-neutral-warm dark:hover:bg-white/5'}" href="profile.html">
                    <span class="material-icons-round">person</span>
                    个人信息
                </a>
            </nav>
            <div class="p-4 mb-6">
                <div class="bg-gradient-to-br from-[#fffdf8] to-[#f4eee1] dark:from-surface-dark dark:to-background-dark p-4 rounded-2xl border border-warm-border/50 text-center relative overflow-hidden">
                    <div class="absolute -right-4 -top-4 text-primary/10">
                        <span class="material-icons-round" style="font-size: 80px;">eco</span>
                    </div>
                    <p class="text-xs text-text-sub mb-3 relative z-10 font-medium">需要重新登录？</p>
                    <button onclick="localStorage.removeItem('user'); localStorage.removeItem('sb-access-token'); window.location.href='../index.html'" class="w-full py-2.5 rounded-xl bg-white dark:bg-gray-800 text-red-500 font-bold text-sm shadow-sm border border-red-100 dark:border-red-900/30 hover:bg-red-50 transition-colors relative z-10 flex items-center justify-center gap-2">
                        <span class="material-icons-round text-sm">logout</span> 退出账号
                    </button>
                </div>
            </div>
        </aside>
        `;
    }
}

// ============================================
// 通知铃铛组件
// ============================================

class NotificationBell extends HTMLElement {
    constructor() {
        super();
        this.unreadCount = 0;
        this.isOpen = false;
        this.notifications = [];
        this.handleOutsideClick = (e) => {
            if (!this.contains(e.target)) {
                this.closeDropdown();
            }
        };
    }

    connectedCallback() {
        this.render();
        this.loadUnreadCount();
        this.refreshTimer = setInterval(() => this.loadUnreadCount(), 30000);
        document.addEventListener('click', this.handleOutsideClick);
    }

    disconnectedCallback() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        document.removeEventListener('click', this.handleOutsideClick);
    }

    render() {
        this.innerHTML = `
        <div class="relative">
            <button id="notification-bell-btn" class="relative p-2.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50">
                <span class="material-icons-round text-text-main dark:text-gray-200">notifications</span>
                <span id="notification-badge" class="absolute top-1.5 right-1.5 min-w-[1rem] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center hidden border-2 border-[#FDF5E6] dark:border-[#2A2A2A] shadow-sm">0</span>
            </button>
            <div id="notification-dropdown" class="absolute right-0 top-full mt-3 w-80 sm:w-96 bg-white dark:bg-surface-dark rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] border border-warm-border/50 dark:border-gray-700 hidden z-50 overflow-hidden transform origin-top-right transition-all duration-200">
                <div class="p-4 border-b border-warm-border/30 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-black/10">
                    <span class="font-bold text-text-main dark:text-white text-base">提醒中心</span>
                    <button id="mark-all-read-btn" class="text-xs font-semibold text-primary hover:text-primary-dark transition-colors px-2 py-1 rounded-md hover:bg-primary/10">全部已读</button>
                </div>
                <div id="notification-list" class="max-h-[360px] overflow-y-auto custom-scrollbar">
                    <div class="p-8 text-center flex flex-col items-center justify-center space-y-3">
                        <div class="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                        <p class="text-sm text-text-sub">正在加载提醒...</p>
                    </div>
                </div>
                <div class="p-3 border-t border-warm-border/30 dark:border-gray-700 bg-gray-50/50 dark:bg-black/10">
                    <button id="close-notification-btn" class="w-full py-2.5 text-sm font-semibold text-text-main dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors">关闭</button>
                </div>
            </div>
        </div>
        `;

        this.querySelector('#notification-bell-btn').addEventListener('click', () => this.toggleDropdown());
        this.querySelector('#mark-all-read-btn').addEventListener('click', () => this.markAllAsRead());
        this.querySelector('#close-notification-btn').addEventListener('click', () => this.closeDropdown());
    }

    async loadUnreadCount() {
        try {
            const response = await apiGet('/api/notifications/unread-count');
            this.unreadCount = response.unread_count || 0;
            this.updateBadge();
        } catch (error) {
            console.error('Load unread count error:', error);
        }
    }

    updateBadge() {
        const badge = this.querySelector('#notification-badge');
        if (!badge) return;

        if (this.unreadCount > 0) {
            badge.textContent = this.unreadCount > 99 ? '99+' : String(this.unreadCount);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    toggleDropdown() {
        if (this.isOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        this.isOpen = true;
        this.querySelector('#notification-dropdown')?.classList.remove('hidden');
        this.loadNotifications();
    }

    closeDropdown() {
        this.isOpen = false;
        this.querySelector('#notification-dropdown')?.classList.add('hidden');
    }

    async loadNotifications() {
        const listEl = this.querySelector('#notification-list');
        if (!listEl) return;

        try {
            const response = await apiGet('/api/notifications?limit=10');
            const notifications = Array.isArray(response.notifications) ? response.notifications : [];
            this.notifications = notifications;

            if (notifications.length === 0) {
                listEl.innerHTML = `
                    <div class="p-8 text-center flex flex-col items-center justify-center">
                        <div class="w-16 h-16 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center mb-3">
                            <span class="material-icons-round text-gray-400 text-3xl">done_all</span>
                        </div>
                        <p class="text-sm text-text-sub font-medium">暂时还没有新提醒</p>
                    </div>`;
                return;
            }

            listEl.innerHTML = notifications.map((n) => `
                <div class="p-4 border-b border-warm-border/30 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer group ${n.is_read ? 'opacity-60 grayscale-[50%]' : ''}" data-id="${n.id}">
                    <div class="flex items-start gap-4">
                        <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                            <span class="material-icons-round text-primary-dark dark:text-primary text-xl">${this.getIconForType(n.type)}</span>
                        </div>
                        <div class="flex-1 min-w-0 pt-0.5">
                            <div class="flex justify-between items-start mb-1">
                                <p class="text-sm font-bold text-text-main dark:text-white truncate pr-2 ${!n.is_read ? 'text-primary-dark dark:text-primary' : ''}">${this.escapeHtml(n.title)}</p>
                                ${!n.is_read ? '<span class="w-2 h-2 bg-red-500 rounded-full flex-shrink-0 mt-1 shadow-sm"></span>' : ''}
                            </div>
                            ${n.content ? `<p class="text-xs text-text-sub dark:text-gray-400 line-clamp-2 leading-relaxed">${this.escapeHtml(n.content)}</p>` : ''}
                            <p class="text-[11px] text-gray-400 font-medium mt-2">${this.formatTime(n.created_at)}</p>
                        </div>
                    </div>
                </div>
            `).join('');

            listEl.querySelectorAll('[data-id]').forEach((el) => {
                el.addEventListener('click', () => {
                    const item = notifications.find((entry) => String(entry.id) === String(el.dataset.id));
                    this.handleNotificationClick(item);
                });
            });
        } catch (error) {
            console.error('Load notifications error:', error);
            listEl.innerHTML = `
                <div class="p-6 text-center">
                    <span class="material-icons-round text-red-400 text-3xl mb-2">error_outline</span>
                    <p class="text-sm text-red-500 font-medium">提醒加载失败</p>
                    <button onclick="this.closest('notification-bell').loadNotifications()" class="mt-3 text-xs text-primary hover:underline">点击重试</button>
                </div>`;
        }
    }

    async handleNotificationClick(notification) {
        if (!notification) return;

        const data = this.parseNotificationData(notification.data);
        const targetUrl = String(data?.target_url || '').trim();

        if (!notification.is_read) {
            await this.markAsRead(notification.id, false);
        }

        if (targetUrl) {
            window.location.href = targetUrl;
            return;
        }

        this.loadNotifications();
    }

    async markAsRead(id, reloadList = true) {
        try {
            await apiPost(`/api/notifications/${id}/read`, {});
            this.loadUnreadCount();
            if (reloadList) {
                this.loadNotifications();
            }
        } catch (error) {
            console.error('Mark as read error:', error);
        }
    }

    async markAllAsRead() {
        try {
            await apiPost('/api/notifications/read-all', {});
            this.unreadCount = 0;
            this.updateBadge();
            this.loadNotifications();
        } catch (error) {
            console.error('Mark all as read error:', error);
        }
    }

    getIconForType(type) {
        const icons = {
            task_reminder: 'task',
            goal_progress: 'flag',
            goal_completed: 'check_circle',
            badge_earned: 'emoji_events',
            system: 'info',
            class_joined: 'group',
            checkin_reminder: 'event',
            submission_pending: 'assignment',
            review_approved: 'verified',
            review_rejected: 'assignment_late'
        };
        return icons[type] || 'notifications';
    }

    parseNotificationData(raw) {
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch (error) {
            return {};
        }
    }

    formatTime(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes} 分钟前`;
        if (hours < 24) return `${hours} 小时前`;
        if (days < 7) return `${days} 天前`;
        return date.toLocaleDateString('zh-CN');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

customElements.define('notification-bell', NotificationBell);

// ============================================
// 杞绘彁绀?Toast锛堝叏灞€澶嶇敤锛?// ============================================

window.showPageToast = function(message, type = 'info', duration = 2200) {
    const colorMap = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-slate-700'
    };

    let container = document.getElementById('global-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'global-toast-container';
        container.className = 'fixed top-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `${colorMap[type] || colorMap.info} text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg opacity-0 translate-y-[-6px] transition-all duration-200`;
    toast.textContent = String(message || '鎿嶄綔瀹屾垚');
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-y-[-6px]');
        toast.classList.add('opacity-100', 'translate-y-0');
    });

    setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-[-6px]');
        setTimeout(() => {
            toast.remove();
        }, 220);
    }, Math.max(1200, Number(duration) || 2200));
};

// ============================================
// Dream Switcher Component (Multi-Dream Quick Switch)
// ============================================

class DreamSwitcher extends HTMLElement {
    constructor() {
        super();
        this.dreams = [];
        this.currentFocusId = null;
        this.studentId = null;
        this.isOpen = false;
    }

    connectedCallback() {
        this.studentId = this.getAttribute('student-id') || window.currentUserId;
        this.render();
        if (this.studentId) {
            this.loadDreams();
        }
    }

    render() {
        this.innerHTML = `
        <div class="relative">
            <button id="dream-switcher-btn" class="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-surface-dark border border-warm-border/50 dark:border-gray-700 hover:border-primary/50 transition-all shadow-sm">
                <span class="material-icons-round text-primary text-lg">auto_awesome</span>
                <span id="dream-switcher-label" class="text-sm font-bold text-text-main dark:text-white max-w-[120px] truncate">加载中...</span>
                <span class="material-icons-round text-text-sub text-sm transition-transform duration-200" id="dream-switcher-arrow">expand_more</span>
            </button>
            <div id="dream-switcher-dropdown" class="absolute left-0 top-full mt-2 w-64 bg-white dark:bg-surface-dark rounded-2xl shadow-lg border border-warm-border/50 dark:border-gray-700 hidden z-50 overflow-hidden transform origin-top-left transition-all duration-200">
                <div class="p-3 border-b border-warm-border/30 dark:border-gray-700 bg-gray-50/50 dark:bg-black/10">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-text-main dark:text-white text-sm">切换期待</span>
                        <a href="portfolio.html" class="text-xs text-primary hover:text-primary-dark font-medium">管理</a>
                    </div>
                </div>
                <div id="dream-switcher-list" class="max-h-[280px] overflow-y-auto py-1">
                    <div class="p-4 text-center text-sm text-text-sub">加载中...</div>
                </div>
                <div class="p-2 border-t border-warm-border/30 dark:border-gray-700 bg-gray-50/50 dark:bg-black/10">
                    <div class="flex items-center justify-between gap-1">
                        <button id="dream-switcher-prev" class="flex-1 py-1.5 rounded-lg hover:bg-white dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-1 text-xs text-text-sub">
                            <span class="material-icons-round text-sm">chevron_left</span>上一个
                        </button>
                        <button id="dream-switcher-next" class="flex-1 py-1.5 rounded-lg hover:bg-white dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-1 text-xs text-text-sub">
                            下一个<span class="material-icons-round text-sm">chevron_right</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;

        // Bind events
        this.querySelector('#dream-switcher-btn').addEventListener('click', () => this.toggleDropdown());
        this.querySelector('#dream-switcher-prev').addEventListener('click', (e) => {
            e.stopPropagation();
            this.switchToPrev();
        });
        this.querySelector('#dream-switcher-next').addEventListener('click', (e) => {
            e.stopPropagation();
            this.switchToNext();
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!this.contains(e.target)) {
                this.closeDropdown();
            }
        });
    }

    async loadDreams() {
        try {
            const res = await apiFetch(buildApiUrl(`/api/student/${encodeURIComponent(this.studentId)}/dreams/overview`));
            if (!res.ok) throw new Error('Failed to load dreams');

            const data = await res.json();
            this.dreams = data.dreams || [];
            this.currentFocusId = data.current_focus_dream?.id || null;

            this.renderDreamList();
            this.updateLabel();
        } catch (err) {
            console.error('Dream switcher load error:', err);
            this.querySelector('#dream-switcher-label').textContent = '期待';
        }
    }

    renderDreamList() {
        const listEl = this.querySelector('#dream-switcher-list');
        if (!listEl) return;

        if (this.dreams.length === 0) {
            listEl.innerHTML = `
                <div class="p-4 text-center">
                    <p class="text-sm text-text-sub mb-2">还没有填写期待</p>
                    <a href="portfolio.html" class="text-xs text-primary hover:underline">去添加期待</a>
                </div>
            `;
            return;
        }

        const activeDreams = this.dreams.filter(d => d.status === 'active');

        listEl.innerHTML = activeDreams.map(dream => {
            const isFocus = dream.id === this.currentFocusId;
            const progress = dream.progress || 0;

            return `
                <div class="dream-option px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors ${isFocus ? 'bg-purple-50 dark:bg-purple-900/20' : ''}" data-dream-id="${dream.id}">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg ${isFocus ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'} flex items-center justify-center flex-shrink-0">
                            <span class="material-icons-round text-sm">${isFocus ? 'center_focus_strong' : 'radio_button_unchecked'}</span>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium text-text-main dark:text-white truncate ${isFocus ? 'text-purple-700 dark:text-purple-300' : ''}">${window.escapeHtml ? window.escapeHtml(dream.tag) : dream.tag}</p>
                            <div class="flex items-center gap-2">
                                <div class="w-16 h-1 bg-gray-200 rounded-full overflow-hidden">
                                    <div class="h-full ${isFocus ? 'bg-purple-400' : 'bg-primary'} rounded-full" style="width: ${progress}%"></div>
                                </div>
                                <span class="text-[10px] text-text-sub">${progress}%</span>
                            </div>
                        </div>
                        ${dream.priority === 1 ? '<span class="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">重点</span>' : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Bind dream option clicks
        listEl.querySelectorAll('.dream-option').forEach(el => {
            el.addEventListener('click', () => {
                const dreamId = el.getAttribute('data-dream-id');
                this.setFocusDream(dreamId);
            });
        });
    }

    updateLabel() {
        const labelEl = this.querySelector('#dream-switcher-label');
        const currentDream = this.dreams.find(d => d.id === this.currentFocusId);
        labelEl.textContent = currentDream?.tag || '选择期待';
    }

    toggleDropdown() {
        if (this.isOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        this.isOpen = true;
        this.querySelector('#dream-switcher-dropdown').classList.remove('hidden');
        this.querySelector('#dream-switcher-arrow').style.transform = 'rotate(180deg)';
    }

    closeDropdown() {
        this.isOpen = false;
        this.querySelector('#dream-switcher-dropdown').classList.add('hidden');
        this.querySelector('#dream-switcher-arrow').style.transform = 'rotate(0deg)';
    }

    switchToPrev() {
        const activeDreams = this.dreams.filter(d => d.status === 'active');
        if (activeDreams.length < 2) return;

        const currentIndex = activeDreams.findIndex(d => d.id === this.currentFocusId);
        const prevIndex = currentIndex <= 0 ? activeDreams.length - 1 : currentIndex - 1;
        this.setFocusDream(activeDreams[prevIndex].id);
    }

    switchToNext() {
        const activeDreams = this.dreams.filter(d => d.status === 'active');
        if (activeDreams.length < 2) return;

        const currentIndex = activeDreams.findIndex(d => d.id === this.currentFocusId);
        const nextIndex = currentIndex >= activeDreams.length - 1 ? 0 : currentIndex + 1;
        this.setFocusDream(activeDreams[nextIndex].id);
    }

    async setFocusDream(dreamId) {
        if (!this.studentId || dreamId === this.currentFocusId) {
            this.closeDropdown();
            return;
        }

        try {
            const res = await apiFetch(buildApiUrl(`/api/student/${encodeURIComponent(this.studentId)}/dreams/focus`), {
                method: 'POST',
                headers: getJsonAuthHeaders(),
                body: JSON.stringify({ goal_id: dreamId })
            });

            if (!res.ok) throw new Error('Failed to set focus');

            this.currentFocusId = dreamId;
            this.renderDreamList();
            this.updateLabel();
            this.closeDropdown();

            // Dispatch event for other components to listen
            window.dispatchEvent(new CustomEvent('dreamFocusChanged', { detail: { dreamId } }));
        } catch (err) {
            console.error('Set focus error:', err);
            window.showPageToast?.('切换当前期待失败，请稍后重试', 'error');
        }
    }
}

customElements.define('dream-switcher', DreamSwitcher);
