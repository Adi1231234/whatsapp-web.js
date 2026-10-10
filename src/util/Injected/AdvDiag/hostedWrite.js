'use strict';

/**
 * Catches the moment a contact's device 99 is stored WITHOUT `isHosted`, and
 * says which code stored it.
 *
 * That record is what later trips invariant #76137 and stalls device sync. Two
 * writers in the live build rebuild a device list from bare
 * `{id, keyIndex}` pairs and so drop the flag (`WAWebHandleAdvNoListResetApi`,
 * `WAWebHandleAdvListResetApi`), while `WAWebHandleAdvKeyIndexResultApi` sets
 * it. Every write to the device-list table goes through exactly two exported
 * functions of `WAWebApiDeviceList` (verified: the table's only write
 * operations in the whole build are reached from those two), so wrapping them
 * sees every bad write - and the caller frames name the writer.
 *
 * Once per contact per page: a rewrite of the same bad record adds nothing.
 */
const InstallHostedWriteDiag = (eventName) => {
    const a = window.__p2dAdv;
    if (!a) return false;
    const api = window.WaGateway.module('WAWebApiDeviceList');
    const seen = new Set();

    // This hook is installed OUTSIDE the HostedDeviceFlag fix, so it sees what
    // WhatsApp tried to store before the fix flags it. With the fix active,
    // every record seen here is one the fix corrected - remembered so a later
    // sync can be checked against WhatsApp's own verdict without it.
    const userWid = (pk) => {
        try {
            const W = window.WaGateway.module('WAWebWidFactory');
            return W.createUserWidFromDeviceListPk(pk).toString();
        } catch (ignoredError) {
            return null;
        }
    };
    const inspect = (record) => {
        if (!record || record.deleted || !a.isBad99(record.devices)) return;
        const fix = window.__p2dHostedFlag;
        const wid = userWid(record.id);
        if (fix && wid && a.fixed) a.fixed.add(wid);
        const user = a.who(record.id);
        if (seen.has(user) || seen.size > 200) return;
        seen.add(user);
        const d99 = a.device99(record.devices);
        a.emit(eventName, {
            user: user,
            keyIndex: d99.keyIndex,
            accountType:
                record.advAccountType !== undefined
                    ? record.advAccountType
                    : null,
            devices: record.devices.length,
            fixActive: !!fix,
            source: fix && fix.repairing ? 'repair' : 'whatsapp',
            // Frame 0 is this wrapper; the writer is a few frames up.
            by: a.frames(new Error().stack, 2, 5),
        });
    };
    const check = (records) => {
        try {
            (Array.isArray(records) ? records : [records]).forEach(inspect);
        } catch (ignoredError) {
            // best-effort diagnostic: never let it break the caller
        }
    };

    const one = a.wrap(
        api,
        'createOrReplaceDeviceRecord',
        (orig) =>
            function (record) {
                check(record);
                return orig.apply(this, arguments);
            },
    );
    const bulk = a.wrap(
        api,
        'bulkCreateOrReplaceDeviceRecord',
        (orig) =>
            function (records) {
                check(records);
                return orig.apply(this, arguments);
            },
    );
    return one && bulk;
};

module.exports = { InstallHostedWriteDiag };
