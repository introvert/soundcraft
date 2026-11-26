// SoundCraft Studio: program editor, sketch, render jobs, results.
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false)
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};
const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.errors?.join("; ") || data.error || r.statusText), { data, status: r.status });
  return data;
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const getPath = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, path, v) => { const ks = path.split("."); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; };

const DEFAULT_ARP = { patch: "patches_factory/Keys/Soft Suitcase", bpm: 72, division: 2, bars: 8, tones: [65, 67, 69, 72, 74, 77],
  gate: 0.75, filter: [800, 4000, 0.3], echo: [0.75, 0.3, 0.2], gain: 0.75 };

const S = {
  env: null, prog: null, source: "new", savedJson: null, errors: [],
  job: null, jobPoll: null, renders: null,
};
const sketch = new Sketch(() => S.prog, { onChord: (i) => {
  document.querySelectorAll(".chord-card").forEach((c, k) => c.classList.toggle("playing", k === i));
  document.querySelectorAll("#sketchChords span").forEach((c, k) => c.classList.toggle("on", k === i));
} });

// ── boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  S.env = await api("GET", "/api/env");
  const dl = h("datalist", { id: "patchList" }, S.env.options.patches.map((p) => h("option", { value: p })));
  document.body.append(dl);
  renderEnv();
  await refreshLibrary();
  const last = (() => { try { return JSON.parse(localStorage.getItem("studio.last") || "null"); } catch { return null; } })();
  const lib = S.library;
  if (last && [...lib.saved, ...lib.builtin].some((p) => p.slug === last.slug)) await openProgram(last.slug, last.source);
  else if (lib.saved[0]) await openProgram(lib.saved[0].slug, "saved");
  else if (lib.builtin[0]) await openProgram(lib.builtin[0].slug, "builtin");
  else newProgram();
  wireGlobal();
}

function renderEnv() {
  const e = S.env;
  $("#envInfo").replaceChildren(
    h("div", { class: e.generationFound ? "ok" : "bad" }, e.generationFound ? "compose ✓" : "compose not found"),
    h("div", { class: "muted", title: e.generation }, e.generation.replace(/^\/(Users|home)\/[^/]+/, "~")),
    h("div", { class: e.surgeInstalled ? "ok" : "bad" }, e.surgeInstalled ? `Surge XT ✓ · ${e.options.patches.length} patches` : "Surge XT not found: renders will fail"),
  );
}

async function refreshLibrary() {
  S.library = await api("GET", "/api/programs");
  drawLibrary();
}

function drawLibrary() {
  const q = $("#libFilter").value.trim().toLowerCase();
  const item = (p, source) => h("li", {
    class: S.prog && S.prog.slug === p.slug && S.source === source ? "active" : "",
    onclick: () => openProgram(p.slug, source),
    title: p.slug,
  }, h("span", { class: "swatch", style: `background:#${p.color || "333"}` }), h("span", { class: "nm" }, p.name),
     h("span", { class: "cat" }, p.category || ""), p.rendered ? h("span", { class: "dot", title: "rendered" }) : null);
  const f = (list) => list.filter((p) => !q || `${p.name} ${p.slug} ${p.category}`.toLowerCase().includes(q));
  const saved = f(S.library.saved), builtin = f(S.library.builtin);
  $("#libSaved").replaceChildren(...(saved.length ? saved.map((p) => item(p, "saved")) : [h("li", { class: "empty" }, "None yet. Save one.")]));
  $("#libBuiltin").replaceChildren(...builtin.map((p) => item(p, "builtin")));
}

// ── documents ────────────────────────────────────────────────────────────────
const dirty = () => S.prog && JSON.stringify(S.prog) !== S.savedJson;

async function confirmDiscard() {
  if (!dirty()) return true;
  return (await dialog("Discard unsaved changes?", h("p", {}, `${S.prog.name} has unsaved edits.`), "Discard")) !== null;
}

async function openProgram(slug, source) {
  if (!(await confirmDiscard())) return;
  const prog = await api("GET", `/api/programs/${slug}?source=${source}`);
  load(prog, source);
}

function load(prog, source) {
  S.prog = prog; S.source = source; S.savedJson = source === "new" ? null : JSON.stringify(prog);
  try { if (source !== "new") localStorage.setItem("studio.last", JSON.stringify({ slug: prog.slug, source })); } catch { /* */ }
  drawEditor(); changed(false); drawLibrary(); loadRenders();
}

async function newProgram() {
  if (!(await confirmDiscard())) return;
  const base = S.library.builtin.length ? await api("GET", `/api/programs/${S.library.builtin[0].slug}?source=builtin`) : null;
  const p = base ? clone(base) : null;
  if (!p) return;
  Object.assign(p, { slug: uniqueSlug("untitled"), name: "Untitled", description: "", tags: [], events: {}, arp: null, extras: {}, texture: null });
  load(p, "new");
}

function uniqueSlug(base) {
  const taken = new Set([...S.library.saved, ...S.library.builtin].map((p) => p.slug));
  let s = base, i = 2; while (taken.has(s)) s = `${base}_${i++}`; return s;
}

async function save() {
  if (S.errors.length) return toast("Fix the problems listed at the top first.", "bad");
  const builtin = S.library.builtin.some((p) => p.slug === S.prog.slug);
  const exists = S.library.saved.some((p) => p.slug === S.prog.slug);
  if (S.source !== "saved" && exists) {
    if ((await dialog("Overwrite?", h("p", {}, `programs/${S.prog.slug}.json already exists.`), "Overwrite")) === null) return;
  }
  try {
    await api("PUT", `/api/programs/${S.prog.slug}`, S.prog);
    S.source = "saved"; S.savedJson = JSON.stringify(S.prog);
    try { localStorage.setItem("studio.last", JSON.stringify({ slug: S.prog.slug, source: "saved" })); } catch { /* */ }
    toast(`Saved programs/${S.prog.slug}.json${builtin ? " (overrides the built-in theme when rendered from here)" : ""}`);
    changed(false); await refreshLibrary();
  } catch (e) { toast(e.message, "bad"); }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(S.prog, null, 2) + "\n"], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${S.prog.slug}.json` }); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJson(file) {
  if (!(await confirmDiscard())) return;
  try {
    const p = JSON.parse(await file.text());
    const { errors } = await api("POST", "/api/validate", p);
    load(p, "new");
    if (errors.length) toast(`Imported with ${errors.length} problem(s)`, "bad");
  } catch (e) { toast(`Not a program: ${e.message}`, "bad"); }
}

// ── change handling ──────────────────────────────────────────────────────────
let validateTimer;
function changed(touch = true) {
  const p = S.prog;
  $("#docTitle").textContent = `${p.name || "Untitled"}`;
  $("#docSwatch").style.background = `#${p.color}`;
  $("#docSource").textContent = { saved: `programs/${p.slug}.json`, builtin: "built-in · not saved", new: "new · not saved" }[S.source];
  $("#docDirty").hidden = !dirty();
  if (touch) sketch.update(p);
  clearTimeout(validateTimer);
  validateTimer = setTimeout(validate, touch ? 250 : 0);
  drawDerived();
  drawRenderButtons();
  markStale();
}

async function validate() {
  try { S.errors = (await api("POST", "/api/validate", S.prog)).errors; } catch (e) { S.errors = [e.message]; }
  const box = $("#errors");
  box.hidden = !S.errors.length;
  box.replaceChildren(h("strong", {}, `${S.errors.length} problem${S.errors.length === 1 ? "" : "s"}`), h("ul", {}, S.errors.map((e) => h("li", {}, e))));
  $("#btnSave").disabled = !!S.errors.length;
  document.querySelectorAll("[data-needs-valid]").forEach((b) => (b.disabled = !!S.errors.length || !!S.job));
}

const set = (path, v) => { setPath(S.prog, path, v); changed(); };

// ── form widgets ─────────────────────────────────────────────────────────────
function text(path, { placeholder, area, list, onblur } = {}) {
  const el = h(area ? "textarea" : "input", { placeholder, list, rows: area ? 2 : undefined, spellcheck: "false" });
  el.value = getPath(S.prog, path) ?? "";
  el.addEventListener("input", () => set(path, el.value));
  if (onblur) el.addEventListener("blur", onblur);
  return el;
}

function number(path, { min, max, step = 1, log = false, unit = "", fallback } = {}) {
  const v0 = getPath(S.prog, path) ?? fallback ?? min;
  const toR = (v) => (log ? Math.log(v) : v), fromR = (r) => (log ? Math.round(Math.exp(r)) : r);
  const range = h("input", { type: "range", min: toR(min), max: toR(max), step: log ? 0.001 : step });
  const num = h("input", { type: "number", min, max, step, class: "num" });
  range.value = toR(v0); num.value = v0;
  range.addEventListener("input", () => { const v = Number(fromR(Number(range.value)).toFixed(4)); num.value = v; set(path, v); });
  num.addEventListener("input", () => { if (num.value === "") return; const v = Number(num.value); range.value = toR(v); set(path, v); });
  return h("div", { class: "numfield" }, range, num, unit ? h("span", { class: "unit" }, unit) : null);
}

function select(path, options, { onchange } = {}) {
  const el = h("select", {}, options.map((o) => (Array.isArray(o) ? h("option", { value: o[0] }, o[1]) : h("option", { value: o }, o))));
  el.value = String(getPath(S.prog, path) ?? "");
  el.addEventListener("change", () => { const v = el.value; onchange ? onchange(v) : set(path, v); });
  return el;
}

function notes(path, { count, placeholder } = {}) {
  const el = h("input", { class: "notes", placeholder: placeholder || "A2 E3 A3 C4", spellcheck: "false" });
  el.value = Music.list(getPath(S.prog, path));
  el.addEventListener("input", () => {
    const { notes, bad } = Music.parseList(el.value);
    el.classList.toggle("bad", !!bad.length || (count && notes.length !== count));
    if (!bad.length) set(path, notes);
  });
  el.addEventListener("blur", () => { if (!el.classList.contains("bad")) el.value = Music.list(getPath(S.prog, path)); });
  return el;
}

const field = (label, control, hint) => h("label", { class: "field" }, h("span", { class: "lbl" }, label), control, hint ? h("span", { class: "hint" }, hint) : null);
const section = (id, title, sub, ...body) => h("section", { class: "sec", id }, h("h2", {}, title, sub ? h("small", {}, sub) : null), ...body);

// ── editor ───────────────────────────────────────────────────────────────────
function drawEditor() {
  const p = S.prog, opts = S.env.options;
  const ed = $("#editor");
  ed.replaceChildren($("#errors"));

  // identity
  const color = h("input", { type: "color" }); color.value = `#${p.color}`;
  const hex = h("input", { class: "hex", maxlength: 6 }); hex.value = p.color;
  color.addEventListener("input", () => { hex.value = color.value.slice(1).toUpperCase(); set("color", hex.value); });
  hex.addEventListener("input", () => { if (/^[0-9a-f]{6}$/i.test(hex.value)) { color.value = `#${hex.value}`; set("color", hex.value.toUpperCase()); } });
  const tags = h("input", { placeholder: "warm, drifting, night" }); tags.value = (p.tags || []).join(", ");
  tags.addEventListener("input", () => set("tags", tags.value.split(",").map((t) => t.trim()).filter(Boolean)));
  const slug = text("slug");
  slug.addEventListener("input", () => { slug.classList.toggle("bad", !/^[a-z][a-z0-9_]{1,47}$/.test(slug.value)); loadRendersSoon(); });
  ed.append(section("s-identity", "Soundscape", null,
    h("div", { class: "grid2" },
      field("Name", text("name")),
      field("Slug", slug, "file name and pack id: deepwave.<slug>"),
      field("Category", select("category", opts.categories), "sets the session arc and binaural"),
      field("Colour", h("div", { class: "row" }, color, hex))),
    field("Description", text("description", { area: true })),
    field("Tags", tags)));

  // key + drone
  ed.append(section("s-key", "Key & drone", "the engine drone sits on the tonic",
    h("div", { class: "grid3" },
      field("Tonic", select("key.tonic", Music.NAMES.map((n, i) => [i, n]), { onchange: (v) => set("key.tonic", Number(v)) })),
      field("Mode", select("key.mode", ["major", "minor"])),
      field("Drone gain", number("droneGain", { min: 0, max: 1.5, step: 0.01, fallback: 0.6 })))));

  // chords
  const cards = p.chords.map((c, i) => h("div", { class: "chord-card" },
    h("div", { class: "chord-head" }, h("strong", {}, `Chord ${i + 1}`), h("span", { class: "muted" }, `pad${i + 1}`),
      h("button", { class: "small ghost", title: "Hear this chord", onclick: () => playChord(i) }, "▶")),
    field("Notes", notes(`chords.${i}.notes`)),
    h("div", { class: "grid2" },
      field("Top 1st half", topInput(i, 0)),
      field("Top 2nd half", topInput(i, 1)))));
  ed.append(section("s-chords", "Harmony", "four chords = four pad variants, played in order with ~70 s crossfades",
    h("div", { class: "chords" }, cards),
    h("p", { class: "hint" }, "Note names (A2, C#4, Bb3) or MIDI numbers, low to high. The top line is a two-step melody over each chord; leave both empty for none.")));

  // instruments
  ed.append(section("s-inst", "Instruments", "Surge XT patches; body and halo swap roles on alternate chords",
    h("div", { class: "grid2" },
      field("Body (full chord)", text("instruments.body", { list: "patchList" })),
      field("Halo (upper voices, ~7 dB under)", text("instruments.halo", { list: "patchList" })))));

  // air
  const airKind = p.air.surge !== undefined ? "surge" : p.air.proc;
  const airBody = [];
  if (airKind === "surge") airBody.push(field("Patch", text("air.surge", { list: "patchList" })));
  if (airKind === "surge" || airKind === "crystal") airBody.push(field("Tones", notes("air.tones"), "consonant over all four chords"));
  ed.append(section("s-air", "Air", "high shimmer layer: two 30 s variants",
    h("div", { class: "grid2" },
      field("Source", select("_airkind", [["surge", "Surge patch"], ...opts.airProcs.map((k) => [k, `procedural: ${k}`])], { onchange: setAirKind })),
      ...airBody)));
  $("#s-air select").value = airKind;

  // bands + space
  ed.append(section("s-bands", "Bands & space", null,
    h("div", { class: "grid2" },
      field("Pad low-pass", number("bands.padLowPassHz", { min: 1000, max: 16000, log: true, unit: "Hz" })),
      field("Air high-pass", number("bands.airHighPassHz", { min: 200, max: 6000, log: true, unit: "Hz" })),
      field("Breath depth", number("breathDb", { min: 0, max: 12, step: 0.5, unit: "dB", fallback: 5 }), "high-shelf dip once per loop"),
      field("Reverb RT60", number("reverb.rt60Sec", { min: 0.5, max: 12, step: 0.1, unit: "s" })),
      field("Reverb wet", number("reverb.wet", { min: 0, max: 0.6, step: 0.01 }))),
    h("div", { class: "derived", id: "derived" })));

  // texture
  const texOn = !!p.texture;
  ed.append(section("s-tex", "Texture", "environmental bed, ~15–20 dB under the pads",
    h("div", { class: "grid2" },
      field("Preset", select("_tex", [["", "none"], ...opts.textures.map((t) => [t, t])], {
        onchange: (v) => { S.prog.texture = v ? { preset: v, gain: S.prog.texture?.gain ?? 0.25 } : null; changed(); drawEditor(); } })),
      texOn ? field("Gain", number("texture.gain", { min: 0, max: 0.8, step: 0.01 })) : h("span"))));
  $("#s-tex select").value = p.texture?.preset || "";

  ed.append(eventsSection());
  ed.append(arpSection());
  ed.append(advancedSection());
  drawSketchChords();
}

function topInput(i, k) {
  const el = h("input", { class: "notes", placeholder: "—" });
  const top = S.prog.chords[i].top;
  el.value = top ? Music.name(top[k]) : "";
  el.addEventListener("input", () => {
    const c = S.prog.chords[i], other = el.closest(".grid2").querySelectorAll("input")[1 - k];
    const a = Music.parse(el.value), b = Music.parse(other.value);
    const empty = !el.value.trim() && !other.value.trim();
    el.classList.toggle("bad", !!el.value.trim() && a === null);
    if (empty) c.top = null;
    else if (a !== null && b !== null) c.top = k === 0 ? [a, b] : [b, a];
    changed();
  });
  return el;
}

function setAirKind(kind) {
  const prev = S.prog.air;
  const tones = prev.tones || [76, 79, 81, 83, 88];
  S.prog.air = kind === "surge" ? { surge: prev.surge || "patches_factory/Pads/Distant", tones }
    : kind === "crystal" ? { proc: "crystal", tones } : { proc: kind };
  changed(); drawEditor();
}

function drawDerived() {
  const el = $("#derived"); if (!el) return;
  const lp = S.prog.bands?.padLowPassHz || 8000;
  const openness = (Math.min(lp, 7600) - 400) / 7600;
  const depth = Math.round(Math.min(0.85, Math.max(0.1, 1 - openness)) * 100) / 100;
  const cutoff = Math.round(400 + (1 - depth) * 7600);
  el.replaceChildren(h("span", {}, "Engine default depth "), h("b", {}, depth),
    h("span", {}, " → global low-pass at brightness 1.0: "), h("b", {}, `${cutoff} Hz`),
    h("span", { class: "muted" }, "  (compose arcs.default_depth; the arc then moves brightness by category)"));
}

function eventsSection() {
  const evs = S.prog.events || {};
  const rows = Object.entries(evs).map(([name, ev]) => {
    const m = /^synth:(bowl|bell|gong):([\d.]+)$/.exec(ev.asset || "") || [null, "bowl", "220"];
    const upd = (fn) => { fn(S.prog.events[name]); changed(); };
    const nm = h("input", { class: "evname" }); nm.value = name;
    nm.addEventListener("change", () => {
      const nn = nm.value.trim(); if (!nn || nn === name || S.prog.events[nn]) { nm.value = name; return; }
      const out = {}; for (const [k, v] of Object.entries(S.prog.events)) out[k === name ? nn : k] = v;
      S.prog.events = out; changed(); drawEditor();
    });
    const kind = h("select", {}, S.env.options.eventSynths.map((k) => h("option", { value: k }, k))); kind.value = m[1];
    const hz = h("input", { type: "number", min: 20, max: 8000, step: 1, class: "num" }); hz.value = m[2];
    const note = h("span", { class: "muted small" }, Music.nearest(Number(m[2])));
    const asset = () => upd((e) => { e.asset = `synth:${kind.value}:${Number(hz.value)}`; note.textContent = Music.nearest(Number(hz.value)); });
    kind.addEventListener("change", asset); hz.addEventListener("input", asset);
    const num = (get, put, attrs) => { const el = h("input", { type: "number", class: "num", ...attrs }); el.value = get(); el.addEventListener("input", () => el.value !== "" && upd((e) => put(e, Number(el.value)))); return el; };
    return h("tr", {},
      h("td", {}, nm), h("td", {}, kind), h("td", {}, hz, " ", note),
      h("td", {}, num(() => ev.everySec, (e, v) => (e.everySec = v), { min: 5, max: 3600, step: 1 })),
      h("td", {}, num(() => ev.gain, (e, v) => (e.gain = v), { min: 0, max: 1, step: 0.01 })),
      h("td", {}, num(() => ev.activeWhen?.fromRatio ?? 0, (e, v) => ((e.activeWhen ??= { fromRatio: 0, toRatio: 1 }).fromRatio = v), { min: 0, max: 1, step: 0.01 }),
        "–", num(() => ev.activeWhen?.toRatio ?? 1, (e, v) => ((e.activeWhen ??= { fromRatio: 0, toRatio: 1 }).toRatio = v), { min: 0, max: 1, step: 0.01 })),
      h("td", {}, h("button", { class: "small ghost", title: "Hear one strike", onclick: () => strikeOnce(kind.value, Number(hz.value), ev.gain) }, "▶"),
        h("button", { class: "small ghost", title: "Remove", onclick: () => { delete S.prog.events[name]; changed(); drawEditor(); } }, "✕")));
  });
  const add = () => {
    S.prog.events ||= {};
    let n = "bowl", i = 2; while (S.prog.events[n]) n = `bowl_${i++}`;
    const root = Music.hz(48 + (S.prog.key?.tonic ?? 0));
    S.prog.events[n] = { kind: "interval", asset: `synth:bowl:${Math.round(root)}`, everySec: 97, gain: 0.3, activeWhen: { fromRatio: 0.05, toRatio: 0.95 } };
    changed(); drawEditor();
  };
  return section("s-events", "Events", "struck one-shots the engine fires and humanises (pan, level, ±1 semitone)",
    rows.length ? h("table", { class: "events" },
      h("thead", {}, h("tr", {}, ["Name", "Sound", "Pitch (Hz)", "Every (s)", "Gain", "Active (of session)", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, rows)) : h("p", { class: "muted" }, "No events."),
    h("div", { class: "row" }, h("button", { class: "small", onclick: add }, "+ Add event"),
      h("span", { class: "hint" }, "Co-prime periods (67, 97, 131 s…) keep the pattern from repeating. Only inharmonic sounds belong here; pitched glass stays in the air layer.")));
}

function arpSection() {
  const arp = S.prog.arp;
  const toggle = h("input", { type: "checkbox" }); toggle.checked = !!arp;
  toggle.addEventListener("change", () => { S.prog.arp = toggle.checked ? clone(DEFAULT_ARP) : null; changed(); drawEditor(); });
  const head = h("label", { class: "inline" }, toggle, " Arpeggiator layer");
  if (!arp) return section("s-arp", "Arp", "optional moving layer: four variants by pattern and register", head);

  const tuple = (key, i, o) => {
    const path = `arp.${key}.${i}`;
    return number(path, o);
  };
  const phaserOn = h("input", { type: "checkbox" }); phaserOn.checked = !!arp.phaser;
  phaserOn.addEventListener("change", () => { if (phaserOn.checked) S.prog.arp.phaser = [2, 0.5, 0.3]; else delete S.prog.arp.phaser; changed(); drawEditor(); });
  const octaves = h("input", { type: "checkbox" }); octaves.checked = arp.octaves !== false;
  octaves.addEventListener("change", () => { if (octaves.checked) delete S.prog.arp.octaves; else S.prog.arp.octaves = false; changed(); });

  const stepsMode = Array.isArray(arp.steps) ? "custom" : arp.steps === "random" ? "random" : "patterns";
  const stepsSel = h("select", {}, h("option", { value: "patterns" }, "patterns (updown, up, broken, random walk)"),
    h("option", { value: "random" }, "random tones + rests"), h("option", { value: "custom" }, "custom step grid (JSON)"));
  stepsSel.value = stepsMode;
  stepsSel.addEventListener("change", () => {
    const v = stepsSel.value;
    if (v === "patterns") delete S.prog.arp.steps; else if (v === "random") S.prog.arp.steps = "random";
    else S.prog.arp.steps = [[0, null, 2, 0, 3, null, 2, 4, 0, null, 2, 0, 5, 4, 2, null]];
    changed(); drawEditor();
  });
  const cutMode = Array.isArray(arp.cutoffSteps) ? "custom" : arp.cutoffSteps === "random" ? "random" : "none";
  const cutSel = h("select", {}, h("option", { value: "none" }, "smooth sweep"), h("option", { value: "random" }, "random stepped accents"), h("option", { value: "custom" }, "custom accents (JSON)"));
  cutSel.value = cutMode;
  cutSel.addEventListener("change", () => {
    const v = cutSel.value;
    if (v === "none") { delete S.prog.arp.cutoffSteps; delete S.prog.arp.lfoDepth; }
    else if (v === "random") { S.prog.arp.cutoffSteps = "random"; S.prog.arp.lfoDepth ??= 0.4; }
    else { S.prog.arp.cutoffSteps = [1, 0.3, 0.6, 0.3, 0.9, 0.3, 0.65, 0.4]; S.prog.arp.lfoDepth ??= 0.4; }
    changed(); drawEditor();
  });
  const jsonField = (key) => {
    const el = h("textarea", { rows: 3, class: "mono", spellcheck: "false" }); el.value = JSON.stringify(arp[key]);
    el.addEventListener("input", () => { try { S.prog.arp[key] = JSON.parse(el.value); el.classList.remove("bad"); changed(); } catch { el.classList.add("bad"); } });
    return el;
  };
  const restOn = arp.steps === "random" || stepsMode === "patterns";
  return section("s-arp", "Arp", "optional moving layer: four variants by pattern and register", head,
    h("div", { class: "grid2" },
      field("Patch", text("arp.patch", { list: "patchList" })),
      field("Tones", notes("arp.tones"), "sit over all four chords"),
      field("Tempo", number("arp.bpm", { min: 40, max: 160, step: 1, unit: "bpm" })),
      field("Steps per beat", select("arp.division", [1, 2, 3, 4, 6, 8].map((d) => [d, String(d)]), { onchange: (v) => set("arp.division", Number(v)) })),
      field("Loop length", number("arp.bars", { min: 2, max: 32, step: 1, unit: "bars" })),
      field("Gate", number("arp.gate", { min: 0.1, max: 1, step: 0.01, fallback: 0.7 })),
      field("Gain", number("arp.gain", { min: 0, max: 1.2, step: 0.01 })),
      restOn ? field("Rest chance", number("arp.rest", { min: 0, max: 0.9, step: 0.01, fallback: 0 })) : h("span"),
      field("Sequence", stepsSel),
      field("Filter motion", cutSel),
      field("Filter low", tuple("filter", 0, { min: 100, max: 4000, log: true, unit: "Hz" })),
      field("Filter high", tuple("filter", 1, { min: 500, max: 16000, log: true, unit: "Hz" })),
      field("Resonance", tuple("filter", 2, { min: 0, max: 0.9, step: 0.01 })),
      field("Sweeps per loop", number("arp.sweeps", { min: 1, max: 8, step: 1, fallback: 1 })),
      cutMode !== "none" ? field("LFO depth", number("arp.lfoDepth", { min: 0, max: 1, step: 0.01, fallback: 0.4 })) : h("span"),
      field("Echo (beats)", tuple("echo", 0, { min: 0.125, max: 2, step: 0.125 })),
      field("Echo feedback", tuple("echo", 1, { min: 0, max: 0.8, step: 0.01 })),
      field("Echo mix", tuple("echo", 2, { min: 0, max: 0.6, step: 0.01 })),
      field("Octave variants", h("label", { class: "inline" }, octaves, " variants 2 and 4 shift ±1 octave")),
      field("Phaser", h("label", { class: "inline" }, phaserOn, " swirl"))),
    arp.phaser ? h("div", { class: "grid3" },
      field("Phaser cycles/loop", tuple("phaser", 0, { min: 1, max: 8, step: 1 })),
      field("Phaser depth", tuple("phaser", 1, { min: 0, max: 1, step: 0.01 })),
      field("Phaser mix", tuple("phaser", 2, { min: 0, max: 1, step: 0.01 }))) : null,
    stepsMode === "custom" ? field("Step grid", jsonField("steps"), "one list per variant; each step is a tone index (low→high) or null for a rest") : null,
    cutMode === "custom" ? field("Accents", jsonField("cutoffSteps"), "0–1 per step, cycles") : null);
}

function advancedSection() {
  const extras = h("textarea", { rows: 3, class: "mono", spellcheck: "false" });
  extras.value = JSON.stringify(S.prog.extras || {});
  extras.addEventListener("input", () => { try { S.prog.extras = JSON.parse(extras.value || "{}"); extras.classList.remove("bad"); changed(); } catch { extras.classList.add("bad"); } });
  const raw = h("textarea", { rows: 16, class: "mono", spellcheck: "false" });
  const det = h("details", {}, h("summary", {}, "Program JSON"), raw,
    h("div", { class: "row" }, h("button", { class: "small", onclick: () => {
      try { S.prog = JSON.parse(raw.value); changed(); drawEditor(); toast("Applied"); } catch (e) { toast(`Invalid JSON: ${e.message}`, "bad"); }
    } }, "Apply JSON")));
  det.addEventListener("toggle", () => { if (det.open) raw.value = JSON.stringify(S.prog, null, 2); });
  return section("s-adv", "Advanced", null,
    field("Extras", extras, `per pad variant, e.g. {"pad1": {"sing": [[57, 4.0, 26.0, 1.0]]}}: a rubbed bowl (MIDI, start s, length s, level)`),
    det);
}

// ── sketch helpers ───────────────────────────────────────────────────────────
function drawSketchChords() {
  $("#sketchChords").replaceChildren(...S.prog.chords.map((c, i) => h("span", { title: Music.list(c.notes) }, `${i + 1} · ${Music.name(c.notes[0])}`)));
}

async function playChord(i) {
  const c = S.prog.chords[i];
  const s = new Sketch(() => ({ ...S.prog, chords: [c, c, c, c], events: {}, arp: null, texture: null, air: { proc: "none" }, droneGain: 0.3 }));
  s.chordSec = 6; await s.start(); s.nextChordAt = Infinity;
  setTimeout(() => s.stop(), 9000);
}
async function strikeOnce(kind, hz, gain) {
  const s = new Sketch(() => ({ ...S.prog, chords: [], events: {}, arp: null, texture: null, air: { proc: "none" }, droneGain: 0 }));
  await s.start(); s.nextChordAt = Infinity; s._strike(kind, hz, s.ctx.currentTime + 0.05, gain ?? 0.4);
  setTimeout(() => s.stop(), { bowl: 14000, bell: 5000, gong: 16000 }[kind]);
}

// ── render jobs ──────────────────────────────────────────────────────────────
function drawRenderButtons() {
  const box = $("#auditionBtns"); if (!box) return;
  const b = (label, kind, index, title) => h("button", { class: "small", "data-needs-valid": true, title, onclick: () => startJob(kind, index) }, label);
  box.replaceChildren(
    ...[0, 1, 2, 3].map((i) => b(`Chord ${i + 1}`, "pad", i, `Render pad${i + 1} through Surge (45 s loop, raw)`)),
    ...[0, 1].map((i) => b(`Air ${i + 1}`, "air", i, `Render air${i + 1} (30 s loop, raw)`)),
    ...(S.prog.arp ? [0, 1, 2, 3].map((i) => b(`Arp ${i + 1}`, "arp", i, `Render arp${i + 1}`)) : []));
  validateButtons();
}
function validateButtons() { document.querySelectorAll("[data-needs-valid]").forEach((b) => (b.disabled = !!S.errors.length || !!S.job)); }

async function startJob(kind, index = 0) {
  try {
    const job = await api("POST", "/api/jobs", { program: S.prog, kind, index, minutes: Number($("#renderMinutes").value) });
    S.job = job; validateButtons(); showJob(job); pollJob();
  } catch (e) { toast(e.message, "bad"); }
}

function showJob(job) {
  $("#job").hidden = false;
  $("#jobStage").textContent = `${job.kind === "full" ? "Build + preview" : `${job.kind}${job.index + 1}`} · ${job.slug}: ${job.stage}`;
  $("#jobElapsed").textContent = `${Math.round(job.elapsed)} s`;
  $("#jobSpin").hidden = job.status !== "running";
  $("#btnCancel").hidden = job.status !== "running";
  const log = $("#jobLog"), atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  log.textContent = job.log.join("\n");
  if (atBottom) log.scrollTop = log.scrollHeight;
  $("#job").className = `job ${job.status}`;
}

function pollJob() {
  clearTimeout(S.jobPoll);
  S.jobPoll = setTimeout(async () => {
    const job = await api("GET", `/api/jobs/${S.job.id}`).catch(() => null);
    if (!job) return pollJob();
    showJob(job);
    if (job.status === "running") return pollJob();
    S.job = null; validateButtons();
    toast(job.status === "done" ? "Render finished" : "Render failed: see the log", job.status === "done" ? "ok" : "bad");
    if (job.slug === S.prog.slug) loadRenders();
    refreshLibrary();
  }, 1000);
}

async function resumeJobs() {
  const jobs = await api("GET", "/api/jobs").catch(() => []);
  const running = jobs.find((j) => j.status === "running");
  if (running) { S.job = running; showJob(running); pollJob(); validateButtons(); }
}

// ── results ──────────────────────────────────────────────────────────────────
let rendersTimer;
function loadRendersSoon() { clearTimeout(rendersTimer); rendersTimer = setTimeout(loadRenders, 400); }
async function loadRenders() {
  const slug = S.prog.slug;
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(slug)) return;
  S.renders = await api("GET", `/api/renders/${slug}`).catch(() => null);
  drawResults();
}

function audioRow(label, f, extra) {
  return h("div", { class: "track" }, h("div", { class: "track-name" }, label, extra || null), h("audio", { controls: true, preload: "none", src: f.url }));
}

function drawResults() {
  const r = S.renders, body = $("#resultsBody");
  $("#resultsFor").textContent = S.prog.slug;
  if (!r || (!r.mixes.length && !r.auditions.length)) { body.className = "muted"; body.replaceChildren("Nothing rendered for this slug yet."); return; }
  body.className = "";
  const kids = [h("div", { class: "stale", id: "stale", hidden: true }, "The program has changed since this render.")];
  if (r.mixes.length) {
    const pv = r.preview || {}, qa = r.qa;
    const label = { mix: "Mix (as the app plays it)", mix_open: "Mix, no global low-pass", mix_shipped: "Mix from the encoded OGGs" };
    kids.push(h("div", { class: "meta" },
      qa ? h("span", { class: `qa ${qa.verdict}` }, `QA ${qa.verdict}`) : null,
      pv.globalLowPassHz ? h("span", {}, `global LP ${pv.globalLowPassHz} Hz`) : null,
      pv.minutes ? h("span", {}, `${pv.minutes} min`) : null));
    if (qa?.issues?.length) kids.push(h("details", { class: "qa-issues" }, h("summary", {}, `${qa.issues.length} QA note(s)`), h("ul", {}, qa.issues.map((i) => h("li", {}, i)))));
    r.mixes.forEach((m) => kids.push(audioRow(label[m.name] || m.name, m)));
    if (r.stems.length) kids.push(h("h4", {}, "Stems"), ...r.stems.map((s) => audioRow(s.name, s, pv.stemLufs && s.name in pv.stemLufs ? h("span", { class: "muted" }, pv.stemLufs[s.name] === null ? " silent in this preview" : ` ${pv.stemLufs[s.name]} LUFS`) : null)));
    if (r.layers.length) kids.push(h("details", {}, h("summary", {}, `Loops (${r.layers.length})`), ...r.layers.map((s) => audioRow(s.name, s))));
  }
  if (r.auditions.length) kids.push(h("h4", {}, "Auditions (raw loops)"), ...r.auditions.map((s) => audioRow(s.name, s)));
  body.replaceChildren(...kids);
  markStale();
}

function markStale() {
  const el = $("#stale"); if (!el || !S.renders?.program) return;
  el.hidden = JSON.stringify(S.renders.program) === JSON.stringify(S.prog);
}

// ── chrome ───────────────────────────────────────────────────────────────────
function toast(msg, kind = "ok") {
  const t = h("div", { class: `toast ${kind}` }, msg); document.body.append(t);
  setTimeout(() => t.classList.add("gone"), 3200); setTimeout(() => t.remove(), 3800);
}

function dialog(title, body, okLabel = "OK") {
  const d = $("#dlg");
  $("#dlgTitle").textContent = title; $("#dlgBody").replaceChildren(body); $("#dlgOk").textContent = okLabel;
  d.showModal();
  return new Promise((res) => d.addEventListener("close", () => res(d.returnValue === "ok" ? true : null), { once: true }));
}

async function duplicate() {
  const name = h("input", { value: `${S.prog.name} copy` }), slug = h("input", { value: uniqueSlug(`${S.prog.slug}_copy`) });
  if ((await dialog("Duplicate as", h("div", {}, field("Name", name), field("Slug", slug)), "Duplicate")) === null) return;
  const p = clone(S.prog); p.name = name.value; p.slug = slug.value;
  S.savedJson = JSON.stringify(S.prog);    // the original stays as it was; no discard prompt
  load(p, "new");
}

function wireGlobal() {
  $("#btnSave").addEventListener("click", save);
  $("#btnExport").addEventListener("click", exportJson);
  $("#btnImport").addEventListener("click", () => $("#fileImport").click());
  $("#fileImport").addEventListener("change", (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; });
  $("#btnNew").addEventListener("click", newProgram);
  $("#libFilter").addEventListener("input", drawLibrary);
  $("#btnBuild").setAttribute("data-needs-valid", "");
  $("#btnBuild").addEventListener("click", () => startJob("full"));
  $("#btnCancel").addEventListener("click", () => S.job && api("DELETE", `/api/jobs/${S.job.id}`));
  $("#btnSketch").addEventListener("click", async () => {
    if (sketch.playing) { sketch.stop(); $("#btnSketch").textContent = "▶ Play sketch"; }
    else { sketch.chordSec = Number($("#sketchLen").value); await sketch.start(); $("#btnSketch").textContent = "■ Stop sketch"; }
  });
  $("#sketchLen").addEventListener("change", () => (sketch.chordSec = Number($("#sketchLen").value)));
  $("#sketchVol").addEventListener("input", (e) => sketch.setVolume(Number(e.target.value)));
  const dup = h("button", { class: "ghost", title: "Copy this program under a new slug" }, "Duplicate");
  dup.addEventListener("click", duplicate);
  $(".actions").prepend(dup);
  document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } });
  window.addEventListener("beforeunload", (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } });
  resumeJobs();
}

boot().catch((e) => { document.body.prepend(h("div", { class: "fatal" }, `Studio failed to start: ${e.message}`)); console.error(e); });
