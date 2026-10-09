const express = require('express');
const router = express.Router();
const path = require('path');
const { uploadBase64Image } = require('../services/storageService');
const { requireAuth, supabaseAdmin } = require('../middlewares/auth');

router.post('/student/:id/avatar/upload', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { fileName, mimeType, dataBase64 } = req.body;

    if (!fileName || !mimeType || !dataBase64) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        const ext = path.extname(fileName) || '.png';
        const finalName = `avatars/avatar_${id}_${Date.now()}${ext}`;
        const avatarUrl = await uploadBase64Image(dataBase64, finalName, mimeType);

        await supabaseAdmin.from('profiles').update({ avatar_url: avatarUrl }).eq('id', id);
        res.json({ avatar_url: avatarUrl, message: 'Upload success' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/class/moments/upload', requireAuth, async (req, res) => {
    const { fileName, mimeType, dataBase64 } = req.body;

    if (!fileName || !mimeType || !dataBase64) return res.status(400).json({ error: 'Missing parameters' });

    try {
        const ext = path.extname(fileName) || (mimeType.startsWith('image') ? '.png' : '.mp3');
        const finalName = `moments/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
        const publicUrl = await uploadBase64Image(dataBase64, finalName, mimeType);

        res.json({ media_url: publicUrl, media_type: mimeType.startsWith('image') ? 'image' : 'audio' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
