"""참석자 명단 — 자주 참석하는 사람을 등록해 두고 회의마다 골라 쓴다

명단에서 고치거나 지워도 이미 저장된 회의의 참석자(jobs.attendees)는 바뀌지 않는다.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.features.malmoa.db import get_db
from app.features.malmoa.deps import CurrentUser
from app.features.malmoa.models import Person as PersonRow
from app.features.malmoa.schemas.jobs import Attendee, ErrorResponse, Person, PersonList

router = APIRouter(prefix="/people", tags=["people"])

DB = Annotated[Session, Depends(get_db)]
ERRORS = {401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}}
DUPLICATE = "이미 명단에 있는 이름입니다."


def _get(db: Session, person_id: str, user: CurrentUser) -> PersonRow:
    try:
        key = uuid.UUID(person_id)
    except ValueError:
        raise HTTPException(404, "명단에서 찾을 수 없습니다.")
    row = db.get(PersonRow, key)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "명단에서 찾을 수 없습니다.")
    return row


@router.get("", response_model=PersonList, responses={401: {"model": ErrorResponse}})
def list_people(db: DB, user: CurrentUser) -> PersonList:
    """내 참석자 명단 (이름순)"""
    rows = db.scalars(select(PersonRow).where(PersonRow.user_id == user.id).order_by(PersonRow.name))
    return PersonList(people=[Person.model_validate(r) for r in rows])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=Person, responses=ERRORS)
def add_person(body: Attendee, db: DB, user: CurrentUser) -> Person:
    """명단에 추가"""
    row = PersonRow(user_id=user.id, name=body.name, role=body.role)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUPLICATE)
    db.refresh(row)
    return Person.model_validate(row)


@router.put("/{person_id}", response_model=Person, responses=ERRORS)
def update_person(person_id: str, body: Attendee, db: DB, user: CurrentUser) -> Person:
    """이름·소속 수정 (지난 회의의 참석자 기록은 그대로)"""
    row = _get(db, person_id, user)
    row.name, row.role = body.name, body.role
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUPLICATE)
    db.refresh(row)
    return Person.model_validate(row)


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
def delete_person(person_id: str, db: DB, user: CurrentUser) -> Response:
    """명단에서만 지운다 (지난 회의의 참석자 기록은 그대로)"""
    db.delete(_get(db, person_id, user))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
