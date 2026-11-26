#!/usr/bin/env python3
"""SoundCraft Studio: a local browser UI for designing soundscapes with compose.

    cd ~/code/experiments/soundcraft
    ~/code/mobile/soundfocus-app/generation/.venv/bin/python studio/server.py
    open http://127.0.0.1:8765

Edit a soundscape program (key, chords, instruments, air, bands, texture,
events, arp), sketch it instantly in the browser, render it for real through
compose (Surge XT → master → pack → audition mix + stems), listen, and save the
program to programs/<slug>.json. See studio/README.md and programs/README.md.

Environment:
    SOUNDFOCUS_GENERATION  soundfocus-app/generation checkout (compose branch)
                           default ~/code/mobile/soundfocus-app/generation
    SURGE_DATA             Surge XT data dir, for the patch list
                           default /Library/Application Support/Surge XT
    STUDIO_PORT            default 8765
Binds to 127.0.0.1 only.
"""
from __future__ import annotations

import argparse
import json
import math
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WEB = HERE / "web"
PROGRAMS = REPO / "programs"
RENDERS = REPO / "compose"                            # same place compose.preview writes auditions
GEN = Path(os.environ.get("SOUNDFOCUS_GENERATION",
                          Path.home() / "code" / "mobile" / "soundfocus-app" / "generation")).expanduser()
SURGE_DATA = Path(os.environ.get("SURGE_DATA", "/Library/Application Support/Surge XT")).expanduser()
SURGE_VST3 = Path("/Library/Audio/Plug-Ins/VST3/Surge XT.vst3")   # = compose.surge.SURGE_VST3

sys.path.insert(0, str(GEN))
sys.path.insert(0, str(HERE))
import program as programs                             # noqa: E402

_SLUG_PATH = re.compile(r"^[a-z][a-z0-9_]{1,47}$")


# ── environment probes ─────────────────────────────────────────────────────────

def _builtin_themes() -> dict[str, dict]:
    try:
        from compose.themes import THEMES
    except Exception:                                    # noqa: BLE001 — no generation checkout
        return {}
    return {t.slug: programs.from_theme(t) for t in THEMES}


def _textures() -> list[str]:
    try:
        import texture_synth
        presets = sorted(texture_synth.PRESETS)
    except Exception:                                    # noqa: BLE001 — numpy missing / no checkout
        presets = ["fire", "hush", "rain_heavy", "rain_soft", "stream", "surf", "wind"]
    return presets + list(programs.SCAPES)


def _patches() -> list[str]:
    out = []
    for root in ("patches_factory", "patches_3rdparty"):
        base = SURGE_DATA / root
        if base.is_dir():
            out += sorted(str(p.relative_to(SURGE_DATA).with_suffix("")) for p in base.rglob("*.fxp"))
    return out


def environment() -> dict:
    themes = _builtin_themes()
    patches = _patches()
    return {
        "generation": str(GEN), "generationFound": (GEN / "compose" / "build.py").is_file(),
        "surgeInstalled": SURGE_VST3.exists(), "surgeData": str(SURGE_DATA),
        "python": sys.executable,
        "options": {
            "categories": list(programs.CATEGORIES), "airProcs": list(programs.AIR_PROCS),
            "eventSynths": list(programs.EVENT_SYNTHS), "textures": _textures(), "patches": patches,
        },
        "builtinCount": len(themes),
    }


# ── programs on disk ───────────────────────────────────────────────────────────

def list_programs() -> dict:
    saved = []
    for p in sorted(PROGRAMS.glob("*.json")):
        try:
            d = json.loads(p.read_text())
            saved.append({"slug": d.get("slug", p.stem), "name": d.get("name", p.stem),
                          "category": d.get("category"), "color": d.get("color"),
                          "rendered": (RENDERS / p.stem / "mix.wav").exists()})
        except json.JSONDecodeError:
            continue
    builtin = [{"slug": s, "name": d["name"], "category": d["category"], "color": d["color"],
                "rendered": (RENDERS / s / "mix.wav").exists()} for s, d in _builtin_themes().items()]
    return {"saved": saved, "builtin": builtin}


def save_program(slug: str, prog: dict) -> list[str]:
    errors = programs.validate(prog, set(_textures()))
    if not errors and prog["slug"] != slug:
        errors = [f"slug in body ({prog['slug']}) doesn't match the URL ({slug})"]
    if errors:
        return errors
    PROGRAMS.mkdir(exist_ok=True)
    tmp = PROGRAMS / f".{slug}.json.tmp"
    tmp.write_text(json.dumps(prog, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(PROGRAMS / f"{slug}.json")
    return []


# ── render jobs ────────────────────────────────────────────────────────────────

class Jobs:
    """One render at a time (Surge renders are CPU-bound); each a subprocess."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.jobs: dict[str, dict] = {}

    def running(self) -> dict | None:
        return next((j for j in self.jobs.values() if j["status"] == "running"), None)

    def start(self, prog: dict, kind: str, index: int, minutes: float) -> dict:
        with self.lock:
            if (busy := self.running()) is not None:
                raise RuntimeError(f"a render is already running ({busy['kind']} {busy['slug']})")
            fd, path = tempfile.mkstemp(prefix="studio-", suffix=".json")
            with os.fdopen(fd, "w") as f:
                json.dump(prog, f)
            out = RENDERS / prog["slug"]
            cmd = [sys.executable, "-u", str(HERE / "render_job.py"), path, str(out), kind,
                   "--index", str(index), "--minutes", str(minutes)]
            proc = subprocess.Popen(cmd, cwd=GEN, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, bufsize=1, env={**os.environ, "SOUNDFOCUS_GENERATION": str(GEN)})
            job = {"id": uuid.uuid4().hex[:12], "slug": prog["slug"], "kind": kind, "index": index,
                   "minutes": minutes, "status": "running", "stage": "starting", "log": [],
                   "started": time.time(), "ended": None, "proc": proc, "tmp": path}
            self.jobs[job["id"]] = job
        threading.Thread(target=self._pump, args=(job,), daemon=True).start()
        return job

    def _pump(self, job: dict) -> None:
        for line in job["proc"].stdout:
            line = line.rstrip("\n")
            if line.startswith("@stage "):
                job["stage"] = line[7:]
            job["log"].append(line)
            del job["log"][:-400]
        code = job["proc"].wait()
        job["status"] = "done" if code == 0 else "failed"
        job["stage"] = "done" if code == 0 else f"failed (exit {code})"
        job["ended"] = time.time()
        Path(job["tmp"]).unlink(missing_ok=True)

    def cancel(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job or job["status"] != "running":
            return False
        job["proc"].terminate()
        return True

    @staticmethod
    def public(job: dict) -> dict:
        return {k: v for k, v in job.items() if k not in ("proc", "tmp")} | {
            "elapsed": round((job["ended"] or time.time()) - job["started"], 1)}


JOBS = Jobs()


def renders_for(slug: str) -> dict:
    """What has been rendered for a slug: mixes, stems, auditions, preview + QA info."""
    d = RENDERS / slug
    url = lambda p: f"/renders/{slug}/{p.relative_to(d).as_posix()}?v={int(p.stat().st_mtime)}"  # noqa: E731
    files = lambda sub: [{"name": p.stem, "url": url(p)} for p in sorted((d / sub).glob("*.wav"))]  # noqa: E731
    read = lambda n: json.loads((d / n).read_text()) if (d / n).is_file() else None  # noqa: E731
    return {
        "mixes": [{"name": p.stem, "url": url(p)} for p in sorted(d.glob("mix*.wav"))],
        "stems": files("stems"), "layers": files("layers"), "auditions": files("audition"),
        "preview": read("preview.json"), "qa": read("qa.json"), "program": read("program.json"),
    }


def _finite(x):
    """JSON for the browser: Python writes -Infinity/NaN (a silent stem's LUFS), JSON.parse rejects them."""
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_finite(v) for v in x]
    return x


# ── HTTP ───────────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "SoundCraftStudio/1"

    def log_message(self, fmt, *args):                    # quiet: only errors
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    def _json(self, body, status=HTTPStatus.OK):
        data = json.dumps(_finite(body), ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"null")

    def _file(self, path: Path):
        if not path.is_file():
            return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        size = path.stat().st_size
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix == ".wav":
            ctype = "audio/wav"
        start, end = 0, size - 1
        rng = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if rng and (rng.group(1) or rng.group(2)):
            if rng.group(1):
                start = int(rng.group(1))
                end = min(int(rng.group(2)), size - 1) if rng.group(2) else size - 1
            else:
                start = max(0, size - int(rng.group(2)))
            if start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 16, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

    def _safe_under(self, base: Path, rel: str) -> Path | None:
        p = (base / unquote(rel)).resolve()
        return p if p.is_relative_to(base.resolve()) else None

    # routes
    def do_GET(self):
        u = urlparse(self.path)
        parts = [p for p in u.path.split("/") if p]
        q = parse_qs(u.query)
        if not parts:
            return self._file(WEB / "index.html")
        if parts[0] == "api":
            route = parts[1:]
            if route == ["env"]:
                return self._json(environment())
            if route == ["programs"]:
                return self._json(list_programs())
            if len(route) == 2 and route[0] == "programs" and _SLUG_PATH.match(route[1]):
                slug = route[1]
                if q.get("source", ["saved"])[0] == "builtin":
                    prog = _builtin_themes().get(slug)
                else:
                    f = PROGRAMS / f"{slug}.json"
                    prog = json.loads(f.read_text()) if f.is_file() else None
                return self._json(prog) if prog else self._json({"error": "no such program"}, HTTPStatus.NOT_FOUND)
            if len(route) == 2 and route[0] == "renders" and _SLUG_PATH.match(route[1]):
                return self._json(renders_for(route[1]))
            if route == ["jobs"]:
                return self._json([Jobs.public(j) for j in JOBS.jobs.values()][-20:])
            if len(route) == 2 and route[0] == "jobs" and route[1] in JOBS.jobs:
                return self._json(Jobs.public(JOBS.jobs[route[1]]))
            return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        if parts[0] == "renders" and len(parts) >= 3 and _SLUG_PATH.match(parts[1]):
            p = self._safe_under(RENDERS / parts[1], "/".join(parts[2:]))
            return self._file(p) if p else self._json({"error": "bad path"}, HTTPStatus.BAD_REQUEST)
        p = self._safe_under(WEB, u.path.lstrip("/"))
        return self._file(p) if p else self._json({"error": "bad path"}, HTTPStatus.BAD_REQUEST)

    def do_PUT(self):
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if len(parts) == 3 and parts[:2] == ["api", "programs"] and _SLUG_PATH.match(parts[2]):
            try:
                body = self._body()
            except ValueError as e:
                return self._json({"errors": [f"invalid JSON: {e}"]}, HTTPStatus.BAD_REQUEST)
            errors = save_program(parts[2], body)
            if errors:
                return self._json({"errors": errors}, HTTPStatus.UNPROCESSABLE_ENTITY)
            return self._json({"saved": f"programs/{parts[2]}.json"})
        return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if len(parts) == 3 and parts[:2] == ["api", "jobs"]:
            return self._json({"cancelled": JOBS.cancel(parts[2])})
        return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        route = [p for p in urlparse(self.path).path.split("/") if p]
        try:
            body = self._body() or {}
        except ValueError as e:
            return self._json({"errors": [f"invalid JSON: {e}"]}, HTTPStatus.BAD_REQUEST)
        if route == ["api", "validate"]:
            return self._json({"errors": programs.validate(body, set(_textures()))})
        if route == ["api", "jobs"]:
            prog, kind = body.get("program"), body.get("kind", "full")
            errors = programs.validate(prog, set(_textures()))
            if kind not in ("full", "pad", "air", "arp"):
                errors.append("kind: full | pad | air | arp")
            if errors:
                return self._json({"errors": errors}, HTTPStatus.UNPROCESSABLE_ENTITY)
            try:
                job = JOBS.start(prog, kind, int(body.get("index", 0)),
                                 max(0.5, min(30.0, float(body.get("minutes", 3)))))
            except RuntimeError as e:
                return self._json({"errors": [str(e)]}, HTTPStatus.CONFLICT)
            return self._json(Jobs.public(job), HTTPStatus.ACCEPTED)
        return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=int(os.environ.get("STUDIO_PORT", 8765)))
    args = ap.parse_args(argv)
    env = environment()
    print(f"SoundCraft Studio → http://127.0.0.1:{args.port}")
    print(f"  generation: {env['generation']} ({'ok' if env['generationFound'] else 'NOT FOUND'}), "
          f"{env['builtinCount']} built-in themes")
    print(f"  Surge XT:   {'installed' if env['surgeInstalled'] else 'not found'}; "
          f"{len(env['options']['patches'])} patches under {env['surgeData']}")
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
