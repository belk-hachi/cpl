/**
 * app.js — Main UI wiring for Chicago Public Library Availability Checker.
 */

(function () {
  'use strict';

  // State Variables
  let currentWorkbook = null;
  let currentSheetRows = [];
  let parsedBooks = [];
  let activeResults = [];
  let isRunning = false;
  let isCancelled = false;

  // Target branch (single field or comma-separated, default: Little Italy)
  let targetBranch = 'Little Italy';
  let activeFilter = 'ALL';
  let sortColumn = 'title';
  let sortAscending = true;

  // DOM Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const fileInfo = document.getElementById('fileInfo');

  const sheetConfigSection = document.getElementById('sheetConfigSection');
  const sheetSelectGroup = document.getElementById('sheetSelectGroup');
  const sheetSelect = document.getElementById('sheetSelect');
  const titleColSelect = document.getElementById('titleColSelect');
  const authorColSelect = document.getElementById('authorColSelect');
  const previewDrawer = document.getElementById('previewDrawer');
  const previewTable = document.getElementById('previewTable');

  const targetBranchSelect = document.getElementById('targetBranchSelect');

  const btnStart = document.getElementById('btnStart');
  const btnCancel = document.getElementById('btnCancel');
  const btnClearCache = document.getElementById('btnClearCache');
  const btnDownloadCsv = document.getElementById('btnDownloadCsv');

  const progressContainer = document.getElementById('progressContainer');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');

  const resultsCard = document.getElementById('resultsCard');
  const resultsTbody = document.getElementById('resultsTbody');
  const totalResultsCount = document.getElementById('totalResultsCount');
  const tableSearchInput = document.getElementById('tableSearchInput');
  const filterTabs = document.getElementById('filterTabs');

  // Filter count spans
  const countAll = document.getElementById('countAll');
  const countAvailable = document.getElementById('countAvailable');
  const countUnavailable = document.getElementById('countUnavailable');
  const countNotAtBranch = document.getElementById('countNotAtBranch');
  const countNotFound = document.getElementById('countNotFound');
  const countError = document.getElementById('countError');

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    loadSavedSettings();
    loadBranchesFromCityData();
    setupEventListeners();
  });

  // Fetch official library list from City of Chicago data portal
  async function loadBranchesFromCityData() {
    const CITY_API_URL = 'https://data.cityofchicago.org/resource/x8fc-8rcq.json';

    let branchNames = [];

    try {
      const response = await fetch(CITY_API_URL);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          branchNames = data
            .map(item => item.branch_ || item.branch || item.name)
            .filter(Boolean)
            .map(name => name.trim());
        }
      }
    } catch (e) {
      console.warn('Could not fetch City of Chicago library data API, falling back to local branch list:', e);
    }

    // Merge with built-in CPL branches as reliable fallback
    const combinedSet = new Set([...branchNames, ...LibraryUtils.ALL_CPL_BRANCHES]);
    const sortedBranches = Array.from(combinedSet).sort((a, b) => a.localeCompare(b));

    if (targetBranchSelect) {
      targetBranchSelect.innerHTML = '';
      sortedBranches.forEach(branchName => {
        const opt = document.createElement('option');
        opt.value = branchName;
        opt.textContent = branchName;
        if (branchName.toLowerCase() === targetBranch.toLowerCase()) {
          opt.selected = true;
        }
        targetBranchSelect.appendChild(opt);
      });
      // Ensure targetBranch matches the select value
      targetBranch = targetBranchSelect.value;
      updateStartButtonState();
    }
  }

  // --- Storage & Settings ---
  function loadSavedSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['targetBranch'], (res) => {
        if (res.targetBranch) {
          targetBranch = res.targetBranch;
          if (targetBranchSelect) targetBranchSelect.value = targetBranch;
        }
      });
    }
  }

  function saveBranchSettings() {
    if (targetBranchSelect) {
      targetBranch = targetBranchSelect.value || 'Little Italy';
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ targetBranch });
    }
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    // Drag and Drop File
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
      }
    });

    // Sheet Selection
    sheetSelect.addEventListener('change', () => {
      if (!currentWorkbook) return;
      const sheetName = sheetSelect.value;
      const sheet = currentWorkbook.Sheets[sheetName];
      currentSheetRows = SheetUtils.sheetTo2DArray(sheet);
      setupColumnConfig();
    });

    // Column Selectors
    titleColSelect.addEventListener('change', onColumnSelectChange);
    authorColSelect.addEventListener('change', onColumnSelectChange);

    // Target Branch Select
    if (targetBranchSelect) {
      targetBranchSelect.addEventListener('change', () => {
        saveBranchSettings();
        updateStartButtonState();
      });
    }

    // Execution Buttons
    btnStart.addEventListener('click', startSearch);
    btnCancel.addEventListener('click', () => {
      isCancelled = true;
      btnCancel.disabled = true;
      progressText.textContent = 'Cancelling search...';
    });

    btnClearCache.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.clear(() => {
          // Preserve branch settings
          saveBranchSettings();
          alert('Local HTTP cache cleared successfully.');
        });
      } else {
        alert('Cache cleared.');
      }
    });

    btnDownloadCsv.addEventListener('click', downloadResultsCsv);

    // Filter Tabs
    filterTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderResultsTable();
    });

    // Search Box
    tableSearchInput.addEventListener('input', renderResultsTable);

    // Sorting Headers
    document.querySelectorAll('#resultsTable th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (sortColumn === col) {
          sortAscending = !sortAscending;
        } else {
          sortColumn = col;
          sortAscending = true;
        }
        renderResultsTable();
      });
    });
  }

  // --- File Parsing Flow ---
  function handleFileSelect(file) {
    fileInfo.style.display = 'block';
    fileInfo.textContent = `Selected File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        currentWorkbook = SheetUtils.readWorkbook(buffer);

        // Populate sheet selector
        sheetSelect.innerHTML = '';
        currentWorkbook.SheetNames.forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          sheetSelect.appendChild(opt);
        });

        if (currentWorkbook.SheetNames.length > 1) {
          sheetSelectGroup.style.display = 'flex';
        } else {
          sheetSelectGroup.style.display = 'none';
        }

        const firstSheetName = currentWorkbook.SheetNames[0];
        const worksheet = currentWorkbook.Sheets[firstSheetName];
        currentSheetRows = SheetUtils.sheetTo2DArray(worksheet);

        setupColumnConfig();
        sheetConfigSection.style.display = 'flex';
        if (previewDrawer) previewDrawer.style.display = 'block';
      } catch (err) {
        alert('Error parsing spreadsheet file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function setupColumnConfig() {
    if (!currentSheetRows || currentSheetRows.length === 0) return;

    titleColSelect.disabled = false;
    authorColSelect.disabled = false;

    const headers = currentSheetRows[0] || [];
    titleColSelect.innerHTML = '';
    authorColSelect.innerHTML = '';

    headers.forEach((h, idx) => {
      const label = h ? `Col ${idx + 1}: ${h}` : `Col ${idx + 1}: (Blank)`;

      const optT = document.createElement('option');
      optT.value = idx;
      optT.textContent = label;
      titleColSelect.appendChild(optT);

      const optA = document.createElement('option');
      optA.value = idx;
      optA.textContent = label;
      authorColSelect.appendChild(optA);
    });

    const guessed = SheetUtils.guessColumns(headers);
    titleColSelect.value = guessed.titleCol;
    authorColSelect.value = guessed.authorCol;

    renderPreviewTable();
    updateStartButtonState();
  }

  function onColumnSelectChange() {
    if (titleColSelect.value === authorColSelect.value) {
      // Don't allow same column for title and author
      const titleVal = parseInt(titleColSelect.value, 10);
      const totalCols = currentSheetRows[0] ? currentSheetRows[0].length : 2;
      const nextCol = (titleVal + 1) % totalCols;
      authorColSelect.value = nextCol;
    }
    renderPreviewTable();
    updateStartButtonState();
  }

  function renderPreviewTable() {
    const thead = previewTable.querySelector('thead');
    const tbody = previewTable.querySelector('tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!currentSheetRows || currentSheetRows.length === 0) return;

    const headers = currentSheetRows[0] || [];
    const trHead = document.createElement('tr');
    headers.forEach((h, idx) => {
      const th = document.createElement('th');
      th.textContent = h || `Col ${idx + 1}`;
      if (idx === parseInt(titleColSelect.value, 10)) {
        th.style.color = '#60a5fa';
        th.textContent += ' [TITLE]';
      } else if (idx === parseInt(authorColSelect.value, 10)) {
        th.style.color = '#34d399';
        th.textContent += ' [AUTHOR]';
      }
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    // Show first 5 data rows
    const previewRows = currentSheetRows.slice(1, 6);
    previewRows.forEach(row => {
      const tr = document.createElement('tr');
      headers.forEach((_, idx) => {
        const td = document.createElement('td');
        td.textContent = row[idx] !== undefined ? row[idx] : '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function updateStartButtonState() {
    const hasRows = currentSheetRows && currentSheetRows.length > 1;
    const branchVal = targetBranchSelect ? targetBranchSelect.value : targetBranch;
    const hasBranch = Boolean(branchVal);
    btnStart.disabled = !(hasRows && hasBranch && !isRunning);
  }

  // --- Availability Search Engine ---
  async function startSearch() {
    const titleCol = parseInt(titleColSelect.value, 10);
    const authorCol = parseInt(authorColSelect.value, 10);

    const branchRaw = targetBranchSelect ? targetBranchSelect.value : targetBranch;
    const currentTargetBranches = branchRaw ? [branchRaw] : ['Little Italy'];

    parsedBooks = SheetUtils.extractBookRows(currentSheetRows, titleCol, authorCol);
    if (parsedBooks.length === 0) {
      alert('No valid book rows found in spreadsheet.');
      return;
    }

    isRunning = true;
    isCancelled = false;
    activeResults = [];

    btnStart.disabled = true;
    btnCancel.disabled = false;
    resultsCard.style.display = 'block';
    if (progressContainer) progressContainer.style.display = 'flex';

    updateProgress(0, parsedBooks.length);
    renderResultsTable();

    const storageCache = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;

    for (let i = 0; i < parsedBooks.length; i++) {
      if (isCancelled) {
        progressText.textContent = `Search cancelled at book ${i} of ${parsedBooks.length}.`;
        break;
      }

      const book = parsedBooks[i];
      updateProgress(i, parsedBooks.length, `Checking "${book.title || 'Untitled'}"...`);

      let resultObj = null;

      try {
        const queries = LibraryUtils.buildSearchQueries(book.title, book.author);
        let editions = [];
        let matchedQueryNote = '';

        // Try search queries in fallback order
        for (const qObj of queries) {
          if (isCancelled) break;
          const searchUrl = `${LibraryUtils.BASE_URL}/bibs/search?query=${encodeURIComponent(qObj.query)}&searchType=bl&locale=en-US`;

          try {
            const searchData = await LibraryUtils.fetchWithRetryAndCache(searchUrl, {}, storageCache);
            editions = LibraryUtils.parseSearchResponse(searchData);
            if (editions.length > 0) {
              matchedQueryNote = qObj.note;
              break;
            }
          } catch (err) {
            console.warn(`Query failed (${qObj.note}):`, err);
          }
        }

        if (editions.length === 0) {
          resultObj = LibraryUtils.evaluateBookAvailability(book, [], new Map(), currentTargetBranches, 'No search results found');
        } else {
          // Fetch availability for each matched edition (up to 10)
          const availabilityMap = new Map();

          for (const edition of editions) {
            if (isCancelled) break;
            const availUrl = `${LibraryUtils.BASE_URL}/bibs/${edition.id}/availability?locale=en-US`;
            try {
              const availData = await LibraryUtils.fetchWithRetryAndCache(availUrl, {}, storageCache);
              const parsedAvail = LibraryUtils.parseAvailabilityResponse(availData, edition.id);
              availabilityMap.set(edition.id, parsedAvail);
            } catch (availErr) {
              console.warn(`Availability fetch failed for edition ${edition.id}:`, availErr);
            }
          }

          resultObj = LibraryUtils.evaluateBookAvailability(book, editions, availabilityMap, currentTargetBranches, matchedQueryNote);
        }
      } catch (err) {
        resultObj = {
          title: book.title,
          author: book.author,
          status: 'ERROR',
          matchedEdition: null,
          matchedBranch: '-',
          copyStatus: err.message || 'Request failed',
          dueDate: '-',
          systemAvailable: 0,
          systemTotal: 0,
          systemHolds: 0,
          matchNote: 'Error fetching library data'
        };
      }

      activeResults.push(resultObj);
      updateCounts();
      renderResultsTable();

      // Request etiquette: 400ms to 600ms delay between requests
      if (i < parsedBooks.length - 1 && !isCancelled) {
        const delay = 400 + Math.random() * 200;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    isRunning = false;
    btnStart.disabled = false;
    btnCancel.disabled = true;

    if (!isCancelled) {
      updateProgress(parsedBooks.length, parsedBooks.length, 'Availability search completed!');
    }
  }

  function updateProgress(current, total, message = '') {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBarFill.style.width = `${pct}%`;
    progressPercent.textContent = `${pct}%`;
    progressText.textContent = message || `Processing ${current} of ${total} books...`;
  }

  function updateCounts() {
    const total = activeResults.length;
    let availCount = 0;
    let unavailCount = 0;
    let notAtBranchCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;

    activeResults.forEach(r => {
      if (r.status === 'AVAILABLE') availCount++;
      else if (r.status === 'AT BRANCH, NOT AVAILABLE') unavailCount++;
      else if (r.status === 'NOT AT BRANCH') notAtBranchCount++;
      else if (r.status === 'NOT FOUND') notFoundCount++;
      else if (r.status === 'ERROR') errorCount++;
    });

    totalResultsCount.textContent = total;
    countAll.textContent = total;
    countAvailable.textContent = availCount;
    countUnavailable.textContent = unavailCount;
    countNotAtBranch.textContent = notAtBranchCount;
    countNotFound.textContent = notFoundCount;
    countError.textContent = errorCount;
  }

  // --- Table Rendering & Filtering ---
  function renderResultsTable() {
    resultsTbody.innerHTML = '';

    const searchTerm = tableSearchInput.value.trim().toLowerCase();

    // 1. Filter
    let filtered = activeResults.filter(r => {
      if (activeFilter !== 'ALL' && r.status !== activeFilter) {
        return false;
      }
      if (searchTerm) {
        const haystack = `${r.title} ${r.author} ${r.matchedBranch} ${r.copyStatus} ${r.status}`.toLowerCase();
        return haystack.includes(searchTerm);
      }
      return true;
    });

    // 2. Sort
    filtered.sort((a, b) => {
      let valA = getSortValue(a, sortColumn);
      let valB = getSortValue(b, sortColumn);

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortAscending ? -1 : 1;
      if (valA > valB) return sortAscending ? 1 : -1;
      return 0;
    });

    // 3. Render
    filtered.forEach(r => {
      const tr = document.createElement('tr');

      // Title
      const tdTitle = document.createElement('td');
      tdTitle.textContent = r.title || 'Untitled';
      tr.appendChild(tdTitle);

      // Author
      const tdAuthor = document.createElement('td');
      tdAuthor.textContent = r.author || '-';
      tr.appendChild(tdAuthor);

      // Status
      const tdStatus = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = getStatusBadgeClass(r.status);
      badge.textContent = r.status;
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      // Matched Editions (shows all matched editions with per-edition copy/checkout status)
      const tdEdition = document.createElement('td');
      if (r.allEditions && r.allEditions.length > 0) {
        const editionsContainer = document.createElement('div');
        editionsContainer.style.display = 'flex';
        editionsContainer.style.flexDirection = 'column';
        editionsContainer.style.gap = '8px';

        r.allEditions.forEach((ed, idx) => {
          const itemDiv = document.createElement('div');
          itemDiv.style.lineHeight = '1.35';
          if (idx > 0) {
            itemDiv.style.borderTop = '1px solid var(--border-light)';
            itemDiv.style.paddingTop = '6px';
          }

          const topRow = document.createElement('div');
          topRow.style.display = 'flex';
          topRow.style.alignItems = 'center';
          topRow.style.gap = '8px';
          topRow.style.flexWrap = 'wrap';

          const link = document.createElement('a');
          link.href = `https://chipublib.bibliocommons.com/v2/record/${ed.id}`;
          link.target = '_blank';
          link.className = 'edition-link';
          link.textContent = ed.title;

          // Branch status tag for this specific edition
          const branchBadge = document.createElement('span');
          branchBadge.className = 'edition-status-badge';
          if (ed.branchStatus && ed.branchStatus.toLowerCase().includes('checked out')) {
            branchBadge.classList.add('badge-checkedout');
            branchBadge.textContent = `📍 ${ed.branchStatus}`;
          } else if (ed.branchStatus && ed.branchStatus.toLowerCase().includes('available')) {
            branchBadge.classList.add('badge-available-edition');
            branchBadge.textContent = `📍 Available at branch`;
          } else if (ed.hasCopyAtBranch) {
            branchBadge.classList.add('badge-other-edition');
            branchBadge.textContent = `📍 ${ed.branchStatus}`;
          } else {
            branchBadge.classList.add('badge-not-at-branch-edition');
            branchBadge.textContent = `Not at branch`;
          }

          topRow.appendChild(link);
          topRow.appendChild(branchBadge);

          const meta = document.createElement('div');
          meta.className = 'edition-meta';
          meta.textContent = `${ed.format || 'BK'} (${ed.year || 'N/A'}) [ID: ${ed.id}] • System: ${ed.availableCopies} avail / ${ed.totalCopies} total`;

          itemDiv.appendChild(topRow);
          itemDiv.appendChild(meta);
          editionsContainer.appendChild(itemDiv);
        });

        tdEdition.appendChild(editionsContainer);

        if (r.matchNote) {
          const note = document.createElement('span');
          note.className = 'note-text';
          note.style.marginTop = '6px';
          note.textContent = `ℹ️ ${r.matchNote}`;
          tdEdition.appendChild(note);
        }
      } else if (r.matchedEdition) {
        const link = document.createElement('a');
        link.href = `https://chipublib.bibliocommons.com/v2/record/${r.matchedEdition.id}`;
        link.target = '_blank';
        link.className = 'edition-link';
        link.textContent = r.matchedEdition.title;

        const meta = document.createElement('div');
        meta.className = 'edition-meta';
        meta.textContent = `${r.matchedEdition.format} (${r.matchedEdition.year || 'N/A'}) [ID: ${r.matchedEdition.id}]`;

        tdEdition.appendChild(link);
        tdEdition.appendChild(meta);
      } else {
        tdEdition.textContent = '-';
      }
      tr.appendChild(tdEdition);

      // Branch
      const tdBranch = document.createElement('td');
      tdBranch.textContent = r.matchedBranch || '-';
      tr.appendChild(tdBranch);

      // Copy Status
      const tdCopyStatus = document.createElement('td');
      tdCopyStatus.textContent = r.copyStatus || '-';
      tr.appendChild(tdCopyStatus);

      // Due Date
      const tdDueDate = document.createElement('td');
      tdDueDate.textContent = r.dueDate || '-';
      tr.appendChild(tdDueDate);

      // System Copies
      const tdSystem = document.createElement('td');
      tdSystem.textContent = `${r.systemAvailable} avail / ${r.systemTotal} total (${r.systemHolds} holds)`;
      tr.appendChild(tdSystem);

      resultsTbody.appendChild(tr);
    });
  }

  function getSortValue(record, col) {
    switch (col) {
      case 'title': return record.title || '';
      case 'author': return record.author || '';
      case 'status': return record.status || '';
      case 'matchedEdition': return record.matchedEdition ? record.matchedEdition.title : '';
      case 'matchedBranch': return record.matchedBranch || '';
      case 'copyStatus': return record.copyStatus || '';
      case 'dueDate': return record.dueDate || '';
      case 'systemAvailable': return record.systemAvailable || 0;
      default: return '';
    }
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'AVAILABLE': return 'badge badge-available';
      case 'AT BRANCH, NOT AVAILABLE': return 'badge badge-unavailable';
      case 'NOT AT BRANCH': return 'badge badge-notatbranch';
      case 'NOT FOUND': return 'badge badge-notfound';
      case 'ERROR': return 'badge badge-error';
      default: return 'badge';
    }
  }

  // --- CSV Export ---
  function downloadResultsCsv() {
    if (!activeResults || activeResults.length === 0) {
      alert('No results available to download.');
      return;
    }

    const headers = [
      'Spreadsheet Title',
      'Spreadsheet Author',
      'Status',
      'Primary Edition Title',
      'Format',
      'Publication Year',
      'Bibliocommons Record ID',
      'All Matched Editions',
      'Matched Branch',
      'Copy Status',
      'Due Date',
      'System Available Copies',
      'System Total Copies',
      'System Holds',
      'Match Note'
    ];

    const rows = activeResults.map(r => {
      const allEditionsSummary = (r.allEditions && r.allEditions.length > 0)
        ? r.allEditions.map(e => `${e.title} [${e.format}, ${e.year || 'N/A'}, ID:${e.id} -> ${e.branchStatus || 'Not at branch'}]`).join('; ')
        : (r.matchedEdition ? `${r.matchedEdition.title} [${r.matchedEdition.format}, ${r.matchedEdition.year || 'N/A'}, ID:${r.matchedEdition.id}]` : '');

      return [
        r.title,
        r.author,
        r.status,
        r.matchedEdition ? r.matchedEdition.title : '',
        r.matchedEdition ? r.matchedEdition.format : '',
        r.matchedEdition ? r.matchedEdition.year : '',
        r.matchedEdition ? r.matchedEdition.id : '',
        allEditionsSummary,
        r.matchedBranch,
        r.copyStatus,
        r.dueDate,
        r.systemAvailable,
        r.systemTotal,
        r.systemHolds,
        r.matchNote
      ];
    });

    const csvContent = [headers, ...rows].map(row =>
      row.map(cell => {
        const val = cell !== null && cell !== undefined ? String(cell) : '';
        // Escape quotes
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cpl_availability_results_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

})();
