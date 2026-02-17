# Profile JSON Validation and Reconciliation Specification

## Purpose
This document defines the current profile validation and reconciliation behavior used by the bridge.

Goals:
- Prevent malformed profiles from being pushed to GaggiMate.
- Keep profile state deterministic between Notion and GaggiMate.
- Preserve device-created profiles by importing them into Notion as unmanaged drafts.

## Runtime Paths
- Webhook push path: `POST /webhook/notion` + `pushProfileToGaggiMate`
- Reconcile loop path: `src/sync/profileReconciler.ts`

Both paths enforce queued-only push behavior and the same core validation gates.

## Push Status Semantics
- `Draft`: Exists in Notion only; bridge does not push or delete it.
- `Queued`: Eligible for validation + push.
- `Pushed`: Managed profile on device; Notion JSON is authoritative.
- `Archived`: Should not exist on device (non-utility profiles are deleted).
- `Failed`: Last push/delete attempt failed; requires user attention.

Device-only profiles discovered on GaggiMate are imported as `Draft` (not `Pushed`).

## Validation Rules (Current Implementation)
Validation is intentionally minimal and mirrors actual code behavior.

Required for a push attempt:
1. `Profile JSON` parses as valid JSON object.
2. `temperature` is a number in range `60..100`.
3. `phases` is an array with at least one element.

If any validation check fails:
- Set `Push Status = Failed`
- Skip device operations for that profile in that cycle

## Reconciliation Rules

### `Queued`
- Validate profile JSON.
- Push to device via `saveProfile`.
- If device returns a new `id`, write that `id` back into Notion `Profile JSON`.
- Set `Push Status = Pushed`, `Last Pushed = now`, `Active on Machine = true`.
- Preserve existing AI sibling archive behavior.

### `Pushed`
- If missing on device: re-push from Notion JSON.
- If present but drifted: re-push Notion JSON (Notion wins).
- Sync `Favorite` and `Selected` from Notion to device.
- Ensure `Active on Machine = true`.

### `Archived`
- If present on device and not utility (`flush`/`descale`), delete from device.
- Ensure `Active on Machine = false`.
- If delete fails, set `Push Status = Failed`.

### `Draft` / `Failed`
- No automated device operation.

### Unmatched Device Profiles
- Import as new Notion pages with `Push Status = Draft`.
- Set `Active on Machine = true`.
- Copy `Favorite` and `Selected` from device state.
- Upload generated profile image when possible.

## Notion Writeback Rules

On successful push/re-push:
- `Push Status = Pushed`
- `Last Pushed = now`
- `Active on Machine = true`

On successful archive/delete:
- `Push Status = Archived`
- `Active on Machine = false`

On push/delete failure:
- `Push Status = Failed`

Additional writeback:
- For newly pushed profiles without ID, bridge writes machine-assigned `id` into `Profile JSON`.

## Queued-Only Enforcement
- Webhook path processes a profile only when current `Push Status == Queued`.
- Reconciler pushes only `Queued` profiles (other statuses follow their own non-push rules).

## Example Valid JSON
```json
{
  "label": "Dial-In v2",
  "type": "pro",
  "temperature": 93,
  "phases": [
    {
      "name": "Extraction",
      "phase": "brew",
      "duration": 30,
      "pump": {
        "target": "pressure",
        "pressure": 9
      }
    }
  ]
}
```

## Minimum Test Matrix
1. Queued valid JSON pushes and sets `Pushed`.
2. Queued invalid JSON sets `Failed`.
3. Queued invalid temperature/phases sets `Failed`.
4. Newly pushed profile writes back returned machine `id`.
5. Pushed + missing on device re-pushes from Notion.
6. Pushed + drift re-pushes Notion JSON and then syncs `Favorite`/`Selected`.
7. Archived non-utility profile deletes from device.
8. Archived utility profile is not deleted.
9. Unmatched device profile imports as `Draft`.
