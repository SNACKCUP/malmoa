"use client";

import Link from "next/link";
import { memo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { TermsItem } from "../../define-config";

interface TermsAgreementProps {
  terms: TermsItem[];
  /** 동의한 약관의 id 목록 */
  value: string[];
  onChange: (ids: string[]) => void;
  invalid?: boolean;
}

// 전체 동의 + 개별 약관 체크박스. 필수/선택 표시와 약관 전문 링크가 있다.
export const TermsAgreement = memo(function TermsAgreement({ terms, value, onChange, invalid }: TermsAgreementProps) {
  if (terms.length === 0) return null;
  const allChecked = terms.every((t) => value.includes(t.id));
  const someChecked = value.length > 0 && !allChecked;

  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...value, id] : value.filter((v) => v !== id));

  return (
    <fieldset className={cn("grid gap-3 rounded-2xl border bg-card p-4 transition-colors", invalid && "border-destructive/60")}>
      <legend className="sr-only">약관 동의</legend>
      <div className="flex items-center gap-3">
        <Checkbox
          id="terms-all"
          checked={allChecked ? true : someChecked ? "indeterminate" : false}
          onCheckedChange={(c) => onChange(c === true ? terms.map((t) => t.id) : [])}
        />
        <Label htmlFor="terms-all" className="cursor-pointer text-sm font-semibold">전체 동의</Label>
      </div>
      <div className="grid gap-2.5 border-t pt-3">
        {terms.map((t) => (
          <div key={t.id} className="flex items-center gap-3">
            <Checkbox id={`terms-${t.id}`} checked={value.includes(t.id)} onCheckedChange={(c) => toggle(t.id, c === true)} />
            <Label htmlFor={`terms-${t.id}`} className="flex-1 cursor-pointer text-[13px] font-normal">
              <span className={cn("mr-1.5 text-xs font-medium", t.required ? "text-brand" : "text-muted-foreground")}>
                [{t.required ? "필수" : "선택"}]
              </span>
              {t.label}
            </Label>
            {t.href && (
              <Link href={t.href} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                보기
              </Link>
            )}
          </div>
        ))}
      </div>
    </fieldset>
  );
});
