// 우편번호·주소 검색. 기본 구현은 카카오(다음) 우편번호 서비스의 팝업을 쓴다.
// 다른 서비스를 쓰려면 AddressField의 onSearch에 같은 모양의 함수를 넘기면 된다.
export interface AddressSearchResult {
  postcode: string;
  address: string;
}

/** 검색 결과 한 줄 */
export interface AddressItem {
  postcode: string;
  /** 입력칸에 들어갈 주소 (도로명 우선) */
  address: string;
  /** 목록에서 보조로 보여 줄 지번 주소 */
  jibun_address?: string;
  /** 건물명 등 */
  building_name?: string;
}

/** 검색 결과 한 쪽 */
export interface AddressSearchPage {
  items: AddressItem[];
  /** 조건에 맞는 전체 개수 */
  total: number;
  /** true면 더 불러올 결과가 없다 */
  isEnd: boolean;
}

/** 주소 검색 방법. 서버(카카오 로컬 API 등)를 호출해 한 쪽씩 돌려준다 */
export type AddressSearchProvider = (query: string, page: number, size: number) => Promise<AddressSearchPage>;

interface DaumPostcodeData {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  userSelectedType: "R" | "J";
}

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: { oncomplete: (data: DaumPostcodeData) => void; onclose?: () => void }) => { open: () => void };
    };
  }
}

const SCRIPT_SRC = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
let loading: Promise<void> | null = null;

function loadScript() {
  loading ??= new Promise<void>((resolve, reject) => {
    if (window.daum?.Postcode) return resolve();
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null; // 다음 시도에서 다시 불러올 수 있게 한다
      reject(new Error("주소 검색 스크립트를 불러오지 못했습니다."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** 팝업에서 주소를 고르면 { postcode, address }를, 그냥 닫으면 null을 돌려준다 */
export async function searchAddress(): Promise<AddressSearchResult | null> {
  await loadScript();
  return new Promise((resolve) => {
    new window.daum!.Postcode({
      oncomplete: (data) =>
        resolve({
          postcode: data.zonecode,
          address: data.userSelectedType === "R" ? data.roadAddress : data.jibunAddress,
        }),
      onclose: () => resolve(null),
    }).open();
  });
}
