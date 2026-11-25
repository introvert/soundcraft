import sys, numpy as np, soundfile as sf
for f in sys.argv[1:]:
    a, sr = sf.read(f); m = a.mean(axis=1)
    seg = m[int(2*sr):int(7*sr)]
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))); fr = np.fft.rfftfreq(len(seg), 1/sr)
    cen = (spec*fr).sum()/spec.sum()
    lr = np.corrcoef(a[int(2*sr):int(7*sr),0], a[int(2*sr):int(7*sr),1])[0,1]
    top = fr[np.argsort(spec)[-5:]]
    print(f"{f:20s} centroid {cen:7.0f} Hz  L/R corr {lr:.2f}  tail rms(9-12s) {np.sqrt((m[int(9*sr):]**2).mean()):.5f}  top bins {np.round(top)}")
