const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const users = require('../users');

// 배포 서버(Render 등)에는 Shell 접속이 없어서 scripts/createAdmin.js를 직접 실행할 수
// 없어요. 그 대신 이 라우트로 딱 한 번, 비밀키를 아는 사람만 원격으로 admin 계정을
// 만들거나 승격시킬 수 있게 해요.
//
// 사용법 (ADMIN_BOOTSTRAP_SECRET을 서버 환경변수로 설정한 뒤):
//   curl -X POST https://<서버주소>/api/admin/bootstrap \
//     -H "Content-Type: application/json" \
//     -H "x-bootstrap-secret: <ADMIN_BOOTSTRAP_SECRET 값>" \
//     -d '{"email":"admin@example.com","password":"충분히-긴-비밀번호"}'
//
// ADMIN_BOOTSTRAP_SECRET이 서버에 설정돼 있지 않으면 이 라우트는 404로 숨겨져요 —
// 즉 이 기능을 쓰려면 반드시 먼저 환경변수를 설정해야 하고, 다 쓴 뒤에는 환경변수를
// 지워서 라우트를 다시 비활성화하는 걸 권장해요.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/bootstrap', async (req, res) => {
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!secret) {
    return res.status(404).end();
  }
  if (req.get('x-bootstrap-secret') !== secret) {
    return res.status(401).json({ error: '비밀키가 올바르지 않아요.' });
  }

  const { email, password, nickname } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: '올바른 이메일을 입력해주세요.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: '비밀번호는 8자 이상이어야 해요.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = users.findByEmail(email);

  let user;
  if (existing) {
    users.setRole(existing.id, 'admin');
    user = users.setPasswordHash(existing.id, passwordHash);
  } else {
    user = users.createUser({ email, passwordHash, nickname, role: 'admin' });
  }

  res.status(existing ? 200 : 201).json(users.toPublicUser(user));
});

module.exports = router;
