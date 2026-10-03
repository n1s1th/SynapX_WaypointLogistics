"""Turn unhandled exceptions into a JSON 500 *inside* the CORS middleware.

Starlette's default 500 is produced by ServerErrorMiddleware, which sits
outside CORSMiddleware, so the browser receives it without CORS headers and
reports "Failed to fetch" — indistinguishable from being offline. The driver
app would then wrongly switch to its offline copy. Registering this before
CORSMiddleware keeps the real status visible to the frontend.
"""
import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


class UnhandledErrorMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            logger.exception("Unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if response_started:
                raise
            response = JSONResponse(
                {"detail": "The server hit an unexpected error. Please try again or contact dispatch."},
                status_code=500,
            )
            await response(scope, receive, send)
