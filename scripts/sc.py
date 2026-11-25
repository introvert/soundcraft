"""Tiny client for SoundCraft's control server (start SoundCraft with --control, port from SOUNDCRAFT_CONTROL_PORT)."""
import json, os, socket, sys
PORT = int(os.environ.get("SOUNDCRAFT_CONTROL_PORT", "47124"))

def call(method, params=None, timeout=600):
    s = socket.create_connection(("127.0.0.1", PORT), timeout=timeout)
    s.sendall((json.dumps({"id": 1, "method": method, "params": params or {}}) + "\n").encode())
    buf = b""
    while not buf.endswith(b"\n"):
        c = s.recv(1 << 20)
        if not c: break
        buf += c
    s.close()
    r = json.loads(buf)
    if not r.get("ok"): raise RuntimeError(f"{method} {params} -> {r.get('error')}")
    return r["result"]

def x(command, params=None, **kw):
    return call("engine.execute", {"command": command, "params": params or {}}, **kw)

if __name__ == "__main__":
    print(json.dumps(x(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}), indent=1)[:4000])
