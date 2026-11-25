import sys, numpy as np, soundfile as sf
sys.path.insert(0, ".")
from jucestate import wrap
from pedalboard import load_plugin
from mido import Message
SR, LOOP, TAIL = 48000, 64, 16
OUT = "/Users/afx/code/experiments/soundcraft/v2/audio/"
P = "/Library/Application Support/Surge XT/patches_3rdparty/"
# v2: wider voicings with added 9ths, same harmony (D sus, Bbmaj9, Fadd9, Cadd9)
chords = [[50, 57, 62, 64, 69, 76], [46, 53, 60, 62, 69, 74], [53, 60, 65, 67, 69, 72], [48, 55, 62, 64, 67, 74]]

def events(notes):  # notes: (pitch, start_s, length_s, vel) -> mido msgs with delta times in seconds
    ev = []
    for p, st, ln, v in notes:
        ev += [(st, Message("note_on", note=p, velocity=v)), (st + ln, Message("note_off", note=p, velocity=0))]
    ev.sort(key=lambda e: (e[0], e[1].type == "note_on"))
    out, t = [], 0.0
    for at, m in ev:
        out.append(m.copy(time=at - t)); t = at
    return out

body = [(p, i * 16 + j * 0.15, 16.6, 70 - j * 3) for i, ch in enumerate(chords) for j, p in enumerate(ch)]
motion = [(p + 12, i * 16 + 1.5 + j * 1.1, 15.0, 60) for i, ch in enumerate(chords) for j, p in enumerate(sorted(ch)[2:5])]
air = [(sorted(ch)[k] + 12, i * 16 + 3.0 + n * 4.0, 8.0, 55) for i, ch in enumerate(chords) for n, k in enumerate((5, 3, 4))]
depth = [(p, i * 16, 16.5, 75) for i, ch in enumerate(chords) for p in (sorted(ch)[0] - 12, sorted(ch)[0] - 5)]

layers = {"v2 Body (Utopia)": ("Cybersoda/Pads/Utopia ", body), "v2 Motion (Smooth Chorus)": ("Jacky Ligon/Pads/Smooth Chorus", motion),
          "v2 Air (Planetarium)": ("Jacky Ligon/Pads/Planetarium", air), "v2 Depth (Sorrowful)": ("Nick Moritz/Pads/Sorrowful", depth)}
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
