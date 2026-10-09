// Student Growth Dashboard Logic

let radarChartInstance = null;
let lineChartInstance = null;

const RADAR_LABELS = [
    '学习与自我',
    '家庭与亲子',
    '社交与合作',
    '情绪与表达',
    '综合探索'
];

const RADAR_KEYS = ['school', 'home', 'social', 'emotion', 'other'];

const TIMELINE_TYPE_META = {
    challenge_session: { icon: 'quiz', iconBg: 'bg-purple-100 dark:bg-purple-900/40', iconColor: 'text-purple-500' },
    task: { icon: 'bolt', iconBg: 'bg-orange-100 dark:bg-orange-900/40', iconColor: 'text-orange-500' },
    moment: { icon: 'photo_camera', iconBg: 'bg-blue-100 dark:bg-blue-900/40', iconColor: 'text-blue-500' },
    default: { icon: 'check_circle', iconBg: 'bg-green-100 dark:bg-green-900/40', iconColor: 'text-green-500' }
};

document.addEventListener('DOMContentLoaded', async () => {
    const user = getStoredUser();
    if (!user) {
        window.location.href = '../index.html';
        return;
    }

    const loggedInUserId = user.id;
    const urlParams = new URLSearchParams(window.location.search);
    const targetUserId = urlParams.get('id') || loggedInUserId;
    const isExternalView = targetUserId !== loggedInUserId;

    await setupHeader({ user, loggedInUserId, targetUserId, isExternalView });
    await fetchGrowthStats(targetUserId);
    bindTimelineModal();
});

function getStoredUser() {
    try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            return JSON.parse(userStr);
        }
    } catch (error) {
        console.error('Failed to parse local user', error);
    }
    const sessionUserId = typeof getSessionUserId === 'function' ? getSessionUserId() : null;
    return sessionUserId ? { id: sessionUserId, user_metadata: {} } : null;
}

async function setupHeader({ user, loggedInUserId, targetUserId, isExternalView }) {
    const greetingEl = document.getElementById('user-greeting');

    if (isExternalView) {
        if (greetingEl) {
            greetingEl.innerHTML = '学生成长档案 <span class="text-primary-dark drop-shadow-sm">📘</span><br><span class="text-2xl mt-2 block text-text-sub">正在加载学生信息...</span>';
        }

        try {
            const profileData = await safeGetCachedSummary(targetUserId);
            const studentName = profileData?.full_name || '这位同学';
            if (greetingEl) {
                greetingEl.innerHTML = `${studentName} 的成长档案 <span class="text-primary-dark drop-shadow-sm">📘</span><br><span class="text-2xl mt-2 block text-text-sub">老师正在查看这份成长记录</span>`;
            }
            updateAvatarSources(targetUserId, profileData?.avatar_url);
        } catch (error) {
            console.error('Failed to load external student summary', error);
        }
        return;
    }

    const name = user?.user_metadata?.full_name || '同学';
    if (greetingEl) {
        greetingEl.innerHTML = `我的成长足迹 <span class="text-primary-dark drop-shadow-sm">✨</span><br><span class="text-2xl mt-2 block text-text-sub">${name}，你好</span>`;
    }

    safeGetCachedSummary(loggedInUserId)
        .then((profileData) => updateAvatarSources(loggedInUserId, profileData?.avatar_url))
        .catch((error) => console.error('Failed to load growth summary avatar', error));
}

function updateAvatarSources(userId, avatarUrl) {
    const fallback = `https://api.dicebear.com/7.x/notionists/svg?seed=${String(userId).slice(0, 8)}&backgroundColor=e6dac6`;
    const finalUrl = avatarUrl || fallback;
    [document.getElementById('user-avatar-header'), document.getElementById('sidebar-avatar')].forEach((el) => {
        if (el) {
            el.src = finalUrl;
        }
    });
}

async function safeGetCachedSummary(userId) {
    if (typeof getCachedSummary !== 'function') return null;
    return getCachedSummary(userId);
}

function logout() {
    localStorage.removeItem('user');
    localStorage.removeItem('supabase.auth.token');
    localStorage.removeItem('sb-access-token');
    localStorage.removeItem('sb-refresh-token');
    window.location.href = '../index.html';
}

async function fetchGrowthStats(userId) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/api/student/${userId}/growth-stats`);
        if (!response.ok) {
            throw new Error(`Growth stats request failed: ${response.status}`);
        }

        const data = await response.json();
        updateMetrics(data || {});
        renderRadarChart(data?.radar || {});
        renderLineChart(Array.isArray(data?.trend) ? data.trend : []);
        renderTimeline(Array.isArray(data?.timeline) ? data.timeline : []);
    } catch (error) {
        console.error('Error fetching growth stats', error);
        renderTimelineError();
        hideLoader('radar-loading');
        hideLoader('line-loading');
    }
}

function renderTimelineError() {
    const timelineList = document.getElementById('timeline-container');
    if (!timelineList) return;

    timelineList.innerHTML = '<div class="text-red-500 text-sm py-4">成长数据加载失败，请检查网络后重试。</div>';
}

function hideLoader(id) {
    document.getElementById(id)?.classList.add('opacity-0', 'pointer-events-none');
}

function updateMetrics(data) {
    const safeSet = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };

    safeSet('account-age', Number(data?.account_age_days) || 1);
    safeSet('metric-challenges', Number(data?.metrics?.total_challenges) || 0);
    safeSet('metric-portfolios', Number(data?.metrics?.total_moments ?? data?.metrics?.total_portfolios) || 0);
    safeSet('metric-streak', Number(data?.metrics?.total_checkin_days ?? data?.metrics?.streak) || 0);
    safeSet('metric-likes', Number(data?.metrics?.likes ?? data?.metrics?.likes_received) || 0);

    const pendingEl = document.getElementById('metric-challenges-pending');
    if (pendingEl) {
        const questionsPerSession = Number(data?.challenge_session_rule?.questions_per_session) || 10;
        const pendingQuestions = Number(data?.challenge_session_rule?.pending_questions) || 0;
        pendingEl.textContent = `当前进度 ${pendingQuestions}/${questionsPerSession} 题`;
    }
}

function getThemeColors() {
    const isDark = document.documentElement.classList.contains('dark');
    return {
        textMain: isDark ? '#f3f4f6' : '#5c5446',
        textSub: isDark ? '#9ca3af' : '#948c7e',
        gridLine: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(92, 84, 70, 0.1)',
        primary: '#86ef5b',
        primaryDark: '#5db339',
        purple: '#8b5cf6',
        blue: '#3b82f6'
    };
}

function destroyChart(instance) {
    if (instance && typeof instance.destroy === 'function') {
        instance.destroy();
    }
}

function renderRadarChart(radarData) {
    const canvas = document.getElementById('radarChart');
    const ctx = canvas?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') {
        hideLoader('radar-loading');
        return;
    }

    hideLoader('radar-loading');
    destroyChart(radarChartInstance);

    const colors = getThemeColors();
    const isDark = document.documentElement.classList.contains('dark');
    const safeRadar = radarData && typeof radarData === 'object' ? radarData : {};
    const dataPoints = RADAR_KEYS.map((key) => Number(safeRadar[key]) || 0);

    Chart.defaults.font.family = "'Noto Sans SC', sans-serif";

    radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: RADAR_LABELS,
            datasets: [{
                label: '能力值',
                data: dataPoints,
                backgroundColor: isDark ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.2)',
                borderColor: colors.purple,
                pointBackgroundColor: colors.purple,
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: colors.purple,
                borderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: { color: colors.gridLine },
                    grid: { color: colors.gridLine },
                    pointLabels: {
                        color: colors.textMain,
                        font: { size: 13, weight: 'bold' }
                    },
                    ticks: {
                        display: false,
                        min: 0
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(54, 50, 43, 0.9)' : 'rgba(255, 253, 249, 0.95)',
                    titleColor: colors.textMain,
                    bodyColor: colors.textSub,
                    borderColor: colors.gridLine,
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 5,
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 14 },
                    callbacks: {
                        label(context) {
                            return `完成记录 ${context.raw}`;
                        }
                    }
                }
            }
        }
    });
}

function renderLineChart(trendData) {
    const canvas = document.getElementById('lineChart');
    const ctx = canvas?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') {
        hideLoader('line-loading');
        return;
    }

    hideLoader('line-loading');
    destroyChart(lineChartInstance);

    const colors = getThemeColors();
    const isDark = document.documentElement.classList.contains('dark');
    const safeTrend = Array.isArray(trendData) && trendData.length > 0
        ? trendData
        : Array.from({ length: 7 }, (_, index) => ({ date: `第${index + 1}天`, count: 0 }));

    const labels = safeTrend.map((item) => String(item?.date || ''));
    const dataPoints = safeTrend.map((item) => Number(item?.count) || 0);

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, isDark ? 'rgba(59, 130, 246, 0.4)' : 'rgba(59, 130, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    lineChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: '每日活跃度',
                data: dataPoints,
                borderColor: colors.blue,
                backgroundColor: gradient,
                borderWidth: 3,
                pointBackgroundColor: '#fff',
                pointBorderColor: colors.blue,
                pointBorderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: {
                        color: colors.textSub,
                        maxTicksLimit: 7,
                        font: { size: 11 }
                    }
                },
                y: {
                    grid: {
                        color: colors.gridLine,
                        borderDash: [5, 5],
                        drawBorder: false
                    },
                    beginAtZero: true,
                    ticks: {
                        color: colors.textSub,
                        stepSize: 1,
                        font: { size: 11 }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(54, 50, 43, 0.9)' : 'rgba(255, 253, 249, 0.95)',
                    titleColor: colors.textMain,
                    bodyColor: colors.textSub,
                    borderColor: 'rgba(59, 130, 246, 0.3)',
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    displayColors: false,
                    titleFont: { size: 13, weight: 'bold' },
                    callbacks: {
                        label(context) {
                            return `活跃记录：${context.raw} 次`;
                        }
                    }
                }
            }
        }
    });
}

function renderTimeline(timelineData) {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    const sorted = Array.isArray(timelineData)
        ? [...timelineData].sort((a, b) => new Date(b?.date || 0) - new Date(a?.date || 0))
        : [];

    if (sorted.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 fade-in">
                <div class="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span class="material-icons-round text-gray-400 text-3xl">hourglass_empty</span>
                </div>
                <h4 class="text-text-main dark:text-gray-300 font-bold mb-1">还没有成长记录</h4>
                <p class="text-sm text-text-sub">先去完成几次挑战或发布动态，这里就会慢慢丰富起来。</p>
                <button onclick="window.location.href='challenge.html'" class="mt-4 px-5 py-2 rounded-full bg-primary text-white font-bold text-sm hover:bg-primary-dark transition shadow-sm">去挑战看看</button>
            </div>
        `;
        return;
    }

    const visibleCount = 10;
    window._timelineData = sorted;

    const renderItem = (item, index) => {
        const delay = index * 0.08;
        const dateObj = item?.date ? new Date(item.date) : new Date();
        const day = dateObj.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        const time = dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const meta = getTimelineTypeMeta(item?.type);
        const title = escapeHtml(getTimelineTitle(item));
        const desc = escapeHtml(getTimelineDescription(item));
        const descHtml = desc
            ? `<p class="text-sm text-text-sub dark:text-gray-400 mt-1 line-clamp-2">${desc}</p>`
            : '';

        return `
            <div class="timeline-item flex gap-4 fade-in rounded-lg p-2 -m-2 cursor-pointer hover:bg-white/50 dark:hover:bg-white/5 transition-colors" style="animation-delay: ${delay}s" data-idx="${index}" onclick="openTimelineDetail(${index})">
                <div class="flex-shrink-0 w-12 h-12 rounded-lg ${meta.iconBg} flex items-center justify-center mt-1 z-10 relative bg-opacity-90 backdrop-blur-sm shadow-sm">
                    <span class="material-icons-round ${meta.iconColor}">${meta.icon}</span>
                </div>
                <div class="flex-1 pb-2">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-1 gap-1">
                        <h4 class="text-lg font-bold text-text-main dark:text-white font-display">${title}</h4>
                        <span class="text-xs font-semibold text-text-sub dark:text-gray-400 bg-white dark:bg-surface-dark px-2 py-1 rounded-full border border-warm-border/50 dark:border-gray-700 self-start sm:self-auto">${day} ${time}</span>
                    </div>
                    ${descHtml}
                </div>
            </div>`;
    };

    const visibleHtml = sorted.slice(0, visibleCount).map(renderItem).join('');
    const hiddenItems = sorted.slice(visibleCount);
    const hiddenHtml = hiddenItems.length > 0
        ? `
            <div id="timeline-extra" class="hidden space-y-8">${hiddenItems.map((item, index) => renderItem(item, visibleCount + index)).join('')}</div>
            <button onclick="toggleTimelineExtra(this)" class="mt-2 text-sm text-primary font-semibold hover:underline">展开更多 →</button>
        `
        : '';

    const startItem = `
        <div class="flex gap-4 fade-in relative" style="animation-delay: ${sorted.length * 0.08}s">
            <div class="absolute left-[-1.5rem] top-1/2 w-4 h-4 rounded-full bg-warm-border/80 border-4 border-white pointer-events-none transform -translate-x-1/2 -translate-y-1/2 z-10"></div>
            <div class="py-2 pl-3"><p class="text-sm font-bold text-text-sub italic">成长旅程从这里开始</p></div>
        </div>`;

    container.innerHTML = visibleHtml + hiddenHtml + startItem;
}

function toggleTimelineExtra(button) {
    const extra = document.getElementById('timeline-extra');
    if (!extra || !button) return;
    const willShow = extra.classList.contains('hidden');
    extra.classList.toggle('hidden');
    button.textContent = willShow ? '收起更多 ↑' : '展开更多 →';
}

function openTimelineDetail(index) {
    const item = (window._timelineData || [])[index];
    if (!item) return;

    const modal = document.getElementById('timeline-detail-modal');
    const iconEl = document.getElementById('timeline-detail-icon');
    const labelEl = document.getElementById('timeline-detail-label');
    const titleEl = document.getElementById('timeline-detail-title');
    const descEl = document.getElementById('timeline-detail-desc');
    const metaEl = document.getElementById('timeline-detail-meta');
    const proofLinkEl = document.getElementById('timeline-detail-proof-link');
    const timeEl = document.getElementById('timeline-detail-time');

    if (!modal || !iconEl || !labelEl || !titleEl || !descEl || !metaEl || !proofLinkEl || !timeEl) {
        return;
    }

    const dateObj = item?.date ? new Date(item.date) : new Date();
    const dateStr = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const meta = getTimelineTypeMeta(item?.type);
    const title = getTimelineTitle(item);
    const desc = getTimelineDescription(item);
    const metaRows = buildTimelineMetaRows(item);

    iconEl.className = `w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${meta.iconBg}`;
    iconEl.innerHTML = `<span class="material-icons-round ${meta.iconColor}">${meta.icon}</span>`;
    labelEl.textContent = dateStr;
    titleEl.textContent = title;
    timeEl.textContent = timeStr;

    if (desc) {
        descEl.textContent = desc;
        descEl.classList.remove('hidden');
    } else {
        descEl.textContent = '';
        descEl.classList.add('hidden');
    }

    if (metaRows.length > 0) {
        metaEl.innerHTML = metaRows
            .map((row) => `<div class="text-xs text-text-sub dark:text-gray-300 bg-gray-50 dark:bg-black/20 rounded-lg px-3 py-2">${escapeHtml(row)}</div>`)
            .join('');
        metaEl.classList.remove('hidden');
    } else {
        metaEl.innerHTML = '';
        metaEl.classList.add('hidden');
    }

    const proofUrl = String(item?.detail?.proof_url || '').trim();
    if (proofUrl) {
        proofLinkEl.href = proofUrl;
        proofLinkEl.classList.remove('hidden');
    } else {
        proofLinkEl.classList.add('hidden');
        proofLinkEl.removeAttribute('href');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function buildTimelineMetaRows(item) {
    const detail = item?.detail || {};

    if (item?.type === 'challenge_session') {
        const sessionIndex = Number(detail.session_index) || 0;
        const questionCount = Number(detail.question_count) || 10;
        const positiveCount = Number(detail.positive_count) || 0;
        const negativeCount = Number(detail.negative_count) || 0;
        const topCategory = formatCategoryLabel(detail.top_category);

        return [
            `测试编号：第 ${sessionIndex || '--'} 次`,
            `测试题量：${questionCount} 题（完整测试）`,
            `积极选择：${positiveCount} 次`,
            `继续努力：${negativeCount} 次`,
            `主要场景：${topCategory}`
        ];
    }

    if (item?.type === 'task') {
        const rows = [];
        const taskTitle = String(detail.task_title || '').trim();
        const taskType = formatTaskTypeLabel(detail.task_type);
        const proofNote = String(detail.proof_note || '').trim();

        if (taskTitle) rows.push(`任务名称：${taskTitle}`);
        rows.push(`任务类型：${taskType}`);
        if (proofNote) rows.push(`提交说明：${proofNote}`);
        return rows;
    }

    if (item?.type === 'moment') {
        return [`动态类型：${formatMomentTypeLabel(detail.moment_type)}`];
    }

    return [];
}

function getTimelineTypeMeta(type) {
    return TIMELINE_TYPE_META[type] || TIMELINE_TYPE_META.default;
}

function getTimelineTitle(item) {
    const detail = item?.detail || {};

    if (item?.type === 'challenge_session') {
        const sessionIndex = Number(detail.session_index) || 0;
        return sessionIndex ? `完成第 ${sessionIndex} 次成长挑战测试` : '完成了一次完整成长挑战测试';
    }

    if (item?.type === 'task') {
        const taskTitle = String(detail.task_title || '').trim();
        const taskType = String(detail.task_type || '').toLowerCase();
        if (taskTitle.startsWith('克服障碍')) return '解决了一个期待阻碍';
        if (taskType === 'personal') return '完成了一项每日计划';
        if (taskType === 'goal_plan') return '推进了一个期待目标';
        if (taskType === 'challenge') return '完成了一项成长挑战';
        return taskTitle || '完成了一项成长任务';
    }

    if (item?.type === 'moment') {
        return '发布了一条班级动态';
    }

    const fallback = String(item?.title || '').trim();
    return fallback || '记录了一次成长时刻';
}

function getTimelineDescription(item) {
    const detail = item?.detail || {};

    if (item?.type === 'challenge_session') {
        const questionCount = Number(detail.question_count) || 10;
        const positiveCount = Number(detail.positive_count) || 0;
        const negativeCount = Number(detail.negative_count) || 0;
        return `本次共 ${questionCount} 题：积极选择 ${positiveCount} 次，继续努力 ${negativeCount} 次。`;
    }

    if (item?.type === 'task') {
        const proofNote = String(detail.proof_note || '').trim();
        const desc = String(item?.desc || '').trim();
        return proofNote || desc;
    }

    if (item?.type === 'moment') {
        return String(item?.desc || detail.content || '').trim();
    }

    return String(item?.desc || '').trim();
}

function bindTimelineModal() {
    const timelineModal = document.getElementById('timeline-detail-modal');
    if (timelineModal) {
        timelineModal.addEventListener('click', (event) => {
            if (event.target === timelineModal) {
                timelineModal.classList.replace('flex', 'hidden');
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const modal = document.getElementById('timeline-detail-modal');
        if (modal && !modal.classList.contains('hidden')) {
            modal.classList.replace('flex', 'hidden');
        }
    });
}

function formatTaskTypeLabel(taskType) {
    const key = String(taskType || '').toLowerCase();
    if (key === 'personal') return '每日计划';
    if (key === 'goal_plan') return '期待计划';
    if (key === 'challenge') return '成长挑战';
    return '成长任务';
}

function formatMomentTypeLabel(momentType) {
    const key = String(momentType || '').toLowerCase();
    if (key === 'text') return '文字动态';
    if (key === 'image') return '图片动态';
    if (key === 'video') return '视频动态';
    return '班级动态';
}

function formatCategoryLabel(category) {
    const key = String(category || '').toLowerCase();
    const mapping = {
        school: '学习与自我',
        home: '家庭与亲子',
        social: '社交与合作',
        emotion: '情绪与表达',
        parent_child: '亲子关系',
        teacher_student: '师生关系',
        classmate: '同学相处',
        academic: '学业成长',
        other: '综合探索'
    };
    return mapping[key] || '综合探索';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
