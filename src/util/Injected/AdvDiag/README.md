# AdvDiag

Evidence for one failure chain, end to end, from WhatsApp's own functions:

1. A Cloud API business contact is stored with device 99 lacking `isHosted`.
2. `handleKeyIndexResultSync` throws invariant #76137 on it and the whole
   pending device-sync batch fails, so the queue never drains.
3. This account's own number waits in that queue for a newer list of its own.
4. The daily device check expires the own list on the 25h clock and, where
   the AB flag `web_adv_logout_on_self_device_list_expired` is on, logs out.

Each step has its own event on the socket-diag channel (`[wwjs-diag]
SOCKET_DIAG`, info level, so it reaches GCP on every machine):

- `ADV_HOSTED_WRITE_WITHOUT_FLAG` - step 1: who, and the writer's frames.
- `ADV_KEY_INDEX_THROW` - step 2: who the batch died on, and whether the list
  came from the server or from what was stored.
- `ADV_PENDING_SYNC` - steps 2-3: queue size before and after an attempt,
  `drained`, and `ownQueued`. Silent when nothing was waiting.
- `ADV_DAILY_CHECK` - step 4 and the way out: the own list on both clocks
  (`ownAgeDays` against 35, `ownHoursSinceAnnounced` against 25),
  `ownExpired` naming the clock that fired, and `expiredBad99` - the
  unflagged contacts this run expires, whose records it then clears.
- `ADV_DIAG_INSTALLED` - which hooks are live, twice per page (inject and
  synced). A missing hook must not read as a quiet machine.

What the HostedDeviceFlag fix prevented, asked of WhatsApp itself:

- `ADV_FIX_PREVENTED_THROW` - for a contact the fix flagged (remembered in
  `localStorage` across page loads), WhatsApp's own check is re-run on the
  record as WhatsApp left it, and it threw. Only fires when WhatsApp actually
  ran that check on a stored list, so a contact it never checked counts for
  nothing.
- `ADV_FIX_PREVENTED_STALL` - a drain that passed only because of it, and what
  it would have meant: `withoutFix` says whether our own number was waiting,
  whether this account logs out when its list expires, and if so which of the
  daily check's two clocks runs out first (`logoutClock`) and in how many hours
  (`logoutInHours`). The 25h clock only runs once a newer own list has been
  announced; until then only the age clock does. The logout waits for the next
  daily check and needs the stall to last that long, so `logoutInHours` is the
  earliest it could have come.

Verified live: a hosted contact stored unflagged, then given a newer signature
by the server, passed the real check with the fix while the re-run threw
#76137; the drain went 1 -> 0 and both events fired.

Users are masked the way WhatsApp's `toLogString` masks them.

## Verified on a live stalled shop (2026-10-09)

Installed by hand on a machine whose queue held 2,850 users including its own
number, then the daily check's read and one drain attempt:

- `ADV_KEY_INDEX_THROW` `0996@lid`, `devicesFrom: stored`,
  `keyIndex=6 isHosted=false`, stored 4.34 days earlier, account type hosted.
- `ADV_PENDING_SYNC` 2850 -> 2850, `drained: false`, `ownQueued: true`.
- `ADV_DAILY_CHECK` 674 contacts expired, 4 of them unflagged - including
  `0996@lid`, only 4 days old, so on the 25h clock: a stalled batch starves
  its own contacts of their newer lists until the daily check expires them.

The same machine's first boot with the fix shipped: the repair found 10
unflagged records and left 0, `ADV_FIX_PREVENTED_THROW` fired 8 times
(`0996@lid` among them), and `ADV_PENDING_SYNC` went 2850 -> 0 in 27s with
`ownQueued: true`. Its `ADV_FIX_PREVENTED_STALL` had no newer own list
announced, so only the age clock was running - which is why the event names
the clock: it first said "25h" in every case.

## Reading it

```
jsonPayload.message="[wwjs-diag] SOCKET_DIAG" AND jsonPayload.properties.event=~"^ADV_"
```
