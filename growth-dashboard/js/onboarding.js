/**
 * Onboarding Page Logic
 * 用户引导页面逻辑
 */

const TOTAL_STEPS = 5;

let currentStep = 1;
let userId = null;
let accessToken = null;
let onboardingData = {
    avatar_url: '',
    dream: '',
    bio: ''
};

// ============================================
// 初始化
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // 检查登录状态
    const userStr = localStorage.getItem('user');
    accessToken = localStorage.getItem('sb-access-token');

    if (!userStr || !accessToken) {
        window.location.href = 'index.html';
        return;
    }

    try {
        const user = JSON.parse(userStr);
        userId = user.id;

        if (!userId) {
            window.location.href = 'index.html';
            return;
        }

        // 检查是否已完成引导
        await checkOnboardingStatus();

        // 初始化事件监听
        initEventListeners();

    } catch (error) {
        console.error('初始化失败:', error);
        window.location.href = 'index.html';
    }
});

// ============================================
// 检查引导状态
// ============================================

async function checkOnboardingStatus() {
    try {
        const response = await apiGet(`/api/student/${userId}/onboarding/status`);

        if (response.completed) {
            // 已完成引导，跳转到仪表盘
            window.location.href = 'student/dashboard.html';
            return;
        }

        // 恢复之前的进度
        if (response.current_step > 0) {
            currentStep = response.current_step;
            onboardingData = response.data || onboardingData;
            restoreFormData();
        }

        updateUI();

    } catch (error) {
        console.error('检查引导状态失败:', error);
        // 如果数据库字段不存在，继续显示引导页面
        // 不跳转，让用户完成引导流程
        updateUI();
    }
}

// ============================================
// 恢复表单数据
// ============================================

function restoreFormData() {
    if (onboardingData.avatar_url) {
        updateAvatarPreview(onboardingData.avatar_url);
        // 标记选中的头像
        document.querySelectorAll('.avatar-option').forEach(el => {
            if (el.dataset.avatar === onboardingData.avatar_url) {
                el.classList.add('ring-4', 'ring-primary');
            }
        });
    }
    if (onboardingData.dream) {
        document.getElementById('dreamInput').value = onboardingData.dream;
    }
    if (onboardingData.bio) {
        document.getElementById('bioInput').value = onboardingData.bio;
        updateBioCounter();
    }
}

// ============================================
// 事件监听器初始化
// ============================================

function initEventListeners() {
    // 导航按钮
    document.getElementById('prevBtn').addEventListener('click', goToPreviousStep);
    document.getElementById('nextBtn').addEventListener('click', goToNextStep);

    // 头像选择
    document.querySelectorAll('.avatar-option').forEach(el => {
        el.addEventListener('click', () => selectAvatar(el));
    });

    // 头像上传
    document.getElementById('avatarUpload').addEventListener('change', handleAvatarUpload);

    // 期待模板
    document.querySelectorAll('.dream-template').forEach(el => {
        el.addEventListener('click', () => {
            document.getElementById('dreamInput').value = el.dataset.dream;
        });
    });

    // 简介字数统计
    document.getElementById('bioInput').addEventListener('input', updateBioCounter);

    // 邀请码输入格式化
    document.getElementById('inviteCodeInput').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
}

// ============================================
// 步骤导航
// ============================================

function goToPreviousStep() {
    if (currentStep > 1) {
        currentStep--;
        updateUI();
    }
}

async function goToNextStep() {
    const nextBtn = document.getElementById('nextBtn');

    // 验证当前步骤
    if (!validateCurrentStep()) {
        return;
    }

    // 保存当前步骤数据
    await saveCurrentStep();

    if (currentStep < TOTAL_STEPS) {
        currentStep++;
        updateUI();
    } else {
        // 完成引导
        nextBtn.disabled = true;
        nextBtn.innerHTML = '处理中...';
        await completeOnboarding();
    }
}

// ============================================
// 验证当前步骤
// ============================================

function validateCurrentStep() {
    switch (currentStep) {
        case 2:
            // 头像可选，不强制
            return true;
        case 3:
            const dream = document.getElementById('dreamInput').value.trim();
            if (!dream) {
                alert('请写下你的期待');
                return false;
            }
            onboardingData.dream = dream;
            return true;
        case 4:
            const bio = document.getElementById('bioInput').value.trim();
            if (bio.length > 200) {
                alert('自我介绍不能超过200字');
                return false;
            }
            onboardingData.bio = bio;
            return true;
        default:
            return true;
    }
}

// ============================================
// 保存当前步骤
// ============================================

async function saveCurrentStep() {
    try {
        await apiPost(`/api/student/${userId}/onboarding/step`, {
            step: currentStep,
            data: onboardingData
        });
    } catch (error) {
        console.error('保存步骤失败:', error);
        // 不阻止用户继续，静默失败
    }
}

// ============================================
// 完成引导
// ============================================

async function completeOnboarding() {
    try {
        const inviteCode = document.getElementById('inviteCodeInput').value.trim();

        const response = await apiPost(`/api/student/${userId}/onboarding/complete`, {
            class_invite_code: inviteCode || null
        });

        if (response.success) {
            // 跳转到仪表盘
            window.location.href = 'student/dashboard.html';
        } else {
            throw new Error(response.error || '完成引导失败');
        }
    } catch (error) {
        console.error('完成引导失败:', error);
        const errorMsg = error.message || '未知错误';
        alert('保存失败：' + errorMsg + '\n\n如果错误持续，请确保已在 Supabase 中运行数据库迁移脚本。');
        const nextBtn = document.getElementById('nextBtn');
        nextBtn.disabled = false;
        nextBtn.innerHTML = '完成设置 <span class="material-icons-round">check</span>';
    }
}

// ============================================
// 头像处理
// ============================================

function selectAvatar(el) {
    // 移除其他选中状态
    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.classList.remove('ring-4', 'ring-primary');
    });

    // 添加选中状态
    el.classList.add('ring-4', 'ring-primary');

    // 保存数据
    onboardingData.avatar_url = el.dataset.avatar;
    updateAvatarPreview(el.dataset.avatar);
}

async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 检查文件大小 (最大 2MB)
    if (file.size > 2 * 1024 * 1024) {
        alert('图片大小不能超过 2MB');
        return;
    }

    try {
        // 读取为 base64
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target.result;

            // 上传到服务器
            const response = await apiPost(`/api/student/${userId}/avatar/upload`, {
                fileName: file.name || 'avatar.png',
                mimeType: file.type || 'image/png',
                dataBase64: base64
            });

            if (response.avatar_url) {
                onboardingData.avatar_url = response.avatar_url;
                updateAvatarPreview(response.avatar_url);

                // 清除 emoji 头像选中状态
                document.querySelectorAll('.avatar-option').forEach(opt => {
                    opt.classList.remove('ring-4', 'ring-primary');
                });
            }
        };
        reader.readAsDataURL(file);
    } catch (error) {
        console.error('上传头像失败:', error);
        alert('上传头像失败，请重试');
    }
}

function updateAvatarPreview(avatar) {
    const preview = document.getElementById('avatarPreview');

    // 检查是否是 emoji（不是 URL 或 base64）
    const isEmoji = !avatar.includes('http') &&
                    !avatar.includes('data:') &&
                    !avatar.includes('/') &&
                    avatar.length <= 10;  // 大多数 emoji 长度在 1-10 之间（包含变体选择器）

    if (isEmoji) {
        preview.innerHTML = `<span class="text-5xl">${avatar}</span>`;
        preview.classList.add('has-avatar');
    } else {
        preview.innerHTML = `<img src="${avatar}" class="w-full h-full object-cover" />`;
        preview.classList.add('has-avatar');
    }
}

// ============================================
// 字数统计
// ============================================

function updateBioCounter() {
    const bio = document.getElementById('bioInput').value;
    const counter = document.getElementById('bioCounter');
    counter.textContent = `${bio.length}/200`;

    if (bio.length > 200) {
        counter.classList.add('text-red-500');
    } else {
        counter.classList.remove('text-red-500');
    }
}

// ============================================
// UI 更新
// ============================================

// 步骤图标配置
const STEP_ICONS = [
    'waving_hand',
    'face',
    'stars',
    'edit_note',
    'celebration'
];

function updateUI() {
    // 更新步骤指示器
    for (let i = 1; i <= TOTAL_STEPS; i++) {
        const indicator = document.getElementById(`step-${i}`);
        indicator.classList.remove('active', 'completed');

        if (i < currentStep) {
            indicator.classList.add('completed');
            indicator.innerHTML = '<span class="material-icons-round text-lg">check</span>';
        } else if (i === currentStep) {
            indicator.classList.add('active');
            indicator.innerHTML = `<span class="material-icons-round text-lg">${STEP_ICONS[i-1]}</span>`;
        } else {
            indicator.innerHTML = `<span class="material-icons-round text-lg">${STEP_ICONS[i-1]}</span>`;
        }

        // 更新连接线
        if (i < TOTAL_STEPS) {
            const line = document.getElementById(`line-${i}`);
            if (i < currentStep) {
                line.classList.add('active');
                line.classList.remove('bg-gray-200');
            } else {
                line.classList.remove('active');
                line.classList.add('bg-gray-200');
            }
        }
    }

    // 更新内容区域
    for (let i = 1; i <= TOTAL_STEPS; i++) {
        const content = document.getElementById(`content-${i}`);
        content.classList.toggle('active', i === currentStep);
    }

    // 更新导航按钮
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    prevBtn.classList.toggle('hidden', currentStep === 1);

    if (currentStep === TOTAL_STEPS) {
        nextBtn.innerHTML = '完成设置 <span class="material-icons-round">check</span>';
    } else if (currentStep === 1) {
        nextBtn.innerHTML = '开始设置 <span class="material-icons-round">arrow_forward</span>';
    } else {
        nextBtn.innerHTML = '下一步 <span class="material-icons-round">arrow_forward</span>';
    }
}
