# HostedDeviceFlag

Stops one bad device-list record from stalling WhatsApp's device sync - and,
through it, from logging an account out.

## The bug, in WhatsApp's own code

Device 99 is the hosted device of a business on WhatsApp's Cloud API.

- `WAWebHandleAdvKeyIndexResultApi` stores it with `isHosted: true`, and on every
  later sync asserts that flag (`Invariant Violation: Minified invariant #76137`).
- `WAWebHandleAdvNoListResetApi` and `WAWebHandleAdvListResetApi` rebuild a
  contact's list from bare `{id, keyIndex}` pairs and drop the flag.

The next sync that touches such a contact throws, the whole pending
device-sync batch fails, and the queue never drains. Every contact in it stops
receiving newer device lists - this account's own number included - and an own
list starved for 25 hours is a forced logout wherever WhatsApp's
`web_adv_logout_on_self_device_list_expired` flag is on (2026-10-09, a shop).

## The fix

- **Write path.** Every write to the device-list table goes through the two
  exported `WAWebApiDeviceList` writers (verified across the live build), so
  both are wrapped and device 99 is stored flagged, on a copy of the record.
- **Repair once synced.** Records written before the wrapper existed are found
  with `getAllDeviceLists`, rewritten through the wrapped writer, and counted
  again, so the report is what is left, not what was attempted.

Setting the flag changes nothing else: WhatsApp addresses device 99 as
`…:99@hosted.lid` whether the flag is set or not (measured on the live build).

## Verified on a live account (2026-10-09)

A real contact stored as `[99:1, 0:0]` without the flag (`4580@c.us`, a hosted
account, 20 days old), put in the pending queue alone:

- before: the sync threw invariant #76137, the queue stayed 1 -> 1;
- after flagging device 99: the sync passed, the queue went 1 -> 0, and the
  contact's newer list arrived (signed an hour earlier instead of 20 days).
