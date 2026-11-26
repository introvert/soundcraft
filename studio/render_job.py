#!/usr/bin/env python3
"""One Studio render, run as a subprocess of server.py (so Surge, numpy and a
crash stay out of the server). Prints progress lines; the server streams them.

    python render_job.py <program.json> <out_dir> full  [--minutes 3]
    python render_job.py <program.json> <out_dir> pad   --index 0     # one chord, raw (unmastered)
    python render_job.py <program.json> <out_dir> air   --index 0
    python render_job.py <program.json> <out_dir> arp   --index 0

`full` is the real pipeline: compose.build (render, master, encode, manifest,
QA) into generation/output/packs/deepwave.<slug>/, then compose.preview into
<out_dir> (mix.wav, mix_open.wav, mix_shipped.wav, stems/, layers/,
preview.json). The program used is copied next to the audio as program.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
GEN = Path(os.environ.get("SOUNDFOCUS_GENERATION",
                          Path.home() / "code" / "mobile" / "soundfocus-app" / "generation")).expanduser()
sys.path.insert(0, str(GEN))
sys.path.insert(0, str(HERE))

import program as programs                             # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("program", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("kind", choices=("full", "pad", "air", "arp"))
    ap.add_argument("--index", type=int, default=0)
    ap.add_argument("--minutes", type=float, default=3.0)
    ap.add_argument("--kbps", type=int, default=160)
    args = ap.parse_args(argv)

    prog = json.loads(args.program.read_text())
    theme = programs.to_theme(prog)
    args.out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    if args.kind == "full":
        from compose import build, preview
        print(f"@stage build {theme.slug}", flush=True)
        pack_dir, report = build.build(theme, args.kbps)
        print(f"@stage preview {args.minutes:g} min", flush=True)
        preview.preview(theme.slug, args.minutes, args.out)
        (args.out / "program.json").write_text(json.dumps(prog, indent=2, ensure_ascii=False) + "\n")
        issues = [f"{asset}: {name} {c.get('value')} ({c['status']})"
                  for asset, a in report.get("assets", {}).items()
                  for name, c in a.get("checks", {}).items() if c.get("status") != "pass"]
        (args.out / "qa.json").write_text(json.dumps({
            "pack": str(pack_dir), "verdict": report.get("verdict"), "issues": issues,
        }, indent=2, default=str) + "\n")
        print(f"@done {time.time() - t0:.0f}s  QA {report.get('verdict')}", flush=True)
        return 0

    import soundfile as sf
    from compose import render
    fn = {"pad": render.render_pad, "air": render.render_air, "arp": render.render_arp}[args.kind]
    if args.kind == "arp" and not theme.arp:
        raise SystemExit("this program has no arp")
    print(f"@stage render {args.kind}{args.index + 1}", flush=True)
    y = fn(theme, args.index)
    peak = float(abs(y).max()) or 1.0
    path = args.out / "audition" / f"{args.kind}{args.index + 1}.wav"
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, (y / peak * 0.7).T.astype("float32"), render.SR, subtype="PCM_24")
    print(f"@done {time.time() - t0:.0f}s → {path.name} (raw loop, peak-normalised, before mastering)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
