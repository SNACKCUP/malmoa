"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { useAuthDialog } from "../auth/dialog-store";

interface LoginRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 로그인하지 않고 API 키를 넣으려 할 때: 취소하면 닫고, 확인하면 로그인 창을 연다.
export function LoginRequiredDialog({ open, onOpenChange }: LoginRequiredDialogProps) {
  const openDialog = useAuthDialog((s) => s.openDialog);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>로그인이 필요해요</DialogTitle>
          <DialogDescription>API 키를 입력하고 AI를 사용해 보려면 먼저 로그인해 주세요. 로그인 창을 열까요?</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              openDialog("login");
            }}
          >
            확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
