"use client";

import { FileText, ImageIcon, UploadCloud, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface FileDropzoneProps {
  value: File[];
  onChange: (files: File[]) => void;
  /** <input accept>와 같은 형식. 예: "image/*,.pdf" */
  accept?: string;
  /** false면 파일을 하나만 받고, 새 파일이 기존 파일을 대체한다 */
  multiple?: boolean;
  maxFiles?: number;
  /** 파일 하나의 최대 크기(MB) */
  maxSizeMB?: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
  className?: string;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// accept 규칙("image/*", ".pdf", "image/png")과 파일이 맞는지 본다
export function matchesAccept(file: File, accept?: string) {
  if (!accept) return true;
  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);
    if (rule.endsWith("/*")) return file.type.toLowerCase().startsWith(rule.slice(0, -1));
    return file.type.toLowerCase() === rule;
  });
}

function Thumb({ file }: { file: File }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    // 렌더가 끝난 뒤에 주소를 반영한다
    const frame = requestAnimationFrame(() => setUrl(objectUrl));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="size-10 shrink-0 rounded-lg border object-cover" />;
  }
  const Icon = file.type.startsWith("image/") ? ImageIcon : FileText;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  );
}

// 끌어다 놓거나 눌러서 파일을 고르는 영역. 파일을 서버로 올리는 일은 하지 않고, 고른 파일 목록만 알려 준다.
export function FileDropzone({
  value,
  onChange,
  accept,
  multiple = true,
  maxFiles = 5,
  maxSizeMB = 10,
  disabled,
  label,
  hint,
  className,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);

  function add(incoming: File[]) {
    const problems: string[] = [];
    const accepted: File[] = [];
    for (const file of incoming) {
      if (!matchesAccept(file, accept)) problems.push(`${file.name}: 허용되지 않는 형식입니다.`);
      else if (file.size > maxSizeMB * 1024 * 1024) problems.push(`${file.name}: ${maxSizeMB}MB를 넘습니다.`);
      else accepted.push(file);
    }
    let next = multiple ? [...value, ...accepted] : accepted.slice(0, 1).length ? accepted.slice(0, 1) : value;
    if (multiple && next.length > maxFiles) {
      problems.push(`파일은 최대 ${maxFiles}개까지 올릴 수 있습니다.`);
      next = next.slice(0, maxFiles);
    }
    setErrors(problems);
    if (accepted.length > 0) onChange(next);
  }

  const remove = (index: number) => {
    setErrors([]);
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className={cn("grid gap-3", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={label ?? "파일 선택"}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) add(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed bg-card px-6 py-8 text-center outline-none transition-all duration-300 hover:bg-surface focus-visible:ring-[3px] focus-visible:ring-ring/30",
          dragging && "scale-[1.01] border-brand bg-brand/5",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span className={cn("flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform duration-300", dragging && "-translate-y-1 text-brand")}>
          <UploadCloud className="size-5" />
        </span>
        <p className="text-sm font-medium">{dragging ? "여기에 놓으세요" : (label ?? "파일을 끌어다 놓거나 눌러서 선택하세요")}</p>
        <p className="text-xs text-muted-foreground">
          {hint ?? `${accept ? `${accept} · ` : ""}파일당 최대 ${maxSizeMB}MB${multiple ? ` · 최대 ${maxFiles}개` : ""}`}
        </p>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = ""; // 같은 파일을 다시 고를 수 있게 한다
          }}
        />
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="mk-swap grid gap-1 text-xs text-destructive">
          {errors.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}

      {value.length > 0 && (
        <ul className="grid gap-2">
          {value.map((file, i) => (
            <li key={`${file.name}-${file.size}-${i}`} className="mk-swap flex items-center gap-3 rounded-xl border bg-surface p-2 pr-3">
              <Thumb file={file} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                aria-label={`${file.name} 삭제`}
                onClick={() => remove(i)}
                className="rounded-lg p-1.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
