// Sketch: an instant Web Audio stand-in for a soundscape program.
//
// It follows the program's structure the way the engine plays a pack: the four
// chords as pad variants crossfading in order (body + a quieter halo blooming
// late on the upper voices, a two-step top line, a high-shelf "breath" per
// loop), the engine drone on the tonic, the air layer behind its high-pass,
// a texture bed, struck events with ±1 st jitter, and the arp through a
// sweeping resonant low-pass and echo. Every sound source is a simple oscillator
// or filtered noise: it is for hearing harmony, balance and pacing instantly,
// not timbre. The real sound comes from the compose render.
class Sketch {
  constructor(getProgram, { onChord } = {}) {
    this.get = getProgram;
    this.onChord = onChord || (() => {});
    this.ctx = null;
    this.chordSec = 14;
    this.volume = 0.7;
  }

  get playing() { return !!this.ctx; }

  async start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const p = this.get();
    this.noise = this._noiseBuffer(4);

    // master: comp → volume → out
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.5;
    comp.connect(this.master).connect(ctx.destination);
    // engine whole-mix low-pass (depth × arc brightness), as compose.preview applies it
    this.globalLP = ctx.createBiquadFilter(); this.globalLP.type = "lowpass"; this.globalLP.Q.value = 0.6;
    this.globalLP.connect(comp);
    this.mixIn = ctx.createGain(); this.mixIn.connect(this.globalLP);

    // shared reverb send
    this.verb = ctx.createConvolver();
    this.verbWet = ctx.createGain();
    this.verb.connect(this.verbWet).connect(this.mixIn);

    const bus = (dest = this.mixIn) => { const g = ctx.createGain(); g.connect(dest); return g; };
    // pads → engine pad low-pass
    this.padLP = ctx.createBiquadFilter(); this.padLP.type = "lowpass"; this.padLP.Q.value = 0.5;
    this.padLP.connect(this.mixIn); this.padLP.connect(this.verb);
    this.padBus = bus(this.padLP); this.padBus.gain.value = 0.9;
    // air → engine air high-pass
    this.airHP = ctx.createBiquadFilter(); this.airHP.type = "highpass"; this.airHP.Q.value = 0.5;
    this.airHP.connect(this.mixIn); this.airHP.connect(this.verb);
    this.airBus = bus(this.airHP); this.airBus.gain.value = 0.5;
    this.droneBus = bus(); this.texBus = bus(); this.eventBus = bus();
    this.eventBus.connect(this.verb);
    // arp → echo
    this.arpBus = bus();
    this.echo = ctx.createDelay(4); this.echoFb = ctx.createGain(); this.echoWet = ctx.createGain();
    this.arpBus.connect(this.echo); this.echo.connect(this.echoFb).connect(this.echo);
    this.echo.connect(this.echoWet).connect(this.mixIn);
    this.arpBus.connect(this.verb);

    this.t0 = ctx.currentTime + 0.1;
    this.nextChordAt = this.t0; this.chordIdx = 0;
    this.nextArpAt = this.t0 + 1; this.arpStep = 0;
    this.nextAirAt = this.t0 + 1.5;
    this.events = {};
    this._applied = {};
    this.update(p, true);
    this.timer = setInterval(() => this._tick(), 100);
    this._tick();
  }

  stop() {
    if (!this.ctx) return;
    clearInterval(this.timer);
    (this.uiTimers || []).forEach(clearTimeout);
    const ctx = this.ctx; this.ctx = null;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => ctx.close(), 600);
    this.onChord(-1);
  }

  setVolume(v) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  // Apply continuous parameters (filters, gains, reverb, drone, beds). Discrete
  // parts (chords, air notes, arp, events) read the program as they schedule.
  update(p, force = false) {
    if (!this.ctx || !p) return;
    const ctx = this.ctx, now = ctx.currentTime, a = this._applied;
    const tc = (param, v) => param.setTargetAtTime(v, now, 0.08);
    tc(this.padLP.frequency, clamp(p.bands?.padLowPassHz ?? 8000, 100, 20000));
    tc(this.airHP.frequency, clamp(p.bands?.airHighPassHz ?? 1500, 20, 12000));
    tc(this.globalLP.frequency, typeof engineCutoff === "function" ? engineCutoff(p).maintain : 8000);
    tc(this.verbWet.gain, clamp((p.reverb?.wet ?? 0.35) * 1.6, 0, 1.2));
    const rt = clamp(p.reverb?.rt60Sec ?? 5, 0.2, 12);
    if (force || a.rt !== rt) { this.verb.buffer = this._impulse(rt); a.rt = rt; }

    const arp = p.arp;
    if (arp) {
      const beat = 60 / (arp.bpm || 100);
      tc(this.echo.delayTime, clamp((arp.echo?.[0] ?? 0.75) * beat, 0.01, 3.9));
      tc(this.echoFb.gain, clamp(arp.echo?.[1] ?? 0.3, 0, 0.85));
      tc(this.echoWet.gain, clamp(arp.echo?.[2] ?? 0.2, 0, 1) * 1.5);
    }
    tc(this.arpBus.gain, arp ? clamp(arp.gain ?? 0.7, 0, 2) * 0.35 : 0);

    // drone: tonic in octave 2, a few harmonics behind a low-pass, like synth_engine
    const tonic = p.key?.tonic ?? 0, dg = clamp(p.droneGain ?? 0.6, 0, 2);
    if (force || a.tonic !== tonic) { this._drone(tonic); a.tonic = tonic; }
    tc(this.droneBus.gain, dg * 0.16);

    // texture bed
    const tex = p.texture?.preset || null;
    if (force || a.tex !== tex) { this._texture(tex); a.tex = tex; }
    tc(this.texBus.gain, tex ? clamp(p.texture.gain ?? 0.2, 0, 2) * 0.9 : 0);

    // continuous procedural air (wind, leaves)
    const airKind = p.air?.proc || (p.air?.surge ? "surge" : null);
    if (force || a.air !== airKind) { this._airBed(airKind); a.air = airKind; }
  }

  // ── scheduling ─────────────────────────────────────────────────────────────
  _tick() {
    const ctx = this.ctx; if (!ctx) return;
    const p = this.get(); if (!p) return;
    const ahead = ctx.currentTime + 0.6;
    while (this.nextChordAt < ahead) {
      const L = this.chordSec;
      this._chord(p, this.chordIdx % 4, this.nextChordAt, L);
      this.nextChordAt += L; this.chordIdx++;
    }
    if (p.arp) {
      const step = 60 / (p.arp.bpm || 100) / (p.arp.division || 2);
      while (this.nextArpAt < ahead) { this._arpNote(p, this.nextArpAt, step); this.nextArpAt += step; this.arpStep++; }
    } else this.nextArpAt = ahead;
    while (this.nextAirAt < ahead) this.nextAirAt += this._airNote(p, this.nextAirAt);
    this._events(p, ahead);
  }

  _chord(p, i, t, L) {
    const ctx = this.ctx, c = p.chords?.[i]; if (!c?.notes?.length) return;
    const xf = Math.min(6, L * 0.35), end = t + L + xf;
    const breath = ctx.createBiquadFilter(); breath.type = "highshelf"; breath.frequency.value = 2200;
    const dip = -clamp(p.breathDb ?? 5, 0, 24);
    breath.gain.setValueAtTime(0, t);
    breath.gain.linearRampToValueAtTime(dip, t + (L + xf) * (0.35 + 0.15 * (i % 2)));
    breath.gain.linearRampToValueAtTime(0, end);
    const vg = ctx.createGain(); vg.connect(this.padBus);
    breath.connect(vg);
    // equal-power-ish crossfade envelope over the overlap
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(1, t + xf);
    vg.gain.setValueAtTime(1, t + L);
    vg.gain.linearRampToValueAtTime(0, end);

    const notes = [...c.notes].sort((x, y) => x - y), n = notes.length;
    const bodyType = i % 2 === 0 ? "sawtooth" : "triangle", haloType = i % 2 === 0 ? "triangle" : "sawtooth";
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800; lp.Q.value = 0.3;
    lp.connect(breath);
    for (const m of notes) {
      const low = m < 48 ? 1.25 : 1;
      for (const det of [-7, 6]) this._osc(bodyType, Music.hz(m), det, lp, 0.11 * low / Math.sqrt(n), t, end, 1.5);
    }
    // halo: upper voices an octave up, ~7 dB under, blooming a few seconds late
    for (const m of notes.slice(Math.floor(n / 2))) {
      this._osc(haloType, Music.hz(m + 12), 3, lp, 0.045 / Math.sqrt(n), t + 3, end, 4);
    }
    // two-step top line: first half / second half
    if (c.top?.length === 2) {
      const half = L / 2;
      this._osc("sine", Music.hz(c.top[0]), 0, breath, 0.07, t + 1.5, t + half + 2, 2);
      this._osc("sine", Music.hz(c.top[1]), 0, breath, 0.07, t + half, end, 2);
    }
    const ui = setTimeout(() => this.onChord(i), Math.max(0, (t - ctx.currentTime) * 1000));
    (this.uiTimers ||= []).push(ui);
    if (this.uiTimers.length > 20) this.uiTimers.shift();
  }

  _osc(type, f, cents, dest, gain, t0, t1, attack) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f; o.detune.value = cents;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, Math.max(t0 + attack, t1 - attack));
    g.gain.linearRampToValueAtTime(0, t1);
    o.connect(g).connect(dest);
    o.start(t0); o.stop(t1 + 0.05);
  }

  _airNote(p, t) {
    const a = p.air || {}, tones = a.tones || [];
    if (a.surge && tones.length) {                 // slow pad tones from the air set
      const m = tones[Math.floor(Math.random() * tones.length)];
      const dur = 6 + Math.random() * 5;
      this._osc("triangle", Music.hz(m), rand(-5, 5), this.airBus, 0.05, t, t + dur, 2.5);
      return 2.5 + Math.random() * 3.5;
    }
    if (a.proc === "crystal" && tones.length) {   // glassy drips
      const m = tones[Math.floor(Math.random() * tones.length)];
      this._ping(Music.hz(m), t, 0.09, 1.8, this.airBus, rand(-0.7, 0.7));
      return 0.8 + Math.random() * 2.6;
    }
    if (a.proc === "high_bowls") {                // rubbed small bowls: long swells
      const m = [74, 81, 79][Math.floor(Math.random() * 3)];
      this._osc("sine", Music.hz(m + rand(-0.1, 0.1)), 0, this.airBus, 0.06, t, t + 12, 5);
      return 7 + Math.random() * 5;
    }
    return 1;
  }

  _ping(f, t, gain, decay, dest, pan = 0) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), pn = ctx.createStereoPanner();
    o.type = "sine"; o.frequency.value = f; pn.pan.value = pan;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(pn).connect(dest); o.start(t); o.stop(t + decay + 0.05);
  }

  _events(p, ahead) {
    const evs = p.events || {};
    for (const name of Object.keys(this.events)) if (!evs[name]) delete this.events[name];
    for (const [name, ev] of Object.entries(evs)) {
      const m = /^synth:(bowl|bell|gong):([\d.]+)$/.exec(ev.asset || ""); if (!m) continue;
      if (!(name in this.events)) this.events[name] = this.ctx.currentTime + rand(2, 10);
      while (this.events[name] < ahead) {
        this._strike(m[1], Number(m[2]), this.events[name], clamp(ev.gain ?? 0.3, 0, 2));
        this.events[name] += Math.max(5, ev.everySec || 60) * rand(0.9, 1.1);
      }
    }
  }

  // struck resonators: inharmonic partials with per-partial decay, ±1 st humanise
  _strike(kind, hz, t, gain) {
    const spec = {
      bowl: { r: [1, 2.71, 5.15, 8.43], a: [1, 0.5, 0.25, 0.1], d: [14, 8, 4.5, 2.5], atk: 0.01 },
      bell: { r: [1, 2.0, 2.76, 5.4], a: [1, 0.5, 0.4, 0.2], d: [4, 2.5, 1.4, 0.7], atk: 0.002 },
      gong: { r: [1, 1.48, 2.1, 2.92, 3.9], a: [1, 0.7, 0.5, 0.3, 0.2], d: [16, 10, 7, 5, 3], atk: 0.12 },
    }[kind];
    const f0 = hz * Math.pow(2, rand(-1, 1) / 12), pan = this.ctx.createStereoPanner();
    pan.pan.value = rand(-0.6, 0.6); pan.connect(this.eventBus);
    const lvl = gain * 0.25 * Math.pow(10, rand(-1.5, 1.5) / 20);
    spec.r.forEach((r, k) => {
      const f = f0 * r; if (f > 16000) return;
      const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = f; o2.frequency.value = f + 0.6 + k * 0.3;          // slow beating pair
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl * spec.a[k], t + spec.atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + spec.d[k]);
      o.connect(g); o2.connect(g); g.connect(pan);
      o.start(t); o2.start(t); o.stop(t + spec.d[k] + 0.1); o2.stop(t + spec.d[k] + 0.1);
    });
  }

  _arpNote(p, t, step) {
    const arp = p.arp, tones = [...(arp.tones || [])].sort((x, y) => x - y); if (!tones.length) return;
    const division = arp.division || 2, beat = 60 / (arp.bpm || 100);
    const k = this.arpStep, variant = Math.floor(k / (division * 4 * (arp.bars || 8))) % 4;
    let idx;
    if (Array.isArray(arp.steps)) {
      const pat = arp.steps[variant % arp.steps.length] || [];
      idx = pat[k % pat.length];
      if (idx === null || idx === undefined) return;
    } else if (arp.steps === "random") {
      if (Math.random() < (arp.rest ?? 0.3)) return;
      idx = Math.floor(Math.random() * tones.length);
    } else {                                           // updown, like ARP_PATTERNS[0]
      if (Math.random() < (arp.rest ?? 0)) return;
      const cyc = Math.max(1, 2 * tones.length - 2), j = k % cyc;
      idx = j < tones.length ? j : cyc - j;
    }
    const octave = arp.octaves === false ? 0 : [0, 12, 0, -12][variant];
    const m = tones[Math.min(idx, tones.length - 1)] + octave;
    // resonant low-pass sweeping lo→hi over loop/sweeps, accents from cutoffSteps
    const [lo, hi, res] = arp.filter || [800, 4000, 0.3];
    const loopSec = (arp.bars || 8) * 4 * beat, period = loopSec / (arp.sweeps || 1);
    const phase = 0.5 - 0.5 * Math.cos(2 * Math.PI * ((t - this.t0) % period) / period);
    const acc = Array.isArray(arp.cutoffSteps) ? arp.cutoffSteps[k % arp.cutoffSteps.length] : arp.cutoffSteps === "random" ? Math.random() : 1;
    const cutoff = lo * Math.pow(hi / lo, clamp(phase * (0.6 + 0.4 * acc), 0, 1));
    const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.value = Music.hz(m);
    f.type = "lowpass"; f.Q.value = 0.7 + clamp(res, 0, 1) * 10;
    f.frequency.setValueAtTime(cutoff * 2, t); f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff), t + step);
    const dur = step * clamp(arp.gate ?? 0.7, 0.05, 1), vel = k % division === 0 ? 0.11 : 0.08;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.12);
    o.connect(f).connect(g).connect(this.arpBus); o.start(t); o.stop(t + dur + 0.2);
  }

  // ── continuous layers ──────────────────────────────────────────────────────
  _drone(tonic) {
    if (this.droneNodes) this.droneNodes.forEach((n) => { try { n.stop(); } catch { /* */ } });
    const ctx = this.ctx, f0 = Music.hz(36 + tonic), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 500; lp.connect(this.droneBus);
    this.droneNodes = [1, 2, 3, 4].map((h, k) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f0 * h; o.detune.value = k ? rand(-3, 3) : 0;
      g.gain.value = [1, 0.45, 0.22, 0.1][k];
      o.connect(g).connect(lp); o.start(); return o;
    });
  }

  _noiseSrc(dest) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.loopStart = Math.random() * 2; s.connect(dest); s.start(); return s;
  }

  _lfo(param, hz, depth, base) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = hz; g.gain.value = depth; param.value = base;
    o.connect(g).connect(param); o.start(); return o;
  }

  _texture(preset) {
    (this.texNodes || []).forEach((n) => { try { n.stop(); } catch { /* */ } });
    this.texNodes = [];
    if (!preset) return;
    const ctx = this.ctx, chain = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const amp = ctx.createGain(); amp.connect(this.texBus);
    const recipes = {
      surf: () => { const f = chain("lowpass", 900, 0.4); f.connect(amp); this.texNodes.push(this._lfo(amp.gain, 0.09, 0.45, 0.5)); return f; },
      rain_soft: () => { const f = chain("highpass", 2200, 0.5); f.connect(amp); amp.gain.value = 0.25; return f; },
      rain_heavy: () => { const f = chain("highpass", 900, 0.5); f.connect(amp); amp.gain.value = 0.45; return f; },
      stream: () => { const f = chain("bandpass", 1400, 0.8); f.connect(amp); this.texNodes.push(this._lfo(f.frequency, 3.1, 300, 1400)); amp.gain.value = 0.6; return f; },
      wind: () => { const f = chain("bandpass", 500, 2); f.connect(amp); this.texNodes.push(this._lfo(f.frequency, 0.07, 300, 600)); amp.gain.value = 0.9; return f; },
      hush: () => { const f = chain("lowpass", 500, 0.3); f.connect(amp); amp.gain.value = 0.35; return f; },
      fire: () => { const f = chain("lowpass", 1200, 0.5); f.connect(amp); amp.gain.value = 0.3; return f; },
      murmur: () => { const f = chain("bandpass", 450, 1.2); f.connect(amp); this.texNodes.push(this._lfo(amp.gain, 0.7, 0.25, 0.5)); return f; },
      cafe: () => { const f = chain("bandpass", 500, 1); f.connect(amp); this.texNodes.push(this._lfo(amp.gain, 0.6, 0.2, 0.45)); return f; },
      city: () => { const f = chain("lowpass", 350, 0.5); f.connect(amp); this.texNodes.push(this._lfo(amp.gain, 0.05, 0.35, 0.6)); return f; },
      night_street: () => { const f = chain("lowpass", 400, 0.5); f.connect(amp); this.texNodes.push(this._lfo(amp.gain, 0.04, 0.35, 0.55)); return f; },
    };
    const head = (recipes[preset] || recipes.hush)();
    this.texNodes.push(this._noiseSrc(head));
  }

  _airBed(kind) {
    (this.airNodes || []).forEach((n) => { try { n.stop(); } catch { /* */ } });
    this.airNodes = [];
    if (kind !== "leaves" && kind !== "desert_wind") return;
    const ctx = this.ctx, amp = ctx.createGain(); amp.connect(this.airBus);
    const centers = kind === "leaves" ? [3500, 6000] : [900, 2600];
    for (const c of centers) {
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = kind === "leaves" ? 1 : 4;
      f.connect(amp);
      this.airNodes.push(this._lfo(f.frequency, rand(0.05, 0.12), c * 0.3, c));
      this.airNodes.push(this._noiseSrc(f));
    }
    this.airNodes.push(this._lfo(amp.gain, kind === "leaves" ? 0.23 : 0.08, 0.25, kind === "leaves" ? 0.3 : 0.6));
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx, n = Math.floor(sec * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let pink = 0;
      for (let i = 0; i < n; i++) { pink = 0.97 * pink + 0.03 * (Math.random() * 2 - 1); d[i] = (Math.random() * 2 - 1) * 0.3 + pink * 2; }
    }
    return b;
  }

  _impulse(rt60) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(Math.min(10, rt60 * 1.1) * sr);
    const b = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, k = Math.min(0.9, 0.2 + t / rt60);   // highs die first
        lp = k * lp + (1 - k) * (Math.random() * 2 - 1);
        d[i] = lp * Math.exp(-6.9 * t / rt60) * (i < sr * 0.02 ? i / (sr * 0.02) : 1);
      }
    }
    return b;
  }
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, Number.isFinite(+x) ? +x : lo)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
