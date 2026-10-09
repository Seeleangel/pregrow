/**
 * Challenge Routes
 * 挑战系统路由
 */

const express = require('express');
const router = express.Router();
const challengeController = require('../controllers/challenge.controller');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// Random Challenge
router.get('/random', challengeController.getRandomChallenge);

// Submit Challenge
router.post('/submit', challengeController.submitChallenge);

// Challenge Summary
router.post('/summary', challengeController.getChallengeSummary);

module.exports = router;
