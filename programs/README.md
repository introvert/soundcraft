# Soundscape programs

A **program** is the saved recipe for one soundscape: everything `compose`
needs to render it (key, four chords, instruments, air, bands, reverb, texture,
events, arp). Programs are written by the Studio (`studio/`), one file per
soundscape: `programs/<slug>.json`. They are small text files, so they are
committed; the audio they render is not.

```
programs/<slug>.json ──Studio "Build + preview"──▶ compose.build ──▶ deepwave.<slug>/1.0.0/pack.json + OGGs
                                                                     │
                                                       publish_to_app.py (after sign-off)
                                                                     ▼
                                                     soundfocus-app (bundled pack)
```

**How the app uses it.** The app doesn't read programs directly. It plays the
**pack** a program renders into (`pack.json` + audio, AUDIO_PACK_SPEC), which
`publish_to_app.py` installs unchanged. The program is the editable source of
that pack, the same role `compose/themes.py` plays for the built-in themes, and
it converts to and from a compose `Theme` losslessly (every built-in theme
round-trips; `studio/test_studio.py`). Field names are camelCase, like
`pack.json`, and `events` uses the pack's own event shape, so it is copied into
the manifest verbatim.

Not to be confused with the pack's `programs` block (the session arc: phases
of brightness, reverb and crossfade over a session). That is derived at build
time from the program's `category` (`compose/arcs.py`).

## Format (`soundcraft.soundscape`, version 1)

```jsonc
{
  "format": "soundcraft.soundscape",
  "version": 1,
  "slug": "deep_ocean",                 // → pack id deepwave.<slug>, file name
  "name": "Deep Ocean",
  "category": "sleep",                  // focus|calm|sleep|energy|explore|nature|meditate: arc, binaural, duration
  "color": "0C1E30",                    // mood colour (cover / visuals)
  "description": "Slow, dark swells far below the surface…",
  "tags": ["underwater", "dark"],

  "key": { "tonic": 9, "mode": "minor" },   // tonic pitch class (C=0): the engine drone's root

  // Four chords = the four 45 s pad variants, played in order (~70 s crossfades).
  // MIDI notes, low to high. `top`: a two-step melody (first half, second half) or null.
  "chords": [
    { "notes": [45, 52, 57, 59, 60], "top": [64, 62] },
    { "notes": [41, 48, 57, 60, 64], "top": [67, 65] },
    { "notes": [43, 50, 55, 59, 64], "top": [67, 62] },
    { "notes": [40, 47, 55, 59, 62], "top": [66, 64] }
  ],

  // Surge XT patches, relative to the Surge data dir, no .fxp.
  // body voices the full chord; halo the upper voices, ~7 dB under; they swap per chord.
  "instruments": { "body": "patches_factory/Pads/MKS-70 Warm Pad", "halo": "patches_3rdparty/Cybersoda/Pads/Origin" },

  // Air (two 30 s variants): a Surge patch over tones consonant with all four chords,
  // or a procedural kind: {"proc": "leaves" | "desert_wind" | "high_bowls"} or {"proc": "crystal", "tones": [...]}
  "air": { "surge": "patches_3rdparty/Jacky Ligon/Pads/Planetarium", "tones": [76, 79, 81, 83, 88] },

  "bands": { "padLowPassHz": 5000, "airHighPassHz": 1500 },   // engine filters on the pad / air layers
  "breathDb": 8,                         // high-shelf dip once per loop
  "reverb": { "rt60Sec": 7.0, "wet": 0.42 },
  "droneGain": 0.6,                      // engine drone under the pads

  "texture": { "preset": "surf", "gain": 0.32 },   // or null. texture_synth presets + murmur|city|cafe|night_street

  // Pack events, AUDIO_PACK_SPEC §5.13 (struck resonators; the engine humanises pan, level, ±1 st).
  "events": {
    "gong": { "kind": "interval", "asset": "synth:gong:65", "everySec": 173, "gain": 0.28,
              "activeWhen": { "fromRatio": 0.12, "toRatio": 0.88 } }
  },

  // Optional arpeggiator layer (four variants by pattern and register), or null.
  "arp": {
    "patch": "patches_factory/Plucks/Half FM", "bpm": 118, "division": 4, "bars": 16,
    "tones": [64, 66, 67, 71, 74, 76],
    "gate": 0.4, "rest": 0.45, "gain": 0.6,
    "filter": [500.0, 4500.0, 0.35],     // low Hz, high Hz, resonance 0–1
    "echo": [0.75, 0.3, 0.2],            // beats, feedback, mix
    "phaser": [2, 0.4, 0.25],            // optional: cycles per loop, depth, mix
    "sweeps": 2,                         // filter sweeps per loop
    "steps": "random",                   // omit: up/down/broken patterns; "random"; or [[tone index | null, …], …] per variant
    "cutoffSteps": "random",             // optional: "random" or [0–1 accent per step]
    "lfoDepth": 0.4,
    "octaves": false                     // omit to shift variants 2 and 4 by ±1 octave
  },

  // Optional procedural additions per pad variant: a rubbed bowl [MIDI, start s, length s, level].
  "extras": { "pad1": { "sing": [[57, 4.0, 26.0, 1.0]] } }
}
```

Validation (ranges, note numbers, known kinds) lives in `studio/program.py`
(`validate`), shared by the Studio UI and server.
