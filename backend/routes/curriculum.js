const express = require('express');
const router = express.Router();
const storage = require('../storage');

// Claude에게 6주 커리큘럼을 JSON으로만 응답하도록 시키는 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 취미 코칭 전문가입니다.
사용자의 관심 분야, 주당 가능 시간, 예산을 바탕으로 6주짜리 커리큘럼을 만드세요.

반드시 아래 JSON 형식으로만 응답하세요. 설명, 코드블록 표시(백틱) 없이 순수 JSON 텍스트만 출력하세요.

{
  "title": "커리큘럼 제목",
  "summary": "한두 문장 요약",
  "weeks": [
    {
      "week": 1,
      "goal": "이번 주 목표",
      "tasks": ["할 일 1", "할 일 2", "할 일 3"],
      "resources": ["추천 자료/링크 설명 1", "추천 자료/링크 설명 2"]
    }
  ]
}

weeks 배열은 반드시 6개(1주차~6주차)를 포함해야 합니다.`;

// POST /api/curriculum  { interest, hoursPerWeek, budget }
router.post('/', async (req, res) => {
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

위 조건으로 6주 커리큘럼을 만들어주세요.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API 오류:', errText);
      return res.status(502).json({ error: 'AI 호출 중 오류가 발생했어요.' });
    }

    const data = await response.json();
    const textBlock = data.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'AI 응답에서 텍스트를 찾을 수 없어요.' });
    }

    let curriculum;
    try {
      // 혹시 모델이 코드블록으로 감싸서 응답하면 벗겨내기
      const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
      curriculum = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON 파싱 실패:', textBlock.text);
      return res.status(502).json({ error: 'AI 응답을 해석하지 못했어요. 다시 시도해주세요.' });
    }

    const saved = storage.saveCurriculum({
      interest,
      hoursPerWeek,
      budget: budget || null,
      ...curriculum,
    });

    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했어요.' });
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
router.patch('/:id/progress', (req, res) => {
  const { weekIndex, taskIndex, done } = req.body;
  const updated = storage.updateProgress(req.params.id, weekIndex, taskIndex, done);
  if (!updated) return res.status(404).json({ error: '커리큘럼을 찾을 수 없어요.' });
  res.json(updated);
});

module.exports = router;
