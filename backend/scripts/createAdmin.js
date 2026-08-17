// 관리자 계정을 만들거나, 이미 있는 계정을 관리자로 승격시키는 CLI 스크립트예요.
// 공개 회원가입(signup) API로는 admin을 만들 수 없게 막아뒀기 때문에,
// 관리자 계정은 반드시 이 스크립트로만 만들어요.
//
// 사용법:
//   node scripts/createAdmin.js <email> <password> [nickname]
//
// 이미 가입된 이메일이면 role을 admin으로 올리고, 비밀번호도 새로 입력한 값으로 갱신해요.

const bcrypt = require('bcryptjs');
const users = require('../users');

// 공개 회원가입(signup)은 진짜 이메일 형식 + 8자 이상 비밀번호를 강제하지만,
// 이 스크립트는 개발자가 로컬에서 직접 실행하는 관리자 전용 도구라서
// "admin" 같은 단순 아이디나 짧은 비밀번호도 허용해요 (대신 경고를 띄워요).
// 로그인(auth.js)도 email 형식을 검증하지 않고 문자열 그대로 조회하므로 동작에는 문제없어요.

async function main() {
  const [, , email, password, nickname] = process.argv;

  if (!email || !password) {
    console.error('사용법: node scripts/createAdmin.js <아이디/이메일> <비밀번호> [닉네임]');
    process.exit(1);
  }

  if (!email.includes('@')) {
    console.warn('⚠️  이메일 형식이 아니에요. 로컬 개발용으로만 쓰세요 (배포 시엔 진짜 이메일 권장).');
  }
  if (password.length < 8) {
    console.warn('⚠️  비밀번호가 짧아요(8자 미만). 로컬 개발용으로만 쓰고, 배포 계정은 더 강한 비밀번호로 바꾸세요.');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const existing = users.findByEmail(email);
  if (existing) {
    users.setRole(existing.id, 'admin');
    users.setPasswordHash(existing.id, passwordHash);
    console.log(`이미 있는 계정을 관리자로 승격하고 비밀번호를 갱신했어요: ${existing.email}`);
    return;
  }

  const user = users.createUser({ email, passwordHash, nickname, role: 'admin' });
  console.log(`관리자 계정을 만들었어요: ${user.email} (id: ${user.id})`);
}

main().catch((err) => {
  console.error('관리자 계정 생성 중 오류:', err);
  process.exit(1);
});
