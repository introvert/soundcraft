import re, struct
A = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+"
def j64_decode(s):
    n, enc = s.split(".", 1)
    n = int(n); bits = 0; nb = 0; out = bytearray(n); pos = 0
    for ch in enc:
        bits |= A.index(ch) << nb; nb += 6
        while nb >= 8 and pos < n:
            out[pos] = bits & 0xFF; bits >>= 8; nb -= 8; pos += 1
    return bytes(out)
def j64_encode(b):
    out = []; bits = 0; nb = 0
    for byte in b:
        bits |= byte << nb; nb += 8
        while nb >= 6:
            out.append(A[bits & 63]); bits >>= 6; nb -= 6
    if nb: out.append(A[bits & 63])
    return f"{len(b)}." + "".join(out)
def unwrap(raw):
    m = re.search(rb"<IComponent>(.*?)</IComponent>", raw, re.S)
    return j64_decode(m.group(1).decode())
def wrap(component):
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n\n<VST3PluginState><IComponent>'
           + j64_encode(component) + "</IComponent></VST3PluginState>").encode() + b"\0"
    return b"VC2!" + struct.pack("<I", len(xml)) + xml
