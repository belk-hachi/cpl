(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  function h(tag, attrs, kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    for (const c of [].concat(kids || [])) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }
  const safe = fn => { try { return fn(); } catch (e) { return undefined; } };
  const store = {
    async get(k) { return (await chrome.storage.local.get(k))[k]; },
    set(k, v) { return chrome.storage.local.set({ [k]: v }); }
  };

  const state = { workbook: null, rows: [], books: [], results: [], branches: [], running: false, cancel: false, fileName: '',
    filter: 'ALL', query: '', sort: { key: 'rowIndex', dir: 1 }, open: new Set(), settings: {} };

  let api;
  const FALLBACK_BRANCHES = [{ code: '62', name: 'Little Italy' }];
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  // ---------- setup ----------
  async function init() {
    $('ver').textContent = chrome.runtime.getManifest().version;
    state.settings = (await store.get('settings')) || {};
    api = Api.createApi({
      fetchFn: url => fetch(url, { headers: { Accept: 'application/json' } }),
      storage: { load: () => store.get('cache'), save: o => store.set('cache', o) },
      delayMs: 1000
    });
    await api.init();
    const pauseMs = [500, 1000, 2000, 3000].includes(Number(state.settings.pauseMs)) ? Number(state.settings.pauseMs) : 1000;
    $('pauseSel').value = String(pauseMs); api.setDelay(pauseMs);
    await loadBranches();
    bind();
    await offerSavedSession();
  }

  // ---------- saved session (pause / resume across closing the tab) ----------
  let lastSave = 0;
  function saveSession() {
    lastSave = Date.now();
    return Promise.resolve(store.set('session', { fileName: state.fileName, books: state.books, results: state.results, branch: state.branch, savedAt: lastSave }))
      .catch(e => showBanner('Could not save progress (' + e.message + '). Export the CSV before closing this page.'));
  }
  const hasProgress = () => state.results.some(Boolean);
  // Columns, sheet and branch must not change once results exist, or old and new rows would not match.
  function lockInputs(locked) {
    for (const id of ['titleCol', 'authorCol', 'sheetSel', 'branchSel']) $(id).disabled = locked;
  }
  const remaining = () => state.books.map((b, i) => (state.results[i] ? -1 : i)).filter(i => i >= 0);

  async function offerSavedSession() {
    const s = await store.get('session');
    if (!s || !s.books || !s.results || !s.results.some(Boolean)) return;
    state.saved = s;
    const done = s.results.filter(Boolean).length;
    const box = $('resumeBox');
    $('resumeText').textContent = `Unfinished check of "${s.fileName || 'a spreadsheet'}": ${done} of ${s.books.length} books done (${new Date(s.savedAt).toLocaleString()}).`;
    box.hidden = false;
    $('btnResumeSaved').onclick = () => {
      box.hidden = true; state.saved = null;
      state.fileName = s.fileName; state.books = s.books; state.results = s.results; state.branch = s.branch;
      if (s.branch && state.branches.some(b => b.code === s.branch.code)) $('branchSel').value = s.branch.code;
      $('fileName').textContent = s.fileName || '';
      $('stepSetup').hidden = false; $('stepResults').hidden = false; $('progress').hidden = false;
      $('titleCol').replaceChildren(); $('authorCol').replaceChildren();
      showStartButton();
      renderTable();
    };
    $('btnDiscardSaved').onclick = async () => { box.hidden = true; state.saved = null; await store.set('session', null); };
  }

  function showStartButton() {
    lockInputs(hasProgress());
    const left = remaining().length, any = state.results.some(Boolean);
    $('btnStart').disabled = !state.books.length || (any && !left);
    $('btnStart').textContent = any && left ? 'Resume' : 'Check';
    $('progressText').textContent = any ? `${state.books.length - left} of ${state.books.length} done` + (left ? ' (paused)' : '') : `${state.books.length} books`;
    $('progressFill').style.width = (state.books.length ? (state.books.length - left) / state.books.length * 100 : 0) + '%';
  }

  async function loadBranches() {
    let list = [];
    try { list = await api.locations(); } catch (e) { list = []; }
    if (!list.length) {
      list = FALLBACK_BRANCHES;
      $('progressText').textContent = 'Branch list unavailable. Only Little Italy is offered.';
    }
    state.branches = list;
    const sel = $('branchSel');
    sel.replaceChildren(...list.map(b => h('option', { value: b.code, text: b.name })));
    const saved = state.settings.branchCode;
    const def = list.find(b => b.code === saved) || list.find(b => /little italy/i.test(b.name)) || list[0];
    sel.value = def.code;
  }

  function bind() {
    const dz = $('dropZone'), fi = $('fileInput');
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    fi.addEventListener('change', () => fi.files[0] && loadFile(fi.files[0]));
    ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]));
    $('sheetSel').addEventListener('change', () => loadSheet($('sheetSel').value));
    $('titleCol').addEventListener('change', refreshBooks);
    $('authorCol').addEventListener('change', refreshBooks);
    $('pauseSel').addEventListener('change', () => { const ms = Number($('pauseSel').value); api.setDelay(ms); state.settings.pauseMs = ms; store.set('settings', state.settings); });
    $('branchSel').addEventListener('change', () => { state.settings.branchCode = $('branchSel').value; store.set('settings', state.settings); });
    $('btnStart').addEventListener('click', () => (state.results.some(Boolean) && remaining().length ? run(remaining(), true) : run(state.books.map((b, i) => i))));
    $('btnCancel').addEventListener('click', () => { state.cancel = true; $('btnCancel').disabled = true; $('btnCancel').textContent = 'Pausing...'; });
    $('btnRetry').addEventListener('click', () => run(state.results.map((r, i) => (r && r.status === 'ERROR' ? i : -1)).filter(i => i >= 0), true));
    $('btnCsv').addEventListener('click', downloadCsv);
    $('search').addEventListener('input', e => { state.query = e.target.value.toLowerCase(); renderTable(); });
    document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 };
      renderTable();
    }));
    $('clearCache').addEventListener('click', async e => { e.preventDefault(); await api.clearCache(); $('progressText').textContent = 'Cache cleared.'; });
  }

  // ---------- file ----------
  async function loadFile(file) {
    $('fileInput').value = '';
    if (hasProgress() && !confirm(`This will discard the ${state.results.filter(Boolean).length} results on screen (export the CSV first if you need them). Continue?`)) return;
    try {
      const buf = await file.arrayBuffer();
      state.workbook = SheetUtils.readWorkbook(new Uint8Array(buf));
      state.fileName = file.name; state.results = [];
      $('fileName').textContent = file.name;
      const names = state.workbook.SheetNames;
      $('sheetWrap').hidden = names.length < 2;
      $('sheetSel').replaceChildren(...names.map(n => h('option', { value: n, text: n })));
      loadSheet(names[0]);
      $('stepSetup').hidden = false;
      showBanner('');
    } catch (e) {
      showBanner('Could not read that file: ' + e.message);
    }
  }

  function loadSheet(name) {
    state.rows = SheetUtils.sheetTo2DArray(state.workbook.Sheets[name]);
    const headers = state.rows[0] || [];
    const g = SheetUtils.guessColumns(headers);
    const opts = () => headers.map((t, i) => h('option', { value: i, text: t || `Column ${i + 1}` }));
    $('titleCol').replaceChildren(...opts()); $('authorCol').replaceChildren(...opts());
    $('titleCol').value = g.titleCol; $('authorCol').value = g.authorCol;
    const pv = $('previewTable');
    pv.replaceChildren(
      h('thead', {}, h('tr', {}, headers.map(t => h('th', { text: t })))),
      h('tbody', {}, state.rows.slice(1, 6).map(r => h('tr', {}, headers.map((_, i) => h('td', { text: r[i] || '' })))))
    );
    refreshBooks();
  }

  function refreshBooks() {
    state.books = SheetUtils.extractBookRows(state.rows, +$('titleCol').value, +$('authorCol').value).filter(b => b.title);
    state.results = [];
    showStartButton();
  }

  // ---------- run ----------
  async function run(indexes, isRetry) {
    if (state.running || !indexes.length) return;
    if (!isRetry && state.saved && !confirm(`This will replace the unfinished check of "${state.saved.fileName}" (${state.saved.results.filter(Boolean).length} of ${state.saved.books.length} done). Continue?`)) return;
    if (!isRetry) state.saved = null;
    const code = $('branchSel').value;
    const branch = hasProgress() && state.branch ? state.branch : { code, name: state.branches.find(b => b.code === code).name };
    state.running = true; state.cancel = false; state.branch = branch;
    if (!isRetry) { state.results = new Array(state.books.length).fill(null); state.open.clear(); }
    $('btnStart').hidden = true; $('btnCancel').hidden = false; $('btnCancel').disabled = false; $('btnCancel').textContent = 'Pause';
    $('resumeBox').hidden = true; lockInputs(true);
    $('stepResults').hidden = false; $('progress').hidden = false; showBanner('');
    renderTable();
    let done = 0;
    for (const i of indexes) {
      if (state.cancel) break;
      $('progressText').textContent = `${done} of ${indexes.length}`;
      $('progressFill').style.width = (done / indexes.length * 100) + '%';
      try {
        state.results[i] = await Engine.checkBook(api, state.books[i], branch, { today: today() });
      } catch (e) {
        if (e && e.kind === 'fatal') { showBanner(e.message + ' Finished rows are kept.'); break; }
        state.results[i] = { status: 'ERROR', copyDetail: String(e && e.message || e), ownedEditions: [], otherResults: [], note: '' };
      }
      done++;
      renderTable();
      if (Date.now() - lastSave > 10000) saveSession();
    }
    state.running = false;
    await saveSession();
    $('btnStart').hidden = false; $('btnCancel').hidden = true;
    showStartButton();
    $('progressText').textContent += ` · ${api.stats.requests} requests sent, ${api.stats.cacheHits} answered from cache`;
    renderTable();
  }

  function showBanner(msg) { const b = $('banner'); b.textContent = msg; b.hidden = !msg; }

  // ---------- results ----------
  function visibleRows() {
    let rows = state.books.map((b, i) => ({ i, rowIndex: b.rowIndex, title: b.title, author: b.author, result: state.results[i] }))
      .filter(r => r.result);
    if (state.filter !== 'ALL') rows = rows.filter(r => r.result.status === state.filter);
    if (state.query) rows = rows.filter(r => (r.title + ' ' + r.author).toLowerCase().includes(state.query));
    const k = state.sort.key, d = state.sort.dir;
    const val = r => (k in r ? r[k] : r.result[k]) ;
    rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * d; });
    return rows;
  }

  function renderPills() {
    const done = state.results.filter(Boolean);
    const count = s => done.filter(r => r.status === s).length;
    const defs = [['ALL', 'All', done.length], ['IN STOCK', 'In stock'], ['ON ORDER', 'On order'], ['NOT AT BRANCH', 'Not at branch'],
      ['CHECK MANUALLY', 'Check manually'], ['ERROR', 'Errors']];
    $('pills').replaceChildren(...defs.map(([key, label, n]) =>
      h('button', { class: 'pill' + (state.filter === key ? ' on' : ''), type: 'button' }, `${label} ${n != null ? n : count(key)}`)));
    [...$('pills').children].forEach((btn, i) => btn.addEventListener('click', () => { state.filter = defs[i][0]; renderTable(); }));
    $('btnRetry').hidden = state.running || !count('ERROR');
  }

  function statusCell(r) {
    const cls = 's-' + r.status.replace(/\s+/g, '-');
    return h('td', { class: 'status' }, r.status);
  }

  function renderTable() {
    renderPills();
    const rows = visibleRows();
    const body = $('tbody');
    const frag = [];
    for (const r of rows) {
      const x = r.result;
      const copy = h('td', {}, [x.copyDetail || '', x.overdue ? h('span', { class: 'flag', text: 'Overdue' }) : null,
        x.note ? h('div', { class: 'note', text: x.note }) : null,
        (x.status === 'CHECK MANUALLY' || x.status === 'ERROR')
          ? h('div', { class: 'note' }, [h('a', { href: Lib.catalogSearchUrl(r.title, r.author), target: '_blank', rel: 'noopener', text: 'Search on the CPL site ↗' })])
          : null]);
      for (const a of copy.querySelectorAll('a')) a.addEventListener('click', ev => ev.stopPropagation());
      const tr = h('tr', { class: 'row s-' + x.status.replace(/\s+/g, '-'), tabindex: '0' }, [h('td', { text: r.rowIndex }), h('td', { text: r.title }), h('td', { text: r.author }), statusCell(x), copy]);
      const toggle = () => { state.open.has(r.i) ? state.open.delete(r.i) : state.open.add(r.i); renderTable(); };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') toggle(); });
      frag.push(tr);
      if (state.open.has(r.i)) frag.push(detailRow(x));
    }
    body.replaceChildren(...frag);
  }

  function detailRow(x) {
    const box = h('td', { colspan: '5' });
    box.append(h('h4', { text: `Editions at ${state.branch.name} (${(x.ownedEditions || []).length}); catalog editions found: ${x.editionsFound == null ? '-' : x.editionsFound}` }));
    if ((x.ownedEditions || []).length) {
      box.append(h('ul', {}, x.ownedEditions.map(e => h('li', {}, [
        h('a', { href: Lib.recordUrl(e.id), target: '_blank', rel: 'noopener', text: e.id }),
        ` ${e.title} · ${e.format}${e.year ? ' · ' + e.year : ''}: `,
        e.copies.map(c => Lib.copyLabel(c)).join('; ')
      ]))));
    } else box.append(h('div', { class: 'note', text: 'No matching edition at this branch.' }));
    if ((x.otherResults || []).length) {
      box.append(h('h4', { text: 'Other results at the branch (not counted)' }));
      box.append(h('ul', {}, x.otherResults.map(e => h('li', {}, [h('a', { href: Lib.recordUrl(e.id), target: '_blank', rel: 'noopener', text: e.id }), ` ${e.title} · ${e.format}`]))));
    }
    return h('tr', { class: 'detail' }, box);
  }

  function downloadCsv() {
    const rows = state.books.map((b, i) => ({ rowIndex: b.rowIndex, title: b.title, author: b.author, result: state.results[i] })).filter(r => r.result);
    const blob = new Blob([Export.toCsv(rows, state.branch.name)], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `stock-check-${state.branch.name.replace(/\W+/g, '-')}-${today()}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  init().catch(e => showBanner('Startup error: ' + e.message));
})();
