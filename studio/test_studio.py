"""Studio tests: program format round-trip + the HTTP API (no audio rendering).

    SOUNDFOCUS_GENERATION=~/code/mobile/soundfocus-app/generation \
        ~/code/mobile/soundfocus-app/generation/.venv/bin/python -m pytest studio/
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest

import server
import program as programs

themes = pytest.importorskip("compose.themes", reason="needs the soundfocus-app generation checkout")


@pytest.mark.parametrize("theme", themes.THEMES, ids=lambda t: t.slug)
def test_every_theme_round_trips(theme):
    prog = json.loads(json.dumps(programs.from_theme(theme)))      # through real JSON
    assert programs.validate(prog) == []
    assert programs.to_theme(prog) == theme


def _prog(**changes):
    p = programs.from_theme(themes.BY_SLUG["neural_drift"])
    p.update(changes)
    return p


@pytest.mark.parametrize("change, needle", [
    ({"slug": "Bad Slug"}, "slug"),
    ({"category": "party"}, "category"),
    ({"color": "#123456"}, "color"),
    ({"chords": [{"notes": [45, 52]}] * 3}, "four chords"),
    ({"chords": [{"notes": [45, 200]}] * 4}, "MIDI note"),
    ({"air": {"proc": "lasers"}}, "air"),
    ({"bands": {"padLowPassHz": 50, "airHighPassHz": 1500}}, "padLowPassHz"),
    ({"events": {"x": {"kind": "interval", "asset": "tibetan_bowl", "everySec": 60, "gain": 0.3}}}, "asset"),
    ({"texture": {"preset": "lava", "gain": 0.2}}, "texture.preset"),
])
def test_validation_catches(change, needle):
    errors = programs.validate(_prog(**change), textures={"surf", "hush"})
    assert any(needle in e for e in errors), errors


def test_to_theme_refuses_invalid():
    with pytest.raises(programs.ProgramError):
        programs.to_theme(_prog(chords=[]))


@pytest.fixture()
def studio(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "PROGRAMS", tmp_path / "programs")
    monkeypatch.setattr(server, "RENDERS", tmp_path / "renders")
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", tmp_path
    srv.shutdown()


def _call(url, method="GET", body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_api_save_and_list(studio):
    base, tmp = studio
    status, lib = _call(f"{base}/api/programs")
    assert status == 200 and len(lib["builtin"]) == len(themes.THEMES) and lib["saved"] == []
    status, prog = _call(f"{base}/api/programs/deep_ocean?source=builtin")
    prog.update(slug="my_ocean", name="My Ocean")
    assert _call(f"{base}/api/programs/my_ocean", "PUT", prog)[0] == 200
    assert json.loads((tmp / "programs" / "my_ocean.json").read_text())["name"] == "My Ocean"
    assert _call(f"{base}/api/programs")[1]["saved"][0]["slug"] == "my_ocean"
    assert _call(f"{base}/api/programs/my_ocean")[1] == prog


def test_api_rejects_bad_programs(studio):
    base, _ = studio
    prog = _call(f"{base}/api/programs/deep_ocean?source=builtin")[1]
    status, body = _call(f"{base}/api/programs/other_slug", "PUT", prog)
    assert status == 422 and "doesn't match" in body["errors"][0]
    status, body = _call(f"{base}/api/jobs", "POST", {"program": {**prog, "chords": []}, "kind": "full"})
    assert status == 422
    assert _call(f"{base}/api/programs/..%2Fetc")[0] == 404
    assert _call(f"{base}/renders/deep_ocean/..%2F..%2Fserver.py")[0] in (400, 404)


def test_api_delete(studio):
    base, tmp = studio
    prog = _call(f"{base}/api/programs/deep_ocean?source=builtin")[1]
    prog.update(slug="gone_soon")
    _call(f"{base}/api/programs/gone_soon", "PUT", prog)
    assert _call(f"{base}/api/programs/gone_soon", "DELETE")[0] == 200
    assert not (tmp / "programs" / "gone_soon.json").exists()
    assert _call(f"{base}/api/programs/gone_soon", "DELETE")[0] == 404
