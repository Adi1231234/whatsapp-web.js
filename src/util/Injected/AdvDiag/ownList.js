'use strict';

/**
 * This account's own device list: once when the app syncs, and again after
 * every write that changes it.
 *
 * The phone signs the list on every link and unlink. `keyIndex` counts links
 * and starts again at 1 under a new `rawId` when the phone registers WhatsApp
 * again, which also logs out every linked device. So two of these lines, one
 * before a link ended and one after the next link, tell a re-registration
 * (new `rawId`) from a removal on the phone (same `rawId`, this device gone).
 *
 * Writes are seen through the two exports every device-list write goes
 * through (see hostedWrite.js), under an owner of its own so that hook's wrap
 * is not taken for this one. The list is read back after the write resolves.
 */
const InstallOwnListDiag = (eventName) => {
    const a = window.__p2dAdv;
    if (!a) return false;
    const api = window.WaGateway.module('WAWebApiDeviceList');
    const me = window.WaGateway.module('WAWebUserPrefsMeUser');
    if (!api || !me) return false;
    let lastWrite = null;

    /** Whether a line went out: none before registration, or for no change. */
    const report = async (trigger) => {
        const users = a.ownUsers();
        if (!users.length) return false;
        const recs = await api.bulkGetDeviceRecord(users);
        const r = recs.find((x) => x && !x.deleted);
        if (!r) return false;
        const companions = r.devices
            .filter((d) => d.id !== 0)
            .sort((x, y) => x.keyIndex - y.keyIndex);
        const devices = companions
            .map((d) => d.id + ':' + d.keyIndex)
            .join(' ');
        const signature = [r.rawId, r.timestamp, devices].join('|');
        if (trigger === 'write' && signature === lastWrite) return false;
        lastWrite = signature;
        const meId = me.getMaybeMeDeviceId();
        const ours = companions.find((d) => d.id === meId);
        a.emit(eventName, {
            trigger: trigger,
            // The phone user when there is one (ownUsers puts it first),
            // masked: enough to tell two accounts apart.
            user: a.who(users[0]),
            me: meId,
            meKeyIndex: ours ? ours.keyIndex : null,
            rawId: r.rawId,
            currentIndex: r.currentIndex,
            signedAt: r.timestamp,
            companions: companions.length,
            devices: devices,
        });
        return true;
    };
    a.reportOwnList = (trigger) => report(trigger).catch(() => false);

    const touchesOwn = (records) => {
        try {
            const list = Array.isArray(records) ? records : [records];
            const isOwn = a.ownIdMatcher();
            return list.some((rec) => rec && isOwn(rec.id));
        } catch (ignoredError) {
            return false;
        }
    };
    const after = (orig) =>
        function (records) {
            const ret = orig.apply(this, arguments);
            if (touchesOwn(records)) {
                Promise.resolve(ret)
                    .then(() => a.reportOwnList('write'))
                    .catch(() => {});
            }
            return ret;
        };
    const wrap = (key) => window.WaGateway.wrap('AdvOwnList', api, key, after);
    const one = wrap('createOrReplaceDeviceRecord');
    const bulk = wrap('bulkCreateOrReplaceDeviceRecord');
    return one && bulk;
};

/** One line for the list as it stands, once the app has synced: sent or not. */
const ReportOwnList = () =>
    !!(window.__p2dAdv && window.__p2dAdv.reportOwnList) &&
    window.__p2dAdv.reportOwnList('sync');

module.exports = { InstallOwnListDiag, ReportOwnList };
