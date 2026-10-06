/**
 * api.js - all network calls: one request at a time, pacing, retry rules, cache.
 * Retries only HTTP 429, 5xx and network errors. 403 or repeated 429 stops the run (fatal).
 * Other 4xx fail at once and are never retried.
 */
(function (root, factory) {
  const m = factory(typeof require === 'function' ? require('./library.js') : root.Lib);
  if (typeof module === 'object' && module.exports) module.exports = m; else root.Api = m;
})(typeof self !== 'undefined' ? self : this, function (Lib) {
  'use strict';

  class ApiError extends Error {
    constructor(kind, message, status) { super(message); this.kind = kind; this.status = status || 0; }
  }
  // kind: 'fatal' (stop the whole run) | 'http' (4xx, not retried) | 'error' (network/5xx after retries)

  const CACHE_TTL_MS = 60 * 60 * 1000;
  const CACHE_MAX = 300;
  const MAX_RETRIES = 3;

  function createApi(o) {
    const fetchFn = o.fetchFn;
    const sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const now = o.now || (() => Date.now());
    const storage = o.storage || null; // { load(): Promise<object>, save(obj): Promise }
    let delayMs = o.delayMs == null ? 500 : o.delayMs;
    let cache = {};
    let lastReq = 0;
    const stats = { requests: 0, cacheHits: 0 };

    async function init() {
      if (!storage) return;
      try {
        cache = (await storage.load()) || {};
        const t = now();
        for (const k of Object.keys(cache)) if (!cache[k] || t - cache[k].t > CACHE_TTL_MS) delete cache[k];
      } catch (e) { cache = {}; }
    }
    async function persist() {
      if (!storage) return;
      const keys = Object.keys(cache);
      if (keys.length > CACHE_MAX) {
        keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - CACHE_MAX).forEach(k => delete cache[k]);
      }
      try { await storage.save(cache); } catch (e) { /* quota or storage error: cache is best-effort */ }
    }
    async function clearCache() { cache = {}; await persist(); }

    async function pace() {
      const wait = lastReq + delayMs - now();
      if (lastReq && wait > 0) await sleep(wait);
      lastReq = now();
    }

    async function getJson(url) {
      let lastStatus = 0, lastMsg = '';
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) await sleep(1000 * Math.pow(2, attempt - 1));
        await pace();
        stats.requests++;
        let res;
        try { res = await fetchFn(url); } catch (e) { lastStatus = 0; lastMsg = 'network error'; continue; }
        if (res.status === 403) throw new ApiError('fatal', 'The library refused the request (HTTP 403). Your IP may be blocked. Stop and try again later.', 403);
        if (res.ok) {
          try { return await res.json(); } catch (e) { throw new ApiError('http', 'Unreadable response', res.status); }
        }
        if (res.status === 429 || res.status >= 500) { lastStatus = res.status; lastMsg = 'HTTP ' + res.status; continue; }
        throw new ApiError('http', 'HTTP ' + res.status, res.status);
      }
      if (lastStatus === 429) throw new ApiError('fatal', 'The library is rate-limiting requests (HTTP 429). Wait a few minutes and run again.', 429);
      throw new ApiError('error', lastMsg || 'request failed', lastStatus);
    }

    async function cached(key, fetcher) {
      const hit = cache[key];
      if (hit && now() - hit.t <= CACHE_TTL_MS) { stats.cacheHits++; return hit.v; }
      const v = await fetcher();
      if (Array.isArray(v) && v.length === 0 && key === 'loc2') return v; // never cache an empty branch list
      cache[key] = { t: now(), v };
      await persist();
      return v;
    }

    return {
      init, clearCache, stats,
      setDelay(ms) { delayMs = ms; },
      search(query, branchCode, page) {
        const url = Lib.searchUrl(query, { branchCode, page });
        return cached('s|' + url, async () => Lib.parseSearch(await getJson(url)));
      },
      availability(id, branchCode) {
        return cached(`a2|${id}|${branchCode}`, async () => Lib.parseAvailability(await getJson(Lib.availabilityUrl(id)), branchCode));
      },
      async locations() {
        return cached('loc2', async () => Lib.parseLocations(await getJson(Lib.locationsUrl())));
      }
    };
  }

  return { createApi, ApiError, CACHE_TTL_MS, CACHE_MAX };
});
