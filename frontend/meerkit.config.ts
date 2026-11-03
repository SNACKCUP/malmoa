import { defineMeerkitConfig } from "@/meerkit/define-config";

// Meerkit 설정. 킷 폴더(src/meerkit)를 건드리지 않고 여기서만 바꾼다.
export default defineMeerkitConfig({
  // "meerkit" | "shadcn"
  theme: "meerkit",
  // false면 Meerkit 애니메이션을 모두 끈다
  motion: true,

  signup: {
    passwordConfirm: false,
    // 예: ["nickname", "phone", "address", "birth_date", "gender"]
    optionalFields: [],
    // "basic": 주소 + 상세 주소 / "postcode": 우편번호 + 주소 + 상세 주소
    addressType: "basic",
    // "popup": 카카오 우편번호 팝업(서버 불필요) / "dialog": 검색 창(서버의 /address/search 필요)
    addressSearch: "popup",
    // 닉네임(optionalFields에 "nickname")을 켰을 때: [자동 생성] 버튼 / 가입 폼 열 때 미리 채우기
    nickname: { generator: true, autoFill: false },
    // true면 이메일 인증번호 받기·확인 버튼을 보여 주고, 인증해야 가입할 수 있다
    emailVerification: true,
    // 가입 시 동의받을 약관. 빈 배열이면 약관 영역이 사라진다.
    terms: [
      { id: "terms", label: "이용약관 동의", required: true, href: "/terms" },
      {
        id: "privacy",
        label: "개인정보 수집 및 이용 동의",
        required: true,
        href: "/privacy",
      },
      // 마케팅 메일 기능이 생기면 주석을 풀어 다시 켭니다 (백엔드 terms 표의 marketing 행은 남아 있음)
      // { id: "marketing", label: "마케팅 정보 수신 동의", required: false },
    ],
  },

  // "불러오는 중" 표시 스타일: "ring" | "dash" | "dots" | "bars" | "pulse" | "spokes" | "grid" | "progress" | "morph"
  loading: { variant: "ring" },

  // 음성 입력 파동 색 (2개 이상). 생략하면 파랑, 보라, 분홍, 청록
  ai: { voice: { colors: ["#60a5fa", "#a78bfa", "#f472b6", "#2dd4bf"] } },

  login: {
    // 연속 5회 실패하면 5분 동안 로그인을 잠근다. maxAttempts: 0이면 끈다.
    maxAttempts: 5,
    lockMinutes: 5,
  },
});
