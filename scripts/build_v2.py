"""Build v2: swap the v1 Surge layers for the v2 renders, process, balance and export."""
import sys
from sc import x
V2 = "/Users/afx/code/experiments/soundcraft/v2/"
sec = lambda v: {"seconds": v}

x("session.save_as", {"path": V2 + "Meditative Pad v2.scraft"})
x("mix.mute", {"tracks": [17, 20, 23], "value": True})          # v1 Surge layers kept for A/B
x("track.delete", {"tracks": [1]})                               # old built-in pad no longer needed

ids = {}
for n in ["v2 Body (Utopia)", "v2 Motion (Smooth Chorus)", "v2 Air (Planetarium)", "v2 Depth (Sorrowful)"]:
    ids[n] = x("file.import_audio", {"path": V2 + "audio/" + n + ".wav", "at": 0, "new_tracks": True})["imported"][0]["track"]
B, M, A, D = ids.values()

x("mix.insert", {"track": B, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 90, "low_mid_freq": 280, "low_mid_gain": -3, "low_mid_q": 0.8, "high_shelf_freq": 11000, "high_shelf_gain": 2}})
x("mix.insert", {"track": B, "slot": 1, "plugin": "chorus", "params": {"rate": 0.09, "depth": 35, "delay": 18, "mix": 25, "spread": 100}})
x("mix.insert", {"track": B, "slot": 2, "plugin": "plate_reverb", "params": {"mix": 28, "pre_delay": 70, "decay": 9, "size": 90, "damping": 6500, "low_cut": 300}})
x("mix.send", {"track": B, "slot": 0, "bus": "Shimmer", "level_db": -9})

x("mix.insert", {"track": M, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 250}})
x("mix.insert", {"track": M, "slot": 1, "plugin": "mod_delay", "params": {"time": 1333, "feedback": 45, "mix": 28, "mod_rate": 0.11, "mod_depth": 30, "lpf": 4000}})
x("mix.send", {"track": M, "slot": 0, "bus": "Shimmer", "level_db": -5})
for at, v in [(0, 0.3), (24, -0.3), (48, 0.25), (63.9, 0.3)]:
    x("automation.set_point", {"track": M, "param": "pan", "at": sec(at), "value": v})

x("mix.insert", {"track": A, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 600, "hpf_slope": 2, "high_shelf_freq": 9000, "high_shelf_gain": 2.5}})
x("mix.insert", {"track": A, "slot": 1, "plugin": "plate_reverb", "params": {"mix": 50, "pre_delay": 90, "decay": 16, "size": 100, "damping": 10000, "low_cut": 500}})
x("mix.send", {"track": A, "slot": 0, "bus": "Shimmer", "level_db": -6})
for at, v in [(0, -0.35), (20, 0.4), (42, -0.3), (63.9, -0.35)]:
    x("automation.set_point", {"track": A, "param": "pan", "at": sec(at), "value": v})

# depth: dark bed, keep its lows tidy so it sits with the Sub instead of fighting it
x("mix.insert", {"track": D, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 45, "low_shelf_freq": 120, "low_shelf_gain": -3, "high_shelf_freq": 4000, "high_shelf_gain": -4}})
x("mix.insert", {"track": D, "slot": 1, "plugin": "room_reverb", "params": {"mix": 20, "decay": 4, "size": 80, "damping": 3000, "low_cut": 150}})

# balance by measured loudness
probe = V2 + "probe.wav"
def lufs():
    r = x("file.bounce_mix", {"path": probe, "format": "wav", "start": 0, "end": sec(64)}); return r["lufs"], r["peak_db"]
targets = {B: -21, D: -26, M: -27, A: -28, 5: -29, 7: -29, 9: -34}
vol = {t["id"]: t["volume_db"] for t in x("session.inspect", {"detail": "full"})["tracks"]}
for t, tgt in targets.items():
    x("mix.solo", {"tracks": [t], "value": True, "exclusive": True})
    l, _ = lufs(); new = max(-30, min(12, vol[t] + tgt - l))
    x("mix.volume", {"tracks": [t], "db": round(new, 1)})
    print(f"track {t:2d}: {l:6.1f} LUFS → fader {new:5.1f} dB (target {tgt})")
x("mix.clear_solos", {})
import os; os.remove(probe)

r = x("file.bounce_mix", {"path": V2 + "meditative_pad_v2_loop.wav", "format": "wav", "bit_depth": "32f", "start": 0, "end": sec(64), "dither": False})
print(f"mix: {r['lufs']:.1f} LUFS, peak {r['peak_db']:.1f} dB, {r['seconds']:.0f}s")
x("file.bounce_stems", {"dir": V2 + "stems", "format": "wav", "bit_depth": "32f", "start": 0, "end": sec(64)})
print(x("session.save", {}))
x("options.loop_playback", {"value": True})
x("transport.play", {"from": 0})
