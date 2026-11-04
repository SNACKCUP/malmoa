import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "../api/error";
import { usersApi } from "../api/users";
import type { RoleName } from "../roles";
import type { MemberQuery } from "../types";

const membersKey = ["meerkit", "admin", "members"] as const;

// 조건이 바뀌어도 새 결과가 오기 전까지 이전 목록을 보여 줘서 화면이 깜빡이지 않는다.
export function useMembers(query: MemberQuery) {
  return useQuery({
    queryKey: [...membersKey, query],
    queryFn: () => usersApi.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateRoles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roles }: { id: number; roles: RoleName[] }) => usersApi.updateRoles(id, roles),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey }),
  });
}

export function useUpdateActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => usersApi.updateActive(id, isActive),
    onSuccess: (user, { isActive }) => {
      toast.success(isActive ? `${user.user_id} 계정을 활성화했습니다.` : `${user.user_id} 계정을 비활성화했습니다.`);
      return queryClient.invalidateQueries({ queryKey: membersKey });
    },
    onError: (error) => toast.error(errorMessage(error) ?? "상태를 바꾸지 못했습니다."),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey }),
  });
}
