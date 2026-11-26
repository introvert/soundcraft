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

  return { NAMES, name, pcName, parse, parseList, list, hz, fromHz, nearest };
})();
