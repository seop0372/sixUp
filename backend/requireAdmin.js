// 로그인은 했지만 관리자가 아니면 403으로 막는 미들웨어예요.
// requireAuth 뒤에 붙여서 "로그인 여부"와 "관리자 여부"를 각각 다른 상태 코드로 구분해요.
const users = require('./users');

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  const user = users.findById(req.session.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 접근할 수 있어요.' });
  }
  next();
}

module.exports = requireAdmin;
