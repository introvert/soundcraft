import json, socket, sys
def x(cmd, p, t=300):
    s = socket.create_connection(("127.0.0.1", 47123), timeout=t)
    s.sendall((json.dumps({"id": 1, "method": "engine.execute", "params": {"command": cmd, "params": p}}) + "\n").encode())
    buf = b""
    while not buf.endswith(b"\n"):
        c = s.recv(1 << 20)
        if not c: break
        buf += c
    r = json.loads(buf)
    if not r.get("ok"): sys.exit(f"FAILED {cmd} {p} -> {r}")
    return r["result"]
sec = lambda v: {"seconds": v}
A = "/Users/afx/Music/SoundCraft/Audio Files/"
B, M, AIR = 17, 20, 23
ids = {'body': B, 'motion': M, 'air': AIR}
# body: cut boxiness, gentle chorus for extra width, light plate, a little shimmer
x("mix.insert", {"track": B, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 70, "low_mid_freq": 300, "low_mid_gain": -2.5, "low_mid_q": 0.9, "high_shelf_freq": 10000, "high_shelf_gain": 1.5}})
x("mix.insert", {"track": B, "slot": 1, "plugin": "plate_reverb", "params": {"mix": 25, "pre_delay": 60, "decay": 7, "size": 85, "damping": 6000, "low_cut": 250}})
x("mix.send", {"track": B, "slot": 0, "bus": "Shimmer", "level_db": -10})
# motion: slow phaser for evolving colour, delay, filter breathing
x("mix.insert", {"track": M, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 220}})
x("mix.insert", {"track": M, "slot": 1, "plugin": "phaser", "params": {"rate": 0.05, "depth": 60, "stages": 2, "feedback": 30, "center": 1200, "mix": 35}})
x("mix.insert", {"track": M, "slot": 2, "plugin": "mod_delay", "params": {"time": 1500, "feedback": 40, "mix": 25, "mod_rate": 0.13, "mod_depth": 25, "lpf": 4500}})
x("mix.send", {"track": M, "slot": 0, "bus": "Shimmer", "level_db": -6})
# air: high-passed, long reverb, slow auto-pan
x("mix.insert", {"track": AIR, "slot": 0, "plugin": "eq_7band", "params": {"hpf_on": 1, "hpf_freq": 500, "hpf_slope": 2, "high_shelf_freq": 9000, "high_shelf_gain": 2}})
x("mix.insert", {"track": AIR, "slot": 1, "plugin": "plate_reverb", "params": {"mix": 45, "pre_delay": 80, "decay": 14, "size": 100, "damping": 9000, "low_cut": 400}})
x("mix.send", {"track": AIR, "slot": 0, "bus": "Shimmer", "level_db": -8})
for at, v in [(0, -0.4), (21, 0.4), (43, -0.3), (63.9, -0.4)]:
    x("automation.set_point", {"track": AIR, "param": "pan", "at": sec(at), "value": v})
open("surge_tracks.json", "w").write(json.dumps(ids))
