from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# DB 연결 통로. 주소는 .env 의 DATABASE_URL 에서 읽어요.
engine = create_engine(settings.database_url, pool_pre_ping=True)

# 요청마다 DB 작업 단위(세션)를 만들어 주는 공장
SessionLocal = sessionmaker(bind=engine, autoflush=False)


# 모든 테이블 모델이 상속할 부모 클래스 (Alembic이 이걸 보고 테이블을 찾아요)
class Base(DeclarativeBase):
    pass


# API에서 DB 세션을 받아 쓰고, 끝나면 자동으로 닫아 주는 함수
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()