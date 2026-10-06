/**
 * engine.js - decides the stock status of one spreadsheet row. All network access goes through `api`.
 */
(function (root, factory) {
  const m = factory(typeof require === 'function' ? require('./library.js') : root.Lib);
  if (typeof module === 'object' && module.exports) module.exports = m; else root.Engine = m;
})(typeof self !== 'undefined' ? self : this, function (Lib) {
  'use strict';

  const LIMITS = {
    filteredPages: 4,      // branch-filtered search pages (25 editions each)
    ownedAvailability: 6,  // availability calls for editions the branch holds
    onOrderPages: 2,       // unfiltered pages scanned for on-order copies
    fallbackAvailability: 12 // availability calls when the branch filter finds nothing
  };

  const edInfo = e => ({ id: e.id, title: e.title, format: e.format, year: e.year });

  /**
   * book: { title, author }; branch: { code, name }; opts: { today: 'YYYY-MM-DD' }
   * returns the row result.
   */
  async function checkBook(api, book, branch, opts) {
    const today = (opts && opts.today) || new Date().toISOString().slice(0, 10);
    const res = {
      status: '', copyDetail: '', due: '', overdue: false, note: '',
      bookId: '', matchedTitle: '', format: '', year: '',
      ownedEditions: [], otherResults: [], editionsFound: 0, systemAvailable: '', systemTotal: ''
    };
    const ctx = { inStock: [], onOrder: [], near: [], notFound: false, partial: '', error: '', httpNote: '' };
    const notes = [];
    try {
      // 1. Unfiltered search (page 1), with title-only fallback.
      let query = Lib.buildQuery(book, false);
      let unf = await api.search(query, null, 1);
      let titleOnly = !Lib.authorForQuery(book.author);
      if (unf.editions.length === 0 && !titleOnly) {
        query = Lib.buildQuery(book, true);
        unf = await api.search(query, null, 1);
        titleOnly = true;
      }
      if (titleOnly) notes.push('matched by title only');
      res.editionsFound = unf.count;
      if (unf.editions.length === 0) {
        ctx.notFound = true;
      } else {
        // 2. Branch-filtered search: every result is an edition the branch holds.
        let filtered = [];
        let fPages = 1;
        for (let p = 1; p <= fPages && p <= LIMITS.filteredPages; p++) {
          const r = await api.search(query, branch.code, p);
          fPages = r.pages;
          filtered = filtered.concat(r.editions);
          if (r.editions.length === 0) break;
        }
        if (fPages > LIMITS.filteredPages) ctx.partial = `Branch results cut off after ${LIMITS.filteredPages} pages`;

        // 3. Title check.
        const owned = [];
        for (const e of filtered) {
          const rel = Lib.titleRelation(book.title, e.title, book.author);
          if (rel === 'exact') owned.push(e);
          else { res.otherResults.push(edInfo(e)); if (rel === 'near') ctx.near.push(e.title); }
        }

        // 4. Real copy status for owned editions.
        for (const e of owned.slice(0, LIMITS.ownedAvailability)) {
          const copies = await api.availability(e.id, branch.code);
          const info = Object.assign(edInfo(e), { copies: [] });
          for (const c of copies) {
            const kind = Lib.classifyStatus(c.status);
            const copy = Object.assign({ editionId: e.id, title: e.title, format: e.format, year: e.year }, c);
            info.copies.push(copy);
            if (kind === 'onOrder') ctx.onOrder.push(copy); else ctx.inStock.push(copy);
          }
          if (copies.length) res.ownedEditions.push(info);
        }
        if (owned.length > LIMITS.ownedAvailability && !ctx.inStock.length) notes.push(`${owned.length - LIMITS.ownedAvailability} more owned editions not opened`);
        if (!owned.length && res.otherResults.length) notes.push('other titles at branch ignored: ' + res.otherResults.slice(0, 3).map(e => e.title).join('; '));

        // 5. Fallback + on-order check, only when nothing is in stock yet.
        // The branch filter is not complete (it missed copies that are checked out / in transit /
        // in closed collections), and it never lists on-order copies. So look at editions directly.
        if (!ctx.inStock.length) {
          let pool = unf.editions.slice();
          const seen = new Set(owned.map(e => e.id));
          for (let p = 2; p <= unf.pages && p <= LIMITS.onOrderPages; p++) {
            pool = pool.concat((await api.search(query, null, p)).editions);
          }
          const rel = e2 => Lib.titleRelation(book.title, e2.title, book.author);
          const exact = pool.filter(e2 => !seen.has(e2.id) && rel(e2) === 'exact');
          const nearEd = pool.filter(e2 => !seen.has(e2.id) && rel(e2) === 'near');
          const byCopies = (x, y) => (y.onOrderCopies > 0) - (x.onOrderCopies > 0) || y.totalCopies - x.totalCopies;
          const cand = exact.slice().sort(byCopies).concat(nearEd.slice().sort(byCopies));
          let found = false;
          for (const e2 of cand.slice(0, LIMITS.fallbackAvailability)) {
            const isNear = rel(e2) === 'near';
            if (found && isNear) break;
            const copies = await api.availability(e2.id, branch.code);
            if (!copies.length) continue;
            if (isNear) {
              ctx.near.push(e2.title);
              res.otherResults.push(edInfo(e2));
              continue;
            }
            const info = Object.assign(edInfo(e2), { copies: [] });
            for (const c of copies) {
              const copy = Object.assign({ editionId: e2.id, title: e2.title, format: e2.format, year: e2.year }, c);
              info.copies.push(copy);
              if (Lib.classifyStatus(c.status) === 'onOrder') ctx.onOrder.push(copy); else { ctx.inStock.push(copy); found = true; }
            }
            res.ownedEditions.push(info);
          }
          if (found) notes.push('found by checking editions (branch filter missed it)');
          else if (!ctx.onOrder.length) {
            if (cand.length) notes.push(`checked ${Math.min(cand.length, LIMITS.fallbackAvailability)} of ${cand.length} matching editions found`);
            if (unf.pages > LIMITS.onOrderPages) {
              notes.push(`only first ${pool.length} of ${unf.count} editions searched`);
              if (!ctx.partial) ctx.partial = `Only ${pool.length} of ${unf.count} editions searched; check on the CPL site`;
            }
            if (cand.length > LIMITS.fallbackAvailability && !ctx.partial) ctx.partial = `Checked ${LIMITS.fallbackAvailability} of ${cand.length} matching editions; check on the CPL site`;
          }
        }

        // System-wide counts from the first exact-title edition in the unfiltered list.
        const sys = unf.editions.find(e => Lib.titleRelation(book.title, e.title, book.author) === 'exact') || unf.editions[0];
        res.systemAvailable = sys.availableCopies; res.systemTotal = sys.totalCopies;
      }
    } catch (e) {
      if (e && e.kind === 'fatal') throw e;
      if (e && e.kind === 'http') ctx.httpNote = `Request failed (${e.message})`;
      else ctx.error = (e && e.message) || 'request failed';
    }

    const d = Lib.decide(ctx, today);
    res.status = d.status; res.copyDetail = d.copyDetail; res.due = d.due; res.overdue = d.overdue;
    if (d.best) {
      res.bookId = d.best.editionId; res.matchedTitle = d.best.title; res.format = d.best.format; res.year = d.best.year;
    }
    res.note = notes.join('; ');
    return res;
  }

  return { checkBook, LIMITS };
});
