const form = document.getElementById('curriculum-form');
const errorMsg = document.getElementById('error-msg');
const resultSection = document.getElementById('result');
const historyList = document.getElementById('history-list');
const submitBtn = document.getElementById('submit-btn');

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

// AI 응답이 문자열이거나, text/title/description 중 다른 키를 쓴 객체일 수 있어서
// 우선순위대로 값을 꺼내와요.
function getTaskText(task) {
  if (typeof task === 'string') return task;
  return task.text || task.title || task.description || '';
}

// 전체 할 일 중 완료된 비율을 계산해요.
function calcProgress(weeks) {
  let total = 0;
  let done = 0;
  weeks.forEach((week) => {
    week.tasks.forEach((task) => {
      total += 1;
      if (task.done) done += 1;
    });
  });
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}

function renderProgressBar(weeks) {
  const { done, total, percent } = calcProgress(weeks);
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

function renderCurriculum(item) {
  resultSection.classList.remove('hidden');
  resultSection.innerHTML = `<h2>${item.title}</h2>${renderProgressBar(item.weeks)}`;

  item.weeks.forEach((week, weekIndex) => {
    const block = document.createElement('div');
    block.className = 'week-block';
    block.setAttribute('data-week', week.week);

    const tasksHtml = week.tasks
      .map(
        (task, taskIndex) => `
        <label class="task ${task.done ? 'done' : ''}">
          <input type="checkbox" data-week="${weekIndex}" data-task="${taskIndex}" ${
          task.done ? 'checked' : ''
        } />
          <span>${getTaskText(task)}</span>
        </label>`
      )
      .join('');

    block.innerHTML = `
      <h3>${week.week}주차</h3>
      <p class="goal">${week.goal}</p>
      ${tasksHtml}
    `;
    resultSection.appendChild(block);
  });

  resultSection.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      const weekIndex = e.target.dataset.week;
      const taskIndex = e.target.dataset.task;
      const done = e.target.checked;

      e.target.closest('.task').classList.toggle('done', done);

      // 로컬 데이터도 갱신해서 진행률 바가 즉시 반영되게 해요.
      item.weeks[weekIndex].tasks[taskIndex].done = done;
      const progressWrap = resultSection.querySelector('.progress-wrap');
      if (progressWrap) {
        progressWrap.outerHTML = renderProgressBar(item.weeks);
      }

      try {
        await fetch(`/api/curriculum/${item.id}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekIndex, taskIndex, done }),
        });
      } catch (err) {
        console.error('진도 저장 실패', err);
      }
    });
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  resultSection.classList.add('hidden');

  const interest = document.getElementById('interest').value.trim();
  const hoursPerWeek = document.getElementById('hoursPerWeek').value;
  const budget = document.getElementById('budget').value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = '만드는 중... (몇 초 걸려요)';

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
        renderCurriculum(full);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      historyList.appendChild(el);
    });
  } catch (err) {
    historyList.innerHTML = '<p class="muted">목록을 불러오지 못했어요.</p>';
  }
}

loadHistory();
