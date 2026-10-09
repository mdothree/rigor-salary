import { initPaywall, gate, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";
import { validators, guardSubmit, setFieldError } from "./utils/validate.js";
import { saveDoc, getUserDocs, tsToString } from "./services/firestoreService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { initAuthModal, wireAuthNav, openAuthModal, escapeHtml, listItems, showToolError, clearToolError, copyToClipboard, showCopiedFeedback } from "./utils/helpers.js";
import { authService } from "./services/authService.js";

let lastResult = null;

let currentUser = null;
authService.onAuthChanged(async user => {
  currentUser = user;
  const navLoginEl = document.getElementById("nav-login");
  if (navLoginEl) navLoginEl.textContent = user ? "Sign Out" : "Sign In";
  document.getElementById("nav-signup")?.classList.toggle("nav-signup-hidden", !!user);
  await initPaywall(user ? user.uid : null);
  if (user) renderUsageMeter("usage-meter-container", "analyses");
});
document.getElementById("nav-upgrade")?.addEventListener("click", (e) => { e.preventDefault(); showPricingModal("pro"); });
document.getElementById("nav-manage")?.addEventListener("click", () => showPricingModal("pro"));

initAuthModal(authService);
wireAuthNav(authService, () => currentUser);

// ─── Money parsing / formatting ───────────────────────────────────────────────
/**
 * Parses "$120,000", "120000", "120k", "$1.2M", "£85k", "135k from Google".
 * Returns a number or NaN. Uses the first number found; handles k/m suffixes.
 */
export function parseMoney(input) {
  if (input === null || input === undefined) return NaN;
  const str = String(input).replace(/,/g, "").trim();
  const m = str.match(/(\d+(?:\.\d+)?)\s*([kKmM])?\b/);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const suf = (m[2] || "").toLowerCase();
  if (suf === "k") n *= 1e3;
  if (suf === "m") n *= 1e6;
  return n;
}

/** Currency from the symbol the user typed in the offer field (default USD). */
export function detectCurrency(input) {
  const s = String(input || "");
  if (/£|\bGBP\b/i.test(s)) return "GBP";
  if (/€|\bEUR\b/i.test(s)) return "EUR";
  if (/₹|\bINR\b/i.test(s)) return "INR";
  if (/¥|\bJPY\b/i.test(s)) return "JPY";
  if (/\bCAD\b|C\$/i.test(s)) return "CAD";
  if (/\bAUD\b|A\$/i.test(s)) return "AUD";
  return "USD";
}

export function makeMoneyFormatter(currency) {
  let nf;
  try {
    nf = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    nf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  return n => nf.format(n);
}

/** Bar width as % of the largest value shown (min 2% so a bar is visible). */
export function barWidths(values) {
  const max = Math.max(...values.filter(v => Number.isFinite(v) && v > 0));
  return values.map(v => (Number.isFinite(v) && v > 0 && max > 0) ? Math.max(2, Math.round((v / max) * 100)) : 0);
}

function setBusy(busy) {
  const btn = document.getElementById("btn-generate");
  btn.querySelector(".btn-text").classList.toggle("hidden", busy);
  btn.querySelector(".btn-loader").classList.toggle("hidden", !busy);
  btn.disabled = busy;
}

const val = id => document.getElementById(id).value.trim();

async function buildStrategy() {
  if (!guardSubmit([
    { id: 'job-title', rules: [validators.required], label: 'Job title' },
    { id: 'offered-salary', rules: [validators.required], label: 'Offered salary' }
  ], toast)) return;

  const offeredRaw = val("offered-salary");
  if (!(parseMoney(offeredRaw) > 0)) {
    document.getElementById("offered-salary").focus();
    setFieldError("offered-salary", "Offered salary must be a number, e.g. 120000, $120,000 or 120k.");
    return toast.warning("Offered salary must be a number, e.g. 120000, $120,000 or 120k.");
  }
  const targetRaw = val("target-salary");
  if (targetRaw && !(parseMoney(targetRaw) > 0)) {
    document.getElementById("target-salary").focus();
    setFieldError("target-salary", "Target salary must be a number, e.g. 140000 or 140k.");
    return toast.warning("Target salary must be a number, e.g. 140000 or 140k.");
  }

  const payload = { jobTitle: val("job-title"), company: val("company"), offeredSalary: offeredRaw, location: val("location"), benefits: val("benefits"), yearsExp: val("years-exp"), currentSalary: val("current-salary"), targetSalary: targetRaw, competing: val("competing"), achievements: val("achievements") };

  clearToolError();
  document.getElementById("results").classList.add("hidden");
  setBusy(true);
  try {
    const data = await apiFetch("/api/salary-strategy", payload);
    if (!data || !data.script || ![data.marketLow, data.marketMid, data.marketHigh].some(v => Number.isFinite(Number(v)))) {
      throw new Error("The server returned an incomplete strategy.");
    }
    lastResult = data;
    renderResults(data, payload);
    document.getElementById("results").classList.remove("hidden");
    document.getElementById("results").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    lastResult = null;
    showToolError(e, buildStrategy);
  } finally {
    setBusy(false);
  }
}

document.getElementById("btn-generate").addEventListener("click", buildStrategy);

function renderResults(data, p) {
  const fmt = makeMoneyFormatter(detectCurrency(p.offeredSalary));
  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : NaN; };
  const offered = parseMoney(p.offeredSalary);
  const target = p.targetSalary ? parseMoney(p.targetSalary) : NaN;
  const rows = [
    { label: "Est. Low",          v: num(data.marketLow),      cls: "low" },
    { label: "Est. Mid",          v: num(data.marketMid),      cls: "mid" },
    { label: "Est. High",         v: num(data.marketHigh),     cls: "high" },
    { label: "Your Offer",        v: offered,                  cls: "mid" },
    { label: "Your Target",       v: target,                   cls: "low" },
    { label: "Suggested Counter", v: num(data.recommendation), cls: "target", highlight: true }
  ].filter(r => Number.isFinite(r.v));
  const widths = barWidths(rows.map(r => r.v));

  const rec = num(data.recommendation);
  const belowTarget = Number.isFinite(rec) && Number.isFinite(target) && rec < target
    ? `<p class="range-note">Note: the suggested counter (${fmt(rec)}) is below your own target of ${fmt(target)}. You can still counter at your target — weigh the estimate above against your own research.</p>`
    : "";

  const where = p.location ? ` in ${escapeHtml(p.location)}` : "";
  document.getElementById("salary-range-card").innerHTML = `
    <div class="range-header"><h3>Estimated Salary Range — ${escapeHtml(p.jobTitle)}${where}</h3>
      <p class="range-disclaimer">AI-generated estimate, not sourced salary survey data. Verify against published pay data before you negotiate.</p></div>
    <div class="range-bars">
      ${rows.map((r, i) => `<div class="range-item${r.highlight ? " highlight" : ""}"><span class="range-label">${r.label}</span><div class="range-bar"><div class="range-fill ${r.cls}" style="width:${widths[i]}%"></div></div><span class="range-val">${fmt(r.v)}</span></div>`).join("")}
    </div>
    ${data.assessment ? `<p class="range-assessment">${escapeHtml(data.assessment)}</p>` : ""}
    ${belowTarget}
  `;

  const redFlags = Array.isArray(data.redFlags) ? data.redFlags.filter(Boolean) : [];
  const sections = document.getElementById("strategy-sections");
  sections.innerHTML = `
    <div class="strategy-card script-card">
      <h4>📝 Your Negotiation Script</h4>
      <blockquote id="script-text">${escapeHtml(data.script || "")}</blockquote>
      <button type="button" class="btn-icon" id="btn-copy-script">📋 Copy Script</button>
    </div>
    ${data.tactics?.length ? `<div class="strategy-card"><h4>🎯 Negotiation Tactics</h4><ul>${listItems(data.tactics)}</ul></div>` : ""}
    ${data.nonSalary?.length ? `<div class="strategy-card"><h4>💎 Non-Salary Negotiables</h4><ul>${listItems(data.nonSalary)}</ul></div>` : ""}
    ${redFlags.length ? `<div class="strategy-card script-card"><h4>⚠️ Red Flags to Watch</h4><ul>${listItems(redFlags)}</ul></div>` : ""}
  `;
  document.getElementById("btn-copy-script").addEventListener("click", async e => {
    await copyToClipboard(data.script || "");
    showCopiedFeedback(e.currentTarget, "📋 Copy Script");
  });
}

document.getElementById("btn-save")?.addEventListener("click", async () => {
  if (!currentUser) { openAuthModal("login"); return; }
  try {
    await saveDoc("salary-strategies", currentUser.uid, { jobTitle: val("job-title"), offeredSalary: val("offered-salary"), strategy: lastResult });
    toast.success("Strategy saved!");
  } catch (e) {
    toast.error(`Couldn't save: ${e?.message || "unknown error"}`);
  }
});
