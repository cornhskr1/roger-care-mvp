# Roger Care MVP

A mobile-first Progressive Web App for a longitudinal canine oncology record.

## What this first build does

- Roger profile with owner-uploaded photo (compressed and stored locally)
- Daily owner observation journal
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

The published starter record (including patient IDs) is public in the GitHub Pages site and repository. Owner-entered entries, corrections, photo, and document files remain on this device. There is no authenticated private sharing yet. Use the local vet handoff download/print to share deliberately.

The complete JSON backup includes document file data, profile personalization, owner edits, and a correction history. Importing a complete backup replaces current on-device entries and documents after a confirmation; older state-only backups preserve existing device documents.

Upcoming treatment and restaging slots deliberately have no dates until confirmed. Vet call instructions are blank until entered with a source. The handoff includes a first-page snapshot and a longer sourced record; it does not attach the source documents themselves.

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
