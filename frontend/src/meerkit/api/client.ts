import axios, { type InternalAxiosRequestConfig } from "axios";

import { setSessionHint } from "../auth/session-hint";
import { useAuthStore } from "../auth/store";
import { meerkitConfig } from "../config";

export const api = axios.create({
  baseURL: meerkitConfig.apiBaseUrl,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401이 동시에 여러 건 와도 갱신은 한 번만 한다.
let refreshing: Promise<string | null> | null = null;

async function requestRefresh(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ access_token: string }>(
      `${meerkitConfig.apiBaseUrl}/auth/refresh`,
      null,
      { withCredentials: true },
    );
    useAuthStore.getState().setAccessToken(data.access_token);
    return data.access_token;
  } catch (error) {
    useAuthStore.getState().setAccessToken(null);
    // 세션이 끝났을 때만 표시를 지운다. 서버가 잠깐 꺼진 경우에는 다음에 다시 복원해 볼 수 있게 남겨 둔다
    if (axios.isAxiosError(error) && error.response?.status === 401) setSessionHint(false);
    return null;
  }
}

/** 세션 복원과 401 재시도가 같은 갱신 요청을 함께 쓴다 (개발 모드의 effect 두 번 실행도 한 번만 나간다) */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= requestRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(undefined, async (error) => {
  const original = error.config as RetriableConfig | undefined;
  const isAuthCall = original?.url?.startsWith("/auth/");
  if (error.response?.status !== 401 || !original || original._retried || isAuthCall) {
    return Promise.reject(error);
  }
  original._retried = true;
  const token = await refreshAccessToken();
  if (!token) return Promise.reject(error);
  original.headers.Authorization = `Bearer ${token}`;
  return api(original);
});
