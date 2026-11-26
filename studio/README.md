# SoundCraft Studio

A local browser UI for designing soundscapes with `compose` (the theme-pack
renderer in soundfocus-app). Pick a theme or start a new one, tweak it, hear
it, render it for real, and save the **program** (the recipe) to
`programs/<slug>.json`. Format and how the app gets it: [`programs/README.md`](../programs/README.md).

```sh
cd ~/code/experiments/soundcraft
~/code/mobile/soundfocus-app/generation/.venv/bin/python studio/server.py
open http://127.0.0.1:8765
```

It runs with the generation venv (the one from HANDOVER §1) because renders
import `compose`. It needs the soundfocus-app checkout on the
`compose-theme-packs` branch, Surge XT and ffmpeg, the same as `compose.build`.

| Env var | Default |
|---|---|
| `SOUNDFOCUS_GENERATION` | `~/code/mobile/soundfocus-app/generation` |
| `SURGE_DATA` (patch list for autocomplete) | `/Library/Application Support/Surge XT` |
| `STUDIO_PORT` | `8765` (binds 127.0.0.1 only) |

## What it does

- **Library.** Saved programs (`programs/`) and the built-in themes from
  `compose/themes.py`, loaded live, as starting points. A dot marks slugs
  that have a render.
- **Editor.** Every `Theme` field: key and drone, the four chords (note
  names like `A2 E3 C#4`, or MIDI numbers) with their top lines, body and halo
  patches (autocomplete from your Surge library), air, bands, breath, reverb,
  texture, events (with a ▶ to hear one strike), the arp, and per-pad extras.
  The raw program JSON is editable under Advanced. It validates as you type and
  shows the engine's resulting default depth and global low-pass.
- **Sketch.** An instant Web Audio stand-in: the chords in order with the
  crossfade, halo, top line and breath, the drone, air, texture, events and arp,
  through the program's bands and reverb. Edits are heard live. Instruments are
  simple oscillators and noise, so use it for harmony, pacing and balance, not
  timbre.
- **Render.** Runs compose in a subprocess, one at a time, with the log
  streamed into the page:
  - *Audition one loop*: a single pad (chord), air or arp loop through Surge,
    raw and before mastering, in a few seconds →
    `compose/<slug>/audition/`.
  - *Build + preview*: the real pipeline, `compose.build` (render, master,
    encode, manifest, QA) into `generation/output/packs/deepwave.<slug>/`, then
    `compose.preview` → `compose/<slug>/` (`mix.wav`, `mix_open.wav`,
    `mix_shipped.wav`, `stems/`, `layers/`, `preview.json`), plus the QA verdict
    (`qa.json`) and the program it was rendered from (`program.json`).
- **Listen.** Players for the mixes, every stem (with its in-mix LUFS) and loop,
  with a warning when the program has changed since that render.
- **Save / Download / Import / Duplicate.** Save writes `programs/<slug>.json`
  (⌘S). Saving under a built-in theme's slug keeps your edit as a program and
  leaves `themes.py` unchanged, but rendering it rebuilds `deepwave.<slug>`
  from your edit: duplicate first to keep both.

Porting stays manual and gated on the listening sign-off, as in HANDOVER: after
*Build + preview* the pack is in `output/packs/`, and
`publish_to_app.py deepwave.<slug>` ships it.

## Files

| | |
|---|---|
| `server.py` | stdlib HTTP server + JSON API, job runner |
| `render_job.py` | one render (subprocess): `full`, or a single `pad`/`air`/`arp` loop |
| `program.py` | program format: `from_theme`, `to_theme`, `validate` |
| `web/` | the UI (no build step): `app.js` editor, `sketch.js` Web Audio sketch, `music.js` note names |
| `test_studio.py` | round-trips every built-in theme, validation, API (`python -m pytest studio/`) |

API: `GET /api/env`, `GET /api/programs`, `GET|PUT /api/programs/<slug>`
(`?source=builtin` to read a theme), `POST /api/validate`, `POST /api/jobs`
`{program, kind: full|pad|air|arp, index, minutes}`, `GET /api/jobs/<id>`,
`DELETE /api/jobs/<id>` (cancel), `GET /api/renders/<slug>`, `GET /renders/<slug>/<file>`.
