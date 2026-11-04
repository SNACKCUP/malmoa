// 닉네임 자동 생성: "형용사 + 동물 + 숫자" (예: 용감한미어캣482). 길이는 항상 NICKNAME_RANGE 안에 들어온다.
const ADJECTIVES = ["용감한", "느긋한", "반짝이는", "씩씩한", "엉뚱한", "든든한", "명랑한", "수줍은", "날쌘", "포근한"] as const;
const ANIMALS = ["미어캣", "수달", "고양이", "너구리", "펭귄", "다람쥐", "토끼", "여우", "판다", "부엉이"] as const;

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export function generateNickname(): string {
  const number = Math.floor(Math.random() * 900) + 100; // 100~999
  return `${pick(ADJECTIVES)}${pick(ANIMALS)}${number}`;
}
