import sys, numpy as np, glob, os
sys.path.insert(0, ".")
from jucestate import wrap
from pedalboard import load_plugin
from mido import Message
SR = 48000
surge = load_plugin("/Library/Audio/Plug-Ins/VST3/Surge XT.vst3")
root = "/Library/Application Support/Surge XT/"
cands = [root + "patches_factory/Pads/" + n + ".fxp" for n in
         ["MKS-70 Warm Pad", "Winter Warmer", "Still", "Distant", "Ghost Pad", "Verb Pad", "Sunday", "Growth", "Harmonic Sweep", "Choir Pad Thing", "Pad 3", "Well"]]
cands += sorted(glob.glob(root + "patches_3rdparty/Slowboat/**/*.fxp", recursive=True))[:0]
chord = [50, 57, 64, 69]
msgs = [Message("note_on", note=n, velocity=80, time=0) for n in chord] + [Message("note_off", note=n, velocity=0, time=10) for n in chord]
os.makedirs("aud", exist_ok=True)
for f in cands:
    fxp = open(f, "rb").read(); assert fxp[60:64] == b"sub3"
    surge.raw_state = wrap(fxp[60:]); surge([], duration=1.0, sample_rate=SR, num_channels=2)
    a = surge(msgs, duration=14, sample_rate=SR, num_channels=2, reset=False)
    L, R = a[0], a[1]; m = (L + R) / 2; s = (L - R) / 2
    seg = slice(3 * SR, 9 * SR)
    rms = lambda v: 20 * np.log10(np.sqrt((v ** 2).mean()) + 1e-12)
    spec = np.abs(np.fft.rfft(m[seg] * np.hanning(6 * SR))); fr = np.fft.rfftfreq(6 * SR, 1 / SR)
    cen = (spec * fr).sum() / spec.sum()
    env = [rms(m[i * SR // 2:(i + 1) * SR // 2]) for i in range(6, 18)]
    name = os.path.basename(f)[:-4]
    print(f"{name:18s} level {rms(m[seg]):6.1f}  width(S-M) {rms(s[seg]) - rms(m[seg]):6.1f} dB  centroid {cen:6.0f} Hz  movement {np.std(env):4.1f} dB  attack@0.5s {rms(m[:SR//2]):6.1f}  tail@12s {rms(m[12*SR:]):6.1f}")
    import soundfile as sf; sf.write(f"aud/{name}.wav", a.T, SR, subtype="FLOAT")
