import { isAxiosError } from "axios";

/** 서버 오류에서 사용자에게 보여 줄 메시지를 꺼낸다 */
export function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (!error.response) return "서버에 연결할 수 없습니다.";
    return "요청에 실패했습니다.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "알 수 없는 오류가 발생했습니다.";
}
