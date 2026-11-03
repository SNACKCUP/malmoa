// "이 브라우저에서 로그인한 적이 있다"는 표시. 리프레시 쿠키는 httpOnly라 자바스크립트로 볼 수 없어서,
// 표시가 있을 때만 세션 복원 요청을 보낸다. 처음 온 방문자나 문서만 보는 사람에게는
// 불필요한 요청(과 콘솔의 401/500 오류)이 나가지 않는다. 비밀 정보가 아니라 "1" 한 글자만 저장한다.
const KEY = "meerkit-session";

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // 저장소를 쓸 수 없는 환경
  }
}

export function setSessionHint(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // 저장소를 쓸 수 없으면 건너뛴다
  }
}
