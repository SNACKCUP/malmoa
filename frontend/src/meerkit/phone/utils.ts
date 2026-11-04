// 전화번호는 어떤 입력 부품을 쓰든 "010-1234-5678" 형식(숫자와 - 만, 최대 13자)으로 폼에 전달한다.

export const PHONE_MAX_LENGTH = 13;

/** 숫자만 남긴다 (최대 11자리) */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 11);
}

/** 숫자를 02/휴대폰 규칙에 맞춰 하이픈으로 나눈다. 입력 도중의 값도 자연스럽게 나온다 */
export function formatPhone(value: string): string {
  const d = phoneDigits(value);
  const head = d.startsWith("02") ? 2 : 3;
  if (d.length <= head) return d;
  const tail = d.length - head;
  // 휴대폰 11자리는 3-4-4, 그 밖에는 3-3-4 (서울 02는 2-3/4-4)
  const mid = tail > 7 ? 4 : tail > 4 ? tail - 4 : tail;
  const first = d.slice(0, head);
  const second = d.slice(head, head + mid);
  const third = d.slice(head + mid);
  return [first, second, third].filter(Boolean).join("-");
}

/** 칸 3개로 나눠 입력하는 부품용: 하이픈 형식 값을 [앞, 가운데, 뒤]로 쪼갠다 */
export function splitPhone(value: string): [string, string, string] {
  // 이미 하이픈으로 나뉜 값이면 칸 위치를 그대로 둔다 (가운데 칸을 비워도 뒤 칸이 앞으로 밀리지 않는다)
  const parts = value.includes("-") ? value.split("-").map((p) => p.replace(/\D/g, "")) : formatPhone(value).split("-");
  const [a = "", b = "", c = ""] = parts;
  return [a.slice(0, 3), b.slice(0, 4), c.slice(0, 4)];
}
