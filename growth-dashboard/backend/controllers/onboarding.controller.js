/**
 * Onboarding Controller
 * 用户引导相关控制器
 */

const { supabaseAdmin } = require('../middlewares/auth');

const TOTAL_STEPS = 5;

// ============================================
// 获取引导状态
// ============================================

const getOnboardingStatus = async (req, res) => {
    const { id } = req.params;

    try {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('onboarding_completed, onboarding_step, bio, dream, avatar_url')
            .eq('id', id)
            .single();

        if (error) {
            console.error('Error fetching onboarding status:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!profile) {
            return res.status(404).json({ error: '用户不存在' });
        }

        res.json({
            completed: profile.onboarding_completed || false,
            current_step: profile.onboarding_step || 0,
            total_steps: TOTAL_STEPS,
            data: {
                avatar_url: profile.avatar_url || '',
                dream: profile.dream || '',
                bio: profile.bio || ''
            }
        });
    } catch (error) {
        console.error('Get onboarding status error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 更新引导步骤
// ============================================

const updateOnboardingStep = async (req, res) => {
    const { id } = req.params;
    const { step, data } = req.body;

    if (typeof step !== 'number' || step < 0 || step > TOTAL_STEPS) {
        return res.status(400).json({ error: '无效的步骤编号' });
    }

    try {
        const updates = {
            onboarding_step: step,
            updated_at: new Date().toISOString()
        };

        // 根据步骤更新对应的数据
        if (data) {
            if (data.avatar_url !== undefined) {
                updates.avatar_url = data.avatar_url;
            }
            if (data.dream !== undefined) {
                updates.dream = data.dream;
            }
            if (data.bio !== undefined) {
                updates.bio = data.bio;
            }
        }

        const { error } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', id);

        if (error) {
            console.error('Error updating onboarding step:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            current_step: step,
            total_steps: TOTAL_STEPS
        });
    } catch (error) {
        console.error('Update onboarding step error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 完成引导
// ============================================

const completeOnboarding = async (req, res) => {
    const { id } = req.params;
    const { class_invite_code } = req.body;

    try {
        // 如果提供了班级邀请码，尝试加入班级
        let classInfo = null;
        if (class_invite_code && typeof class_invite_code === 'string') {
            const { data: classData, error: classError } = await supabaseAdmin
                .from('classes')
                .select('id, school_name, name')
                .eq('invite_code', class_invite_code.trim().toUpperCase())
                .single();

            if (!classError && classData) {
                classInfo = classData;

                // 更新用户的班级信息
                await supabaseAdmin
                    .from('profiles')
                    .update({
                        class_id: classData.id,
                        school_name: classData.school_name,
                        class_name: classData.name
                    })
                    .eq('id', id);
            }
        }

        // 标记引导完成
        const { error } = await supabaseAdmin
            .from('profiles')
            .update({
                onboarding_completed: true,
                onboarding_step: TOTAL_STEPS,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) {
            console.error('Error completing onboarding:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            message: '引导完成',
            class_joined: classInfo ? {
                id: classInfo.id,
                name: classInfo.name,
                school_name: classInfo.school_name
            } : null
        });
    } catch (error) {
        console.error('Complete onboarding error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getOnboardingStatus,
    updateOnboardingStep,
    completeOnboarding
};
