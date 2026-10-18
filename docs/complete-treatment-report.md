# Complete treatment report

Care Snapshot remains a short visit update. The separate **Complete treatment report** on that page includes all recorded dates, regardless of the snapshot period or chart filters.

## Using the report

- **Preview complete report** opens the complete report in a new browser window.
- **Print / save PDF** opens the same report and the browser's print flow. The PDF is made by the browser so original Unicode text can be rendered, rather than by the short snapshot's limited-font PDF generator.
- **Download report (HTML)** saves the standalone UTF-8 report. Open the file in a browser to read or print it. The downloaded report has no scripts, external assets or network dependencies.
- **Include financial ledgers** is off by default. Enabling it adds bills and medication purchase allocations. This is not a redaction tool: unchanged original clinical/source notes and document metadata may mention costs.

The app does not send the report or read-only link to anyone. Source documents are not embedded. The document index describes only files available in this browser; an unavailable index is distinguished from a successful empty index. Supply the source files separately if needed. A report is not a restorable app backup; the existing complete backup remains the recovery path.

## Preservation and interpretation

The pure `RogerHandoff.buildModel` and `renderHtml` functions do not save, restore, authenticate or synchronize records. The UI reads document metadata through a readonly transaction and generates the report from the currently loaded record. It includes generation/save/share timestamps when known and flags unpublished local changes without claiming every device is identical.

The report keeps prescriptions, reported courses and individual administration logs separate. Missing dose logs do not mean a dose was given or missed. Scheduled visits do not prove a visit occurred. Missing, null, blank, zero and false values remain distinct. Every supplied record is retained with its original index/ID; duplicate IDs and conflicting same-day weights are not collapsed. The report does not claim every real-life event was logged.

Appendices include patient fields (not photo binaries), treatments, all lab metrics and bounds, sourced structured weights, prescriptions, courses, every administration, every journal field and original wording, quality-of-life entries, milestones/source notes, the full care plan/questions/contact/appointment history, corrections, reviewed imports and local document metadata. Expanded original fields preserve nested and unfamiliar per-record fields. Financial totals sum recorded cost-ledger amounts only; purchase allocations are shown separately and never added a second time. Missing amounts and unresolved links remain visible.

## Tests

`node scripts/test-complete-report.cjs` uses only invented data. It checks old/multiple/held/unknown administrations; full source fields, raw journal wording and Unicode; same-day weights; arbitrary labs; all question/status/correction/import fields; financial opt-in and accounting; file payload exclusion; unavailable versus empty documents; and source/state immutability across snapshot ranges.

The optional `--browser` suite exercises actual popup, print trigger, HTML download, repeated navigation/ranges, view-only controls, popup errors and unavailable document access at desktop and phone widths. `--browser --webkit` checks the phone flow with WebKit, not a physical iPhone. CI also retains synthetic screenshots and Chromium-generated PDF/HTML artifacts for visual and text-preservation review. No real clinical fixtures or credentials are used.

## Current progress versus original profile wording

Recorded treatment progress is derived at display time from the highest valid numbered treatment record, not the profile's historical status text, array length, snapshot range or scheduled appointments. Explicit planned/held/unknown statuses and future-dated entries are not counted as recorded progress. Missing or conflicting dates are not invented. The existing eight-treatment plan supplies the denominator, not a claim that all preceding doses are present; numbers above that plan are flagged rather than clamped.

The original profile status stays unchanged in the saved state and the full original-profile appendix. It is labeled historical text, with no status date inferred from a general save/sync timestamp. Current progress in the profile and both snapshot exports uses the same pure helper as the complete report. Rendering makes no clinical-data, storage, authentication or sync changes.

`node scripts/test-treatment-status.cjs` checks current versus original status, ordering, gaps, duplicate/conflicting records, unknowns and state immutability. `--browser` checks refresh and navigation at desktop and phone widths using synthetic records only.
