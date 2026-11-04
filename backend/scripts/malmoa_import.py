"""legacy 말모아 DB·파일을 이 앱(meerkit 통합)으로 가져오는 스크립트 — 출처의 DB·파일은 읽기만 한다

순서 (사용자 승인 없이 apply 하지 않는다, docs/2026-11-03-통합계획.md 단계 2):
  1. 미리보기  uv run python scripts/malmoa_import.py preview --source <legacy backend>[@포트] [--source <사본 backend>[@포트]]
               가져올 행·파일 수, 회원 연결, 출처끼리 겹치는데 내용이 다른 행, 새 앱에 이미 있는 데이터를 보여 준다
  2. 백업      … backup --source … --backups-dir <폴더> --pg-dump <pg_dump 경로>
               새 앱 DB·출처 DB 덤프와, 가져올 파일의 SHA-256 목록·가져올 내용의 지문을 남긴다 (권한 600)
  3. 적용      … apply --source … --backup <backup 이 만든 폴더>
               백업 뒤 바뀐 것이 없는지 확인하고 파일을 복사·검증한 다음 DB 에 한 트랜잭션으로 넣는다

출처(--source)는 legacy 의 backend 폴더다. 그 폴더 .env 의 DATABASE_URL 로 DB 에 붙고(@포트 로 포트만 바꿀 수 있다),
storage/ 아래 uploads·transcripts·minutes 파일을 읽는다. 출처를 여럿 주면 앞의 것이 우선이다 (같은 id 는 앞의 값).
회원은 출처 users.meerkit_user_id 로 이 앱 users.id 에 잇는다. 그 열이 없는 출처(로그인 전 사본)는 앞 출처의 같은 UUID 연결을 쓴다.
녹음기 생존 신호(recorder_beats)는 열린 탭이 곧 다시 보내는 값이라 가져오지 않는다.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings as meerkit_settings
from app.features.malmoa.config import get_settings
from app.features.malmoa.services.file_store import get_store

# 표 → 같은 행인지 가르는 열 (user_id 는 이 앱 회원 번호로 바꾼 뒤 비교). 넣는 순서대로 (FK)
TABLES: dict[str, tuple[str, ...]] = {
    "jobs": ("id",),
    "people": ("id",),
    "events": ("id",),
    "event_reminders": ("event_id", "minutes_before"),
    "llm_settings": ("user_id",),
    "llm_usage_limits": ("user_id",),
    "llm_usage": ("job_id", "created_at", "provider", "model", "calls", "input_tokens", "output_tokens"),
}
DROP_COLUMNS = {"llm_usage": {"id"}}  # 출처마다 따로 매긴 번호라 겹친다 — 이 앱에서 새로 매긴다
TARGET_TABLES = (*TABLES, "malmoa_profiles")
FOLDERS = ("uploads", "transcripts", "minutes")
MANIFEST = "manifest.json"


@dataclass
class Source:
    name: str
    backend_dir: Path
    url: str
    tables: dict[str, list[dict]] = field(default_factory=dict)
    users: list[dict] = field(default_factory=list)  # id(UUID), meerkit_user_id(없을 수 있음), calendar_sync

    @property
    def storage_dir(self) -> Path:
        return self.backend_dir / "storage"


@dataclass
class Plan:
    user_map: dict[str, int]  # 출처 회원 UUID(문자열) → 이 앱 users.id
    unmapped: dict[str, list[str]]  # 연결이 없는 출처 회원 UUID → 그 회원 데이터가 있는 표
    rows: dict[str, list[dict]]  # 표 → 넣을 행 (user_id 는 이미 바꿈), 행마다 "_source"
    conflicts: list[str]  # 출처끼리 같은 키인데 내용이 다른 행 (앞 출처 값을 씀)
    profiles: list[dict]
    files: list[tuple[str, str, Path]]  # (출처 이름, 저장소 키, 출처 파일)
    missing_files: list[str]  # 행에는 있다는데 파일이 없는 것 (원문·회의록 준비 표시가 켜진 경우만)
    orphan_files: list[str]  # 어느 작업에도 속하지 않는 출처 파일 (가져오지 않음)


def env_value(env_file: Path, key: str) -> str | None:
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].split(" #")[0].strip()
    return None


def plain_url(url: str) -> str:
    return re.sub(r"^postgresql\+psycopg://", "postgresql://", url, count=1)


def parse_source(spec: str) -> Source:
    """<backend 폴더>[@포트] — DB 주소·비밀번호는 그 폴더 .env 에서만 읽는다"""
    path, _, port = spec.partition("@") if re.search(r"@\d+$", spec) else (spec, "", "")
    backend_dir = Path(path).expanduser().resolve()
    url = env_value(backend_dir / ".env", "DATABASE_URL")
    if not url:
        raise SystemExit(f"{backend_dir}/.env 에 DATABASE_URL 이 없습니다.")
    url = plain_url(url)
    if port:
        url = re.sub(r"@([^/@:]+)(:\d+)?/", rf"@\1:{port}/", url, count=1)
    return Source(name=backend_dir.parent.name, backend_dir=backend_dir, url=url)


def columns(conn: psycopg.Connection, table: str) -> dict[str, str]:
    rows = conn.execute("select column_name, data_type from information_schema.columns where table_schema='public' and table_name=%s order by ordinal_position", (table,))
    return dict(rows.fetchall())


def load(source: Source) -> Source:
    with psycopg.connect(source.url) as conn:
        user_cols = columns(conn, "users")
        meerkit = "meerkit_user_id" if "meerkit_user_id" in user_cols else "null"
        source.users = [dict(zip(("id", "meerkit_user_id", "calendar_sync"), r, strict=True)) for r in conn.execute(f"select id, {meerkit}, calendar_sync from users")]
        for table in TABLES:
            cols = columns(conn, table)
            if not cols:
                source.tables[table] = []
                continue
            cur = conn.execute(f'select * from "{table}"')
            names = [d.name for d in cur.description]
            source.tables[table] = [dict(zip(names, r, strict=True)) for r in cur]
    return source


def _canon(value):
    return json.dumps(value, sort_keys=True, default=str) if isinstance(value, list | dict) else value


def _same(a: dict, b: dict) -> bool:
    shared = (a.keys() & b.keys()) - {"_source"}
    return all(_canon(a[k]) == _canon(b[k]) for k in shared)


def build_plan(sources: list[Source]) -> Plan:
    """출처들을 합친 결과 (DB·파일은 읽지 않는 순수 계산 — 파일 목록은 attach_files 가 채운다)"""
    user_map: dict[str, int] = {}
    for src in sources:
        for u in src.users:
            if u["meerkit_user_id"] is not None:
                user_map.setdefault(str(u["id"]), int(u["meerkit_user_id"]))
    unmapped: dict[str, list[str]] = {}
    rows: dict[str, list[dict]] = {}
    conflicts: list[str] = []
    for table, key in TABLES.items():
        chosen: dict[tuple, dict] = {}
        for src in sources:
            for raw in src.tables.get(table, []):
                row = {k: v for k, v in raw.items() if k not in DROP_COLUMNS.get(table, set())}
                if "user_id" in row:
                    uid = str(row["user_id"])
                    if uid not in user_map:
                        unmapped.setdefault(uid, [])
                        if table not in unmapped[uid]:
                            unmapped[uid].append(table)
                        continue
                    row["user_id"] = user_map[uid]
                row["_source"] = src.name
                k = tuple(_canon(row[c]) for c in key)
                if k not in chosen:
                    chosen[k] = row
                elif not _same(chosen[k], row):
                    conflicts.append(f"{table} {'/'.join(str(x) for x in k)[:60]}: {chosen[k]['_source']} 값을 씀 ({src.name} 값과 다름)")
        rows[table] = list(chosen.values())
    profiles: dict[int, dict] = {}
    for src in sources:
        for u in src.users:
            uid = user_map.get(str(u["id"]))
            if uid is not None and uid not in profiles:
                profiles[uid] = {"user_id": uid, "calendar_sync": bool(u["calendar_sync"])}
    return Plan(user_map, unmapped, rows, conflicts, list(profiles.values()), [], [], [])


def job_keys(job: dict) -> list[str]:
    """작업 하나의 저장소 키 (있을 수 있는 것 전부) — file_store 의 키 규칙과 같다"""
    jid = job["id"]
    return [f"uploads/{job['stored_name']}", f"transcripts/{jid}.json", f"transcripts/{jid}.txt", f"minutes/{jid}.json", f"minutes/{jid}.md"]


def attach_files(plan: Plan, sources: list[Source]) -> Plan:
    by_name = {s.name: s for s in sources}
    wanted: set[tuple[str, str]] = set()
    for job in plan.rows["jobs"]:
        src = by_name[job["_source"]]
        for key in job_keys(job):
            path = src.storage_dir / key
            if path.is_file():
                plan.files.append((src.name, key, path))
                wanted.add((src.name, key))
            elif key.startswith("uploads/") or (key.startswith("transcripts/") and job["transcript_ready"]) or (key.startswith("minutes/") and job["minutes_ready"]):
                plan.missing_files.append(f"{job['_source']}:{key}")
        notes = src.storage_dir / "minutes" / f"{job['id']}.notes"  # 구간 요약 (회의록을 이어서 만들 때 쓴다)
        if notes.is_dir():
            for p in sorted(notes.rglob("*")):
                if p.is_file():
                    key = p.relative_to(src.storage_dir).as_posix()
                    plan.files.append((src.name, key, p))
                    wanted.add((src.name, key))
    for src in sources:
        for folder in FOLDERS:
            d = src.storage_dir / folder
            for p in sorted(d.rglob("*")) if d.is_dir() else []:
                key = p.relative_to(src.storage_dir).as_posix()
                taken = (src.name, key) in wanted or any(key == k for _, k, _ in plan.files)  # 다른 출처에서 같은 파일을 가져오면 남는 파일이 아니다
                if p.is_file() and not p.name.endswith(".tmp") and p.name != ".gitkeep" and not taken:
                    plan.orphan_files.append(f"{src.name}:{key}")
    return plan


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def fingerprint(plan: Plan) -> str:
    """가져올 내용의 지문 — 백업 뒤 출처가 바뀌었는지 apply 가 확인한다"""
    body = json.dumps({t: sorted(json.dumps(r, sort_keys=True, default=str) for r in rs) for t, rs in plan.rows.items()} | {"profiles": plan.profiles}, sort_keys=True)
    return hashlib.sha256(body.encode()).hexdigest()


def target_state(target_url: str) -> dict:
    with psycopg.connect(target_url) as conn:
        counts = {t: conn.execute(f'select count(*) from "{t}"').fetchone()[0] for t in TARGET_TABLES}
        users = dict(conn.execute("select id, login_id from users").fetchall())
    store = get_store()
    existing = [k for folder in FOLDERS for k in store.list(f"{folder}/")]
    return {"counts": counts, "users": users, "files": existing}


def make_plan(specs: list[str]) -> tuple[list[Source], Plan]:
    sources = [load(parse_source(s)) for s in specs]
    names = [s.name for s in sources]
    if len(set(names)) != len(names):
        raise SystemExit(f"출처 폴더 이름이 겹칩니다: {names} (상위 폴더 이름으로 구분한다)")
    return sources, attach_files(build_plan(sources), sources)


def problems(plan: Plan, state: dict) -> list[str]:
    """apply 를 막는 문제"""
    found = []
    if plan.unmapped:
        found.append(f"이 앱 회원과 연결되지 않은 출처 회원 {len(plan.unmapped)}명 (주인을 정해야 함): {plan.unmapped}")
    missing_users = sorted({uid for uid in plan.user_map.values()} - set(state["users"]))
    if missing_users:
        found.append(f"이 앱 users 에 없는 회원 번호: {missing_users}")
    filled = {t: n for t, n in state["counts"].items() if n}
    if filled:
        found.append(f"이 앱 말모아 표가 비어 있지 않음: {filled} (한 번만 가져오는 스크립트)")
    clash = sorted({k for _, k, _ in plan.files} & set(state["files"]))
    if clash:
        found.append(f"이 앱 저장소에 이미 있는 파일 {len(clash)}개 (예: {clash[:3]})")
    if plan.rows["llm_settings"] and not get_settings().secret_key:
        found.append("AI 키(llm_settings)를 풀 SECRET_KEY 가 이 앱 .env 에 없음 — legacy 와 같은 값을 넣어야 함")
    return found


def preview(specs: list[str]) -> dict:
    sources, plan = make_plan(specs)
    state = target_state(plain_url(meerkit_settings.database_url))
    per_source = {t: {s.name: sum(1 for r in rows if r["_source"] == s.name) for s in sources} for t, rows in plan.rows.items()}
    return {
        "sources": {s.name: {"dir": str(s.backend_dir), "users": len(s.users), "rows": {t: len(r) for t, r in s.tables.items()}} for s in sources},
        "user_map": {uuid: f"{uid} ({state['users'].get(uid, '이 앱에 없음')})" for uuid, uid in plan.user_map.items()},
        "import_rows": {t: {"total": len(rows), "from": per_source[t]} for t, rows in plan.rows.items()} | {"malmoa_profiles": {"total": len(plan.profiles)}},
        "jobs_from_later_sources": [f"{r['id']} {r['file_name']} ({r['_source']})" for r in plan.rows["jobs"] if r["_source"] != sources[0].name],
        "conflicts": plan.conflicts,
        "files": {"count": len(plan.files), "bytes": sum(p.stat().st_size for _, _, p in plan.files), "from": {s.name: sum(1 for n, _, _ in plan.files if n == s.name) for s in sources}},
        "missing_files": plan.missing_files,
        "orphan_files_not_imported": plan.orphan_files,
        "target_now": {"counts": state["counts"], "files": len(state["files"])},
        "blocking": problems(plan, state),
    }


def pg_dump(exe: str, url: str, dest: Path) -> None:
    subprocess.run([exe, "-Fc", "-f", str(dest), url], check=True)


def backup(specs: list[str], backups_dir: Path, pg_dump_exe: str) -> Path:
    sources, plan = make_plan(specs)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = backups_dir / f"malmoa-import-{stamp}"
    dest.mkdir(parents=True)
    dest.chmod(0o700)
    dumps = {"target": dest / "target-db.dump"}
    pg_dump(pg_dump_exe, plain_url(meerkit_settings.database_url), dumps["target"])
    for src in sources:
        dumps[src.name] = dest / f"source-{src.name}-db.dump"
        pg_dump(pg_dump_exe, src.url, dumps[src.name])
    manifest = {
        "createdAt": datetime.now().isoformat(),
        "sources": [str(s.backend_dir) for s in sources],
        "dumps": {k: str(v) for k, v in dumps.items()},
        "fingerprint": fingerprint(plan),
        "files": {f"{n}:{k}": {"bytes": p.stat().st_size, "sha256": sha256(p)} for n, k, p in plan.files},
    }
    (dest / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    for p in dest.iterdir():  # 녹음 목록·DB 는 개인정보 — 나만 읽게
        p.chmod(0o600)
    return dest


def _insert(conn: psycopg.Connection, table: str, rows: list[dict]) -> None:
    target_cols = columns(conn, table)
    for row in rows:
        values = {k: (Jsonb(v) if target_cols[k] == "jsonb" else v) for k, v in row.items() if k in target_cols}
        names = ", ".join(f'"{k}"' for k in values)
        marks = ", ".join(["%s"] * len(values))
        conn.execute(f'insert into "{table}" ({names}) values ({marks})', list(values.values()))


def apply(specs: list[str], backup_dir: Path) -> dict:
    manifest_path = backup_dir / MANIFEST
    if not manifest_path.is_file():
        raise SystemExit(f"백업이 없습니다: {manifest_path}. 먼저 backup 을 실행하세요.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not all(Path(p).is_file() for p in manifest["dumps"].values()):
        raise SystemExit("백업의 DB 덤프가 빠져 있습니다.")
    _, plan = make_plan(specs)
    if fingerprint(plan) != manifest["fingerprint"]:
        raise SystemExit("백업 뒤 출처 DB 내용이 바뀌어 멈춥니다. backup 을 다시 실행하세요.")
    current = {f"{n}:{k}": p for n, k, p in plan.files}
    changed = sorted(set(current) ^ set(manifest["files"]))
    changed += [k for k, p in current.items() if k in manifest["files"] and sha256(p) != manifest["files"][k]["sha256"]]
    if changed:
        raise SystemExit(f"백업 뒤 바뀐 파일이 있어 멈춥니다 ({len(changed)}개, 예: {changed[:3]}). backup 을 다시 실행하세요.")
    target_url = plain_url(meerkit_settings.database_url)
    blocking = problems(plan, target_state(target_url))
    if blocking:
        raise SystemExit("가져올 수 없습니다:\n- " + "\n- ".join(blocking))

    store = get_store()
    copied: list[str] = []
    report: dict = {"files": {"copied": 0, "failed": []}, "rows": {}}
    try:
        for name, key, path in plan.files:
            data = path.read_bytes()
            store.put_bytes(key, data, "application/octet-stream")
            copied.append(key)
            if hashlib.sha256(store.get_bytes(key)).hexdigest() != manifest["files"][f"{name}:{key}"]["sha256"]:
                report["files"]["failed"].append(key)
        if report["files"]["failed"]:
            raise RuntimeError(f"복사한 파일 검증 실패: {report['files']['failed'][:3]}")
        report["files"]["copied"] = len(copied)
        with psycopg.connect(target_url) as conn, conn.transaction():
            for table in TABLES:
                _insert(conn, table, [{k: v for k, v in r.items() if k != "_source"} for r in plan.rows[table]])
            _insert(conn, "malmoa_profiles", plan.profiles)
            report["rows"] = {t: conn.execute(f'select count(*) from "{t}"').fetchone()[0] for t in TARGET_TABLES}
    except BaseException:
        for key in copied:  # 이 앱 저장소는 비어 있었다 (problems 가 확인) — 넣다 만 파일을 치운다
            store.delete(key)
        raise
    expected = {t: len(r) for t, r in plan.rows.items()} | {"malmoa_profiles": len(plan.profiles)}
    report["verified"] = report["rows"] == expected
    report["expected"] = expected
    report_path = backup_dir / f"import-report-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    report_path.chmod(0o600)
    report["report"] = str(report_path)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="legacy 말모아 → 이 앱 (출처는 읽기만)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("preview", "backup", "apply"):
        p = sub.add_parser(name)
        p.add_argument("--source", action="append", required=True, help="legacy backend 폴더[@포트], 앞의 것이 우선")
        if name == "backup":
            p.add_argument("--backups-dir", required=True, type=Path)
            p.add_argument("--pg-dump", required=True, help="PostgreSQL 16 pg_dump 경로")
        if name == "apply":
            p.add_argument("--backup", required=True, type=Path)
    args = parser.parse_args()

    if args.cmd == "preview":
        print(json.dumps(preview(args.source), ensure_ascii=False, indent=2, default=str))
        print("\n다음: backup → (승인) → apply --backup <폴더>. 출처 DB·파일은 바꾸지 않습니다.")
    elif args.cmd == "backup":
        dest = backup(args.source, args.backups_dir.expanduser().resolve(), args.pg_dump)
        print(f"백업 완료: {dest} (이 앱·출처 DB 덤프, 가져올 파일 SHA-256 목록)")
    else:
        report = apply(args.source, args.backup.expanduser().resolve())
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if not report["verified"]:
            sys.exit(1)


if __name__ == "__main__":
    main()
