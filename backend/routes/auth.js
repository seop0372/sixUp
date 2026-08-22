const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const users = require('../users');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setSession(req, userId) {
  req.session.userId = userId;
}

// POST /api/auth/signup  { email, password, nickname, adminSecret }
// adminSecret은 화면에 노출된 필드가 아니라, ADMIN_BOOTSTRAP_SECRET을 아는 사람만
// (프론트 URL에 ?adminSecret=... 붙여서) 회원가입과 동시에 admin으로 가입할 수 있게
// 하는 숨겨진 통로예요. 값이 없거나 서버 설정과 다르면 그냥 평범한 회원가입이에요.
router.post('/signup', async (req, res) => {
  const { email, password, nickname, adminSecret } = req.body;

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: '올바른 이메일을 입력해주세요.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: '비밀번호는 8자 이상이어야 해요.' });
  }
  if (users.findByEmail(email)) {
    return res.status(409).json({ error: '이미 가입된 이메일이에요.' });
  }

  const configuredSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  const role = configuredSecret && adminSecret === configuredSecret ? 'admin' : 'user';

  const passwordHash = await bcrypt.hash(password, 10);
  const user = users.createUser({ email, passwordHash, nickname, role });
  setSession(req, user.id);
  res.status(201).json(users.toPublicUser(user));
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.findByEmail(email);

  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않아요.' });
  }

  const match = await bcrypt.compare(password || '', user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않아요.' });
  }

  setSession(req, user.id);
  res.json(users.toPublicUser(user));
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  const user = users.findById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  res.json(users.toPublicUser(user));
});

// GET /api/auth/kakao — 카카오 로그인 동의 화면으로 리다이렉트해요.
router.get('/kakao', (req, res) => {
  const clientId = process.env.KAKAO_REST_API_KEY;
  const redirectUri = process.env.KAKAO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res
      .status(500)
      .send('카카오 로그인이 아직 설정되지 않았어요. 서버 .env에 KAKAO_REST_API_KEY / KAKAO_REDIRECT_URI를 채워주세요.');
  }

  const authorizeUrl =
    'https://kauth.kakao.com/oauth/authorize' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    '&response_type=code';

  res.redirect(authorizeUrl);
});

// GET /api/auth/kakao/callback?code=... — 카카오가 인가 코드를 들고 돌아오는 콜백이에요.
router.get('/kakao/callback', async (req, res) => {
  const { code, error } = req.query;
  const clientId = process.env.KAKAO_REST_API_KEY;
  const redirectUri = process.env.KAKAO_REDIRECT_URI;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;

  if (error) {
    return res.redirect('/?kakaoError=' + encodeURIComponent(String(error)));
  }
  if (!code || !clientId || !redirectUri) {
    return res.redirect('/?kakaoError=missing_code');
  }

  try {
    // 1) 인가 코드를 액세스 토큰으로 교환해요.
    // Kakao Developers에서 Client Secret을 "사용함"으로 켠 경우에만 필요하지만,
    // 켜져 있는데 안 보내면 토큰 교환이 실패해서 설정돼 있으면 항상 같이 보내요.
    const tokenParams = {
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code: String(code),
    };
    if (clientSecret) {
      tokenParams.client_secret = clientSecret;
    }

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('카카오 토큰 교환 실패', tokenData);
      return res.redirect('/?kakaoError=token_exchange_failed');
    }

    // 2) 액세스 토큰으로 카카오 프로필을 가져와요.
    const profileRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profileData = await profileRes.json();
    if (!profileRes.ok || !profileData.id) {
      console.error('카카오 프로필 조회 실패', profileData);
      return res.redirect('/?kakaoError=profile_fetch_failed');
    }

    const kakaoId = String(profileData.id);
    const nickname =
      (profileData.kakao_account && profileData.kakao_account.profile && profileData.kakao_account.profile.nickname) ||
      (profileData.properties && profileData.properties.nickname) ||
      null;

    // 3) 처음 온 사람이면 계정을 새로 만들고, 아니면 기존 계정으로 로그인해요.
    let user = users.findByKakaoId(kakaoId);
    if (!user) {
      user = users.createKakaoUser({ kakaoId, nickname });
    }

    setSession(req, user.id);
    res.redirect('/?kakaoLogin=1');
  } catch (err) {
    console.error('카카오 로그인 처리 중 오류', err);
    res.redirect('/?kakaoError=unexpected');
  }
});

module.exports = router;
