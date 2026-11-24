// Per diem & FX add-on for the public ToR Desk demo (copied by make_demo.py).
// Loads the live rate files of the per-diem tool (same site, /ExpertDesk/) when the panel first opens.
(() => {
  const BASE = "/ExpertDesk/";
  const dlg = document.getElementById("pd-dialog");
  const $ = (id) => document.getElementById(id);
  const num = (n, d = 2) => n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  let rates, fx, src;

  const load = (f) => new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = BASE + f; s.onload = ok; s.onerror = ko;
    document.head.appendChild(s);
  });

  async function init() {
    if (rates) return;
    try {
      await load("data.js"); await load("fx-rates.js");
      rates = PER_DIEM_RATES_EUR; fx = FX_RATES; src = PER_DIEM_SOURCE;   // globals of those two files
    } catch (e) {
      $("pd-out").innerHTML = 'The rates load on the live site only. Open the <a href="' + BASE + '">per-diem &amp; FX tool</a>.';
      return;
    }
    $("pd-country").innerHTML = Object.keys(rates).sort().map((c) => "<option>" + c + "</option>").join("");
    $("pd-cur").innerHTML = Object.entries(fx.rates).filter(([, r]) => r.value !== 1)
      .sort((a, b) => a[1].country.localeCompare(b[1].country))
      .map(([code, r]) => '<option value="' + code + '">' + r.country + " · " + r.currency + " (" + code + ")</option>").join("");
    $("pd-src").innerHTML = 'Per diem: DG INTPA decision ' + src.decision + ', from ' + src.effectiveFrom +
      ' (PRAG 2.5.5). Exchange: InforEuro ' + fx.year + "-" + String(fx.month).padStart(2, "0") +
      '. Full tool: <a href="' + BASE + '">per-diem &amp; FX</a>.';
    $("pd-country").onchange = () => {   // pick the visited country's currency when there is one
      const c = $("pd-country").value.toLowerCase();
      const hit = Object.entries(fx.rates).find(([, r]) => r.value !== 1 && r.country.toLowerCase() === c);
      if (hit) $("pd-cur").value = hit[0];
      calc();
    };
    $("pd-days").oninput = calc; $("pd-cur").onchange = calc;
    $("pd-country").onchange();
  }

  function calc() {
    const day = rates[$("pd-country").value], days = Math.max(0, +$("pd-days").value || 0);
    const code = $("pd-cur").value, r = fx.rates[code], total = day * days;
    $("pd-out").innerHTML = "<b>" + num(day, 0) + " euro</b> a day × " + days + " days = <b>" + num(total, 0) + " euro</b>" +
      (r ? "<br>= <b>" + num(total * r.value) + " " + code + "</b> at " + num(r.value, 4) + " " + code + " per euro" : "");
  }

  $("pd-open").onclick = () => { dlg.showModal(); init(); };
  $("pd-close").onclick = () => dlg.close();
})();
