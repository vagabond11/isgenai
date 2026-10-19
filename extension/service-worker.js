importScripts("config.js");

const MENU_IMAGE = "isgenai-image";
const MENU_PAGE = "isgenai-page";
const MENU_FEED = "isgenai-feed-filter";

// Chrome and Edge have a side panel; browsers without it (Opera) get the same page in a small window.
const hasSidePanel = Boolean(chrome.sidePanel?.open);

function openPanelWindow() {
  chrome.windows.create({ url: chrome.runtime.getURL("side-panel.html"), type: "popup", width: 420, height: 760 }).catch(() => undefined);
}

function enablePanelOnActionClick() {
  if (hasSidePanel) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
}

if (!hasSidePanel) chrome.action.onClicked.addListener(() => openPanelWindow());

chrome.runtime.onInstalled.addListener(async () => {
  enablePanelOnActionClick();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_IMAGE, title: "Check image with isGenAI", contexts: ["image"] });
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Check this page with isGenAI", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_FEED, title: "Apply isGenAI AI-label feed filter", contexts: ["page"] });
  });
  const state = await chrome.storage.local.get(["feedFilterEnabled", "feedFilterMode"]);
  await chrome.storage.local.set({
    feedFilterEnabled: state.feedFilterEnabled !== undefined ? state.feedFilterEnabled : true,
    feedFilterMode: state.feedFilterMode || "dim"
  });
});

chrome.runtime.onStartup.addListener(enablePanelOnActionClick);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_FEED) {
    if (!tab?.id) return;
    chrome.storage.local.get(["feedFilterEnabled", "feedFilterMode"]).then((state) =>
      chrome.tabs.sendMessage(tab.id, {
        type: "ISGENAI_FEED_FILTER_APPLY",
        settings: { enabled: state.feedFilterEnabled !== false, mode: state.feedFilterMode || "dim" }
      })
    ).catch(() => undefined);
    return;
  }

  const url = info.menuItemId === MENU_IMAGE ? info.srcUrl : info.pageUrl;
  if (!url || !tab?.id) return;
  // sidePanel.open must run inside the click gesture, before any awaited work.
  if (hasSidePanel) chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
  chrome.storage.session.set({
    pendingCheck: { url, kind: info.menuItemId === MENU_IMAGE ? "image" : "page", createdAt: Date.now() }
  }).then(() => { if (!hasSidePanel) openPanelWindow(); });
});
