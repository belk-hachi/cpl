// Offline tests: node tests/run-tests.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const Lib = require('../library.js'), Api = require('../api.js'), Engine = require('../engine.js'), Exp = require('../export.js');
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n + '.json'), 'utf8'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const LI = { code: '62', name: 'Little Italy' };
const TODAY = '2026-10-06';

// Fake api that answers from fixtures. searchMap: key 'unf'|'62' -> fixture (parsed), pages by page number.
function fakeApi(searchMap, availMap) {
  const calls = [];
  return {
    calls,
    async search(q, branch, page) { calls.push(['s', branch || 'all', page || 1]); const m = searchMap[branch || 'all']; return Lib.parseSearch(Array.isArray(m) ? m[(page || 1) - 1] : m); },
    async availability(id, branch) { calls.push(['a', id]); return Lib.parseAvailability(availMap[id] || { entities: { bibItems: {} } }, branch); }
  };
}

test('parseSearch reads editions, pagination, on-order counts', () => {
  const r = Lib.parseSearch(fx('pp-unfiltered'));
  assert.strictEqual(r.count, 106); assert.strictEqual(r.pages, 5); assert.strictEqual(r.editions.length, 2);
  assert.strictEqual(r.editions[0].onOrderCopies, 1);
});
test('year is 4 digits', () => {
  assert.strictEqual(Lib.yearOf('20260811'), '2026'); assert.strictEqual(Lib.yearOf('1970 1962'), '1970'); assert.strictEqual(Lib.yearOf(''), '');
});
test('titles: punctuation, articles, subtitle; "Pride" is not Pride and Prejudice', () => {
  assert.strictEqual(Lib.titleRelation('Mrs Dalloway', 'Mrs. Dalloway'), 'exact');
  assert.strictEqual(Lib.titleRelation('The Odyssey', 'Odyssey: a new translation'), 'exact');
  assert.strictEqual(Lib.titleRelation('Pride and Prejudice', 'Pride'), 'none');
  assert.strictEqual(Lib.titleRelation('The Death of Ivan Ilyich', 'The Death of Ivan Ilych'), 'exact');
  assert.strictEqual(Lib.titleRelation('Emma', 'Emmas'), 'none');
  assert.strictEqual(Lib.titleRelation('Great Expectations', 'Great Exceptions'), 'none');
  assert.strictEqual(Lib.titleRelation('Heart of Darkness', "Joseph Conrad's Heart of Darkness", 'Joseph Conrad'), 'exact');
  assert.strictEqual(Lib.titleRelation('Death in Venice', 'Death in Venice and Other Tales', 'Thomas Mann'), 'near');
  assert.strictEqual(Lib.titleRelation('Moby-Dick', 'Moby-Dick, Or, The Whale'), 'exact');
  assert.strictEqual(Lib.titleRelation('Notes from Underground', 'Notes from the Underground'), 'exact');
  assert.strictEqual(Lib.titleRelation('Pride and Prejudice', 'Pride and Prejudice and Zombies'), 'near');
  assert.strictEqual(Lib.titleRelation("A Connecticut Yankee in King Arthur's Court", 'A Connecticut Yankee in King Arthurs Court'), 'exact');
});
test('edition noise is removed from spreadsheet titles', () => {
  assert.strictEqual(Lib.cleanTitle("Living a Jewish Life, Revised and Updated: Jewish Traditions, Customs, and Values for Today's Families"), 'Living a Jewish Life');
  assert.strictEqual(Lib.cleanTitle("The Hitchhiker's Guide to the Galaxy 25th Anniversary Edition (Anniversary)"), "The Hitchhiker's Guide to the Galaxy");
  assert.strictEqual(Lib.cleanTitle('The Complete Fables (Revised)'), 'The Complete Fables');
  assert.strictEqual(Lib.cleanTitle('Another Brooklyn, 10th Anniversary Edition'), 'Another Brooklyn');
  assert.strictEqual(Lib.cleanTitle('The Last September; The Death of the Heart'), 'The Last September');
  assert.strictEqual(Lib.titleRelation('Another Brooklyn, 10th Anniversary Edition', 'Another Brooklyn'), 'exact');
});
test('author and query building', () => {
  assert.strictEqual(Lib.authorForQuery('Jane Austen'), 'Austen, Jane');
  assert.strictEqual(Lib.authorForQuery('Austen, Jane'), 'Austen, Jane');
  assert.strictEqual(Lib.authorForQuery('Toni Morrison; Other Person'), 'Morrison, Toni');
  assert.ok(Lib.buildQuery({ title: 'X', author: '' }).startsWith('(title:(X)'));
  assert.ok(Lib.searchUrl('q', { branchCode: '62', page: 2 }).includes('f_STATUS=62&page=2'));
});
test('branch matching is by code: North Austin item is not Austin', () => {
  const json = { entities: { bibItems: { a: { branchName: 'Austin', branch: { code: '5' }, availability: { libraryStatus: 'Available' } }, b: { branchName: 'North Austin', branch: { code: '55' }, availability: { libraryStatus: 'Available' } } } } };
  assert.strictEqual(Lib.parseAvailability(json, '5').length, 1);
  assert.strictEqual(Lib.parseAvailability(json, '5')[0].branchName, 'Austin');
  assert.strictEqual(Lib.parseAvailability(json, '55')[0].branchName, 'North Austin');
});
test('parseLocations uses entity id as code and skips hidden', () => {
  const l = Lib.parseLocations(fx('locations'));
  assert.deepStrictEqual(l, [{ code: '3', name: 'Albany Park' }, { code: '62', name: 'Little Italy' }]);
});

test('only the 3rd result is at the branch -> IN STOCK (not sampled away)', async () => {
  const api = fakeApi({ all: fx('pp-unfiltered'), 62: fx('pp-filtered-62') }, { S126C582127: fx('avail-available') });
  const r = await Engine.checkBook(api, { title: 'Pride and Prejudice', author: 'Jane Austen' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'IN STOCK'); assert.strictEqual(r.bookId, 'S126C582127');
  assert.strictEqual(r.copyDetail, 'Available');
  assert.deepStrictEqual(r.otherResults.map(e => e.title), ['Pride', 'Elizabeth of East Hampton']);
  assert.ok(api.calls.filter(c => c[0] === 'a').length === 1, 'only owned editions get an availability call');
});
test('"Pride" alone does not make the book IN STOCK', async () => {
  const only = fx('pp-filtered-62'); only.catalogSearch.results = [only.catalogSearch.results[1]];
  const api = fakeApi({ all: fx('pp-unfiltered'), 62: only }, {});
  const r = await Engine.checkBook(api, { title: 'Pride and Prejudice', author: 'Jane Austen' }, LI, { today: TODAY });
  assert.notStrictEqual(r.status, 'IN STOCK');
});
test('checked-out copy counts as IN STOCK; overdue flag', async () => {
  const api = fakeApi({ all: fx('pp-unfiltered'), 62: fx('pp-filtered-62') }, { S126C582127: fx('avail-overdue') });
  const r = await Engine.checkBook(api, { title: 'Pride and Prejudice', author: 'Jane Austen' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'IN STOCK'); assert.strictEqual(r.overdue, true);
  assert.ok(r.copyDetail.startsWith('Checked out, due 2026-08-24'));
});
test('on-order only -> ON ORDER (found through availability, not the branch filter)', async () => {
  const api = fakeApi({ all: fx('odyssey-unfiltered'), 62: fx('empty') }, { S3: fx('avail-onorder') });
  const r = await Engine.checkBook(api, { title: 'The Odyssey', author: 'Homer' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'ON ORDER'); assert.strictEqual(r.bookId, 'S3');
});
test('no copy anywhere at the branch -> NOT AT BRANCH', async () => {
  const api = fakeApi({ all: fx('pp-unfiltered'), 62: fx('empty') }, {});
  const r = await Engine.checkBook(api, { title: 'Pride and Prejudice', author: 'Jane Austen' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'CHECK MANUALLY'); assert.strictEqual(r.editionsFound, 106);
  assert.ok(/only first/.test(r.note)); assert.ok(/editions searched/.test(r.copyDetail));
});
test('filter misses a checked-out copy -> found by checking editions', async () => {
  const co = { entities: { bibItems: { a: { branchName: 'Little Italy', branch: { code: '62' }, dueDate: '2026-12-01', availability: { libraryStatus: 'Checked Out' } } } } };
  const api = fakeApi({ all: fx('pp-unfiltered'), 62: fx('empty') }, { S1: co });
  const r = await Engine.checkBook(api, { title: 'Pride and Prejudice', author: 'Jane Austen' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'IN STOCK'); assert.ok(/branch filter missed/.test(r.note)); assert.ok(r.copyDetail.startsWith('Checked out'));
});
test('collection edition held at the branch (found in fallback) -> CHECK MANUALLY', async () => {
  const u = fx('pp-unfiltered'); u.entities.bibs.S2.briefInfo.title = 'Pride and Prejudice and Other Novels'; u.entities.bibs.S1.availability.onOrderCopies = 0;
  const api = fakeApi({ all: u, 62: fx('empty') }, { S2: fx('avail-available') });
  const r = await Engine.checkBook(api, { title: 'Pride and Prejudice', author: 'Jane Austen' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'CHECK MANUALLY'); assert.ok(/Possible match/.test(r.copyDetail));
});
test('nothing in the catalog -> CHECK MANUALLY, retried by title only', async () => {
  const api = fakeApi({ all: fx('empty'), 62: fx('empty') }, {});
  const r = await Engine.checkBook(api, { title: 'Zzzz', author: 'Nobody' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'CHECK MANUALLY'); assert.ok(/title only/.test(r.note));
  assert.strictEqual(api.calls.filter(c => c[0] === 's').length, 2);
});
test('near title at the branch -> CHECK MANUALLY, not NOT AT BRANCH', async () => {
  const f = fx('pp-filtered-62'); f.entities.bibs.S126C582127.briefInfo.title = 'Pride and Prejudice and Zombies';
  const api = fakeApi({ all: fx('pp-unfiltered'), 62: f }, {});
  const r = await Engine.checkBook(api, { title: 'Pride and Prejudice', author: 'Jane Austen' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'CHECK MANUALLY'); assert.ok(/Possible match/.test(r.copyDetail));
});
test('filtered results are paged', async () => {
  const p1 = fx('pp-filtered-62'); p1.catalogSearch.pagination = { count: 4, pages: 2, page: 1 };
  p1.catalogSearch.results = [p1.catalogSearch.results[1]];
  const api = fakeApi({ all: fx('pp-unfiltered'), 62: [p1, fx('pp-filtered-62')] }, { S126C582127: fx('avail-available') });
  const r = await Engine.checkBook(api, { title: 'Pride and Prejudice', author: 'Jane Austen' }, LI, { today: TODAY });
  assert.strictEqual(r.status, 'IN STOCK');
  assert.ok(api.calls.some(c => c[0] === 's' && c[1] === '62' && c[2] === 2));
});
test('unknown status text counts as in stock', () => {
  const d = Lib.decide({ inStock: [{ status: 'Lost', editionId: 'x' }] }, TODAY);
  assert.strictEqual(d.status, 'IN STOCK'); assert.strictEqual(d.copyDetail, 'Lost');
});

// ---- network rules ----
function mkApi(responses) {
  let n = 0; const waits = [];
  const api = Api.createApi({ fetchFn: async () => { const r = responses[Math.min(n++, responses.length - 1)]; if (r === 'net') throw new Error('x'); return r; },
    sleep: async ms => { waits.push(ms); }, now: () => 1e12 + waits.reduce((a, b) => a + b, 0) + n, delayMs: 0 });
  return { api, count: () => n };
}
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
test('404 is not retried', async () => {
  const m = mkApi([resp(404)]);
  await assert.rejects(m.api.availability('A', '62'), e => e.kind === 'http' && e.status === 404);
  assert.strictEqual(m.count(), 1);
});
test('403 is fatal and not retried', async () => {
  const m = mkApi([resp(403)]);
  await assert.rejects(m.api.availability('A', '62'), e => e.kind === 'fatal');
  assert.strictEqual(m.count(), 1);
});
test('500 is retried up to 3 times then ERROR; 429 repeated is fatal', async () => {
  const a = mkApi([resp(500)]);
  await assert.rejects(a.api.availability('A', '62'), e => e.kind === 'error'); assert.strictEqual(a.count(), 4);
  const b = mkApi([resp(429)]);
  await assert.rejects(b.api.availability('A', '62'), e => e.kind === 'fatal'); assert.strictEqual(b.count(), 4);
});
test('network error then success', async () => {
  const m = mkApi(['net', resp(200, { entities: { bibItems: {} } })]);
  assert.deepStrictEqual(await m.api.availability('A', '62'), []); assert.strictEqual(m.count(), 2);
});
test('cache hit avoids a second request; cache is capped and survives a failing store', async () => {
  const m = mkApi([resp(200, { entities: { bibItems: {} } })]);
  await m.api.availability('A', '62'); await m.api.availability('A', '62');
  assert.strictEqual(m.count(), 1);
  const bad = Api.createApi({ fetchFn: async () => resp(200, { entities: { bibItems: {} } }), delayMs: 0, sleep: async () => {},
    storage: { load: async () => { throw new Error('x'); }, save: async () => { throw new Error('quota'); } } });
  await bad.init(); await bad.availability('B', '62');
});
test('fatal error stops the run (propagates out of checkBook)', async () => {
  const api = { search: async () => { throw new Api.ApiError('fatal', 'blocked', 403); }, availability: async () => [] };
  await assert.rejects(Engine.checkBook(api, { title: 'X', author: 'Y' }, LI, {}), e => e.kind === 'fatal');
});
test('http error becomes CHECK MANUALLY with the code; network error becomes ERROR', async () => {
  const mk = kind => ({ search: async () => { throw new Api.ApiError(kind, kind === 'http' ? 'HTTP 422' : 'network error', 422); }, availability: async () => [] });
  assert.strictEqual((await Engine.checkBook(mk('http'), { title: 'X', author: 'Y' }, LI, {})).status, 'CHECK MANUALLY');
  assert.strictEqual((await Engine.checkBook(mk('error'), { title: 'X', author: 'Y' }, LI, {})).status, 'ERROR');
});
test('CPL search link uses cleaned title and author, only on rows to check by hand', () => {
  const u = Lib.catalogSearchUrl('Living a Jewish Life, Revised and Updated: Traditions', 'Diamant, Anita');
  assert.ok(u.startsWith('https://chipublib.bibliocommons.com/v2/search?'));
  assert.ok(!/Revised/i.test(decodeURIComponent(u)));
  assert.ok(/Diamant/.test(decodeURIComponent(u))); assert.ok(u.endsWith('&f_FORMAT=BK%7CPAPERBACK')); assert.ok(/searchType=keyword/.test(u));
  const csv = Exp.toCsv([{ rowIndex: 2, title: 'A', author: 'B', result: { status: 'CHECK MANUALLY' } }, { rowIndex: 3, title: 'A', author: 'B', result: { status: 'IN STOCK' } }], 'X').split('\r\n');
  assert.ok(csv[0].endsWith('CPL search link')); assert.ok(/bibliocommons\.com\/v2\/search/.test(csv[1])); assert.ok(!/bibliocommons/.test(csv[2]));
});
test('CSV has Branch column, no Action column, 4-digit year', () => {
  const csv = Exp.toCsv([{ rowIndex: 2, title: 'T, with comma', author: 'A', result: { status: 'IN STOCK', copyDetail: 'Available', year: '2026', ownedEditions: [1], systemAvailable: 1, systemTotal: 2 } }], 'Little Italy');
  assert.ok(csv.includes('Branch') && !csv.includes('Action')); assert.ok(csv.includes('"T, with comma"')); assert.ok(csv.includes('Little Italy'));
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
