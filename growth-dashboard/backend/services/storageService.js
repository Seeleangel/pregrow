const { supabaseAdmin } = require('../middlewares/auth');

const uploadBase64Image = async (base64Data, fileName, mimeType) => {
    try {
        const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        const buffer = Buffer.from(rawBase64, 'base64');

        const bucketName = 'public_images';

        const { data, error } = await supabaseAdmin
            .storage
            .from(bucketName)
            .upload(fileName, buffer, {
                contentType: mimeType,
                upsert: true
            });

        if (error) {
            console.error('Storage upload error:', error);
            throw error;
        }

        const { data: publicUrlData } = supabaseAdmin
            .storage
            .from(bucketName)
            .getPublicUrl(fileName);

        return publicUrlData.publicUrl;

    } catch (err) {
        console.error('Service: uploadBase64Image failed:', err.message);
        throw err;
    }
};

module.exports = { uploadBase64Image };
