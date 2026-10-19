/* global ISGENAI_ORIGIN */
const result = document.querySelector("#result");
const checkButton = document.querySelector("#checkButton");
const publicReport = document.querySelector("#publicReport");
const feedFilterEnabled = document.querySelector("#feedFilterEnabled");
const applyFeedFilter = document.querySelector("#applyFeedFilter");
const feedStats = document.querySelector("#feedStats");

document.querySelector("#siteLink").href = `${ISGENAI_ORIGIN}/ai-image-detector`;
document.querySelector("#privacyLink").href = `${ISGENAI_ORIGIN}/privacy`;

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function feedMode() {
  return document.querySelector('input[name="feedMode"]:checked')?.value || "dim";
}

function setFeedMode(value) {
  const input = document.querySelector(`input[name="feedMode"][value="${value}"]`);
  if (input) input.checked = true;
}

async function applyFeedSettings() {
  const tab = await currentTab();
  const settings = { enabled: feedFilterEnabled.checked, mode: feedMode() };
  await chrome.storage.local.set({ feedFilterEnabled: settings.enabled, feedFilterMode: settings.mode });
  if (!tab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "ISGENAI_FEED_FILTER_APPLY", settings });
    const stats = response?.stats;
    feedStats.textContent = stats ? `${stats.filtered} labelled / ${stats.scanned} posts scanned` : "Filter applied.";
  } catch {
    feedStats.textContent = "Open a supported social feed tab, then apply.";
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showMessage(text) {
  result.replaceChildren(element("p", text));
}

function checkableUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function renderResult(body) {
  const summary = body.public_result;
  const nodes = [];
  nodes.push(element("span", summary?.headline || body.verdict?.label || "Checked", "badge"));
  if (summary?.basis) nodes.push(element("p", `Basis: ${summary.basis}`, "basis"));
  nodes.push(element("p", summary?.summary || body.verdict?.summary || ""));
  if (Array.isArray(summary?.facts) && summary.facts.length) {
    const list = element("ul");
    for (const fact of summary.facts.slice(0, 6)) list.append(element("li", String(fact)));
    nodes.push(list);
  }
  const caveat = summary?.caveat || body.verdict?.caveats?.[0];
  if (caveat) nodes.push(element("p", caveat, "caveat"));
  const receiptUrl = body.receipt?.url;
  if (receiptUrl && receiptUrl.startsWith(`${ISGENAI_ORIGIN}/`)) {
    const link = element("a", "Open the public report");
    link.href = receiptUrl;
    link.target = "_blank";
    link.rel = "noopener";
    nodes.push(link);
  } else {
    const link = element("a", "Upload the original file for a deeper check");
    link.href = `${ISGENAI_ORIGIN}/ai-image-detector`;
    link.target = "_blank";
    link.rel = "noopener";
    nodes.push(link);
  }
  result.replaceChildren(...nodes);
}

async function runCheck(url) {
  if (!checkableUrl(url)) {
    showMessage("This item has no public web address (for example an embedded or browser-only image). Save it and upload it on isgenai.com instead.");
    return;
  }
  const makePublic = publicReport.checked;
  result.replaceChildren(element("p", "Checking…"));
  checkButton.disabled = true;
  try {
    const response = await fetch(`${ISGENAI_ORIGIN}/v1/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makePublic
        ? { url, privacy: "public", public_receipt: true, source_context: "chrome_extension" }
        : { url, privacy: "private", public_receipt: false, source_context: "chrome_extension" })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `Check failed (HTTP ${response.status}).`);
    renderResult(body);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Check failed.");
  } finally {
    checkButton.disabled = false;
  }
}

async function takePendingCheck() {
  const { pendingCheck } = await chrome.storage.session.get("pendingCheck");
  if (!pendingCheck?.url) return;
  await chrome.storage.session.remove("pendingCheck");
  await runCheck(pendingCheck.url);
}

chrome.storage.local.get(["feedFilterEnabled", "feedFilterMode", "publicReport"], (state) => {
  feedFilterEnabled.checked = state.feedFilterEnabled !== false;
  publicReport.checked = state.publicReport === true;
  setFeedMode(state.feedFilterMode || "dim");
  takePendingCheck();
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pendingCheck?.newValue) takePendingCheck();
});

checkButton.addEventListener("click", async () => {
  const tab = await currentTab();
  if (tab?.url) await runCheck(tab.url);
  else showMessage("Click the isGenAI toolbar icon on the page you want to check, then try again.");
});

publicReport.addEventListener("change", () => chrome.storage.local.set({ publicReport: publicReport.checked }));
applyFeedFilter.addEventListener("click", applyFeedSettings);
feedFilterEnabled.addEventListener("change", applyFeedSettings);
document.querySelectorAll('input[name="feedMode"]').forEach((input) => {
  input.addEventListener("change", applyFeedSettings);
});
