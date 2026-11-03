"use client";

import { MapPin, Search, SearchX } from "lucide-react";
import { useRef, useState } from "react";

import { LoadingState } from "../../loading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { errorMessage } from "../../api/error";
import type { AddressItem, AddressSearchProvider } from "./address-search";

const PAGE_SIZE = 10;

interface AddressSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AddressSearchProvider;
  /** 목록에서 주소를 고르면 호출된다. 창은 닫힌다 */
  onSelect: (item: AddressItem) => void;
}

type State =
  | { phase: "idle" }
  | { phase: "loading"; query: string }
  | { phase: "done"; query: string; items: AddressItem[]; total: number; page: number; isEnd: boolean; more?: boolean; error?: string }
  | { phase: "error"; query: string; message: string };

// 검색어를 입력하면 결과 목록이 나오고, 결과가 많으면 "더 보기"로 이어서 불러온다.
function Body({ provider, onSelect, onOpenChange }: Omit<AddressSearchDialogProps, "open">) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const listRef = useRef<HTMLUListElement>(null);

  async function run(query: string) {
    const q = query.trim();
    if (!q) return;
    setState({ phase: "loading", query: q });
    try {
      const res = await provider(q, 1, PAGE_SIZE);
      setState({ phase: "done", query: q, items: res.items, total: res.total, page: 1, isEnd: res.isEnd });
      listRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      setState({ phase: "error", query: q, message: errorMessage(e) ?? "주소를 검색하지 못했습니다." });
    }
  }

  async function more() {
    if (state.phase !== "done") return;
    const next = state.page + 1;
    setState({ ...state, more: true, error: undefined });
    try {
      const res = await provider(state.query, next, PAGE_SIZE);
      setState({ phase: "done", query: state.query, items: [...state.items, ...res.items], total: res.total, page: next, isEnd: res.isEnd });
    } catch (e) {
      setState({ ...state, more: false, error: errorMessage(e) ?? "더 불러오지 못했습니다." });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>주소 검색</DialogTitle>
        <DialogDescription>도로명, 지번, 건물명으로 검색한 뒤 목록에서 주소를 선택하세요.</DialogDescription>
      </DialogHeader>

      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="주소 검색어" autoFocus placeholder="예) 테헤란로 152" className="pl-9" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <Button type="submit" disabled={!text.trim() || state.phase === "loading"}>검색</Button>
      </form>

      <div className="min-h-64">
        {state.phase === "idle" && (
          <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
            <MapPin className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">주소를 검색해 보세요</p>
            <p className="text-xs leading-5 text-muted-foreground">도로명과 번지(예: 테헤란로 152)나 건물명으로 찾으면 정확합니다.</p>
          </div>
        )}

        {state.phase === "loading" && (
          <LoadingState label="검색 중…" className="py-12" />
        )}

        {state.phase === "error" && (
          <div role="alert" className="grid justify-items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-destructive">{state.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => run(state.query)}>다시 시도</Button>
          </div>
        )}

        {state.phase === "done" && state.items.length === 0 && (
          <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
            <SearchX className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">&quot;{state.query}&quot;와 맞는 주소가 없습니다</p>
            <p className="text-xs text-muted-foreground">철자를 확인하거나 도로명 또는 건물명으로 다시 검색해 보세요.</p>
          </div>
        )}

        {state.phase === "done" && state.items.length > 0 && (
          <div className="grid gap-2">
            <p className="px-1 text-xs text-muted-foreground">
              &quot;{state.query}&quot; 검색 결과 <span className="font-medium text-foreground">{state.total}</span>건
              {state.items.length < state.total && <> · {state.items.length}건 표시 중</>}
            </p>
            <ul ref={listRef} className="mk-scroll max-h-72 divide-y overflow-y-auto rounded-2xl border bg-card">
              {state.items.map((item, i) => (
                <li key={`${item.postcode}-${item.address}-${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(item);
                      onOpenChange(false);
                    }}
                    className="grid w-full gap-0.5 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      {item.address}
                      {item.building_name && <span className="font-normal text-muted-foreground">({item.building_name})</span>}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 font-mono text-[11px] text-foreground/70">{item.postcode || "우편번호 없음"}</span>
                      {item.jibun_address && <span className="truncate">지번 {item.jibun_address}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {state.error && <p role="alert" className="px-1 text-xs text-destructive">{state.error}</p>}
            {!state.isEnd ? (
              <Button type="button" variant="outline" size="sm" className="justify-self-center" disabled={state.more} onClick={more}>
                {state.more ? <LoadingState label="불러오는 중…" size="sm" layout="inline" /> : "더 보기"}
              </Button>
            ) : (
              state.total > PAGE_SIZE && <p className="text-center text-xs text-muted-foreground">모든 결과를 불러왔습니다.</p>
            )}
            {!state.isEnd && state.total > 30 && (
              <p className="text-center text-xs text-muted-foreground">결과가 많습니다. 번지나 건물명을 더하면 더 빨리 찾을 수 있어요.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function AddressSearchDialog({ open, onOpenChange, ...rest }: AddressSearchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        {/* 열 때마다 검색 상태를 새로 시작한다 */}
        {open && <Body onOpenChange={onOpenChange} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}
