import json, socket, sys, os
D = sys.argv[1]
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
def lufs():
    r = x("file.bounce_mix", {"path": f"{D}/probe.wav", "format": "wav", "start": 0, "end": {"seconds": 64}})
    return r["lufs"], r["peak_db"]
targets = {17: -21, 20: -27, 23: -27, 5: -28, 7: -29, 9: -34}
vol = {t["id"]: t["volume_db"] for t in x("session.inspect", {"detail": "full"})["tracks"]}
for t, tgt in targets.items():
    x("mix.solo", {"tracks": [t], "value": True, "exclusive": True})
    l, p = lufs()
    new = max(-30, min(12, vol[t] + (tgt - l)))
    x("mix.volume", {"tracks": [t], "db": round(new, 1)})
    print(f"track {t:2d}: {l:6.1f} LUFS -> fader {vol[t]:5.1f} → {new:5.1f} dB (target {tgt})")
x("mix.clear_solos", {})
l, p = lufs(); print(f"full mix: {l:.1f} LUFS, peak {p:.1f} dB")
os.remove(f"{D}/probe.wav")
