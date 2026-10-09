'use strict';

/**
 * One line per attempt to drain WhatsApp's pending device-sync queue: how many
 * users were waiting, whether this account's own number was among them, and
 * whether the attempt emptied it.
 *
 * `doPendingDeviceSync` swallows its own failure and keeps every row, so the
 * only proof an attempt failed is that the queue is no smaller afterwards. That
 * is measured here rather than inferred, because the queue only ever loses rows
 * after a fully successful attempt (verified across the live build: its one
 * `bulkRemove` sits after the sync and the campaign cleanup).
 *
 * When an attempt drained only because the HostedDeviceFlag fix was there -
 * WhatsApp's own check, re-run on a contact as WhatsApp had left it, threw
 * during this attempt - it is handed to `reportPreventedStall`
 * (preventedStall.js), which says what it would have meant without the fix.
 *
 * Silent when nothing was waiting, which is the healthy steady state.
 */
const InstallPendingSyncDiag = (eventName) => {
    const a = window.__p2dAdv;
    if (!a) return false;
    const table = () => a.req('WAWebSchemaPendingDeviceSync').getTable();
    const snapshot = async () => {
        const rows = await table().all();
        return { n: rows.length, own: rows.some((r) => a.isOwnId(r.id)) };
    };

    const report = async (before, own, preventedFrom, startedAt) => {
        const b = await before;
        if (!b || b.n === 0) return;
        const after = await snapshot().catch(() => null);
        const drained = !!after && after.n < b.n;
        const prevented = (a.prevented || 0) - preventedFrom;
        a.emit(eventName, {
            before: b.n,
            after: after ? after.n : null,
            drained: drained,
            ownQueued: b.own,
            preventedThrows: prevented,
            ms: Date.now() - startedAt,
        });
        if (!drained || prevented <= 0 || !a.reportPreventedStall) return;
        await a.reportPreventedStall(b.own, prevented, own);
    };

    return a.wrap(
        a.req('WAWebApiPendingDeviceSync'),
        'doPendingDeviceSync',
        (orig) =>
            function () {
                const startedAt = Date.now();
                let before = null;
                let own = null;
                const preventedFrom = a.prevented || 0;
                try {
                    // Read alongside the attempt, never ahead of it: delaying
                    // WhatsApp's own call is not ours to do. The own clocks are
                    // read now because a drain that succeeds clears them.
                    before = snapshot().catch(() => null);
                    own = a.ownClocks(startedAt / 1000).catch(() => null);
                } catch (e) {
                    // best-effort diagnostic: never let it break the caller
                }
                const ret = orig.apply(this, arguments);
                Promise.resolve(ret)
                    .then(
                        () => null,
                        () => null,
                    )
                    .then(() => report(before, own, preventedFrom, startedAt))
                    .catch(() => {});
                return ret;
            },
    );
};

module.exports = { InstallPendingSyncDiag };
