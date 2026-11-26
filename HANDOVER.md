# Handover — sound design workflow

**Date:** 2026-11-25. **Owner:** aljaz@kundi.si.

This repo is the **sound lab**. New sounds are made and judged here first, as a
full mix *and* as separate layers. Only sounds approved here are ported to the
mobile app (Deepwave, `~/code/mobile/soundfocus-app`).

> **Rule: no audio in git**, in this repo or the app repo. `.gitignore` covers
> wav/aif/flac/mp3. Audio lives on disk; code, sessions and docs are committed.

---

## 1. The workflow

```
1. design / edit a theme      soundfocus-app/generation/compose/themes.py
2. render the pack            compose.build <theme>      → generation/output/packs/deepwave.<theme>/
3. render the audition HERE   compose.preview <theme>    → ~/code/experiments/soundcraft/compose/<theme>/
4. listen: mix first, then each stem (headphones + phone speaker, session volume)
5. iterate 1–4 until it's good
6. port to the app            publish_to_app.py deepwave.<theme>   (only after approval)
```

Steps 1–5 can also run from the browser: **SoundCraft Studio** (`studio/`,
`…/generation/.venv/bin/python studio/server.py`) edits a theme as a program,
sketches it live, runs build + preview, plays the mix and stems, and saves the
recipe to `programs/<slug>.json`. Porting (step 6) stays a manual command.

Step 3 writes, per theme:

| File | What |
|---|---|
| `mix.wav` | all layers together, the way the app plays them (6 min default) |
| `stems/pads.wav`, `air.wav`, `texture.wav`, `events.wav`, `drone.wav` | each layer alone at its in-mix level; the stems sum to the mix |
| `layers/*.wav` | every individual loop in the pack (4 pads, 2 airs, texture) |
| `preview.json` | the settings used (global low-pass, depth, arc setpoints, stem loudness) |

The preview reads the **built pack**, so what you approve is what ships. It
approximates: the app's drone synth (plain harmonic synth from the manifest),
engine reverb, gain LFOs and arc movement over time (it uses the arc's
"maintain" settings); binaural is skipped.

### Commands

```sh
cd ~/code/mobile/soundfocus-app/generation
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r compose/requirements.txt   # once
.venv/bin/python -m compose.build --list
.venv/bin/python -m compose.build deep_ocean                   # render + master + QA → output/packs/
.venv/bin/python -m compose.preview deep_ocean                 # → ~/code/experiments/soundcraft/compose/deep_ocean/
.venv/bin/python -m compose.preview deep_ocean --minutes 15    # longer audition
open ~/code/experiments/soundcraft/compose/deep_ocean

# after approval only:
(cd ../flutter && dart run bin/dwpack.dart validate ../generation/output/packs/deepwave.deep_ocean/1.0.0/pack.json)
.venv/bin/python publish_to_app.py deepwave.deep_ocean
```

Needs **Surge XT** (VST3) and ffmpeg. Serum is optional (see §4).

---

## 2. Where things are

| Path | What |
|---|---|
| `soundfocus-app/generation/compose/` | the renderer: `themes.py` (data), `render.py`, `dsp.py`, `proc.py` (bowls, wind, leaves, crystal), `surge.py` (Surge/Serum hosting), `arcs.py`, `build.py`, `preview.py`, README |
| `soundfocus-app/docs/COMPOSE_PACKS_PLAN.md` | status, design decisions, remote-pack plan |
| `soundfocus-app/generation/output/packs/` | built packs (git-ignored) |
| `soundfocus-app/flutter/assets/audio/generated/` | ported audio the app loads (git-ignored) |
| this repo `v1/ v2/ v3/` | the early SoundCraft sessions (meditative pad, layered pad, Tibetan bowls v3) |
| this repo `scripts/` | SoundCraft control-server client (`sc.py`), early render/build scripts, `bowls.py` |
| this repo `compose/<theme>/` | auditions from `compose.preview` (audio git-ignored) |
| this repo `studio/`, `programs/` | Studio browser UI; saved soundscape programs (`programs/README.md`) |

Repos: `github.com/introvert/soundcraft` (this) and
`github.com/introvert/soundfocus-app` (branch `compose-theme-packs`).

---

## 3. Current state (ten packs)

Tibetan Bowls, Deep Ocean, Northern Lights, Focus Flow, Forest Canopy, Desert
Night, Cathedral Choir, Deep Space, Sunrise, Crystal Caves. Each is
4 × 45 s one-chord pad variants (body + halo patch), 2 × 30 s air variants,
optional texture, events (bowls/gong), authored session arc, binaural on
focus/sleep. All pass yt2pack QA with no warnings and `dwpack validate`.
Details and the reasoning: `COMPOSE_PACKS_PLAN.md`.

An **earlier** version of the ten was ported to the app before this workflow
existed. The current builds (textures, session arcs, binaural, rebalanced gains)
are **not** ported — audition each here, then port the ones you sign off.

---

## 4. Things that will bite you

- **pedalboard MIDI `time` is absolute seconds**, not deltas.
- **Judge balance from the preview, not the assets.** Assets are mastered to
  −18 LUFS each, but the app's drone and per-layer gains decide the mix. The
  preview transcribes the engine's gain chain; `preview.json → stemLufs` is the
  real balance. Recipe gains live in `build.py` (`PAD_GAIN`, `AIR_GAIN`) and
  `themes.py` (`drone_gain`, texture gain).
- **Surge patches throb** at their default 1 Hz LFO rate — `surge.ambientize()`
  fixes it on load; new patches still need QA's beat check (swap the patch if it
  warns).
- **Don't re-attack held chords at the loop point** — pads are cut from a held
  performance (`render._held_loop`).
- **Engine filters are strict:** the app's global low-pass is
  `400 + (1−depth)·brightness·7600` Hz. `arcs.py` sets depth per theme; check
  `preview.json → globalLowPassHz` when a pack sounds dull.
- **Events jitter ±1 semitone** — only inharmonic sounds (bowls, gong, tingsha)
  go in events; pitched bells stay baked.
- **Serum presets load** (`serum:Pads/<name>` as a patch) and sound better than
  Surge factory pads, but **check Xfer's preset licence** before shipping renders.
- **SoundCraft 0.6.1 can't play third-party instruments** (VST3/CLAP load
  silent); effects work. That's why rendering happens in pedalboard, not SoundCraft.

## 5. Open decisions

1. Listening sign-off on the ten packs (this workflow).
2. Ship from bundle vs remote (plan §5 recommends 2–3 bundled flagships + remote).
3. Serum licence position.
4. Audit/replace the 14 YouTube-derived yt2pack packs before release.
