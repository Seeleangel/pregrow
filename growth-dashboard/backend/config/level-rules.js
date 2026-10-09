const toSafePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return parsed;
};

const LEVEL_RULES = Object.freeze({
    xpPerCompletedTask: toSafePositiveInt(process.env.LEVEL_XP_PER_TASK, 10),
    xpPerBadge: toSafePositiveInt(process.env.LEVEL_XP_PER_BADGE, 25),
    xpPerStreakDay: toSafePositiveInt(process.env.LEVEL_XP_PER_STREAK_DAY, 3),
    maxStreakBonusDays: toSafePositiveInt(process.env.LEVEL_MAX_STREAK_BONUS_DAYS, 14),
    baseLevelXp: toSafePositiveInt(process.env.LEVEL_BASE_XP, 100),
    levelStepXp: toSafePositiveInt(process.env.LEVEL_STEP_XP, 40),
    maxLevel: toSafePositiveInt(process.env.LEVEL_MAX, 99)
});

module.exports = {
    LEVEL_RULES
};
