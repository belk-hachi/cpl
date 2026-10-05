/**
 * sheet.js — Spreadsheet parsing and column guessing module.
 * Uses SheetJS (XLSX) to parse .xlsx and .csv files.
 */

(function (exports) {
  'use strict';

  /**
   * Reads a File or ArrayBuffer and returns the SheetJS workbook object.
   * @param {ArrayBuffer|Uint8Array} data
   * @returns {Object} SheetJS workbook object
   */
  function readWorkbook(data) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS library (xlsx.full.min.js) is not loaded.');
    }
    return XLSX.read(data, { type: 'array' });
  }

  /**
   * Converts a worksheet into a 2D array of strings (cells).
   * Preserves empty cells in rows so column alignment is maintained.
   * @param {Object} worksheet
   * @returns {Array<Array<string>>}
   */
  function sheetTo2DArray(worksheet) {
    if (!worksheet) return [];
    // header: 1 returns 2D array of raw values, defval preserves empty cells
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    return rawRows.map(row =>
      Array.isArray(row) ? row.map(cell => (cell !== null && cell !== undefined ? String(cell).trim() : '')) : []
    );
  }

  /**
   * Automatically guesses which column index represents Title and Author.
   * Rules:
   *  - Title priority: exact "title", contains "title" (not "subtitle"), contains "book", contains "name".
   *  - Author priority: contains "author", contains "contributor", contains "writer", contains "creator".
   *  - Title and Author must never point to the same column.
   * @param {Array<string>} headers - Array of header strings
   * @returns {{ titleCol: number, authorCol: number }}
   */
  function guessColumns(headers) {
    if (!headers || headers.length === 0) {
      return { titleCol: 0, authorCol: 1 };
    }

    const normHeaders = headers.map(h => (h || '').toString().trim().toLowerCase());

    // 1. Find best Title candidate
    let titleCol = -1;

    // Title priority 1: exact "title"
    titleCol = normHeaders.findIndex(h => h === 'title');

    // Title priority 2: contains "title" but NOT "subtitle"
    if (titleCol === -1) {
      titleCol = normHeaders.findIndex(h => h.includes('title') && !h.includes('subtitle'));
    }

    // Title priority 3: contains "book"
    if (titleCol === -1) {
      titleCol = normHeaders.findIndex(h => h.includes('book'));
    }

    // Title priority 4: contains "name" (unless it's author name)
    if (titleCol === -1) {
      titleCol = normHeaders.findIndex(h => h.includes('name') && !h.includes('author') && !h.includes('creator') && !h.includes('writer'));
    }

    // Default titleCol to 0 if not found
    if (titleCol === -1) {
      titleCol = 0;
    }

    // 2. Find best Author candidate
    let authorCol = -1;
    const authorKeywords = ['author', 'contributor', 'writer', 'creator'];

    for (const kw of authorKeywords) {
      const idx = normHeaders.findIndex((h, i) => i !== titleCol && h.includes(kw));
      if (idx !== -1) {
        authorCol = idx;
        break;
      }
    }

    // If authorCol still not found, pick first column that isn't titleCol
    if (authorCol === -1) {
      for (let i = 0; i < headers.length; i++) {
        if (i !== titleCol) {
          authorCol = i;
          break;
        }
      }
    }

    // Edge case fallback if only 1 column exists
    if (authorCol === -1) {
      authorCol = titleCol === 0 ? 1 : 0;
    }

    return { titleCol, authorCol };
  }

  /**
   * Extracts clean book records from a 2D sheet array given title & author column indices.
   * Header is assumed to be row 0.
   * Skips completely blank rows.
   * @param {Array<Array<string>>} rows 2D array of rows
   * @param {number} titleCol Index of title column
   * @param {number} authorCol Index of author column
   * @returns {Array<{ rowIndex: number, title: string, author: string, rawRow: Array<string> }>}
   */
  function extractBookRows(rows, titleCol, authorCol) {
    if (!rows || rows.length <= 1) return [];

    const books = [];
    // Data rows start at index 1
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const title = (row[titleCol] !== undefined ? String(row[titleCol]) : '').trim();
      const author = (row[authorCol] !== undefined ? String(row[authorCol]) : '').trim();

      // Ignore fully blank rows (where both title and author are empty, or all cells in row are empty)
      const isRowAllBlank = row.every(cell => (cell || '').toString().trim() === '');
      if (isRowAllBlank) continue;

      // If title or author is non-empty, include row (blank author cell is preserved as '')
      if (title || author) {
        books.push({
          rowIndex: i + 1, // 1-indexed row number in spreadsheet
          title,
          author,
          rawRow: row
        });
      }
    }
    return books;
  }

  // Export functions for browser & node environment
  exports.readWorkbook = readWorkbook;
  exports.sheetTo2DArray = sheetTo2DArray;
  exports.guessColumns = guessColumns;
  exports.extractBookRows = extractBookRows;

})(typeof exports !== 'undefined' ? exports : (window.SheetUtils = {}));
