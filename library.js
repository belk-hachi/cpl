/**
 * library.js - pure logic, no network and no DOM. Works in the browser and in Node tests.
 */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.Lib = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE = 'https://gateway.bibliocommons.com/v2/libraries/chipublib';
  const CATALOG = 'https://chipublib.bibliocommons.com/v2/record/';
  const FORMAT_CLAUSE = 'formatcode:(BK OR PAPERBACK )';

  // libraryStatus values that mean the branch owns/holds a copy (so no need to order).
  const IN_STOCK_STATUSES = ['Available', 'Checked Out', 'Hold Shelf', 'In Transit', 'Transferred for Hold', 'In-Library Use Only', 'Not Yet Shelved'];
  // libraryStatus values that mean a copy has been ordered but has not arrived.
  const ON_ORDER_STATUSES = ['On Order'];

  const low = s => String(s == null ? '' : s).trim().toLowerCase();
  const IN_STOCK_LOW = IN_STOCK_STATUSES.map(low);
  const ON_ORDER_LOW = ON_ORDER_STATUSES.map(low);

  /** 'inStock' | 'onOrder' | 'unknown' (unknown is counted as in stock by decide()). */
  function classifyStatus(status) {
    const s = low(status);
    if (ON_ORDER_LOW.includes(s)) return 'onOrder';
    if (IN_STOCK_LOW.includes(s)) return 'inStock';
    return 'unknown';
  }

  // ---------- titles ----------
  /** Drop edition noise from a spreadsheet title: second title after ';', (parentheses), subtitle after ':', "Revised and Updated", "25th Anniversary Edition". */
  function cleanTitle(t) {
    let s = String(t == null ? '' : t).split(';')[0];
    s = s.replace(/\([^)]*\)/g, ' ');
    s = s.split(':')[0];
    s = s.replace(/[,\s]+(?:revised(?: and updated)?|updated|expanded|\d+(?:st|nd|rd|th)[- ]anniversary|anniversary)\b.*$/i, '');
    return s.replace(/\s+/g, ' ').trim();
  }

  function normalizeTitle(t) {
    let s = cleanTitle(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    s = s.replace(/&/g, ' and ');
    s = s.split(':')[0];
    s = s.replace(/,\s*or,\s.*$/, '');
    s = s.replace(/\([^)]*\)/g, ' ');
    s = s.replace(/['’`]/g, '');
    s = s.replace(/[^a-z0-9]+/g, ' ').trim();
    s = s.replace(/^(the|a|an)\s+/, '');
    return s;
  }

  const loose = t => t.split(' ').filter(w => !['the', 'a', 'an'].includes(w)).join(' ');

  function editDistance(x, y) {
    const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    return d[x.length][y.length];
  }
  /** Same words, allowing a spelling variant in long words (Ilyich / Ilych). */
  function sameWords(a, b) {
    const x = loose(a).split(' '), y = loose(b).split(' ');
    if (x.length !== y.length || x.length < 2) return false;
    return x.every((w, i) => w === y[i] || (w.length >= 5 && y[i].length >= 5 && editDistance(w, y[i]) <= 2));
  }

  /** 'exact' | 'near' | 'none'. near = one title contains the other as whole words (shorter has 2+ words). */
  function titleRelation(sheetTitle, editionTitle, author) {
    const a = normalizeTitle(sheetTitle);
    let b = normalizeTitle(editionTitle);
    // "Joseph Conrad's Heart of Darkness" is the same book as "Heart of Darkness".
    const words = String(author || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019`]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length) {
      const forms = [words.join(' ') + 's ', ...words.map(w => w + 's '), ...(words.length > 1 ? [words.slice().reverse().join(' ') + 's '] : [])];
      const hit = forms.find(f => b.startsWith(f) && b.length > f.length);
      if (hit) b = b.slice(hit.length);
    }
    if (!a || !b) return 'none';
    if (a === b || loose(a) === loose(b) || sameWords(a, b)) return 'exact';
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.split(' ').length >= 2 && (' ' + long + ' ').includes(' ' + short + ' ')) return 'near';
    return 'none';
  }

  // ---------- queries ----------
  function authorForQuery(a) {
    let s = String(a == null ? '' : a).trim();
    if (!s) return '';
    s = s.split(/;|&|\/|\s+and\s+/i)[0];
    s = s.replace(/[()"“”:]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.includes(',')) return s.replace(/\s*,\s*/, ', ');
    const p = s.split(' ');
    if (p.length === 1) return s;
    if (/^(jr|sr|ii|iii|iv)\.?$/i.test(p[p.length - 1])) p.pop();
    if (p.length === 1) return p[0];
    const last = p.pop();
    return last + ', ' + p.join(' ');
  }

  function titleForQuery(t) {
    return cleanTitle(t).replace(/&/g, ' and ').replace(/["\u201c\u201d]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function buildQuery(book, titleOnly) {
    const title = titleForQuery(book.title);
    const author = authorForQuery(book.author);
    if (!author || titleOnly) return `(title:(${title}) ) ${FORMAT_CLAUSE}`;
    return `(contributor:(${author}) AND title:(${title}) ) ${FORMAT_CLAUSE}`;
  }

  function searchUrl(query, opts) {
    const o = opts || {};
    let u = `${BASE}/bibs/search?query=${encodeURIComponent(query)}&searchType=bl&locale=en-US`;
    if (o.branchCode) u += `&f_STATUS=${encodeURIComponent(o.branchCode)}`;
    if (o.page && o.page > 1) u += `&page=${o.page}`;
    return u;
  }
  const availabilityUrl = id => `${BASE}/bibs/${encodeURIComponent(id)}/availability?locale=en-US`;
  const locationsUrl = () => `${BASE}/locations?limit=200&locale=en-US`;
  const recordUrl = id => CATALOG + id;
  /** Link to the CPL website's own search, for rows a person has to check by hand. */
  function catalogSearchUrl(title, author) {
    const q = [titleForQuery(title), authorForQuery(author)].filter(Boolean).join(' ');
    return 'https://chipublib.bibliocommons.com/v2/search?searchType=smart&query=' + encodeURIComponent(q);
  }

  // ---------- parsing ----------
  function yearOf(d) {
    const m = String(d == null ? '' : d).match(/(1[4-9]\d\d|20\d\d)/);
    return m ? m[1] : '';
  }

  function parseSearch(json) {
    const cs = (json && json.catalogSearch) || {};
    const pg = cs.pagination || {};
    const bibs = (json && json.entities && json.entities.bibs) || {};
    const seen = new Set();
    const editions = [];
    for (const r of cs.results || []) {
      const id = r.representative || (r.manifestations && r.manifestations[0]);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const b = bibs[id] || {};
      const bi = b.briefInfo || {};
      const av = b.availability || {};
      editions.push({
        id,
        title: bi.title || '',
        format: bi.format || '',
        year: yearOf(bi.publicationDate),
        authors: bi.authors || [],
        onOrderCopies: Number(av.onOrderCopies) || 0,
        availableCopies: Number(av.availableCopies) || 0,
        totalCopies: Number(av.totalCopies) || 0,
        heldCopies: Number(av.heldCopies) || 0
      });
    }
    return { count: Number(pg.count) || editions.length, pages: Number(pg.pages) || 1, page: Number(pg.page) || 1, editions };
  }

  /** Copies of one bib at one branch (matched by branch code). */
  function parseAvailability(json, branchCode) {
    const items = Object.values((json && json.entities && json.entities.bibItems) || {});
    const out = [];
    for (const it of items) {
      if (!it || !it.branch || String(it.branch.code) !== String(branchCode)) continue;
      const av = it.availability || {};
      out.push({
        status: av.libraryStatus || '',
        statusType: av.statusType || '',
        due: it.dueDate || av.dueDate || '',
        callNumber: it.callNumber || '',
        branchName: it.branchName || ''
      });
    }
    return out;
  }

  /** Branch list from /locations: entities.locations[id] = { id, name, ... }; the id is the branch code (Little Italy = 62). */
  function parseLocations(json) {
    const ents = (json && json.entities && json.entities.locations) || {};
    const out = [];
    for (const [key, v] of Object.entries(ents)) {
      if (!v || typeof v.name !== 'string' || v.isHidden) continue;
      out.push({ code: String(v.id != null ? v.id : key), name: v.name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- decision ----------
  function isOverdue(due, today) {
    const m = String(due || '').match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1] < today;
    const t = Date.parse(due);
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) < today;
  }

  const RANK = { 'available': 0, 'hold shelf': 1, 'transferred for hold': 2, 'in transit': 3, 'checked out': 4 };
  function copyLabel(c) {
    const s = low(c.status);
    if (s === 'checked out') return 'Checked out' + (c.due ? ', due ' + String(c.due).slice(0, 10) : '');
    return c.status || 'Unknown status';
  }
  function bestCopy(copies) {
    return copies.slice().sort((a, b) => {
      const ra = RANK[low(a.status)] ?? 5, rb = RANK[low(b.status)] ?? 5;
      if (ra !== rb) return ra - rb;
      return String(a.due || '9999').localeCompare(String(b.due || '9999'));
    })[0];
  }

  /**
   * in: { inStock:[copy], onOrder:[copy], notFound, partial, near:[title], error }
   * copy: { editionId, title, format, year, status, due }
   * out: { status, copyDetail, due, overdue, best }
   */
  function decide(r, today) {
    if (r.error) return { status: 'ERROR', copyDetail: r.error, due: '', overdue: false };
    if (r.inStock && r.inStock.length) {
      const best = bestCopy(r.inStock);
      for (const c of r.inStock) {
        if (classifyStatus(c.status) === 'unknown' && !warned.has(c.status)) {
          warned.add(c.status);
          console.warn('[cpl] unknown copy status counted as in stock:', c.status);
        }
      }
      const n = r.inStock.length;
      const isCheckedOut = low(best.status) === 'checked out';
      return {
        status: 'IN STOCK',
        copyDetail: copyLabel(best) + (n > 1 ? ` (${n} copies)` : ''),
        due: isCheckedOut ? String(best.due || '').slice(0, 10) : '',
        overdue: isCheckedOut && !!best.due && isOverdue(best.due, today),
        best
      };
    }
    if (r.onOrder && r.onOrder.length) {
      return { status: 'ON ORDER', copyDetail: 'On order', due: '', overdue: false, best: r.onOrder[0] };
    }
    if (r.notFound) return { status: 'CHECK MANUALLY', copyDetail: 'Not found in the catalog', due: '', overdue: false };
    if (r.near && r.near.length) {
      return { status: 'CHECK MANUALLY', copyDetail: 'Possible match at branch: ' + [...new Set(r.near)].slice(0, 2).join('; '), due: '', overdue: false };
    }
    if (r.partial) return { status: 'CHECK MANUALLY', copyDetail: r.partial, due: '', overdue: false };
    if (r.httpNote) return { status: 'CHECK MANUALLY', copyDetail: r.httpNote, due: '', overdue: false };
    return { status: 'NOT AT BRANCH', copyDetail: '', due: '', overdue: false };
  }

  const warned = new Set();
  const STATUSES = ['IN STOCK', 'ON ORDER', 'NOT AT BRANCH', 'CHECK MANUALLY', 'ERROR'];

  return {
    BASE, IN_STOCK_STATUSES, ON_ORDER_STATUSES, STATUSES,
    classifyStatus, cleanTitle, normalizeTitle, titleRelation, authorForQuery, titleForQuery,
    buildQuery, searchUrl, availabilityUrl, locationsUrl, recordUrl, catalogSearchUrl,
    yearOf, parseSearch, parseAvailability, parseLocations, isOverdue, decide, copyLabel
  };
});
