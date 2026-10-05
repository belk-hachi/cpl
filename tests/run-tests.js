/**
 * tests/run-tests.js — Standalone unit test suite for Library Checker.
 * Compatible with Node.js and Browser environments.
 */

const fs = require('fs');
const path = require('path');

// Import modules in Node environment
const SheetUtils = require('../sheet.js');
const LibraryUtils = require('../library.js');

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedCount++;
  }
}

console.log('====================================================');
console.log('   Chicago Public Library Checker — Test Suite      ');
console.log('====================================================\n');

// Load Fixtures
const searchFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/roth_everyman_search.json'), 'utf8'));
const checkedOutFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/checked_out_availability.json'), 'utf8'));
const availableFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/available_copy_availability.json'), 'utf8'));

// Test Case 1: Checked Out copy at branch is categorized as AVAILABLE (library already owns it, do not reorder)
console.log('Test 1: Checked Out copy at target branch (categorized as AVAILABLE for supplier order check)');
{
  const editions = LibraryUtils.parseSearchResponse(searchFixture);
  const targetEdition = editions[0]; // S126C1088091
  const availMap = new Map();
  availMap.set('S126C2706764', LibraryUtils.parseAvailabilityResponse(checkedOutFixture, 'S126C2706764'));

  const checkedOutBook = { title: 'Everyman', author: 'Roth, Philip' };
  const fakeEditions = [{ id: 'S126C2706764', title: 'Everyman', format: 'BK', pubYear: '2006' }];

  const res = LibraryUtils.evaluateBookAvailability(checkedOutBook, fakeEditions, availMap, ['Little Italy']);

  assert(res.status === 'AVAILABLE', `Status should be 'AVAILABLE' (owned/checked out), got '${res.status}'`);
  assert(res.dueDate === '2026-10-19', `Due date should be '2026-10-19', got '${res.dueDate}'`);
  assert(res.copyStatus.includes('Checked Out'), `Copy status should include 'Checked Out', got '${res.copyStatus}'`);
}

console.log('\nTest 2: Available copy at target branch');
{
  const availMap = new Map();
  availMap.set('S126C2702542', LibraryUtils.parseAvailabilityResponse(availableFixture, 'S126C2702542'));

  const availableBook = { title: 'Everyman', author: 'Roth, Philip' };
  const fakeEditions = [{ id: 'S126C2702542', title: 'Everyman', format: 'BK', pubYear: '2006' }];

  const res = LibraryUtils.evaluateBookAvailability(availableBook, fakeEditions, availMap, ['Little Italy']);

  assert(res.status === 'AVAILABLE', `Status should be 'AVAILABLE', got '${res.status}'`);
  assert(res.matchedBranch === 'Little Italy', `Branch should be 'Little Italy', got '${res.matchedBranch}'`);
  assert(res.copyStatus === 'Available', `Copy status should be 'Available', got '${res.copyStatus}'`);
}

console.log('\nTest 3: Selected branch has no items (Not at branch)');
{
  const availMap = new Map();
  availMap.set('S126C2702542', LibraryUtils.parseAvailabilityResponse(availableFixture, 'S126C2702542'));

  const book = { title: 'Everyman', author: 'Roth, Philip' };
  const fakeEditions = [{ id: 'S126C2702542', title: 'Everyman', format: 'BK', pubYear: '2006' }];

  // Target branch "Albany Park" has no items in availableFixture (only Little Italy and Logan Square have items)
  const res = LibraryUtils.evaluateBookAvailability(book, fakeEditions, availMap, ['Albany Park']);

  assert(res.status === 'NOT AT BRANCH', `Status should be 'NOT AT BRANCH', got '${res.status}'`);
  assert(res.matchedBranch === '-', `Branch should be '-', got '${res.matchedBranch}'`);
}

console.log('\nTest 4: Spreadsheet row with blank author cell keeps columns aligned');
{
  const sampleRows = [
    ['Title', 'Author', 'Year'],
    ['The Great Gatsby', '', '1925'], // Blank author
    ['1984', 'George Orwell', '1949']
  ];

  const books = SheetUtils.extractBookRows(sampleRows, 0, 1);

  assert(books.length === 2, `Should extract 2 rows, got ${books.length}`);
  assert(books[0].title === 'The Great Gatsby', `Row 1 title should be 'The Great Gatsby', got '${books[0].title}'`);
  assert(books[0].author === '', `Row 1 author should be empty string '', got '${books[0].author}'`);
  assert(books[1].title === '1984', `Row 2 title should be '1984', got '${books[1].title}'`);
  assert(books[1].author === 'George Orwell', `Row 2 author should be 'George Orwell', got '${books[1].author}'`);
}

console.log('\nTest 5: Column guessing logic');
{
  // Header set 1: ["Author Name", "Title"]
  const guessed1 = SheetUtils.guessColumns(['Author Name', 'Title']);
  assert(guessed1.titleCol === 1, `['Author Name', 'Title'] titleCol should be 1, got ${guessed1.titleCol}`);
  assert(guessed1.authorCol === 0, `['Author Name', 'Title'] authorCol should be 0, got ${guessed1.authorCol}`);

  // Header set 2: ["Subtitle", "Title", "Author"]
  const guessed2 = SheetUtils.guessColumns(['Subtitle', 'Title', 'Author']);
  assert(guessed2.titleCol === 1, `['Subtitle', 'Title', 'Author'] titleCol should be 1, got ${guessed2.titleCol}`);
  assert(guessed2.authorCol === 2, `['Subtitle', 'Title', 'Author'] authorCol should be 2, got ${guessed2.authorCol}`);
}

console.log('\nTest 6: Branch matching exact vs substring preference');
{
  const allBranches = ['Austin', 'North Austin', 'Little Italy', 'Harold Washington Library Center'];

  // Target = "Austin", Item = "Austin" -> Exact match
  assert(LibraryUtils.isBranchMatch('Austin', 'Austin', allBranches) === true, 'Austin matches Austin exactly');

  // Target = "Austin", Item = "North Austin" -> Should NOT match because "Austin" is an exact known branch
  assert(LibraryUtils.isBranchMatch('North Austin', 'Austin', allBranches) === false, 'North Austin does NOT match target Austin');

  // Target = "North Austin", Item = "North Austin" -> Exact match
  assert(LibraryUtils.isBranchMatch('North Austin', 'North Austin', allBranches) === true, 'North Austin matches North Austin');

  // Target = "Harold Washington", Item = "Harold Washington Library Center" -> Substring match allowed because target is partial
  assert(LibraryUtils.isBranchMatch('Harold Washington Library Center', 'Harold Washington', allBranches) === true, 'Harold Washington Library Center matches partial target Harold Washington');
}

console.log('\n====================================================');
console.log(`Summary: ${passedCount} Passed, ${failedCount} Failed`);
console.log('====================================================');

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
