# Chicago Public Library (CPL) Availability Checker

A Manifest V3 browser extension for Google Chrome and Microsoft Edge that checks book availability across Chicago Public Library branches directly from uploaded Excel (`.xlsx`) or CSV (`.csv`) spreadsheets.

---

## 🔒 Privacy & Security

- **Direct Browser Requests**: All library API calls are made directly from your browser to `https://gateway.bibliocommons.com`.
- **Zero Third-Party Servers**: There is no backend server. Your spreadsheet data **never** leaves your computer or browser.
- **Local Storage**: Storage permissions are used solely to cache API responses locally for 1 hour to prevent redundant requests to library servers.

---

## 🚀 How to Install ("Load Unpacked")

1. Open **Chrome** or **Microsoft Edge**.
2. Navigate to the extensions page:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button.
5. Select this extension folder (`Library Extention`).
6. The **Chicago Public Library Availability Checker** icon will appear in your extensions toolbar.

> ⚠️ **IMPORTANT**: Do not move or delete this folder after loading unpacked. Chrome loads the extension directly from this file path. If you move or delete the folder, the extension will stop working.

---

## 📖 How to Use

1. Click the extension toolbar icon. This will open `app.html` in a new full-page tab.
2. **Step 1: Upload Spreadsheet**:
   - Drag & drop or browse for your `.xlsx` or `.csv` file.
   - If the file has multiple sheets, select the sheet to inspect.
   - Verify or adjust the **Title** and **Author** column dropdowns. A 5-row preview table will highlight your selected columns.
3. **Step 2: Target Branches**:
   - Select the library branches you want to check (default is **Little Italy**).
   - Use "Select All", "Clear All", or add custom CPL branch names as needed.
4. **Step 3: Start Search**:
   - Click **Start Availability Search**.
   - Watch real-time progress and results populate in the table.
5. **Step 4: Filter & Export**:
   - Filter by status tab (**Available**, **At Branch, Not Available**, **Not At Branch**, **Not Found**, **Error**) or use the search box.
   - Click **Download Results (CSV)** to save your availability report as a CSV file.

---

## 🔄 How to Update the Extension

1. Replace or update the files in this folder with the new versions.
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Find **Chicago Public Library Availability Checker** and click the **Reload icon (↻)** on the extension card.

---

## 👥 How to Share with Another Person

1. Compress this folder into a `.zip` file.
2. Send the `.zip` file to the recipient.
3. The recipient unzips the folder into a permanent location on their computer.
4. They follow the [How to Install ("Load Unpacked")](#-how-to-install-load-unpacked) steps above.

---

## 🧪 Running Tests (Offline Unit Tests)

This repository includes a standalone unit test suite that validates spreadsheet parsing, availability rules, and branch matching logic without network access:

### Run in Node.js:
```bash
node tests/run-tests.js
```

### Run in Browser:
Open `tests/runner.html` directly in your browser.

---

## ⚠️ Known Limitations & Technical Details

- Uses unofficial CPL Bibliocommons API endpoints (`gateway.bibliocommons.com`).
- Designed for desktop Chrome and Edge (Manifest V3).
- Respects rate limits by sending sequential requests (concurrency 1) with 400–600ms pauses between requests and exponential backoff retries on HTTP 429/5xx errors.
