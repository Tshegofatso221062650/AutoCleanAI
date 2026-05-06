"""Security middleware for AutoClean AI.

Adds:
  1. SecurityHeadersMiddleware — sets hardened HTTP response headers
  2. RequestSizeLimitMiddleware — rejects oversized request bodies early
"""
from __future__ import annotations

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

from app.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject security-relevant HTTP response headers on every response."""

    _HEADERS = {
        "X-Content-Type-Options":    "nosniff",
        "X-Frame-Options":           "DENY",
        "X-XSS-Protection":          "1; mode=block",
        "Referrer-Policy":           "strict-origin-when-cross-origin",
        "Permissions-Policy":        "geolocation=(), microphone=(), camera=()",
        # Tight CSP: API only — no browser rendering except Swagger/ReDoc
        "Content-Security-Policy": (
            "default-src 'none'; "
            "script-src 'self' 'unsafe-inline'; "   # Swagger UI needs inline scripts
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none';"
        ),
        # Cache-control for API responses
        "Cache-Control": "no-store",
        "Pragma":        "no-cache",
        # Enforce HTTPS for 1 year when served over TLS
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    }

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        for key, val in self._HEADERS.items():
            response.headers.setdefault(key, val)
        # Remove headers that leak server info
        for leak_header in ("Server", "X-Powered-By"):
            if leak_header in response.headers:
                del response.headers[leak_header]
        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject request bodies larger than max_upload_mb before they hit a router.

    File uploads are exempt from the hard cap here (they're streamed to disk);
    this guard targets JSON/form payloads only.
    """

    _JSON_LIMIT_BYTES = 10 * 1024 * 1024  # 10 MB for JSON payloads

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        max_mb = settings.max_upload_mb or 500
        self._upload_limit = max_mb * 1024 * 1024

    async def dispatch(self, request: Request, call_next):
        ct = request.headers.get("content-type", "")
        cl_str = request.headers.get("content-length", "")

        if cl_str:
            try:
                cl = int(cl_str)
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)

            if "multipart/form-data" in ct:
                if cl > self._upload_limit:
                    return JSONResponse(
                        {"detail": f"Upload exceeds {settings.max_upload_mb} MB limit"},
                        status_code=413,
                    )
            elif cl > self._JSON_LIMIT_BYTES:
                return JSONResponse(
                    {"detail": "Request body too large (max 10 MB for JSON)"},
                    status_code=413,
                )

        return await call_next(request)
