"""An unhandled error must reach the browser as a 500 *with* CORS headers.

Without it the driver app sees "Failed to fetch" and wrongly assumes it is
offline. Uses the same middleware order as app/main.py.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.core.error_middleware import UnhandledErrorMiddleware
from app.main import app as real_app


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/boom")
    def boom():
        raise RuntimeError("column delivery_stops.outcome_reason does not exist")

    return app


def test_unhandled_error_is_a_json_500_with_cors_headers():
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/boom", headers={"Origin": "http://localhost:3000"})
    assert r.status_code == 500
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "unexpected error" in r.json()["detail"]
    assert "outcome_reason" not in r.text  # internals are logged, not sent to the client


def test_main_app_registers_it_inside_cors():
    names = [m.cls.__name__ for m in real_app.user_middleware]
    assert "UnhandledErrorMiddleware" in names
    if "CORSMiddleware" in names:
        # user_middleware is outermost-first: CORS must wrap the error middleware
        assert names.index("CORSMiddleware") < names.index("UnhandledErrorMiddleware")
