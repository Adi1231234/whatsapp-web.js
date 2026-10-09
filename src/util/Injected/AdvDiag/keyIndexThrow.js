'use strict';

/**
 * Names the contact a device-sync batch dies on.
 *
 * `handleKeyIndexResultSync` asserts that a contact's device 99 - the hosted
 * device of a business on WhatsApp's Cloud API - carries `isHosted: true`, and
 * throws `Invariant Violation: Minified invariant #76137` when it does not. One
 * such contact aborts the WHOLE batch, and WhatsApp's own log line says only
 * "doPendingDeviceSync failed". This says which contact, and whether the device
 * list it failed on came from the server or from what this computer had
 * stored - the two have different causes.
 *
 * Arguments are read by position from the live call site,
 * `handleKeyIndexResultSync(wid, deviceList, ts, signedBytes, _, localRecord,
 * ...)`, and the callee falls back to `localRecord.devices` exactly when
 * `deviceList` is null. The error is always rethrown unchanged.
 */
const InstallKeyIndexThrowDiag = (eventName, preventedEvent) => {
    const a = window.__p2dAdv;
    if (!a) return false;

    const describe = (args, err) => {
        const incoming = args[1];
        const local = args[5];
        const fromServer = incoming !== null && incoming !== undefined;
        const devices = fromServer ? incoming : local && local.devices;
        const d99 = a.device99(devices);
        const nowS = Date.now() / 1000;
        return {
            user: a.who(args[0]),
            error: (
                String(err && err.name) +
                ': ' +
                String(err && err.message)
            ).slice(0, 200),
            devicesFrom: fromServer ? 'server' : 'stored',
            device99: d99
                ? 'keyIndex=' +
                  d99.keyIndex +
                  ' isHosted=' +
                  (d99.isHosted === true)
                : 'absent',
            storedAgeDays:
                local && local.timestamp
                    ? +((nowS - local.timestamp) / 86400).toFixed(2)
                    : null,
            storedAccountType:
                local && local.advAccountType !== undefined
                    ? local.advAccountType
                    : null,
            at: a.frames(err && err.stack, 1, 3),
        };
    };

    // The proof the fix mattered, asked of WhatsApp itself: for a contact the
    // fix flagged, run WhatsApp's own check again on the record as WhatsApp
    // left it - device 99 without the flag - and see whether it throws. Only
    // stored lists are the fix's doing, so a server-sent list is not re-run.
    // The check computes and returns an update; the re-run discards it, and its
    // only side effects are a repeated log line and an idempotent cache add.
    const counterfactual = (orig, self, args) => {
        const local = args[5];
        const fromServer = args[1] !== null && args[1] !== undefined;
        if (!a.fixed || fromServer || !local || local.deleted) return;
        if (!a.fixed.has(String(args[0]))) return;
        const d99 = a.device99(local.devices);
        if (!d99 || d99.isHosted !== true) return;
        const again = Array.prototype.slice.call(args);
        again[5] = Object.assign({}, local, {
            devices: local.devices.map((d) =>
                d === d99 ? { id: d.id, keyIndex: d.keyIndex } : d,
            ),
        });
        try {
            orig.apply(self, again);
        } catch (err) {
            a.prevented++;
            a.emit(preventedEvent, {
                user: a.who(args[0]),
                keyIndex: d99.keyIndex,
                wouldHaveThrown: (
                    String(err && err.name) +
                    ': ' +
                    String(err && err.message)
                ).slice(0, 200),
            });
        }
    };

    return a.wrap(
        a.req('WAWebHandleAdvKeyIndexResultApi'),
        'handleKeyIndexResultSync',
        (orig) =>
            function () {
                let out;
                try {
                    out = orig.apply(this, arguments);
                } catch (err) {
                    try {
                        a.emit(eventName, describe(arguments, err));
                    } catch (e) {
                        // best-effort diagnostic: never let it break the caller
                    }
                    throw err;
                }
                try {
                    counterfactual(orig, this, arguments);
                } catch (e) {
                    // best-effort diagnostic: never let it break the caller
                }
                return out;
            },
    );
};

module.exports = { InstallKeyIndexThrowDiag };
