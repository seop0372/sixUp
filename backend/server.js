require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const curriculumRoutes = require('./routes/curriculum');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API 라우트
app.use('/api/curriculum', curriculumRoutes);

// 프론트엔드 정적 파일 서빙 (frontend/public 폴더)
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'SixUp 서버 켜졌어요! 🎉' });
});

app.listen(PORT, () => {
  console.log(`SixUp 서버 실행 중: http://localhost:${PORT}`);
});
