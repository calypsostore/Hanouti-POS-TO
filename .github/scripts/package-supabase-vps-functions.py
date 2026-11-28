#!/usr/bin/env python3
import argparse
import base64
import binascii
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path, PurePosixPath


FUNCTION_DIRS = (
    "_shared",
    "device-login",
    "device-session",
    "device-staff-pin",
    "login",
    "main",
    "manage-devices",
    "provision-account",
    "send-push",
    "verify-password",
)
FUNCTION_NAMES = set(FUNCTION_DIRS) - {"_shared", "main"}
REQUIRED_FUNCTION_FILES = {
    *(f"{name}/index.ts" for name in FUNCTION_NAMES),
    "_shared/deviceAuth.ts",
    "_shared/notificationContent.ts",
    "send-push/notificationSounds.ts",
}
RUNTIME_SOURCE_FILES = {
    PurePosixPath("main/index.ts"): "deploy/supabase-vps/volumes/functions/main/index.ts",
    PurePosixPath("main/logging.ts"): "deploy/supabase-vps/volumes/functions/main/logging.ts",
    PurePosixPath("main/memory-pressure.ts"): "deploy/supabase-vps/volumes/functions/main/memory-pressure.ts",
    PurePosixPath("main/events/index.ts"): "deploy/supabase-vps/volumes/functions/main/events/index.ts",
    PurePosixPath("deno.jsonc"): "deploy/supabase-vps/volumes/functions/deno.jsonc",
    PurePosixPath("LICENSE"): "deploy/supabase-vps/volumes/functions/LICENSE",
}
EXTERNAL_CATALOG_IMPORTS = {
    "../../../src/i18n/locales/ar/notifications.ts": "src/i18n/locales/ar/notifications.ts",
    "../../../src/i18n/locales/en/notifications.ts": "src/i18n/locales/en/notifications.ts",
    "../../../src/i18n/locales/fr/notifications.ts": "src/i18n/locales/fr/notifications.ts",
}
SECRET_EXTENSIONS = {".cer", ".crt", ".key", ".p12", ".pfx", ".pem"}
FUNCTIONS_PREFIX = PurePosixPath("supabase/functions")
PRIVATE_KEY_PATTERN = re.compile(r"-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----")
JWT_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_-])(?P<token>eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})(?![A-Za-z0-9_-])"
)
BEARER_TOKEN_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}")
CREDENTIAL_URL_PATTERN = re.compile(r"(?i)\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@")
COMMON_TOKEN_PATTERN = re.compile(
    r"""(?ix)(?<![A-Za-z0-9_-])(?:sb_secret_[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{15,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})(?![A-Za-z0-9_-])"""
)
SENSITIVE_ASSIGNMENT_PATTERN = re.compile(
    r"""(?ix)
    (?<![A-Za-z0-9_])(?P<name>
        (?:supabase[_-]?)?service[_-]?role(?:[_-]?key)?
        |(?:jwt|signing)[_-]?(?:secret|key)
        |(?:api|client|private|access|refresh)[_-]?(?:key|token|secret)
        |(?:auth|bearer)[_-]?token
        |(?:aws[_-]?)?secret[_-]?(?:access[_-]?)?key
        |client[_-]?secret
        |(?:password|passwd|pwd)(?:[_-]?hash)?
        |secret
        |token
    )(?![A-Za-z0-9_])
    \s*(?P<operator>[:=])\s*
    (?:
        (?P<quote>["'`])(?P<value>[^"'`\r\n]+)(?P=quote)
        |(?P<bare>[A-Za-z0-9_-]+)(?=$|[\s,;})])
    )
    """
)
SAFE_SECRET_PLACEHOLDERS = {
    "contraseña",
    "enter password",
    "enter your password",
    "enter your password to continue",
    "example",
    "example-key",
    "example-token",
    "mot de passe",
    "placeholder",
    "replace-me",
    "senha",
    "votre mot de passe",
    "كلمة السر",
    "كلمة المرور",
    "your-api-key",
    "your password",
}
SAFE_TRANSLATION_LABELS = {
    "Access token",
    "API key",
    "Private token",
}


def _jwt_category(token: str) -> str:
    payload_part = token.split(".")[1]
    padded_payload = payload_part + "=" * (-len(payload_part) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded_payload))
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return "JWT/private token"
    if isinstance(payload, dict) and payload.get("role") == "service_role":
        return "Supabase service-role key"
    return "JWT/private token"


def _assignment_category(name: str) -> str:
    normalized = re.sub(r"[^a-z]", "", name.lower())
    if "servicerole" in normalized:
        return "Supabase service-role key"
    if "jwt" in normalized or "signing" in normalized:
        return "JWT secret"
    if "password" in normalized or "passwd" in normalized or normalized == "pwd":
        return "password"
    if "api" in normalized:
        return "API key"
    if "token" in normalized:
        return "private token"
    return "credential"


def find_secret_category(content: str) -> str | None:
    """Return a safe-to-log category for credential-like content.

    >>> find_secret_category("-----BEGIN PRIVATE KEY-----")
    'private key'
    >>> find_secret_category("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signaturevalue123456")
    'Supabase service-role key'
    >>> find_secret_category('const authorization = "Bearer fixture-private-token-123456";')
    'private token'
    >>> find_secret_category('const databaseUrl = "postgres://user:fixture-password@db.example.test/app";')
    'password'
    >>> find_secret_category('const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";')
    'API/private token'
    >>> find_secret_category('const SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role-value-123";')
    'Supabase service-role key'
    >>> find_secret_category('const JWT_SECRET = "fixture-jwt-secret-value-123";')
    'JWT secret'
    >>> find_secret_category("API_KEY=abcdefghijk")
    'API key'
    >>> find_secret_category("JWT_SECRET=Abc123xyz")
    'JWT secret'
    >>> find_secret_category("SUPABASE_SERVICE_ROLE_KEY=someLongCredential123")
    'Supabase service-role key'
    >>> find_secret_category("const API_KEY = abcdefghijk;")
    'API key'
    >>> find_secret_category("const JWT_SECRET = Abc123xyz;")
    'JWT secret'
    >>> find_secret_category("const SUPABASE_SERVICE_ROLE_KEY=someLongCredential123;")
    'Supabase service-role key'
    >>> find_secret_category('const API_KEY = "x";')
    'API key'
    >>> find_secret_category('const JWT_SECRET = "x";')
    'JWT secret'
    >>> find_secret_category("API_KEY=some-secret-value")
    'API key'
    >>> find_secret_category('const API_KEY = "fixture-api-key-value-123";')
    'API key'
    >>> find_secret_category('const password = "fixture-password";')
    'password'
    >>> find_secret_category('const privateToken = "fixture-private-token-123456";')
    'private token'
    >>> find_secret_category('const password = 1234;')
    'password'
    >>> find_secret_category('const apiKey = Deno.env.get("API_KEY");')
    >>> find_secret_category('const apiKey = apiKeyFromEnv;')
    >>> find_secret_category('const API_KEY = apiKeyFromEnv;')
    >>> find_secret_category('const translations = { apiKey: "aPi KeY", privateToken: "PRIVATE TOKEN" };')
    >>> find_secret_category('const apiUrl = "https://api.example.test";')
    """
    if PRIVATE_KEY_PATTERN.search(content):
        return "private key"

    jwt_match = JWT_PATTERN.search(content)
    if jwt_match:
        return _jwt_category(jwt_match.group("token"))

    if CREDENTIAL_URL_PATTERN.search(content):
        return "password"

    if BEARER_TOKEN_PATTERN.search(content):
        return "private token"

    if COMMON_TOKEN_PATTERN.search(content):
        return "API/private token"

    for match in SENSITIVE_ASSIGNMENT_PATTERN.finditer(content):
        value = (match.group("value") or match.group("bare") or "").strip()
        normalized_value = " ".join(value.casefold().split())
        if (
            not value
            or normalized_value in {label.casefold() for label in SAFE_TRANSLATION_LABELS}
            or normalized_value in SAFE_SECRET_PLACEHOLDERS
            or re.fullmatch(r"\$\{[A-Za-z_][A-Za-z0-9_]*\}", value)
            or re.fullmatch(r"\{\{[A-Za-z_][A-Za-z0-9_]*\}\}", value)
            or normalized_value in {"<redacted>", "[redacted]", "replace with secret"}
        ):
            continue
        bare_value = match.group("bare")
        if bare_value and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", bare_value):
            line_start = content.rfind("\n", 0, match.start()) + 1
            line_prefix = content[line_start:match.start()]
            is_environment_assignment = re.fullmatch(r"\s*(?:export\s+)?", line_prefix)
            is_constant_name = match.group("name").isupper() and "_" in match.group("name")
            is_environment_reference = re.fullmatch(
                r"[A-Za-z_][A-Za-z0-9_]*(?:FromEnv|FromConfig|FromEnvironment|_ENV|_CONFIG|_FROM_ENV|_FROM_CONFIG)",
                bare_value,
                re.IGNORECASE,
            )
            has_digits = any(character.isdigit() for character in bare_value)
            if (
                match.group("operator") == ":"
                or is_environment_reference
                or not (is_environment_assignment or is_constant_name or has_digits)
            ):
                continue
        return _assignment_category(match.group("name"))
    return None


def validate_file_content(relative_path: PurePosixPath, content: str) -> None:
    category = find_secret_category(content)
    if category:
        raise ValueError(f"Sensitive content detected in {relative_path.as_posix()}: {category}")


def is_excluded_secret(relative_path: PurePosixPath) -> bool:
    parts = {part.lower() for part in relative_path.parts}
    name = relative_path.name.lower()
    return (
        any(part in {".branches", ".temp"} for part in parts)
        or name.startswith(".env")
        or name.endswith(".env")
        or Path(name).suffix in SECRET_EXTENSIONS
        or name in {"id_rsa", "id_ed25519"}
    )


def tracked_paths(repository: Path, paths: list[str]) -> set[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--", *paths],
        cwd=repository,
        check=True,
        stdout=subprocess.PIPE,
    )
    return {
        entry.decode("utf-8")
        for entry in result.stdout.split(b"\0")
        if entry
    }


def validate_external_dependencies(repository: Path) -> None:
    source_path = repository / "supabase/functions/_shared/notificationContent.ts"
    imports = set(re.findall(r"""(?:\bimport\s+(?:[^'";]*?\s+from\s+)?|\bexport\s+[^'";]*?\s+from\s+)['"]([^'"]+)['"]""", source_path.read_text(encoding="utf-8")))
    relative_imports = {path for path in imports if path.startswith(".")}
    if relative_imports != set(EXTERNAL_CATALOG_IMPORTS):
        raise ValueError("notificationContent.ts has missing or unapproved relative imports.")

    tracked = tracked_paths(repository, list(EXTERNAL_CATALOG_IMPORTS.values()))
    for relative_path in EXTERNAL_CATALOG_IMPORTS.values():
        source = repository.joinpath(*PurePosixPath(relative_path).parts)
        if relative_path not in tracked or source.is_symlink() or not source.is_file():
            raise ValueError(f"Required external notification catalog is missing: {relative_path}")


def tracked_function_files(repository: Path) -> list[tuple[PurePosixPath, bytes]]:
    tracked = tracked_paths(repository, ["supabase/functions"])
    files: list[tuple[PurePosixPath, bytes]] = []

    for tracked_name in tracked:
        tracked_path = PurePosixPath(tracked_name)
        relative_path = tracked_path.relative_to(FUNCTIONS_PREFIX)
        if not relative_path.parts or relative_path.parts[0] not in FUNCTION_DIRS:
            continue
        if is_excluded_secret(relative_path):
            continue
        if relative_path.suffix.lower() != ".ts":
            raise ValueError(f"Unexpected non-TypeScript file in function source: {tracked_name}")

        source = repository.joinpath(*tracked_path.parts)
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Function source is not a regular file: {tracked_name}")
        content = source.read_bytes()
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError(f"Function source is not valid UTF-8: {relative_path.as_posix()}") from None
        validate_file_content(relative_path, text)
        files.append((relative_path, content))

    for package_path, source_name in RUNTIME_SOURCE_FILES.items():
        source = repository.joinpath(*PurePosixPath(source_name).parts)
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Required Supabase runtime asset is missing: {source_name}")
        content = source.read_bytes()
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError(f"Supabase runtime asset is not valid UTF-8: {source_name}") from None
        if package_path.name != "LICENSE":
            validate_file_content(package_path, text)
        files.append((package_path, content))

    for source_name in EXTERNAL_CATALOG_IMPORTS.values():
        relative_path = PurePosixPath(source_name)
        source = repository.joinpath(*relative_path.parts)
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Required external notification catalog is missing: {source_name}")
        content = source.read_bytes()
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError(f"Notification catalog is not valid UTF-8: {source_name}") from None
        validate_file_content(relative_path, text)
        files.append((relative_path, content))

    packaged_paths = {path.as_posix() for path, _ in files}
    required_package_files = (
        REQUIRED_FUNCTION_FILES
        | {path.as_posix() for path in RUNTIME_SOURCE_FILES}
        | set(EXTERNAL_CATALOG_IMPORTS.values())
    )
    missing = sorted(required_package_files - packaged_paths)
    if missing:
        raise ValueError(f"Required deployment source is missing: {', '.join(missing)}")
    return sorted(files, key=lambda item: item[0].as_posix())


def write_archive(output: Path, files: list[tuple[PurePosixPath, bytes]]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, mode="w:gz", compresslevel=9) as archive:
        for relative_path, content in files:
            entry = tarfile.TarInfo(relative_path.as_posix())
            entry.size = len(content)
            entry.mode = 0o644
            entry.mtime = 0
            entry.uid = 0
            entry.gid = 0
            entry.uname = ""
            entry.gname = ""
            archive.addfile(entry, io.BytesIO(content))


def validate_archive(output: Path) -> None:
    with tarfile.open(output, mode="r:gz") as archive:
        members = archive.getmembers()
        if not members:
            raise ValueError("The function archive is empty.")

        paths: set[str] = set()
        for member in members:
            path = PurePosixPath(member.name)
            if (
                member.type not in {tarfile.REGTYPE, tarfile.AREGTYPE}
                or path.is_absolute()
                or ".." in path.parts
                or not path.parts
                or path.parts[0] not in (set(FUNCTION_DIRS) | {"src", "deno.jsonc", "LICENSE"})
                or (path.name != "LICENSE" and path.suffix.lower() not in {".ts", ".jsonc"})
                or is_excluded_secret(path)
            ):
                raise ValueError(f"Unsafe or unexpected archive entry: {member.name}")
            paths.add(path.as_posix())

        required_package_files = (
            REQUIRED_FUNCTION_FILES
            | {path.as_posix() for path in RUNTIME_SOURCE_FILES}
            | set(EXTERNAL_CATALOG_IMPORTS.values())
        )
        missing = sorted(required_package_files - paths)
        if missing:
            raise ValueError(f"Archive is missing required deployment source: {', '.join(missing)}")
        top_level = {PurePosixPath(path).parts[0] for path in paths}
        expected_top_level = set(FUNCTION_DIRS) | {"src", "deno.jsonc", "LICENSE"}
        if top_level != expected_top_level:
            raise ValueError("Archive does not contain exactly the approved deployment paths.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a validated VPS Edge Functions source archive.")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    root_result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    )
    repository = Path(root_result.stdout.strip())
    validate_external_dependencies(repository)
    files = tracked_function_files(repository)
    write_archive(args.output, files)
    validate_archive(args.output)
    print(f"Validated {len(files)} deployment files across {len(FUNCTION_DIRS)} directories.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError, tarfile.TarError, ValueError) as error:
        raise SystemExit(f"Function package validation failed: {error}") from error
