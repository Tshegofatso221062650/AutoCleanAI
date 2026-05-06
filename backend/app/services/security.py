"""Central security utilities.

Provides:
  - RateLimiter   — sliding-window per-key rate limiting (in-memory, thread-safe)
  - AccountLockout — lock accounts after N consecutive bad passwords
  - validate_secret_key — warn/fail on insecure defaults at startup
  - sanitize_filename   — strip path traversal from upload names
  - check_magic_bytes   — validate file content vs claimed extension
  - safe_path_within    — prevent path traversal when serving files
"""
from __future__ import annotations

import ast
import hashlib
import logging
import os
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Deque

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Rate Limiter — sliding window, per (key, action)
# ─────────────────────────────────────────────────────────────────────────────

class RateLimiter:
    """Thread-safe sliding-window rate limiter.

    Usage:
        limiter = RateLimiter(max_calls=5, window_seconds=60)
        if not limiter.allow("127.0.0.1:login"):
            raise HTTPException(429, "Too many requests")
    """

    def __init__(self, max_calls: int, window_seconds: float) -> None:
        self._max    = max_calls
        self._window = window_seconds
        self._buckets: dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self._window
        with self._lock:
            if key not in self._buckets:
                self._buckets[key] = deque()
            dq = self._buckets[key]
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= self._max:
                return False
            dq.append(now)
            return True

    def reset(self, key: str) -> None:
        with self._lock:
            self._buckets.pop(key, None)


# Global limiters — imported by routers
login_limiter    = RateLimiter(max_calls=10,  window_seconds=60)    # 10 attempts / minute / IP
register_limiter = RateLimiter(max_calls=5,   window_seconds=300)   # 5 registrations / 5 min / IP
api_limiter      = RateLimiter(max_calls=300, window_seconds=60)    # 300 req / minute / IP
clean_limiter    = RateLimiter(max_calls=20,  window_seconds=60)    # 20 clean jobs / minute / user
chat_limiter     = RateLimiter(max_calls=30,  window_seconds=60)    # 30 chat messages / minute / user


# ─────────────────────────────────────────────────────────────────────────────
# Account Lockout
# ─────────────────────────────────────────────────────────────────────────────

class AccountLockout:
    """Lock a username after N consecutive failed password attempts.

    Automatically unlocks after `lockout_seconds`.
    """

    def __init__(self, max_failures: int = 5, lockout_seconds: float = 300) -> None:
        self._max      = max_failures
        self._duration = lockout_seconds
        self._failures: dict[str, int]   = {}
        self._locked:   dict[str, float] = {}  # username → locked_until monotonic
        self._lock = threading.Lock()

    def record_failure(self, username: str) -> bool:
        """Record a failed attempt. Returns True if account is now locked."""
        with self._lock:
            # Clear expired lockout first
            if username in self._locked and time.monotonic() > self._locked[username]:
                del self._locked[username]
                self._failures[username] = 0
            self._failures[username] = self._failures.get(username, 0) + 1
            if self._failures[username] >= self._max:
                self._locked[username] = time.monotonic() + self._duration
                logger.warning("Account locked: %s after %d failures", username, self._failures[username])
                return True
            return False

    def record_success(self, username: str) -> None:
        with self._lock:
            self._failures.pop(username, None)
            self._locked.pop(username, None)

    def is_locked(self, username: str) -> bool:
        with self._lock:
            until = self._locked.get(username)
            if until is None:
                return False
            if time.monotonic() > until:
                del self._locked[username]
                self._failures.pop(username, None)
                return False
            return True

    def seconds_until_unlock(self, username: str) -> int:
        with self._lock:
            until = self._locked.get(username, 0.0)
            remaining = until - time.monotonic()
            return max(0, int(remaining))


account_lockout = AccountLockout(max_failures=5, lockout_seconds=300)


# ─────────────────────────────────────────────────────────────────────────────
# Secret key validation
# ─────────────────────────────────────────────────────────────────────────────

_INSECURE_KEYS = {
    "change-me-in-production-use-long-random-string",
    "changeme",
    "secret",
    "password",
    "dev",
    "",
}

def validate_secret_key(key: str) -> None:
    if key.lower() in _INSECURE_KEYS or len(key) < 32:
        raise RuntimeError(
            f"SECURITY: SECRET_KEY is insecure ('{key[:8]}…'). "
            "The server will not start with a weak key. "
            "Set a strong random key in backend/.env: "
            "SECRET_KEY=<output of: python -c \"import secrets; print(secrets.token_hex(32))\">"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Filename sanitisation
# ─────────────────────────────────────────────────────────────────────────────

_ALLOWED_FILENAME_RE = re.compile(r"[^\w\-. ]")
_MAX_FILENAME_LEN = 200

def sanitize_filename(name: str) -> str:
    """Strip path separators, null bytes, and dangerous chars from a filename."""
    # Remove directory components
    name = Path(name).name
    # Null byte
    name = name.replace("\x00", "")
    # Collapse whitespace
    name = " ".join(name.split())
    # Remove characters outside allowed set
    name = _ALLOWED_FILENAME_RE.sub("_", name)
    # Truncate
    stem = Path(name).stem[:_MAX_FILENAME_LEN]
    suffix = Path(name).suffix
    name = f"{stem}{suffix}"
    # Reject hidden/system names
    if not name or name.startswith("."):
        name = f"upload{suffix}"
    return name


# ─────────────────────────────────────────────────────────────────────────────
# Magic byte validation
# ─────────────────────────────────────────────────────────────────────────────

_MAGIC: dict[str, list[bytes]] = {
    "csv":     [],                                                  # No magic — validated by parse
    "json":    [],                                                  # No magic — validated by parse
    "xlsx":    [b"PK\x03\x04"],                                    # ZIP
    "xls":     [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"],            # OLE2
    "parquet": [b"PAR1"],
    "tsv":     [],
    "orc":     [b"ORC"],
}

_DANGEROUS_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".sh", ".ps1", ".py", ".js", ".php",
    ".jar", ".com", ".scr", ".vbs", ".wsf", ".hta",
}

def check_magic_bytes(header: bytes, fmt: str, filename: str) -> None:
    """Raise ValueError if file header doesn't match expected format."""
    ext = Path(filename).suffix.lower()
    if ext in _DANGEROUS_EXTENSIONS:
        raise ValueError(f"File type not allowed: {ext}")
    magics = _MAGIC.get(fmt, [])
    if not magics:
        return  # No magic to check — format validated at parse time
    for magic in magics:
        if header[:len(magic)] == magic:
            return
    raise ValueError(f"File content does not match claimed format '{fmt}'")


# ─────────────────────────────────────────────────────────────────────────────
# Path traversal guard
# ─────────────────────────────────────────────────────────────────────────────

def safe_path_within(path: Path, allowed_root: Path) -> Path:
    """Resolve path and ensure it is inside allowed_root. Raises ValueError otherwise."""
    resolved = path.resolve()
    root     = allowed_root.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        raise ValueError(f"Path traversal detected: {path}")
    return resolved


# ─────────────────────────────────────────────────────────────────────────────
# Custom function AST sandbox
# ─────────────────────────────────────────────────────────────────────────────

_BLOCKED_NAMES = frozenset({
    "__import__", "__builtins__", "__loader__", "__spec__",
    "__class__", "__bases__", "__subclasses__", "__mro__",
    "globals", "locals", "vars", "dir", "getattr", "setattr", "delattr",
    "compile", "eval", "exec", "open", "input", "breakpoint",
    "memoryview", "bytearray",
    "os", "sys", "subprocess", "importlib", "ctypes", "socket",
    "shutil", "pathlib", "tempfile", "pickle", "shelve", "marshal",
})

_BLOCKED_ATTR_RE = re.compile(
    r"__(class|bases|subclasses|mro|globals|locals|builtins|dict|code|"
    r"reduce|reduce_ex|getstate|setstate|new|init_subclass)__"
)

class _ASTSecurityVisitor(ast.NodeVisitor):
    """Walk the AST and reject dangerous constructs."""

    def __init__(self) -> None:
        self.violations: list[str] = []

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.violations.append(f"import statement not allowed: 'import {alias.name}'")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        self.violations.append(f"import statement not allowed: 'from {node.module} import ...'")
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in _BLOCKED_NAMES:
            self.violations.append(f"blocked name: '{node.id}'")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if _BLOCKED_ATTR_RE.match(node.attr):
            self.violations.append(f"blocked attribute access: '.{node.attr}'")
        if node.attr in ("read", "write", "open") and not isinstance(node.ctx, ast.Load):
            self.violations.append(f"blocked method call: '.{node.attr}'")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        # Block pd.read_* / pd.to_* file I/O, np.load, etc.
        if isinstance(node.func, ast.Attribute):
            dangerous_io = {
                "read_csv", "read_excel", "read_json", "read_parquet",
                "read_html", "read_sql", "read_clipboard", "read_feather",
                "read_orc", "read_sas", "read_spss", "read_stata",
                "to_csv", "to_excel", "to_json", "to_parquet",
                "to_sql", "to_clipboard", "to_pickle",
                "load", "save", "savetxt", "fromfile",
            }
            if node.func.attr in dangerous_io:
                self.violations.append(f"blocked I/O method: '.{node.func.attr}()'")
        self.generic_visit(node)


def audit_function_code(code: str) -> list[str]:
    """Parse and AST-scan user code. Return list of violation descriptions (empty = safe)."""
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        return [f"Syntax error: {exc}"]
    visitor = _ASTSecurityVisitor()
    visitor.visit(tree)
    return visitor.violations
