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
    - `whenReady(names, timeoutMs)` settles once WhatsApp's loader has every
      named module ready, through its own `requireLazy` callback, so nothing
      asks `require` again until it answers. `require` answers null for a
      module that is listed but not ready (its code not loaded, or it threw),
      and undefined for one the page never heard of. When the time runs out it
      asks each module once, since the loader may still hold its callback in
      its scheduler: all of them there is ready, otherwise it names each
      missing one as `not-loaded` or `unknown`. WhatsApp sets `window.Debug`
      before inject's modules are all ready, and its logged-out app never
      loads the socket model at all (measured on 2.3000.1054073855).
    - `check()` checks every eager binding against the build the page loaded:
      the module exists, each export exists and has the declared kind, the
      argument count matches where one is declared, and each declared member is
      on the value or on its class's prototype.
    - `keepShape(wrapper, original)` gives a wrapper the original's `length`,
      so `check()` reads WhatsApp's argument count through it.
    - `wrap(owner, target, key, factory)` puts a wrapper over a WhatsApp
      function once per owner for the life of the page. It remembers who
      wrapped what itself: when HostedDeviceFlag and AdvDiag each read a marker
      off the outermost function, each took the other's wrapper for "not
      installed" and wrapped again on every install (inject and synced both
      install), and a write landing while the fix was outermost never reached
      the diagnostic.
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
4. If inject() cannot go on without it, add it to a list in
   `util/AppModules.js`, which says which kind waits and which only exposes.

## What inject() waits for

WhatsApp Web is two apps, told apart by the bootstrap that loaded
(`IsLoggedOutApp` in `util/AppModules.js`): the app runs a session, and the
logged-out app at `/login/` only links a device. WhatsApp's server sends a
logged-out browser to the latter by a cookie, every time, so inject never
leaves it. `util/AppModules.js` sorts every module inject() reads early into
lists:

- `REQUIRED_TO_CONNECT` (socket, its wait, Cmd, the stream) is waited for on
  every page of the app, and a module that never arrives stops inject with the
  reason.
- `REQUIRED_ON_LOGGED_OUT_APP` (the event bus, the socket states, the wait) is
  its counterpart on the logged-out app, which has no socket model: the bus is
  where the model takes its state from, and there it is the only place.
- `REQUIRED_FOR_QR` is waited for only when a QR is shown, on either app, so a
  paired session never waits for the pieces of a QR.
- `EXPOSED_WHEN_PRESENT` is never waited for. If WhatsApp renamed one, a wait
  on it would keep every account from connecting; the load check names it
  instead. A module that nothing reads by name, or only an optional feature
  uses, belongs here.

On the logged-out app inject shows the QR and refreshes it, and nothing else:
it does not pair by phone number, and a page that settles on anything but a QR
stops inject with the state. A scan there navigates to `/` without a word on
the way, so the next inject reports it as a loading screen when it finds the
session.

Known, and left as it is:

- **An inject started by the `framenavigated` handler swallows its failure.**
  The handler only logs it, so a navigation WhatsApp makes by itself that ends
  in a failed inject leaves the caller with a page that never becomes ready,
  until its own timeouts act. The client's first inject is not affected; the
  page a scan on the logged-out app lands on is. Revisit if a page stays
  unready after `[wwjs-diag] framenavigated:inject END (error)`.

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
