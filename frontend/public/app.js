const form = document.getElementById('curriculum-form');
const errorMsg = document.getElementById('error-msg');
const resultSection = document.getElementById('result');
const historyList = document.getElementById('history-list');
const submitBtn = document.getElementById('submit-btn');

const questionsSection = document.getElementById('questions-section');
const questionsForm = document.getElementById('questions-form');
const questionsList = document.getElementById('questions-list');
const questionsSubmitBtn = document.getElementById('questions-submit-btn');
const questionsErrorMsg = document.getElementById('questions-error-msg');

// 질문 단계와 최종 생성 단계 사이에 들고 다닐 기본 입력값이에요.
let pendingBase = null;

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

function showQuestionsError(msg) {
  questionsErrorMsg.textContent = msg;
  questionsErrorMsg.classList.remove('hidden');
}

function hideQuestionsError() {
  questionsErrorMsg.classList.add('hidden');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

// AI 응답이 문자열이거나, text/title/description 중 다른 키를 쓴 객체일 수 있어서
// 우선순위대로 값을 꺼내와요.
function getTaskText(task) {
  if (typeof task === 'string') return task;
  return task.text || task.title || task.description || '';
}

// item.progress는 "weekIndex-taskIndex" -> boolean 맵이에요. 이걸 기준으로
// 전체 할 일 중 완료된 비율을 계산해요.
function isTaskDone(item, weekIndex, taskIndex) {
  return !!(item.progress && item.progress[`${weekIndex}-${taskIndex}`]);
}

function calcProgress(item) {
  let total = 0;
  let done = 0;
  item.weeks.forEach((week, weekIndex) => {
    week.tasks.forEach((task, taskIndex) => {
      total += 1;
      if (isTaskDone(item, weekIndex, taskIndex)) done += 1;
    });
  });
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}

function renderProgressBar(item) {
  const { done, total, percent } = calcProgress(item);
  return `
    <div class="progress-wrap">
      <div class="progress-label">
        <span>진행률</span>
        <span>${done} / ${total} (${percent}%)</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${percent}%"></div>
      </div>
    </div>
  `;
}

// 캐러셀이 현재 보여주고 있는 주차(0-based 배열 인덱스)예요.
let currentWeekIndex = 0;

// 아직 할 일을 다 끝내지 못한 첫 번째 주차를 찾아요. 다 끝냈으면 마지막 주차.
function firstIncompleteWeekIndex(item) {
  for (let i = 0; i < item.weeks.length; i++) {
    const week = item.weeks[i];
    const allDone = week.tasks.every((_, taskIndex) => isTaskDone(item, i, taskIndex));
    if (!allDone) return i;
  }
  return item.weeks.length - 1;
}

// 제안은 item에 직접 들고 다녀요 (주차를 넘겨봐도 유지되도록).
function addSuggestion(item, weekIndex, direction) {
  if (!item.pendingSuggestions) item.pendingSuggestions = [];
  const exists = item.pendingSuggestions.some((s) => s.weekIndex === weekIndex);
  if (!exists) item.pendingSuggestions.push({ weekIndex, direction });
}

function removeSuggestion(item, weekIndex) {
  if (!item.pendingSuggestions) return;
  item.pendingSuggestions = item.pendingSuggestions.filter((s) => s.weekIndex !== weekIndex);
}

// 제안 카드는 특정 주차 블록이 아니라, 진행률 바 아래 상시 영역에 떠요 —
// 캐러셀에서는 매 순간 주차 블록이 하나만 존재해서 다른 주차에 붙일 수 없어요.
function renderSuggestionsHtml(item) {
  const list = item.pendingSuggestions || [];
  return list
    .map((s) => {
      const week = item.weeks[s.weekIndex];
      if (!week) return '';
      const message =
        s.direction === 'harder'
          ? `이번 주 다 완료하셨네요! ${week.week}주차를 조금 더 도전적으로 조정해드릴까요?`
          : `이번 주가 좀 빠듯했나봐요. ${week.week}주차 계획을 더 가볍게 조정해드릴까요?`;
      return `
        <div class="suggest-card">
          <p>${message}</p>
          <div class="suggest-actions">
            <button type="button" class="suggest-accept" data-week-index="${s.weekIndex}" data-direction="${s.direction}">조정하기</button>
            <button type="button" class="suggest-dismiss" data-week-index="${s.weekIndex}">괜찮아요</button>
          </div>
        </div>`;
    })
    .join('');
}

function attachSuggestionListeners(item) {
  resultSection.querySelectorAll('.suggest-dismiss').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeSuggestion(item, Number(btn.dataset.weekIndex));
      renderCurriculum(item);
    });
  });

  resultSection.querySelectorAll('.suggest-accept').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const weekIndex = Number(btn.dataset.weekIndex);
      const direction = btn.dataset.direction;
      btn.disabled = true;
      btn.textContent = '조정하는 중...';

      try {
        const res = await fetch(`/api/curriculum/${item.id}/adjust-week`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekIndex, direction }),
        });
        const updated = await res.json();
        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = '조정하기';
          return;
        }
        item.weeks = updated.weeks;
        item.progress = updated.progress;
        removeSuggestion(item, weekIndex);
        renderCurriculum(item);
      } catch (err) {
        console.error('주차 재조정 실패', err);
        btn.disabled = false;
        btn.textContent = '조정하기';
      }
    });
  });
}

// 트레일 마커(원형 숫자)/목표/체크리스트/조정 배지는 기존 .week-block 스타일을 그대로 재사용해요.
function renderWeekCardHtml(item, weekIndex) {
  const week = item.weeks[weekIndex];
  const tasksHtml = week.tasks
    .map((task, taskIndex) => {
      const done = isTaskDone(item, weekIndex, taskIndex);
      return `
        <label class="task ${done ? 'done' : ''}">
          <input type="checkbox" data-week="${weekIndex}" data-task="${taskIndex}" ${done ? 'checked' : ''} />
          <span>${getTaskText(task)}</span>
        </label>`;
    })
    .join('');

  const adaptedBadge = week.adaptedReason
    ? '<span class="adapted-badge">진행 상황에 맞춰 조정된 계획이에요</span>'
    : '';

  return `
    <div class="week-block" data-week="${week.week}">
      <h3>${week.week}주차</h3>
      ${adaptedBadge}
      <p class="goal">${week.goal}</p>
      ${tasksHtml}
    </div>
  `;
}

function attachTaskCheckboxListeners(item) {
  resultSection.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      const weekIndex = e.target.dataset.week;
      const taskIndex = e.target.dataset.task;
      const done = e.target.checked;

      e.target.closest('.task').classList.toggle('done', done);

      // 로컬 데이터도 갱신해서 진행률 바가 즉시 반영되게 해요.
      if (!item.progress) item.progress = {};
      item.progress[`${weekIndex}-${taskIndex}`] = done;
      const progressWrap = resultSection.querySelector('.progress-wrap');
      if (progressWrap) {
        progressWrap.outerHTML = renderProgressBar(item);
      }

      try {
        const res = await fetch(`/api/curriculum/${item.id}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekIndex, taskIndex, done }),
        });
        const updated = await res.json();
        if (!res.ok) return;

        item.progress = updated.progress;

        if (updated.suggestAdjustment) {
          addSuggestion(item, updated.weekIndex, updated.suggestAdjustment);
          renderCurriculum(item);
        }
      } catch (err) {
        console.error('진도 저장 실패', err);
      }
    });
  });
}

function goToWeek(item, index) {
  const clamped = Math.max(0, Math.min(item.weeks.length - 1, index));
  if (clamped === currentWeekIndex) return;
  currentWeekIndex = clamped;
  renderCurriculum(item);
}

// 트랙패드 좌우 스와이프(수평 휠)와 터치스크린 스와이프를 모두 지원해요.
function attachSwipeListeners(carousel, item) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  carousel.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    },
    { passive: true }
  );

  carousel.addEventListener(
    'touchend',
    (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        goToWeek(item, currentWeekIndex + (dx < 0 ? 1 : -1));
      }
    },
    { passive: true }
  );

  let wheelCooldown = false;
  carousel.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || wheelCooldown) return;
      e.preventDefault();
      if (Math.abs(e.deltaX) < 30) return;
      wheelCooldown = true;
      goToWeek(item, currentWeekIndex + (e.deltaX > 0 ? 1 : -1));
      setTimeout(() => {
        wheelCooldown = false;
      }, 400);
    },
    { passive: false }
  );
}

function attachCarouselControls(item) {
  const prevBtn = resultSection.querySelector('.carousel-prev');
  const nextBtn = resultSection.querySelector('.carousel-next');
  if (prevBtn) prevBtn.addEventListener('click', () => goToWeek(item, currentWeekIndex - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => goToWeek(item, currentWeekIndex + 1));

  resultSection.querySelectorAll('.carousel-dot').forEach((dot) => {
    dot.addEventListener('click', () => goToWeek(item, Number(dot.dataset.goto)));
  });

  const carousel = resultSection.querySelector('.week-carousel');
  if (carousel) attachSwipeListeners(carousel, item);
}

function renderCurriculum(item, options = {}) {
  resultSection.classList.remove('hidden');

  if (options.resetIndex || currentWeekIndex == null || currentWeekIndex >= item.weeks.length) {
    currentWeekIndex = firstIncompleteWeekIndex(item);
  }

  const total = item.weeks.length;
  const dotsHtml = item.weeks
    .map(
      (_, i) =>
        `<button type="button" class="carousel-dot ${i === currentWeekIndex ? 'active' : ''}" data-goto="${i}" aria-label="${i + 1}주차로 이동"></button>`
    )
    .join('');

  resultSection.innerHTML = `
    <h2>${item.title}</h2>
    ${renderProgressBar(item)}
    ${renderSuggestionsHtml(item)}
    <div class="week-carousel">
      ${renderWeekCardHtml(item, currentWeekIndex)}
    </div>
    <div class="carousel-nav">
      <button type="button" class="carousel-arrow carousel-prev" ${currentWeekIndex === 0 ? 'disabled' : ''} aria-label="이전 주차">◀</button>
      <button type="button" class="carousel-arrow carousel-next" ${currentWeekIndex === total - 1 ? 'disabled' : ''} aria-label="다음 주차">▶</button>
    </div>
    <div class="carousel-dots">${dotsHtml}</div>
  `;

  attachTaskCheckboxListeners(item);
  attachSuggestionListeners(item);
  attachCarouselControls(item);
}

function renderQuestions(questions) {
  questionsList.innerHTML = questions
    .map((q, i) => {
      const type = q.type === 'number' ? 'number' : 'text';
      return `
        <label>
          ${q.question}
          <input
            type="${type}"
            data-question-index="${i}"
            data-question-text="${escapeAttr(q.question)}"
            data-question-type="${type}"
          />
        </label>`;
    })
    .join('');

  hideQuestionsError();
  questionsSection.classList.remove('hidden');
  questionsSection.scrollIntoView({ behavior: 'smooth' });
}

async function generateCurriculum(answers) {
  if (!pendingBase) return;

  questionsSubmitBtn.disabled = true;
  questionsSubmitBtn.textContent = '만드는 중... (몇 초 걸려요)';

  try {
    const res = await fetch('/api/curriculum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...pendingBase, answers }),
    });

    const data = await res.json();

    if (!res.ok) {
      showQuestionsError(data.error || '커리큘럼 생성에 실패했어요.');
      return;
    }

    questionsSection.classList.add('hidden');
    renderCurriculum(data, { resetIndex: true });
    loadHistory();
  } catch (err) {
    console.error(err);
    showQuestionsError('서버에 연결할 수 없어요. 백엔드가 실행 중인지 확인해주세요.');
  } finally {
    questionsSubmitBtn.disabled = false;
    questionsSubmitBtn.textContent = '6주 경로 만들기';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  questionsSection.classList.add('hidden');
  resultSection.classList.add('hidden');

  const interest = document.getElementById('interest').value.trim();
  const hoursPerWeek = document.getElementById('hoursPerWeek').value;
  const budget = document.getElementById('budget').value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = '맞춤 질문 만드는 중...';

  try {
    const res = await fetch('/api/curriculum/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interest, hoursPerWeek, budget }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || '맞춤 질문을 만드는 데 실패했어요.');
      return;
    }

    pendingBase = { interest, hoursPerWeek, budget };

    if (data.questions && data.questions.length) {
      renderQuestions(data.questions);
    } else {
      await generateCurriculum([]);
    }
  } catch (err) {
    console.error(err);
    showError('서버에 연결할 수 없어요. 백엔드가 실행 중인지 확인해주세요.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '다음: 맞춤 질문 받기';
  }
});

questionsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideQuestionsError();

  const answers = Array.from(questionsList.querySelectorAll('input')).map((input) => ({
    question: input.dataset.questionText,
    type: input.dataset.questionType,
    answer: input.value.trim(),
  }));

  await generateCurriculum(answers);
});

async function loadHistory() {
  try {
    const res = await fetch('/api/curriculum');
    const list = await res.json();

    if (!list.length) {
      historyList.innerHTML = '<p class="muted">아직 만든 커리큘럼이 없어요.</p>';
      return;
    }

    historyList.innerHTML = '';
    list.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-item';
      const percent = item.progress ? item.progress.percent : 0;
      el.innerHTML = `
        <div class="history-item-row">
          <span>${item.title || item.interest} — ${new Date(item.createdAt).toLocaleString('ko-KR')}</span>
          <span class="history-percent">${percent}%</span>
        </div>
      `;
      el.addEventListener('click', async () => {
        const res = await fetch(`/api/curriculum/${item.id}`);
        const full = await res.json();
        renderCurriculum(full, { resetIndex: true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      historyList.appendChild(el);
    });
  } catch (err) {
    historyList.innerHTML = '<p class="muted">목록을 불러오지 못했어요.</p>';
  }
}

loadHistory();
