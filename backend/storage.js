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

// 적응형 재조정: 특정 주차의 할 일 목록을 교체해요.
// tasks는 이미 완료한 항목은 원래 자리 그대로 두고, 미완료 항목만 새 내용으로
// 바꾼 배열이라고 가정해요 — 그래서 progress 맵은 그대로 둬도 계속 맞아요.
function updateWeekTasks(id, weekIndex, tasks, adaptedReason) {
  const list = readAll();
  const record = list.find((c) => c.id === id);
  if (!record) return null;

  const week = record.weeks && record.weeks[weekIndex];
  if (!week) return null;

  week.tasks = tasks;
  week.adaptedReason = adaptedReason;

  writeAll(list);
  return record;
}

// 특정 할 일의 메모를 저장해요. 레거시 문자열 task는 객체로 승격시켜요.
function updateTaskNotes(id, weekIndex, taskIndex, notes) {
  const list = readAll();
  const record = list.find((c) => c.id === id);
  if (!record) return null;

  const week = record.weeks && record.weeks[weekIndex];
  const task = week && week.tasks && week.tasks[taskIndex];
  if (!task) return null;

  if (typeof task === 'string') {
    week.tasks[taskIndex] = { text: task, notes };
  } else {
    task.notes = notes;
  }

  writeAll(list);
  return record;
}

function deleteCurriculum(id) {
  const list = readAll();
  const index = list.findIndex((c) => c.id === id);
  if (index === -1) return false;

  list.splice(index, 1);
  writeAll(list);
  return true;
}

module.exports = {
  saveCurriculum,
  getAllCurricula,
  getCurriculumById,
  updateProgress,
  updateWeekTasks,
  updateTaskNotes,
  deleteCurriculum,
};
