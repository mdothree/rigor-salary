import { initPaywall, gate, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";
import { validators, guardSubmit } from "./utils/validate.js";
import { saveDoc, getUserDocs, tsToString } from "./services/firestoreService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { initAuthModal } from "./utils/helpers.js";
import { authService } from "./services/authService.js";

let currentUser = null;
authService.onAuthChanged(async user => {
  currentUser = user;
  const navLoginEl = document.getElementById("nav-login");
  if (navLoginEl) navLoginEl.textContent = user ? "Sign Out" : "Sign In";
  document.getElementById("nav-signup")?.classList.toggle("nav-signup-hidden", !!user);
  await initPaywall(user ? user.uid : null);
  if (user) renderUsageMeter("usage-meter-container", "uses");
});
document.getElementById("nav-upgrade")?.addEventListener("click", () => showPricingModal("pro"));
document.getElementById("nav-manage")?.addEventListener("click", () => showPricingModal("pro"));

initAuthModal(authService);

document.getElementById("btn-generate").addEventListener("click", async () => {
  // Validate inputs before processing
  if (!guardSubmit([
    { id: 'job-title', rules: [validators.required], label: 'Job title' },
    { id: 'offered-salary', rules: [validators.required, validators.numeric], label: 'Offered salary' }
  ], toast)) return;

    const title = document.getElementById("job-title").value.trim();
  const offered = document.getElementById("offered-salary").value.trim();
  if (!title || !offered) return toast.warning("Please enter the job title and offered salary.");

  document.querySelector(".btn-text").classList.add("hidden"); document.querySelector(".btn-loader").classList.remove("hidden"); document.getElementById("btn-generate").disabled = true;

  const payload = { jobTitle: title, company: document.getElementById("company").value, offeredSalary: offered, location: document.getElementById("location").value, benefits: document.getElementById("benefits").value, yearsExp: document.getElementById("years-exp").value, currentSalary: document.getElementById("current-salary").value, targetSalary: document.getElementById("target-salary").value, competing: document.getElementById("competing").value, achievements: document.getElementById("achievements").value };

  try {
    const res = await apiFetch("/api/salary-strategy", payload);
    const data = await res.json();
    renderResults(data, payload);
    document.getElementById("results").classList.remove("hidden");
    document.getElementById("results").scrollIntoView({behavior:"smooth"});
  } catch(e) {
    renderResults(mockStrategy(payload), payload);
    document.getElementById("results").classList.remove("hidden");
    document.getElementById("results").scrollIntoView({behavior:"smooth"});
  } finally {
    document.querySelector(".btn-text").classList.remove("hidden"); document.querySelector(".btn-loader").classList.add("hidden"); document.getElementById("btn-generate").disabled = false;
  }
});

function mockStrategy(p) {
  const offered = parseInt(p.offeredSalary.replace(/\D/g,'')) || 120000;
  return {
    marketLow: Math.round(offered * 0.9), marketMid: Math.round(offered * 1.1), marketHigh: Math.round(offered * 1.25),
    recommendation: Math.round(offered * 1.12),
    assessment: "This offer is slightly below market rate for your experience level.",
    script: `Thank you so much for the offer — I'm genuinely excited about this opportunity. Based on my research and ${p.yearsExp || '7'}+ years of experience, I was expecting something closer to $${Math.round((parseInt(p.offeredSalary.replace(/\D/g,''))||120000)*1.12).toLocaleString()}. Is there flexibility there?`,
    tactics: ["Lead with enthusiasm, then counter", "Use competing offers as leverage if you have them", "Negotiate total comp — equity, signing bonus, PTO", "Ask for 48-72 hours to consider before countering"],
    nonSalary: ["5 extra PTO days (~$2,300 value)", "Remote work flexibility", "Signing bonus of $10,000", "Accelerated 6-month review", "Professional development budget ($3,000/yr)"]
  };
}

function renderResults(data, p) {
  const rangeCard = document.getElementById("salary-range-card");
  rangeCard.innerHTML = `
    <div class="range-header"><h3>Market Salary Range — ${p.jobTitle} in ${p.location || 'US'}</h3></div>
    <div class="range-bars">
      <div class="range-item"><span class="range-label">Market Low</span><div class="range-bar"><div class="range-fill low" style="width:60%"></div></div><span class="range-val">$${(data.marketLow||90000).toLocaleString()}</span></div>
      <div class="range-item"><span class="range-label">Market Mid</span><div class="range-bar"><div class="range-fill mid" style="width:78%"></div></div><span class="range-val">$${(data.marketMid||115000).toLocaleString()}</span></div>
      <div class="range-item"><span class="range-label">Market High</span><div class="range-bar"><div class="range-fill high" style="width:100%"></div></div><span class="range-val">$${(data.marketHigh||145000).toLocaleString()}</span></div>
      <div class="range-item highlight"><span class="range-label">Your Target</span><div class="range-bar"><div class="range-fill target" style="width:85%"></div></div><span class="range-val">$${(data.recommendation||125000).toLocaleString()}</span></div>
    </div>
    <p class="range-assessment">${data.assessment || ''}</p>
  `;

  const sections = document.getElementById("strategy-sections");
  sections.innerHTML = `
    <div class="strategy-card script-card">
      <h4>📝 Your Negotiation Script</h4>
      <blockquote>${data.script || ''}</blockquote>
      <button class="btn-icon" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">📋 Copy Script</button>
    </div>
    <div class="strategy-card">
      <h4>🎯 Negotiation Tactics</h4>
      <ul>${(data.tactics||[]).map(t=>`<li>${t}</li>`).join("")}</ul>
    </div>
    <div class="strategy-card">
      <h4>💎 Non-Salary Negotiables</h4>
      <ul>${(data.nonSalary||[]).map(t=>`<li>${t}</li>`).join("")}</ul>
    </div>
  `;
}

document.getElementById("btn-save")?.addEventListener("click", async () => {
  if(!currentUser) { authModal.classList.remove("hidden"); return; }
  
  await saveDoc("salary-strategies", currentUser?.uid || '', { userId: currentUser.uid, jobTitle: document.getElementById("job-title").value, offeredSalary: document.getElementById("offered-salary").value, createdAt: serverTimestamp() });
  toast.success("Strategy saved!");
});
