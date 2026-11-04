# PDF 한글 글꼴 (통합 단계 5-5)

배포 서버(Linux)에는 macOS 글꼴이 없어서 PDF 내려받기용 한글 글꼴을 함께 둔다 (`services/export.py`).

| 파일 | 출처 | SHA-256 |
|---|---|---|
| `NanumGothic-Regular.ttf` | https://github.com/google/fonts/tree/main/ofl/nanumgothic (2026-11-03 받음) | `76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31` |
| `NanumGothic-Bold.ttf` | 같음 | `f96298f9fb18e364d2370f4c3ce948ac67a2b61af992d7234bc15c42b033c674` |

라이선스: SIL Open Font License 1.1 (`OFL-NanumGothic.txt`) — 무료로 쓰고 함께 배포할 수 있다. 글꼴 파일만 따로 팔 수는 없다.
계획에는 Noto Sans KR 이었으나 Google Fonts 에 가변 글꼴로만 있어(PDF 라이브러리 fpdf2 가 잘 다루지 못함) 일반·굵은체가 따로 있는 나눔고딕으로 바꿨다.
