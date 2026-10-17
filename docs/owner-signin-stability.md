# Owner sign-in stability (app shell v65)

The Owner sign-in disclosure, email/link draft, focus, and text selection now stay in place while background sync, window focus, or repeated auth callbacks refresh the status. Only a real switch between owner and view-only controls rebuilds the section. Pasted links remain solely in the existing input until submission; they are never copied to app state, browser storage, or HTML attributes, and the input still clears on submission.

Authentication checks, link validation, single-writer sync, clinical data, and recovery/storage behavior are unchanged. The isolated browser regression uses synthetic records and stubbed auth with external requests blocked:

```sh
node scripts/test-owner-signin-state.cjs
# Uses the same Playwright setup as the existing browser suites in CI.
node scripts/test-owner-signin.cjs
```
