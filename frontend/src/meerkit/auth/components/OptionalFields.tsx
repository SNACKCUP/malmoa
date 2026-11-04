"use client";

import { memo, useCallback } from "react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type { AddressType, SignupOptionalField } from "../../define-config";
import { DatePicker } from "../../date";
import { PhoneInput, PhoneInputSplit } from "../../phone";
import type { User } from "../../types";
import { AddressField, AddressFieldLabel } from "./AddressField";
import { NicknameInput } from "./NicknameInput";
import type { AddressSearchProvider, AddressSearchResult } from "./address-search";

// 가입 폼과 내 정보 수정 폼이 함께 쓰는 선택 항목 입력 모음.
export interface OptionalValues {
  nickname: string;
  phone: string;
  postcode: string;
  address: string;
  address_detail: string;
  birth_date: string;
  gender: string;
}

export const emptyOptionalValues: OptionalValues = {
  nickname: "", phone: "", postcode: "", address: "", address_detail: "", birth_date: "", gender: "",
};

export const GENDER_OPTIONS = [
  { value: "male", label: "남성" },
  { value: "female", label: "여성" },
  { value: "none", label: "선택 안 함" },
] as const;

export const NICKNAME_RANGE = { min: 2, max: 12 } as const;

/** 이름 글자 수 제한의 기본값. meerkit.config.ts의 signup.name으로 바꾼다 */
export const DEFAULT_NAME_RANGE = { min: 2, max: 10 } as const;

export function validateName(name: string, range: { min: number; max: number } = DEFAULT_NAME_RANGE): string | null {
  const length = Array.from(name.trim()).length;
  if (length === 0) return "이름을 입력해 주세요.";
  if (length < range.min || length > range.max) return `이름은 ${range.min}~${range.max}자로 입력해 주세요.`;
  return null;
}

export function optionalValuesFromUser(user: User): OptionalValues {
  return {
    nickname: user.nickname ?? "",
    phone: user.phone ?? "",
    postcode: user.postcode ?? "",
    address: user.address ?? "",
    address_detail: user.address_detail ?? "",
    birth_date: user.birth_date ?? "",
    gender: user.gender ?? "",
  };
}

/** 켜 둔 항목만 골라 서버로 보낼 값으로 만든다. 가입에서는 빈 값을 빼고, 수정에서는 비운 값도 보낸다. */
export function collectOptional(values: OptionalValues, fields: SignupOptionalField[], addressType: AddressType, keepEmpty = false) {
  const out: Record<string, string> = {};
  const put = (key: string, value: string) => {
    const v = value.trim();
    if (v || keepEmpty) out[key] = v;
  };
  for (const field of fields) {
    if (field === "address") {
      if (addressType === "postcode") put("postcode", values.postcode);
      put("address", values.address);
      put("address_detail", values.address_detail);
    } else {
      put(field, values[field]);
    }
  }
  return out;
}

export function validateOptional(values: OptionalValues, fields: SignupOptionalField[]): string | null {
  if (fields.includes("nickname") && values.nickname.trim()) {
    const len = Array.from(values.nickname.trim()).length;
    if (len < NICKNAME_RANGE.min || len > NICKNAME_RANGE.max) {
      return `닉네임은 ${NICKNAME_RANGE.min}~${NICKNAME_RANGE.max}자로 입력해 주세요.`;
    }
  }
  return null;
}

interface OptionalFieldsProps {
  fields: SignupOptionalField[];
  values: OptionalValues;
  /** 바뀐 항목만 넘긴다. 부모에서 useCallback으로 고정해서 주면 입력한 칸만 다시 그려진다 */
  onChange: (patch: Partial<OptionalValues>) => void;
  addressType?: AddressType;
  /** 주소 검색 방식과 검색 방법 (AddressField 참고) */
  addressSearch?: "popup" | "dialog";
  onSearchAddress?: () => Promise<AddressSearchResult | null>;
  addressSearchProvider?: AddressSearchProvider;
  /** 라벨 옆에 (선택)을 붙일지 */
  markOptional?: boolean;
  /** 닉네임 입력칸 옆에 [자동 생성] 버튼을 보여 줄지. 기본 true */
  nicknameGenerator?: boolean;
  /** 전화번호 입력 방식. 어느 쪽이든 같은 형식("010-1234-5678")의 값을 돌려준다. 기본 "single" */
  phoneInput?: "single" | "split";
  idPrefix: string;
}

// 항목마다 따로 그린다. 한 칸을 입력해도 그 칸만 다시 그려지도록 값(문자열)만 받는 memo 컴포넌트로 나눈다.
interface FieldCommon {
  idPrefix: string;
  opt: React.ReactNode;
  onChange: (patch: Partial<OptionalValues>) => void;
}

const NicknameField = memo(function NicknameField({ idPrefix, opt, onChange, value, generator }: FieldCommon & { value: string; generator: boolean }) {
  const set = useCallback((nickname: string) => onChange({ nickname }), [onChange]);
  return (
    <div className="mk-swap grid gap-2">
      <Label htmlFor={`${idPrefix}-nickname`}>닉네임{opt}</Label>
      <NicknameInput id={`${idPrefix}-nickname`} value={value} onChange={set} generator={generator} placeholder={`${NICKNAME_RANGE.min}~${NICKNAME_RANGE.max}자, 다른 사용자에게 보이는 이름`} />
    </div>
  );
});

const GenderField = memo(function GenderField({ idPrefix, opt, onChange, value }: FieldCommon & { value: string }) {
  return (
    <div className="mk-swap grid gap-2">
      <Label>성별{opt}</Label>
      <RadioGroup className="grid-flow-col justify-start gap-5" value={value} onValueChange={(v) => onChange({ gender: v })}>
        {GENDER_OPTIONS.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <RadioGroupItem id={`${idPrefix}-gender-${o.value}`} value={o.value} />
            <Label htmlFor={`${idPrefix}-gender-${o.value}`} className="cursor-pointer font-normal">{o.label}</Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
});

const PhoneField = memo(function PhoneField({ idPrefix, opt, onChange, value, mode }: FieldCommon & { value: string; mode: "single" | "split" }) {
  const set = useCallback((phone: string) => onChange({ phone }), [onChange]);
  const Input = mode === "split" ? PhoneInputSplit : PhoneInput;
  return (
    <div className="mk-swap grid gap-2">
      <Label htmlFor={`${idPrefix}-phone`}>전화번호{opt}</Label>
      <Input id={`${idPrefix}-phone`} value={value} onChange={set} />
    </div>
  );
});

const BirthDateField = memo(function BirthDateField({ idPrefix, opt, onChange, value }: FieldCommon & { value: string }) {
  const set = useCallback((birth_date: string) => onChange({ birth_date }), [onChange]);
  return (
    <div className="mk-swap grid gap-2">
      <Label htmlFor={`${idPrefix}-birth_date`}>생년월일{opt}</Label>
      <DatePicker id={`${idPrefix}-birth_date`} value={value} onChange={set} max={todayLocal()} placeholder="생년월일 선택" yearMonthSelect className="h-11 px-4" />
    </div>
  );
});

// 오늘(브라우저 기준) 날짜. 생년월일은 미래를 고를 수 없다
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const AddressInput = memo(function AddressInput({
  idPrefix, onChange, postcode, address, address_detail, addressType, addressSearch, onSearchAddress, addressSearchProvider, markOptional,
}: Pick<FieldCommon, "idPrefix" | "onChange"> & {
  postcode: string; address: string; address_detail: string; addressType: AddressType; markOptional: boolean;
  addressSearch?: "popup" | "dialog"; onSearchAddress?: () => Promise<AddressSearchResult | null>; addressSearchProvider?: AddressSearchProvider;
}) {
  return (
    <div className="mk-swap grid gap-2">
      {markOptional ? <AddressFieldLabel>주소</AddressFieldLabel> : <Label>주소</Label>}
      <AddressField
        variant={addressType}
        idPrefix={`${idPrefix}-address`}
        value={{ postcode, address, address_detail }}
        onChange={onChange}
        searchMode={addressSearch}
        onSearch={onSearchAddress}
        searchProvider={addressSearchProvider}
      />
    </div>
  );
});

export function OptionalFields({ fields, values, onChange, addressType = "basic", addressSearch, onSearchAddress, addressSearchProvider, markOptional = true, nicknameGenerator = true, phoneInput = "single", idPrefix }: OptionalFieldsProps) {
  const opt = markOptional ? <span className="font-normal text-muted-foreground"> (선택)</span> : null;
  const common = { idPrefix, opt, onChange };

  return (
    <>
      {fields.map((field) => {
        switch (field) {
          case "nickname":
            return <NicknameField key={field} {...common} value={values.nickname} generator={nicknameGenerator} />;
          case "gender":
            return <GenderField key={field} {...common} value={values.gender} />;
          case "phone":
            return <PhoneField key={field} {...common} value={values.phone} mode={phoneInput} />;
          case "birth_date":
            return <BirthDateField key={field} {...common} value={values.birth_date} />;
          case "address":
            return (
              <AddressInput
                key={field}
                idPrefix={idPrefix}
                onChange={onChange}
                postcode={values.postcode}
                address={values.address}
                address_detail={values.address_detail}
                addressType={addressType}
                addressSearch={addressSearch}
                onSearchAddress={onSearchAddress}
                addressSearchProvider={addressSearchProvider}
                markOptional={markOptional}
              />
            );
        }
      })}
    </>
  );
}
