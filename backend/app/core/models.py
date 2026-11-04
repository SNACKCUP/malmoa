"""여러 테이블이 함께 쓰는 공통 컬럼."""

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


# 생성·수정 시각을 자동으로 기록하는 공통 컬럼 (JPA의 @CreatedDate, @LastModifiedDate 역할)
# 사용법: class User(TimestampMixin, Base) 처럼 상속만 하면 두 컬럼이 생깁니다.
class TimestampMixin:
    # 행을 만든 시각 (DB가 now()로 채움)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # 마지막으로 고친 시각 (UPDATE 할 때마다 now()로 바뀜)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
