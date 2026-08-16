// storage.js와 같은 패턴의 아주 간단한 파일 기반 사용자 저장소예요.
// MVP 단계라 진짜 DB 대신 data/users.json에 배열로 저장해요.

const fs = require('fs');
const path = require('path');

// DATA_DIR을 지정하면 그 경로를 쓰고(Render Persistent Disk 마운트 경로 등),
// 없으면 로컬 개발 때처럼 backend/data를 써요.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
  }
}

function readAll() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeAll(list) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// 스트릭은 한국 사용자 기준 "하루"로 세는 게 자연스러워서, 서버 시간대와 무관하게
// 항상 한국시간(KST, UTC+9) 기준 YYYY-MM-DD로 날짜를 계산해요.
function kstDateString(date) {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const kst = new Date(utcMs + 9 * 60 * 60000);
  return kst.toISOString().slice(0, 10);
}

const defaultStreak = () => ({ current: 0, longest: 0, lastActiveDate: null });

function findByEmail(email) {
  const normalized = normalizeEmail(email);
  return readAll().find((u) => u.email === normalized) || null;
}

function findByKakaoId(kakaoId) {
  return readAll().find((u) => u.kakaoId === kakaoId) || null;
}

function findById(id) {
  return readAll().find((u) => u.id === id) || null;
}

// email + passwordHash 조합으로 계정을 만들어요. (카카오로 만든 계정은 passwordHash가 없어요.)
function createUser({ email, passwordHash, nickname }) {
  const list = readAll();
  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    email: normalizeEmail(email),
    passwordHash: passwordHash || null,
    kakaoId: null,
    nickname: nickname || null,
    phone: null, // 나중에 리마인더 기능에서 채울 필드예요.
    streak: defaultStreak(),
  };
  list.unshift(record);
  writeAll(list);
  return record;
}

// 카카오 로그인으로 처음 들어온 사용자를 계정으로 만들어요.
function createKakaoUser({ kakaoId, nickname }) {
  const list = readAll();
  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    email: null,
    passwordHash: null,
    kakaoId,
    nickname: nickname || null,
    phone: null,
    streak: defaultStreak(),
  };
  list.unshift(record);
  writeAll(list);
  return record;
}

// 오늘 할 일을 하나라도 완료했을 때 호출해요. 어제도 활동했으면 스트릭을 이어가고,
// 아니면 1로 리셋해요. 같은 날 여러 번 호출돼도 중복으로 늘어나지 않아요.
function updateStreak(userId) {
  const list = readAll();
  const user = list.find((u) => u.id === userId);
  if (!user) return null;

  if (!user.streak) user.streak = defaultStreak();

  const today = kstDateString(new Date());
  if (user.streak.lastActiveDate === today) {
    return user; // 오늘 이미 기록했으면 그대로 둬요.
  }

  const yesterday = kstDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
  user.streak.current = user.streak.lastActiveDate === yesterday ? user.streak.current + 1 : 1;
  user.streak.longest = Math.max(user.streak.longest, user.streak.current);
  user.streak.lastActiveDate = today;

  writeAll(list);
  return user;
}

// 비밀번호 해시 등 민감한 필드를 뺀 사용자 정보만 프론트로 돌려줘요.
function toPublicUser(user) {
  if (!user) return null;
  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

module.exports = {
  findByEmail,
  findByKakaoId,
  findById,
  createUser,
  createKakaoUser,
  updateStreak,
  toPublicUser,
};
