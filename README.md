# CPL Stock Check (v2)

Chrome extension that checks whether a Chicago Public Library branch already owns the books on a spreadsheet, so you know what to order. Requests go from your browser straight to the library; nothing is uploaded elsewhere.

## Install
1. Unzip the folder.
2. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, pick the folder.
3. Click the extension icon to open the page.

## Update
Double-click `update.bat`, then press Reload on the extension card in `chrome://extensions`. (It pulls the `main` branch of github.com/belk-hachi/cpl and skips itself, `.gitignore` and `tests/`.)

## Statuses
- **IN STOCK**: the branch holds a copy (Available, Checked Out, Hold Shelf, In Transit, Transferred for Hold). Checked out still counts. "Overdue" is shown when the due date has passed.
- **ON ORDER**: only an On Order copy at the branch.
- **NOT AT BRANCH**: no matching edition owned or on order.
- **CHECK MANUALLY**: not in the catalog, a possible match with a slightly different title, a request failed (4xx), or the check was cut short.
- **ERROR**: network failure or server error after retries.

How it works: one search filtered to the branch (`f_STATUS=<code>`) lists every edition the branch holds; titles are checked; then the real copy status is read per owned edition. Books and paperbacks only. The branch filter is not complete (it can miss checked-out, in-transit and on-order copies), so when it finds nothing the first 2 pages of editions are also checked directly (up to 12 availability calls per book).

Limits and politeness: one request at a time, 500 ms pause, retries only on 429/5xx/network errors, a 403 stops the run. Cache: 1 hour, 300 entries.

## Tests
`node tests/run-tests.js` (offline; fixtures in `tests/fixtures`).
