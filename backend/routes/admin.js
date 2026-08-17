const express = require('express');
const router = express.Router();
const users = require('../users');
const requireAuth = require('../requireAuth');
const requireAdmin = require('../requireAdmin');

// 이 라우터 전체는 로그인 + 관리자 role을 모두 만족해야 써요.
router.use(requireAuth, requireAdmin);

// GET /api/admin/users - 전체 회원 목록 (관리자 전용)
router.get('/users', (req, res) => {
  const list = users.findAll().map(users.toPublicUser);
  res.json(list);
});

module.exports = router;
