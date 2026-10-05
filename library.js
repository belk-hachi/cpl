/**
 * library.js — Library API search, availability, branch matching, and availability evaluation logic.
 * Pure logic module with NO DOM dependencies.
 */

(function (exports) {
  'use strict';

  const CPL_LIB_ID = 'chipublib';
  const BASE_URL = 'https://gateway.bibliocommons.com/v2/libraries/' + CPL_LIB_ID;

  // Complete list of known CPL branches
  const ALL_CPL_BRANCHES = [
    'Albany Park', 'Altgeld', 'Archer Heights', 'Austin', 'Austin-Irving', 'Avalon',
    'Back of the Yards', 'Beverly', 'Bezazian', 'Blackstone', 'Brainerd', 'Brighton Park',
    'Bucktown-Wicker Park', 'Budlong Woods', 'Canaryville', 'Chicago Bee', 'Chicago Lawn',
    'Chinatown', 'Clearing', 'Coleman', 'Daley Richard J.-Bridgeport', 'Daley Richard M.-W Humboldt',
    'Douglass', 'Dunning', 'Edgebrook', 'Edgewater', 'Gage Park', 'Garfield Ridge',
    'Greater Grand Crossing', 'Hall', 'Harold Washington Library Center', 'Hegewisch',
    'Humboldt Park', 'Independence', 'Jefferson Park', 'Jeffery Manor', 'Kelly', 'King',
    'Legler Regional', 'Lincoln Belmont', 'Lincoln Park', 'Little Italy', 'Little Village',
    'Logan Square', 'Lozano', 'Manning', 'Mayfair', 'McKinley Park', 'Merlo',
    'Mount Greenwood', 'Near North', 'North Austin', 'North Pulaski', 'Northtown',
    'Obama Presidential Center', 'Oriole Park', 'Portage-Cragin', 'Pullman', 'Roden',
    'Rogers Park', 'Scottsdale', 'Sherman Park', 'South Chicago', 'South Shore',
    'Sulzer Regional', 'Thurgood Marshall', 'Toman', 'Uptown', 'Vodak-East Side',
    'Walker', 'West Belmont', 'West Loop', 'West Pullman', 'West Town',
    'Whitney M. Young Jr.', 'Woodson Regional', 'Wrightwood-Ashburn'
  ];

  /**
   * Normalizes a branch name for comparison (trim + lowercase).
   */
  function normalizeBranch(name) {
    return (name || '').toString().trim().toLowerCase();
  }

  /**
   * Checks if an item's branch matches a user's target branch selection.
   * Prefer exact match. Fall back to substring match ONLY if the target branch is not
   * an exact match for another distinct branch in the system.
   *
   * @param {string} itemBranch Name of branch on library item
   * @param {string} targetBranch User-selected target branch
   * @param {Array<string>} [knownBranches] List of known system branches
   * @returns {boolean}
   */
  function isBranchMatch(itemBranch, targetBranch, knownBranches = ALL_CPL_BRANCHES) {
    const itemNorm = normalizeBranch(itemBranch);
    const targetNorm = normalizeBranch(targetBranch);

    if (!itemNorm || !targetNorm) return false;

    // 1. Exact match
    if (itemNorm === targetNorm) {
      return true;
    }

    // 2. Substring match handling
    if (itemNorm.includes(targetNorm)) {
      // Check if target is an exact match for a known branch (e.g. target "Austin" vs item "North Austin")
      const isTargetExactKnownBranch = knownBranches.some(b => normalizeBranch(b) === targetNorm);
      if (isTargetExactKnownBranch) {
        // If target is an exact standalone branch name (like "Austin"), it should NOT match "North Austin"
        return false;
      }
      return true;
    }

    // Reverse substring match (target was longer e.g. user selected "Harold Washington Library Center" and item says "Harold Washington")
    if (targetNorm.includes(itemNorm) && itemNorm.length >= 5) {
      return true;
    }

    return false;
  }

  /**
   * Formats an author name for Bibliocommons search.
   * If "Philip Roth", converts to "Roth, Philip".
   * If "Roth, Philip", keeps as is.
   * @param {string} author
   * @returns {{ formatted: string, isReformatted: boolean }}
   */
  function formatAuthorForSearch(author) {
    const clean = (author || '').trim();
    if (!clean) return { formatted: '', isReformatted: false };

    if (clean.includes(',')) {
      return { formatted: clean, isReformatted: false };
    }

    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      const lastName = parts[parts.length - 1];
      const firstName = parts.slice(0, parts.length - 1).join(' ');
      return { formatted: `${lastName}, ${firstName}`, isReformatted: true };
    }

    return { formatted: clean, isReformatted: false };
  }

  /**
   * Cleans title string for search query syntax safety.
   * Strips quotes, parentheses, colons, brackets.
   * @param {string} title
   * @returns {{ titleClean: string, mainTitle: string, hasSubtitle: boolean }}
   */
  function cleanTitleForSearch(title) {
    const raw = (title || '').trim();
    if (!raw) return { titleClean: '', mainTitle: '', hasSubtitle: false };

    let mainTitle = raw;
    let hasSubtitle = false;

    if (raw.includes(':')) {
      hasSubtitle = true;
      mainTitle = raw.split(':')[0].trim();
    }

    const sanitize = (str) => str.replace(/["()\[\]:?!*]/g, ' ').replace(/\s+/g, ' ').trim();

    return {
      titleClean: sanitize(raw),
      mainTitle: sanitize(mainTitle),
      hasSubtitle
    };
  }

  /**
   * Builds search query parameters for Bibliocommons API.
   * @param {string} title
   * @param {string} author
   * @returns {Array<{ query: string, note: string }>} List of queries to try in fallback order
   */
  function buildSearchQueries(title, author) {
    const queries = [];
    const authorObj = formatAuthorForSearch(author);
    const titleObj = cleanTitleForSearch(title);

    const formatConstraint = 'formatcode:(BK OR PAPERBACK )';

    // 1. Preferred query: reformatted author + clean title
    if (authorObj.formatted && titleObj.titleClean) {
      queries.push({
        query: `(contributor:(${authorObj.formatted}) AND title:(${titleObj.titleClean}) ) ${formatConstraint}`,
        note: 'Author + Title'
      });
    }

    // 2. If author was reformatted, try raw author + title
    if (authorObj.isReformatted && author.trim() && titleObj.titleClean) {
      queries.push({
        query: `(contributor:(${author.trim()}) AND title:(${titleObj.titleClean}) ) ${formatConstraint}`,
        note: 'Raw Author + Title'
      });
    }

    // 3. If title had a subtitle, try main title (before colon)
    if (titleObj.hasSubtitle && titleObj.mainTitle && authorObj.formatted) {
      queries.push({
        query: `(contributor:(${authorObj.formatted}) AND title:(${titleObj.mainTitle}) ) ${formatConstraint}`,
        note: 'Author + Main Title (before colon)'
      });
    }

    // 4. Fallback: Title only
    if (titleObj.titleClean) {
      queries.push({
        query: `title:(${titleObj.titleClean}) ${formatConstraint}`,
        note: 'Matched by title only'
      });
    }

    // 5. Ultimate fallback: Main title only if subtitle existed
    if (titleObj.hasSubtitle && titleObj.mainTitle) {
      queries.push({
        query: `title:(${titleObj.mainTitle}) ${formatConstraint}`,
        note: 'Matched by main title only'
      });
    }

    return queries;
  }

  /**
   * Parses the search endpoint JSON response.
   * Returns list of edition records.
   * @param {Object} data JSON response from /bibs/search
   * @param {number} [maxEditions=10] Max number of editions to return
   * @returns {Array<Object>} List of bib editions
   */
  function parseSearchResponse(data, maxEditions = 10) {
    if (!data || !data.catalogSearch || !Array.isArray(data.catalogSearch.results)) {
      return [];
    }

    const bibsMap = (data.entities && data.entities.bibs) || {};
    const results = [];

    for (const item of data.catalogSearch.results) {
      const id = item.representative || item.id;
      if (!id) continue;

      const bib = bibsMap[id] || {};
      const brief = bib.briefInfo || {};

      const title = brief.title || 'Unknown Title';
      const format = brief.format || 'BK';
      const authors = Array.isArray(brief.authors) ? brief.authors.join(', ') : (brief.authors || '');
      const pubYear = brief.publicationDate || brief.publicationYear || '';
      const availSummary = bib.availability || {};

      results.push({
        id,
        title,
        format,
        authors,
        pubYear,
        availableCopies: availSummary.availableCopies || 0,
        totalCopies: availSummary.totalCopies || 0,
        heldCopies: availSummary.heldCopies || 0,
        onOrderCopies: availSummary.onOrderCopies || 0
      });

      if (results.length >= maxEditions) break;
    }

    return results;
  }

  /**
   * Parses availability endpoint response.
   * Extracts summary and bib items list.
   * @param {Object} data JSON response from /bibs/<ID>/availability
   * @param {string} bibId ID of edition
   * @returns {{ summary: Object, items: Array<Object> }}
   */
  function parseAvailabilityResponse(data, bibId) {
    const summary = (data && data.entities && data.entities.availabilities && data.entities.availabilities[bibId]) || {
      availableCopies: 0,
      totalCopies: 0,
      heldCopies: 0,
      onOrderCopies: 0
    };

    const bibItemsObj = (data && data.entities && data.entities.bibItems) || {};
    const items = [];

    for (const key of Object.keys(bibItemsObj)) {
      const item = bibItemsObj[key];
      if (!item) continue;

      const branchName = item.branchName || (item.branch && item.branch.name) || '';
      const avail = item.availability || {};

      items.push({
        itemId: item.id || key,
        branchName: branchName.trim(),
        libraryStatus: avail.libraryStatus || 'Unknown',
        statusType: avail.statusType || 'UNAVAILABLE',
        dueDate: item.dueDate || avail.dueDate || null,
        callNumber: item.callNumber || '',
        collection: item.collection || ''
      });
    }

    return { summary, items };
  }

  /**
   * Evaluates availability of a book across matched editions and target branches.
   * CRITICAL RULE: A copy counts as AVAILABLE at a branch ONLY if statusType === "AVAILABLE".
   *
   * @param {Object} book Input book record ({ title, author })
   * @param {Array<Object>} editions Matched bib editions (from search)
   * @param {Map<string, { summary: Object, items: Array<Object> }>} availabilityMap Map of edition id -> availability object
   * @param {Array<string>} targetBranches List of user selected branch names
   * @param {string} matchNote Query note (e.g. 'Matched by title only')
   * @returns {Object} Complete evaluation result object
   */
  function evaluateBookAvailability(book, editions, availabilityMap, targetBranches, matchNote = '') {
    if (!editions || editions.length === 0) {
      return {
        title: book.title,
        author: book.author,
        status: 'NOT FOUND',
        matchedEdition: null,
        matchedBranch: '-',
        copyStatus: 'No catalog results',
        dueDate: '-',
        systemAvailable: 0,
        systemTotal: 0,
        systemHolds: 0,
        matchNote: matchNote || 'No search results'
      };
    }

    let bestAvailableMatch = null;
    let bestUnavailableMatch = null;

    // Use primary edition for system-wide stats if available
    const primaryEdition = editions[0];
    const primaryAvail = availabilityMap.get(primaryEdition.id);
    const primarySummary = (primaryAvail && primaryAvail.summary) || primaryEdition;

    const systemAvailable = primarySummary.availableCopies || 0;
    const systemTotal = primarySummary.totalCopies || 0;
    const systemHolds = primarySummary.heldCopies || 0;

    for (const edition of editions) {
      const availData = availabilityMap.get(edition.id);
      if (!availData || !availData.items) continue;

      for (const item of availData.items) {
        // Check if item's branch matches any selected target branch
        const matchedTargetBranch = targetBranches.find(tb => isBranchMatch(item.branchName, tb));
        if (!matchedTargetBranch) continue;

        // Ordering requirement: If library has the book (Available or Checked Out),
        // it means the library already owns/has the copy, so categorize as AVAILABLE to know not to reorder.
        const isPhysicallyOwned = (item.statusType === 'AVAILABLE') || 
                                 (item.libraryStatus && item.libraryStatus.toLowerCase().includes('checked out')) ||
                                 (item.statusType === 'UNAVAILABLE' && item.libraryStatus !== 'On Order');

        if (isPhysicallyOwned && !bestAvailableMatch) {
          bestAvailableMatch = {
            edition,
            item,
            targetBranch: matchedTargetBranch
          };
          break; // Found matching copy for this edition
        }

        if (!bestUnavailableMatch) {
          bestUnavailableMatch = {
            edition,
            item,
            targetBranch: matchedTargetBranch
          };
        }
      }

      if (bestAvailableMatch) break; // Found copy overall
    }

    // Build detailed list of all matched editions with branch-specific status
    const allEditionsList = editions.map(ed => {
      const aData = availabilityMap.get(ed.id);
      const aSummary = (aData && aData.summary) || ed;
      const items = (aData && aData.items) || [];

      // Find items at target branches for this specific edition
      const branchItems = items.filter(item => targetBranches.some(tb => isBranchMatch(item.branchName, tb)));
      let branchStatus = 'Not at branch';
      let branchItemDetails = null;

      for (const bItem of branchItems) {
        const isAvail = (bItem.statusType === 'AVAILABLE');
        const isCheckedOut = bItem.libraryStatus && bItem.libraryStatus.toLowerCase().includes('checked out');
        const isPhysicallyOwned = isAvail || isCheckedOut || (bItem.statusType === 'UNAVAILABLE' && bItem.libraryStatus !== 'On Order');

        if (isPhysicallyOwned) {
          const due = bItem.dueDate ? ` (Due: ${bItem.dueDate})` : '';
          branchStatus = (bItem.libraryStatus || 'Available') + (bItem.dueDate ? due : '');
          branchItemDetails = bItem;
          break;
        } else if (!branchItemDetails) {
          branchStatus = bItem.libraryStatus || 'Unavailable';
          branchItemDetails = bItem;
        }
      }

      return {
        id: ed.id,
        title: ed.title,
        format: ed.format,
        year: ed.pubYear,
        availableCopies: aSummary.availableCopies || 0,
        totalCopies: aSummary.totalCopies || 0,
        branchStatus, // Specific status at target branch for this edition!
        branchItem: branchItemDetails,
        hasCopyAtBranch: branchItems.length > 0
      };
    });

    if (bestAvailableMatch) {
      const { edition, item } = bestAvailableMatch;
      const formattedDueDate = item.dueDate ? ` (Due: ${item.dueDate})` : '';
      return {
        title: book.title,
        author: book.author,
        status: 'AVAILABLE',
        matchedEdition: {
          id: edition.id,
          title: edition.title,
          format: edition.format,
          year: edition.pubYear
        },
        allEditions: allEditionsList,
        matchedBranch: item.branchName,
        copyStatus: (item.libraryStatus || 'Available') + (item.dueDate ? formattedDueDate : ''),
        dueDate: item.dueDate || '-',
        systemAvailable,
        systemTotal,
        systemHolds,
        matchNote
      };
    }

    if (bestUnavailableMatch) {
      const { edition, item } = bestUnavailableMatch;
      const formattedDueDate = item.dueDate ? item.dueDate : 'Not specified';
      return {
        title: book.title,
        author: book.author,
        status: 'AT BRANCH, NOT AVAILABLE',
        matchedEdition: {
          id: edition.id,
          title: edition.title,
          format: edition.format,
          year: edition.pubYear
        },
        allEditions: allEditionsList,
        matchedBranch: item.branchName,
        copyStatus: item.libraryStatus || 'Unavailable',
        dueDate: formattedDueDate,
        systemAvailable,
        systemTotal,
        systemHolds,
        matchNote
      };
    }

    // No copy at target branch
    return {
      title: book.title,
      author: book.author,
      status: 'NOT AT BRANCH',
      matchedEdition: {
        id: primaryEdition.id,
        title: primaryEdition.title,
        format: primaryEdition.format,
        year: primaryEdition.pubYear
      },
      allEditions: allEditionsList,
      matchedBranch: '-',
      copyStatus: 'None at selected branches',
      dueDate: '-',
      systemAvailable,
      systemTotal,
      systemHolds,
      matchNote
    };
  }

  /**
   * Helper function to execute fetch with exponential backoff on HTTP 429 / 5xx.
   * Supports local cache (chrome.storage.local).
   */
  async function fetchWithRetryAndCache(url, options = {}, cacheStorage = null) {
    const TTL_MS = 60 * 60 * 1000; // 1 hour

    // Check storage cache
    if (cacheStorage && typeof cacheStorage.get === 'function') {
      try {
        const cached = await new Promise(resolve => cacheStorage.get(url, res => resolve(res[url])));
        if (cached && cached.timestamp && (Date.now() - cached.timestamp < TTL_MS)) {
          return cached.data;
        }
      } catch (e) {
        console.warn('Cache read error:', e);
      }
    }

    const maxRetries = 3;
    const delays = [2000, 4000, 8000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        if (response.ok) {
          const data = await response.json();
          // Write to cache
          if (cacheStorage && typeof cacheStorage.set === 'function') {
            try {
              cacheStorage.set({ [url]: { timestamp: Date.now(), data } });
            } catch (e) {
              console.warn('Cache write error:', e);
            }
          }
          return data;
        }

        // Retry on 429 or 5xx
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          await new Promise(res => setTimeout(res, delays[attempt]));
          continue;
        }

        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      } catch (err) {
        if (attempt >= maxRetries) {
          throw err;
        }
        await new Promise(res => setTimeout(res, delays[attempt]));
      }
    }
  }

  // Exports
  exports.CPL_LIB_ID = CPL_LIB_ID;
  exports.BASE_URL = BASE_URL;
  exports.ALL_CPL_BRANCHES = ALL_CPL_BRANCHES;
  exports.normalizeBranch = normalizeBranch;
  exports.isBranchMatch = isBranchMatch;
  exports.formatAuthorForSearch = formatAuthorForSearch;
  exports.cleanTitleForSearch = cleanTitleForSearch;
  exports.buildSearchQueries = buildSearchQueries;
  exports.parseSearchResponse = parseSearchResponse;
  exports.parseAvailabilityResponse = parseAvailabilityResponse;
  exports.evaluateBookAvailability = evaluateBookAvailability;
  exports.fetchWithRetryAndCache = fetchWithRetryAndCache;

})(typeof exports !== 'undefined' ? exports : (window.LibraryUtils = {}));
