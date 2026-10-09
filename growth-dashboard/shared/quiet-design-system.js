/**
 * 内敛设计系统 - Quiet Design System
 * 降低视觉强度，创造更精致、专业的视觉体验
 */

// 内敛版配色方案
const QUIET_COLORS = {
    // 主色 - 从亮绿改为柔和鼠尾草绿
    primary: {
        DEFAULT: '#7a9e7a',      // 柔和的鼠尾草绿，饱和度降低
        light: '#a8c4a8',        // 浅绿，用于hover状态
        dark: '#5a7a5a',         // 深绿，用于active状态
        muted: '#e8f0e8',        // 极淡的背景色
    },

    // 中性色 - 更温暖的灰褐色
    neutral: {
        50: '#fdfcfa',           // 几乎纯白，略带暖调
        100: '#f8f6f2',          // 浅米色背景
        200: '#ede9e2',          // 边框色
        300: '#ddd6c9',          // 分隔线
        400: '#b8b0a0',          // 次要文字
        500: '#8a8274',          // 次要文字
        600: '#6b6458',          // 主要文字
        700: '#4a443c',          // 标题文字
        800: '#2d2924',          // 深色文字
        900: '#1a1815',          // 近乎黑色
    },

    // 功能色 - 降低饱和度
    accent: {
        yellow: '#d4c4a0',       // 柔和的暖黄（原为 #fcd34d）
        orange: '#c9a87a',       // 柔和的橙棕（与登录页协调）
        blue: '#8ba3b8',         // 柔和的灰蓝
        red: '#c98b8b',          // 柔和的玫瑰红
    },

    // 背景色
    background: {
        light: '#f9f7f3',        // 温暖的米白（比原 #FDF5E6 更柔和）
        dark: '#2a2722',         // 深暖灰（比原 #292520 更柔和）
        card: '#ffffff',         // 纯白卡片
        cardDark: '#35322c',     // 深色卡片
    },
};

// 内敛版阴影系统
const QUIET_SHADOWS = {
    // 移除3D bubbly阴影，改用微妙的平面阴影
    sm: '0 1px 2px 0 rgba(74, 68, 60, 0.04)',
    DEFAULT: '0 2px 4px -1px rgba(74, 68, 60, 0.06), 0 1px 2px -1px rgba(74, 68, 60, 0.04)',
    md: '0 4px 6px -1px rgba(74, 68, 60, 0.05), 0 2px 4px -2px rgba(74, 68, 60, 0.04)',
    lg: '0 10px 15px -3px rgba(74, 68, 60, 0.06), 0 4px 6px -4px rgba(74, 68, 60, 0.03)',
    xl: '0 20px 25px -5px rgba(74, 68, 60, 0.08), 0 8px 10px -6px rgba(74, 68, 60, 0.02)',

    // 内阴影
    inner: 'inset 0 1px 2px 0 rgba(74, 68, 60, 0.04)',

    // 移除了 warm-glow 和 bubbly 阴影
};

// 内敛版圆角
const QUIET_RADIUS = {
    none: '0',
    sm: '0.375rem',      // 6px
    DEFAULT: '0.625rem', // 10px - 比原 0.875rem 更小
    md: '0.75rem',       // 12px
    lg: '0.875rem',      // 14px - 比原 1.25rem 更小
    xl: '1rem',          // 16px - 比原 1.75rem 更小
    '2xl': '1.25rem',    // 20px - 比原 2.25rem 更小
    full: '9999px',
};

// 内敛版字体设置
const QUIET_TYPOGRAPHY = {
    // 移除 ZCOOL KuaiLe，统一使用 Noto Sans SC
    fontFamily: {
        display: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
        body: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
    },

    // 字重降低
    fontWeight: {
        light: 300,
        normal: 400,
        medium: 500,
        semibold: 600,    // 最高到600，不使用700/900
    },

    // 字号更克制
    fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],     // 比原 1.5rem 小
        '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 比原 2rem 小
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 比原 2.5rem 小
    },
};

// 内敛版动画
const QUIET_ANIMATIONS = {
    // 移除弹性动画，改用柔和的 ease-out
    fadeIn: {
        '0%': { opacity: '0', transform: 'translateY(8px)' },
        '100%': { opacity: '1', transform: 'translateY(0)' },
    },

    // 更微妙的悬停效果
    hover: {
        scale: 1.02,      // 原 1.03 改为 1.02
        duration: '0.2s',
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)', // ease-out-quart
    },

    // 按钮按压效果
    press: {
        scale: 0.98,
        duration: '0.1s',
        easing: 'ease-out',
    },
};

// 间距系统 - 更宽松的呼吸感
const QUIET_SPACING = {
    // 整体增加间距，减少密度
    section: '2rem',      // 区块间距
    card: '1.5rem',       // 卡片内边距
    element: '1rem',      // 元素间距
    tight: '0.5rem',      // 紧凑间距
};

// 导出完整的 Tailwind 配置
window.QUIET_DESIGN_SYSTEM = {
    colors: QUIET_COLORS,
    shadows: QUIET_SHADOWS,
    radius: QUIET_RADIUS,
    typography: QUIET_TYPOGRAPHY,
    animations: QUIET_ANIMATIONS,
    spacing: QUIET_SPACING,
};

// 生成 Tailwind 配置对象的辅助函数
window.generateQuietTailwindConfig = function() {
    return {
        darkMode: "class",
        theme: {
            extend: {
                colors: {
                    primary: QUIET_COLORS.primary,
                    neutral: QUIET_COLORS.neutral,
                    accent: QUIET_COLORS.accent,
                    background: QUIET_COLORS.background,
                },
                fontFamily: QUIET_TYPOGRAPHY.fontFamily,
                borderRadius: QUIET_RADIUS,
                boxShadow: QUIET_SHADOWS,
            },
        },
    };
};
