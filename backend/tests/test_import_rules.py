import re
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# 공통 기반(킷)의 층. 각 패키지는 오른쪽에 적은 패키지만 import 할 수 있습니다.
# 의존 방향: core ← users ← auth ← permissions ← account,  mail·llm·storage·codes 는 core 만.
# 권한 검사(require_admin 등)는 core 에 있어서 codes 도 core 만으로 관리자 API 를 둡니다.
# social(소셜 로그인)은 auth 의 토큰·쿠키를 재사용하고, social 을 import 하는 킷은 없습니다.
# users 는 프로필 이미지 파일을 위해 storage 를 씁니다 (auth 가 mail 을 쓰는 것과 같은 방식).
# 이 표를 바꾸려면 팀과 먼저 협의합니다 (공통 모듈은 서로 최대한 독립).
ALLOWED_KIT_IMPORTS: dict[str, set[str]] = {
    "core": set(),
    "mail": {"core"},
    "llm": {"core"},
    "storage": {"core"},
    "codes": {"core"},
    "users": {"core", "storage"},
    "auth": {"core", "users", "mail"},
    "permissions": {"core", "users", "auth"},
    "account": {"core", "users", "auth", "permissions"},
    "social": {"core", "users", "auth"},
}
KIT_PACKAGES = list(ALLOWED_KIT_IMPORTS)
APP_IMPORT = re.compile(r"^\s*(?:from|import)\s+app\.([a-z_]+)", re.MULTILINE)


def _imports(package: str) -> list[tuple[str, str]]:
    """(파일, import 한 app 하위 패키지) 목록"""
    found = []
    for path in (APP_DIR / package).rglob("*.py"):
        for target in APP_IMPORT.findall(path.read_text(encoding="utf-8")):
            found.append((str(path.relative_to(APP_DIR)), target))
    return found


def test_kit_never_imports_features():
    """공통 기반은 features 를 import 하지 않습니다. 그래야 기능을 지워도 킷이 동작합니다."""
    offenders = [f for package in KIT_PACKAGES for f, target in _imports(package) if target == "features"]
    assert offenders == []


def test_kit_layers_import_only_allowed_packages():
    """공통 모듈끼리는 정해진 아래 층만 import 합니다 (서로 참조·역방향 금지)."""
    offenders = [
        f"{file} → app.{target}"
        for package, allowed in ALLOWED_KIT_IMPORTS.items()
        for file, target in _imports(package)
        if target != package and target in ALLOWED_KIT_IMPORTS and target not in allowed
    ]
    assert offenders == [], "허용되지 않은 공통 모듈 import:\n" + "\n".join(offenders)


def test_every_kit_package_is_in_the_table():
    """새 공통 패키지를 만들면 이 표에 층을 정해 넣어야 합니다."""
    packages = {p.name for p in APP_DIR.iterdir() if p.is_dir() and (p / "__init__.py").exists()}
    assert packages - {"features"} <= set(ALLOWED_KIT_IMPORTS), packages - {"features"} - set(ALLOWED_KIT_IMPORTS)
