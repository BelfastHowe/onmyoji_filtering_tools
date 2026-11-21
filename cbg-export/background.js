chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    const url = new URL(tab.url);
    if (url.origin !== "https://yys.cbg.163.com" || !/^\/cgi\/mweb\/pl\/?$/.test(url.pathname)) {
      throw new Error("请在阴阳师藏宝阁的角色筛选结果页打开扩展");
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      files: ["export.js"]
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: "导出当前筛选下的账号 JSON" });
  } catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({ tabId: tab.id, title: error.message });
  }
});
