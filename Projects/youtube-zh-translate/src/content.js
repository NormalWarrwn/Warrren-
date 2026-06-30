(function () {
  'use strict';

  const DEFAULT_CONFIG = { enabled: true };

  function injectScript(onReady) {
    if (document.getElementById('yt-dual-sub-inject')) {
      onReady?.();
      return;
    }
    const script = document.createElement('script');
    script.id = 'yt-dual-sub-inject';
    script.src = chrome.runtime.getURL('src/inject.js');
    script.onload = () => {
      script.remove();
      onReady?.();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function sendConfig(config) {
    window.postMessage({ source: 'yt-dual-sub', type: 'config', ...config }, '*');
  }

  injectScript(() => {
    chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
      sendConfig({ ...DEFAULT_CONFIG, ...stored });
    });
  });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== 'sync') return;
    chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
      sendConfig({ ...DEFAULT_CONFIG, ...stored });
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'getStatus') {
      chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
        sendResponse({ ...DEFAULT_CONFIG, ...stored });
      });
      return true;
    }
    if (message.type === 'setEnabled') {
      chrome.storage.sync.set({ enabled: message.enabled }, () => {
        sendConfig({ enabled: message.enabled });
        sendResponse({ ok: true });
      });
      return true;
    }
  });
})();
