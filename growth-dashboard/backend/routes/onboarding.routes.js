/**
 * Onboarding Routes
 * 用户引导相关路由
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const onboardingController = require('../controllers/onboarding.controller');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// ============================================
// Onboarding
// ============================================
router.get('/status', onboardingController.getOnboardingStatus);
router.post('/step', onboardingController.updateOnboardingStep);
router.post('/complete', onboardingController.completeOnboarding);

module.exports = router;
