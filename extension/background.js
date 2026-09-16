// Right-click selected text -> "Ask Vendo Assist". Nothing is read unless the user chooses this.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "vendo-assist", title: "Ask Vendo Assist about \"%s\"", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "vendo-assist") return;
  await chrome.storage.session.set({ pendingText: info.selectionText || "" });
  if (chrome.action.openPopup) chrome.action.openPopup().catch(() => {});
});
