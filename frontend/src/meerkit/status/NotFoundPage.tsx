import Link from "next/link";

import { Button } from "@/components/ui/button";

import { meerkitConfig } from "../config";
import { StatusScreen } from "./StatusScreen";

/** 없는 주소로 들어왔을 때 보이는 화면. src/app/not-found.tsx에서 쓴다 */
export function NotFoundPage() {
  return (
    <StatusScreen
      code="404"
      title="페이지를 찾을 수 없습니다"
      description="주소가 바뀌었거나 없어진 페이지일 수 있습니다. 주소를 다시 확인해 주세요."
      actions={
        <Button asChild>
          <Link href={meerkitConfig.routes.home}>처음으로</Link>
        </Button>
      }
    />
  );
}
