"use client";

import { GoogleButton } from "./GoogleButton";

interface SocialLoginProps {
  onGoogle: () => void;
  disabled?: boolean;
  /** 구글 버튼 글자. 가입 화면에서는 "구글 계정으로 가입하기"처럼 바꿀 수 있다 */
  googleLabel?: string;
}

// "또는 소셜 로그인으로 시작하기" 구분선과 소셜 로그인 버튼 모음. 로그인·가입 폼이 같이 쓴다.
export function SocialLogin({ onGoogle, disabled, googleLabel }: SocialLoginProps) {
  return (
    <>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
        <span className="h-px flex-1 bg-border" />
        또는 소셜 로그인으로 시작하기
        <span className="h-px flex-1 bg-border" />
      </div>
      <GoogleButton onClick={onGoogle} disabled={disabled} label={googleLabel} />
    </>
  );
}
