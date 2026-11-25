import sys, numpy as np, soundfile as sf
sys.path.insert(0, ".")
from jucestate import wrap
from pedalboard import load_plugin
from mido import Message
SR, LOOP, TAIL = 48000, 64, 16
OUT = "/Users/afx/Music/SoundCraft/Audio Files/"
P = "/Library/Application Support/Surge XT/patches_factory/Pads/"
chords = [[50, 57, 64, 69], [46, 53, 57, 62, 64], [53, 60, 64, 67], [48, 55, 62, 64, 69]]

def events(notes):  # notes: (pitch, start_s, length_s, vel) -> mido msgs with delta times in seconds
    ev = []
    for p, st, ln, v in notes:
        ev += [(st, Message("note_on", note=p, velocity=v)), (st + ln, Message("note_off", note=p, velocity=0))]
    ev.sort(key=lambda e: (e[0], e[1].type == "note_on"))
    out, t = [], 0.0
    for at, m in ev:
        out.append(m.copy(time=at - t)); t = at
    return out

body = [(p, i * 16 + j * 0.12, 16.6, 72 - j * 4) for i, ch in enumerate(chords) for j, p in enumerate(ch)]
motion = [(p + 12, i * 16 + 2.0 + j * 0.8, 14.5, 58) for i, ch in enumerate(chords) for j, p in enumerate(sorted(ch)[-2:])]
air = [(sorted(ch)[k] + 24, i * 16 + 4.0 + k * 3.0, 9.0, 50) for i, ch in enumerate(chords) for k in (1, 3)]

layers = {"Surge Body (MKS-70)": ("MKS-70 Warm Pad", body), "Surge Motion (Growth)": ("Growth", motion), "Surge Air (Distant)": ("Distant", air)}
for name, (patch, notes) in layers.items():
    surge = load_plugin("/Library/Audio/Plug-Ins/VST3/Surge XT.vst3")
    fxp = open(P + patch + ".fxp", "rb").read()
    surge.raw_state = wrap(fxp[60:])
    surge([], duration=1.0, sample_rate=SR, num_channels=2)
    a = surge(events(notes), duration=LOOP + TAIL, sample_rate=SR, num_channels=2, reset=False)
    loop = a[:, :LOOP * SR].copy()
    loop[:, :TAIL * SR] += a[:, LOOP * SR:]          # wrap tail onto start -> seamless loop
    pk = np.abs(loop).max(); loop *= 10 ** (-6 / 20) / pk   # peak -6 dBFS
    sf.write(OUT + name + ".wav", loop.T, SR, subtype="FLOAT")
    m = loop.mean(axis=0); s = (loop[0] - loop[1]) / 2
    mono_loss = 20 * np.log10(np.sqrt((m ** 2).mean()) / np.sqrt(((loop[0] ** 2 + loop[1] ** 2) / 2).mean()))
    print(f"{name:24s} {len(notes):2d} notes  rms {20*np.log10(np.sqrt((m**2).mean())):6.1f} dBFS  mono-sum change {mono_loss:5.1f} dB")
