/**
 * 内敛版 Tailwind 配置 - Quiet Tailwind Config
 * 用于学生端页面的视觉降档
 */

tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                // 主色 - 柔和的鼠尾草绿
                "primary": "#7a9e7a",
                "primary-dark": "#5a7a5a",
                "primary-light": "#a8c4a8",
                "primary-muted": "#e8f0e8",

                // 背景色
                "beige-bg": "#f9f7f3",
                "beige-card": "#fdfcfa",
                "warm-border": "#e8e4dc",

                // 强调色 - 降低饱和度
                "accent-yellow": "#d4c4a0",
                "accent-orange": "#c9a87a",

                // 文字色
                "text-main": "#4a443c",
                "text-sub": "#7a7468",

                // 深色模式
                "background-dark": "#2a2722",
                "surface-dark": "#35322c",
            },
            fontFamily: {
                // 移除 ZCOOL KuaiLe，统一使用 Noto Sans SC
                "display": ["Noto Sans SC", "system-ui", "sans-serif"],
                "body": ["Noto Sans SC", "system-ui", "sans-serif"]
            },
            borderRadius: {
                // 减小的圆角
                "DEFAULT": "0.625rem",
                "lg": "0.875rem",
                "xl": "1rem",
                "2xl": "1.25rem",
                "full": "9999px"
            },
            boxShadow: {
                // 内敛的阴影 - 移除 bubbly 和 warm-glow
                'soft': '0 4px 20px -4px rgba(74, 68, 60, 0.08)',
                'card': '0 2px 4px -1px rgba(74, 68, 60, 0.04), 0 4px 8px -2px rgba(74, 68, 60, 0.03)',
                // 移除了 bubbly 和 warm-glow
            }
        },
    },
};
