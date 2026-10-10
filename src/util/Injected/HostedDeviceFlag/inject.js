'use strict';

/**
 * Keeps a hosted contact's device 99 flagged `isHosted: true` in the
 * device-list table, which is what WhatsApp's own code requires of it.
 *
 * Device 99 is the hosted device of a business on WhatsApp's Cloud API.
 * `WAWebHandleAdvKeyIndexResultApi` stores it with `isHosted: true` and asserts
 * the flag on every later sync (invariant #76137). Two other writers in the same
 * build rebuild a list from bare `{id, keyIndex}` pairs and drop it -
 * `WAWebHandleAdvNoListResetApi` and `WAWebHandleAdvListResetApi`. The next sync
 * that touches such a contact throws, the whole pending device-sync batch fails,
 * and the queue never drains: every contact in it, this account's own number
 * included, stops receiving newer device lists, and an own list starved for 25h
 * is a forced logout where WhatsApp's self-expiry flag is on.
 *
 * The fix is at the one place both writers meet: every write to the table goes
 * through the two exported `WAWebApiDeviceList` writers (verified across the
 * live build), so a record is corrected on its way in. Setting the flag changes
 * nothing else - WhatsApp addresses device 99 as `…:99@hosted.lid` whether the
 * flag is set or not (measured) - it only stops the assertion from firing.
 *
 * Every value the injected functions need is a PARAMETER: `pupPage.evaluate`
 * serialises the function alone.
 */

/** Wraps the two writers so device 99 is always stored flagged. */
const InjectHostedDeviceFlag = (hostedDeviceId) => {
    const api = window.WaGateway.module('WAWebApiDeviceList');
    if (!api) return false;

    const isUnflagged = (d) =>
        !!d && d.id === hostedDeviceId && d.isHosted !== true;
    const needsFlag = (record) =>
        !!record &&
        !record.deleted &&
        Array.isArray(record.devices) &&
        record.devices.some(isUnflagged);
    // A corrected copy: the caller's object is WhatsApp's, not ours to mutate.
    const flagged = (record) =>
        needsFlag(record)
            ? Object.assign({}, record, {
                  devices: record.devices.map((d) =>
                      isUnflagged(d)
                          ? Object.assign({}, d, { isHosted: true })
                          : d,
                  ),
              })
            : record;

    const wrap = (key, map) => {
        const orig = api[key];
        if (typeof orig !== 'function') return false;
        if (orig.__p2dHostedFlag) return true;
        const wrapped = function (arg) {
            let fixed = arg;
            try {
                fixed = map(arg);
            } catch (ignoredError) {
                // never let the correction break the write itself
            }
            const rest = Array.prototype.slice.call(arguments, 1);
            return orig.apply(this, [fixed].concat(rest));
        };
        window.WaGateway.keepShape(wrapped, orig);
        wrapped.__p2dHostedFlag = true;
        api[key] = wrapped;
        return true;
    };

    const one = wrap('createOrReplaceDeviceRecord', flagged);
    const bulk = wrap('bulkCreateOrReplaceDeviceRecord', (records) =>
        Array.isArray(records) ? records.map(flagged) : records,
    );
    window.__p2dHostedFlag = { needsFlag: needsFlag };
    return one && bulk;
};

/**
 * Corrects records already stored without the flag. The wrapper only sees
 * writes from now on, and the records that stall a queue were written days
 * earlier. They are rewritten through the exported writer - so the wrapper
 * flags them and WhatsApp's in-memory caches follow - then counted again, so
 * the report says what is left rather than what was attempted.
 */
const RepairHostedDeviceFlag = async () => {
    const api = window.WaGateway.module('WAWebApiDeviceList');
    const fix = window.__p2dHostedFlag;
    if (!api || !fix) return { found: null };
    const unflagged = async () =>
        (await api.getAllDeviceLists()).filter(fix.needsFlag);
    const found = await unflagged();
    if (found.length) {
        // Lets an outer observer tell this pass from WhatsApp's own writes.
        fix.repairing = true;
        try {
            await api.bulkCreateOrReplaceDeviceRecord(found);
        } finally {
            fix.repairing = false;
        }
    }
    return {
        found: found.length,
        remaining: found.length ? (await unflagged()).length : 0,
    };
};

module.exports = { InjectHostedDeviceFlag, RepairHostedDeviceFlag };
