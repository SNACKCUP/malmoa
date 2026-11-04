"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus = "idle" | "requesting" | "listening" | "transcribing" | "error";

export interface VoiceOptions {
  /**
   * 녹음한 음성(Blob)을 글로 바꿔 돌려주는 함수. 서비스의 음성 인식 서버(STT)에 연결한다.
   * 없으면 브라우저의 음성 인식(SpeechRecognition)을 쓰고, 지원하지 않는 브라우저에서는 사용할 수 없다고 안내한다.
   */
  onTranscribe?: (audio: Blob) => Promise<string>;
  /** 음성 인식 언어. 기본 "ko-KR" (브라우저 음성 인식을 쓸 때만) */
  lang?: string;
  /** true면 마이크 없이 데모 음성으로 동작한다. 문서 미리보기나 화면 확인용 */
  demo?: boolean;
  /** 데모일 때 입력창에 채워질 문장 */
  demoText?: string;
}

// 브라우저 음성 인식은 표준 타입에 아직 없어서 필요한 부분만 적어 둔다
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const DEMO_DEFAULT = "10분 타이머를 맞추고 화분에 물 주라고 알려 줘";

/**
 * 녹음 상태와 실시간 음량을 돌려주는 훅.
 * - levelRef: 지금 목소리 크기(0~1). 값이 자주 바뀌어서 state가 아닌 ref로 읽는다 (VoiceGlow가 매 프레임 읽는다).
 * - onText: 글이 바뀔 때마다 호출한다 (final=true는 최종 결과).
 */
export function useVoiceRecorder(options: VoiceOptions | undefined, onText: (text: string, final: boolean) => void) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const levelRef = useRef(0);

  const optionsRef = useRef(options);
  const onTextRef = useRef(onText);
  useEffect(() => {
    optionsRef.current = options;
    onTextRef.current = onText;
  });

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recogRef = useRef<Recognition | null>(null);
  const transcriptRef = useRef("");
  const timerRef = useRef(0);
  const cancelledRef = useRef(false);
  const statusRef = useRef<VoiceStatus>("idle");

  const move = useCallback((next: VoiceStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const release = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    levelRef.current = 0;
  }, []);

  const fail = useCallback((message: string) => {
    release();
    setError(message);
    move("error");
  }, [release, move]);

  const finish = useCallback((text: string) => {
    release();
    if (!cancelledRef.current) onTextRef.current(text, true);
    move("idle");
  }, [release, move]);

  // 마이크 음량(0~1)을 매 프레임 읽는다
  const watchLevel = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      levelRef.current = Math.min(1, Math.sqrt(sum / data.length) * 4.5);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const startDemo = useCallback(() => {
    const text = optionsRef.current?.demoText ?? DEMO_DEFAULT;
    const words = text.split(" ");
    let shown = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      // 말하다 쉬었다 하는 느낌의 음량
      const talk = Math.max(0, Math.sin(t * 2.1)) * 0.6 + Math.abs(Math.sin(t * 7.3)) * 0.3 + Math.random() * 0.12;
      levelRef.current = Math.min(1, talk);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    transcriptRef.current = "";
    timerRef.current = window.setInterval(() => {
      if (shown < words.length) {
        shown += 1;
        transcriptRef.current = words.slice(0, shown).join(" ");
        onTextRef.current(transcriptRef.current, false);
      }
    }, 380);
    move("listening");
  }, [move]);

  const start = useCallback(async () => {
    if (statusRef.current !== "idle" && statusRef.current !== "error") return;
    const opts = optionsRef.current;
    cancelledRef.current = false;
    setError(null);

    if (opts?.demo) {
      startDemo();
      return;
    }

    const Recognition = recognitionCtor();
    if (!navigator.mediaDevices?.getUserMedia || (!opts?.onTranscribe && !Recognition)) {
      fail("이 브라우저에서는 음성 입력을 쓸 수 없어요.");
      return;
    }

    move("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      fail((e as DOMException)?.name === "NotAllowedError" ? "마이크 사용을 허용해 주세요." : "마이크를 찾을 수 없어요.");
      return;
    }
    // 권한 창이 떠 있는 동안 사용자가 취소했다면 바로 닫는다
    if ((statusRef.current as VoiceStatus) !== "requesting") {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    watchLevel(stream);
    transcriptRef.current = "";

    if (opts?.onTranscribe) {
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        if (cancelledRef.current) return release();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        release();
        move("transcribing");
        try {
          const text = await optionsRef.current!.onTranscribe!(blob);
          if (!cancelledRef.current) onTextRef.current(text, true);
          move("idle");
        } catch {
          fail("음성을 글로 바꾸지 못했어요. 다시 시도해 주세요.");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
    } else if (Recognition) {
      const recog = new Recognition();
      recog.lang = opts?.lang ?? "ko-KR";
      recog.continuous = true;
      recog.interimResults = true;
      let finalText = "";
      recog.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        transcriptRef.current = (finalText + interim).trim();
        onTextRef.current(transcriptRef.current, false);
      };
      recog.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        fail(e.error === "not-allowed" ? "마이크 사용을 허용해 주세요." : "음성을 인식하지 못했어요.");
      };
      recog.onend = () => {
        // 사용자가 멈춘 경우에만 마무리한다. 브라우저가 알아서 끊은 경우에도 지금까지의 글로 마무리한다
        if (statusRef.current === "listening") finish(transcriptRef.current);
      };
      recogRef.current = recog;
      recog.start();
    }
    move("listening");
  }, [fail, finish, move, release, startDemo, watchLevel]);

  const stop = useCallback(() => {
    if (statusRef.current !== "listening") return;
    if (optionsRef.current?.demo) {
      move("transcribing");
      window.clearInterval(timerRef.current);
      const text = transcriptRef.current || (optionsRef.current.demoText ?? DEMO_DEFAULT);
      window.setTimeout(() => finish(text), 700);
    } else if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
      move("transcribing");
    } else if (recogRef.current) {
      recogRef.current.stop(); // onend에서 마무리한다
    }
  }, [finish, move]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recogRef.current?.abort();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    release();
    move("idle");
  }, [release, move]);

  useEffect(() => () => {
    cancelledRef.current = true;
    recogRef.current?.abort();
    release();
  }, [release]);

  return { status, error, levelRef, start, stop, cancel };
}
