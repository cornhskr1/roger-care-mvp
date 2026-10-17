# Snapshot preview readability

This is a presentation-only change to the on-screen Care Snapshot. The selected date range appears once above a short lead and grouped, normal-weight bullets. App-generated wording preserves the existing appetite, stool, vomiting, energy, medication and uncertainty classifications. Important flags stay visible, and timing near an earlier chart window is not described as a cause.

Original free-text nausea notes are shown verbatim in the expandable recorded details, with dates and preserved line breaks. They are not inserted into generated sentences. Missing days or symptoms remain unknown, and positive/negative nausea dates are kept separate.

The source records, storage, synchronization, authentication, export narrative and existing printable report are unchanged. The complete-course handoff report is a separate follow-up, not part of this change.

## Verification

- Existing Care Snapshot safety tests remain unchanged.
- `node scripts/test-snapshot-readability.cjs` checks short preview wording, source/uncertainty preservation, range labels, source text escaping and unchanged records/legacy outputs using synthetic fixtures.
- `node scripts/test-snapshot-readability.cjs --browser` verifies rendered desktop and phone layouts and range navigation using synthetic fixtures only. Run in the GitHub validation workflow along with the prior navigation, owner sign-in, weight, appointment and service-worker regressions.
