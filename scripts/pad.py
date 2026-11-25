import json, socket, sys
def call(method, params, _id=[0]):
    _id[0] += 1
    s = socket.create_connection(("127.0.0.1", 47123), timeout=5)
    s.sendall((json.dumps({"id": _id[0], "method": method, "params": params}) + "\n").encode())
    buf = b""
    while not buf.endswith(b"\n"):
        chunk = s.recv(65536)
        if not chunk: break
        buf += chunk
    s.close()
    r = json.loads(buf)
    if not r.get("ok"): sys.exit(f"{method} {params} -> {r}")
    return r["result"]
x = lambda cmd, p: call("engine.execute", {"command": cmd, "params": p})

T, CLIP = 1, 2
BEAT = 960; BAR = 4 * BEAT; SEG = 4 * BAR
# synth: warm detuned saw + triangle, slow swells, long release
for k, v in dict(osc1_wave=0, osc2_wave=3, osc2_semitones=12, osc2_detune=9, osc_mix=40,
                 cutoff=850, resonance=12, filter_env_amount=18,
                 amp_attack=3000, amp_decay=3000, amp_sustain=85, amp_release=7000,
                 filter_attack=4500, filter_decay=5000, filter_sustain=55, filter_release=7000,
                 velocity=35, level=-12).items():
    x("mix.instrument_param", {"track": T, "param": k, "value": v})

# Dsus2 -> Bbmaj7(#11) -> Fmaj9 -> C6/9, over a D drone
chords = [[50, 57, 64, 69], [46, 53, 57, 62, 64], [53, 60, 64, 67], [48, 55, 62, 64, 69]]
for i, ch in enumerate(chords):
    for j, p in enumerate(ch):
        x("midi.note_add", {"clip": CLIP, "pitch": p, "start_ticks": i * SEG + j * 120,
                            "length_ticks": SEG + BEAT, "velocity": 64 - j * 3})
x("midi.note_add", {"clip": CLIP, "pitch": 38, "start_ticks": 0, "length_ticks": 4 * SEG - 2 * BEAT, "velocity": 50})
# sparse high tones drifting over the top
for start, p, ln in [(6, 76, 7), (22, 81, 6), (38, 74, 8), (52, 72, 8)]:
    x("midi.note_add", {"clip": CLIP, "pitch": p, "start_ticks": start * BEAT, "length_ticks": ln * BEAT, "velocity": 40})

x("mix.insert", {"track": T, "slot": 0, "plugin": "chorus",
                 "params": {"rate": 0.12, "depth": 45, "delay": 14, "mix": 40, "spread": 100}})
x("mix.insert", {"track": T, "slot": 1, "plugin": "mod_delay",
                 "params": {"time": 750, "feedback": 45, "mix": 22, "mod_rate": 0.2, "mod_depth": 20, "lpf": 3500}})
x("mix.insert", {"track": T, "slot": 2, "plugin": "plate_reverb",
                 "params": {"mix": 55, "pre_delay": 60, "decay": 12, "size": 90, "damping": 5000, "diffusion": 95, "width": 100, "low_cut": 150}})
x("mix.volume", {"tracks": [T], "db": -4})
x("options.loop_playback", {"value": True})
print(x("midi.notes", {"clip": CLIP})["notes"].__len__(), "notes")
print(json.dumps(x("track.inspect", {"track": T})["inserts"]))
