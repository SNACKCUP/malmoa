"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AddressType, SignupOptionalField } from "../../define-config";
import type { UpdateProfileInput, User } from "../../types";
import type { AddressSearchProvider, AddressSearchResult } from "./address-search";
import { EmailVerificationField } from "./EmailVerificationField";
import type { EmailVerificationHandlers } from "./SignupForm";
import { DEFAULT_NAME_RANGE, OptionalFields, collectOptional, optionalValuesFromUser, validateName, validateOptional, type OptionalValues } from "./OptionalFields";
import { TextField } from "./TextField";

interface ProfileFormProps {
  user: User;
  onSubmit: (input: UpdateProfileInput) => void;
  pending?: boolean;
  error?: string | null;
  /** 함께 수정할 선택 항목. 가입 폼에서 켠 것과 같은 목록을 쓴다 */
  optionalFields?: SignupOptionalField[];
  addressType?: AddressType;
  addressSearch?: "popup" | "dialog";
  onSearchAddress?: () => Promise<AddressSearchResult | null>;
  addressSearchProvider?: AddressSearchProvider;
  /** 주면 이메일을 바꿀 때 새 이메일로 인증번호를 확인해야 저장할 수 있다 (서버가 요구) */
  emailVerification?: EmailVerificationHandlers;
  /** 이름 글자 수 제한. 기본 2~10자 */
  nameRange?: { min: number; max: number };
  /** 전화번호 입력 방식. 기본 "single" */
  phoneInput?: "single" | "split";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 아이디는 바꿀 수 없다. 이름, 이메일, 켜 둔 선택 항목(닉네임, 주소 등)만 수정한다.
export function ProfileForm({ user, onSubmit, pending, error, optionalFields = [], addressType = "basic", addressSearch, onSearchAddress, addressSearchProvider, emailVerification, nameRange = DEFAULT_NAME_RANGE, phoneInput }: ProfileFormProps) {
  const [form, setForm] = useState({ name: user.name, email: user.email });
  const [emailToken, setEmailToken] = useState<string | null>(null);
  const emailChanged = form.email.trim().toLowerCase() !== user.email;
  const [optional, setOptional] = useState<OptionalValues>(() => optionalValuesFromUser(user));
  const [invalid, setInvalid] = useState<string | null>(null);
  // 이메일은 평소에는 읽기만 하고, [변경]을 눌러야 입력칸이 열린다
  const [editingEmail, setEditingEmail] = useState(false);

  const setName = useCallback((_: string, name: string) => setForm((p) => ({ ...p, name })), []);
  const setEmail = useCallback((email: string) => setForm((p) => ({ ...p, email })), []);
  const setEmailValue = useCallback((_: string, email: string) => setEmail(email), [setEmail]);
  const setOptionalPatch = useCallback((patch: Partial<OptionalValues>) => setOptional((p) => ({ ...p, ...patch })), []);
  const cancelEmail = useCallback(() => {
    setEditingEmail(false);
    setEmailToken(null);
    setForm((p) => ({ ...p, email: user.email }));
  }, [user.email]);

  const initial = optionalValuesFromUser(user);
  const keys = Object.keys(collectOptional(optional, optionalFields, addressType, true)) as (keyof OptionalValues)[];
  const dirty = form.name !== user.name || form.email !== user.email || keys.some((k) => optional[k] !== initial[k]);

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const nameProblem = validateName(form.name, nameRange);
        if (nameProblem) return setInvalid(nameProblem);
        if (!EMAIL_PATTERN.test(form.email)) return setInvalid("이메일 형식이 올바르지 않습니다.");
        if (emailVerification && emailChanged && !emailToken) return setInvalid("새 이메일 인증을 완료해 주세요.");
        const optionalError = validateOptional(optional, optionalFields);
        if (optionalError) return setInvalid(optionalError);
        setInvalid(null);
        // 수정에서는 비운 값도 보내서 지울 수 있게 한다
        onSubmit({
          name: form.name.trim(),
          email: form.email,
          ...(emailChanged && emailToken ? { email_verification_token: emailToken } : {}),
          ...collectOptional(optional, optionalFields, addressType, true),
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="profile-user-id">아이디</Label>
        <Input id="profile-user-id" value={user.user_id} disabled readOnly />
        <p className="text-xs text-muted-foreground">아이디는 변경할 수 없습니다.</p>
      </div>
      <TextField id="profile-name" name="name" label="이름" autoComplete="name" required maxLength={nameRange.max} placeholder={`${nameRange.min}~${nameRange.max}자`} value={form.name} onValueChange={setName} />
      {emailVerification ? (
        editingEmail ? (
          <div className="grid gap-1">
            {/* 입력칸 오른쪽에 [취소] [인증번호 받기] 순서로 놓는다 */}
            <EmailVerificationField
              id="profile-email"
              value={form.email}
              onChange={setEmail}
              verified={emailToken !== null}
              onVerifiedChange={setEmailToken}
              sendCode={emailVerification.sendCode}
              verifyCode={emailVerification.verifyCode}
              unchanged={!emailChanged}
              onCancel={cancelEmail}
              verifiedText="저장하면 이 이메일로 바뀝니다."
            />
            <p className="text-xs text-muted-foreground">새 이메일로 인증번호를 확인해야 저장할 수 있습니다.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="profile-email">이메일</Label>
            <div className="flex gap-2">
              <Input id="profile-email" type="email" value={user.email} readOnly />
              <Button type="button" variant="outline" size="field" onClick={() => setEditingEmail(true)}>변경</Button>
            </div>
          </div>
        )
      ) : (
        <TextField id="profile-email" name="email" label="이메일" type="email" autoComplete="email" required value={form.email} onValueChange={setEmailValue} />
      )}
      <OptionalFields
        idPrefix="profile"
        fields={optionalFields}
        values={optional}
        onChange={setOptionalPatch}
        phoneInput={phoneInput}
        addressType={addressType}
        addressSearch={addressSearch}
        onSearchAddress={onSearchAddress}
        addressSearchProvider={addressSearchProvider}
        markOptional={false}
      />
      {(invalid ?? error) && <p role="alert" className="text-sm text-destructive">{invalid ?? error}</p>}
      <Button type="submit" disabled={pending || !dirty} className="justify-self-end">
        {pending ? "저장 중…" : "저장"}
      </Button>
    </form>
  );
}
