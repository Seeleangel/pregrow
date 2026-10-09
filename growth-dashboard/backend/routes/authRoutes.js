const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../middlewares/auth');

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
        if (error) return res.status(400).json({ error: error.message });

        const user = data.user;
        const { data: profile } = await supabaseAdmin.from('profiles').select('role, class_id').eq('id', user.id).single();

        res.json({ session: data.session, user, role: profile?.role || 'student', class_id: profile?.class_id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
