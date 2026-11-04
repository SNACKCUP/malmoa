import { create } from "zustand";

export type AuthDialogMode = "login" | "signup" | "forgot" | "findId";

interface AuthDialogState {
  open: boolean;
  mode: AuthDialogMode;
  openDialog: (mode: AuthDialogMode) => void;
  closeDialog: () => void;
  setMode: (mode: AuthDialogMode) => void;
}

export const useAuthDialog = create<AuthDialogState>((set) => ({
  open: false,
  mode: "login",
  openDialog: (mode) => set({ open: true, mode }),
  closeDialog: () => set({ open: false }),
  setMode: (mode) => set({ mode }),
}));
