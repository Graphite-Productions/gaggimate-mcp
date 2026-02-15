# MCP Profile JSON Validation Specification

## Purpose
This spec defines how the bridge validates `Profile JSON` from Notion before pushing to GaggiMate.

Goal: prevent malformed or unsafe profiles from reaching the machine while keeping Notion AI output predictable.

## Scope
- Source: Notion Profiles DB property `Profile JSON` (text/rich text)
- Trigger: profile page where `Push Status = Queued`
- Consumers:
  - Webhook path: `POST /webhook/notion`
  - Polling fallback: queued profile poller
- On success: push profile to GaggiMate, set `Push Status = Pushed`, set `Last Pushed`
- On validation failure: set `Push Status = Failed`, write concise error details to `Push Error` (or append to `Notes` if `Push Error` is absent)

## Status Semantics
- `Draft`: authoring stage, not pushable
- `Queued`: ready to validate and push
- `Pushed`: successfully on machine
- `Failed`: validation or push failed

Imported profiles discovered from GaggiMate should be written as `Pushed` (not `Draft`).

## Validation Contract

### Input
- `rawJson: string` from Notion `Profile JSON`

### Output
```ts
interface ValidationResult {
  valid: boolean;
  profile?: NormalizedProfile;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface ValidationIssue {
  path: string;      // e.g. "phases[1].pump.pressure"
  code: string;      // e.g. "REQUIRED", "TYPE", "RANGE", "ENUM", "CROSS_FIELD"
  message: string;
  value?: unknown;
}
```

### Processing Order
1. Parse JSON
2. Validate top-level fields
3. Validate each phase
4. Validate cross-field rules
5. Normalize defaults (only after required/typing checks pass)
6. Return `valid` + normalized profile or structured errors

## Canonical Profile Shape (v1)

```ts
interface Profile {
  label: string;
  type: "simple" | "pro";
  description?: string;
  temperature: number;           // celsius
  phases: Phase[];
}

interface Phase {
  name: string;
  phase: "preinfusion" | "brew";
  valve?: 0 | 1;
  duration: number;              // seconds
  temperature?: number;          // 0 means inherit top-level
  transition?: {
    type: "instant" | "linear" | "ease-in" | "ease-out";
    duration: number;
    adaptive?: boolean;
  };
  pump?: {
    target: "pressure" | "flow";
    pressure?: number;
    flow?: number;
  };
  targets?: Array<{
    type: "pressure" | "flow" | "volumetric" | "pumped";
    operator?: "gte" | "lte";
    value: number;
  }>;
}
```

## Required Fields

### Top-Level
- `label`: required string, trimmed length `1..64`
- `type`: required enum: `simple | pro`
- `temperature`: required number
- `phases`: required non-empty array

### Per Phase
- `name`: required string, trimmed length `1..64`
- `phase`: required enum: `preinfusion | brew`
- `duration`: required number
- `pump`: required object
- `pump.target`: required enum: `pressure | flow`

## Range and Safety Rules
- top-level `temperature`: `60..100`
- phase `duration`: `> 0` and `<= 180`
- phase `temperature`:
  - if `0`: inherit top-level
  - else `60..100`
- `pump.pressure` (when provided): `0..15`
- `pump.flow` (when provided):
  - `-1` allowed only for adaptive flow mode
  - otherwise `0..10`
- `targets[].value`: must be numeric and `> 0`

## Cross-Field Rules
- If `pump.target = pressure`:
  - `pump.pressure` must be present and `> 0`
  - `pump.flow` optional limit
- If `pump.target = flow`:
  - `pump.flow` must be present and (`> 0` or `-1`)
  - `pump.pressure` optional limit
- If `transition.type = instant`, `transition.duration` should be `0` (warning if not)
- `phases.length` must be `1..10` (error outside)

## Unsupported / Rejected Values (v1)
Reject these with `ENUM` error:
- transition types not in `instant | linear | ease-in | ease-out`
- pump target not in `pressure | flow`
- target type not in `pressure | flow | volumetric | pumped`

## Normalization Rules
Applied only when `errors.length === 0`.
- `description` default: `""`
- phase `valve` default: `1`
- phase `temperature` default: `0` (inherit)
- phase `transition` default: `{ type: "instant", duration: 0, adaptive: true }`
- `transition.adaptive` default: `true`
- target `operator` default: `gte`

## Error vs Warning
- Error: profile is not pushed; status becomes `Failed`
- Warning: profile is pushable; warning is logged and optionally appended to `Notes`

Warning examples:
- no phase `targets` configured (machine may rely on manual stop)
- temperature at hard boundary (`60` or `100`)
- total profile duration unusually high (e.g. > 120s)

## Notion Writeback Rules
On validation failure:
- set `Push Status = Failed`
- write top 1-3 concise validation errors to `Push Error`
- if `Push Error` property is missing, append message to `Notes`

On success:
- push to GaggiMate
- set `Push Status = Pushed`
- set `Last Pushed = now`

## Webhook and Polling Requirements
Both webhook and poller paths must enforce the same gate:
- Only process pages where current `Push Status == Queued`

This prevents accidental pushes from unrelated edits (e.g. description updates).

## Example Valid JSON
```json
{
  "label": "AI Dial-In v2",
  "type": "pro",
  "description": "Ethiopian natural, slightly finer grind",
  "temperature": 94,
  "phases": [
    {
      "name": "Preinfusion",
      "phase": "preinfusion",
      "duration": 8,
      "pump": { "target": "pressure", "pressure": 3 }
    },
    {
      "name": "Extraction",
      "phase": "brew",
      "duration": 30,
      "pump": { "target": "pressure", "pressure": 9 },
      "targets": [{ "type": "volumetric", "value": 38 }]
    }
  ]
}
```

## Example Invalid JSON
```json
{
  "label": "",
  "type": "advanced",
  "temperature": 140,
  "phases": []
}
```

Expected errors:
- `label` non-empty
- `type` enum
- `temperature` range
- `phases` non-empty

## Test Matrix
Minimum tests:
1. valid pro profile
2. minimal valid profile
3. malformed JSON
4. missing required fields
5. out-of-range values
6. invalid enums
7. cross-field pump invalid combinations
8. unsupported transition/target values
9. normalization defaults applied
10. warnings emitted without blocking push
11. queued-only enforcement in webhook/poller integration tests

## Versioning
- This document is v1.
- If firmware adds fields/modes, update validator and this spec together.
