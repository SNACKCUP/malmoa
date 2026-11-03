import type { ModelId, Usage } from "../ai/pricing";
import { api } from "./client";

export interface ChatResult {
  reply: string;
  model: string;
  usage: Usage;
}

/** 내 API 키로 AI에게 한 번 묻는다. 키는 헤더로만 보내고 주소나 본문에 넣지 않는다 */
export async function chat(message: string, model: ModelId, apiKey: string): Promise<ChatResult> {
  const { data } = await api.post<ChatResult>("/llm/chat", { message, model }, { headers: { "X-LLM-API-Key": apiKey } });
  return data;
}
