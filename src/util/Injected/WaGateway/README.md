# WaGateway

The one door to WhatsApp Web's internal modules.

WhatsApp ships several builds a day and none of its internals are a public
API. A module moves, an export is deleted, a function gains a parameter, and
code that reached for it breaks without an error. Knowing exactly what this
library depends on is what lets such a change be caught the moment a page
loads the build that carries it.

## The pieces

- `bindings.js` - every module, export and member reached through the
  gateway, declared once. It is the whole list.
- `install.js` - `window.WaGateway`, the only code that calls
  `window.require`:
    - `module(name)` returns the module exactly as `window.require` does. It
      never throws: a module whose factory throws reads as missing.
    - `check()` checks every eager binding against the build the page loaded:
      the module exists, each export exists and has the declared kind, the
      argument count matches where one is declared, and each declared member is
      on the value or on its class's prototype.
- `index.js` - `installWaGateway(page)`, first in `inject()`, and
  `checkWaGateway(page, report)`, once the app has synced.

## What is reported

Everything goes out as `WA_GATEWAY_CHECK` on the socket-diag channel, and the
client also emits it on `diag` at `info`:

- `phase: 'load'` - once per page load, with `build`, `checked` and
  `problems`. It is sent even when `problems` is empty: a check that stays
  silent cannot be told from one that never ran.
- `phase: 'use'` - a lazy binding broken on its first use, or a module asked
  for that `bindings.js` does not declare (`undeclared`, once per name).

A problem is `{ module, export?, problem, ... }` with `problem` one of
`module-missing`, `module-throws`, `export-missing`, `not-a-function`,
`arity`, `member-missing`, `undeclared`.

## What keeps the list complete

- ESLint forbids reading `require` off any object (so `window.require`, an
  alias of `window`, `globalThis.require` and a destructured `require` alike),
  `window.injectToFunction`, and a bare `require('WA…')`, anywhere in `src/`
  except `install.js`. The lookups that predate the gateway are recorded in
  `eslint-suppressions.json` at the repo root. A new one fails the lint, even
  in a file that already has suppressed ones. Moving one behind the gateway
  makes the lint ask for `npx eslint . --prune-suppressions`, so the file only
  ever shrinks.
- `tests/unit/waGateway/declared.js` fails when code asks the gateway for a
  module `bindings.js` does not declare, when a declared module is no longer
  asked for, when a name is not written out in full, or when the gateway is
  reached through an alias that would hide the name from these checks.

## Adding a dependency

1. Ask the gateway: `window.WaGateway.module('WAWebSomething')`.
2. Declare it in `bindings.js`: the exports you use, `arity` only if you read
   arguments by position, `members` you read off the value.
3. Check the declaration against a live page before relying on it.

## What it cannot see

- Fields of the data WhatsApp returns, such as a device-list record's
  `devices`.
- The object a call returns, such as the line `WALogger.ERROR` returns and its
  `catching`. Checking it would mean calling the function.
- Behaviour: an export that still exists but does something else.
- Argument counts are only compared where declared. A transpiled async
  function reports `length` 0, so an undeclared count is not a signal.

Checked against build 2.3000.1049833609 on 2026-10-09: every binding present,
`handleKeyIndexResultSync.length === 9`.
