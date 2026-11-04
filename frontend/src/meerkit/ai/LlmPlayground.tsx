"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { chat } from "../api/llm";
import { errorMessage } from "../api/error";
import { useAuth } from "../auth/hooks";
import { AiPromptInput } from "./AiPromptInput";
import { ApiKeyInput } from "./ApiKeyInput";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { useLlmKeyStore } from "./llm-key-store";
import { MODELS, estimateCost, formatCost, type ModelId, type Usage } from "./pricing";

interface Turn {
  question: string;
  reply: string;
  model: string;
  usage: Usage;
}

const AGENTS = MODELS.map((m) => ({ id: m.id, label: m.label, description: m.description }));

// 웰컴 페이지의 AI 테스트. 로그인 전에는 키 입력 칸만 보이고(누르면 로그인 안내), 로그인하면 질문 입력창이 열린다.
export function LlmPlayground({ className }: { className?: string }) {
  const { isAuthenticated } = useAuth();
  const apiKey = useLlmKeyStore((s) => s.apiKey);
  const total = useLlmKeyStore((s) => s.total);
  const addUsage = useLlmKeyStore((s) => s.addUsage);
  const [model, setModel] = useState<ModelId>("gpt-4o-mini");
  const [turn, setTurn] = useState<Turn | null>(null);

  const ask = useMutation({
    mutationFn: ({ message, model }: { message: string; model: ModelId }) => chat(message, model, apiKey),
    onSuccess: (data, vars) => {
      setTurn({ question: vars.message, reply: data.reply, model: data.model, usage: data.usage });
      addUsage(data.model, data.usage);
    },
  });

  const ready = isAuthenticated && !!apiKey;
  const cost = turn ? estimateCost(turn.model, turn.usage) : null;

  return (
    <section aria-label="AI 테스트" className={cn("grid w-full max-w-xl gap-4 text-left", className)}>
      <ApiKeyInput />
      {isAuthenticated && (
        <AiPromptInput
          onSubmit={(message) => ask.mutate({ message, model })}
          pending={ask.isPending}
          disabled={!ready}
          placeholder={ready ? "AI에게 물어보세요" : "API 키를 먼저 입력해 주세요"}
          agents={AGENTS}
          agent={model}
          onAgentChange={(id) => setModel(id as ModelId)}
          attachments={false}
          maxLength={2000}
        />
      )}
      {ask.isPending && <ThinkingIndicator size="sm" />}
      {ask.isError && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage(ask.error)}
        </p>
      )}
      {turn && !ask.isPending && (
        <div className="grid gap-3 rounded-2xl border bg-card p-5 shadow-soft">
          <p className="text-xs text-muted-foreground">Q. {turn.question}</p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{turn.reply}</p>
          <p className="border-t pt-3 text-xs text-muted-foreground">
            이번 응답: 입력 {turn.usage.input_tokens.toLocaleString()} · 출력 {turn.usage.output_tokens.toLocaleString()} 토큰
            {cost !== null && <> · 예상 {formatCost(cost)}</>}
          </p>
        </div>
      )}
      {total.calls > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          이 탭에서 {total.calls}번 사용 · 입력 {total.input.toLocaleString()} / 출력 {total.output.toLocaleString()} 토큰 · 예상 {formatCost(total.cost)} (참고용)
        </p>
      )}
    </section>
  );
}
