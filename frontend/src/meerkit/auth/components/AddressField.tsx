"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AddressType } from "../../define-config";
import { defaultAddressSearchProvider } from "./address-provider";
import { AddressSearchDialog } from "./AddressSearchDialog";
import { searchAddress, type AddressSearchProvider, type AddressSearchResult } from "./address-search";

export interface AddressValue {
  postcode: string;
  address: string;
  address_detail: string;
}

interface AddressFieldProps {
  /** "basic": 주소 + 상세 주소 / "postcode": 우편번호 + 주소 + 상세 주소 */
  variant?: AddressType;
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  /**
   * 주소 검색 방식.
   * "popup": 카카오(다음) 우편번호 팝업. 별도 서버 없이 바로 쓸 수 있고, 결과 목록은 팝업이 알아서 나눠 보여 준다. (기본)
   * "dialog": 우리 검색 창. 서비스 서버(GET /address/search)를 호출하고 결과 목록과 "더 보기"를 보여 준다.
   */
  searchMode?: "popup" | "dialog";
  /** popup 방식의 검색 방법을 바꾼다. 없으면 카카오 우편번호 팝업 */
  onSearch?: () => Promise<AddressSearchResult | null>;
  /** dialog 방식의 검색 방법을 바꾼다. 없으면 서비스 서버의 /address/search */
  searchProvider?: AddressSearchProvider;
  idPrefix?: string;
  disabled?: boolean;
}

// 주소 검색 버튼으로 고르면 우편번호와 주소가 함께 채워지고, 상세 주소는 직접 입력한다.
export function AddressField({
  variant = "basic",
  value,
  onChange,
  searchMode = "popup",
  onSearch = searchAddress,
  searchProvider = defaultAddressSearchProvider,
  idPrefix = "address",
  disabled,
}: AddressFieldProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 검색을 불러오지 못하면 직접 입력할 수 있게 열어 준다
  const [manual, setManual] = useState(false);

  async function search() {
    setSearching(true);
    setMessage(null);
    try {
      const result = await onSearch();
      if (result) onChange({ ...value, postcode: result.postcode, address: result.address });
    } catch {
      setManual(true);
      setMessage("주소 검색을 불러오지 못했습니다. 직접 입력해 주세요.");
    } finally {
      setSearching(false);
    }
  }

  // 입력칸을 눌러도 검색이 실행되지 않는다. 검색은 [주소 검색] 버튼으로만 시작한다.
  const searchButton = (
    <Button type="button" variant="outline" disabled={disabled || searching} onClick={() => (searchMode === "dialog" ? setDialogOpen(true) : search())} size="field">
      <Search /> {searching ? "검색 중…" : "주소 검색"}
    </Button>
  );
  const readOnly = searchMode === "dialog" || !manual;

  return (
    <div className="grid gap-2">
      {variant === "postcode" ? (
        <>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-postcode`}
              aria-label="우편번호"
              placeholder="우편번호"
              readOnly={readOnly}
              disabled={disabled}
              className="max-w-40"
              value={value.postcode}
              onChange={(e) => onChange({ ...value, postcode: e.target.value })}
            />
            {searchButton}
          </div>
          <Input
            id={`${idPrefix}-address`}
            aria-label="주소"
            placeholder="주소"
            readOnly={readOnly}
            disabled={disabled}
            value={value.address}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
          />
        </>
      ) : (
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-address`}
            aria-label="주소"
            placeholder="주소"
            readOnly={readOnly}
            disabled={disabled}
            value={value.address}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
          />
          {searchButton}
        </div>
      )}
      <Input
        id={`${idPrefix}-detail`}
        aria-label="상세 주소"
        placeholder="상세 주소 (동·호수 등)"
        autoComplete="address-line2"
        disabled={disabled}
        value={value.address_detail}
        onChange={(e) => onChange({ ...value, address_detail: e.target.value })}
      />
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      {searchMode === "dialog" && (
        <AddressSearchDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          provider={searchProvider}
          onSelect={(item) => onChange({ ...value, postcode: item.postcode, address: item.address })}
        />
      )}
    </div>
  );
}

export function AddressFieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <Label htmlFor={htmlFor}>{children} <span className="font-normal text-muted-foreground">(선택)</span></Label>;
}
