# Roger Care MVP

A mobile-first Progressive Web App for a longitudinal canine oncology record.

## What this first build does

- Roger profile with owner-uploaded photo (compressed and stored locally)
- Daily owner observation journal with repeatable bowel movement rows and a dated trend chart
- Treatment timeline with source labels
- Seeded vinblastine treatment history through treatment #5
- Seeded CBC/chemistry trend data
- Cost-of-care tracking using **amount paid only**
- Original K-State 8/4 treatment-cost estimate preserved as a sourced record
- On-device document storage using IndexedDB
- Care-team mode and care-team summary export
- Full app JSON backup/import
- PWA manifest + service worker for Add to Home Screen / offline shell

## Privacy model in this MVP

This build has no backend, no analytics, and no remote database. New journal entries, profile photo, costs, and uploaded documents are stored in the browser on the device using localStorage / IndexedDB.

Financial records deliberately do **not** store bank names, account numbers, card details, balances, or payment methods. The financial model stores only:

- date
- provider
- care description/category
- amount paid
- confirmation status/source type

## Hosting on GitHub Pages

1. Create a new repository (for example `roger-care-mvp`).
2. Upload the contents of this folder to the repository root.
3. In GitHub: **Settings → Pages**.
4. Set **Source** to `Deploy from a branch`.
5. Select the `main` branch and `/ (root)` folder.
6. Save. GitHub will provide the Pages URL.
7. Open that URL in Safari on iPhone → Share → **Add to Home Screen**.

> The data added on the phone remains local to that browser/device in this MVP. Deploying the code does not upload the locally entered records to GitHub.

## Important limitation

Document upload is real and persists locally, but automated medical-document extraction is **not** implemented yet. That needs a secure backend / ingestion service and should not be simulated in the client.

The published historical journal through 10/3/2026, medical record, and patient IDs are public in the GitHub Pages site and repository. New owner-entered app entries, corrections, photo, and document files remain on the device where they were entered. There is no authenticated private sharing or cross-device sync yet. Use the local vet handoff download/print to share deliberately.

The dated complete JSON backup includes document file data, profile personalization, owner edits, and correction history. A SHA-256 digest detects accidental file changes where Web Crypto is available; older backups remain importable. Importing a complete backup replaces current on-device entries and documents after a confirmation; older state-only backups preserve existing device documents. The app keeps five rolling on-device recovery snapshots in IndexedDB and uses the latest if its localStorage state is missing, damaged, or older. A Home and More backup status stays marked as needing an external copy after any edit until the owner downloads and confirms saving a copy outside the browser. Internal snapshots cannot survive clearing all site data or losing the device, and the app cannot verify where a downloaded file was saved. It has no cloud sync.

Owner-reported CBC dates (10/15, 10/29, 11/12) and vinblastine dates (10/16, 10/30, 11/13) are shown as scheduled events. Final restaging remains TBD. Vet call instructions are blank until entered with a source. The PDF handoff includes a first-page snapshot and a compact treatment history; it does not attach the source documents themselves. Print full record opens the longer HTML report.

The owner's original daily journal spans all 51 dates from 8/14 through 10/3. `data/journal-original.txt` preserves the supplied wording; `scripts/import-journal.cjs` creates structured entries in `data/seed.json`, each retaining its original dated block in `rawEntry`. The journal view shows the latest seven dates and can reveal all older entries and the full source on demand. Stool entries can have multiple movements per day, with unobserved, unrecorded, and unscored values distinct from scored movements. On 9/29 the original note reports six movements but enumerates only five scores; the sixth is counted without a score. The source-reported 8/27 CBC value remains in the journal wording; clinical lab values retain their separate record source. New app entries feed the trend chart and persist locally, with complete JSON backup/import available in More.

The journal comparison chart shows any one or two measures on separate labeled scales: energy, nausea signs, movement count, highest stool score, loose stool/diarrhea flag, logged Cerenia doses, neutrophils, and weight. It can show all journal dates, any combination of treatment periods, or a custom date range. Treatment and CBC dates are marked on the shared time axis, and selecting a date shows its recorded values and source notes. A missing nausea observation stays blank rather than becoming zero; the chart reflects recorded timing without implying causation. New local journal entries and medication administrations update it when saved.

The journal now groups notes from the same date into one day card, with every source note and its own correction control retained. Matching scored bowel movements from an imported journal entry and an app entry count once in the comparison; distinct movements remain separate. The comparison can align selected treatment cycles by day after chemotherapy, with CBC and medication/food markers, and now includes Roger things and optional weekly wellbeing scores. Gaps mean no value was recorded. The vet handoff downloads as a short PDF for phone sharing, with a visit snapshot and compact treatment history. The complete JSON backup remains the authoritative copy of original wording, corrections, and uploaded documents.

The Home clinical review puts the recorded dose and weight, nearby pre-dose neutrophils, lowest measured post-dose count, owner symptom mentions, supportive medication days, and the next documented dose reason in one treatment-period card. It describes timing and provenance, not a dosing recommendation or causal inference. Journal comparisons also offer hematocrit, platelets, ALT, and ALP from the stored lab series. The 10/1 ALP value is reported as >2,000 U/L and plotted at 2,000 only as a lower bound. The owner confirmed that the 8/27 neutrophil result is 14.43 K/µL; the imported original journal text with 14,310 remains verbatim and displays a clarification beside it.

## Next technical milestones

1. Secure authentication and encrypted cloud sync
2. Multi-pet support
3. Server-side document ingestion and source-backed extraction
4. Vet/care-team share links with explicit scopes and expiration
5. Structured adverse-event/QOL scoring
6. Notification/reminder engine
7. De-identified research export with explicit owner consent
8. Audit trail / record provenance and correction history


## Live app

GitHub Pages deployment target:

https://cornhskr1.github.io/roger-care-mvp/


## Medication tracking and aligned dates (v9)

- Four synchronized lanes for vinblastine, bloodwork, medications, and owner observations.
- Selected treatment windows label every calendar date; swipe the chart on phones. Dashed guides align medication dates, and selecting an event highlights its date across all lanes.
- Tablet counts are computed from recorded administrations and owner-confirmed daily courses with known strengths. Held doses and future prescribed days do not add pills automatically.
- Cerenia summaries show per-cycle usage, recorded nausea days, same-date use, purchased quantity, and purchase-based spending.
- Medication purchase allocations reference their existing care cost by `costId`; they never add the medication charge again. A new separate purchase creates one care expense and its allocation together.
- New purchases can be entered through Costs → + Cost → Medication. Choose an existing bill when its total already includes that purchase.
- Purchase quantities and line totals were reconciled from K-State invoices 149569 (8/4), 150910 (8/14), 154654 (9/11), and 157866 (10/2). Cerenia: 23 × 60 mg tablets for $237.64, with 11 tablets documented given through 10/2.
- Canonical refresh preserves owner-entered administrations and purchases.
