"""소셜 로그인 공통 모듈 (Google, 이후 Kakao·Naver). core·users·auth 만 import 하고, 다른 킷은 이 모듈을 모릅니다.

    from app.social.router import router   # app/api.py 에서 등록

공급자 추가는 providers/ 에 파일 하나와 .env 의 <PROVIDER>_CLIENT_ID·SECRET 이면 됩니다 (테이블 변경 없음).
설정·구현 명세는 docs/social-oauth-setup.md.

이 파일에서 router 를 import 하지 않습니다. alembic/env.py 가 app.social.models 를 import 할 때 router → auth → mail
까지 따라 올라오면, env.py 의 fileConfig() 가 그 사이 만들어진 app.* 로거를 꺼 버립니다 (disable_existing_loggers).
"""
