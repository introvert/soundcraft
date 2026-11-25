"""Physically-inspired Tibetan singing bowl / tingsha synthesis -> seamless WAV loops.

Each bowl mode is an inharmonic partial split into a close doublet (the two degenerate
modes of an imperfect bowl); the doublet's beating gives the familiar slow "wah-wah".
Struck bowls: felt-mallet excitation + exponential decay, higher modes dying faster.
Singing bowls: rim friction slowly pumps the low modes, with amplitude wobble at the
mallet's rotation rate and a little friction noise.
"""
import numpy as np, soundfile as sf

SR = 48000
RATIOS = [1.0, 2.71, 5.15, 8.43, 12.3]          # typical hand-hammered bowl mode ratios
rng = np.random.default_rng(7)

def pan_gains(p):                                # equal-power, p in -1..1
    a = (p + 1) * np.pi / 4
    return np.cos(a), np.sin(a)

def mode(out, start, f, amp, t60, split, pan, env=None):
    """Add one doublet mode to the stereo buffer `out` starting at sample `start`."""
    n = min(len(out[0]) - start, int(min(t60 * 1.15, 90) * SR))
    if env is not None: n = min(n, len(env))
    if n <= 0: return
    t = np.arange(n) / SR
    decay = np.exp(-6.91 * t / t60)
    for df, pp in [(-split / 2, pan - 0.25), (split / 2, pan + 0.25)]:
        ph = rng.uniform(0, 2 * np.pi)
        s = amp * 0.5 * decay * np.sin(2 * np.pi * (f + df) * t + ph)
        if env is not None: s *= env[:n]
        gl, gr = pan_gains(np.clip(pp, -1, 1))
        out[0, start:start + n] += gl * s
        out[1, start:start + n] += gr * s

def strike(out, at, f0, vel=1.0, size=1.0, pan=0.0):
    """Felt-mallet strike. `size` scales sustain (bigger bowls ring longer)."""
    s = int(at * SR)
    weights = [1.0, 0.55, 0.30, 0.14, 0.06]
    for i, (r, w) in enumerate(zip(RATIOS, weights)):
        f = f0 * r * (1 + rng.normal(0, 0.0015))
        if f > 16000: break
        t60 = 38 * size / r ** 0.75
        split = rng.uniform(0.25, 0.9) * (1 + 0.4 * i)
        att = np.minimum(1, np.arange(int(0.004 * SR) + 1) / (0.004 * SR))
        env = np.ones(int(90 * SR)); env[:len(att)] = att
        mode(out, s, f, vel * w, t60, split, pan + rng.uniform(-0.2, 0.2), env)
    # soft mallet thud: short low-passed noise burst
    n = int(0.03 * SR); burst = rng.normal(0, 1, n) * np.exp(-np.arange(n) / (0.006 * SR))
    burst = np.convolve(burst, np.ones(24) / 24, "same") * 0.05 * vel
    out[:, s:s + n] += burst[: max(0, min(n, out.shape[1] - s))]

def sing(out, at, dur, f0, level=1.0, rot=0.6, pan=0.0):
    """Rubbed rim: modes 1-2 swell over `dur` seconds, then ring out."""
    s = int(at * SR); n = int((dur + 40) * SR)
    t = np.arange(n) / SR
    rise = np.clip(t / dur, 0, 1)
    swell = np.where(t < dur, np.sin(np.pi / 2 * rise) ** 2 * (0.75 + 0.25 * np.sin(np.pi * rise)), 1.0)
    held = np.where(t < dur, 1.0, np.exp(-6.91 * (t - dur) / 30))     # free ring-out after the mallet lifts
    wobble = 1 + 0.28 * np.sin(2 * np.pi * rot * t + rng.uniform(0, 6.3))
    env = swell * held * wobble
    for r, w in zip(RATIOS[:3], [1.0, 0.35, 0.08]):
        mode(out, s, f0 * r, level * w, 1e6, rng.uniform(0.3, 0.7), pan + rng.uniform(-0.3, 0.3), env)
    # faint friction hiss tracking the swell, band-limited around the fundamental's 2nd mode
    m = min(n, out.shape[1] - s)
    hiss = rng.normal(0, 1, m); hiss = np.convolve(hiss, np.hanning(64) / 32, "same") - np.convolve(hiss, np.ones(400) / 400, "same")
    out[:, s:s + m] += 0.004 * level * hiss * env[:m] * (t[:m] < dur)

def tingsha(out, at, f0=2480, vel=1.0, beat=6.5):
    """Pair of small cymbals struck together: two bright inharmonic bells `beat` Hz apart."""
    s = int(at * SR)
    for fb, pan in [(f0, -0.5), (f0 + beat, 0.5)]:
        for r, w, t60 in [(1.0, 1.0, 9.0), (2.32, 0.35, 5.0), (3.89, 0.15, 3.0)]:
            mode(out, s, fb * r, vel * w * 0.5, t60, 0.4, pan)

def loop_write(path, buf, loop_s, peak_db=-6.0):
    L = int(loop_s * SR)
    y = buf[:, :L].copy(); tail = buf[:, L:]
    y[:, :tail.shape[1]] += tail[:, :L]                      # wrap the ring-out onto the start
    y *= 10 ** (peak_db / 20) / np.abs(y).max()
    sf.write(path, y.T, SR, subtype="FLOAT")
    return y
