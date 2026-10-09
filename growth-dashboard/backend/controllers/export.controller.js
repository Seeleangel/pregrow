/**
 * Export Controller
 * 数据导出控制器
 */

const ExcelJS = require('exceljs');
const { supabaseAdmin } = require('../middlewares/auth');

// ============================================
// 导出学生成长报告 Excel
// ============================================

const exportStudentReport = async (req, res) => {
    const { id } = req.params;

    try {
        // 获取学生基本信息
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', id)
            .single();

        if (profileError || !profile) {
            return res.status(404).json({ error: '学生不存在' });
        }

        // 获取学生目标
        const { data: goals } = await supabaseAdmin
            .from('goals')
            .select('*')
            .eq('student_id', id)
            .order('created_at', { ascending: false });

        // 获取学生任务完成记录
        const { data: tasks } = await supabaseAdmin
            .from('student_tasks')
            .select('*')
            .eq('student_id', id)
            .order('created_at', { ascending: false })
            .limit(50);

        // 获取学生徽章
        const { data: badges } = await supabaseAdmin
            .from('student_badges')
            .select('*, badges(*)')
            .eq('student_id', id);

        // 获取签到记录
        const { data: checkins } = await supabaseAdmin
            .from('checkins')
            .select('*')
            .eq('student_id', id)
            .order('created_at', { ascending: false })
            .limit(30);

        // 创建 Excel 工作簿
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Growth Dashboard';
        workbook.created = new Date();

        // ===== 概览页 =====
        const summarySheet = workbook.addWorksheet('概览');
        summarySheet.columns = [
            { header: '项目', key: 'item', width: 20 },
            { header: '内容', key: 'value', width: 40 }
        ];

        summarySheet.addRows([
            { item: '学生姓名', value: profile.full_name || '-' },
            { item: '学校', value: profile.school_name || '-' },
            { item: '班级', value: profile.class_name || '-' },
            { item: '期待', value: profile.dream || '-' },
            { item: '个人简介', value: profile.bio || '-' },
            { item: '目标数量', value: goals?.length || 0 },
            { item: '已完成目标', value: goals?.filter(g => g.status === 'completed').length || 0 },
            { item: '任务完成数', value: tasks?.filter(t => t.completed).length || 0 },
            { item: '获得徽章数', value: badges?.length || 0 },
            { item: '签到次数', value: checkins?.length || 0 },
            { item: '导出时间', value: new Date().toLocaleString('zh-CN') }
        ]);

        // 标题样式
        summarySheet.getRow(1).font = { bold: true };
        summarySheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFEE8C2B' }
        };
        summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // ===== 目标页 =====
        if (goals && goals.length > 0) {
            const goalsSheet = workbook.addWorksheet('目标记录');
            goalsSheet.columns = [
                { header: '目标标题', key: 'title', width: 30 },
                { header: '描述', key: 'description', width: 40 },
                { header: '状态', key: 'status', width: 12 },
                { header: '目标日期', key: 'target_date', width: 15 },
                { header: '创建时间', key: 'created_at', width: 18 },
                { header: '完成时间', key: 'completed_at', width: 18 }
            ];

            goals.forEach(goal => {
                goalsSheet.addRow({
                    title: goal.title,
                    description: goal.description || '-',
                    status: getStatusText(goal.status),
                    target_date: goal.target_date ? new Date(goal.target_date).toLocaleDateString('zh-CN') : '-',
                    created_at: new Date(goal.created_at).toLocaleString('zh-CN'),
                    completed_at: goal.completed_at ? new Date(goal.completed_at).toLocaleString('zh-CN') : '-'
                });
            });

            goalsSheet.getRow(1).font = { bold: true };
            goalsSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFEE8C2B' }
            };
            goalsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        }

        // ===== 任务页 =====
        if (tasks && tasks.length > 0) {
            const tasksSheet = workbook.addWorksheet('任务记录');
            tasksSheet.columns = [
                { header: '任务标题', key: 'title', width: 30 },
                { header: '状态', key: 'completed', width: 12 },
                { header: '创建时间', key: 'created_at', width: 18 }
            ];

            tasks.forEach(task => {
                tasksSheet.addRow({
                    title: task.title,
                    completed: task.completed ? '已完成' : '进行中',
                    created_at: new Date(task.created_at).toLocaleString('zh-CN')
                });
            });

            tasksSheet.getRow(1).font = { bold: true };
            tasksSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFEE8C2B' }
            };
            tasksSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        }

        // ===== 徽章页 =====
        if (badges && badges.length > 0) {
            const badgesSheet = workbook.addWorksheet('徽章记录');
            badgesSheet.columns = [
                { header: '徽章名称', key: 'name', width: 20 },
                { header: '描述', key: 'description', width: 40 },
                { header: '获得时间', key: 'earned_at', width: 18 }
            ];

            badges.forEach(badge => {
                badgesSheet.addRow({
                    name: badge.badges?.name || '-',
                    description: badge.badges?.description || '-',
                    earned_at: new Date(badge.earned_at).toLocaleString('zh-CN')
                });
            });

            badgesSheet.getRow(1).font = { bold: true };
            badgesSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFEE8C2B' }
            };
            badgesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        }

        // 设置响应头
        const fileName = `成长报告_${profile.full_name || '学生'}_${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

        // 写入响应
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Export student report error:', error);
        res.status(500).json({ error: '导出失败：' + error.message });
    }
};

// ============================================
// 导出班级数据 Excel (教师用)
// ============================================

const exportClassReport = async (req, res) => {
    const { classId } = req.params;
    const teacherId = req.user.id;

    try {
        // 验证教师权限
        const { data: classData, error: classError } = await supabaseAdmin
            .from('classes')
            .select('*')
            .eq('id', classId)
            .eq('teacher_id', teacherId)
            .single();

        if (classError || !classData) {
            return res.status(403).json({ error: '无权访问该班级' });
        }

        // 获取班级学生（兼容旧库字段）
        const candidateSelects = [
            'id, full_name, school_name, class_name, dream, bio, created_at',
            'id, full_name, school_name, class_name, dream, bio',
            'id, full_name, school_name, class_name, created_at',
            'id, full_name, school_name, class_name'
        ];

        let studentsResult = null;
        for (const selectFields of candidateSelects) {
            const attempt = await supabaseAdmin
                .from('profiles')
                .select(selectFields)
                .eq('class_id', classId)
                .eq('role', 'student')
                .order('full_name', { ascending: true });

            if (!attempt.error) {
                studentsResult = attempt;
                break;
            }

            const errorCode = String(attempt.error.code || '');
            if (errorCode !== '42703') {
                studentsResult = attempt;
                break;
            }
        }

        if (studentsResult && !studentsResult.error) {
            studentsResult.data = (studentsResult.data || []).map((item) => ({
                ...item,
                dream: item?.dream || null,
                bio: item?.bio || null,
                created_at: item?.created_at || null
            }));
        }

        if (studentsResult.error) {
            return res.status(500).json({ error: studentsResult.error.message || '获取班级学生失败' });
        }

        const students = studentsResult.data || [];

        if (!students || students.length === 0) {
            return res.status(400).json({ error: '班级暂无学生' });
        }

        const studentIds = students.map(s => s.id);
        const now = new Date();
        const recentFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

        const isSchemaError = (error) => {
            const msg = String(error?.message || '').toLowerCase();
            return String(error?.code || '') === '42703' || msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache');
        };

        const fetchGoals = async () => {
            const primary = await supabaseAdmin
                .from('student_goals')
                .select('student_id, status, created_at')
                .in('student_id', studentIds)
                .gte('created_at', recentFrom);

            if (!primary.error) return { data: primary.data || [], error: null };

            const fallback = await supabaseAdmin
                .from('goals')
                .select('student_id, status, created_at')
                .in('student_id', studentIds)
                .gte('created_at', recentFrom);

            if (!fallback.error) return { data: fallback.data || [], error: null };
            return isSchemaError(primary.error) || isSchemaError(fallback.error)
                ? { data: [], error: null }
                : { data: [], error: fallback.error };
        };

        const fetchTasks = async () => {
            const primary = await supabaseAdmin
                .from('student_tasks')
                .select('student_id, status, created_at')
                .in('student_id', studentIds)
                .gte('created_at', recentFrom);

            if (!primary.error) return { data: primary.data || [], error: null, mode: 'status' };

            const fallback = await supabaseAdmin
                .from('student_tasks')
                .select('student_id, completed, created_at')
                .in('student_id', studentIds)
                .gte('created_at', recentFrom);

            if (!fallback.error) return { data: fallback.data || [], error: null, mode: 'completed' };
            return isSchemaError(primary.error) || isSchemaError(fallback.error)
                ? { data: [], error: null, mode: 'status' }
                : { data: [], error: fallback.error, mode: 'status' };
        };

        const fetchBadges = async () => {
            const awarded = await supabaseAdmin
                .from('student_badges')
                .select('student_id, awarded_at')
                .in('student_id', studentIds)
                .gte('awarded_at', recentFrom);

            if (!awarded.error) return { data: awarded.data || [], error: null };

            const earned = await supabaseAdmin
                .from('student_badges')
                .select('student_id, earned_at')
                .in('student_id', studentIds)
                .gte('earned_at', recentFrom);

            if (!earned.error) return { data: earned.data || [], error: null };
            return isSchemaError(awarded.error) || isSchemaError(earned.error)
                ? { data: [], error: null }
                : { data: [], error: earned.error };
        };

        const fetchCheckins = async () => {
            const moodsResult = await supabaseAdmin
                .from('student_moods')
                .select('student_id, mood, created_at')
                .in('student_id', studentIds)
                .eq('mood', 'checkin')
                .gte('created_at', recentFrom);

            if (!moodsResult.error) {
                return { data: moodsResult.data || [], error: null };
            }

            const checkinsResult = await supabaseAdmin
                .from('checkins')
                .select('student_id, created_at')
                .in('student_id', studentIds)
                .gte('created_at', recentFrom);

            if (!checkinsResult.error) {
                return { data: checkinsResult.data || [], error: null };
            }

            return isSchemaError(moodsResult.error) || isSchemaError(checkinsResult.error)
                ? { data: [], error: null }
                : { data: [], error: checkinsResult.error };
        };

        const fetchClassMoments = async () => {
            const result = await supabaseAdmin
                .from('class_moments')
                .select('content, student_id, created_at')
                .in('student_id', studentIds)
                .gte('created_at', recentFrom)
                .limit(1200);

            if (!result.error) return { data: result.data || [], error: null };
            return isSchemaError(result.error)
                ? { data: [], error: null }
                : { data: [], error: result.error };
        };

        const [goalsResult, tasksResult, badgesResult, checkinsResult, momentsResult] = await Promise.all([
            fetchGoals(),
            fetchTasks(),
            fetchBadges(),
            fetchCheckins(),
            fetchClassMoments()
        ]);

        if (goalsResult.error) return res.status(500).json({ error: goalsResult.error.message || '加载目标数据失败' });
        if (tasksResult.error) return res.status(500).json({ error: tasksResult.error.message || '加载任务数据失败' });
        if (badgesResult.error) return res.status(500).json({ error: badgesResult.error.message || '加载徽章数据失败' });
        if (checkinsResult.error) return res.status(500).json({ error: checkinsResult.error.message || '加载签到数据失败' });
        if (momentsResult.error) return res.status(500).json({ error: momentsResult.error.message || '加载词云数据失败' });

        const statsMap = new Map(studentIds.map((studentId) => [studentId, {
            totalGoals: 0,
            completedGoals: 0,
            totalTasks: 0,
            completedTasks: 0,
            badges: 0,
            checkins: 0,
            score: 0,
            classification: 'fixed',
            factors: {
                goal_completion_rate: 0,
                task_completion_score: 0,
                checkin_score: 0,
                badge_score: 0
            }
        }]));

        for (const goal of goalsResult.data || []) {
            const stat = statsMap.get(goal.student_id);
            if (!stat) continue;
            stat.totalGoals += 1;
            if (String(goal.status || '').toLowerCase() === 'completed') {
                stat.completedGoals += 1;
            }
        }

        const isTaskDone = (task) => {
            if (tasksResult.mode === 'completed') {
                return Boolean(task?.completed);
            }
            return ['completed', 'verified'].includes(String(task?.status || '').toLowerCase());
        };

        for (const task of tasksResult.data || []) {
            const stat = statsMap.get(task.student_id);
            if (!stat) continue;
            stat.totalTasks += 1;
            if (isTaskDone(task)) {
                stat.completedTasks += 1;
            }
        }

        for (const badge of badgesResult.data || []) {
            const stat = statsMap.get(badge.student_id);
            if (stat) stat.badges += 1;
        }

        const checkinDateSetMap = new Map(studentIds.map((studentId) => [studentId, new Set()]));
        for (const checkin of checkinsResult.data || []) {
            const studentId = checkin.student_id;
            const set = checkinDateSetMap.get(studentId);
            if (!set) continue;
            const ts = new Date(checkin.created_at || '').getTime();
            if (!Number.isFinite(ts)) continue;
            const dayKey = new Date(ts).toISOString().slice(0, 10);
            set.add(dayKey);
        }
        for (const [studentId, daySet] of checkinDateSetMap.entries()) {
            const stat = statsMap.get(studentId);
            if (!stat) continue;
            stat.checkins = daySet.size;
        }

        const classifyStudentMindset = (stats) => {
            const goalCompletionRate = stats.totalGoals > 0
                ? (stats.completedGoals / stats.totalGoals)
                : 0;
            const taskCompletionScore = Math.min(1, stats.completedTasks / 8);
            const checkinScore = Math.min(1, stats.checkins / 20);
            const badgeScore = Math.min(1, stats.badges / 6);

            const score =
                goalCompletionRate * 0.45 +
                taskCompletionScore * 0.30 +
                checkinScore * 0.15 +
                badgeScore * 0.10;

            let classification = 'fixed';
            if (score >= 0.67) classification = 'growth';
            else if (score >= 0.40) classification = 'mixed';

            return {
                score: Number(score.toFixed(4)),
                classification,
                factors: {
                    goal_completion_rate: Number(goalCompletionRate.toFixed(4)),
                    task_completion_score: Number(taskCompletionScore.toFixed(4)),
                    checkin_score: Number(checkinScore.toFixed(4)),
                    badge_score: Number(badgeScore.toFixed(4))
                }
            };
        };

        const enrichedStudents = students.map((student) => {
            const stat = statsMap.get(student.id) || {
                totalGoals: 0,
                completedGoals: 0,
                totalTasks: 0,
                completedTasks: 0,
                badges: 0,
                checkins: 0,
                score: 0,
                classification: 'fixed',
                factors: {
                    goal_completion_rate: 0,
                    task_completion_score: 0,
                    checkin_score: 0,
                    badge_score: 0
                }
            };

            const mindset = classifyStudentMindset(stat);
            return {
                ...student,
                ...stat,
                score: mindset.score,
                classification: mindset.classification,
                factors: mindset.factors
            };
        });

        const classificationSummary = {
            growth: enrichedStudents.filter((item) => item.classification === 'growth').length,
            mixed: enrichedStudents.filter((item) => item.classification === 'mixed').length,
            fixed: enrichedStudents.filter((item) => item.classification === 'fixed').length
        };

        const avgValue = (getter) => enrichedStudents.length
            ? Number((enrichedStudents.reduce((sum, item) => sum + getter(item), 0) / enrichedStudents.length).toFixed(2))
            : 0;

        const distribution = {
            total_students: enrichedStudents.length,
            avg_goals: avgValue((item) => Number(item.totalGoals || 0)),
            avg_completed_goals: avgValue((item) => Number(item.completedGoals || 0)),
            avg_tasks: avgValue((item) => Number(item.completedTasks || 0)),
            avg_badges: avgValue((item) => Number(item.badges || 0)),
            avg_checkins: avgValue((item) => Number(item.checkins || 0)),
            classification: classificationSummary
        };

        // 创建 Excel 工作簿
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Growth Dashboard';
        workbook.created = new Date();

        const applyHeaderStyle = (sheet) => {
            sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFEE8C2B' }
            };
        };

        // ===== 班级心理学情概览 =====
        const summarySheet = workbook.addWorksheet('心理学情概览');
        summarySheet.columns = [
            { header: '项目', key: 'item', width: 20 },
            { header: '内容', key: 'value', width: 40 }
        ];

        const totalStudents = Math.max(1, Number(distribution.total_students || 0));
        const growthPct = `${Math.round((Number(distribution.classification.growth || 0) / totalStudents) * 100)}%`;
        const mixedPct = `${Math.round((Number(distribution.classification.mixed || 0) / totalStudents) * 100)}%`;
        const fixedPct = `${Math.round((Number(distribution.classification.fixed || 0) / totalStudents) * 100)}%`;

        summarySheet.addRows([
            { item: '报告类型', value: '班级心理学情分析报告' },
            { item: '班级名称', value: classData.name },
            { item: '学校名称', value: classData.school_name },
            { item: '邀请码', value: classData.invite_code },
            { item: '分析周期', value: '近 90 天' },
            { item: '学生人数', value: distribution.total_students },
            { item: '成长型占比', value: `${distribution.classification.growth} 人（${growthPct}）` },
            { item: '混合型占比', value: `${distribution.classification.mixed} 人（${mixedPct}）` },
            { item: '固定型占比', value: `${distribution.classification.fixed} 人（${fixedPct}）` },
            { item: '人均目标创建', value: distribution.avg_goals },
            { item: '人均目标完成', value: distribution.avg_completed_goals },
            { item: '人均任务完成', value: distribution.avg_tasks },
            { item: '人均徽章获得', value: distribution.avg_badges },
            { item: '人均打卡次数', value: distribution.avg_checkins },
            { item: '导出时间', value: new Date().toLocaleString('zh-CN') }
        ]);

        applyHeaderStyle(summarySheet);

        // ===== 学情分布 =====
        const distributionSheet = workbook.addWorksheet('学情分布');
        distributionSheet.columns = [
            { header: '类型', key: 'type', width: 14 },
            { header: '人数', key: 'count', width: 10 },
            { header: '占比', key: 'ratio', width: 12 },
            { header: '解读', key: 'interpretation', width: 44 }
        ];

        distributionSheet.addRows([
            {
                type: '成长型',
                count: distribution.classification.growth,
                ratio: growthPct,
                interpretation: '具备较强内驱力和持续完成能力，可承担同伴示范任务。'
            },
            {
                type: '混合型',
                count: distribution.classification.mixed,
                ratio: mixedPct,
                interpretation: '可塑性较高，适合通过短周期反馈转化为成长型。'
            },
            {
                type: '固定型',
                count: distribution.classification.fixed,
                ratio: fixedPct,
                interpretation: '需要优先关注学习节奏与情绪支持，建议个别辅导。'
            }
        ]);

        applyHeaderStyle(distributionSheet);

        // ===== 学生学情明细 =====
        const studentsSheet = workbook.addWorksheet('学生学情明细');
        studentsSheet.columns = [
            { header: '姓名', key: 'name', width: 15 },
            { header: '期待', key: 'dream', width: 25 },
            { header: '目标总数', key: 'totalGoals', width: 12 },
            { header: '已完成目标', key: 'completedGoals', width: 12 },
            { header: '任务总数', key: 'totalTasks', width: 12 },
            { header: '已完成任务', key: 'completedTasks', width: 12 },
            { header: '徽章数', key: 'badges', width: 10 },
            { header: '签到次数', key: 'checkins', width: 10 },
            { header: '学情评分', key: 'score', width: 10 },
            { header: '学情类型', key: 'classification', width: 12 },
            { header: '加入时间', key: 'joinedAt', width: 18 }
        ];

        enrichedStudents
            .slice()
            .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
            .forEach((student) => {
            studentsSheet.addRow({
                name: student.full_name || '-',
                dream: student.dream || '-',
                totalGoals: student.totalGoals || 0,
                completedGoals: student.completedGoals || 0,
                totalTasks: student.totalTasks || 0,
                completedTasks: student.completedTasks || 0,
                badges: student.badges || 0,
                checkins: student.checkins || 0,
                score: Number(((student.score || 0) * 100).toFixed(1)),
                classification: student.classification === 'growth' ? '成长型' : (student.classification === 'mixed' ? '混合型' : '固定型'),
                joinedAt: student.created_at ? new Date(student.created_at).toLocaleDateString('zh-CN') : '-'
            });
        });

        applyHeaderStyle(studentsSheet);

        // ===== 洞察建议 =====
        const insightSheet = workbook.addWorksheet('洞察建议');
        insightSheet.columns = [
            { header: '优先级', key: 'priority', width: 10 },
            { header: '建议标题', key: 'title', width: 26 },
            { header: '分析结论', key: 'summary', width: 44 },
            { header: '建议动作', key: 'action', width: 48 }
        ];

        const insightRows = [];
        const fixedRate = distribution.total_students > 0
            ? distribution.classification.fixed / distribution.total_students
            : 0;
        const mixedRate = distribution.total_students > 0
            ? distribution.classification.mixed / distribution.total_students
            : 0;

        if (fixedRate >= 0.25 || distribution.classification.fixed >= 3) {
            insightRows.push({
                priority: '高',
                title: '固定型学生占比较高',
                summary: `当前固定型 ${distribution.classification.fixed} 人（${Math.round(fixedRate * 100)}%），建议优先干预学习节奏。`,
                action: '建议建立“7天小目标 + 每日反馈”跟进清单，并于周末复盘完成率。'
            });
        }

        if (mixedRate >= 0.4) {
            insightRows.push({
                priority: '中',
                title: '混合型学生可重点转化',
                summary: `混合型 ${distribution.classification.mixed} 人，具备明显提升空间。`,
                action: '建议使用“目标拆解模板 + 同伴互评”，两周为一个冲刺周期。'
            });
        }

        if (Number(distribution.avg_tasks || 0) < 3) {
            insightRows.push({
                priority: '中',
                title: '任务完成活跃度偏低',
                summary: `近 90 天班级人均完成任务 ${distribution.avg_tasks} 个，执行节奏不足。`,
                action: '将任务拆分为每日 15 分钟微任务，并公布班级周完成榜。'
            });
        }

        const topPerformer = enrichedStudents.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
        if (topPerformer) {
            insightRows.push({
                priority: '低',
                title: '可利用榜样带动班级',
                summary: `${topPerformer.full_name || '优秀学生'} 的综合评分领先，适合作为学习示范。`,
                action: '建议安排 10 分钟方法分享，重点讲解目标拆解与每日复盘。'
            });
        }

        if (insightRows.length === 0) {
            insightRows.push({
                priority: '低',
                title: '班级状态整体稳定',
                summary: '当前学情结构较均衡，可继续跟踪趋势变化。',
                action: '保持周节奏追踪，并在连续两周波动时启动专题干预。'
            });
        }

        insightSheet.addRows(insightRows);
        applyHeaderStyle(insightSheet);

        // ===== 词云分析 =====
        const wordCloudSheet = workbook.addWorksheet('词云分析');
        wordCloudSheet.columns = [
            { header: '关键词', key: 'word', width: 20 },
            { header: '出现次数', key: 'count', width: 12 },
            { header: '热度等级', key: 'level', width: 14 }
        ];

        const stopwords = new Set(['我们', '你们', '他们', '今天', '昨天', '这个', '那个', '老师', '同学', '学生', '自己', '已经', '然后', '因为', '所以', '任务', '目标', '完成', '进行']);
        const counter = new Map();
        const addWord = (word) => {
            const safe = String(word || '').trim().toLowerCase();
            if (!safe || safe.length < 2) return;
            if (stopwords.has(safe)) return;
            counter.set(safe, (counter.get(safe) || 0) + 1);
        };

        (momentsResult.data || []).forEach((row) => {
            const content = String(row.content || '').trim();
            if (!content) return;
            const zhTokens = content.match(/[\u4e00-\u9fff]{2,}/g) || [];
            const enTokens = content.toLowerCase().match(/[a-z]{2,}/g) || [];
            zhTokens.forEach(addWord);
            enTokens.forEach(addWord);
        });

        const wordRows = Array.from(counter.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([word, count]) => ({
                word,
                count,
                level: count >= 8 ? '高' : (count >= 4 ? '中' : '低')
            }));

        if (wordRows.length > 0) {
            wordCloudSheet.addRows(wordRows);
        } else {
            wordCloudSheet.addRow({ word: '暂无可用文本', count: 0, level: '-' });
        }
        applyHeaderStyle(wordCloudSheet);

        // 设置响应头
        const dateText = new Date().toISOString().split('T')[0];
        const safeClassName = String(classData.name || '班级').replace(/[\\/:*?"<>|]/g, '-').trim() || '班级';
        const fileName = `${dateText}_${safeClassName}_数据分析.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

        // 写入响应
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Export class report error:', error);
        res.status(500).json({ error: '导出失败：' + error.message });
    }
};

// ============================================
// 辅助函数
// ============================================

function getStatusText(status) {
    const statusMap = {
        'active': '进行中',
        'in_progress': '进行中',
        'completed': '已完成',
        'paused': '已暂停',
        'cancelled': '已取消'
    };
    return statusMap[status] || status;
}

module.exports = {
    exportStudentReport,
    exportClassReport
};
