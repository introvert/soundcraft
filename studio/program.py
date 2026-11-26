"""Soundscape programs: the saved recipe for one soundscape, as JSON.

A program is everything `compose` needs to render a theme pack (key, four
chords, instruments, air, bands, reverb, texture, events, arp), in a
JSON-friendly, camelCase shape that sits next to the app's `pack.json`. It is
the source the Studio edits and saves to `programs/<slug>.json`; `compose`
renders it into `deepwave.<slug>` and `publish_to_app.py` ports that pack to
the app. Format reference: programs/README.md.

This module is stdlib-only apart from `compose.themes` (itself stdlib-only), so
the Studio server can validate and convert without the audio stack loaded.
"""
from __future__ import annotations

import re
from typing import Any

FORMAT, VERSION = "soundcraft.soundscape", 1

CATEGORIES = ("focus", "calm", "sleep", "energy", "explore", "nature", "meditate")
AIR_PROCS = ("leaves", "desert_wind", "crystal", "high_bowls")   # compose.render.render_air
EVENT_SYNTHS = ("bowl", "bell", "gong")                           # synth_engine struck resonators
SCAPES = ("murmur", "city", "cafe", "night_street")              # compose.build._texture extras
SLUG = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
HEX = re.compile(r"^[0-9A-Fa-f]{6}$")
_SYNTH_ASSET = re.compile(r"^synth:(bowl|bell|gong):(\d+(?:\.\d+)?)$")

# arp keys: compose uses snake_case, the program camelCase
_ARP_KEYS = {"cutoff_steps": "cutoffSteps", "lfo_depth": "lfoDepth"}
_ARP_TUPLES = ("filter", "echo", "phaser")


class ProgramError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


# ── Theme → program ────────────────────────────────────────────────────────────

def from_theme(theme) -> dict:
    """A compose `Theme` as a program dict (lossless: `to_theme` gives it back)."""
    pc, mode = theme.key
    prog: dict[str, Any] = {
        "format": FORMAT, "version": VERSION,
        "slug": theme.slug, "name": theme.name, "category": theme.category,
        "color": theme.color, "description": theme.description, "tags": list(theme.tags),
        "key": {"tonic": pc, "mode": mode},
        "chords": [{"notes": list(c.notes), "top": list(c.top) if c.top else None} for c in theme.chords],
        "instruments": {"body": theme.body, "halo": theme.halo},
        "air": _jsonable(theme.air),
        "bands": {"padLowPassHz": theme.pad_lp, "airHighPassHz": theme.air_hp},
        "breathDb": theme.breath_db,
        "reverb": {"rt60Sec": theme.reverb[0], "wet": theme.reverb[1]},
        "droneGain": theme.drone_gain,
        "texture": {"preset": theme.texture[0], "gain": theme.texture[1]} if theme.texture else None,
        "events": _jsonable(theme.events),
        "arp": {_ARP_KEYS.get(k, k): _jsonable(v) for k, v in theme.arp.items()} if theme.arp else None,
        "extras": _jsonable(theme.extras),
    }
    return prog


def _jsonable(x):
    if isinstance(x, dict):
        return {k: _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]
    return x


# ── program → Theme ────────────────────────────────────────────────────────────

def to_theme(prog: dict):
    """Validate a program and build the compose `Theme` it describes."""
    from compose.themes import Chord, Theme             # generation/ must be on sys.path

    errors = validate(prog)
    if errors:
        raise ProgramError(errors)
    arp = None
    if prog.get("arp"):
        inv = {v: k for k, v in _ARP_KEYS.items()}
        arp = {inv.get(k, k): (tuple(v) if k in _ARP_TUPLES else v) for k, v in prog["arp"].items()}
    extras = {pad: {kind: [tuple(item) for item in items] for kind, items in spec.items()}
              for pad, spec in (prog.get("extras") or {}).items()}
    tex = prog.get("texture")
    return Theme(
        slug=prog["slug"], name=prog["name"], category=prog["category"], color=prog["color"].upper(),
        description=prog.get("description", ""), tags=tuple(prog.get("tags", ())),
        chords=tuple(Chord(tuple(c["notes"]), tuple(c["top"]) if c.get("top") else None)
                     for c in prog["chords"]),
        body=prog["instruments"]["body"], halo=prog["instruments"]["halo"],
        air=dict(prog["air"]),
        key=(prog["key"]["tonic"], prog["key"]["mode"]),
        pad_lp=prog["bands"]["padLowPassHz"], air_hp=prog["bands"]["airHighPassHz"],
        breath_db=prog.get("breathDb", 5.0),
        reverb=(prog["reverb"]["rt60Sec"], prog["reverb"]["wet"]),
        extras=extras, events=dict(prog.get("events") or {}),
        texture=(tex["preset"], tex["gain"]) if tex else None,
        arp=arp, drone_gain=prog.get("droneGain", 0.6),
    )


# ── validation ─────────────────────────────────────────────────────────────────

def _num(errors, where, v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        errors.append(f"{where}: expected a number")
    elif not lo <= v <= hi:
        errors.append(f"{where}: {v} is outside {lo}–{hi}")


def _midi(errors, where, v):
    if isinstance(v, bool) or not isinstance(v, int) or not 12 <= v <= 115:
        errors.append(f"{where}: expected a MIDI note 12–115, got {v!r}")


def validate(prog: Any, textures: set[str] | None = None) -> list[str]:
    """Every problem with a program, as readable strings (empty list = valid).
    `textures`: the texture presets known on this machine, if checked."""
    e: list[str] = []
    if not isinstance(prog, dict):
        return ["program must be a JSON object"]
    if prog.get("format") != FORMAT:
        e.append(f"format: expected {FORMAT!r}")
    if prog.get("version") != VERSION:
        e.append(f"version: expected {VERSION}")
    if not isinstance(prog.get("slug"), str) or not SLUG.match(prog["slug"]):
        e.append("slug: lowercase letters, digits and _, starting with a letter (2–48 chars)")
    if not isinstance(prog.get("name"), str) or not prog["name"].strip():
        e.append("name: required")
    if prog.get("category") not in CATEGORIES:
        e.append(f"category: one of {', '.join(CATEGORIES)}")
    if not isinstance(prog.get("color"), str) or not HEX.match(prog["color"]):
        e.append("color: six hex digits, e.g. 0C1E30")
    if not isinstance(prog.get("tags", []), list) or not all(isinstance(t, str) for t in prog.get("tags", [])):
        e.append("tags: a list of strings")

    key = prog.get("key")
    if not isinstance(key, dict) or not isinstance(key.get("tonic"), int) or not 0 <= key["tonic"] <= 11 \
            or key.get("mode") not in ("major", "minor"):
        e.append("key: {tonic: 0–11 (C=0), mode: major|minor}")

    chords = prog.get("chords")
    if not isinstance(chords, list) or len(chords) != 4:
        e.append("chords: exactly four chords (one per pad variant)")
    else:
        for i, c in enumerate(chords, 1):
            notes = c.get("notes") if isinstance(c, dict) else None
            if not isinstance(notes, list) or not 2 <= len(notes) <= 8:
                e.append(f"chords[{i}].notes: 2–8 MIDI notes")
                continue
            for n in notes:
                _midi(e, f"chords[{i}].notes", n)
            top = c.get("top")
            if top is not None:
                if not isinstance(top, list) or len(top) != 2:
                    e.append(f"chords[{i}].top: two notes (first half, second half) or null")
                else:
                    for n in top:
                        _midi(e, f"chords[{i}].top", n)

    inst = prog.get("instruments")
    if not isinstance(inst, dict) or not all(isinstance(inst.get(k), str) and inst[k] for k in ("body", "halo")):
        e.append("instruments: {body, halo} Surge patch paths")

    air = prog.get("air")
    if not isinstance(air, dict):
        e.append("air: {surge, tones} or {proc}")
    elif "surge" in air:
        if not isinstance(air["surge"], str) or not air["surge"]:
            e.append("air.surge: a Surge patch path")
        if not isinstance(air.get("tones"), list) or not air["tones"]:
            e.append("air.tones: at least one MIDI note")
        else:
            for n in air["tones"]:
                _midi(e, "air.tones", n)
    elif air.get("proc") in AIR_PROCS:
        if air["proc"] == "crystal":
            if not isinstance(air.get("tones"), list) or not air["tones"]:
                e.append("air.tones: crystal drips need at least one MIDI note")
            else:
                for n in air["tones"]:
                    _midi(e, "air.tones", n)
    else:
        e.append(f"air: needs `surge` (a patch) or `proc` (one of {', '.join(AIR_PROCS)})")

    bands = prog.get("bands")
    if not isinstance(bands, dict):
        e.append("bands: {padLowPassHz, airHighPassHz}")
    else:
        _num(e, "bands.padLowPassHz", bands.get("padLowPassHz"), 200, 20000)
        _num(e, "bands.airHighPassHz", bands.get("airHighPassHz"), 20, 10000)
    _num(e, "breathDb", prog.get("breathDb", 5.0), 0, 24)
    rev = prog.get("reverb")
    if not isinstance(rev, dict):
        e.append("reverb: {rt60Sec, wet}")
    else:
        _num(e, "reverb.rt60Sec", rev.get("rt60Sec"), 0.2, 20)
        _num(e, "reverb.wet", rev.get("wet"), 0, 1)
    _num(e, "droneGain", prog.get("droneGain", 0.6), 0, 2)

    tex = prog.get("texture")
    if tex is not None:
        if not isinstance(tex, dict) or not isinstance(tex.get("preset"), str):
            e.append("texture: {preset, gain} or null")
        else:
            if textures is not None and tex["preset"] not in textures:
                e.append(f"texture.preset: unknown preset {tex['preset']!r}")
            _num(e, "texture.gain", tex.get("gain"), 0, 2)

    events = prog.get("events") or {}
    if not isinstance(events, dict):
        e.append("events: an object of named events")
    else:
        for name, ev in events.items():
            w = f"events.{name}"
            if not re.match(r"^[a-z][a-z0-9_]*$", name):
                e.append(f"{w}: event names are lowercase identifiers")
            if not isinstance(ev, dict) or ev.get("kind") != "interval":
                e.append(f"{w}: only kind 'interval' is rendered by compose")
                continue
            if not isinstance(ev.get("asset"), str) or not _SYNTH_ASSET.match(ev["asset"]):
                e.append(f"{w}.asset: synth:bowl|bell|gong:<hz>")
            _num(e, f"{w}.everySec", ev.get("everySec"), 5, 3600)
            _num(e, f"{w}.gain", ev.get("gain"), 0, 2)
            aw = ev.get("activeWhen", {"fromRatio": 0, "toRatio": 1})
            if not isinstance(aw, dict):
                e.append(f"{w}.activeWhen: {{fromRatio, toRatio}}")
            else:
                _num(e, f"{w}.activeWhen.fromRatio", aw.get("fromRatio"), 0, 1)
                _num(e, f"{w}.activeWhen.toRatio", aw.get("toRatio"), 0, 1)

    arp = prog.get("arp")
    if arp is not None:
        if not isinstance(arp, dict):
            e.append("arp: an object or null")
        else:
            if not isinstance(arp.get("patch"), str) or not arp["patch"]:
                e.append("arp.patch: a Surge patch path")
            _num(e, "arp.bpm", arp.get("bpm"), 20, 220)
            if arp.get("division") not in (1, 2, 3, 4, 6, 8):
                e.append("arp.division: steps per beat, one of 1, 2, 3, 4, 6, 8")
            if isinstance(arp.get("bars"), bool) or not isinstance(arp.get("bars"), int) or not 1 <= arp["bars"] <= 64:
                e.append("arp.bars: 1–64")
            if not isinstance(arp.get("tones"), list) or not arp["tones"]:
                e.append("arp.tones: at least one MIDI note")
            else:
                for n in arp["tones"]:
                    _midi(e, "arp.tones", n)
            _num(e, "arp.gate", arp.get("gate", 0.7), 0.05, 1)
            _num(e, "arp.rest", arp.get("rest", 0.0), 0, 0.95)
            _num(e, "arp.gain", arp.get("gain"), 0, 2)
            for k, n in (("filter", 3), ("echo", 3), ("phaser", 3)):
                v = arp.get(k)
                if v is None and k == "phaser":
                    continue
                if not isinstance(v, list) or len(v) != n or not all(isinstance(x, (int, float)) for x in v):
                    e.append(f"arp.{k}: {n} numbers")
            steps = arp.get("steps")
            if steps is not None and steps != "random" and not (
                    isinstance(steps, list) and steps and all(isinstance(s, list) for s in steps)):
                e.append("arp.steps: 'random', or a list of step patterns (tone index or null per step)")
            cs = arp.get("cutoffSteps")
            if cs is not None and cs != "random" and not (
                    isinstance(cs, list) and cs and all(isinstance(x, (int, float)) for x in cs)):
                e.append("arp.cutoffSteps: 'random' or a list of 0–1 accents")

    extras = prog.get("extras") or {}
    if not isinstance(extras, dict) or any(k not in ("pad1", "pad2", "pad3", "pad4") for k in extras):
        e.append("extras: keys pad1–pad4")
    else:
        for pad, spec in extras.items():
            for kind, items in (spec or {}).items():
                if kind != "sing" or not isinstance(items, list) or not all(
                        isinstance(i, list) and len(i) == 4 for i in items):
                    e.append(f"extras.{pad}: only `sing`: [[midi, atSec, durSec, level], …]")
    return e
