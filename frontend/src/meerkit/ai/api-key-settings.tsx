"use client";

import { Eye, EyeOff, Info, KeyRound } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useAuth } from "../auth/hooks";
import { LoginRequiredDialog } from "./LoginRequiredDialog";
import {
  maskKey,
  PROVIDER_IDS,
  PROVIDERS,
  type ModelOption,
  type ProviderId,
} from "./providers";

/** 서버에 이미 저장된 상태. 원본 키는 서버가 돌려주지 않으니 끝자리 표시(keyHint)만 받는다 */
export interface ApiKeySavedEntry {
  provider: ProviderId;
  model?: string;
  keyHint?: string;
}

export interface ApiKeySettingsValue {
  entries: ApiKeySavedEntry[];
  /** 지금 쓰는 키("이 키로 사용") */
  activeProvider?: ProviderId | null;
  /** 기본 키(대체 키) */
  defaultProvider?: ProviderId | null;
}

/** 저장 버튼을 누르면 `onSave`로 넘어가는 값. 서버로 이 모양 그대로 보내면 된다 */
export interface ApiKeySavePayload {
  /** 지금 쓰는 키("이 키로 사용"). 키가 하나도 없으면 null */
  activeProvider: ProviderId | null;
  /** 기본 키. `autoFailover`가 꺼져 있거나 공급자가 하나면 null */
  defaultProvider: ProviderId | null;
  keys: {
    provider: ProviderId;
    model: string;
    /** 이번에 새로 입력한 키만 들어간다. 없으면 서버에 저장된 키를 그대로 쓴다 */
    apiKey?: string;
  }[];
}

export interface ApiKeySettingsProps {
  /** 키를 받을 공급자. 기본은 셋 모두. 서비스 목적에 맞게 골라 쓴다 (예: ["openai", "claude"]) */
  providers?: ProviderId[];
  /** 공급자별 모델 목록을 바꾸고 싶을 때 */
  models?: Partial<Record<ProviderId, ModelOption[]>>;
  /** 서버에 저장되어 있는 값(수정 화면). 없으면 비어 있는 상태로 시작한다 */
  initial?: ApiKeySettingsValue;
  /** 저장. 서버로 보내는 일은 서비스가 한다. 실패하면 throw 해서 이유를 알려 준다 */
  onSave: (payload: ApiKeySavePayload) => void | Promise<void>;
  /**
   * 사용 중인 키가 막혔을 때 기본 키로 자동 전환하는 서비스인지. 기본 true.
   * false면 "기본 키" 지정을 화면에서 뺀다. 공급자가 하나일 때도 나타나지 않는다.
   */
  autoFailover?: boolean;
  className?: string;
}

interface Row {
  apiKey: string;
  model: string;
  keyHint: string;
  hasKey: boolean;
}

const DEFAULT_TIP =
  "사용 중인 키가 한도 초과나 오류로 막히면 이 키로 자동 전환돼요. 사용 중인 키를 지정하면 다른 키로 바뀌지 않아요. 하나만 지정할 수 있어요.";

function useApiKeySettings({
  providers = PROVIDER_IDS,
  models,
  initial,
  onSave,
  autoFailover = true,
}: ApiKeySettingsProps) {
  const options = (p: ProviderId) => models?.[p] ?? PROVIDERS[p].models;
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      providers.map((p) => {
        const saved = initial?.entries.find((e) => e.provider === p);
        const row: Row = {
          apiKey: "",
          model: saved?.model ?? options(p)[0]?.id ?? "",
          keyHint: saved?.keyHint ?? "",
          hasKey: !!saved,
        };
        return [p, row];
      }),
    ),
  );
  const [active, setActive] = useState<ProviderId | null>(
    initial?.activeProvider ?? null,
  );
  const [chosenDefault, setChosenDefault] = useState<ProviderId | null>(
    initial?.defaultProvider ?? null,
  );
  const [errors, setErrors] = useState<Partial<Record<ProviderId, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const touch = () => {
    setFormError(null);
    setSaved(false);
  };
  const patch = (p: ProviderId, next: Partial<Row>) => {
    setRows((r) => ({ ...r, [p]: { ...r[p], ...next } }));
    setErrors((e) => ({ ...e, [p]: undefined }));
    touch();
  };
  const setActiveProvider = (p: ProviderId) => {
    setActive(p);
    touch();
  };
  const setDefault = (p: ProviderId) => {
    setChosenDefault(p);
    touch();
  };

  const hasValue = (p: ProviderId) => rows[p].hasKey || !!rows[p].apiKey.trim();
  // 사용 중인 키: 직접 고른 키에 값이 있으면 그것, 아니면 키가 있는 첫 번째
  const effectiveActive =
    active && providers.includes(active) && hasValue(active)
      ? active
      : (providers.find(hasValue) ?? null);
  // 기본 키는 공급자가 둘 이상이고 자동 전환을 쓸 때만 있다. 사용 중인 키를 기본 키로 두면 다른 키로 바뀌지 않는다
  const failover = autoFailover && providers.length > 1;
  const effectiveDefault = !failover
    ? null
    : chosenDefault &&
        providers.includes(chosenDefault) &&
        hasValue(chosenDefault)
      ? chosenDefault
      : (providers.find((p) => hasValue(p) && p !== effectiveActive) ?? null);
  // 기본 키 버튼을 못 누를 때 이유
  const defaultBlockedReason = (p: ProviderId) =>
    !hasValue(p) ? "먼저 이 공급자의 키를 입력해 주세요." : null;

  const save = async () => {
    const nextErrors: Partial<Record<ProviderId, string>> = {};
    for (const p of providers) {
      const key = rows[p].apiKey.trim();
      if (key && !PROVIDERS[p].pattern.test(key))
        nextErrors[p] =
          `${PROVIDERS[p].label} 키 모양이 달라요. 키를 다시 확인해 주세요.`;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const keys = providers
      .filter(hasValue)
      .map((p) => ({
        provider: p,
        model: rows[p].model,
        ...(rows[p].apiKey.trim() ? { apiKey: rows[p].apiKey.trim() } : {}),
      }));
    if (keys.length === 0)
      return setFormError("저장할 키가 없어요. 키를 하나 이상 입력해 주세요.");
    setSaving(true);
    try {
      await onSave({
        activeProvider: effectiveActive,
        defaultProvider: effectiveDefault,
        keys,
      });
      // 저장했으면 입력한 키는 화면 메모리에서 지우고 끝자리만 남긴다
      setRows((r) =>
        Object.fromEntries(
          providers.map((p) => [
            p,
            r[p].apiKey.trim()
              ? {
                  ...r[p],
                  keyHint: maskKey(r[p].apiKey.trim()),
                  hasKey: true,
                  apiKey: "",
                }
              : r[p],
          ]),
        ),
      );
      setSaved(true);
    } catch (e) {
      setFormError(
        e instanceof Error
          ? e.message
          : "저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    providers,
    failover,
    hasValue,
    options,
    rows,
    patch,
    effectiveActive,
    setActiveProvider,
    effectiveDefault,
    setDefault,
    defaultBlockedReason,
    errors,
    formError,
    saving,
    saved,
    save,
  };
}

type Settings = ReturnType<typeof useApiKeySettings>;

// "기본 키" 옆에 두는 설명 말풍선. 마우스를 올리거나 키보드로 포커스하면 부드럽게 나타난다.
function InfoTip({
  text,
  label = "기본 키 설명",
}: {
  text: string;
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none transition-all duration-300 hover:scale-110 hover:bg-brand/10 hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/30"
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

// 키 입력칸. 로그인 전이면 입력하기 전에 안내한다.
function KeyField({ s, provider }: { s: Settings; provider: ProviderId }) {
  const { isAuthenticated } = useAuth();
  const [show, setShow] = useState(false);
  const [askLogin, setAskLogin] = useState(false);
  const info = PROVIDERS[provider];
  const row = s.rows[provider];
  const error = s.errors[provider];
  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <KeyRound
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type={show ? "text" : "password"}
          value={row.apiKey}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${info.label} API 키`}
          aria-invalid={!!error}
          placeholder={row.hasKey ? `저장됨 ${row.keyHint}` : info.placeholder}
          className="pl-10 pr-11"
          onFocus={(e) => {
            if (!isAuthenticated) {
              e.currentTarget.blur();
              setAskLogin(true);
            }
          }}
          onChange={(e) => s.patch(provider, { apiKey: e.target.value })}
        />
        <button
          type="button"
          aria-label={show ? "키 가리기" : "키 보기"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:text-foreground"
          onClick={() => setShow((v) => !v)}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <LoginRequiredDialog open={askLogin} onOpenChange={setAskLogin} />
    </div>
  );
}

// 입력칸(h-11)과 같은 높이의 모델 선택
function ModelSelect({
  s,
  provider,
  className,
}: {
  s: Settings;
  provider: ProviderId;
  className?: string;
}) {
  return (
    <NativeSelect
      aria-label={`${PROVIDERS[provider].label} 모델`}
      wrapperClassName={cn("w-full", className)}
      className="h-11 text-sm"
      value={s.rows[provider].model}
      onChange={(e) => s.patch(provider, { model: e.target.value })}
    >
      {s.options(provider).map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </NativeSelect>
  );
}

// 기본 키 지정 버튼. 누를 수 없을 때는 이유를 말풍선으로 알려 준다.
function DefaultKeyButton({
  s,
  provider,
}: {
  s: Settings;
  provider: ProviderId;
}) {
  const isDefault = s.effectiveDefault === provider;
  const reason = isDefault ? null : s.defaultBlockedReason(provider);
  const button = (
    <Button
      type="button"
      size="sm"
      variant={isDefault ? "secondary" : "outline"}
      aria-pressed={isDefault}
      aria-disabled={!!reason}
      className={cn(
        "h-11 transition-all duration-200 hover:-translate-y-px active:translate-y-0 active:scale-95",
        reason && "cursor-not-allowed opacity-50 hover:translate-y-0",
      )}
      onClick={() => !reason && s.setDefault(provider)}
    >
      {isDefault ? "기본 키" : "기본 키로 지정"}
    </Button>
  );
  if (!reason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
        >
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function SaveBar({ s, className }: { s: Settings; className?: string }) {
  const { isAuthenticated } = useAuth();
  const [askLogin, setAskLogin] = useState(false);
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <span />
        <Button
          type="button"
          disabled={s.saving}
          onClick={() => (isAuthenticated ? s.save() : setAskLogin(true))}
        >
          {s.saving ? "저장 중…" : s.saved ? "저장됨" : "저장"}
        </Button>
      </div>
      {s.formError && (
        <p role="alert" className="text-xs text-destructive">
          {s.formError}
        </p>
      )}
      <LoginRequiredDialog open={askLogin} onOpenChange={setAskLogin} />
    </div>
  );
}

// 여러 공급자의 키를 표로 보여 주는 형태. 한 줄이 공급자 하나다.
export function MultiApiKeyList(props: ApiKeySettingsProps) {
  const s = useApiKeySettings(props);
  return (
    <TooltipProvider delayDuration={120}>
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-card text-left shadow-soft",
          props.className,
        )}
      >
        <RadioGroup
          value={s.effectiveActive ?? ""}
          onValueChange={(v) => s.setActiveProvider(v as ProviderId)}
          aria-label="이 키로 사용"
          className="gap-0"
        >
          <Table className="min-w-[640px] [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {s.providers.length > 1 && (
                  <TableHead className="w-20">이 키로 사용</TableHead>
                )}
                <TableHead className="w-32">공급자</TableHead>
                <TableHead>API 키</TableHead>
                <TableHead className="w-44">모델</TableHead>
                {s.failover && (
                  <TableHead className="w-36">
                    <span className="inline-flex items-center gap-1">
                      기본 키
                      <InfoTip text={DEFAULT_TIP} />
                    </span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.providers.map((p) => (
                <TableRow
                  key={p}
                  data-active={s.effectiveActive === p}
                  className="transition-colors duration-300 data-[active=true]:bg-brand/5"
                >
                  {s.providers.length > 1 && (
                    <TableCell>
                      <RadioGroupItem
                        value={p}
                        disabled={!s.hasValue(p)}
                        aria-label={`${PROVIDERS[p].label} 사용`}
                        className="transition-transform duration-200 hover:scale-110"
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <span className="text-sm font-medium">
                      {PROVIDERS[p].label}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-44">
                    <KeyField s={s} provider={p} />
                  </TableCell>
                  <TableCell className="min-w-36">
                    <ModelSelect s={s} provider={p} />
                  </TableCell>
                  {s.failover && (
                    <TableCell>
                      <DefaultKeyButton s={s} provider={p} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </RadioGroup>
        <SaveBar s={s} className="border-t bg-muted/30 px-5 py-4" />
      </div>
    </TooltipProvider>
  );
}

function OptionRow({
  title,
  desc,
  tip,
  children,
}: {
  title: string;
  desc?: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-surface px-4 py-3 transition-colors duration-200 hover:border-brand/30 hover:bg-brand/5">
      <div className="grid gap-0.5">
        <span className="inline-flex items-center gap-1 text-sm font-medium">
          {title}
          {tip && <InfoTip text={tip} />}
        </span>
        {desc && <span className="text-xs text-muted-foreground">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

// 공급자마다 탭으로 나눠 한 번에 하나씩 보여 주는 형태. 탭은 한 줄이고 넘치면 옆으로 밀어 본다.
export function MultiApiKeyTabs(props: ApiKeySettingsProps) {
  const s = useApiKeySettings(props);
  return (
    <TooltipProvider delayDuration={120}>
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-card text-left shadow-soft",
          props.className,
        )}
      >
        <RadioGroup
          value={s.effectiveActive ?? ""}
          onValueChange={(v) => s.setActiveProvider(v as ProviderId)}
          aria-label="이 키로 사용"
          className="gap-0"
        >
          <Tabs defaultValue={s.providers[0]} className="min-w-0">
            <TabsList className="h-auto w-full flex-nowrap justify-start gap-0 overflow-x-auto rounded-none border-b bg-muted/40 p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {s.providers.map((p) => (
                <TabsTrigger
                  key={p}
                  value={p}
                  className="h-12 shrink-0 gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent px-5 hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-card data-[state=active]:shadow-none"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full transition-colors duration-300",
                      s.hasValue(p)
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/30",
                    )}
                  />
                  {PROVIDERS[p].label}
                  {s.effectiveActive === p && (
                    <Badge className="px-1.5 py-0 text-[10px]">사용 중</Badge>
                  )}
                  {s.effectiveDefault === p && (
                    <Badge
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      기본 키
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {s.providers.map((p) => (
              <TabsContent key={p} value={p} className="mk-fade grid gap-5 p-5">
                <div className="grid gap-1.5">
                  <FieldLabel>API 키</FieldLabel>
                  <KeyField s={s} provider={p} />
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel>모델</FieldLabel>
                  <ModelSelect s={s} provider={p} />
                </div>
                <div className="grid gap-2">
                  {s.providers.length > 1 && (
                    <OptionRow
                      title="이 키로 사용"
                      desc="지금 AI를 부를 때 쓸 키예요. 하나만 고를 수 있어요."
                    >
                      <RadioGroupItem
                        value={p}
                        disabled={!s.hasValue(p)}
                        aria-label={`${PROVIDERS[p].label} 사용`}
                        className="transition-transform duration-200 hover:scale-110"
                      />
                    </OptionRow>
                  )}
                  {s.failover && (
                    <OptionRow title="기본 키" tip={DEFAULT_TIP}>
                      <DefaultKeyButton s={s} provider={p} />
                    </OptionRow>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </RadioGroup>
        <SaveBar s={s} className="border-t bg-muted/30 px-5 py-4" />
      </div>
    </TooltipProvider>
  );
}
