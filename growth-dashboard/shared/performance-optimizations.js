/**
 * 性能优化脚本
 * 包含懒加载、图片优化回退等功能
 */

(function() {
    'use strict';

    // ===== 1. 图片懒加载 =====
    function initLazyLoading() {
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        loadImage(img);
                        observer.unobserve(img);
                    }
                });
            }, {
                rootMargin: '50px 0px',
                threshold: 0.01
            });

            // 观察所有带有 data-src 的图片
            document.querySelectorAll('img[data-src]').forEach(img => {
                imageObserver.observe(img);
            });

            // 观察所有非首屏图片
            document.querySelectorAll('img[loading="lazy"]').forEach((img, index) => {
                if (index > 3) { // 前4张图片不延迟加载
                    imageObserver.observe(img);
                }
            });
        } else {
            // 回退：立即加载所有图片
            document.querySelectorAll('img[data-src]').forEach(loadImage);
        }
    }

    function loadImage(img) {
        const src = img.getAttribute('data-src');
        const srcset = img.getAttribute('data-srcset');

        if (src) {
            img.src = src;
            img.removeAttribute('data-src');
        }
        if (srcset) {
            img.srcset = srcset;
            img.removeAttribute('data-srcset');
        }

        img.classList.add('loaded');
    }

    // ===== 2. WebP 支持检测与回退 =====
    function checkWebPSupport() {
        return new Promise((resolve) => {
            const webP = new Image();
            webP.onload = webP.onerror = function() {
                resolve(webP.height === 2);
            };
            webP.src = 'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
        });
    }

    // ===== 3. 背景图片响应式加载 =====
    function initResponsiveBackground() {
        const body = document.body;
        const bgFallback = body.getAttribute('data-bg-fallback');

        if (!bgFallback) return;

        // 检测 WebP 支持
        checkWebPSupport().then(supportsWebP => {
            if (!supportsWebP) {
                // 如果不支持 WebP，使用远程 PNG 作为回退
                body.style.backgroundImage = `url('${bgFallback}')`;
            }
        });

        // 根据屏幕宽度选择合适的图片尺寸
        const width = window.innerWidth;
        let sizeSuffix = '';

        if (width <= 480) {
            sizeSuffix = '-480';
        } else if (width <= 768) {
            sizeSuffix = '-768';
        } else if (width <= 1200) {
            sizeSuffix = '-1200';
        }

        // 尝试加载响应式尺寸
        if (sizeSuffix) {
            const currentBg = body.style.backgroundImage;
            const responsiveUrl = currentBg.replace('login_bk.webp', `login_bk${sizeSuffix}.webp`);

            const testImg = new Image();
            testImg.onload = function() {
                body.style.backgroundImage = responsiveUrl;
            };
            testImg.src = responsiveUrl.replace(/url\(['"]?|['"]?\)$/g, '');
        }
    }

    // ===== 4. 预加载关键资源 =====
    function preloadCriticalResources() {
        const criticalResources = [
            // 预加载关键图片
            { as: 'image', href: 'student/img/login/login_bk-768.webp', media: '(max-width: 768px)' },
            { as: 'image', href: 'student/img/login/login_bk-1200.webp', media: '(min-width: 769px)' }
        ];

        criticalResources.forEach(resource => {
            if (resource.media && !window.matchMedia(resource.media).matches) {
                return;
            }

            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = resource.as;
            link.href = resource.href;
            if (resource.media) {
                link.media = resource.media;
            }
            document.head.appendChild(link);
        });
    }

    // ===== 5. 图片错误处理 =====
    function initImageErrorHandling() {
        document.addEventListener('error', function(e) {
            const target = e.target;
            if (target.tagName === 'IMG') {
                // 如果 WebP 加载失败，尝试 PNG
                const src = target.src;
                if (src && src.endsWith('.webp')) {
                    target.src = src.replace('.webp', '.png');
                }

                // 添加错误标记，避免循环
                if (!target.hasAttribute('data-load-failed')) {
                    target.setAttribute('data-load-failed', 'true');
                }
            }
        }, true);
    }

    // ===== 6. 网络状态感知 =====
    function initNetworkAwareness() {
        if ('connection' in navigator) {
            const connection = navigator.connection;

            // 在慢速网络下禁用自动播放和减少动画
            if (connection.saveData || connection.effectiveType === '2g' || connection.effectiveType === 'slow-2g') {
                document.documentElement.classList.add('data-saver');
            }

            // 监听网络变化
            connection.addEventListener('change', function() {
                if (connection.saveData) {
                    document.documentElement.classList.add('data-saver');
                } else {
                    document.documentElement.classList.remove('data-saver');
                }
            });
        }
    }

    // ===== 初始化 =====
    function init() {
        // 立即执行的关键优化
        initResponsiveBackground();
        preloadCriticalResources();

        // DOM 就绪后执行的优化
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                initLazyLoading();
                initImageErrorHandling();
                initNetworkAwareness();
            });
        } else {
            initLazyLoading();
            initImageErrorHandling();
            initNetworkAwareness();
        }
    }

    init();
})();
