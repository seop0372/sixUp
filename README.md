# SixUp — 6주 취미 커리큘럼 생성기

관심 분야, 주당 가능 시간, 예산을 입력하면 Claude(AI)가 6주짜리 맞춤 커리큘럼을 만들어주고,
매주 체크리스트로 진도까지 관리할 수 있는 웹앱이에요.

## 폴더 구조

```
sixup/
  backend/          Express 서버 (API + AI 호출 + 저장)
    server.js
    routes/curriculum.js
    storage.js       파일 기반 저장소 (data/curricula.json)
    data/curricula.json
    .env.example      <- 복사해서 .env 만들기
  frontend/public/   정적 프론트엔드 (HTML/CSS/JS, 프레임워크 없음)
    index.html
    style.css
    app.js
```

## 실행 방법 (로컬)

### 1. Node.js 설치 확인
```bash
node -v
```
설치 안 되어 있으면 https://nodejs.org 에서 LTS 버전 설치하세요.

### 2. 백엔드 의존성 설치
```bash
cd backend
npm install
```

### 3. API 키 설정
`.env.example`을 복사해서 `.env` 파일을 만들고, Anthropic API 키를 넣으세요.

```bash
cp .env.example .env
```

`.env` 파일을 열어서:
```
ANTHROPIC_API_KEY=여기에_실제_키
```

API 키는 https://console.anthropic.com 에서 발급받을 수 있어요. (claude.ai 구독과는 별개로, API 사용량만큼 과금되는 계정이 필요해요.)

### 4. 서버 실행
```bash
npm start
```

터미널에 `SixUp 서버 실행 중: http://localhost:3000` 이 뜨면 성공이에요.

### 5. 브라우저에서 열기
http://localhost:3000 접속하면 SixUp 화면이 떠요.

## 지금 구현된 것 (MVP)

- ✅ 관심사/시간/예산 입력 폼
- ✅ Claude API로 6주 커리큘럼 자동 생성
- ✅ 주차별 체크리스트 (클릭하면 진도 저장)
- ✅ 파일 기반 저장 (`data/curricula.json`) — 만든 커리큘럼 목록 조회 가능
- ⬜ 로그인/회원 구분 (지금은 모두가 같은 목록을 봐요)
- ⬜ 진짜 DB(SQLite 등)로 전환
- ⬜ 배포 (Vercel/Render 등)

## 배포 (Render)

1. GitHub에 푸시된 상태에서 https://dashboard.render.com → **New +** → **Blueprint** 선택
2. 이 저장소를 연결하면 루트의 `render.yaml`을 읽어서 `sixup` 웹 서비스(무료 플랜)를 자동으로 만들어요
3. `sync: false`로 표시된 환경변수는 대시보드에서 직접 입력해야 해요
   - `ANTHROPIC_API_KEY`
   - `KAKAO_REST_API_KEY` (카카오 로그인 안 쓰면 비워둬도 됨)
   - `KAKAO_REDIRECT_URI` — 배포 후 나온 도메인 기준으로 `https://<서비스명>.onrender.com/api/auth/kakao/callback` 형태로 입력하고, Kakao Developers 콘솔의 Redirect URI에도 동일하게 등록
   - `SESSION_SECRET`은 `generateValue: true`라 Render가 자동으로 랜덤 값을 채워줘요
4. `plan: free`로 설정되어 있어요. 무료 플랜은 Persistent Disk를 지원하지 않아서 `data/curricula.json`·`data/users.json`이 로컬(휘발성) 디스크에 저장돼요 — **재배포하거나 15분 넘게 요청이 없어 슬립 상태로 들어갔다 깨어나면 가입자·커리큘럼 데이터가 초기화될 수 있어요.** 데이터를 영구 보존하려면 `render.yaml`에서 `plan`을 `starter`(월 $7~)로 바꾸고 아래처럼 `disk`를 추가한 뒤, `DATA_DIR` 환경변수를 `/var/data`로 지정하세요.
   ```yaml
   disk:
     name: sixup-data
     mountPath: /var/data
     sizeGB: 1
   ```
5. 배포 완료되면 `https://<서비스명>.onrender.com`으로 접속 확인

세션도 MemoryStore라 서버가 재시작되면 로그인된 사용자는 다시 로그인해야 해요. 무료 플랜에서는 슬립 후 깨어날 때마다 이런 재시작이 일어난다는 점 참고하세요.

## 다음 단계 추천

1. Claude Code로 이 폴더 열고 `/init` 실행해서 CLAUDE.md 만들기
2. 로컬에서 직접 커리큘럼 하나 만들어보고 결과 확인
3. 4주차 계획대로 결과 페이지 디자인 다듬기
4. 5주차: 체크리스트 진도율(%) 표시 같은 기능 추가
5. 6주차: Render/Vercel 등으로 배포

막히는 부분 있으면 스크린샷이나 에러 메시지 그대로 들고 다시 물어보세요!
