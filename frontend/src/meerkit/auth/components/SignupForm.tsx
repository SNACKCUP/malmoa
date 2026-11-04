"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AddressType, SignupOptionalField, TermsItem } from "../../define-config";
import { errorMessage } from "../../api/error";
import type { SignupInput } from "../../types";
import type { AddressSearchProvider, AddressSearchResult } from "./address-search";
import { EmailVerificationField } from "./EmailVerificationField";
import { generateNickname } from "../nickname";
import { DEFAULT_NAME_RANGE, OptionalFields, collectOptional, emptyOptionalValues, validateName, validateOptional, type OptionalValues } from "./OptionalFields";
import { SocialLogin } from "./SocialLogin";
import { TextField } from "./TextField";
import { TermsAgreement } from "./TermsAgreement";

export interface EmailVerificationHandlers {
  sendCode: (email: string) => Promise<unknown>;
  /** 인증번호가 맞으면 가입 요청에 붙일 증표(token)를 돌려준다 */
  verifyCode: (email: string, code: string) => Promise<string>;
}

interface SignupFormProps {
  /** 있으면 폼 아래에 "소셜 로그인" 구분선과 [구글 계정으로 가입하기] 버튼을 보여 준다. 구글 계정으로 처음 오면 서버가 계정을 만든다 */
  onGoogle?: () => void;
  onSubmit: (input: SignupInput) => void;
  pending?: boolean;
  error?: string | null;
  /** 비밀번호 확인 입력을 추가한다. 서버로는 보내지 않는다. */
  passwordConfirm?: boolean;
  /** 추가로 받을 선택 항목 */
  optionalFields?: SignupOptionalField[];
  /** 주소 입력 방식. "basic": 주소 + 상세 주소 / "postcode": 우편번호 + 주소 + 상세 주소 */
  addressType?: AddressType;
  /** 동의받을 약관. 비어 있으면 약관 영역이 없다 */
  terms?: TermsItem[];
  /** 주면 이메일 옆에 인증번호 받기·확인 버튼이 생기고, 인증해야 가입할 수 있다 */
  emailVerification?: EmailVerificationHandlers;
  /**
   * 이미 확인된 이메일로 가입할 때 (예: 서비스의 초대 링크). 이메일 칸을 이 값으로 고정하고 인증번호 단계 없이
   * token을 가입 요청의 증표로 보낸다. 서버가 증표의 이메일과 가입 이메일이 같은지 다시 확인한다.
   */
  presetEmail?: { email: string; token: string };
  /** 주면 아이디 옆에 [중복 확인] 버튼이 생기고, 사용 가능 확인을 받아야 가입할 수 있다. 쓸 수 있으면 true */
  checkUserId?: (userId: string) => Promise<boolean>;
  /** 이름 글자 수 제한. 기본 2~10자 */
  nameRange?: { min: number; max: number };
  /** 전화번호 입력 방식. 기본 "single" */
  phoneInput?: "single" | "split";
  /** 닉네임 동작: [자동 생성] 버튼 표시, 폼을 열 때 미리 채우기 */
  nickname?: { generator?: boolean; autoFill?: boolean };
  /** 주소 검색 방식. "popup"(카카오 우편번호 팝업, 기본) 또는 "dialog"(우리 검색 창) */
  addressSearch?: "popup" | "dialog";
  /** popup 방식의 검색 방법을 바꾸고 싶을 때 */
  onSearchAddress?: () => Promise<AddressSearchResult | null>;
  /** dialog 방식의 검색 방법을 바꾸고 싶을 때 (기본: 서비스 서버의 /address/search) */
  addressSearchProvider?: AddressSearchProvider;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ID_HINT = "영문으로 시작, 숫자·밑줄(_) 함께 사용 가능, 4~30자";

// 서버 규칙(backend app/auth/schemas.py의 check_login_id)과 같은 규칙·문구. 어긋나면 이유를, 맞으면 null을 돌려준다
function userIdProblem(raw: string): string | null {
  const value = raw.trim();
  if (value.length < 4 || value.length > 30) return "아이디는 4~30자로 입력해 주세요.";
  if (!/^[A-Za-z0-9_]+$/.test(value)) return "아이디는 영문·숫자·밑줄(_)만 쓸 수 있습니다.";
  if (!/^[A-Za-z]/.test(value)) return "아이디는 영문으로 시작해야 해요. (영문, 영문+숫자, 영문+밑줄, 영문+숫자+밑줄 가능)";
  return null;
}

type IdCheck = { value: string; status: "checking" | "available" | "taken" | "error"; message?: string };

export function SignupForm({
  onSubmit,
  pending,
  error,
  passwordConfirm = false,
  optionalFields = [],
  addressType = "basic",
  terms = [],
  emailVerification,
  presetEmail,
  checkUserId,
  nickname,
  nameRange = DEFAULT_NAME_RANGE,
  phoneInput,
  addressSearch,
  onSearchAddress,
  addressSearchProvider,
  onGoogle,
}: SignupFormProps) {
  const [form, setForm] = useState({ user_id: "", email: presetEmail?.email ?? "", name: "", password: "", password_confirm: "" });
  const [optional, setOptional] = useState<OptionalValues>(() => ({
    ...emptyOptionalValues,
    // 설정에서 켜 두면 닉네임을 미리 채운다 (사용자가 고칠 수 있다)
    nickname: nickname?.autoFill && optionalFields.includes("nickname") ? generateNickname() : "",
  }));
  const [agreed, setAgreed] = useState<string[]>([]);
  const [emailToken, setEmailToken] = useState<string | null>(presetEmail?.token ?? null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [termsInvalid, setTermsInvalid] = useState(false);
  // 마지막으로 확인한 아이디와 결과. 아이디를 고치면 다시 확인해야 한다
  const [idCheck, setIdCheck] = useState<IdCheck | null>(null);
  const normalizedId = form.user_id.trim().toLowerCase();
  const idStatus = idCheck && idCheck.value === normalizedId ? idCheck.status : null;

  async function runIdCheck() {
    if (!checkUserId) return;
    const problem = userIdProblem(form.user_id);
    if (problem) return setIdCheck({ value: normalizedId, status: "error", message: problem });
    setIdCheck({ value: normalizedId, status: "checking" });
    try {
      const available = await checkUserId(normalizedId);
      setIdCheck({ value: normalizedId, status: available ? "available" : "taken" });
    } catch (e) {
      setIdCheck({ value: normalizedId, status: "error", message: errorMessage(e) ?? "확인하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }
  // 아래 핸들러는 모두 고정해 둔다. 한 칸을 입력할 때 다른 칸·부품이 다시 그려지지 않게 하기 위해서다.
  const setField = useCallback((name: string, value: string) => setForm((prev) => ({ ...prev, [name]: value })), []);
  const setEmail = useCallback((email: string) => setForm((p) => ({ ...p, email })), []);
  const setOptionalPatch = useCallback((patch: Partial<OptionalValues>) => setOptional((p) => ({ ...p, ...patch })), []);
  const setAgreedTerms = useCallback((v: string[]) => { setAgreed(v); setTermsInvalid(false); }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTermsInvalid(false);
    const idProblem = userIdProblem(form.user_id);
    if (idProblem) return setInvalid(idProblem);
    const nameProblem = validateName(form.name, nameRange);
    if (nameProblem) return setInvalid(nameProblem);
    if (checkUserId && idStatus !== "available") return setInvalid("아이디 중복 확인을 해 주세요.");
    if (!EMAIL_PATTERN.test(form.email)) return setInvalid("이메일 형식이 올바르지 않습니다.");
    if (emailVerification && !presetEmail && !emailToken) return setInvalid("이메일 인증을 완료해 주세요.");
    if (form.password.length < 8) return setInvalid("비밀번호는 8자 이상이어야 합니다.");
    if (passwordConfirm && form.password !== form.password_confirm) return setInvalid("비밀번호가 일치하지 않습니다.");
    const optionalError = validateOptional(optional, optionalFields);
    if (optionalError) return setInvalid(optionalError);
    if (terms.some((t) => t.required && !agreed.includes(t.id))) {
      setTermsInvalid(true);
      return setInvalid("필수 약관에 모두 동의해 주세요.");
    }
    setInvalid(null);

    const input: SignupInput = {
      user_id: form.user_id.trim(),
      name: form.name.trim(),
      email: form.email,
      password: form.password,
      // 켜 둔 선택 항목 중 값이 있는 것만 보낸다. 비밀번호 확인은 보내지 않는다.
      ...collectOptional(optional, optionalFields, addressType),
    };
    if (terms.length > 0) input.agreed_terms = agreed;
    if ((emailVerification || presetEmail) && emailToken) input.email_verification_token = emailToken;
    onSubmit(input);
  }

  const message = invalid ?? error;

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-2">
        <Label htmlFor="signup-user-id">아이디</Label>
        <div className="flex gap-2">
          <Input id="signup-user-id" autoComplete="username" required value={form.user_id} onChange={(e) => setField("user_id", e.target.value)} />
          {checkUserId && (
            <Button
              type="button"
              variant="outline"
              size="field"
              disabled={!form.user_id.trim() || idStatus === "checking" || idStatus === "available"}
              onClick={runIdCheck}
            >
              {idStatus === "checking" ? "확인 중…" : idStatus === "available" ? "확인 완료" : "중복 확인"}
            </Button>
          )}
        </div>
        {checkUserId && idStatus && idStatus !== "checking" && (
          <p
            role={idStatus === "available" ? "status" : "alert"}
            className={cn("mk-swap text-xs", idStatus === "available" ? "text-brand" : "text-destructive")}
          >
            {idStatus === "available" ? "사용할 수 있는 아이디입니다." : idStatus === "taken" ? "이미 사용 중인 아이디입니다." : idCheck?.message}
          </p>
        )}
        {(!idStatus || idStatus === "checking") && <p className="text-xs text-muted-foreground">{USER_ID_HINT}</p>}
      </div>
      <TextField id="signup-name" name="name" label="이름" autoComplete="name" required maxLength={nameRange.max} placeholder={`${nameRange.min}~${nameRange.max}자`} value={form.name} onValueChange={setField} />
      {presetEmail ? (
        <TextField id="signup-email" name="email" label="이메일" type="email" autoComplete="email" required disabled value={presetEmail.email} onValueChange={setField} />
      ) : emailVerification ? (
        <EmailVerificationField
          value={form.email}
          onChange={setEmail}
          verified={emailToken !== null}
          onVerifiedChange={setEmailToken}
          sendCode={emailVerification.sendCode}
          verifyCode={emailVerification.verifyCode}
        />
      ) : (
        <TextField id="signup-email" name="email" label="이메일" type="email" autoComplete="email" required value={form.email} onValueChange={setField} />
      )}
      <TextField id="signup-password" name="password" label="비밀번호" type="password" autoComplete="new-password" required value={form.password} onValueChange={setField} />
      {passwordConfirm && (
        <div className="mk-swap">
          <TextField id="signup-password-confirm" name="password_confirm" label="비밀번호 확인" type="password" autoComplete="new-password" required value={form.password_confirm} onValueChange={setField} />
        </div>
      )}
      <OptionalFields
        idPrefix="signup"
        fields={optionalFields}
        values={optional}
        onChange={setOptionalPatch}
        phoneInput={phoneInput}
        addressType={addressType}
        nicknameGenerator={nickname?.generator ?? true}
        addressSearch={addressSearch}
        onSearchAddress={onSearchAddress}
        addressSearchProvider={addressSearchProvider}
      />
      <TermsAgreement terms={terms} value={agreed} onChange={setAgreedTerms} invalid={termsInvalid} />
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <Button type="submit" disabled={pending}>{pending ? "가입 중…" : "회원가입"}</Button>
      {onGoogle && <SocialLogin onGoogle={onGoogle} disabled={pending} googleLabel="구글 계정으로 가입하기" />}
    </form>
  );
}
