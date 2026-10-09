const express = require('express');
const router = express.Router();
const { requireAuth, supabaseAdmin } = require('../middlewares/auth');

router.get('/teacher/:id/class', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('classes').select('*').eq('teacher_id', req.params.id).single();
        if (error) return res.status(404).json({ error: 'Class not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/student/:id/class/join', requireAuth, async (req, res) => {
    const { inviteCode } = req.body;
    try {
        const { data: cls } = await supabaseAdmin.from('classes').select('id, name, school_name').eq('invite_code', inviteCode.trim().toUpperCase()).single();
        if (!cls) return res.status(404).json({ error: 'Invalid invite code' });

        await supabaseAdmin.from('profiles').update({ class_id: cls.id, class_name: cls.name, school_name: cls.school_name }).eq('id', req.params.id);
        res.json({ message: 'Success', classInfo: cls });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
