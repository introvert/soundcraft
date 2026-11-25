"""v3 'Tibetan bowls': struck + singing bowls, tingsha, Surge drone. 96 s seamless loops in v3/audio/."""
import sys, numpy as np
sys.path.insert(0, sys.path[0])
from bowls import SR, strike, sing, tingsha, loop_write
from jucestate import wrap
from pedalboard import load_plugin
from mido import Message

LOOP, TAIL = 96, 40
OUT = "/Users/afx/code/experiments/soundcraft/v3/audio/"
hz = lambda midi, cents=0: 440 * 2 ** ((midi - 69 + cents / 100) / 12)
buf = lambda: np.zeros((2, (LOOP + TAIL) * SR))

# bowl set, slightly "out" of equal temperament like real hand-hammered bowls
D3, G3, A3, C4, D4 = hz(50, -8), hz(55, +6), hz(57, -4), hz(60, +11), hz(62, -3)

struck = buf()
for at, f, vel, size, pan in [
        (0.0, D3, 1.0, 1.3, -0.1), (9.5, A3, 0.7, 1.0, 0.35), (17.0, D4, 0.55, 0.8, -0.35),
        (26.0, G3, 0.6, 1.1, 0.2), (36.5, D3, 0.8, 1.3, -0.1), (45.0, C4, 0.45, 0.9, 0.4),
        (52.0, A3, 0.65, 1.0, 0.3), (61.5, D4, 0.5, 0.8, -0.4), (70.0, G3, 0.55, 1.1, 0.15),
        (79.0, D3, 0.7, 1.3, -0.05), (86.5, A3, 0.4, 1.0, 0.35)]:
    strike(struck, at, f, vel, size, pan)
loop_write(OUT + "v3 Bowls Struck.wav", struck, LOOP)

singing = buf()
sing(singing, 4.0, 28.0, A3, 1.0, rot=0.55, pan=0.2)       # A bowl rubbed for ~28 s
sing(singing, 50.0, 32.0, D4, 0.8, rot=0.7, pan=-0.25)     # D bowl later, a little faster
loop_write(OUT + "v3 Bowls Singing.wav", singing, LOOP)

ting = buf()
tingsha(ting, 0.4, vel=1.0); tingsha(ting, 48.2, f0=2520, vel=0.8)
loop_write(OUT + "v3 Tingsha.wav", ting, LOOP)

# low drone: Surge 'Sorrowful' on D1/D2 + A2, re-triggered every 48 s so it never dies
surge = load_plugin("/Library/Audio/Plug-Ins/VST3/Surge XT.vst3")
fxp = open("/Library/Application Support/Surge XT/patches_3rdparty/Nick Moritz/Pads/Sorrowful.fxp", "rb").read()
surge.raw_state = wrap(fxp[60:]); surge([], duration=1.0, sample_rate=SR, num_channels=2)
msgs, t = [], 0.0
for start in (0, 48):
    for p, v in [(38, 70), (45, 55), (50, 40)]:
        msgs.append(Message("note_on", note=p, velocity=v, time=start - t)); t = start
    for p in (38, 45, 50):
        msgs.append(Message("note_off", note=p, velocity=0, time=(start + 49) - t)); t = start + 49
drone = surge(msgs, duration=LOOP + TAIL, sample_rate=SR, num_channels=2, reset=False)
loop_write(OUT + "v3 Drone.wav", drone, LOOP)

for n in ["v3 Bowls Struck", "v3 Bowls Singing", "v3 Tingsha", "v3 Drone"]:
    import soundfile as sf
    y, _ = sf.read(OUT + n + ".wav"); m = y.mean(axis=1)
    print(f"{n:18s} rms {20*np.log10(np.sqrt((m**2).mean())):6.1f} dBFS  mono-sum change {20*np.log10(np.sqrt((m**2).mean())/np.sqrt((y**2).mean())):5.1f} dB")
