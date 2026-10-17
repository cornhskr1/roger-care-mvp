# Reviewed weight during patient-summary import

The patient-summary review now includes an optional Weight field and an explicit lb/kg selector. A clearly extracted value is proposed for review; missing, conflicting, or unsupported wording is flagged so the owner can enter a value from the source instead.

- Explicit kg values convert to pounds, rounded to 0.01 lb. Explicit pound values retain their entered precision.
- A blank weight preserves a matching treatment's existing weight and provenance. A new treatment with a blank weight remains unknown, not zero.
- Matching treatment numbers update through the existing correction-history path rather than adding duplicates. Ambiguous matches or unusable IDs stop without changing data.
- Weight-only corrections retain the original dose source and unrelated treatment fields. Correction history retains the complete prior record and reviewed weight provenance.
- Repeated unchanged reviews do not create duplicate treatments or corrections.
- Nothing saves until the owner confirms the review. Save failures retain the prior in-memory record through the existing rollback path.

This does not add OCR for scanned/image-only patient summaries. If the summary has no readable text, the import stops without modifying the record; invoice OCR behavior is unchanged. Original PDFs are not rewritten or uploaded by this change.

Keep an external complete backup before making clinical corrections. This update does not replace the app's backup/recovery workflow or change authentication, single-writer sync, database schema, or seed records.

## Verification

The tests use invented visit/dose/weight data and in-memory persistence, never the live cloud record or owner credentials.

```sh
node scripts/test-import-weight.cjs
# Optional real-browser suite, using the existing CI Playwright setup:
node scripts/test-import-weight.cjs --browser
```

The browser suite covers desktop and narrow phone layouts, actual lb/kg controls, missing/manual/blank values, repeated review, invalid input, correction audit/source preservation, rejected save rollback, navigation before saving, and failed scans. PDF extraction/OCR itself is stubbed and is not represented as browser-tested.
