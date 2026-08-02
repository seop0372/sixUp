// 아주 간단한 파일 기반 저장소예요.
// MVP 단계라 진짜 DB(SQLite 등) 대신, data/curricula.json 파일에 그냥 배열로 저장해요.
// 나중에 사용자가 많아지거나 기능이 커지면 SQLite/PostgreSQL로 옮기면 돼요.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'curricula.json');

function ensureDataFile() {
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

function saveCurriculum(curriculum) {
  const list = readAll();
  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    ...curriculum,
  };
  list.unshift(record); // 최신 순으로
  writeAll(list);
  return record;
}

function getAllCurricula() {
  return readAll();
}

function getCurriculumById(id) {
  return readAll().find((c) => c.id === id) || null;
}

function updateProgress(id, weekIndex, taskIndex, done) {
  const list = readAll();
  const record = list.find((c) => c.id === id);
  if (!record) return null;

  // progress 필드가 없으면 초기화
  if (!record.progress) record.progress = {};
  const key = `${weekIndex}-${taskIndex}`;
  record.progress[key] = done;

  writeAll(list);
  return record;
}

// 적응형 재조정: 특정 주차의 할 일 목록을 통째로 교체해요.
function updateWeekTasks(id, weekIndex, tasks, adaptedReason) {
  const list = readAll();
  const record = list.find((c) => c.id === id);
  if (!record) return null;

  const week = record.weeks && record.weeks[weekIndex];
  if (!week) return null;

  week.tasks = tasks;
  week.adaptedReason = adaptedReason;

  // 할 일 목록이 통째로 바뀌었으니, 이 주차에 남아있던 기존 체크 상태는 지워요.
  if (record.progress) {
    Object.keys(record.progress).forEach((key) => {
      if (key.startsWith(`${weekIndex}-`)) delete record.progress[key];
    });
  }

  writeAll(list);
  return record;
}

module.exports = {
  saveCurriculum,
  getAllCurricula,
  getCurriculumById,
  updateProgress,
  updateWeekTasks,
};
