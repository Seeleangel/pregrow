/**
 * Auth Controller
 * 认证相关控制器
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin } = require('../middlewares/auth');
const { invalidateTeacherCaches } = require('../services/cacheService');

// 确保加载正确的 .env 文件
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Auth Controller: Missing SUPABASE_URL or SUPABASE_KEY');
}

// Supabase Public Client (for Auth - 使用普通 key，不是 service key)
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 用户注册
 */
const register = async (req, res) => {
    const { email, password, role, name, inviteCode, schoolName, className } = req.body;

    // Input validation
    if (!email || !password) {
        return res.status(400).json({ error: '请输入邮箱和密码' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: '密码长度至少为6位' });
    }
    if (role === 'student' && (!name || !name.trim())) {
        return res.status(400).json({ error: '请输入姓名' });
    }
    if (role === 'teacher' && (!schoolName || !className)) {
        return res.status(400).json({ error: '请输入完整的学校和班级信息' });
    }

    try {
        // 1. 使用 Supabase Admin 创建用户 (绕过邮箱确认)
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });

        if (authError) throw authError;

        const user = authData.user;

        if (user) {
            let classId = null;

            console.log(`Attempting to create profile for user: ${user.id}`);
            const { error: profileError } = await supabaseAdmin
                .from('profiles')
                .insert([
                    {
                        id: user.id,
                        role,
                        full_name: name,
                        school_name: schoolName,
                        class_name: className,
                        invite_code: inviteCode
                    }
                ]);

            if (profileError) {
                throw profileError;
            }

            // 如果是教师，自动创建班级
            if (role === 'teacher') {
                const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
                let newInviteCode = '';
                for (let i = 0; i < 6; i++) {
                    newInviteCode += chars.charAt(Math.floor(Math.random() * chars.length));
                }

                const { data: newClass, error: classError } = await supabaseAdmin
                    .from('classes')
                    .insert({
                        name: className || '默认班级',
                        school_name: schoolName || '默认学校',
                        invite_code: newInviteCode,
                        teacher_id: user.id
                    })
                    .select('id')
                    .single();

                if (classError) throw classError;
                classId = newClass.id;

                // 更新教师档案的 class_id
                await supabaseAdmin
                    .from('profiles')
                    .update({ class_id: classId })
                    .eq('id', user.id);
            }

            if (role === 'student') {
                invalidateTeacherCaches();
            }

            res.status(201).json({ message: 'User registered successfully', user });
        } else {
            res.status(400).json({ message: 'User verification failed' });
        }

    } catch (error) {
        console.error('Registration error details:', error);
        let errorMessage = error.message;

        // 检查是否是用户已存在
        if (errorMessage && (errorMessage.includes('already') || errorMessage.includes('duplicate'))) {
            errorMessage = '该邮箱已被注册，请使用其他邮箱或直接登录';
        }
        res.status(400).json({ error: errorMessage });
    }
};

/**
 * 用户登录
 */
const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;

        // 获取用户档案以获取角色信息
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        if (profileError) {
            console.error('Error fetching profile:', profileError);
        }

        res.status(200).json({
            message: 'Login successful',
            session: data.session,
            user: data.user,
            role: profile ? profile.role : null
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ error: error.message });
    }
};

module.exports = {
    register,
    login
};
