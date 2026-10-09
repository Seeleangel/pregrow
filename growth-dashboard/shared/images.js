/**
 * Image URL Helper
 * Supabase Storage 图片 URL 生成
 */

// Supabase Storage 公开访问 URL
const STORAGE_BASE_URL = 'https://your-project.supabase.co/storage/v1/object/public/images';

/**
 * 获取 Supabase Storage 中的图片 URL
 * @param {string} path - 图片在 Storage 中的相对路径
 * @returns {string} 完整的图片 URL
 */
function getImageUrl(path) {
    if (!path) return '';
    // 如果已经是完整 URL，直接返回
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    // 如果是 /img/ 或 /student/img/ 开头的相对路径，转换为 Storage URL
    if (path.startsWith('/img/') || path.startsWith('/student/img/')) {
        return `${STORAGE_BASE_URL}${path}`;
    }
    // 其他情况，直接拼接
    return `${STORAGE_BASE_URL}/${path}`;
}

/**
 * 获取挑战图片 URL
 * @param {string} filename - 文件名（如 'a_1.png'）
 * @returns {string} 完整的图片 URL
 */
function getChallengeImageUrl(filename) {
    return getImageUrl(`/student/img/challenges/${filename}`);
}

/**
 * 获取背景图片 URL
 * @param {string} filename - 文件名
 * @returns {string} 完整的图片 URL
 */
function getBackgroundImageUrl(filename) {
    return getImageUrl(`/student/img/login/${filename}`);
}

/**
 * 批量转换图片路径数组
 * @param {string[]} paths - 路径数组
 * @returns {string[]} URL 数组
 */
function batchGetImageUrls(paths) {
    if (!Array.isArray(paths)) return [];
    return paths.map(path => getImageUrl(path));
}

// 导出到全局
window.getImageUrl = getImageUrl;
window.getChallengeImageUrl = getChallengeImageUrl;
window.getBackgroundImageUrl = getBackgroundImageUrl;
window.batchGetImageUrls = batchGetImageUrls;
