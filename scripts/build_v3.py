"""Build v3 'Tibetan bowls' session from the v3 renders: reverb space, shimmer, wind, balance, export."""
import os
from sc import x
V3 = "/Users/afx/code/experiments/soundcraft/v3/"
LOOP = 96
sec = lambda v: {"seconds": v}

x("transport.stop")
x("session.new", {"name": "Tibetan Bowls", "sample_rate": 48000})
x("session.save_as", {"path": V3 + "Tibetan Bowls v3.scraft"})

t = {}
for n in ["v3 Bowls Struck", "v3 Bowls Singing", "v3 Tingsha", "v3 Drone"]:
    t[n] = x("file.import_audio", {"path": V3 + "audio/" + n + ".wav", "at": 0, "new_tracks": True})["imported"][0]["track"]
ST, SI, TI, DR = t.values()

# shimmer: octave-up halo, fed lightly so the bowls bloom upward
x("mix.new_bus", {"name": "Shimmer"})
SH = x("track.new", {"kind": "aux", "format": "stereo", "name": "Shimmer"})["tracks"][0]
x("track.input", {"tracks": [SH], "input": "Shimmer"})
x("mix.insert", {"track": SH, "slot": 0, "plugin": "pitch_shifter", "params": {"semitones": 12, "mix": 100}})
x("mix.insert", {"track": SH, "slot": 1, "plugin": "plate_reverb", "params": {"mix": 100, "pre_delay": 150, "decay": 20, "size": 100, "damping": 6000, "diffusion": 100, "low_cut": 700}})

# temple space: shared stone-room reverb bus
x("mix.new_bus", {"name": "Temple"})
TE = x("track.new", {"kind": "aux", "format": "stereo", "name": "Temple"})["tracks"][0]
x("track.input", {"tracks": [TE], "input": "Temple"})
x("mix.insert", {"track": TE, "slot": 0, "plugin": "room_reverb", "params": {"mix": 100, "pre_delay": 35, "decay": 7, "size": 95, "damping": 5000, "diffusion": 90, "low_cut": 180}})
x("mix.insert", {"track": TE, "slot": 1, "plugin": "plate_reverb", "params": {"mix": 40, "pre_delay": 0, "decay": 11, "size": 100, "damping": 7000, "low_cut": 250}})

x("mix.insert", {"track": ST, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 60, "low_mid_freq": 250, "low_mid_gain": -2}})
x("mix.send", {"track": ST, "slot": 0, "bus": "Temple", "level_db": -4})
x("mix.send", {"track": ST, "slot": 1, "bus": "Shimmer", "level_db": -14})

x("mix.send", {"track": SI, "slot": 0, "bus": "Temple", "level_db": -7})
x("mix.send", {"track": SI, "slot": 1, "bus": "Shimmer", "level_db": -10})

x("mix.insert", {"track": TI, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 900, "hpf_slope": 2}})
x("mix.send", {"track": TI, "slot": 0, "bus": "Temple", "level_db": -2})

x("mix.insert", {"track": DR, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 35, "low_mid_freq": 220, "low_mid_gain": -3, "high_shelf_freq": 3000, "high_shelf_gain": -6}})
x("mix.insert", {"track": DR, "slot": 1, "plugin": "chorus", "params": {"rate": 0.06, "depth": 30, "mix": 25}})
x("mix.send", {"track": DR, "slot": 0, "bus": "Temple", "level_db": -12})

# wind through the temple doors: pink noise, slow band-pass sweep, long gusts
WI = x("track.new", {"kind": "aux", "format": "stereo", "name": "Wind"})["tracks"][0]
x("mix.insert", {"track": WI, "slot": 0, "plugin": "signal_generator", "params": {"waveform": 5, "level": 0}})
x("mix.insert", {"track": WI, "slot": 1, "plugin": "eq_1band", "params": {"type": 6, "freq": 500, "q": 1.2}})
x("mix.insert", {"track": WI, "slot": 2, "plugin": "phaser", "params": {"rate": 0.05, "depth": 70, "stages": 3, "feedback": 40, "center": 700, "mix": 40}})
x("mix.send", {"track": WI, "slot": 0, "bus": "Temple", "level_db": -6})
for at, v in [(0, 300), (14, 1100), (30, 450), (47, 1500), (63, 380), (80, 1200), (95.9, 300)]:
    x("automation.set_point", {"track": WI, "param": "plugin:b:freq", "at": sec(at), "value": v})
for at, v in [(0, -20), (15, -6), (30, -16), (48, -4), (64, -15), (80, -7), (95.9, -20)]:
    x("automation.set_point", {"track": WI, "param": "volume", "at": sec(at), "value": v})

# balance each source (dry + its sends) by measured loudness
probe = V3 + "probe.wav"
def lufs():
    r = x("file.bounce_mix", {"path": probe, "format": "wav", "start": 0, "end": sec(LOOP)}); return r["lufs"]
targets = {ST: -21, SI: -23, DR: -27, TI: -30, WI: -36}
vol = {tr["id"]: tr["volume_db"] for tr in x("session.inspect", {"detail": "full"})["tracks"]}
for tr, tgt in targets.items():
    x("mix.solo", {"tracks": [tr, SH, TE], "value": True, "exclusive": True})
    l = lufs(); new = max(-30, min(12, vol[tr] + tgt - l))
    x("mix.volume", {"tracks": [tr], "db": round(new, 1)})
    print(f"track {tr:2d}: {l:6.1f} LUFS → fader {new:5.1f} dB (target {tgt})")
x("mix.clear_solos")
os.remove(probe)

r = x("file.bounce_mix", {"path": V3 + "tibetan_bowls_v3_loop.wav", "format": "wav", "bit_depth": "32f", "start": 0, "end": sec(LOOP), "dither": False})
print(f"mix: {r['lufs']:.1f} LUFS, peak {r['peak_db']:.1f} dB, {r['seconds']:.0f}s")
print(x("session.save"))
x("options.loop_playback", {"value": True})
x("transport.play", {"from": 0})
