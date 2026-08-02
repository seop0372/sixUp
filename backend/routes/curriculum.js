const express = require('express');
const router = express.Router();
const storage = require('../storage');

// Claude에게 6주 커리큘럼을 JSON으로만 응답하도록 시키는 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 취미 코칭 전문가입니다.
사용자의 관심 분야, 주당 가능 시간, 예산을 바탕으로 6주짜리 커리큘럼을 만드세요.

사용자가 추가 질문에 답변한 내용이 함께 주어지면, 그 정보를 반드시 반영해서
더 구체적인 목표와 계획을 제시하세요 (예: 키/몸무게가 주어지면 운동 강도나
칼로리를 구체적인 수치로 제안하세요).

반드시 아래 JSON 형식으로만 응답하세요. 설명, 코드블록 표시(백틱) 없이 순수 JSON 텍스트만 출력하세요.

{
  "title": "커리큘럼 제목",
  "summary": "한두 문장 요약",
  "weeks": [
    {
      "week": 1,
      "goal": "이번 주 목표",
      "tasks": [
        { "text": "할 일 1" },
        { "text": "할 일 2" },
        { "text": "할 일 3" }
      ],
      "resources": ["추천 자료/링크 설명 1", "추천 자료/링크 설명 2"]
    }
  ]
}

weeks 배열은 반드시 6개(1주차~6주차)를 포함해야 합니다.
tasks 배열의 각 항목은 반드시 "text" 키 하나만 가진 객체여야 합니다.
title, description, name, content 등 "text"가 아닌 다른 키 이름은 절대 사용하지 마세요.`;

// 커리큘럼을 짜기 전, 목표에 맞는 추가 질문을 뽑아내는 시스템 프롬프트
const QUESTIONS_SYSTEM_PROMPT = `당신은 취미 코칭 전문가입니다.
사용자가 관심 분야, 주당 가능 시간, 예산을 알려주면, 6주 커리큘럼을 더 정확하게
설계하는 데 꼭 필요한 추가 질문을 만드세요.

질문은 반드시 그 목표에 딱 맞는 내용이어야 합니다.
예를 들어 "체지방 3% 감량"이라면 키/몸무게/현재 체지방률처럼 구체적인 수치를 물어보고,
"우쿨렐레 배우기"라면 악기 보유 여부나 선호 장르처럼 관련 있는 것만 물어보세요.
관심 분야와 상관없는 뻔한 질문(예: "얼마나 열심히 하실 건가요?")은 만들지 마세요.

반드시 아래 JSON 형식으로만 응답하세요. 설명, 코드블록 표시(백틱) 없이 순수 JSON 텍스트만 출력하세요.

{
  "questions": [
    { "question": "질문 텍스트", "type": "text" }
  ]
}

questions 배열은 2개 이상 4개 이하여야 합니다.
type은 반드시 "text" 또는 "number" 중 하나여야 합니다.
숫자로 답해야 하는 질문(키, 몸무게, 나이, 횟수 등)에는 "number"를, 그 외에는 "text"를 쓰세요.`;

// Claude API를 호출하고, 응답 텍스트를 JSON으로 파싱해서 돌려줘요.
async function callClaudeJSON({ systemPrompt, userMessage, maxTokens }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Anthropic API 오류:', errText);
    throw new Error('AI_CALL_FAILED');
  }

  const data = await response.json();
  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('AI_NO_TEXT');
  }

  try {
    // 혹시 모델이 코드블록으로 감싸서 응답하면 벗겨내기
    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('JSON 파싱 실패:', textBlock.text);
    throw new Error('AI_PARSE_FAILED');
  }
}

// AI 응답이 문자열이거나 text/title/description 중 다른 키를 쓴 객체일 수 있어서
// 우선순위대로 값을 꺼내와요. (frontend의 getTaskText와 동일한 로직)
function taskText(task) {
  if (typeof task === 'string') return task;
  if (task && typeof task === 'object') return task.text || task.title || task.description || '';
  return '';
}

// 특정 주차의 할 일 완료 비율(0~1)을 progress 맵으로 계산해요.
function getWeekCompletion(record, weekIndex) {
  const week = record.weeks && record.weeks[weekIndex];
  if (!week || !Array.isArray(week.tasks) || !week.tasks.length) return 0;
  const progress = record.progress || {};
  const doneCount = week.tasks.reduce(
    (acc, _, taskIndex) => acc + (progress[`${weekIndex}-${taskIndex}`] ? 1 : 0),
    0
  );
  return doneCount / week.tasks.length;
}

// 적응형 재조정: 진행 상황에 맞춰 특정 주차의 tasks만 다시 만들어요.
const REGEN_TASKS_SYSTEM_PROMPT = `당신은 취미 코칭 전문가입니다.
사용자가 진행 중인 6주 커리큘럼의 특정 주차 "할 일(tasks)" 목록을 진행 상황에 맞게 다시 만드세요.

반드시 아래 JSON 형식으로만 응답하세요. 설명, 코드블록 표시(백틱) 없이 순수 JSON 텍스트만 출력하세요.

{
  "tasks": [
    { "text": "할 일 1" },
    { "text": "할 일 2" },
    { "text": "할 일 3" }
  ]
}

tasks 배열의 각 항목은 반드시 "text" 키 하나만 가진 객체여야 합니다.
title, description, name, content 등 "text"가 아닌 다른 키 이름은 절대 사용하지 마세요.
할 일 개수는 2개에서 4개 사이로 만드세요.`;

// 완료한 할 일은 그대로 두고, 아직 완료하지 않은 할 일만 같은 자리에서 새로 만들어요.
async function regenerateIncompleteTasks({ curriculum, targetWeekIndex, direction }) {
  const targetWeek = curriculum.weeks[targetWeekIndex];
  const progress = curriculum.progress || {};

  const pendingIndexes = [];
  const doneTexts = [];
  const pendingTexts = [];

  targetWeek.tasks.forEach((task, i) => {
    if (progress[`${targetWeekIndex}-${i}`]) {
      doneTexts.push(taskText(task));
    } else {
      pendingIndexes.push(i);
      pendingTexts.push(taskText(task));
    }
  });

  if (!pendingIndexes.length) {
    return targetWeek.tasks; // 이미 다 완료했으면 바꿀 게 없어요.
  }

  const directionText =
    direction === 'harder'
      ? '사용자가 바로 이전 주차의 할 일을 100% 완료했습니다. 계획대로 잘 따라오고 있으니, 아직 하지 않은 할 일을 강도나 난이도를 한 단계 높여서 더 도전적으로 다시 만드세요.'
      : '사용자가 이번 주를 다소 버거워하고 있습니다. 아직 하지 않은 할 일의 부담을 줄일 수 있도록 난이도를 낮추거나 더 간단하게 다시 만드세요.';

  const userMessage = `관심 분야: ${curriculum.interest}
주당 가능 시간: ${curriculum.hoursPerWeek}시간
전체 커리큘럼 제목: ${curriculum.title}
이번 주차(${targetWeek.week}주차) 목표: ${targetWeek.goal}
이미 완료해서 그대로 유지할 할 일: ${JSON.stringify(doneTexts)}
아직 완료하지 않아 다시 만들 할 일: ${JSON.stringify(pendingTexts)}

${directionText}

"아직 완료하지 않아 다시 만들 할 일" ${pendingTexts.length}개를 정확히 ${pendingTexts.length}개로 새로 만들어주세요.
이미 완료한 할 일은 절대 다시 포함하거나 언급하지 마세요.`;

  const result = await callClaudeJSON({ systemPrompt: REGEN_TASKS_SYSTEM_PROMPT, userMessage, maxTokens: 800 });
  if (!Array.isArray(result.tasks) || !result.tasks.length) {
    throw new Error('REGEN_INVALID_TASKS');
  }
  const finalized = await finalizeTasks(result.tasks, curriculum.interest);

  const newTasks = [...targetWeek.tasks];
  pendingIndexes.forEach((taskIdx, i) => {
    if (finalized[i]) newTasks[taskIdx] = finalized[i];
  });
  return newTasks;
}

// task를 항상 { text, notes, ... } 객체 형태로 맞춰줘요 (레거시 문자열 데이터 포함).
function normalizeTask(task) {
  if (typeof task === 'string') return { text: task, notes: '' };
  return { notes: '', ...task };
}

// "공부하기/검색하기/찾아보기/알아보기"가 들어간 할 일은 리서치형으로 판단해요.
const RESEARCH_KEYWORDS = ['공부하기', '검색하기', '찾아보기', '알아보기'];
function isResearchTask(text) {
  return RESEARCH_KEYWORDS.some((kw) => text.includes(kw));
}

// 리서치형 할 일에 대해 실제 웹 검색으로 관련 자료(유튜브/블로그)를 찾아요.
// 지어낸 링크를 절대 만들지 않도록, 검색 결과에서 얻은 URL만 쓰라고 명시해요.
const RESOURCE_SEARCH_SYSTEM_PROMPT = `당신은 학습 자료를 추천하는 리서치 도우미입니다.
주어진 "할 일"과 관련해 실제로 존재하는 유튜브 영상이나 블로그 글을 웹 검색으로 찾아 2~3개 추천하세요.

반드시 실제 검색 결과에서 확인한 URL만 사용하세요. 검색으로 확인하지 못한 URL은 절대로 만들어내거나 추측하지 마세요.
관련성 높은 결과가 2~3개보다 적으면, 적은 개수만 추천해도 됩니다.

검색이 끝나면, 검색 결과를 요약하거나 설명하는 글은 절대 쓰지 마세요.
마크다운 문법(#, *, >, 이모지 등)도 쓰지 마세요.
오직 아래 JSON 하나만 출력하세요. JSON 앞뒤에 다른 텍스트를 붙이지 마세요.

{
  "resources": [
    { "title": "자료 제목", "url": "https://실제-검색으로-찾은-url" }
  ]
}`;

async function searchTaskResources({ interest, taskDescription }) {
  const userMessage = `관심 분야: ${interest}
할 일: ${taskDescription}

위 할 일과 관련된 실제 유튜브 영상이나 블로그 글을 웹 검색으로 찾아서 2~3개 추천해주세요.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: RESOURCE_SEARCH_SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('웹 검색 API 오류:', errText);
    throw new Error('WEB_SEARCH_FAILED');
  }

  const data = await response.json();
  // 인용(citation)이 붙으면 최종 답변이 여러 개의 text 블록으로 쪼개져 오기 때문에,
  // 전부 이어붙인 뒤에 JSON을 추출해야 해요 (마지막 블록만 보면 앞부분을 놓쳐요).
  const fullText = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!fullText) throw new Error('WEB_SEARCH_NO_TEXT');

  const cleaned = fullText.replace(/```json|```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('WEB_SEARCH_PARSE_FAILED');

  const result = JSON.parse(jsonMatch[0]);
  return Array.isArray(result.resources) ? result.resources : [];
}

// 할 일 목록을 정규화하고, 리서치형 할 일에는 실제 검색으로 찾은 자료를 붙여요.
async function finalizeTasks(tasks, interest) {
  const normalized = tasks.map(normalizeTask);

  if (process.env.ANTHROPIC_API_KEY) {
    await Promise.all(
      normalized.map(async (task) => {
        if (!isResearchTask(task.text)) return;
        try {
          task.resources = await searchTaskResources({ interest, taskDescription: task.text });
        } catch (err) {
          console.error('자료 검색 실패:', task.text, err);
        }
      })
    );
  }

  return normalized;
}

function buildAnswersText(answers) {
  if (!Array.isArray(answers) || !answers.length) return '';
  const lines = answers
    .filter((a) => a && a.answer !== undefined && a.answer !== '')
    .map((a) => `- ${a.question}: ${a.answer}`);
  if (!lines.length) return '';
  return `\n\n추가 답변:\n${lines.join('\n')}`;
}

// POST /api/curriculum/questions  { interest, hoursPerWeek, budget }
router.post('/questions', async (req, res) => {
  const { interest, hoursPerWeek, budget } = req.body;

  if (!interest || !hoursPerWeek) {
    return res.status(400).json({ error: '관심 분야(interest)와 주당 가능 시간(hoursPerWeek)은 필수예요.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY가 설정되지 않았어요. backend/.env 파일에 키를 넣어주세요.',
    });
  }

  const userMessage = `관심 분야: ${interest}
주당 가능 시간: ${hoursPerWeek}시간
예산: ${budget || '제한 없음'}

위 목표에 맞는 6주 커리큘럼을 짜기 전에, 꼭 물어봐야 할 추가 질문을 만들어주세요.`;

  try {
    const result = await callClaudeJSON({ systemPrompt: QUESTIONS_SYSTEM_PROMPT, userMessage, maxTokens: 500 });
    const questions = Array.isArray(result.questions) ? result.questions : [];
    res.json({ questions });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: '맞춤 질문을 만드는 중 오류가 발생했어요.' });
  }
});

// POST /api/curriculum  { interest, hoursPerWeek, budget, answers }
router.post('/', async (req, res) => {
  const { interest, hoursPerWeek, budget, answers } = req.body;

  if (!interest || !hoursPerWeek) {
    return res.status(400).json({ error: '관심 분야(interest)와 주당 가능 시간(hoursPerWeek)은 필수예요.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY가 설정되지 않았어요. backend/.env 파일에 키를 넣어주세요.',
    });
  }

  const userMessage = `관심 분야: ${interest}
주당 가능 시간: ${hoursPerWeek}시간
예산: ${budget || '제한 없음'}${buildAnswersText(answers)}

위 조건으로 6주 커리큘럼을 만들어주세요.`;

  try {
    const curriculum = await callClaudeJSON({ systemPrompt: SYSTEM_PROMPT, userMessage, maxTokens: 4000 });

    await Promise.all(
      curriculum.weeks.map(async (week) => {
        week.tasks = await finalizeTasks(week.tasks, interest);
      })
    );

    const saved = storage.saveCurriculum({
      interest,
      hoursPerWeek,
      budget: budget || null,
      answers: Array.isArray(answers) ? answers : [],
      ...curriculum,
    });

    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'AI 응답을 처리하지 못했어요. 다시 시도해주세요.' });
  }
});

// GET /api/curriculum  - 저장된 커리큘럼 전체 목록
router.get('/', (req, res) => {
  res.json(storage.getAllCurricula());
});

// GET /api/curriculum/:id  - 특정 커리큘럼 상세
router.get('/:id', (req, res) => {
  const item = storage.getCurriculumById(req.params.id);
  if (!item) return res.status(404).json({ error: '커리큘럼을 찾을 수 없어요.' });
  res.json(item);
});

// PATCH /api/curriculum/:id/progress  { weekIndex, taskIndex, done }
// 완료율 조건이 감지되면 재조정을 바로 적용하지 않고, 응답에 제안 신호만 실어 보내요.
router.patch('/:id/progress', async (req, res) => {
  const weekIndex = Number(req.body.weekIndex);
  const taskIndex = Number(req.body.taskIndex);
  const { done } = req.body;

  const before = storage.getCurriculumById(req.params.id);
  if (!before) return res.status(404).json({ error: '커리큘럼을 찾을 수 없어요.' });

  const completionBefore = getWeekCompletion(before, weekIndex);

  const updated = storage.updateProgress(req.params.id, weekIndex, taskIndex, done);
  if (!updated) return res.status(404).json({ error: '커리큘럼을 찾을 수 없어요.' });

  let suggestion = null;

  if (done) {
    const completionAfter = getWeekCompletion(updated, weekIndex);
    const nextIndex = weekIndex + 1;
    const prevIndex = weekIndex - 1;

    // 이번 주차를 방금 100% 완료했으면, 다음 주를 더 도전적으로 조정하자고 제안해요.
    if (
      completionBefore < 1 &&
      completionAfter === 1 &&
      updated.weeks[nextIndex] &&
      !updated.weeks[nextIndex].adaptedReason
    ) {
      suggestion = { suggestAdjustment: 'harder', weekIndex: nextIndex };
    } else if (
      // 이전 주차를 절반도 못 채운 채 이번 주를 막 시작했으면, 이번 주를 더 쉽게 조정하자고 제안해요.
      completionBefore === 0 &&
      prevIndex >= 0 &&
      updated.weeks[prevIndex] &&
      getWeekCompletion(updated, prevIndex) < 0.5 &&
      updated.weeks[weekIndex] &&
      !updated.weeks[weekIndex].adaptedReason
    ) {
      suggestion = { suggestAdjustment: 'easier', weekIndex };
    }
  }

  res.json(suggestion ? { ...updated, ...suggestion } : updated);
});

// POST /api/curriculum/:id/adjust-week  { weekIndex, direction: 'harder' | 'easier' }
// 사용자가 제안 카드에서 "조정하기"를 눌렀을 때만 실제로 재생성해요.
router.post('/:id/adjust-week', async (req, res) => {
  const weekIndex = Number(req.body.weekIndex);
  const direction = req.body.direction === 'easier' ? 'easier' : 'harder';

  const curriculum = storage.getCurriculumById(req.params.id);
  if (!curriculum) return res.status(404).json({ error: '커리큘럼을 찾을 수 없어요.' });

  if (!Number.isInteger(weekIndex) || !curriculum.weeks[weekIndex]) {
    return res.status(400).json({ error: '해당 주차를 찾을 수 없어요.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY가 설정되지 않았어요. backend/.env 파일에 키를 넣어주세요.',
    });
  }

  try {
    const tasks = await regenerateIncompleteTasks({ curriculum, targetWeekIndex: weekIndex, direction });
    const updated = storage.updateWeekTasks(req.params.id, weekIndex, tasks, direction);
    if (!updated) return res.status(404).json({ error: '커리큘럼을 찾을 수 없어요.' });
    res.json(updated);
  } catch (err) {
    console.error('주차 재조정 실패:', err);
    res.status(502).json({ error: '주차를 재조정하는 중 오류가 발생했어요.' });
  }
});

// PATCH /api/curriculum/:id/notes  { weekIndex, taskIndex, notes }
router.patch('/:id/notes', (req, res) => {
  const weekIndex = Number(req.body.weekIndex);
  const taskIndex = Number(req.body.taskIndex);
  const notes = typeof req.body.notes === 'string' ? req.body.notes : '';

  const updated = storage.updateTaskNotes(req.params.id, weekIndex, taskIndex, notes);
  if (!updated) return res.status(404).json({ error: '커리큘럼 또는 할 일을 찾을 수 없어요.' });
  res.json(updated);
});

module.exports = router;
