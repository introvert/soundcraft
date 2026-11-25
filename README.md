# SoundCraft experiments

Ambient/meditative pieces built by driving [SoundCraft](https://storyteller.ai) (Storyteller's DAW) from scripts through its local control server.

## Driving SoundCraft

Start it with the control server enabled:

```sh
SOUNDCRAFT_CONTROL_PORT=47124 /Applications/SoundCraft.app/Contents/MacOS/SoundCraft --control
```

It speaks newline-delimited JSON on `127.0.0.1:<port>`: `{"id", "method", "params"}` → `{"id", "ok", "result" | "error"}`.
`session.inspect` works as a method directly; every menu command runs through `engine.execute`:

```sh
python3 scripts/sc.py engine.commands '{}'          # all ~530 commands with their params
python3 scripts/sc.py track.new '{"kind":"instrument","name":"Pad"}'
```

Notes from 0.6.1:
- Positions accept samples or `{"seconds": n}`; MIDI is 960 ticks per quarter note.
- Third-party **effects** (VST3/CLAP) process fine, but third-party **instruments** load and stay silent, so plugin synths are rendered outside SoundCraft (below) and imported as audio.
- Plugin state can be written (`mix.insert_state`) but not read.

## Rendering Surge XT patches

`scripts/render*.py` use Spotify's [pedalboard](https://github.com/spotify/pedalboard) to host Surge XT, load factory `.fxp` patches
(`jucestate.py` wraps the patch chunk in the JUCE VST3 state format) and render MIDI to WAV loops, with the release tail wrapped onto the start so they loop seamlessly.

```sh
python3 -m venv .venv && .venv/bin/pip install pedalboard mido numpy soundfile
```

## Versions

| | Session | Sound |
|---|---|---|
| v1 | `v1/Meditative Pad.scraft` | built-in synth pad → layered → Surge (MKS-70 / Growth / Distant) |
| v2 | `v2/Meditative Pad v2.scraft` | Surge Utopia / Smooth Chorus / Planetarium / Sorrowful, wider voicings |

All pieces: D → B♭ → F → C at 60 BPM, 64 s loops, plus sub, glass bells, wind and an octave-up shimmer reverb bus.
Audio (renders, mixes, stems, session audio) is not committed; re-render with the scripts.
