"use client";

import { Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Loader } from "../loading";
import type { VoiceStatus } from "./use-voice-recorder";

interface VoiceButtonProps {
  status: VoiceStatus;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

// 입력창에 넣는 마이크 버튼. 누르면 녹음, 다시 누르면 멈추고 글로 바꾼다.
export function VoiceButton({ status, onClick, disabled, className }: VoiceButtonProps) {
  const listening = status === "listening";
  const busy = status === "requesting" || status === "transcribing";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={listening ? "녹음 끝내기" : "음성으로 입력"}
      aria-pressed={listening}
      disabled={disabled || busy}
      onClick={onClick}
      className={cn("relative rounded-full transition-colors", listening && "bg-brand/10 text-brand hover:bg-brand/15", className)}
    >
      {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand/20 [animation-duration:1.6s]" />}
      {busy ? <Loader variant="ring" size="sm" /> : listening ? <Square className="fill-current" /> : <Mic />}
    </Button>
  );
}
