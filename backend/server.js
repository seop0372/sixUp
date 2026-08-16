require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const curriculumRoutes = require('./routes/curriculum');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 로그인 세션이에요. 프론트가 같은 origin(같은 포트)에서 서빙되니
// 쿠키 옵션은 기본값으로도 문제없어요.
// MVP 단계라 기본 MemoryStore를 쓰는데, 서버 재시작하면 세션이 날아가요 —
// 나중에 사용자 늘면 connect-redis 같은 걸로 옮기면 돼요.
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7일
    },
  })
);

// API 라우트
app.use('/api/curriculum', curriculumRoutes);
app.use('/api/auth', authRoutes);

// 프론트엔드 정적 파일 서빙 (frontend/public 폴더)
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'SixUp 서버 켜졌어요! 🎉' });
});

app.listen(PORT, () => {
  console.log(`SixUp 서버 실행 중: http://localhost:${PORT}`);
});
