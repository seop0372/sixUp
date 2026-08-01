const form = document.getElementById('curriculum-form');
const submitBtn = document.getElementById('submit-btn');
const errorMsg = document.getElementById('error-msg');
const resultSection = document.getElementById('result-section');
const resultTitle = document.getElementById('result-title');
const resultSummary = document.getElementById('result-summary');
const weeksContainer = document.getElementById('weeks-container');
const historyList = document.getElementById('history-list');

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function clearError() {
  errorMsg.classList.add('hidden');
}

function renderCurriculum(curriculum) {
  resultTitle.textContent = curriculum.title || '나만의 6주 커리큘럼';
  resultSummary.textContent = curriculum.summary || '';
  weeksContainer.innerHTML = '';

  (curriculum.weeks || []).forEach((week, weekIndex) => {
    const block = document.createElement('div');
    block.className = 'week-block';

    const heading = document.createElement('h3');
    heading.textContent = `${week.week}주차`;
    block.appendChild(heading);

    const goal = document.createElement('div');
    goal.className = 'goal';
    goal.textContent = week.goal || '';
    block.appendChild(goal);

    (week.tasks || []).forEach((task, taskIndex) => {
      const key = `${weekIndex}-${taskIndex}`;
      const done = curriculum.progress && curriculum.progress[key];

      const item = document.createElement('div');
      item.className = 'task-item' + (done ? ' done' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!done;
      checkbox.id = `task-${key}`;
      checkbox.addEventListener('change', async () => {
        item.classList.toggle('done', checkbox.checked);
        try {
          await fetch(`/api/curriculum/${curriculum.id}/progress`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              weekIndex,
              taskIndex,
              done: checkbox.checked,
            }),
          });
        } catch (e) {
          console.error('진도 저장 실패', e);
        }
      });

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.textContent = task;

      item.appendChild(checkbox);
      item.appendChild(label);
      block.appendChild(item);
    });

    if (week.resources && week.resources.length) {
      const resources = document.createElement('div');
      resources.className = 'resources';
      resources.textContent = '참고: ' + week.resources.join(' · ');
      block.appendChild(resources);
    }

    weeksContainer.appendChild(block);
  });

  resultSection.classList.remove('hidden');
  resultSection.scrollIntoView({ behavior: 'smooth' });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const interest = document.getElementById('interest').value.trim();
  const hoursPerWeek = document.getElementById('hoursPerWeek').value.trim();
  const budget = document.getElementById('budget').value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = '커리큘럼 만드는 중... (10~20초 소요)';

  try {
    const res = await fetch('/api/curriculum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interest, hoursPerWeek, budget }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || '커리큘럼 생성에 실패했어요.');
      return;
    }

    renderCurriculum(data);
    loadHistory();
  } catch (err) {
    console.error(err);
    showError('서버에 연결할 수 없어요. 백엔드가 실행 중인지 확인해주세요.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '6주 커리큘럼 만들기';
  }
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
      el.textContent = `${item.title || item.interest} — ${new Date(item.createdAt).toLocaleString('ko-KR')}`;
      el.addEventListener('click', () => renderCurriculum(item));
      historyList.appendChild(el);
    });
  } catch (err) {
    historyList.innerHTML = '<p class="muted">목록을 불러오지 못했어요.</p>';
  }
}

loadHistory();
