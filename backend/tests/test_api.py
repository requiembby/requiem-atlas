import os
import tempfile
from unittest.mock import patch

os.environ["ATLAS_DB_PATH"] = os.path.join(tempfile.gettempdir(), "requiem_atlas_pytest.sqlite3")

from fastapi.testclient import TestClient
from app import db
from app.main import app
from app.scanner import TargetError, build_graph, normalize_target, pinned_public_ip


def test_normalization():
    assert normalize_target(" ExAmPlE.Org. ") == ("example.org", "domain")
    assert normalize_target("1.1.1.1") == ("1.1.1.1", "ip")
    for target in ("localhost", "127.0.0.1", "10.1.0.1", "172.16.0.2", "192.168.0.1",
                   "169.254.0.1", "::1", "http://example.com", "example.com:8080", "example.local"):
        try:
            normalize_target(target)
            assert False, f"Should reject {target}"
        except TargetError:
            pass


def test_public_resolution_guard():
    with patch("app.scanner.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
        try:
            pinned_public_ip("example.org")
            assert False, "Should reject a non-public target"
        except TargetError:
            pass
    with patch("app.scanner.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.215.14", 443))]):
        assert pinned_public_ip("example.org") == "93.184.215.14"


def test_graph():
    graph = build_graph("example.org", "domain", [{"type": "A", "value": "93.184.215.14"}], ["www.example.org"])
    assert len(graph["nodes"]) == 3
    assert len(graph["edges"]) == 2


def test_api_db_flow():
    db.init_db()
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.post("/api/analyze", json={"target": "127.0.0.1"}).status_code == 422
        with patch("app.main.analyze", return_value={"target": "example.org", "kind": "domain",
                "scanned_at": "2026-11-01T00:00:00+00:00", "summary": {"ips": 1},
                "graph": {"nodes": [], "edges": []}}):
            response = client.post("/api/analyze", json={"target": "example.org"})
        assert response.status_code == 200
        row_id = response.json()["id"]
        assert client.get(f"/api/history/{row_id}").json()["target"] == "example.org"
        assert any(i["id"] == row_id for i in client.get("/api/history", params={"q": "example"}).json()["items"])
        assert client.get("/api/stats").json()["total_analyses"] >= 1
