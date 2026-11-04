import { api } from "../../api/client";
import type { AddressSearchPage, AddressSearchProvider } from "./address-search";

interface AddressSearchResponse {
  items: AddressSearchPage["items"];
  total: number;
  is_end: boolean;
}

// 서비스 서버의 GET /address/search를 호출한다. 서버가 카카오 로컬 API를 대신 불러서 같은 모양으로 돌려준다.
// API 키가 브라우저에 노출되지 않게 하려면 이렇게 서버를 거치는 것을 권장한다.
export const defaultAddressSearchProvider: AddressSearchProvider = async (query, page, size) => {
  const { data } = await api.get<AddressSearchResponse>("/address/search", { params: { q: query, page, size } });
  return { items: data.items, total: data.total, isEnd: data.is_end };
};
