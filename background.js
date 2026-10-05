// background.js — MV3 Service Worker
// Opens app.html in a full page tab when toolbar icon is clicked.

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});

self.addEventListener("install", () => {
  console.log("[library-checker] Service worker installed");
});
