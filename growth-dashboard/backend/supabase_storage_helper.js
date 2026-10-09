/**
 * Supabase Storage URL 生成示例
 *
 * 在图片上传完成后，使用这些辅助函数来获取图片的公开访问 URL
 */

// 从环境变量读取 Supabase Storage URL，如果没有则使用默认值
const STORAGE_BASE_URL = process.env.SUPABASE_STORAGE_URL || 'https://your-project.supabase.co/storage/v1/object/public/images';

/**
 * 获取 Supabase Storage 中的图片 URL
 * @param {string} path - 图片在 Storage 中的相对路径
 * @returns {string} 完整的图片 URL
 *
 * @example
 * getImageUrl('img/好朋友不和我一起玩儿.png')
 * // 返回: https://your-project.supabase.co/storage/v1/object/public/images/img/好朋友不和我一起玩儿.png
 */
function getImageUrl(path) {
    const rawPath = String(path || '').trim();
    if (!rawPath) return '';

    if (/^https?:\/\//i.test(rawPath)) {
        return rawPath;
    }

    const normalizedBase = String(STORAGE_BASE_URL || '').replace(/\/+$/, '');
    const cleanedPath = rawPath.replace(/^\/+/, '');

    const encodedPath = cleanedPath
        .split('/')
        .filter(Boolean)
        .map((segment) => {
            try {
                return encodeURIComponent(decodeURIComponent(segment));
            } catch (_) {
                return encodeURIComponent(segment);
            }
        })
        .join('/');

    return `${normalizedBase}/${encodedPath}`;
}

/**
 * 获取挑战图片 URL
 * @param {string} filename - 文件名（如 'a_1.png'）
 * @returns {string} 完整的图片 URL
 */
function getChallengeImageUrl(filename) {
    return getImageUrl(`student/img/challenges/${filename}`);
}

/**
 * 获取用户上传的图片 URL
 * @param {string} filename - 文件名（如 'avatar_xxx.png'）
 * @returns {string} 完整的图片 URL
 */
function getUploadedImageUrl(filename) {
    return getImageUrl(`img/uploads/${filename}`);
}

/**
 * 获取背景图片 URL
 * @param {string} filename - 文件名
 * @returns {string} 完整的图片 URL
 */
function getBackgroundImageUrl(filename) {
    return getImageUrl(`student/img/login/${filename}`);
}

/**
 * 批量转换图片路径数组
 * @param {string[]} paths - 路径数组
 * @returns {string[]} URL 数组
 */
function batchGetImageUrls(paths) {
    return paths.map(path => getImageUrl(path));
}

// ============================================
// 使用示例
// ============================================

// 示例 3: 在 HTML 中使用
/*
// 在前端页面中
function setChallengeImage(imgElement, filename) {
    imgElement.src = getChallengeImageUrl(filename);
}

// 使用
const img = document.getElementById('challenge-img');
setChallengeImage(img, 'a_1.png');
*/

// 示例 4: 在 React/Vue 中使用
/*
// React 组件示例
function ChallengeImage({ filename }) {
    const imageUrl = getChallengeImageUrl(filename);
    return <img src={imageUrl} alt="Challenge" />;
}

// Vue 组件示例
// <template>
//   <img :src="challengeImageUrl" />
// </template>
//
// <script>
// export default {
//   computed: {
//     challengeImageUrl() {
//       return getChallengeImageUrl('a_1.png');
//     }
//   }
// }
// </script>
*/

// ============================================
// 迁移辅助函数
// ============================================

/**
 * 迁移代码中的旧图片路径到新 URL
 * 可以使用这个函数来批量替换代码中的图片路径
 *
 * @param {string} oldPath - 旧的相对路径
 * @returns {string} 新的 Supabase URL
 *
 * @example
 * // 旧的: /img/好朋友不和我一起玩儿.png
 * // 新的: https://...
 *
 * migrateImagePath('/img/好朋友不和我一起玩儿.png')
 */
function migrateImagePath(oldPath) {
    // 移除开头的 /img/ 或 /student/img/
    const newPath = oldPath.replace(/^\/(student\/)?img\//, '');

    // 如果是 challenges 目录，需要加上前缀
    if (oldPath.includes('/challenges/')) {
        return getImageUrl(`student/img/${newPath}`);
    }

    // 如果是 uploads 目录
    if (oldPath.includes('/uploads/')) {
        return getImageUrl(`img/${newPath}`);
    }

    // 其他情况
    return getImageUrl(newPath);
}

// 使用正则表达式批量替换的示例
/*
// 在项目中搜索并替换：
// 查找: src="/img/
// 替换: src="https://your-project.supabase.co/storage/v1/object/public/images/img/
//
// 查找: src="/student/img/
// 替换: src="https://your-project.supabase.co/storage/v1/object/public/images/student/img/
*/

module.exports = {
    getImageUrl,
    getChallengeImageUrl,
    getUploadedImageUrl,
    getBackgroundImageUrl,
    batchGetImageUrls,
    migrateImagePath,
    STORAGE_BASE_URL
};
