"""DB 세션 — meerkit 과 같은 엔진·같은 Base (app.core.database)

말모아 코드는 커밋한 뒤에도 객체 값을 읽고(작업자 스레드·응답 만들기) 세션 밖으로 넘기므로
expire_on_commit=False 인 세션을 따로 만든다. 연결 풀은 meerkit 엔진의 것을 함께 쓴다.
"""

from collections.abc import Iterator

from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base, engine

__all__ = ["Base", "SessionLocal", "engine", "get_db"]

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI 의존성: 요청마다 세션 하나"""
    with SessionLocal() as db:
        yield db
