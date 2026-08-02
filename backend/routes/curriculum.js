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

async function regenerateWeekTasks({ curriculum, targetWeekIndex, direction }) {
  const targetWeek = curriculum.weeks[targetWeekIndex];

  const directionText =
    direction === 'harder'
      ? '사용자가 바로 이전 주차의 할 일을 100% 완료했습니다. 계획대로 잘 따라오고 있으니, 이번 주는 강도나 난이도를 한 단계 높여서 더 도전적으로 구성하세요.'
      : '사용자가 바로 이전 주차의 할 일 중 절반도 완료하지 못한 채 이번 주로 넘어왔습니다. 부담을 줄일 수 있도록 할 일 개수를 줄이거나 난이도를 낮춰서, 더 현실적으로 구성하세요.';

  const userMessage = `관심 분야: ${curriculum.interest}
주당 가능 시간: ${curriculum.hoursPerWeek}시간
전체 커리큘럼 제목: ${curriculum.title}
이번 주차(${targetWeek.week}주차) 목표: ${targetWeek.goal}
기존 할 일 목록: ${JSON.stringify((targetWeek.tasks || []).map(taskText))}

${directionText}

위 내용을 반영해서 ${targetWeek.week}주차의 할 일(tasks) 목록만 새로 만들어주세요.`;

  const result = await callClaudeJSON({ systemPrompt: REGEN_TASKS_SYSTEM_PROMPT, userMessage, maxTokens: 800 });
  if (!Array.isArray(result.tasks) || !result.tasks.length) {
    throw new Error('REGEN_INVALID_TASKS');
  }
  return result.tasks;
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
router.patch('/:id/progress', async (req, res) => {
  const weekIndex = Number(req.body.weekIndex);
  const taskIndex = Number(req.body.taskIndex);
  const { done } = req.body;

  const before = storage.getCurriculumById(req.params.id);
  if (!before) return res.status(404).json({ error: '커리큘럼을 찾을 수 없어요.' });

  const completionBefore = getWeekCompletion(before, weekIndex);

  let updated = storage.updateProgress(req.params.id, weekIndex, taskIndex, done);
  if (!updated) return res.status(404).json({ error: '커리큘럼을 찾을 수 없어요.' });

  if (done && process.env.ANTHROPIC_API_KEY) {
    const completionAfter = getWeekCompletion(updated, weekIndex);
    const nextIndex = weekIndex + 1;
    const prevIndex = weekIndex - 1;

    // 이번 주차를 방금 100% 완료했으면, 다음 주는 더 도전적으로 재조정해요.
    if (
      completionBefore < 1 &&
      completionAfter === 1 &&
      updated.weeks[nextIndex] &&
      !updated.weeks[nextIndex].adaptedReason
    ) {
      try {
        const tasks = await regenerateWeekTasks({ curriculum: updated, targetWeekIndex: nextIndex, direction: 'harder' });
        updated = storage.updateWeekTasks(req.params.id, nextIndex, tasks, 'harder') || updated;
      } catch (err) {
        console.error('다음 주 재조정(harder) 실패:', err);
      }
    }

    // 이전 주차를 절반도 못 채운 채 이번 주를 막 시작했으면, 이번 주를 더 쉽게 재조정해요.
    if (
      completionBefore === 0 &&
      prevIndex >= 0 &&
      updated.weeks[prevIndex] &&
      getWeekCompletion(updated, prevIndex) < 0.5 &&
      updated.weeks[weekIndex] &&
      !updated.weeks[weekIndex].adaptedReason
    ) {
      try {
        const tasks = await regenerateWeekTasks({ curriculum: updated, targetWeekIndex: weekIndex, direction: 'easier' });
        updated = storage.updateWeekTasks(req.params.id, weekIndex, tasks, 'easier') || updated;
      } catch (err) {
        console.error('이번 주 재조정(easier) 실패:', err);
      }
    }
  }

  res.json(updated);
});

module.exports = router;
