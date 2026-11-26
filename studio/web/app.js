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
  drawEditor(); changed(false); drawLibrary(); loadRenders(); histReset();
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
// undo/redo: typing and slider drags within 600 ms coalesce into one step;
// discrete actions (buttons, keys, pickers) go through `act`, one step each
function act(fn) { histCommit(); fn(); changed(); histCommit(); }
const H = { past: [], future: [], last: null, timer: null };
function histReset() { H.past = []; H.future = []; H.last = JSON.stringify(S.prog); clearTimeout(H.timer); drawHistButtons(); }
function histCommit() {
  clearTimeout(H.timer);
  const now = JSON.stringify(S.prog);
  if (now === H.last) return;
  H.past.push(H.last); if (H.past.length > 200) H.past.shift();
  H.future = []; H.last = now; drawHistButtons();
}
function histStep(dir) {
  histCommit();
  const from = dir < 0 ? H.past : H.future, to = dir < 0 ? H.future : H.past;
  if (!from.length) return;
  to.push(H.last); H.last = from.pop();
  S.prog = JSON.parse(H.last);
  drawEditor(); changed(true, false); drawHistButtons();
  toast(dir < 0 ? "Undone" : "Redone");
}
function drawHistButtons() {
  if ($("#btnUndo")) { $("#btnUndo").disabled = !H.past.length && JSON.stringify(S.prog) === H.last; $("#btnRedo").disabled = !H.future.length; }
}

let validateTimer;
function changed(touch = true, record = true) {
  const p = S.prog;
  if (touch && record) { clearTimeout(H.timer); H.timer = setTimeout(histCommit, 600); if ($("#btnUndo")) $("#btnUndo").disabled = false; }
  $("#docTitle").textContent = `${p.name || "Untitled"}`;
  $("#docSwatch").style.background = `#${p.color}`;
  $("#docSource").textContent = { saved: `programs/${p.slug}.json`, builtin: "built-in · not saved", new: "new · not saved" }[S.source];
  $("#docDirty").hidden = !dirty();
  if ($("#btnDelete")) $("#btnDelete").hidden = S.source !== "saved";
  if (touch) sketch.update(p);
  clearTimeout(validateTimer);
  validateTimer = setTimeout(validate, touch ? 250 : 0);
  drawDerived();
  drawRenderButtons();
  markStale();
  drawTabs();
}

async function validate() {
  try { S.errors = (await api("POST", "/api/validate", S.prog)).errors; } catch (e) { S.errors = [e.message]; }
  const box = $("#errors");
  box.hidden = !S.errors.length;
  drawTabs();
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
// Tabs, so each part of a soundscape is one screen instead of one long page.
const TABS = [
  ["sound", "Sound", ["name", "slug", "category", "color", "description", "tags", "key", "droneGain", "format", "version"]],
  ["harmony", "Harmony", ["chords"]],
  ["layers", "Layers", ["instruments", "air", "texture"]],
  ["space", "Space", ["bands", "breathDb", "reverb"]],
  ["events", "Events", ["events"]],
  ["arp", "Arp", ["arp"]],
  ["advanced", "Advanced", ["extras"]],
];
S.tab = (() => { try { return localStorage.getItem("studio.tab") || "harmony"; } catch { return "harmony"; } })();

function tabOfError(e) {
  const key = e.split(/[.:[ ]/)[0];
  return (TABS.find(([, , keys]) => keys.includes(key)) || TABS[0])[0];
}

function drawTabs() {
  const bar = $("#tabs"); if (!bar) return;
  const bad = new Set(S.errors.map(tabOfError));
  bar.replaceChildren(...TABS.map(([id, label]) => h("button", {
    class: `tab${S.tab === id ? " on" : ""}${bad.has(id) ? " bad" : ""}`,
    onclick: () => { S.tab = id; try { localStorage.setItem("studio.tab", id); } catch { /* */ } drawEditor(); },
  }, label, id === "arp" && !S.prog.arp ? h("span", { class: "off" }, " off") : null,
     id === "events" ? h("span", { class: "count" }, ` ${Object.keys(S.prog.events || {}).length}`) : null)));
}

function drawEditor() {
  const p = S.prog, opts = S.env.options;
  const ed = $("#editor");
  ed.replaceChildren(h("nav", { class: "tabs", id: "tabs" }), $("#errors"));
  drawTabs();
  const show = { sound: drawSoundTab, harmony: drawHarmonyTab, layers: drawLayersTab, space: drawSpaceTab,
    events: () => ed.append(eventsSection()), arp: () => ed.append(...[arpSection()].flat()), advanced: () => ed.append(advancedSection()) };
  (show[S.tab] || drawHarmonyTab)(ed, p, opts);
  drawSketchChords();
  drawDerived();
}

function drawSoundTab(ed, p, opts) {
  const color = h("input", { type: "color" }); color.value = `#${p.color}`;
  const hex = h("input", { class: "hex", maxlength: 6 }); hex.value = p.color;
  color.addEventListener("input", () => { hex.value = color.value.slice(1).toUpperCase(); set("color", hex.value); });
  hex.addEventListener("input", () => { if (/^[0-9a-f]{6}$/i.test(hex.value)) { color.value = `#${hex.value}`; set("color", hex.value.toUpperCase()); } });
  const tags = h("input", { placeholder: "warm, drifting, night" }); tags.value = (p.tags || []).join(", ");
  tags.addEventListener("input", () => set("tags", tags.value.split(",").map((t) => t.trim()).filter(Boolean)));
  const slug = text("slug");
  slug.addEventListener("input", () => { slug.classList.toggle("bad", !/^[a-z][a-z0-9_]{1,47}$/.test(slug.value)); loadRendersSoon(); });
  const name = text("name");
  name.addEventListener("input", () => {           // a new program's slug follows its name until edited by hand
    if (S.source === "new" && !S.slugTouched) { const s2 = name.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "s$1") || "untitled"; slug.value = s2; set("slug", s2); loadRendersSoon(); }
  });
  slug.addEventListener("keydown", () => (S.slugTouched = true));
  ed.append(section("s-identity", "Soundscape", null,
    h("div", { class: "grid2" },
      field("Name", name),
      field("Slug", slug, "file name and pack id: deepwave.<slug>"),
      field("Category", select("category", opts.categories), "sets the session arc and binaural"),
      field("Colour", h("div", { class: "row" }, color, hex))),
    field("Description", text("description", { area: true })),
    field("Tags", tags)));
  ed.append(keySection(true));
}

function keySection(withDrone) {
  const transpose = (n) => h("button", { class: "small", title: `Move the key and everything in it ${n > 0 ? "up" : "down"} a semitone`, onclick: () => transposeAll(n) }, n > 0 ? "+1" : "−1");
  return section("s-key", "Key & drone", "the engine drone sits on the tonic",
    h("div", { class: "grid3" },
      field("Tonic", select("key.tonic", Music.NAMES.map((n, i) => [i, n]), { onchange: (v) => set("key.tonic", Number(v)) })),
      field("Mode", select("key.mode", ["major", "minor"])),
      withDrone ? field("Drone gain", number("droneGain", { min: 0, max: 1.5, step: 0.01, fallback: 0.6 })) : h("span")),
    h("div", { class: "row" }, h("span", { class: "hint" }, "Change key: moves the tonic, all chords, top lines, air and arp tones, and event pitches together"),
      transpose(-1), transpose(1)));
}

function drawHarmonyTab(ed, p) {
  ed.append(section("s-chords", "Harmony", "four chords = four pad variants, played in order with ~70 s crossfades",
    h("div", { class: "chords" }, p.chords.map((c, i) => chordCard(i))),
    h("p", { class: "hint" }, "Type a chord name (Am9, Fmaj7, G6/9, C/E) for a spread voicing like the built-in themes, click keys to add or remove notes, or edit the note list. Alt-click a key to set the top line (1st click: first half, 2nd: second half).")));
  ed.append(keySection(false));
}

function drawLayersTab(ed, p, opts) {
  ed.append(section("s-inst", "Instruments", "Surge XT patches; body and halo swap roles on alternate chords",
    h("div", { class: "grid2" },
      field("Body (full chord)", patchPicker("instruments.body")),
      field("Halo (upper voices, ~7 dB under)", patchPicker("instruments.halo")))));

  const airKind = p.air.surge !== undefined ? "surge" : p.air.proc;
  const airBody = [];
  if (airKind === "surge") airBody.push(field("Patch", patchPicker("air.surge")));
  if (airKind === "surge" || airKind === "crystal") airBody.push(field("Tones", tonesField("air.tones", 72, 91), "consonant over all four chords"));
  const airSel = select("_airkind", [["surge", "Surge patch"], ...opts.airProcs.map((k) => [k, `procedural: ${k.replace("_", " ")}`])], { onchange: setAirKind });
  airSel.value = airKind;
  ed.append(section("s-air", "Air", "high shimmer layer: two 30 s variants",
    h("div", { class: "grid2" }, field("Source", airSel), ...airBody)));

  const texSel = select("_tex", [["", "none"], ...opts.textures.map((t) => [t, t.replace("_", " ")])], {
    onchange: (v) => { S.prog.texture = v ? { preset: v, gain: S.prog.texture?.gain ?? 0.25 } : null; changed(); drawEditor(); } });
  texSel.value = p.texture?.preset || "";
  ed.append(section("s-tex", "Texture", "environmental bed, ~15–20 dB under the pads",
    h("div", { class: "grid2" }, field("Preset", texSel),
      p.texture ? field("Gain", number("texture.gain", { min: 0, max: 0.8, step: 0.01 })) : h("span"))));
}

function drawSpaceTab(ed) {
  ed.append(section("s-bands", "Bands & space", null,
    h("div", { class: "grid2" },
      field("Pad low-pass", number("bands.padLowPassHz", { min: 1000, max: 16000, log: true, unit: "Hz" }), "lower = darker pads"),
      field("Air high-pass", number("bands.airHighPassHz", { min: 200, max: 6000, log: true, unit: "Hz" }), "higher = thinner, airier shimmer"),
      field("Breath depth", number("breathDb", { min: 0, max: 12, step: 0.5, unit: "dB", fallback: 5 }), "high-shelf dip once per loop"),
      field("Drone gain", number("droneGain", { min: 0, max: 1.5, step: 0.01, fallback: 0.6 })),
      field("Reverb length (RT60)", number("reverb.rt60Sec", { min: 0.5, max: 12, step: 0.1, unit: "s" })),
      field("Reverb amount", number("reverb.wet", { min: 0, max: 0.6, step: 0.01 }))),
    h("div", { class: "derived", id: "derived" })));
}

// ── chord card: name, keyboard, notes, transpose, top line ─────────────────────
const KB_LO = 36, KB_HI = 84;           // C2–C6
function chordCard(i) {
  const c = S.prog.chords[i];
  const nameIn = h("input", { class: "chordname", placeholder: Music.identify(c.notes) || "Am9", spellcheck: "false" });
  const label = h("span", { class: "chordlabel" }, Music.identify(c.notes) || "");
  const applyName = () => {
    const v = Music.voice(nameIn.value);
    nameIn.classList.toggle("bad", !!nameIn.value.trim() && !v);
    if (v) { act(() => { c.notes = v; refresh(); }); nameIn.value = ""; nameIn.placeholder = Music.identify(v); }
  };
  nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyName(); } });
  nameIn.addEventListener("blur", applyName);

  const listIn = h("input", { class: "notes", spellcheck: "false" });
  listIn.value = Music.list(c.notes);
  listIn.addEventListener("input", () => {
    const { notes, bad } = Music.parseList(listIn.value);
    listIn.classList.toggle("bad", !!bad.length);
    if (!bad.length && notes.length) { c.notes = [...notes].sort((a, b) => a - b); refresh(false); }
  });

  const kb = h("div", { class: "kb" });
  const tops = [topInput(i, 0), topInput(i, 1)];
  function refresh(rewriteList = true) {
    c.notes = [...new Set(c.notes)].sort((a, b) => a - b);
    if (rewriteList) listIn.value = Music.list(c.notes);
    label.textContent = Music.identify(c.notes);
    tops.forEach((t, k) => (t.value = c.top ? Music.name(c.top[k]) : ""));
    drawKeyboard(kb, c, (m, alt) => {
      histCommit();
      if (alt) {                                   // set top line: first, then second half
        const t = c.top ? [...c.top] : [m, m];
        S.topNext = S.topNext === `${i}:1` ? `${i}:0` : `${i}:1`;
        if (S.topNext === `${i}:1`) { t[0] = m; t[1] = c.top ? t[1] : m; } else t[1] = m;
        c.top = t;
      } else if (c.notes.includes(m)) { if (c.notes.length > 2) c.notes = c.notes.filter((n) => n !== m); }
      else c.notes = [...c.notes, m];
      ping(m); refresh(); changed(); histCommit();
    });
    drawSketchChords();
  }
  const shift = (n) => () => act(() => {
    c.notes = c.notes.map((x) => x + n);
    if (c.top) c.top = c.top.map((x) => x + n);
    refresh();
  });
  const copyNext = () => { const j = (i + 1) % 4; act(() => (S.prog.chords[j] = clone(c))); drawEditor(); toast(`Copied to chord ${j + 1}`); };
  refresh();
  return h("div", { class: "chord-card" },
    h("div", { class: "chord-head" }, h("strong", {}, `Chord ${i + 1}`), label,
      h("button", { class: "small ghost", title: "Hear this chord", onclick: () => playChord(i) }, "▶ Hear")),
    kb,
    h("div", { class: "chord-controls" },
      field("Chord name", nameIn),
      field("Move", h("div", { class: "row tight" },
        h("button", { class: "small ghost", title: "Down a semitone", onclick: shift(-1) }, "♭"),
        h("button", { class: "small ghost", title: "Up a semitone", onclick: shift(1) }, "♯"),
        h("button", { class: "small ghost", title: "Down an octave", onclick: shift(-12) }, "8↓"),
        h("button", { class: "small ghost", title: "Up an octave", onclick: shift(12) }, "8↑"),
        h("button", { class: "small ghost", title: `Copy to chord ${(i + 1) % 4 + 1}`, onclick: copyNext }, "⧉"))),
      field("Notes", listIn),
      h("div", { class: "grid2 tops" },
        field("Top line, 1st half", tops[0]),
        field("2nd half", tops[1]))));
}

function drawKeyboard(el, c, onKey) {
  const whites = [], blacks = [];
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  let wi = 0;
  for (let m = KB_LO; m <= KB_HI; m++) {
    const on = c.notes.includes(m), top = c.top && c.top.includes(m);
    const cls = `${on ? " on" : ""}${top ? " tl" : ""}`;
    const title = `${Music.name(m)}${on ? " (in chord)" : ""}${top ? " (top line)" : ""}`;
    const key = h("div", { title, onmousedown: (e) => { e.preventDefault(); onKey(m, e.altKey); } });
    if (isBlack(m)) { key.className = `bk${cls}`; key.style.left = `calc(${wi} * var(--w) - var(--w) * 0.32)`; blacks.push(key); }
    else { key.className = `wk${cls}`; if (m % 12 === 0) key.append(h("span", {}, Music.name(m))); whites.push(key); wi++; }
  }
  el.style.setProperty("--n", wi);
  el.replaceChildren(...whites, ...blacks);
}

let pingCtx;
function ping(m) {
  try {
    pingCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = pingCtx.currentTime, o = pingCtx.createOscillator(), g = pingCtx.createGain();
    o.type = "triangle"; o.frequency.value = Music.hz(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(pingCtx.destination); o.start(t); o.stop(t + 1.3);
  } catch { /* no audio */ }
}

// move everything pitched by n semitones: key, chords, tops, air/arp tones, event pitches
function transposeAll(n) {
  histCommit();
  const p = S.prog, up = (x) => x + n;
  p.key.tonic = ((p.key.tonic + n) % 12 + 12) % 12;
  p.chords.forEach((c) => { c.notes = c.notes.map(up); if (c.top) c.top = c.top.map(up); });
  if (p.air.tones) p.air.tones = p.air.tones.map(up);
  if (p.arp?.tones) p.arp.tones = p.arp.tones.map(up);
  for (const ev of Object.values(p.events || {})) {
    const m = /^synth:(\w+):([\d.]+)$/.exec(ev.asset || "");
    if (m) ev.asset = `synth:${m[1]}:${Math.round(Number(m[2]) * Math.pow(2, n / 12))}`;
  }
  for (const spec of Object.values(p.extras || {})) for (const s2 of spec.sing || []) s2[0] += n;
  changed(); histCommit(); drawEditor();
  toast(`Moved to ${Music.pcName(p.key.tonic)} ${p.key.mode}`);
}

function tonesField(path, lo, hi) {
  const input = notes(path);
  const suggest = h("button", { class: "small", type: "button", title: "Use notes shared by the four chords, in this layer's register",
    onclick: () => {
      const cur = getPath(S.prog, path) || [];
      const a = cur.length ? Math.min(...cur) : lo, b = cur.length ? Math.max(...cur, a + 12) : hi;
      const t = Music.commonTones(S.prog.chords, a, b);
      if (!t.length) return toast("The chords share no notes to build from.", "bad");
      act(() => setPath(S.prog, path, t)); input.value = Music.list(t); toast(`Tones: ${Music.list(t)}`);
    } }, "Fit to chords");
  return h("div", { class: "row tight" }, input, suggest);
}

// ── patch picker: folder + name instead of a long path ─────────────────────────
function patchLabel(path) {
  const parts = (path || "").split("/");
  return { name: parts.at(-1) || "—", where: parts.slice(0, -1).join(" / ").replace("patches_factory", "Factory").replace("patches_3rdparty", "3rd party") };
}

function patchPicker(path) {
  const btn = h("button", { class: "patch", type: "button" });
  const draw = () => { const l = patchLabel(getPath(S.prog, path)); btn.replaceChildren(h("span", { class: "pname" }, l.name), h("span", { class: "pwhere" }, l.where)); };
  draw();
  btn.addEventListener("click", async () => {
    const v = await choosePatch(getPath(S.prog, path));
    if (v) { act(() => setPath(S.prog, path, v)); draw(); }
  });
  return btn;
}

async function choosePatch(current) {
  const all = S.env.options.patches, used = new Set(S.env.options.usedPatches || []);
  const q = h("input", { placeholder: "Search patches…", autocomplete: "off" });
  const onlyUsed = h("input", { type: "checkbox" }); onlyUsed.checked = all.length === used.size;
  const custom = h("input", { placeholder: "or type a path: patches_factory/Pads/Still", spellcheck: "false" }); custom.value = current || "";
  const list = h("div", { class: "patchlist" });
  let chosen = current;
  const groupOf = (p) => { const parts = p.split("/"); return parts.length > 2 ? parts.at(-2) : parts[0]; };
  const draw = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = all.filter((p) => (!onlyUsed.checked || used.has(p)) && words.every((w) => p.toLowerCase().includes(w)));
    const groups = {};
    for (const p of hits) (groups[groupOf(p)] ||= []).push(p);
    const order = Object.keys(groups).sort((a, b) => (b === "Pads") - (a === "Pads") || a.localeCompare(b));
    list.replaceChildren(...(hits.length ? order.map((g) => h("div", { class: "pgroup" }, h("h5", {}, g, h("small", {}, ` ${groups[g].length}`)),
      ...groups[g].map((p) => { const l = patchLabel(p);
        return h("div", { class: `pitem${p === chosen ? " on" : ""}`, title: p, onclick: (e) => { chosen = p; custom.value = p; list.querySelectorAll(".pitem.on").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); }, ondblclick: () => { chosen = p; $("#dlgOk").click(); } },
          l.name, used.has(p) ? h("span", { class: "used", title: "used by a built-in theme" }, "●") : null, h("span", { class: "pwhere" }, l.where)); })))
      : [h("p", { class: "muted" }, "No patches match.")]));
  };
  q.addEventListener("input", draw); onlyUsed.addEventListener("change", draw);
  custom.addEventListener("input", () => (chosen = custom.value.trim()));
  draw();
  setTimeout(() => { q.focus(); list.querySelector(".on")?.scrollIntoView({ block: "center" }); }, 50);
  const ok = await dialog("Choose a Surge patch", h("div", { class: "picker" },
    h("div", { class: "row tight" }, q, h("label", { class: "inline nowrap" }, onlyUsed, " used in themes")), list, custom,
    h("p", { class: "hint" }, all.length === used.size ? "Surge's patch library wasn't found on this machine (SURGE_DATA), so only patches used by the built-in themes are listed." : "● = used by a built-in theme. Double-click to pick.")), "Use patch");
  return ok ? chosen : null;
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

// compose/arcs.py ARCS[category] maintain-phase brightness: what compose.preview renders at
const MAINTAIN_BRIGHTNESS = { sleep: 0.7, focus: 1.0, energy: 1.15, calm: 0.88, meditate: 0.85, explore: 1.0, nature: 0.95 };
function engineCutoff(p) {
  const lp = p.bands?.padLowPassHz || 8000;
  const depth = Math.round(Math.min(0.85, Math.max(0.1, 1 - (Math.min(lp, 7600) - 400) / 7600)) * 100) / 100;
  const b = MAINTAIN_BRIGHTNESS[p.category] ?? 1;
  return { depth, b, open: Math.round(400 + (1 - depth) * 7600), maintain: Math.round(400 + Math.min(1, (1 - depth) * b) * 7600) };
}

function drawDerived() {
  const el = $("#derived"); if (!el) return;
  const c = engineCutoff(S.prog);
  el.replaceChildren(h("span", {}, "Engine default depth "), h("b", {}, c.depth),
    h("span", {}, " → whole-mix low-pass "), h("b", {}, `${c.open} Hz`), h("span", {}, " at the start, "),
    h("b", {}, `${c.maintain} Hz`), h("span", {}, ` mid-session (${S.prog.category} arc, brightness ${c.b}).`),
    h("span", { class: "muted" }, " The preview mix and the sketch use the mid-session value."));
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
  const more = h("details", { class: "more" }, h("summary", {}, "More arp settings: sweeps, LFO, octaves, phaser, step grids"),
    h("div", { class: "grid2" },
      field("Sweeps per loop", number("arp.sweeps", { min: 1, max: 8, step: 1, fallback: 1 })),
      cutMode !== "none" ? field("LFO depth", number("arp.lfoDepth", { min: 0, max: 1, step: 0.01, fallback: 0.4 })) : h("span"),
      field("Octave variants", h("label", { class: "inline" }, octaves, " variants 2 and 4 shift ±1 octave")),
      field("Phaser", h("label", { class: "inline" }, phaserOn, " swirl"))),
    arp.phaser ? h("div", { class: "grid3" },
      field("Phaser cycles/loop", tuple("phaser", 0, { min: 1, max: 8, step: 1 })),
      field("Phaser depth", tuple("phaser", 1, { min: 0, max: 1, step: 0.01 })),
      field("Phaser mix", tuple("phaser", 2, { min: 0, max: 1, step: 0.01 }))) : null,
    stepsMode === "custom" ? field("Step grid", jsonField("steps"), "one list per variant; each step is a tone index (low→high) or null for a rest") : null,
    cutMode === "custom" ? field("Accents", jsonField("cutoffSteps"), "0–1 per step, cycles") : null);
  more.open = !!S.arpMore;
  more.addEventListener("toggle", () => (S.arpMore = more.open));
  return [
    section("s-arp", "Arp", "optional moving layer: four variants by pattern and register", head,
      h("div", { class: "grid2" },
        field("Patch", patchPicker("arp.patch")),
        field("Tones", tonesField("arp.tones", 60, 79), "sit over all four chords"),
        field("Tempo", number("arp.bpm", { min: 40, max: 160, step: 1, unit: "bpm" })),
        field("Steps per beat", select("arp.division", [1, 2, 3, 4, 6, 8].map((d) => [d, String(d)]), { onchange: (v) => set("arp.division", Number(v)) })),
        field("Sequence", stepsSel),
        restOn ? field("Rest chance", number("arp.rest", { min: 0, max: 0.9, step: 0.01, fallback: 0 })) : h("span"),
        field("Gate (note length)", number("arp.gate", { min: 0.1, max: 1, step: 0.01, fallback: 0.7 })),
        field("Loop length", number("arp.bars", { min: 2, max: 32, step: 1, unit: "bars" })),
        field("Gain", number("arp.gain", { min: 0, max: 1.2, step: 0.01 })))),
    section("s-arpfx", "Arp filter & echo", null,
      h("div", { class: "grid2" },
        field("Filter motion", cutSel),
        field("Resonance", tuple("filter", 2, { min: 0, max: 0.9, step: 0.01 })),
        field("Filter low", tuple("filter", 0, { min: 100, max: 4000, log: true, unit: "Hz" })),
        field("Filter high", tuple("filter", 1, { min: 500, max: 16000, log: true, unit: "Hz" })),
        field("Echo (beats)", tuple("echo", 0, { min: 0.125, max: 2, step: 0.125 })),
        field("Echo feedback", tuple("echo", 1, { min: 0, max: 0.8, step: 0.01 })),
        field("Echo mix", tuple("echo", 2, { min: 0, max: 0.6, step: 0.01 }))),
      more),
  ];
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
  if (kind === "full" && S.library.builtin.some((p) => p.slug === S.prog.slug) && !S.warnedBuiltin?.[S.prog.slug]) {
    const msg = h("p", {}, `This rebuilds deepwave.${S.prog.slug}, the pack of the built-in theme, from this program. Duplicate first to keep both.`);
    if ((await dialog("Rebuild a built-in pack?", msg, "Build anyway")) === null) return;
    (S.warnedBuiltin ||= {})[S.prog.slug] = true;
  }
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

async function deleteProgram() {
  if (S.source !== "saved") return toast("Only saved programs can be deleted.", "bad");
  if ((await dialog("Delete program?", h("p", {}, `Delete programs/${S.prog.slug}.json? Its renders stay in compose/${S.prog.slug}/.`), "Delete")) === null) return;
  try {
    await api("DELETE", `/api/programs/${S.prog.slug}`);
    S.savedJson = JSON.stringify(S.prog); toast(`Deleted programs/${S.prog.slug}.json`);
    await refreshLibrary(); S.source = "new"; S.savedJson = null; changed(false); drawLibrary();
  } catch (e) { toast(e.message, "bad"); }
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
  const undo = h("button", { class: "ghost icon", id: "btnUndo", title: "Undo (⌘Z)", onclick: () => histStep(-1) }, "↶");
  const redo = h("button", { class: "ghost icon", id: "btnRedo", title: "Redo (⇧⌘Z)", onclick: () => histStep(1) }, "↷");
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" && e.key.toLowerCase() !== "y") return;
    if ($("#dlg").open) return;
    e.preventDefault(); histStep(e.key.toLowerCase() === "y" || e.shiftKey ? 1 : -1);
  });
  const del = h("button", { class: "ghost", id: "btnDelete", title: "Delete programs/<slug>.json (renders are kept)" }, "Delete");
  del.addEventListener("click", deleteProgram);
  $(".actions").prepend(del);
  const dup = h("button", { class: "ghost", title: "Copy this program under a new slug" }, "Duplicate");
  dup.addEventListener("click", duplicate);
  $(".actions").prepend(dup);
  $(".actions").prepend(undo, redo);
  drawHistButtons();
  document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } });
  window.addEventListener("beforeunload", (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } });
  resumeJobs();
}

boot().catch((e) => { document.body.prepend(h("div", { class: "fatal" }, `Studio failed to start: ${e.message}`)); console.error(e); });
