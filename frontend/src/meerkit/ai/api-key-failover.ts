import type { ProviderId } from "./providers";

export interface FailoverState {
  /** 지금 쓰는 키("이 키로 사용") */
  activeProvider: ProviderId | null;
  /** 기본 키. 사용 중인 키를 쓸 수 없을 때 이 키로 넘어간다 */
  defaultProvider: ProviderId | null;
  /** 키가 저장된 공급자들 */
  keys: { provider: ProviderId }[];
}

export interface FailoverResult {
  state: FailoverState;
  /** 새로 사용으로 바뀐 공급자. 바꿀 키가 없으면 null */
  switchedTo: ProviderId | null;
}

/**
 * 사용 중인 키를 쓸 수 없게 됐을 때(한도 초과, 만료, 오류 등) 다음 상태를 계산한다.
 * 쓸 수 없게 된 키 대신 기본 키가 "사용"이 된다. 문제가 생긴 키가 기본 키로 지정돼 있으면
 * 다른 키로 바꾸지 않는다(switchedTo는 null).
 * 순수 함수라서 호출이 실제로 실패했는지 보는 일과 결과를 서버에 저장하는 일은 호출한 쪽이 한다.
 */
export function failoverApiKeys(state: FailoverState, failed: ProviderId): FailoverResult {
  // 사용 중인 키를 기본 키로 지정했다면 다른 키로 바꾸지 않는다
  if (state.defaultProvider === failed) return { state, switchedTo: null };
  const others = state.keys.filter((k) => k.provider !== failed);
  const fallback = state.defaultProvider && others.some((k) => k.provider === state.defaultProvider) ? state.defaultProvider : (others[0]?.provider ?? null);
  if (!fallback) return { state, switchedTo: null };
  return {
    state: { ...state, activeProvider: fallback, defaultProvider: state.defaultProvider },
    switchedTo: fallback,
  };
}
