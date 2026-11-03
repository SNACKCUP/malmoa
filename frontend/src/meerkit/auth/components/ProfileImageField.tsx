"use client";

import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { User } from "../../types";
import { UserAvatar } from "./UserAvatar";

interface ProfileImageFieldProps {
  user: Pick<User, "name" | "nickname" | "avatar_url">;
  /** 고른 파일을 서버에 올리는 함수. 실패하면 throw 하면 오류 문구가 보인다 */
  onUpload: (file: File) => void | Promise<unknown>;
  /** 주면 [삭제] 버튼이 생긴다 (프로필 이미지가 있을 때만 보인다) */
  onRemove?: () => void | Promise<unknown>;
  /** 허용하는 파일 형식. 기본 JPG·PNG·WEBP */
  accept?: string[];
  /** 최대 크기(MB). 기본 2 */
  maxSizeMB?: number;
  disabled?: boolean;
  /** false면 형식·크기 안내 문구를 숨긴다 (잘못 올리면 오류 문구는 그대로 보인다) */
  showHint?: boolean;
}

const DEFAULT_ACCEPT = ["image/jpeg", "image/png", "image/webp"];

// 프로필 이미지를 고르고 바꾸는 부품. 사진을 누르면 파일 선택 창이 열리고, 올리는 동안 고른 사진을 미리 보여 준다.
// 형식·크기는 여기서 먼저 확인한다. 올린 뒤의 이미지 주소(avatar_url)는 서버가 내 정보로 돌려준다.
export function ProfileImageField({ user, onUpload, onRemove, accept = DEFAULT_ACCEPT, maxSizeMB = 2, disabled, showHint = true }: ProfileImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 미리보기 주소는 쓰고 나면 풀어 준다
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!accept.includes(file.type)) return setError("JPG, PNG, WEBP 이미지만 올릴 수 있습니다.");
    if (file.size > maxSizeMB * 1024 * 1024) return setError(`이미지는 ${maxSizeMB}MB 이하로 올려 주세요.`);
    setError(null);
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      await onUpload(file);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "이미지를 올리지 못했습니다.");
    } finally {
      setBusy(false);
      setPreview(null); // 성공하면 서버가 준 주소로, 실패하면 원래 사진으로 돌아간다
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const shown = { ...user, avatar_url: preview ?? user.avatar_url };

  return (
    <div className="grid justify-items-center gap-2">
      <div className="grid justify-items-center gap-2">
        <div className="relative">
          <button
            type="button"
            aria-label="프로필 이미지 변경"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="group block rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60"
          >
            <UserAvatar user={shown} size="xl" />
          </button>
          {/* 오른쪽 아래의 펜 아이콘이 이미지 변경 버튼 */}
          <button
            type="button"
            aria-label="프로필 이미지 변경"
            title="이미지 변경"
            data-slot="avatar-change"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border-2 border-card bg-muted text-muted-foreground shadow-sm outline-none transition-[transform,color] duration-200 hover:scale-110 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 active:scale-95 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
          </button>
        </div>
        {onRemove && user.avatar_url && (
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" data-slot="avatar-remove" disabled={disabled || busy} onClick={() => onRemove()}>
            <Trash2 /> 삭제
          </Button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={accept.join(",")} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      {showHint && <p className="text-center text-xs text-muted-foreground">JPG, PNG, WEBP · {maxSizeMB}MB 이하</p>}
      {error && <p role="alert" className="whitespace-pre-line text-center text-xs text-destructive">{error.replace(/\.\s+/g, ".\n")}</p>}
    </div>
  );
}
