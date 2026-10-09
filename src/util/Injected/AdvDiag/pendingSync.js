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
 * Silent when nothing was waiting, which is the healthy steady state.
 */
const InstallPendingSyncDiag = (eventName) => {
    const a = window.__p2dAdv;
    if (!a) return false;
    const table = () => {
        const s = a.req('WAWebSchemaPendingDeviceSync');
        return s ? s.getTable() : null;
    };
    const snapshot = async () => {
        const rows = await table().all();
        return {
            n: rows.length,
            own: rows.some((r) => a.isOwnId(r.id)),
        };
    };

    return a.wrap(
        a.req('WAWebApiPendingDeviceSync'),
        'doPendingDeviceSync',
        (orig) =>
            function () {
                const startedAt = Date.now();
                let before = null;
                try {
                    // Read alongside the attempt, never ahead of it: delaying
                    // WhatsApp's own call is not ours to do.
                    before = snapshot().catch(() => null);
                } catch (e) {
                    // best-effort diagnostic: never let it break the caller
                }
                const ret = orig.apply(this, arguments);
                Promise.resolve(ret)
                    .then(
                        () => null,
                        () => null,
                    )
                    .then(async () => {
                        const b = await before;
                        if (!b || b.n === 0) return;
                        const after = await snapshot().catch(() => null);
                        a.emit(eventName, {
                            before: b.n,
                            after: after ? after.n : null,
                            drained: !!after && after.n < b.n,
                            ownQueued: b.own,
                            ms: Date.now() - startedAt,
                        });
                    })
                    .catch(() => {});
                return ret;
            },
    );
};

module.exports = { InstallPendingSyncDiag };
