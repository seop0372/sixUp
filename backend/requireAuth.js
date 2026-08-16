// 세션에 로그인된 사용자가 없으면 401로 막는 미들웨어예요.
// 커리큘럼 라우트 전체에 붙여서, 로그인 안 한 사람은 API 자체를 못 쓰게 해요.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

module.exports = requireAuth;
