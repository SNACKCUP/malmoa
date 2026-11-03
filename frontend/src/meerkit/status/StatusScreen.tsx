import { LogoMark } from "../brand/LogoMark";

interface StatusScreenProps {
  /** 큰 글씨로 보일 코드. 예: "404", "403" */
  code: string;
  title: string;
  description?: string;
  /** 버튼 영역 */
  actions?: React.ReactNode;
  /** true면 화면 전체 높이를 쓴다 (페이지 단위). false면 영역 안에 놓는다 */
  fullPage?: boolean;
}

/** 404·접근 권한 없음 같은 "안내 화면"의 공통 모양. 로고, 코드, 제목, 설명, 버튼 순서로 가운데에 놓는다 */
export function StatusScreen({ code, title, description, actions, fullPage = true }: StatusScreenProps) {
  return (
    <main
      role="status"
      className={`mk-rise mx-auto flex max-w-md flex-col items-center justify-center gap-4 px-6 py-16 text-center ${fullPage ? "min-h-screen" : "min-h-[60vh]"}`}
    >
      <LogoMark className="size-16 shadow-soft" />
      <p className="mt-2 text-6xl font-semibold tracking-tight text-brand">{code}</p>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="text-balance text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </main>
  );
}
