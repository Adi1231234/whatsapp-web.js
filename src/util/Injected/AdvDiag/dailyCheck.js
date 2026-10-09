'use strict';

/**
 * One line per run of WhatsApp's daily device check (`WAWebAdvDeviceInfoCheckJob`),
 * the job that both expires contacts' stored device lists and, behind the AB
 * flag `web_adv_logout_on_self_device_list_expired`, logs this computer out
 * when its OWN list has expired.
 *
 * It answers the two questions a stalled device sync leaves open:
 *
 * - How close is a forced logout? The own list's position on both clocks the
 *   job applies (days since the phone signed it, against 35; hours since a
 *   newer one was announced and did not arrive, against 25), and which clock
 *   fired when it does.
 * - How does a stall end? Contacts whose stored device 99 lacks `isHosted` -
 *   the records that trip invariant #76137 - that this run expires. Expired
 *   contacts' records are cleared (`removeCompanions`) unless the run logs out
 *   instead, so a stalled queue that drains right after a run that expired the
 *   failing contact ends exactly that way.
 */
const InstallDailyCheckDiag = (eventName, expiryClockH) => {
    const a = window.__p2dAdv;
    if (!a) return false;
    const job = a.req('WAWebAdvDeviceInfoCheckJob');
    const proto =
        job && job.AdvToSystemBridgeImpl && job.AdvToSystemBridgeImpl.prototype;

    const report = async (bridge, nowS, result) => {
        const days = bridge.getNumDaysKeyIndexListExpiration();
        const expired = result.usersExpired;
        let ownClock = null;
        const expiredBad99 = [];
        expired.forEach((record, wid) => {
            if (a.isOwnId(wid)) {
                ownClock =
                    nowS - record.timestamp >= days * 86400
                        ? days + 'd'
                        : expiryClockH + 'h';
            } else if (a.isBad99(record.devices)) {
                expiredBad99.push(a.who(wid));
            }
        });
        a.emit(
            eventName,
            Object.assign(
                {
                    expired: expired.size,
                    closeToExpiry: result.usersCloseToExpiration.size,
                    ownExpired: ownClock,
                    logoutGate: a.logoutGate(),
                    expiryDays: days,
                    expiredBad99Count: expiredBad99.length,
                    expiredBad99: expiredBad99.slice(0, 10).join(','),
                },
                await a.ownClocks(nowS),
            ),
        );
    };

    return a.wrap(
        proto,
        'getUsersForExpiration',
        (orig) =>
            function (nowS) {
                const ret = orig.apply(this, arguments);
                const bridge = this;
                Promise.resolve(ret)
                    .then((result) => report(bridge, nowS, result))
                    .catch(() => {});
                return ret;
            },
    );
};

module.exports = { InstallDailyCheckDiag };
