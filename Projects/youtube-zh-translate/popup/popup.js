const enabledEl = document.getElementById('enabled');
const statusEl = document.getElementById('status');

function showStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => {
    if (statusEl.textContent === text) statusEl.textContent = '';
  }, 2000);
}

chrome.storage.sync.get({ enabled: true }, (stored) => {
  enabledEl.checked = stored.enabled;
});

enabledEl.addEventListener('change', () => {
  const enabled = enabledEl.checked;
  chrome.storage.sync.set({ enabled }, () => {
    showStatus(enabled ? '双语字幕已启用' : '双语字幕已关闭');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id && tab.url?.includes('youtube.com')) {
        chrome.tabs.sendMessage(tab.id, { type: 'setEnabled', enabled });
      }
    });
  });
});
