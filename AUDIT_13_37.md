# Lignum 13.37 — continuation of the app audit

Based on `main` at `774d0f47ad593168167804407feeced9b33f3df7` (13.36).

## Changes

- `offline.js` provides one shared durable queue, read cache and local record store. Saving a marker commits the queue before drawing the marker. Reloads combine cached server data with pending creates, edits and deletes.
- Queued writes belong to their original account. Legacy JWT-owned entries and old non-UUID IDs are migrated without discarding the work. Failed authentication, network failures and unresolved conflicts retain the queue. Dependent writes run in order; duplicate POSTs require verification of the stored record and submitted fields.
- Map reads preserve the current map on failure. Realtime acknowledgements do not overwrite newer pending edits. Collected markers, areas and stopped worktime entries retain their offline state after reopening.
- All marker deletion buttons use the same permission check. LKW markers require a company admin; tracks require their creator or an admin. Failed and RLS-denied writes no longer silently remove map data.
- Removed the incorrect service-worker version string check and automatic page reload during work. A complete offline shell is required before activating an update. Protected downloaded map regions survive updates; background tile writes use the event lifetime.
- Escaped marker text and selected driver-name outputs. Marker popups update with the current record. GPX names use the standard `name` element and escaped text.
- Database triggers block self-granted admin privileges, company/creator reassignment and converting a LKW marker to bypass deletion protection. Track/time-entry ownership predicates also apply to the resulting updated row.
- Fixed account deletion's nonexistent column references and foreign-key failures. Login/profile/personal worktime removal follows the existing dialog; company markers, maps and audit rows remain, with original audit identifiers retained. Last-admin checks in permission changes and account deletion share a company lock. Removed users no longer pass company helpers. Stale-driver checks operate within the caller's company.

## Validation

`node --test tests/*.test.cjs`: 39 passing regression tests. These run the unchanged application functions in a Node VM with browser API models, including transaction commit/abort behavior, reloads, the actual marker save handler and service-worker events.

`tests/permissions.sql` and `tests/accounts.sql` passed on the connected database after the changes. Temporary users, companies, mutations and account deletions were rolled back. No real account was deleted by the tests.

All inline JavaScript and local JavaScript files pass syntax checks. Top-level function names have no duplicates. Local script paths and app/service-worker versions are checked.

The installed database changes are recorded in `supabase/lignum_permission_guards.sql` and `supabase/lignum_account_integrity.sql`; the earlier hardening file now uses the final ownership predicates.

## Limits and follow-up verification

- A real iPhone/Safari field test is still required: reopen the updated app online, prepare the map, enable airplane mode, create a polter, mark/delete entries, reopen offline, then reconnect and check the server result. The automated browser API models do not certify Safari storage or GPS behavior.
- No actual signup/reset email was sent. The existing server-side signup trigger and removal of duplicate client provisioning were inspected; email delivery and the absent password-reset UI are separate work.
- Security advisors report only the intentionally authenticated company/permission/account RPCs and disabled leaked-password protection. The retained RPCs check the authenticated caller; anonymous execute access was revoked. Leaked-password protection is an Auth configuration setting and was not changed in this release. [Advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) · [Password setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
