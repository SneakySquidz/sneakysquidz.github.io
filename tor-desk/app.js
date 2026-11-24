// ToR Desk front end: plain JS, no build step.
// Two kinds of profile: a FIRM (company eligibility, references, roster) and an EXPERT (one person's CV).
// A ToR / call / concept note is read once, then scored against either kind.
const $ = (s, el = document) => el.querySelector(s);
const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const BUSY = ["queued", "reading", "triaging", "checking"];
const BUSY_TEXT = { queued: "Starting", reading: "Reading the documents (1-3 min)", triaging: "Scoring against the profile (1-2 min)", checking: "Checking the draft bid (1-3 min)" };
const CW = { "knock-out": 3, scored: 2, formal: 1 };
const KIND = { firm: "Firm", expert: "Expert" };
const kindOf = k => ({ cv: "expert", company: "firm" }[k] || (k in KIND ? k : "firm"));
const PRIO = [["must", "Must do"], ["should", "Should do"], ["could", "Could do"]];
const view = $("#view");
let CFG, PROFILES = [], A = null, poll = null, tab = "report", busySince = 0, dirty = false;
const NOFILT = () => ({ q: "", type: "", crit: "", status: "", applies: "", only: null });
let filt = NOFILT();
// Read-only demo: a page that sets window.TOR_DEMO = {config, profiles, analysis} runs with no server.
const DEMO = window.TOR_DEMO || null;
function demoApi(path, opts) {
  const a = DEMO.analysis;
  if ((opts.method || "GET").toUpperCase() === "GET") {
    if (path === "/api/config") return DEMO.config;
    if (path === "/api/profiles") return DEMO.profiles;
    if (path === `/api/analyses/${a.id}`) return structuredClone(a);
  }
  throw new Error("This is a read-only demo: nothing is sent or saved.");
}

async function api(path, opts = {}) {
  if (DEMO) return demoApi(path, opts);
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const putJSON = (path, body) => api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const postJSON = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 1600); }
function fail(e) { alert(e.message || e); }
function daysLeft(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T23:59"); if (isNaN(d)) return null;
  return Math.ceil((d - new Date()) / 864e5);
}
function dl(iso) {
  const n = daysLeft(iso); if (n == null) return "";
  return n < 0 ? `closed ${-n} d ago` : n === 0 ? "today" : `${n} d left`;
}
const money = c => "$" + (c || []).reduce((s, x) => s + x.usd, 0).toFixed(2);
const kindPill = k => `<span class="pill k-${kindOf(k)}">${KIND[kindOf(k)]}</span>`;

// ------------------------------------------------------------ router
async function route() {
  clearTimeout(poll);
  const [, v, id] = location.hash.split("/");
  document.querySelectorAll("header nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#/" + (v || "")));
  if (DEMO && !(v === "a" && id === DEMO.analysis.id)) return location.replace("#/a/" + DEMO.analysis.id);
  try {
    if (!CFG) CFG = await api("/api/config");
    PROFILES = await api("/api/profiles");
    if (v === "a" && id) return await viewAnalysis(id);
    if (v === "new") return viewNew();
    if (v === "profiles") return viewProfiles();
    return await viewList();
  } catch (e) { view.innerHTML = `<div class="banner err">${h(e.message)}</div>`; }
}
addEventListener("hashchange", route);

// ------------------------------------------------------------ list
const CONF = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };
const confPill = c => c ? `<span class="pill conf-${h(c)}" title="How far the call and the profile let the model judge. Add the facts under 'Make this sharper' to raise it.">${CONF[c] || h(c)}</span>` : "";
const vPill = v => v ? `<span class="pill v-${slug(v).toUpperCase()}">${h(v)}</span>` : "";
async function viewList() {
  const list = await api("/api/analyses");
  if (!list.length) {
    view.innerHTML = `<div class="welcome card">
      <h1>Is this call worth bidding for?</h1>
      <p class="sub">Give ToR Desk a call and who would bid. It reads the call once, scores it against the firm or expert, and tells you GO, GO IF or NO-GO, with the changes to make.</p>
      <ol class="how"><li><span class="num">1</span><div><b>The call</b><span class="hint">Upload the ToR, call or notice, or paste a few lines of it.</span></div></li>
        <li><span class="num">2</span><div><b>Who would bid</b><span class="hint">A firm's website, an expert's CV, or a few lines about either.</span></div></li>
        <li><span class="num">3</span><div><b>The verdict</b><span class="hint">Knock-outs, fit score, every requirement's status and what to fix.</span></div></li></ol>
      <p><a class="btn primary big" href="#/new">Start a check</a></p>
      <p class="hint">Small input works; more context gives a sharper result. The report says what to add.</p></div>`;
    return;
  }
  view.innerHTML = `<div class="head"><div><h1>Checks</h1><p class="sub">Each call read once, then scored against a firm or an expert.</p></div>
    <a class="btn primary" href="#/new">New check</a></div>
    <div class="rows">${list.map(a => {
      const busy = BUSY.includes(a.status);
      return `<a class="row card" href="#/a/${h(a.id)}">
        <div class="r-main"><b>${h(a.title)}</b><span class="hint">${a.profile ? "against " + h(a.profile) : "not scored yet"} · ${h(a.created.replace("T", " ").slice(0, 16))}</span></div>
        <div class="r-dl">${a.deadline ? `${h(a.deadline)}<span class="hint">${dl(a.deadline)}</span>` : ""}</div>
        <div class="r-v">${busy ? '<span class="pill st-to-check"><span class="spin sm"></span> working</span>' : a.status === "error" ? '<span class="pill st-gap">error</span>' : vPill(a.verdict) + " " + confPill(a.confidence)}</div></a>`;
    }).join("")}</div>`;
}
view.addEventListener("click", e => {
  const go = e.target.closest("[data-go]"); if (go) { location.hash = go.dataset.go; return; }
  const rq = e.target.closest("[data-reqs]");
  if (rq) { e.preventDefault(); filt = { ...NOFILT(), only: rq.dataset.reqs.split(",").map(Number) }; tab = "req"; render(); return; }
  const tg = e.target.closest("[data-to-tab]"); if (tg) { e.preventDefault(); tab = tg.dataset.toTab; render(); }
});

// ------------------------------------------------------------ shared bits
function dropZone(name, text) {
  return `<label class="drop" data-drop><input type="file" name="${name}" multiple accept="${CFG.accepted.join(",")}">
    <div>${text}</div><div class="hint">PDF, Word, RTF, ODT, .txt or .md</div><div class="files"></div></label>`;
}
function wireDrops(root) {
  root.querySelectorAll("[data-drop]").forEach(z => {
    const inp = $("input", z), show = () => $(".files", z).textContent = [...inp.files].map(f => f.name).join(", ");
    inp.onchange = show;
    z.ondragover = e => { e.preventDefault(); z.classList.add("over"); };
    z.ondragleave = () => z.classList.remove("over");
    z.ondrop = e => { e.preventDefault(); z.classList.remove("over"); inp.files = e.dataTransfer.files; show(); };
  });
}
function profileOptions(sel, none = true) {
  const grp = k => { const ps = PROFILES.filter(p => p.kind === k); return ps.length ? `<optgroup label="${KIND[k]}s">${ps.map(p =>
    `<option value="${h(p.id)}" ${p.id === sel ? "selected" : ""}>${h(p.name)}${p.status === "building" ? " (building)" : ""}</option>`).join("")}</optgroup>` : ""; };
  return (none ? `<option value="">None: read the document only</option>` : "") + grp("firm") + grp("expert");
}

// ------------------------------------------------------------ new check: the call + who would bid, on one screen
function pickCard(p) {
  const bits = [p.url && h(p.url.replace(/^https?:\/\//, "")), p.files.length && `${p.files.length} doc${p.files.length > 1 ? "s" : ""}`, p.status === "building" && "building…"].filter(Boolean).join(" · ");
  return `<label class="opt"><input type="radio" name="pick" value="${h(p.id)}"><span class="o-t">${h(p.name)} ${kindPill(p.kind)}</span><span class="hint">${bits || "notes only"}</span></label>`;
}
function viewNew() {
  const def = (PROFILES.find(p => p.kind === "firm") || PROFILES[0])?.id || "new";
  view.innerHTML = `<div class="head"><div><h1>New check</h1><p class="sub">The call and who would bid. A few lines of each is enough to start; the more you give, the sharper the result.</p></div></div>
  <form id="fnew" class="flow" autocomplete="off">
    <section class="card step"><div class="step-h"><span class="num">1</span><div><h2>The call</h2>
      <p class="hint">ToR, call for proposals, EoI or concept note guidelines. Add annexes and the procurement notice if you have them: knock-out rules often sit there.</p></div></div>
      <div class="switch" data-switch="src"><button type="button" data-v="files" class="on">Upload documents</button><button type="button" data-v="text">Paste text</button></div>
      <div data-pane="src" data-v="files">${dropZone("files", "Drop the documents here, or click to choose")}</div>
      <div data-pane="src" data-v="text" hidden><textarea name="text" aria-label="Call text" rows="9" placeholder="Paste the call: title, who can apply, what is asked, deadline, budget, selection criteria… A short summary works; the full text works better."></textarea>
        <div class="hint" id="tlen">At least a few lines.</div></div>
    </section>
    <section class="card step"><div class="step-h"><span class="num">2</span><div><h2>Who would bid</h2>
      <p class="hint">A <b>firm</b> is checked on eligibility, turnover, references and team; an <b>expert</b> on a position's requirements.</p></div></div>
      <div class="pick">${PROFILES.map(pickCard).join("")}
        <label class="opt add"><input type="radio" name="pick" value="new"><span class="o-t">+ New profile</span><span class="hint">a website, a CV, or a few lines</span></label>
        <label class="opt skip"><input type="radio" name="pick" value=""><span class="o-t">Just read the call</span><span class="hint">score it later</span></label></div>
      <div id="newprof" class="sub-card" hidden>
        <div class="seg" role="radiogroup">
          <label><input type="radio" name="kind" value="firm" checked> <b>Firm</b> <span class="hint">company website or portfolio</span></label>
          <label><input type="radio" name="kind" value="expert"> <b>Expert</b> <span class="hint">one person's CV</span></label></div>
        <div class="cols"><div>
          <label class="f" data-l-url>Website</label><input name="url" aria-label="Website" placeholder="company.com" class="full">
          <label class="f">Name <span class="hint">optional</span></label><input name="pname" aria-label="Profile name" class="full">
          <label class="f">A few lines about it</label><textarea name="notes" aria-label="Notes" rows="5" placeholder="${h(NOTES_PH.firm)}"></textarea>
        </div><div>
          <label class="f" data-l-docs>Portfolio, capability statement, reference list</label>
          ${dropZone("pfiles", "Drop documents here, or click to choose")}
          <p class="hint">Any one of the three is enough. The profile is saved, so the next check reuses it; you can correct every fact on the Profiles page.</p>
        </div></div></div>
    </section>
    <section class="card step go"><div class="step-h"><span class="num">3</span><div><h2>Run the check</h2>
      <p class="hint" id="costhint">About $0.30-1.00 for a full ToR, much less for a short call. Profiles cost about $0.05-0.15 to build.</p></div></div>
      <div class="go-row"><select name="effort"><option value="high">Thorough reading (recommended)</option><option value="medium">Faster, a little cheaper</option></select>
        <button class="btn primary big" id="run">Run the check</button></div>
    </section>
  </form>`;
  const f = $("#fnew"), el = n => f.elements.namedItem(n);
  wireDrops(view);
  let src = "files";
  f.querySelectorAll("[data-switch] button").forEach(b => b.onclick = () => {
    src = b.dataset.v;
    f.querySelectorAll("[data-switch] button").forEach(x => x.classList.toggle("on", x === b));
    f.querySelectorAll("[data-pane]").forEach(p => p.hidden = p.dataset.v !== src);
    if (src === "text") el("text").focus();
  });
  el("text").oninput = () => { const n = el("text").value.trim().length; $("#tlen").textContent = n < 40 ? "At least a few lines." : `${n.toLocaleString()} characters`; };
  const pick = v => { const r = f.querySelector(`[name=pick][value="${v}"]`); if (r) r.checked = true; $("#newprof").hidden = v !== "new"; };
  f.querySelectorAll("[name=pick]").forEach(r => r.onchange = () => pick(r.value));
  pick(def);
  f.querySelectorAll("[name=kind]").forEach(r => r.onchange = () => {
    const firm = r.value === "firm";
    $("[data-l-url]", f).textContent = firm ? "Website" : "Web page (optional)";
    el("url").placeholder = firm ? "company.com" : "personal site or online CV";
    $("[data-l-docs]", f).textContent = firm ? "Portfolio, capability statement, reference list" : "CV (and any annex)";
    el("notes").placeholder = NOTES_PH[r.value];
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const files = [...el("files").files], text = el("text").value.trim(), who = f.querySelector("[name=pick]:checked")?.value ?? "";
    if (src === "files" && !files.length) return fail("Add the call documents, or switch to Paste text.");
    if (src === "text" && text.length < 40) return fail("Paste a few lines of the call (at least 40 characters).");
    const pf = [...el("pfiles").files], url = el("url").value.trim(), notes = el("notes").value;
    if (who === "new" && !pf.length && !url && notes.trim().length < 20) return fail("For the new profile, give a website, a document, or a few lines about the firm or expert.");
    const b = $("#run"); b.disabled = true;
    try {
      let pid = who;
      if (who === "new") {
        b.textContent = "Saving the profile…";
        const fd = new FormData();
        fd.append("kind", f.querySelector("[name=kind]:checked").value); fd.append("url", url); fd.append("name", el("pname").value.trim()); fd.append("notes", notes);
        pf.forEach(x => fd.append("files", x));
        pid = (await api("/api/profiles", { method: "POST", body: fd })).id;
      }
      b.textContent = "Starting…";
      const fd = new FormData();
      if (src === "files") files.forEach(x => fd.append("files", x)); else fd.append("text", text);
      fd.append("profile_id", pid); fd.append("effort", el("effort").value);
      const r = await api("/api/analyses", { method: "POST", body: fd });
      location.hash = "#/a/" + r.id;
    } catch (err) { fail(err); b.disabled = false; b.textContent = "Run the check"; }
  };
}

// ------------------------------------------------------------ profiles
function weightInputs(kind, w = {}) {
  return `<table class="grid"><thead><tr><th>Bid/no-bid criterion</th><th class="num">Weight</th></tr></thead><tbody>${CFG.criteria[kind].map(c =>
    `<tr><td><b>${h(c.label)}</b><div class="note">${h(c.desc)}</div></td><td class="num"><input class="w-in" type="number" min="0" max="100" data-w="${c.key}" value="${w[c.key] ?? c.weight}"></td></tr>`).join("")}</tbody></table>`;
}
const readWeights = root => Object.fromEntries([...root.querySelectorAll("[data-w]")].map(i => [i.dataset.w, Number(i.value) || 0]));
const NOTES_PH = {
  firm: "Rules and facts the website doesn't show, e.g.\nTurnover 2022-24: 4.1 / 4.6 / 5.2 M euro. Staff: 38.\nWe bid as lead in the Western Balkans, as partner elsewhere.\nNever: works contracts, Sahel. Partners we can bring: ...",
  expert: "Facts the CV doesn't show, e.g.\nMinimum fee 350 euro/day; no missions over 6 months.\nPriority regions: Western Balkans, Eastern Partnership.\nLanguages: EN C2, FR native. Available from March 2027.",
};

function profCard(p) {
  const busy = p.status === "building", firm = p.kind === "firm";
  const experts = PROFILES.filter(x => x.kind === "expert"), firms = PROFILES.filter(x => x.kind === "firm");
  const banner = busy ? `<div class="banner"><div class="spin"></div>Reading ${p.url ? "the website" : ""}${p.url && p.files.length ? " and " : ""}${p.files.length ? "the documents" : ""}… (under a minute)</div>`
    : p.status === "error" ? `<div class="banner err">Build failed: ${h(p.error)}</div>` : "";
  const link = firm
    ? `<label class="f">Roster experts</label>${experts.length ? `<div class="checks">${experts.map(x => `<label><input type="checkbox" data-roster value="${h(x.id)}" ${p.expert_ids.includes(x.id) ? "checked" : ""}> ${h(x.name)}</label>`).join("")}</div>`
        : `<div class="hint">No expert profiles yet.</div>`}<div class="hint">The scoring fills each expert position from this roster, or says who to recruit.</div>`
    : `<label class="f">Works with firm</label><select name="firm_id"><option value="">None</option>${firms.map(f => `<option value="${h(f.id)}" ${p.firm_id === f.id ? "selected" : ""}>${h(f.name)}</option>`).join("")}</select>
       <div class="hint">Puts this expert on that firm's roster.</div>`;
  return `<form class="card prof" data-pid="${h(p.id)}">
    <div class="head"><div><h2 style="margin:0">${h(p.name)} ${kindPill(p.kind)}</h2>
      <span class="hint">${p.url ? `<a href="${h(/^https?:/i.test(p.url) ? p.url : "https://" + p.url)}" target="_blank" rel="noopener">${h(p.url)}</a> · ` : ""}${p.files.length} document${p.files.length === 1 ? "" : "s"} · updated ${h((p.updated || "").slice(0, 10))} · spent $${(p.cost || 0).toFixed(2)}</span></div>
      <div class="actions"><button type="button" class="btn" data-rebuild ${busy || (!p.url && !p.files.length) ? "disabled" : ""}>Rebuild from sources</button>
        <button class="btn primary" ${busy ? "disabled" : ""}>Save</button></div></div>
    ${banner}
    <div class="cols"><div>
      <label class="f">Facts the scoring uses</label>
      <textarea name="facts" rows="14" placeholder="${busy ? "Being written…" : "Add a website or documents and click Rebuild, or type the facts here."}">${h(p.facts)}</textarea>
      <div class="hint">Edit freely. Rebuilding rewrites this text; put lasting points in the notes, which every rebuild reads.</div>
      <label class="f">Your rules and notes</label><textarea name="notes" aria-label="Notes" rows="4" placeholder="${h(NOTES_PH[p.kind])}">${h(p.notes)}</textarea>
    </div><div>
      ${link}
      <label class="f">${firm ? "Website" : "Web page (optional)"}</label><input name="url" aria-label="Website" value="${h(p.url)}" placeholder="${firm ? "company.com" : "personal site or online CV"}" style="width:100%">
      <label class="f">Add documents</label><input type="file" name="files" multiple accept="${CFG.accepted.join(",")}">
      ${p.files.length ? `<div class="hint">Have: ${p.files.map(f => h(f.name)).join(", ")}</div>` : ""}
      ${p.sources.length ? `<details><summary class="hint">${p.sources.length} web pages read</summary><ul class="tight hint">${p.sources.map(u => `<li>${h(u)}</li>`).join("")}</ul></details>` : ""}
      <details><summary class="hint">Bid/no-bid weights</summary>${weightInputs(p.kind, p.weights)}</details>
    </div></div></form>`;
}

function newProfileForm() {
  return `<details class="card add-prof" ${PROFILES.length ? "" : "open"}><summary><b>+ Add a profile</b> <span class="hint">a firm from its website or portfolio, an expert from a CV, or either from a few lines</span></summary><form id="fprof">
    <div class="seg" role="radiogroup">
      <label><input type="radio" name="kind" value="firm" checked> <b>Firm</b> <span class="hint">company eligibility, references, roster</span></label>
      <label><input type="radio" name="kind" value="expert"> <b>Expert</b> <span class="hint">one person's CV, matched to positions</span></label></div>
    <div class="cols"><div>
      <label class="f" data-l-url>Website</label><input name="url" aria-label="Website" placeholder="company.com" style="width:100%">
      <div class="hint" data-h-url>Reads the home page plus the about, services, projects and team pages (up to 8 pages).</div>
      <label class="f">Name <span class="hint" data-h-name>optional: taken from the website</span></label><input name="name" aria-label="Profile name" style="width:100%">
      <label class="f">A few lines, rules and notes</label><textarea name="notes" aria-label="Notes" rows="5" placeholder="${h(NOTES_PH.firm)}"></textarea>
    </div><div>
      <label class="f" data-l-docs>Portfolio, capability statement, reference list</label>
      ${dropZone("files", "Drop documents here, or click to choose")}
    </div></div>
    <p><button class="btn primary">Build profile</button> <span class="hint">About $0.05-0.15 to read the sources. Any one source is enough; you can correct every fact afterwards.</span></p></form></details>`;
}

function viewProfiles() {
  const sec = k => { const ps = PROFILES.filter(p => p.kind === k); return `<h2>${KIND[k]}s <span class="hint">${ps.length}</span></h2>
    ${ps.length ? `<div class="list">${ps.map(profCard).join("")}</div>` : `<div class="card hint">None yet.</div>`}`; };
  view.innerHTML = `<div class="head"><div><h1>Profiles</h1><p class="sub">What a document is scored against. A <b>firm</b> answers the organisation's eligibility (legal status, turnover, references, team); an <b>expert</b> answers a position's requirements. A firm can list its roster experts, so one scoring covers both.</p></div></div>
    ${newProfileForm()}${sec("firm")}${sec("expert")}`;
  dirty = false;
  wireDrops(view);
  wireNewProfile();
  view.querySelectorAll("form[data-pid]").forEach(wireProfile);
  if (PROFILES.some(p => p.status === "building")) poll = setTimeout(pollProfiles, 3000);
}

async function pollProfiles() {
  if (location.hash !== "#/profiles") return;
  try {
    const next = await api("/api/profiles");
    const sig = ps => ps.map(p => p.id + p.status + p.updated).join();
    if (sig(next) !== sig(PROFILES) && !dirty) { PROFILES = next; viewProfiles(); return; }
    if (sig(next) !== sig(PROFILES)) toast("A profile finished building: save, then reload to see it");
  } catch (e) { /* try again next tick */ }
  poll = setTimeout(pollProfiles, 3000);
}

function wireNewProfile() {
  const f = $("#fprof");
  f.querySelectorAll("[name=kind]").forEach(r => r.onchange = () => {
    const firm = f.kind.value === "firm";
    $("[data-l-url]", f).textContent = firm ? "Website" : "Web page (optional)";
    $("[data-h-url]", f).textContent = firm ? "Reads the home page plus the about, services, projects and team pages (up to 8 pages)." : "A personal site or online CV, if there is one.";
    $("[data-h-name]", f).textContent = firm ? "optional: taken from the website" : "optional: taken from the CV";
    $("[data-l-docs]", f).textContent = firm ? "Portfolio, capability statement, reference list" : "CV (and any annex)";
    f.notes.placeholder = NOTES_PH[f.kind.value];
    f.url.placeholder = firm ? "company.com" : "";
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const b = $("button.primary", f); b.disabled = true;
    try { await api("/api/profiles", { method: "POST", body: new FormData(f) }); toast("Building the profile"); route(); }
    catch (err) { fail(err); b.disabled = false; }
  };
}

function wireProfile(f) {
  const pid = f.dataset.pid, p = PROFILES.find(x => x.id === pid);
  f.addEventListener("input", () => { dirty = true; });
  $("[data-rebuild]", f).onclick = async () => {
    if (p.facts && !confirm("Rebuild the facts from the website and documents? Edits to the facts text are replaced (notes are kept).")) return;
    try { await postJSON(`/api/profiles/${pid}/build`, {}); toast("Rebuilding"); route(); } catch (err) { fail(err); }
  };
  f.onsubmit = async e => {
    e.preventDefault();
    try {
      const body = { facts: f.facts.value, notes: f.notes.value, url: f.url.value.trim(), weights: readWeights(f) };
      if (p.kind === "firm") body.expert_ids = [...f.querySelectorAll("[data-roster]:checked")].map(i => i.value);
      await putJSON(`/api/profiles/${pid}`, body);
      if (p.kind === "expert" && f.firm_id.value !== p.firm_id) {   // the firm's roster holds the link
        const old = PROFILES.find(x => x.id === p.firm_id), nu = PROFILES.find(x => x.id === f.firm_id.value);
        if (old) await putJSON(`/api/profiles/${old.id}`, { expert_ids: old.expert_ids.filter(x => x !== pid) });
        if (nu) await putJSON(`/api/profiles/${nu.id}`, { expert_ids: [...new Set([...nu.expert_ids, pid])] });
      }
      const newFiles = f.files.files.length, newUrl = body.url && body.url !== p.url;
      if (newFiles) { const fd = new FormData(); [...f.files.files].forEach(x => fd.append("files", x)); await api(`/api/profiles/${pid}/files`, { method: "POST", body: fd }); }
      if (newFiles || newUrl) { await postJSON(`/api/profiles/${pid}/build`, {}); toast("Saved; reading the new sources"); }
      else toast("Saved");
      route();
    } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------ analysis: scores
const tri = i => ({ ...((A.triage?.requirements || [])[i] || {}), ...(A.user.req[i] || {}) });
const aKind = () => kindOf(A.triage?.kind || A.profile?.kind);
const critMap = () => Object.fromEntries((CFG.criteria[aKind()] || []).map(c => [c.key, c]));
function weights() {
  const c = critMap(), w = {};
  for (const f of A.triage.fit) w[f.key] = A.user.fit[f.key]?.weight ?? A.profile?.weights?.[f.key] ?? c[f.key]?.weight ?? 10;
  return w;
}
const fitOf = f => A.user.fit[f.key]?.score ?? f.score;
function fitPct() {
  if (!A.triage) return null;
  const w = weights(); let t = 0, m = 0;
  for (const f of A.triage.fit) { t += w[f.key] * fitOf(f); m += w[f.key] * 5; }
  return m ? Math.round(100 * t / m) : 0;
}
const koRows = () => A.tor.requirements.map((r, i) => ({ r, i })).filter(x => x.r.criticality === "knock-out");
function decision() {
  const p = fitPct(); if (p == null) return null;
  const gaps = koRows().filter(x => tri(x.i).status === "gap").length;
  if (gaps) return { v: "NO-GO", why: `${gaps} knock-out gap${gaps > 1 ? "s" : ""}` };
  // The model weighs what the firm can fix (partners, recruits); its call stands until you change a score or weight.
  if (!Object.keys(A.user.fit).length && A.triage.verdict) return { v: A.triage.verdict, why: `fit ${p}% · reasoned call, see the conditions` };
  if (p >= 70) return { v: "GO", why: `fit ${p}%, no knock-out gap` };
  if (p >= 50) return { v: "GO IF", why: `fit ${p}%: go if the conditions are met` };
  return { v: "NO-GO", why: `fit ${p}%, under 50` };
}
function readiness() {
  if (!A.triage) return null;
  const c = { met: 0, partial: 0, gap: 0, "to check": 0, "n/a": 0 };
  A.tor.requirements.forEach((r, i) => c[tri(i).status || "to check"]++);
  const base = c.met + c.partial + c.gap + c["to check"];
  return { pct: base ? Math.round(100 * (c.met + 0.5 * c.partial) / base) : 0, c, base };
}
function compliance() {
  if (!A.bid) return null;
  let s = 0, m = 0, miss = 0;
  A.tor.requirements.forEach((r, i) => {
    const b = A.bid.requirements[i]; if (!b || b.status === "n/a") return;
    const w = CW[r.criticality]; m += w; s += w * (b.status === "addressed" ? 1 : b.status === "partial" ? .5 : 0);
    if (r.criticality === "knock-out" && b.status !== "addressed") miss++;
  });
  return { pct: m ? Math.round(100 * s / m) : 0, miss };
}
function cards() {
  const d = decision(), rd = readiness(), c = compliance(), ko = koRows(), fp = fitPct(), T = A.triage;
  const koOpen = T ? ko.filter(x => !["met", "n/a"].includes(tri(x.i).status)).length : null;
  const seg = (n, cls) => rd && n ? `<i class="${cls}" style="width:${100 * n / (rd.base + rd.c["n/a"])}%"></i>` : "";
  const hero = d ? `<div class="hero v-box-${slug(d.v)}">
      <div class="h-v"><span class="big v-${slug(d.v).toUpperCase()}">${d.v}</span></div>
      <div class="h-why"><b>${h(d.why)}</b>
        <div class="h-meta">${confPill(T.confidence)}${T.verdict !== d.v ? `<span class="hint">the model said ${h(T.verdict)}; the decision follows your scores</span>` : ""}
          ${A.profile ? `<span class="hint">against ${kindPill(A.profile.kind)} ${h(A.profile.name)}${A.profile.roster?.length ? ` + ${A.profile.roster.length} roster expert${A.profile.roster.length > 1 ? "s" : ""}` : ""}</span>` : ""}</div></div>
      <div class="h-fit"><div class="n">${fp}%</div><div class="hint">fit · GO at 70%</div>
        <div class="bar"><i class="${fp >= 70 ? "st-met" : fp >= 50 ? "st-partial" : "st-gap"}" style="width:${fp}%"></i></div></div></div>`
    : A.status === "triaging"
    ? `<div class="hero v-box-"><div class="h-why"><b><span class="spin sm"></span> Scoring…</b><div class="hint">against ${h(PROFILES.find(p => p.id === A.pending_profile)?.name || "the profile")}; the verdict appears here in 1–2 min.</div></div></div>`
    : `<div class="hero v-box-"><div class="h-why"><b>Not scored yet</b><div class="hint">Pick a firm or an expert at the top right and click Score.</div></div></div>`;
  return hero + `<div class="metrics">
  <div class="score"><div class="k">Requirements met</div><div class="n">${rd ? rd.pct + "%" : "-"}</div>
    <div class="d">${rd ? `${rd.c.met} met · ${rd.c.partial} partial · ${rd.c.gap} gap · ${rd.c["to check"]} to check` : `${A.tor.requirements.length} found`}</div>
    <div class="bar">${seg(rd?.c.met, "st-met")}${seg(rd?.c.partial, "st-partial")}${seg(rd?.c.gap, "st-gap")}${seg(rd?.c["to check"], "st-to-check")}</div></div>
  <div class="score"><div class="k">Knock-out rules</div><div class="n">${ko.length}</div>
    <div class="d">${!ko.length ? "none found: check the procurement notice" : koOpen == null ? "eliminatory if missed" : koOpen ? `${koOpen} not yet met` : "all met"}</div></div>
  <div class="score"><div class="k">Watch-outs</div><div class="n">${A.tor.contradictions.length + A.tor.red_flags.length}</div>
    <div class="d">${A.tor.contradictions.length} contradictions · ${A.tor.red_flags.length} red flags</div></div>
  ${c ? `<div class="score"><div class="k">Draft bid compliance</div><div class="n">${c.pct}%</div>
    <div class="d">${c.miss ? `${c.miss} knock-out not fully addressed` : "all knock-outs addressed"}</div></div>` : ""}</div>`;
}
function refreshCards() { const el = $("#cards"); if (el) el.innerHTML = cards(); }

// ------------------------------------------------------------ analysis: page
async function viewAnalysis(id, keep) {
  const a = await api(`/api/analyses/${id}`);
  const changed = !A || A.id !== a.id || A.updated !== a.updated || A.status !== a.status;
  if (A?.id !== a.id) { tab = "report"; filt = NOFILT(); }
  if (BUSY.includes(a.status) && !BUSY.includes(A?.status) || A?.id !== a.id) busySince = Date.now();
  const wasBusy = A && A.id === a.id && BUSY.includes(A.status);
  if (wasBusy && !BUSY.includes(a.status)) PROFILES = await api("/api/profiles");  // a profile may have finished building meanwhile
  if (!keep || changed && !(wasBusy && BUSY.includes(a.status) && !!A.tor === !!a.tor)) { A = a; render(); }
  else { A.status = a.status; $("#busy-time") && ($("#busy-time").textContent = Math.round((Date.now() - busySince) / 1000) + " s"); }
  if (BUSY.includes(a.status)) poll = setTimeout(() => location.hash === "#/a/" + id && viewAnalysis(id, true), 3000);
}
function render() {
  const busy = BUSY.includes(A.status);
  const banner = busy ? `<div class="banner"><div class="spin"></div>${BUSY_TEXT[A.status]}… <span id="busy-time"></span></div>`
    : A.status === "error" ? `<div class="banner err">Failed: ${h(A.error)}</div>` : "";
  if (!A.tor) {
    const stage = ["queued", "reading"].includes(A.status) ? 0 : 1;
    view.innerHTML = `<div class="head"><div><h1>${h(A.label)}</h1><p class="sub">${A.docs.map(d => h(d.name)).join(", ")}</p></div></div>
      ${A.status === "error" ? banner : `<div class="card progress"><ol>
        <li class="${stage === 0 ? "now" : "done"}"><b>Reading the call</b><span class="hint">requirements, knock-outs, contradictions, red flags · 1-3 min</span></li>
        <li class="${stage === 1 ? "now" : ""}"><b>Scoring against the profile</b><span class="hint">builds the profile first if it is new · 1-2 min</span></li>
        <li><b>Report</b><span class="hint">opens here by itself</span></li></ol>
        <p class="hint"><span class="spin sm"></span> <span id="busy-time"></span> You can leave this page; the check carries on.</p></div>`}`;
    return;
  }
  const m = A.tor.meta, t = A.tor;
  const chip = (k, v) => v ? `<span class="chip" title="${h(v)}"><b>${k}</b>${h(v)}</span>` : "";
  const n = { report: "", req: t.requirements.length, clar: t.contradictions.length, flags: t.red_flags.length, score: "", bid: "" };
  const TABS = [["report", "Report"], ["req", "Requirements"], ["clar", "Contradictions"], ["flags", "Red flags"], ["score", "Scoring & experts"], ["bid", "Draft bid"]];
  view.innerHTML = `
  <div class="head"><div><h1>${h(m.title || A.label)}</h1>
    <p class="sub">${[m.document_kind, m.contracting_authority, m.reference, m.rulebook].filter(Boolean).map(h).join(" · ")}</p></div>
    <div class="scorebox"><div class="sb-row"><select id="prof">${profileOptions(A.profile?.id || A.pending_profile, false)}</select>
      <button class="btn ${A.triage ? "" : "primary"}" id="rescore" ${busy || !PROFILES.length ? "disabled" : ""}>${A.triage ? "Re-score" : "Score"}</button></div>
      <div class="hint">${PROFILES.length ? "" : '<a href="#/profiles">Add a profile</a> · '}spent ${money(A.costs)}</div></div></div>
  <div class="chips">${chip("Deadline", (m.deadline_text || m.deadline_iso) + (m.deadline_iso ? ` (${dl(m.deadline_iso)})` : ""))}${chip("Questions by", m.clarification_deadline)}
    ${chip("Budget", m.budget)}${chip("Duration", m.duration)}${chip("Where", m.geography)}${chip("Submit via", m.submission_channel)}</div>
  ${banner}
  <div class="cards" id="cards">${cards()}</div>
  <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${l}${n[k] !== "" && n[k] != null ? `<span class="n">${n[k]}</span>` : ""}</button>`).join("")}</div>
  ${TABS.map(([k, l]) => `<div class="panel" id="p-${k}" data-title="${l}" ${tab === k ? "" : "hidden"}></div>`).join("")}`;
  view.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; if (tab === "req") filt.only = null; render(); });
  $("#rescore").onclick = async () => {
    if (A.triage && Object.keys(A.user.req).length && !confirm("Re-scoring replaces the row edits you made. Continue?")) return;
    try { await postJSON(`/api/analyses/${A.id}/triage`, { profile_id: $("#prof").value, effort: "high" }); viewAnalysis(A.id); } catch (e) { fail(e); }
  };
  ({ report: tabReport, req: tabReq, clar: tabClar, flags: tabFlags, score: tabScore, bid: tabBid })[tab]();
}

// ------------------------------------------------------------ tab: report (the one page to read)
const reqLinks = ix => ix?.length ? ` · closes <a href="#" data-reqs="${ix.join(",")}">${ix.map(i => "#" + (i + 1)).join(", ")}</a>` : "";
function tabReport() {
  const t = A.tor, T = A.triage, d = decision(), ko = koRows();
  const docKind = t.meta.document_kind || "document";
  let out = "";
  if (!T) out += `<div class="card empty">Pick a firm or an expert at the top right and click <b>Score</b>: you get GO / GO IF / NO-GO, the changes to make and each requirement's status.</div>`;
  else {
    const sh = T.sharpen || [];
    out += `<div class="cols wide-left"><div class="card"><h3 class="ct">The assessment</h3><p>${h(T.summary)}</p>
      ${T.conditions?.length ? `<b>Go only if</b><ul class="tight">${T.conditions.map(c => `<li>${h(c)}</li>`).join("")}</ul>` : ""}</div>
      ${sh.length ? `<div class="card sharpen conf-box-${h(T.confidence || "")}"><h3 class="ct">Make this sharper</h3>
        <p class="hint">${T.confidence === "low" ? "This result rests on thin information." : "The result can still improve."} Adding these would settle the most rows:</p>
        <ol class="tight">${sh.map(x => `<li>${h(x)}</li>`).join("")}</ol>
        <p class="hint">Add them to the profile's notes or documents, then Re-score (about $0.25).</p>
        ${A.profile ? `<a class="btn" href="#/profiles">Open the profile</a>` : ""}</div>`
      : `<div class="card"><h3 class="ct">How sure</h3><p>${confPill(T.confidence) || '<span class="hint">Scored before confidence existed: Re-score to get it.</span>'}</p>
        <p class="hint">More context gives a sharper result: the full ToR and annexes, the firm's references, CVs of the team.</p></div>`}</div>`;
    const ch = T.changes;
    out += `<h2>Changes to make</h2>` + (!ch ? `<div class="card hint">This analysis was scored before the change list existed: click Re-score to get it.</div>`
      : !ch.length ? `<div class="card hint">Nothing to change.</div>`
      : PRIO.map(([k, l]) => { const xs = ch.filter(c => c.priority === k); return xs.length ? `<div class="prio"><h3 class="pr-${k}">${l} <span class="hint">${xs.length}</span></h3>
          <div class="list">${xs.map(c => `<div class="item change"><span class="pill ty">${h(c.type)}</span> <b>${h(c.action)}</b>
            <div class="note">${h(c.why)}${reqLinks(c.reqs)}</div></div>`).join("")}</div></div>` : ""; }).join(""));
  }
  const status = i => { const s = tri(i).status; return T ? `<span class="pill st-${slug(s)}">${h(s || "to check")}</span>` : ""; };
  out += `<div class="cols"><div><h2>Knock-out rules <span class="hint">${ko.length}</span></h2>
      ${ko.length ? `<table class="grid"><tbody>${ko.map(({ r, i }) => `<tr><td class="hint"><a href="#" data-reqs="${i}">#${i + 1}</a></td><td>${h(r.requirement)}<div class="note">${h(r.applies_to || "")}${r.applies_to ? " · " : ""}${h(r.source)}</div></td><td>${status(i)}</td></tr>`).join("")}</tbody></table>`
        : `<div class="card hint">None found in these documents. Check the procurement notice or call guidelines.</div>`}</div>
    <div><h2>Watch-outs</h2><div class="card">
      <p><b>${t.contradictions.length} contradiction${t.contradictions.length === 1 ? "" : "s"}</b> with the question to ask${t.meta.clarification_deadline ? ` by ${h(t.meta.clarification_deadline)}` : ""}. <a href="#" data-to-tab="clar">See them</a></p>
      <b>${t.red_flags.length} red flag${t.red_flags.length === 1 ? "" : "s"}</b>${t.red_flags.length ? `<ul class="tight">${t.red_flags.slice(0, 5).map(f => `<li>${h(f)}</li>`).join("")}</ul>` : ""}
      ${t.red_flags.length > 5 ? `<a href="#" data-to-tab="flags">All ${t.red_flags.length}</a>` : ""}</div></div></div>
  <h2>What the ${h(docKind)} asks for</h2><div class="card">${h(t.summary)}</div>
  <div class="cols"><div><h2>Your notes</h2><textarea rows="6" data-notes placeholder="Decisions, partners contacted, who does what">${h(A.user.notes)}</textarea></div>
    <div><h2>Documents and cost</h2><table class="grid"><tbody>${A.docs.map(x => `<tr><td colspan="3">${h(x.name)}</td></tr>`).join("")}
      ${A.costs.map(c => `<tr><td>${h(c.step)}</td><td class="hint">${h(c.at.replace("T", " ").slice(0, 16))}</td><td class="num">$${c.usd.toFixed(2)}</td></tr>`).join("")}
      <tr><td><b>Total</b></td><td></td><td class="num"><b>${money(A.costs)}</b></td></tr></tbody></table>
    <p><button class="btn" onclick="print()">Print or save as PDF</button> <a class="btn" href="/api/analyses/${A.id}/matrix.csv">Compliance matrix (CSV)</a></p></div></div>`;
  $("#p-report").innerHTML = out;
}

// ------------------------------------------------------------ tab: requirements
function tabReq() {
  const p = $("#p-req"), t = A.tor;
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(v => `<option ${v === cur ? "selected" : ""}>${h(v)}</option>`).join("");
  const types = [...new Set(t.requirements.map(r => r.type))];
  const applies = [...new Set(t.requirements.map(r => r.applies_to).filter(Boolean))];
  p.innerHTML = `<div class="filters">
    <input type="search" data-filter="q" placeholder="Search requirements, sources, evidence" value="${h(filt.q)}">
    ${applies.length ? `<select data-filter="applies">${opts(applies, filt.applies, "Everyone")}</select>` : ""}
    <select data-filter="crit">${opts(["knock-out", "scored", "formal"], filt.crit, "All criticality")}</select>
    <select data-filter="type">${opts(types, filt.type, "All types")}</select>
    ${A.triage ? `<select data-filter="status">${opts(CFG.triage_statuses, filt.status, "All statuses")}</select>` : ""}
    <span class="hint" id="count"></span>${filt.only ? ` <button class="btn" id="showall">Show all</button>` : ""}<span style="flex:1"></span>
    <a class="btn" href="/api/analyses/${A.id}/matrix.csv">Export CSV</a></div>
  <table class="grid"><thead><tr><th>#</th><th style="width:34%">Requirement</th><th>Who</th><th>Source</th><th>Criticality</th>
    ${A.triage ? `<th>Status</th><th style="width:26%">Evidence · action</th><th>Owner</th>` : ""}</tr></thead><tbody id="rows"></tbody></table>`;
  p.querySelectorAll("[data-filter]").forEach(el => el.oninput = () => { filt[el.dataset.filter] = el.value; rows(); });
  if (filt.only) $("#showall").onclick = () => { filt.only = null; tabReq(); };
  rows();
}
function rows() {
  const q = filt.q.toLowerCase();
  const list = A.tor.requirements.map((r, i) => ({ r, i, x: tri(i) })).filter(({ r, i, x }) =>
    (!filt.only || filt.only.includes(i)) &&
    (!filt.type || r.type === filt.type) && (!filt.crit || r.criticality === filt.crit) && (!filt.status || x.status === filt.status) &&
    (!filt.applies || r.applies_to === filt.applies) &&
    (!q || [r.requirement, r.source, r.note, x.evidence, x.action, x.owner].join(" ").toLowerCase().includes(q)));
  $("#count").textContent = `${list.length} of ${A.tor.requirements.length}`;
  $("#rows").innerHTML = list.map(({ r, i, x }) => `<tr><td class="hint">${i + 1}</td>
    <td>${h(r.requirement)}${r.note ? `<div class="note">${h(r.note)}</div>` : ""}<div class="note">${h(r.type)}</div></td>
    <td>${r.applies_to ? `<span class="pill ap">${h(r.applies_to)}</span>` : ""}</td><td class="hint">${h(r.source)}</td>
    <td><span class="pill c-${slug(r.criticality)}">${h(r.criticality)}</span></td>
    ${A.triage ? `<td><select class="st st-${slug(x.status)}" data-i="${i}" data-f="status">${CFG.triage_statuses.map(s => `<option ${s === x.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
    <td><textarea rows="2" data-i="${i}" data-f="evidence" placeholder="Evidence">${h(x.evidence)}</textarea><textarea rows="1" data-i="${i}" data-f="action" placeholder="Action">${h(x.action)}</textarea></td>
    <td><input class="owner" data-i="${i}" data-f="owner" value="${h(x.owner)}"></td>` : ""}</tr>`).join("");
}

// ------------------------------------------------------------ tab: contradictions, red flags
function tabClar() {
  const t = A.tor;
  $("#p-clar").innerHTML = `<div class="filters"><span class="hint">Where the documents contradict themselves or leave a gap, each with the question to send before ${h(t.meta.clarification_deadline || "the clarification deadline")}.</span>
    <span style="flex:1"></span><a class="btn" href="/api/analyses/${A.id}/questions.md">Export questions</a></div>
  <div class="list">${t.contradictions.map((c, i) => `<div class="item ${A.user.asked[i] ? "done" : ""}"><label style="float:right" class="hint"><input type="checkbox" data-ask="${i}" ${A.user.asked[i] ? "checked" : ""}> asked</label>
    <b>${i + 1}. ${h(c.issue)}</b><div class="src">${h(c.sources)}</div><div class="q">${h(c.question_to_ask)}</div></div>`).join("") || `<div class="card hint">None found.</div>`}</div>`;
}
function tabFlags() {
  $("#p-flags").innerHTML = `<div class="list">${A.tor.red_flags.map((f, i) => `<div class="item"><b>${i + 1}.</b> ${h(f)}</div>`).join("") || `<div class="card hint">None found.</div>`}</div>`;
}

// ------------------------------------------------------------ tab: scoring and experts
function tabScore() {
  const p = $("#p-score"), t = A.tor, T = A.triage;
  let out = "";
  if (!T) out += `<div class="card empty">Score against a profile (top right) to get the bid/no-bid scoring and the expert matches.</div>`;
  else {
    const w = weights(), lbl = critMap();
    const tw = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    out += `<h2 style="margin-top:0">Bid/no-bid scoring <span class="hint">${KIND[aKind()]} criteria · change a weight or a score and the decision moves</span></h2>
    <table class="grid"><thead><tr><th>Criterion</th><th class="num">Weight</th><th class="num">Model</th><th class="num">Your score</th><th class="num">Points</th><th style="width:45%">Why</th></tr></thead><tbody>
    ${T.fit.map(f => `<tr><td><b>${h(lbl[f.key]?.label || f.key)}</b><div class="note">${h(lbl[f.key]?.desc || "")}</div></td>
      <td class="num"><input class="w-in" type="number" min="0" max="100" data-fit="${f.key}" data-k="weight" value="${w[f.key]}"></td>
      <td class="num">${f.score}/5</td>
      <td class="num"><select data-fit="${f.key}" data-k="score">${[0, 1, 2, 3, 4, 5].map(s => `<option ${s === fitOf(f) ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td class="num">${(100 * w[f.key] * fitOf(f) / 5 / tw).toFixed(1)}</td><td>${h(f.rationale)}</td></tr>`).join("")}
    <tr><td><b>Total</b></td><td class="num">${tw}</td><td></td><td></td><td class="num"><b>${fitPct()}%</b></td><td class="hint">Once you change a score or weight, the decision follows the numbers: GO at 70% and over, GO IF 50-69%, NO-GO under 50%. A knock-out gap is always NO-GO.</td></tr></tbody></table>`;
  }
  const em = T?.expert_matches || [];
  const match = pos => em.find(e => e.position === pos) || null;
  const mcell = mm => mm ? `<td>${mm.candidate ? `<b>${h(mm.candidate)}</b><br>` : ""}<span class="pill m-${mm.match}">${mm.match}</span></td><td>${h(mm.evidence)}${mm.gaps ? `<div class="note">Gaps: ${h(mm.gaps)}</div>` : ""}</td>` : "<td></td><td></td>";
  out += `<h2>Expert positions</h2>${t.expert_profiles.length ? `<table class="grid"><thead><tr><th>Position</th><th style="width:30%">Minimum requirements</th><th>Days</th>${em.length ? "<th>Who · match</th><th>Evidence · gaps</th>" : ""}</tr></thead><tbody>
    ${t.expert_profiles.map(x => `<tr><td><b>${h(x.position)}</b><div class="note">${h(x.source)}</div></td><td>${h(x.minimum_requirements)}</td><td>${h(x.days)}</td>${em.length ? mcell(match(x.position)) : ""}</tr>`).join("")}</tbody></table>`
    : em.length ? `<table class="grid"><thead><tr><th>Position (implied by the tasks)</th><th>Who · match</th><th>Evidence · gaps</th></tr></thead><tbody>
      ${em.map(mm => `<tr><td><b>${h(mm.position)}</b></td>${mcell(mm)}</tr>`).join("")}</tbody></table>`
    : `<div class="card hint">No expert positions stated.</div>`}
  <h2>Evaluation grid</h2>${t.evaluation_criteria.length ? `<table class="grid"><thead><tr><th>Criterion</th><th>Points</th><th>Source</th></tr></thead><tbody>
    ${t.evaluation_criteria.map(c => `<tr><td>${h(c.criterion)}</td><td>${h(c.points)}</td><td class="hint">${h(c.source)}</td></tr>`).join("")}</tbody></table>` : `<div class="card hint">The documents give no evaluation grid.</div>`}`;
  p.innerHTML = out;
}

// ------------------------------------------------------------ tab: draft bid
function tabBid() {
  const p = $("#p-bid"), b = A.bid;
  if (DEMO) { p.innerHTML = `<div class="card empty">In the full app you drop the draft bid here (technical offer, CVs, forms) and it is checked against every requirement above, with where each is answered and what to fix.</div>`; return; }
  p.innerHTML = `<form id="fbid" class="card">${dropZone("files", b ? "Drop a newer draft to check again" : "Drop the draft bid (technical offer, CVs, forms) to check it against every requirement")}
    <p><button class="btn primary" ${BUSY.includes(A.status) ? "disabled" : ""}>Check the draft</button> <span class="hint">About $0.30-0.80 depending on length.</span></p></form>
  ${b ? `<h2>Result <span class="hint">${h(b.docs.map(d => d.name).join(", "))} · ${h(b.at.replace("T", " ").slice(0, 16))}</span></h2>
    <div class="card">${h(b.summary)}</div>
    ${b.issues.length ? `<h2>Cross-document issues</h2><ul class="tight">${b.issues.map(x => `<li>${h(x)}</li>`).join("")}</ul>` : ""}
    <h2>Per requirement</h2><table class="grid"><thead><tr><th>#</th><th style="width:38%">Requirement</th><th>Criticality</th><th>Draft</th><th>Where</th><th>Fix</th></tr></thead><tbody>
    ${A.tor.requirements.map((r, i) => ({ r, i, x: b.requirements[i] || {} })).sort((u, v) => CW[v.r.criticality] - CW[u.r.criticality] || ["missing", "partial", "addressed", "n/a"].indexOf(u.x.status) - ["missing", "partial", "addressed", "n/a"].indexOf(v.x.status))
      .map(({ r, i, x }) => `<tr><td class="hint">${i + 1}</td><td>${h(r.requirement)}</td><td><span class="pill c-${slug(r.criticality)}">${h(r.criticality)}</span></td>
      <td><span class="pill st-${slug(x.status)}">${h(x.status)}</span></td><td class="hint">${h(x.where)}</td><td>${h(x.fix)}</td></tr>`).join("")}</tbody></table>` : ""}`;
  wireDrops(p);
  $("#fbid").onsubmit = async e => {
    e.preventDefault();
    try { await api(`/api/analyses/${A.id}/bid`, { method: "POST", body: new FormData(e.target) }); viewAnalysis(A.id); } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------ edits: saved to the server
let saveT;
function saveUser() {
  clearTimeout(saveT);
  if (DEMO) return toast("Demo: your edits stay in this tab only");
  saveT = setTimeout(async () => { try { A.updated = await putJSON(`/api/analyses/${A.id}/user`, A.user); toast("Saved"); } catch (e) { fail(e); } }, 600);
}
view.addEventListener("input", e => {
  const t = e.target;
  if (!A || !location.hash.startsWith("#/a/")) return;
  if (t.dataset.f && t.dataset.i != null) {
    const i = t.dataset.i; A.user.req[i] = { ...(A.user.req[i] || {}), [t.dataset.f]: t.value };
    if (t.tagName === "SELECT") { t.className = "st st-" + slug(t.value); refreshCards(); }
    saveUser();
  } else if (t.dataset.fit) {
    A.user.fit[t.dataset.fit] = { ...(A.user.fit[t.dataset.fit] || {}), [t.dataset.k]: Number(t.value) || 0 };
    refreshCards(); if (t.tagName === "SELECT") tabScore(); saveUser();
  } else if (t.dataset.ask != null) {
    A.user.asked[t.dataset.ask] = t.checked; t.closest(".item").classList.toggle("done", t.checked); saveUser();
  } else if (t.hasAttribute("data-notes")) { A.user.notes = t.value; saveUser(); }
});
view.addEventListener("change", e => { if (e.target.dataset.fit && e.target.dataset.k === "weight") tabScore(); });

route();
