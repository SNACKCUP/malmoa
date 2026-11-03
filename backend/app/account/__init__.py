"""회원 API(HTTP) 연결 층. users·auth 를 조합하고 권한은 core.principal 로 검사해 /api/users/* 를 제공합니다.

의존 방향: core ← users ← auth ← permissions ← account. 이 폴더는 다른 공통 모듈이 import 하지 않습니다.
"""
