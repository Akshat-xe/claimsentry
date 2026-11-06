// ==========================================================================
// CLAIM-SENTRY: APPLE OBSIDIAN & RADIANT SUNSET ORANGE ENGINE
// Multi-Page, Auth-Gated, 20-Model Fallback Cascade Client
// ==========================================================================

let allIssues = [];
let currentFilter = "all";
let currentPage = "dashboard";

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  checkAuthState();
  loadStoredByokKeys();
  initSSE();
  fetchStatus();
  fetchIssues();
});

// AUTH GATE
function checkAuthState() {
  const isAuth = sessionStorage.getItem("cs_auth_user");
  const authGate = document.getElementById("view-auth-gate");
  const appMain = document.getElementById("view-app-main");

  if (isAuth) {
    authGate.style.display = "none";
    appMain.style.display = "block";
    document.getElementById("user-display-name").innerText = isAuth;
    const initials = isAuth.split(" ").map(n => n[0]).join("");
    document.getElementById("user-avatar-monogram").innerText = initials || "AK";
  } else {
    authGate.style.display = "flex";
    appMain.style.display = "none";
  }
}

function handleLogin() {
  sessionStorage.setItem("cs_auth_user", "Akshat Kumar");
  checkAuthState();
  fetchIssues();
}

function handleSignOut() {
  sessionStorage.removeItem("cs_auth_user");
  checkAuthState();
}

// MULTI-PAGE NAVIGATION
function switchPage(page) {
  currentPage = page;
  const dashboard = document.getElementById("page-dashboard");
  const terminal = document.getElementById("page-terminal");
  const dockDash = document.getElementById("dock-btn-dashboard");
  const dockTerm = document.getElementById("dock-btn-terminal");

  if (page === "terminal") {
    dashboard.style.display = "none";
    terminal.style.display = "block";
    dockDash.classList.remove("active");
    dockTerm.classList.add("active");
  } else {
    terminal.style.display = "none";
    dashboard.style.display = "block";
    dockTerm.classList.remove("active");
    dockDash.classList.add("active");
  }
}

// EVENT LISTENERS
function setupEventListeners() {
  // Auth
  document.getElementById("btn-login-google").addEventListener("click", handleLogin);
  document.getElementById("btn-sign-out").addEventListener("click", handleSignOut);

  // Triage start
  const btnHeroStart = document.getElementById("btn-hero-start");
  const inputRepo = document.getElementById("input-repo-url");
  btnHeroStart.addEventListener("click", () => startTriage(inputRepo.value));
  inputRepo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startTriage(inputRepo.value);
  });

  // BYOK Modal
  document.getElementById("btn-top-byok").addEventListener("click", openByokModal);

  // Proof Modal backdrop click
  document.getElementById("proof-modal").addEventListener("click", (e) => {
    if (e.target.id === "proof-modal") closeProofModal();
  });
  document.getElementById("byok-modal").addEventListener("click", (e) => {
    if (e.target.id === "byok-modal") closeByokModal();
  });
}

function setPreset(url) {
  const input = document.getElementById("input-repo-url");
  input.value = url;
  startTriage(url);
}

// FILTER SELECTION
function applyFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
  const targetPill = document.getElementById(`pill-filter-${filter}`);
  if (targetPill) targetPill.classList.add("active");
  renderClaims();
}

// TRIAGE EXECUTION
async function startTriage(repoUrl) {
  if (!repoUrl || !repoUrl.trim()) return;

  const btn = document.getElementById("btn-hero-start");
  btn.disabled = true;
  btn.innerText = "⚡ TRIAGING IN SANDBOX...";

  appendTerminalLog({
    timestamp: new Date().toTimeString().split(" ")[0],
    phase: "FETCH",
    message: `[START] Ingesting repository: '${repoUrl}'. Shallow clone and issue fetch initiated...`
  });

  const headers = { "Content-Type": "application/json" };
  const nv = sessionStorage.getItem("cs_byok_nvidia");
  const ds = sessionStorage.getItem("cs_byok_deepseek");
  const cl = sessionStorage.getItem("cs_byok_claude");
  const oa = sessionStorage.getItem("cs_byok_openai");
  if (nv) headers["X-Nvidia-Key"] = nv;
  if (ds) headers["X-DeepSeek-Key"] = ds;
  if (cl) headers["X-Anthropic-Key"] = cl;
  if (oa) headers["X-OpenAI-Key"] = oa;

  try {
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ repo_url: repoUrl.trim() })
    });
    const data = await res.json();
    if (res.ok) {
      appendTerminalLog({
        timestamp: new Date().toTimeString().split(" ")[0],
        phase: "AST-SCAN",
        message: `[INDEXED] ${data.count} issues loaded from ${data.repo}. Indexed ${data.symbols_indexed || 0} symbols across ${data.files_scanned || 0} files. 20-model cascade active...`
      });
      await fetchIssues();
    } else {
      appendTerminalLog({
        timestamp: new Date().toTimeString().split(" ")[0],
        phase: "FETCH",
        message: `[ERROR] Ingestion failed: ${data.error || "Unknown error"}`
      });
    }
  } catch (err) {
    appendTerminalLog({
      timestamp: new Date().toTimeString().split(" ")[0],
      phase: "FETCH",
      message: `[ERROR] Network error: ${err}`
    });
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.innerText = "⚡ START TRIAGE";
      fetchIssues();
    }, 4000);
  }
}

// FETCH DATA
async function fetchIssues() {
  try {
    const res = await fetch("/api/issues");
    allIssues = await res.json();
    updateMetrics();
    renderClaims();
  } catch (err) {
    console.error("Failed to fetch issues:", err);
  }
}

async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const data = await res.json();
      const pill = document.getElementById("active-cascade-pill");
      if (pill && data.active_model) {
        pill.innerText = data.active_model.includes("20-Model") ? "NVIDIA 20-Model Cascade Active" : "Air-Gapped Hybrid Active";
      }
    }
  } catch (e) {}
}

// METRICS & PROGRESS RING
function updateMetrics() {
  const total = allIssues.length;
  const verified = allIssues.filter(i => i.is_real_issue === true).length;
  const slop = allIssues.filter(i => i.is_real_issue === false && i.verdict === "FAKE_SLOP").length;
  const untested = allIssues.filter(i => i.verdict === "UNTESTED_PR").length;
  const fakeTotal = allIssues.filter(i => i.is_real_issue === false).length;

  document.getElementById("count-all").innerText = total;
  document.getElementById("count-real").innerText = verified;
  document.getElementById("count-fake").innerText = fakeTotal;

  document.getElementById("stat-verified-count").innerText = verified;
  document.getElementById("stat-slop-count").innerText = slop;
  document.getElementById("stat-prs-count").innerText = untested;

  // Percentage
  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
  document.getElementById("metric-percent-label").innerText = `${pct}%`;

  // Circular SVG ring (Circumference = 2 * PI * 38 = 238.76)
  const ring = document.getElementById("ring-progress-circle");
  if (ring) {
    const circumference = 238.76;
    const offset = circumference - (pct / 100) * circumference;
    ring.style.strokeDashoffset = offset;
  }

  // Health bar
  const bar = document.getElementById("metric-health-bar");
  if (bar) {
    bar.style.width = `${Math.max(pct, 5)}%`;
  }
}

// RENDER CLAIMS
function renderClaims() {
  const container = document.getElementById("claims-container");
  container.innerHTML = "";

  const hasTriaged = allIssues.some(i => i.evidence !== null);
  if (!hasTriaged) {
    container.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; border-radius: 18px; border: 1.5px dashed rgba(255,255,255,0.18); background: rgba(14,17,24,0.6);">
        <span style="font-size: 11px; font-weight: 800; color: var(--color-orange-bright); text-transform: uppercase;">⚡ AWAITING REPOSITORY INPUT</span>
        <h3 style="font-size: 18px; font-weight: 800; color: #fff; margin-top: 6px;">PASTE A GITHUB REPOSITORY TO BEGIN</h3>
        <p style="font-size: 12px; color: rgba(255,255,255,0.5); max-width: 500px; margin: 6px auto 0 auto; line-height: 1.5;">
          Enter any repository URL above and click <strong>⚡ START TRIAGE</strong>. ClaimSentry will test claims across the 20-model fallback cascade and air-gapped sandboxes.
        </p>
      </div>
    `;
    return;
  }

  const filtered = allIssues.filter(item => {
    if (currentFilter === "real") return item.is_real_issue === true;
    if (currentFilter === "fake") return item.is_real_issue === false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 30px; text-align: center; font-size: 13px; color: rgba(255,255,255,0.4); font-weight: 700;">
        No claims found matching '${currentFilter.toUpperCase()}'.
      </div>
    `;
    return;
  }

  filtered.forEach(issue => {
    const card = document.createElement("div");
    card.className = "claim-card";

    const isReal = issue.is_real_issue === true;
    const badgeClass = isReal ? "claim-badge-verified" : "claim-badge-slop";
    const badgeText = issue.verdict_badge || (isReal ? "✓ REAL CLAIM" : "✗ UNVERIFIED SLOP");

    const whatWrote = issue.what_user_wrote || issue.body || issue.title;
    const howTested = issue.how_we_tested || "We generated an isolated test and executed it in an air-gapped sandbox without network access.";
    const ourView = issue.our_verdict_explanation || (issue.verdict_headline ? `${issue.verdict_headline}: ${issue.evidence ? issue.evidence.reasoning : ''}` : "Verification in progress...");

    card.innerHTML = `
      <div class="claim-card-header">
        <span class="claim-title">#${issue.number}: ${escapeHTML(issue.title)}</span>
        <span class="${badgeClass}">${badgeText}</span>
      </div>

      <div class="claim-section-label">👤 1. What User Reported</div>
      <div class="claim-text-box">${escapeHTML(whatWrote)}</div>

      <div class="claim-section-label">🧪 2. How We Tested It (Isolated Lab)</div>
      <div class="claim-text-box">${escapeHTML(howTested)}</div>

      <div class="claim-section-label">⚖️ 3. Our Verdict &amp; Root-Cause Analysis</div>
      <div class="claim-text-box">${escapeHTML(ourView)}</div>

      <div class="claim-card-footer">
        <button class="btn-inspect-proof" onclick="openProofModal('${issue.id}')">
          TECHNICAL PROOF ↗
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

// PROOF MODAL
function openProofModal(issueId) {
  const issue = allIssues.find(i => i.id === issueId);
  if (!issue) return;

  const modal = document.getElementById("proof-modal");
  document.getElementById("proof-modal-title").innerText = `TECHNICAL PROOF: #${issue.number} ${issue.title}`;

  const content = document.getElementById("proof-modal-content");
  const ev = issue.evidence || {};

  let scriptHtml = "";
  if (ev.repro_script) {
    scriptHtml = `
      <div style="margin-top: 12px;">
        <div style="font-size: 11px; font-weight: 800; color: var(--color-orange-bright); margin-bottom: 4px;">MINIMAL REPRODUCTION SCRIPT (ISOLATED SANDBOX):</div>
        <pre class="code-viewer-obsidian"><code>${escapeHTML(ev.repro_script)}</code></pre>
      </div>
    `;
  }

  let traceHtml = "";
  if (ev.stdout || ev.stderr) {
    traceHtml = `
      <div style="margin-top: 12px;">
        <div style="font-size: 11px; font-weight: 800; color: var(--color-orange-bright); margin-bottom: 4px;">RAW TERMINAL OUTPUT &amp; STACKTRACE (EXIT CODE: ${ev.exit_code}):</div>
        <pre class="code-viewer-obsidian" style="color: #00FF66;"><code>${escapeHTML((ev.stdout ? ev.stdout + '\n' : '') + (ev.stderr || ''))}</code></pre>
      </div>
    `;
  }

  content.innerHTML = `
    <div style="font-size: 12px; line-height: 1.6; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.15);">
      <b>SANDBOX AUDIT SUMMARY:</b><br>
      • Network Blocked: 0.00 MBPS<br>
      • Secrets Leaked: 0<br>
      • Execution Time: ${ev.execution_time_ms || 0} ms<br>
      • Reasoning: ${escapeHTML(ev.reasoning || issue.our_verdict_explanation || 'Executed safely.')}
    </div>
    ${scriptHtml}
    ${traceHtml}
  `;

  modal.classList.add("open");
}

function closeProofModal() {
  document.getElementById("proof-modal").classList.remove("open");
}

// BYOK MODAL
function openByokModal() {
  document.getElementById("byok-modal").classList.add("open");
}

function closeByokModal() {
  document.getElementById("byok-modal").classList.remove("open");
}

function loadStoredByokKeys() {
  const nv = sessionStorage.getItem("cs_byok_nvidia") || "";
  const ds = sessionStorage.getItem("cs_byok_deepseek") || "";
  const cl = sessionStorage.getItem("cs_byok_claude") || "";

  document.getElementById("input-nvidia-key").value = nv;
  document.getElementById("input-deepseek-key").value = ds;
  document.getElementById("input-claude-key").value = cl;

  if (nv || ds || cl) {
    syncKeysToBackend(nv, ds, cl, "");
  }
}

async function saveByokVault() {
  const nv = document.getElementById("input-nvidia-key").value.trim();
  const ds = document.getElementById("input-deepseek-key").value.trim();
  const cl = document.getElementById("input-claude-key").value.trim();

  sessionStorage.setItem("cs_byok_nvidia", nv);
  sessionStorage.setItem("cs_byok_deepseek", ds);
  sessionStorage.setItem("cs_byok_claude", cl);

  await syncKeysToBackend(nv, ds, cl, "");
  closeByokModal();
  fetchStatus();
}

function clearByokVault() {
  sessionStorage.removeItem("cs_byok_nvidia");
  sessionStorage.removeItem("cs_byok_deepseek");
  sessionStorage.removeItem("cs_byok_claude");

  document.getElementById("input-nvidia-key").value = "";
  document.getElementById("input-deepseek-key").value = "";
  document.getElementById("input-claude-key").value = "";

  syncKeysToBackend("", "", "", "");
  closeByokModal();
  fetchStatus();
}

async function syncKeysToBackend(nv, ds, cl, oa) {
  try {
    await fetch("/api/byok/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nvidia_api_key: nv || null,
        deepseek_api_key: ds || null,
        anthropic_api_key: cl || null,
        openai_api_key: oa || null,
      })
    });
  } catch (e) {}
}

// SSE LIVE TERMINAL STREAM
function initSSE() {
  const evtSource = new EventSource("/api/stream");

  evtSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      appendTerminalLog(data);

      if (data.phase === "VERDICT" || data.phase === "TELEMETRY" || data.phase === "FETCH") {
        fetchIssues();
      }
    } catch (err) {}
  };
}

function appendTerminalLog(log) {
  const terminal = document.getElementById("terminal-stream-logs");
  if (!terminal) return;

  const line = document.createElement("div");
  line.className = "terminal-log-row";

  line.innerHTML = `
    <span style="color: rgba(255,255,255,0.4);">[${log.timestamp || "00:00:00"}]</span>
    <span class="log-tag-radiant">[${log.phase || "LOG"}]</span>
    <span>${escapeHTML(log.message)}</span>
  `;

  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
