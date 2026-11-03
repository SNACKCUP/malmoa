"""legacy 가져오기 스크립트(scripts/malmoa_import.py)의 합치기 계산 — DB·파일 없이 시험한다"""

import importlib.util
from datetime import UTC, datetime
from pathlib import Path

_spec = importlib.util.spec_from_file_location("malmoa_import", Path(__file__).resolve().parents[3] / "scripts" / "malmoa_import.py")
mi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mi)

OWNER = "6f34ec27-495c-48cb-aee0-3468a32fc387"
OTHER = "7024f1ad-67b6-4f3c-acb9-fc40acbf2248"
T0 = datetime(2026, 11, 2, 21, 52, tzinfo=UTC)


def job(job_id: str, **extra) -> dict:
    return {"id": job_id, "user_id": OWNER, "file_name": f"{job_id}.webm", "stored_name": f"{job_id}.webm", "status": "COMPLETED", "transcript_ready": True, "minutes_ready": False, "attendees": []} | extra


def usage(row_id: int, job_id: str, created_at=T0) -> dict:
    return {"id": row_id, "user_id": OWNER, "job_id": job_id, "file_name": "x", "provider": "gemini", "model": "m", "calls": 1, "input_tokens": 10, "output_tokens": 2, "created_at": created_at}


def source(name: str, users: list[dict], **tables) -> mi.Source:
    src = mi.Source(name=name, backend_dir=Path("/nowhere") / name / "backend", url="")
    src.users = users
    src.tables = {t: tables.get(t, []) for t in mi.TABLES}
    return src


def legacy(**tables) -> mi.Source:
    return source("legacy", [{"id": OWNER, "meerkit_user_id": 1, "calendar_sync": True}], **tables)


def copy(**tables) -> mi.Source:
    """로그인 전 사본: meerkit_user_id 열이 없다"""
    return source("copy", [{"id": OWNER, "meerkit_user_id": None, "calendar_sync": False}], **tables)


def test_user_ids_become_meerkit_ids_and_copy_reuses_legacy_link():
    plan = mi.build_plan([legacy(jobs=[job("moa-a")]), copy(jobs=[job("moa-b")])])
    assert plan.user_map == {OWNER: 1}
    assert {(r["id"], r["user_id"], r["_source"]) for r in plan.rows["jobs"]} == {("moa-a", 1, "legacy"), ("moa-b", 1, "copy")}
    assert plan.unmapped == {}
    assert plan.profiles == [{"user_id": 1, "calendar_sync": True}]  # 앞 출처 값


def test_same_id_keeps_first_source_and_reports_difference():
    plan = mi.build_plan([legacy(jobs=[job("moa-a", status="COMPLETED")]), copy(jobs=[job("moa-a", status="FAILED"), job("moa-a2")])])
    by_id = {r["id"]: r for r in plan.rows["jobs"]}
    assert by_id["moa-a"]["status"] == "COMPLETED"
    assert len(plan.conflicts) == 1 and "moa-a" in plan.conflicts[0]


def test_identical_rows_in_both_sources_are_not_conflicts():
    plan = mi.build_plan([legacy(jobs=[job("moa-a", attendees=[{"name": "가"}])]), copy(jobs=[job("moa-a", attendees=[{"name": "가"}])])])
    assert len(plan.rows["jobs"]) == 1
    assert plan.conflicts == []


def test_usage_rows_are_matched_by_content_not_by_numbered_id():
    later = datetime(2026, 11, 3, 19, 3, tzinfo=UTC)
    plan = mi.build_plan([legacy(llm_usage=[usage(1, "moa-a"), usage(4, "moa-old")]), copy(llm_usage=[usage(1, "moa-a"), usage(4, "moa-new", later)])])
    assert sorted(r["job_id"] for r in plan.rows["llm_usage"]) == ["moa-a", "moa-new", "moa-old"]  # 같은 번호 4 라도 다른 기록
    assert all("id" not in r for r in plan.rows["llm_usage"])  # 번호는 이 앱이 새로 매긴다


def test_rows_of_unlinked_user_are_held_back():
    src = legacy(jobs=[job("moa-a"), job("moa-x", user_id=OTHER)], people=[{"id": "p1", "user_id": OTHER, "name": "가"}])
    plan = mi.build_plan([src])
    assert [r["id"] for r in plan.rows["jobs"]] == ["moa-a"]
    assert plan.unmapped == {OTHER: ["jobs", "people"]}


def test_unlinked_user_blocks_apply():
    plan = mi.build_plan([legacy(jobs=[job("moa-x", user_id=OTHER)])])
    found = mi.problems(plan, {"users": {1: "admin"}, "counts": {}, "files": []})
    assert any("주인을 정해야" in p for p in found)


def test_non_empty_target_blocks_apply():
    plan = mi.build_plan([legacy(jobs=[job("moa-a")])])
    found = mi.problems(plan, {"users": {1: "admin"}, "counts": {"jobs": 3}, "files": []})
    assert any("비어 있지 않음" in p for p in found)


def test_job_files_and_leftovers(tmp_path):
    src = legacy(jobs=[job("moa-a", minutes_ready=True)])
    src.backend_dir = tmp_path / "legacy" / "backend"
    st = src.storage_dir
    for key in ("uploads/moa-a.webm", "transcripts/moa-a.json", "transcripts/moa-a.txt", "minutes/moa-a.notes/chunk_000.json", "uploads/moa-gone.m4a"):
        (st / key).parent.mkdir(parents=True, exist_ok=True)
        (st / key).write_text("x")
    plan = mi.attach_files(mi.build_plan([src]), [src])
    assert sorted(k for _, k, _ in plan.files) == ["minutes/moa-a.notes/chunk_000.json", "transcripts/moa-a.json", "transcripts/moa-a.txt", "uploads/moa-a.webm"]
    assert plan.missing_files == ["legacy:minutes/moa-a.json", "legacy:minutes/moa-a.md"]  # 회의록 준비 표시인데 파일 없음
    assert plan.orphan_files == ["legacy:uploads/moa-gone.m4a"]


def test_source_port_override(tmp_path):
    (tmp_path / ".env").write_text("DATABASE_URL=postgresql+psycopg://malmoa:pw@localhost:5432/malmoa  # 메모\n")
    assert mi.parse_source(f"{tmp_path}@5434").url == "postgresql://malmoa:pw@localhost:5434/malmoa"
    assert mi.parse_source(str(tmp_path)).url == "postgresql://malmoa:pw@localhost:5432/malmoa"
