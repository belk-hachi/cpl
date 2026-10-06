(function (root, factory) {
  const m = factory(typeof require === 'function' ? require('./library.js') : root.Lib);
  if (typeof module === 'object' && module.exports) module.exports = m; else root.Export = m;
})(typeof self !== 'undefined' ? self : this, function (Lib) {
  'use strict';
  const COLUMNS = ['Row', 'Spreadsheet title', 'Spreadsheet author', 'Branch', 'Status', 'Copy detail', 'Due date', 'Overdue',
    'Matched edition title', 'Format', 'Year', 'Book ID', 'Editions at branch', 'Note', 'System copies (available/total)'];

  function esc(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** rows: [{ rowIndex, title, author, result }] */
  function toCsv(rows, branchName) {
    const lines = [COLUMNS.map(esc).join(',')];
    for (const r of rows) {
      const x = r.result || {};
      const sys = x.systemTotal !== '' && x.systemTotal != null ? `${x.systemAvailable}/${x.systemTotal}` : '';
      lines.push([
        r.rowIndex, r.title, r.author, branchName, x.status, x.copyDetail, x.due, x.overdue ? 'Yes' : '',
        x.matchedTitle, x.format, x.year, x.bookId, (x.ownedEditions || []).length, x.note, sys
      ].map(esc).join(','));
    }
    return '﻿' + lines.join('\r\n');
  }
  return { toCsv, COLUMNS };
});
