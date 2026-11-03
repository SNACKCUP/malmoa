// meerkit.config.ts에서 쓰는 설정 타입. 킷 폴더 밖(프로젝트 루트)의 설정 파일이 이 타입을 따른다.
export type ThemeMode = "meerkit" | "shadcn";

/** 로딩 표시 스타일 9종 (Loader 참고) */
export type LoaderVariant =
  | "ring"
  | "dash"
  | "dots"
  | "bars"
  | "pulse"
  | "spokes"
  | "grid"
  | "progress"
  | "morph";

export type SignupOptionalField =
  | "nickname"
  | "phone"
  | "address"
  | "birth_date"
  | "gender";

/**
 * 주소 입력 방식.
 * "basic": 주소 + 상세 주소
 * "postcode": 우편번호 + 주소 + 상세 주소
 */
export type AddressType = "basic" | "postcode";

/** 가입 시 동의받을 약관 한 줄 */
export interface TermsItem {
  /** 서버로 전달되는 식별자. 예: "terms", "privacy", "marketing" */
  id: string;
  label: string;
  /** true면 동의하지 않으면 가입할 수 없다 */
  required: boolean;
  /** 약관 전문 주소. 새 창으로 열린다 */
  href?: string;
}

export interface MeerkitUserConfig {
  /**
   * "meerkit": Meerkit 기본 스타일(쿨 그레이 + 포인트 블루).
   * "shadcn": 프로젝트의 shadcn 기본 CSS 변수(--background, --primary ...)를 그대로 따른다.
   */
  theme?: ThemeMode;
  /** false면 Meerkit의 모든 진입·전환 애니메이션을 끈다. */
  motion?: boolean;
  signup?: {
    /** 비밀번호 확인 입력을 추가한다. 서버로는 보내지 않는다. */
    passwordConfirm?: boolean;
    /** 가입 폼에 추가로 받을 선택 항목. */
    optionalFields?: SignupOptionalField[];
    /** 이름 글자 수 제한. 가입·내 정보 수정 입력칸에 함께 적용된다. 기본 2~10자 */
    name?: { min?: number; max?: number };
    /**
     * 전화번호 입력 방식 (optionalFields에 "phone"을 넣었을 때). 기본 "single"
     * "single": 칸 하나에 숫자만 입력하면 하이픈이 붙는다 (최대 13자)
     * "split": 칸 3개로 나눠 입력하고, 칸을 채우면 다음 칸으로 넘어간다
     * 어느 쪽이든 서버로는 "010-1234-5678" 형식으로 보낸다.
     */
    phoneInput?: "single" | "split";
    /** 가입 시 동의받을 약관 목록. 빈 배열이면 약관 영역을 숨긴다. */
    terms?: TermsItem[];
    /** optionalFields에 "address"를 넣었을 때 쓰는 주소 입력 방식. 기본 "basic" */
    addressType?: AddressType;
    /**
     * 주소 검색 방식. 기본 "popup".
     * "popup": 카카오(다음) 우편번호 팝업 — 서버 없이 바로 사용
     * "dialog": 우리 검색 창(결과 목록 + 더 보기) — 서비스 서버의 GET /address/search 필요
     */
    addressSearch?: "popup" | "dialog";
    /** 닉네임(optionalFields에 "nickname")을 켰을 때의 동작 */
    nickname?: {
      /** 입력칸 옆에 [자동 생성] 버튼을 보여 준다. 기본 true */
      generator?: boolean;
      /** 가입 폼을 열 때 닉네임을 자동으로 채워 둔다(사용자가 고칠 수 있다). 기본 false */
      autoFill?: boolean;
    };
    /** true면 이메일 옆에 인증번호 받기·확인 버튼을 보여 주고, 인증을 마쳐야 가입할 수 있다. */
    emailVerification?: boolean;
  };
  /** "불러오는 중" 표시를 한 곳에서 정한다. 킷의 모든 로딩 화면이 이 스타일을 따른다 */
  loading?: {
    /** 기본 로딩 스타일. 기본 "ring" */
    variant?: LoaderVariant;
  };
  ai?: {
    /** 웰컴 페이지의 AI 테스트(API 키 입력 + 질문 한 번). 기본 true. 쓰지 않으면 false */
    playground?: boolean;
    voice?: {
      /** 음성 입력 파동 색(CSS 색, 2개 이상). 왼쪽에서 오른쪽으로 번지며 서로 섞인다. 기본: 파랑, 보라, 분홍, 청록 */
      colors?: string[];
    };
  };
  login?: {
    /** 이 횟수만큼 연속 실패하면 로그인을 잠근다. 0이면 잠금 기능을 끈다. */
    maxAttempts?: number;
    /** 잠금 시간(분) */
    lockMinutes?: number;
    /**
     * 소셜 로그인. 켜면 로그인 폼 아래에 [구글 계정으로 로그인하기] 버튼이 생긴다.
     * 서버가 GET /auth/google/login 으로 구글 인증을 시작하고, 끝나면 리프레시 쿠키를 심은 뒤
     * /auth/google/callback 으로 돌려보내야 한다 (docs의 Google Login 참고). 기본 꺼짐.
     */
    social?: { google?: boolean };
  };
}

export const defineMeerkitConfig = (config: MeerkitUserConfig) => config;
