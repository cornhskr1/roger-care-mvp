# Roger Care MVP — Product Architecture

## Product premise

The owner sees the patient continuously; the clinical team sees snapshots. Roger Care turns owner observations, clinical events, labs, documents and financial burden into one time-aligned longitudinal record while preserving the source of every fact.

## Design rules

1. **Source provenance is never stripped.** Owner observations stay owner-reported; clinician notes stay clinician-documented; lab results stay lab-derived.
2. **Conflicts are preserved, not silently reconciled.** A later clinical note may say “no adverse effects reported” while an owner journal contains symptoms. Both can coexist.
3. **Financial burden is part of care context.** The record can show amount paid and care context, but it does not store bank accounts, card numbers, balances, or payment methods.
4. **The original owner note is preserved.** Structured fields make trends possible, but the human narrative stays available.
5. **Clinical decision support is observational.** The app surfaces patterns; it does not diagnose, prescribe, or silently recommend treatment changes.

## Core entities

### Patient
- name
- species / breed
- sex
- reproductive status (owner-facing: “Neutered”)
- DOB
- diagnosis
- profile photo

### Treatment
- date
- drug
- absolute dose
- mg/m² dose
- treatment number
- weight
- concurrent medications
- dose-change reason
- clinician summary
- source

### Lab result
- date
- metric
- value / display value
- unit
- context (pre-treatment, nadir, baseline)
- provider/source

### Owner observation
- date
- appetite
- energy
- nausea severity
- vomiting count
- stool score / notes
- hydration / thirst
- urination
- pain/discomfort
- medication administered
- original free-text note
- source = owner observation

### Cost of care
- date
- provider
- care label/category
- amount paid
- confirmation status
- source type

Deliberately excluded: bank name, account number, last four, card information, balance, payment instrument.

### Document
- local file/blob
- date
- document type
- provider/source
- owner note
- extraction status (future backend)

## MVP storage

- Structured app state: `localStorage`
- Uploaded documents: `IndexedDB`
- Profile photo: compressed JPEG data URL in local state
- Hosted code: static GitHub Pages compatible
- No backend, analytics, cloud sync or remote document upload in v0.1

This is deliberately privacy-first for the first build. The tradeoff is that clearing browser data or changing devices can remove local records, so the app includes JSON backup/export.

## Care-team export

The generated care-team summary contains:
- patient profile
- diagnosis/current protocol status
- treatment doses and dose context
- selected labs
- owner-reported observations and original notes
- owner-paid care burden
- sourced K-State treatment estimate
- provenance statement

It excludes:
- bank/payment-account data
- app backup internals
- raw locally stored documents

## Next architecture step

Before multi-user sharing, add a secure backend with:
- authenticated owner accounts
- encrypted patient/document storage
- append-only provenance/audit history
- scoped care-team share links
- document ingestion with source citations
- explicit research-consent model separate from clinical sharing
