(function () {
  'use strict';

  const ZH_LANG = 'zh-Hans';
  const EN_LANG = 'en';

  let enabled = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'yt-dual-sub') return;
    if (event.data.type === 'config') {
      enabled = event.data.enabled !== false;
    }
  });

  function isChineseLang(code) {
    return /^zh(-Hans|-CN|-TW|-HK)?$/i.test(code || '');
  }

  function getTranslationLang(sourceLang) {
    if (isChineseLang(sourceLang)) return EN_LANG;
    return ZH_LANG;
  }

  function segText(event) {
    if (!event?.segs) return '';
    return event.segs
      .map((s) => s.utf8 || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasCjk(text) {
    return /[\u4e00-\u9fff]/.test(text);
  }

  function overlap(a, b) {
    return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  }

  function buildSegments(events) {
    const segments = [];
    for (const event of events || []) {
      const text = segText(event);
      if (!text) continue;
      const start = event.tStartMs || 0;
      const duration = event.dDurationMs || 0;
      segments.push({
        start,
        end: start + (duration > 0 ? duration : 0),
        text,
      });
    }

    for (let i = 0; i < segments.length; i++) {
      if (segments[i].end <= segments[i].start) {
        const nextStart = segments[i + 1]?.start;
        segments[i].end = nextStart != null ? nextStart : segments[i].start + 2500;
      }
    }

    return segments;
  }

  function joinSegmentTexts(texts, lang) {
    const parts = texts.filter(Boolean);
    if (!parts.length) return '';

    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const prev = result;
      const next = parts[i];
      if (hasCjk(prev) || hasCjk(next) || isChineseLang(lang)) {
        result = prev + next;
      } else if (prev.endsWith('-')) {
        result = prev.slice(0, -1) + next;
      } else {
        result = `${prev} ${next}`;
      }
    }
    return result.replace(/\s+/g, ' ').trim();
  }

  function groupSegments(segments, gapMs = 700) {
    const groups = [];
    for (const seg of segments) {
      const last = groups[groups.length - 1];
      if (!last || seg.start - last.end > gapMs) {
        groups.push({
          start: seg.start,
          end: seg.end,
          texts: [seg.text],
        });
      } else {
        last.end = Math.max(last.end, seg.end);
        last.texts.push(seg.text);
      }
    }
    return groups;
  }

  function findTranslationForRange(transSegs, start, end, transLang) {
    const overlapping = transSegs
      .filter((t) => overlap({ start, end }, t) > 0)
      .sort((a, b) => a.start - b.start);

    if (overlapping.length) {
      const texts = [];
      const seen = new Set();
      for (const seg of overlapping) {
        if (!seen.has(seg.text)) {
          seen.add(seg.text);
          texts.push(seg.text);
        }
      }
      return joinSegmentTexts(texts, transLang);
    }

    const mid = (start + end) / 2;
    let best = null;
    let bestDist = Infinity;
    for (const seg of transSegs) {
      const center = (seg.start + seg.end) / 2;
      const dist = Math.abs(mid - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = seg;
      }
    }
    return best?.text || '';
  }

  function mergeJson3(original, translated, sourceLang) {
    const metaEvents = (original.events || []).filter((e) => !e.segs);
    const origSegs = buildSegments(original.events);
    const transSegs = buildSegments(translated.events);

    if (!origSegs.length) return original;

    const transLang = getTranslationLang(sourceLang);
    const groups = groupSegments(origSegs);
    const mergedEvents = [];

    for (const group of groups) {
      const overlappingTrans = transSegs.filter((t) =>
        overlap({ start: group.start, end: group.end }, t)
      );
      if (overlappingTrans.length) {
        group.end = Math.max(group.end, ...overlappingTrans.map((t) => t.end));
      }

      const origText = joinSegmentTexts(group.texts, sourceLang);
      const transText = findTranslationForRange(transSegs, group.start, group.end, transLang);
      const duration = Math.max(group.end - group.start, 900);

      if (!origText) continue;

      mergedEvents.push({
        tStartMs: group.start,
        dDurationMs: duration,
        segs: [
          {
            utf8:
              transText && origText !== transText ? `${origText}\n${transText}` : origText,
          },
        ],
      });
    }

    original.events = [...metaEvents, ...mergedEvents].sort(
      (a, b) => (a.tStartMs || 0) - (b.tStartMs || 0)
    );
    return original;
  }

  function shouldProcessUrl(rawUrl) {
    if (!enabled || !rawUrl?.includes('/api/timedtext')) return false;
    try {
      const url = new URL(rawUrl, location.origin);
      return !url.searchParams.has('tlang');
    } catch {
      return false;
    }
  }

  function buildTranslationUrl(rawUrl) {
    const url = new URL(rawUrl, location.origin);
    const sourceLang = url.searchParams.get('lang') || '';
    url.searchParams.set('tlang', getTranslationLang(sourceLang));
    if (!url.searchParams.has('fmt')) {
      url.searchParams.set('fmt', 'json3');
    }
    return url.toString();
  }

  async function mergeWithTranslation(rawUrl, originalData) {
    if (!originalData?.events?.length) return originalData;

    const transResp = await originalFetch(buildTranslationUrl(rawUrl));
    if (!transResp.ok) return originalData;

    const translated = await transResp.json();
    const sourceLang = new URL(rawUrl, location.origin).searchParams.get('lang') || '';
    return mergeJson3(originalData, translated, sourceLang);
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const input = args[0];
    let url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input?.url;

    const response = await originalFetch.apply(this, args);

    if (!shouldProcessUrl(url)) return response;

    try {
      const originalData = await response.clone().json();
      const merged = await mergeWithTranslation(url, originalData);
      return new Response(JSON.stringify(merged), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ytDualUrl = url;
    return xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const xhr = this;
    const url = xhr._ytDualUrl;

    if (!shouldProcessUrl(url)) {
      return xhrSend.apply(xhr, args);
    }

    (async () => {
      try {
        const setReady = (state) => {
          Object.defineProperty(xhr, 'readyState', { configurable: true, value: state });
          xhr.dispatchEvent(new Event('readystatechange'));
        };

        setReady(1);
        setReady(2);
        setReady(3);

        const response = await originalFetch(url);
        const originalData = await response.json();
        const merged = await mergeWithTranslation(url, originalData);
        const body = JSON.stringify(merged);

        Object.defineProperty(xhr, 'status', { configurable: true, value: 200 });
        Object.defineProperty(xhr, 'statusText', { configurable: true, value: 'OK' });
        Object.defineProperty(xhr, 'responseText', { configurable: true, value: body });
        Object.defineProperty(xhr, 'response', { configurable: true, value: body });

        setReady(4);
        xhr.dispatchEvent(new Event('load'));
        xhr.dispatchEvent(new Event('loadend'));
      } catch {
        xhrSend.apply(xhr, args);
      }
    })();
  };

  function enableSubtitles() {
    const btn = document.querySelector('.ytp-subtitles-button');
    if (btn && btn.getAttribute('aria-pressed') === 'false') {
      btn.click();
    }
  }

  function waitForPlayer(callback, attempts = 0) {
    if (document.querySelector('#movie_player') || attempts > 40) {
      callback();
      return;
    }
    setTimeout(() => waitForPlayer(callback, attempts + 1), 250);
  }

  function onVideoPage() {
    if (!location.pathname.startsWith('/watch')) return;
    waitForPlayer(() => {
      if (enabled) enableSubtitles();
    });
  }

  window.addEventListener('yt-navigate-finish', onVideoPage);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onVideoPage);
  } else {
    onVideoPage();
  }
})();
