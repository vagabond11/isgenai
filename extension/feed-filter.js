const ISGENAI_DEFAULT_FILTER_SETTINGS = {
  enabled: true,
  mode: "dim"
};

const ISGENAI_LABEL_PATTERNS = [
  /\bmade\s+with\s+ai\b/i,
  /\bai[-\s]?generated\b/i,
  /\bgenerated\s+with\s+ai\b/i,
  /\bcreated\s+with\s+ai\b/i,
  /\bai\s+info\b/i,
  /\bsynthetic\s+(media|content|video|image|audio)\b/i,
  /\bimagined\s+with\s+ai\b/i,
  /\baltered\s+or\s+synthetic\b/i
];

const ISGENAI_PLATFORM_SELECTORS = {
  x: ['article[data-testid="tweet"]'],
  twitter: ['article[data-testid="tweet"]'],
  linkedin: [".feed-shared-update-v2", '[data-urn*="activity"]'],
  instagram: ["article"],
  facebook: ['[role="article"]'],
  tiktok: ['[data-e2e="recommend-list-item-container"]', '[data-e2e="feed-video"]'],
  youtube: ["ytd-rich-item-renderer", "ytd-video-renderer", "ytd-reel-video-renderer"],
  bsky: ['[data-testid="feedItem"]', "article"],
  mastodon: [".status", "article"]
};

let isgenaiSettings = { ...ISGENAI_DEFAULT_FILTER_SETTINGS };
let isgenaiStats = {
  scanned: 0,
  filtered: 0,
  lastScanAt: null
};
let isgenaiObserver;
let isgenaiScanQueued = false;

function isgenaiPlatform() {
  const host = location.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "x.com") return "x";
  if (host === "twitter.com") return "twitter";
  if (host.endsWith("linkedin.com")) return "linkedin";
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("facebook.com")) return "facebook";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("youtube.com")) return "youtube";
  if (host.endsWith("bsky.app")) return "bsky";
  if (host.endsWith("mastodon.social")) return "mastodon";
  return "generic";
}

function isgenaiPostSelectors() {
  const platform = isgenaiPlatform();
  return ISGENAI_PLATFORM_SELECTORS[platform] || ["article", '[role="article"]'];
}

function isgenaiText(node) {
  return (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
}

function isgenaiFindSignal(text) {
  for (const pattern of ISGENAI_LABEL_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return "";
}

function isgenaiPostNodes() {
  const nodes = [];
  const seen = new Set();
  for (const selector of isgenaiPostSelectors()) {
    document.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (seen.has(node)) return;
      seen.add(node);
      nodes.push(node);
    });
  }
  return nodes;
}

function isgenaiEnsureBadge(node, signal) {
  let badge = node.querySelector(":scope > .isgenai-feed-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "isgenai-feed-badge";
    const label = document.createElement("span");
    label.textContent = "AI label found · isGenAI";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Show";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      node.classList.remove("isgenai-feed-hidden", "isgenai-feed-dimmed");
      node.classList.add("isgenai-feed-revealed");
    });
    badge.append(label, button);
    node.prepend(badge);
  }
  badge.setAttribute("data-signal", signal);
}

function isgenaiApplyPostState(node, signal) {
  node.dataset.isgenaiFiltered = "true";
  node.dataset.isgenaiSignal = signal;
  isgenaiEnsureBadge(node, signal);
  node.classList.remove("isgenai-feed-hidden", "isgenai-feed-dimmed", "isgenai-feed-labelled");
  if (!isgenaiSettings.enabled || node.classList.contains("isgenai-feed-revealed")) return;
  if (isgenaiSettings.mode === "hide") node.classList.add("isgenai-feed-hidden");
  else if (isgenaiSettings.mode === "label") node.classList.add("isgenai-feed-labelled");
  else node.classList.add("isgenai-feed-dimmed");
}

function isgenaiScanFeed() {
  isgenaiScanQueued = false;
  const nodes = isgenaiPostNodes();
  let filtered = 0;
  for (const node of nodes) {
    const signal = isgenaiFindSignal(isgenaiText(node));
    if (!signal) continue;
    filtered += 1;
    isgenaiApplyPostState(node, signal);
  }
  isgenaiStats = {
    scanned: nodes.length,
    filtered,
    lastScanAt: new Date().toISOString()
  };
  return isgenaiStats;
}

function isgenaiQueueScan() {
  if (isgenaiScanQueued) return;
  isgenaiScanQueued = true;
  window.setTimeout(isgenaiScanFeed, 350);
}

function isgenaiInstallStyles() {
  if (document.getElementById("isgenai-feed-filter-style")) return;
  const style = document.createElement("style");
  style.id = "isgenai-feed-filter-style";
  style.textContent = `
    .isgenai-feed-badge {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 1px solid #24e0a3;
      background: #053f39;
      color: #ffffff;
      font: 800 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
      padding: 8px 10px;
      text-transform: uppercase;
      z-index: 2;
    }
    .isgenai-feed-badge::after {
      content: attr(data-signal);
      color: rgba(255, 255, 255, 0.72);
      font-weight: 700;
      text-transform: none;
    }
    .isgenai-feed-badge button {
      border: 1px solid #24e0a3;
      background: #24e0a3;
      color: #032a26;
      cursor: pointer;
      font: inherit;
      padding: 5px 8px;
    }
    .isgenai-feed-dimmed {
      opacity: 0.28 !important;
      filter: grayscale(1) !important;
      transition: opacity 160ms ease, filter 160ms ease;
    }
    .isgenai-feed-dimmed:hover {
      opacity: 0.72 !important;
    }
    .isgenai-feed-hidden > :not(.isgenai-feed-badge) {
      display: none !important;
    }
    .isgenai-feed-hidden,
    .isgenai-feed-labelled {
      border: 1px solid #24e0a3 !important;
    }
    .isgenai-feed-hidden > .isgenai-feed-badge,
    .isgenai-feed-labelled > .isgenai-feed-badge,
    .isgenai-feed-dimmed > .isgenai-feed-badge {
      display: flex;
    }
    .isgenai-feed-revealed > .isgenai-feed-badge {
      display: none !important;
    }
  `;
  document.documentElement.append(style);
}

async function isgenaiLoadSettings() {
  const state = await chrome.storage.local.get(["feedFilterEnabled", "feedFilterMode"]);
  isgenaiSettings = {
    enabled: state.feedFilterEnabled !== false,
    mode: ["hide", "dim", "label"].includes(state.feedFilterMode) ? state.feedFilterMode : "dim"
  };
}

async function isgenaiStart() {
  isgenaiInstallStyles();
  await isgenaiLoadSettings();
  isgenaiScanFeed();
  if (isgenaiObserver) isgenaiObserver.disconnect();
  isgenaiObserver = new MutationObserver(isgenaiQueueScan);
  isgenaiObserver.observe(document.body, { childList: true, subtree: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ISGENAI_FEED_FILTER_APPLY") {
    isgenaiSettings = {
      enabled: message.settings?.enabled !== false,
      mode: ["hide", "dim", "label"].includes(message.settings?.mode) ? message.settings.mode : "dim"
    };
    const stats = isgenaiScanFeed();
    sendResponse({ ok: true, stats });
    return true;
  }
  if (message?.type === "ISGENAI_FEED_FILTER_STATS") {
    sendResponse({ ok: true, stats: isgenaiStats, platform: isgenaiPlatform() });
    return true;
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.feedFilterEnabled && !changes.feedFilterMode) return;
  isgenaiLoadSettings().then(isgenaiScanFeed);
});

isgenaiStart();
