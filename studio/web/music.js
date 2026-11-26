// Note names <-> MIDI, shared by the editor and the sketch synth.
const Music = (() => {
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLAT = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10, Cb: 11, Fb: 4 };

  const name = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
  const pcName = (pc) => NAMES[((pc % 12) + 12) % 12];

  // "A2", "c#4", "Bb3", "60" -> MIDI number, or null
  function parse(tok) {
    tok = String(tok).trim();
    if (/^\d+$/.test(tok)) return Number(tok);
    const m = tok.match(/^([A-Ga-g])([#b♯♭]?)(-?\d)$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    let pc = NAMES.indexOf(letter);
    const acc = m[2].replace("♯", "#").replace("♭", "b");
    if (acc === "#") pc += 1;
    if (acc === "b") pc = FLAT[letter + "b"] ?? pc - 1;
    return (Number(m[3]) + 1) * 12 + pc;
  }

  // "A2 E3 A3" -> {notes:[45,52,57], bad:[...]}
  function parseList(text) {
    const toks = String(text).split(/[\s,]+/).filter(Boolean);
    const notes = [], bad = [];
    for (const t of toks) { const n = parse(t); (n === null ? bad : notes).push(n === null ? t : n); }
    return { notes, bad };
  }

  const list = (notes) => (notes || []).map(name).join(" ");
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const fromHz = (f) => 69 + 12 * Math.log2(f / 440);
  const nearest = (f) => { const m = Math.round(fromHz(f)); const c = Math.round((fromHz(f) - m) * 100); return `${name(m)}${c ? (c > 0 ? " +" : " ") + c + "¢" : ""}`; };

  // ── chord symbols ──────────────────────────────────────────────────────────
  // quality → intervals above the root (first match wins when naming)
  const QUALITIES = [
    ["maj9", [0, 4, 7, 11, 14]], ["m9", [0, 3, 7, 10, 14]], ["9", [0, 4, 7, 10, 14]],
    ["maj7", [0, 4, 7, 11]], ["m7", [0, 3, 7, 10]], ["7", [0, 4, 7, 10]], ["m(maj7)", [0, 3, 7, 11]],
    ["m7b5", [0, 3, 6, 10]], ["dim7", [0, 3, 6, 9]],
    ["maj7#11", [0, 4, 7, 11, 18]], ["m11", [0, 3, 7, 10, 14, 17]], ["11", [0, 7, 10, 14, 17]],
    ["6/9", [0, 4, 7, 9, 14]], ["m6", [0, 3, 7, 9]], ["6", [0, 4, 7, 9]],
    ["add9", [0, 4, 7, 14]], ["madd9", [0, 3, 7, 14]],
    ["sus2", [0, 2, 7]], ["sus4", [0, 5, 7]], ["7sus4", [0, 5, 7, 10]],
    ["", [0, 4, 7]], ["m", [0, 3, 7]], ["dim", [0, 3, 6]], ["aug", [0, 4, 8]], ["5", [0, 7]],
  ];
  const ALIASES = { M7: "maj7", "Δ": "maj7", "Δ7": "maj7", min: "m", min7: "m7", "-": "m", "-7": "m7", "ø": "m7b5", "°": "dim", "+": "aug", maj: "", M: "", min9: "m9", M9: "maj9", "69": "6/9", sus: "sus4" };

  function pcOf(letter, acc) {
    let pc = NAMES.indexOf(letter.toUpperCase());
    if (acc === "#" || acc === "♯") pc += 1;
    if (acc === "b" || acc === "♭") pc -= 1;
    return (pc + 12) % 12;
  }

  // "Am9", "Fmaj7/C", "Bbadd9" → spread voicing like the built-in themes:
  // bass root in octave 2, its fifth, then the colour tones ascending from an octave above the bass.
  function voice(symbol) {
    const m = String(symbol).trim().replace("6/9", "69").match(/^([A-Ga-g])([#b♯♭]?)([^/]*)(?:\/([A-Ga-g])([#b♯♭]?))?$/);
    if (!m) return null;
    let q = m[3].trim(); q = ALIASES[q] ?? q;
    const found = QUALITIES.find(([n]) => n === q); if (!found) return null;
    const root = pcOf(m[1], m[2]), bassPc = m[4] ? pcOf(m[4], m[5]) : root;
    const bass = 36 + ((bassPc - 36) % 12 + 12) % 12;          // C2..B2
    const notes = [bass];
    const rootLow = bass + ((root - bassPc) % 12 + 12) % 12;
    const ivs = found[1];
    if (ivs.includes(7)) notes.push(rootLow + 7 < bass + 5 ? rootLow + 19 : rootLow + 7);
    let prev = Math.max(...notes);
    for (const iv of ivs) {
      if (iv === 7 || (iv === 0 && bassPc === root)) continue;
      let n = rootLow + (iv % 12);
      while (n <= prev || n < bass + 12) n += 12;
      notes.push(n); prev = n;
    }
    return [...new Set(notes)].sort((a, b) => a - b);
  }

  // [45, 52, 57, 60, 64] → "Am(add9)"-style name, or "" when nothing fits
  function identify(notes) {
    if (!notes?.length) return "";
    const sorted = [...notes].sort((a, b) => a - b), pcs = new Set(sorted.map((n) => n % 12));
    const bassPc = sorted[0] % 12;
    const cands = [bassPc, ...[...pcs].filter((p) => p !== bassPc)];
    let best = null;
    for (const root of cands) {
      const rel = new Set([...pcs].map((p) => (p - root + 12) % 12));
      for (const [qn, ivs] of QUALITIES) {
        const need = new Set(ivs.map((i) => i % 12));
        const omitted = need.has(7) && !rel.has(7) && need.size > 3 ? 1 : 0;   // the fifth may be left out
        if (![...need].every((i) => rel.has(i) || (i === 7 && omitted))) continue;
        const extra = [...rel].filter((i) => !need.has(i)).length;
        const score = (need.size - omitted) * 2 - extra * 3 - omitted - (root === bassPc ? 0 : 3);
        if (!best || score > best.score) best = { score, name: pcName(root) + qn + (root === bassPc ? "" : "/" + pcName(bassPc)) + (extra ? " +" + extra : "") };
      }
    }
    return best ? best.name : "";
  }

  // pitch classes shared by (nearly) every chord, laid out in [lo, hi]: tones that sit over the whole progression
  function commonTones(chords, lo, hi) {
    const sets = chords.map((c) => new Set((c.notes || []).map((n) => n % 12)));
    const count = new Map();
    for (const s of sets) for (const p of s) count.set(p, (count.get(p) || 0) + 1);
    for (const need of [sets.length, sets.length - 1, 2]) {
      const pcs = [...count].filter(([, c]) => c >= need).map(([p]) => p);
      if (pcs.length >= 3 || need === 2) {
        const out = [];
        for (let n = lo; n <= hi; n++) if (pcs.includes(n % 12)) out.push(n);
        return out;
      }
    }
    return [];
  }

  return { NAMES, name, pcName, parse, parseList, list, hz, fromHz, nearest, voice, identify, commonTones };
})();
