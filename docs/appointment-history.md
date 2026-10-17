# Appointment editing and history

Appointments are a plan, not evidence that treatment or a test happened. This change does not modify clinical history, seed records, authentication, backend permissions, or source documents. There is no calendar integration or automatic appointment import.

## Owner workflow

Open **More → Appointments & instructions**. Use **Add appointment** for a new planned event, or **Edit** beside an existing one. Enter a name, optional date, optional local appointment time, and optional source/note. A time requires a date. Save explicitly; Cancel, Close, Escape, or navigation discards an unsaved draft.

Past dates are automatically separated under **Earlier scheduled dates**. They are not deleted and do not become confirmed visits. Undated plans have their own **Date to be confirmed** section. No deletion control is offered. Treatment and lab histories remain separate and unchanged. Vet instructions are saved independently and cannot clear appointment dates.

## Preservation

- Refreshing the canonical seed preserves owner-created appointment IDs and every saved field, including time, source, and extension fields. Legacy pre-v7 canonical-date behavior remains unchanged; additional custom visits survive.
- Edits retain stable IDs and all unknown fields. Each real change records the complete before/after appointment in `recordCorrections` under `carePlanVisits`. New appointments use `before: null`. JSON backups and the existing full-record correction report retain that history.
- Appointment fields are included in the existing complete cloud mirror. The single-owner/view-only model, sync revision checks, storage keys, and schema are unchanged.
- The draft has a stable ID. Duplicate submissions are guarded, exact repeat saves are no-ops, duplicate new appointments are rejected, and ambiguous IDs or stale edits stop without changing the record.
- A failed save restores that appointment and its own audit entry, without replacing unrelated record collections. The form remains available to retry. Background renders do not replace appointment dialog inputs.
- Home, Timeline, and care-summary exports display saved appointment times without timezone conversion. They are the appointment location's local time, not device-timezone-derived instants.

## Validation

Run `node scripts/test-appointments.cjs` for deterministic synthetic state/DOM checks and `node scripts/test-appointments.cjs --browser` with the documented Playwright/Chromium setup in the validation workflow. Browser fixtures block external network requests and replace persistence/auth with in-memory test doubles; no production records or accounts are used.

The existing navigation, snapshot, owner sign-in, weight-import, and service-worker suites remain required. The new browser suite covers desktop and phone widths, interrupted/repeated editing, save rollback, and view-only controls. These tests do not authorize or perform any live record correction.
