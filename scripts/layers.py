import json, socket, sys
def x(cmd, p):
    s = socket.create_connection(("127.0.0.1", 47123), timeout=120)
    s.sendall((json.dumps({"id": 1, "method": "engine.execute", "params": {"command": cmd, "params": p}}) + "\n").encode())
    buf = b""
    while not buf.endswith(b"\n"):
        c = s.recv(65536)
        if not c: break
        buf += c
    r = json.loads(buf)
    if not r.get("ok"): sys.exit(f"FAILED {cmd} {p} -> {r}")
    return r["result"]
sec = lambda s: {"seconds": s}
BEAT = 960
PAD = 1
x("transport.stop", {})

def new_track(kind, name, **kw):
    return x("track.new", {"kind": kind, "format": "stereo", "name": name, **kw})["tracks"][0]
def synth(t, **params):
    for k, v in params.items(): x("mix.instrument_param", {"track": t, "param": k, "value": v})
def clip(t):
    return x("midi.new_clip", {"track": t, "start": 0, "length": sec(64)})["clip"]
def note(c, p, start, length, vel):
    x("midi.note_add", {"clip": c, "pitch": p, "start_ticks": int(start * BEAT), "length_ticks": int(length * BEAT), "velocity": vel})
def curve(t, param, pts):
    for at, v in pts: x("automation.set_point", {"track": t, "param": param, "at": sec(at), "value": v})

# --- shimmer bus: octave-up, huge reverb ---
x("mix.new_bus", {"name": "Shimmer"})
SH = new_track("aux", "Shimmer")
x("track.input", {"tracks": [SH], "input": "Shimmer"})
x("mix.insert", {"track": SH, "slot": 0, "plugin": "pitch_shifter", "params": {"semitones": 12, "mix": 100}})
x("mix.insert", {"track": SH, "slot": 1, "plugin": "plate_reverb", "params": {"mix": 100, "pre_delay": 120, "decay": 18, "size": 100, "damping": 7000, "diffusion": 100, "low_cut": 600}})
x("mix.insert", {"track": SH, "slot": 2, "plugin": "chorus", "params": {"rate": 0.07, "depth": 60, "mix": 50}})
x("mix.volume", {"tracks": [SH], "db": -9})

# --- pad: slow filter breathing + shimmer send ---
x("mix.insert", {"track": PAD, "slot": 3, "plugin": "eq_1band", "params": {"type": 4, "freq": 1500, "q": 0.8}})
curve(PAD, "plugin:d:freq", [(0, 700), (14, 3500), (24, 1400), (40, 5000), (52, 1800), (63.9, 800)])
x("mix.send", {"track": PAD, "slot": 0, "bus": "Shimmer", "level_db": -6})

# --- sub: sine roots, saturated ---
SUB = new_track("instrument", "Sub")
synth(SUB, osc1_wave=2, osc2_wave=3, osc2_semitones=12, osc2_detune=3, osc_mix=20, cutoff=400, resonance=0,
      filter_env_amount=0, amp_attack=4000, amp_decay=1000, amp_sustain=100, amp_release=5000, velocity=10, level=-3)
c = clip(SUB)
for i, p in enumerate([38, 34, 29, 36]):
    note(c, p, i * 16, 16.5, 80)
x("mix.insert", {"track": SUB, "slot": 0, "plugin": "saturator", "params": {"drive": 9, "tone": 2500, "mix": 60, "output": -4}})
x("mix.volume", {"tracks": [SUB], "db": -3})

# --- glass bells: sparse pentatonic, octave+fifth partial, delay + pan drift ---
BELL = new_track("instrument", "Glass Bells")
synth(BELL, osc1_wave=2, osc2_wave=3, osc2_semitones=19, osc2_detune=4, osc_mix=30, cutoff=6000, resonance=5,
      filter_env_amount=40, amp_attack=3, amp_decay=2800, amp_sustain=0, amp_release=3500,
      filter_attack=2, filter_decay=900, filter_sustain=10, filter_release=2000, velocity=80, level=-8)
c = clip(BELL)
tones = [[74, 81, 76, 69, 86, 79], [77, 81, 74, 76, 86, 72], [72, 76, 79, 81, 84, 88], [79, 74, 76, 81, 72, 86]]
times = [1.0, 3.5, 6.25, 7.75, 10.5, 13.0]
vels = [62, 48, 70, 44, 58, 40]
for seg, ts in enumerate(tones):
    for k, (t, p) in enumerate(zip(times, ts)):
        if seg == 0 and k < 2: continue          # let the pad open alone first
        note(c, p, seg * 16 + t + (seg % 2) * 0.5, 2.5, vels[(k + seg) % 6])
x("mix.insert", {"track": BELL, "slot": 0, "plugin": "mod_delay", "params": {"time": 1125, "feedback": 55, "mix": 38, "mod_rate": 0.3, "mod_depth": 15, "lpf": 5000}})
x("mix.insert", {"track": BELL, "slot": 1, "plugin": "plate_reverb", "params": {"mix": 50, "pre_delay": 40, "decay": 8, "size": 85, "damping": 8000}})
x("mix.send", {"track": BELL, "slot": 0, "bus": "Shimmer", "level_db": -4})
x("mix.volume", {"tracks": [BELL], "db": -6})
curve(BELL, "pan", [(0, -0.6), (16, 0.6), (32, -0.5), (48, 0.6), (63.9, -0.6)])

# --- wind: pink noise, sweeping band-pass, phaser, swells ---
WIND = new_track("aux", "Wind")
x("mix.insert", {"track": WIND, "slot": 0, "plugin": "signal_generator", "params": {"waveform": 5, "level": -18}})
x("mix.insert", {"track": WIND, "slot": 1, "plugin": "eq_1band", "params": {"type": 6, "freq": 600, "q": 3}})
x("mix.insert", {"track": WIND, "slot": 2, "plugin": "phaser", "params": {"rate": 0.08, "depth": 80, "stages": 3, "feedback": 50, "center": 900, "mix": 50}})
x("mix.insert", {"track": WIND, "slot": 3, "plugin": "room_reverb", "params": {"mix": 60, "decay": 6, "size": 90, "damping": 4000, "low_cut": 200}})
curve(WIND, "plugin:b:freq", [(0, 350), (9, 1600), (17, 500), (27, 2600), (36, 700), (46, 1900), (55, 400), (63.9, 350)])
curve(WIND, "volume", [(0, -40), (10, -16), (20, -26), (30, -13), (40, -24), (50, -15), (63.9, -40)])

x("session.save", {})
for t in x("session.inspect", {"detail": "full"})["tracks"]:
    print(t["id"], t["kind"], t["name"], "inserts:", [i["plugin"] for i in t.get("inserts", [])], "sends:", [s.get("bus") for s in t.get("sends", [])], "auto:", [a.get("param") for a in t.get("automation", [])])
