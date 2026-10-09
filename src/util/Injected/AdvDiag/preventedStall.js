'use strict';

/**
 * What a drain that passed only because of the HostedDeviceFlag fix would have
 * meant without it. Installed on `window.__p2dAdv` for the pending-sync hook to
 * call, so that hook only measures the queue.
 *
 * Without the fix the batch keeps throwing, so the own list waits in the queue
 * and never arrives. The daily check (`getUsersForExpiration`) then expires it
 * on whichever of two clocks runs out first: the list's age against
 * `num_days_key_index_list_expiration`, and the hours since a newer list was
 * announced against 25 - a clock that only runs once one was announced
 * (`expectedTsUpdateTs` set). Where the AB flag is on, that expiry is a logout.
 *
 * The logout waits for the first daily check after the clock runs out, and
 * only happens if the stall has not ended first, so `logoutInHours` is the
 * earliest it could have come, not a prediction that it would have.
 */
const InstallPreventedStallVerdict = (eventName, expectedTsClockH) => {
    const a = window.__p2dAdv;
    if (!a) return false;

    /** The first clock's length, read the way the daily check reads it. */
    const expiryDays = () => {
        const job = a.req('WAWebAdvDeviceInfoCheckJob');
        const Bridge = job && job.AdvToSystemBridgeImpl;
        return Bridge ? new Bridge().getNumDaysKeyIndexListExpiration() : null;
    };

    /** The running clock that runs out first, and in how many hours. */
    const firstClock = (o, days) => {
        if (!o.ownKnown || days == null) return null;
        const clocks = [[days + 'd', (days - o.ownAgeDays) * 24]];
        if (o.ownHoursSinceAnnounced != null) {
            clocks.push([
                expectedTsClockH + 'h',
                expectedTsClockH - o.ownHoursSinceAnnounced,
            ]);
        }
        clocks.sort((x, y) => x[1] - y[1]);
        return {
            name: clocks[0][0],
            inHours: +Math.max(0, clocks[0][1]).toFixed(1),
        };
    };

    const consequence = (ownQueued, gate, clock) => {
        if (!ownQueued) return 'batch stalled; own number not waiting';
        if (gate !== true) return 'own list stuck; no logout on this account';
        if (!clock) return 'own list stuck; own clocks unreadable';
        return (
            'own list stuck; logout once its ' + clock.name + ' clock runs out'
        );
    };

    /** `ownClocks` is read when the attempt started: a drain clears them. */
    a.reportPreventedStall = async (ownQueued, prevented, ownClocks) => {
        const o = (await ownClocks) || {};
        const gate = a.logoutGate();
        const days = expiryDays();
        const clock = ownQueued && gate === true ? firstClock(o, days) : null;
        a.emit(eventName, {
            preventedThrows: prevented,
            ownQueued: ownQueued,
            ownAgeDays: o.ownKnown ? o.ownAgeDays : null,
            expiryDays: days,
            ownNewerAnnounced: o.ownNewerAnnounced === true,
            ownHoursSinceAnnounced:
                o.ownHoursSinceAnnounced == null
                    ? null
                    : o.ownHoursSinceAnnounced,
            logoutGate: gate,
            logoutClock: clock ? clock.name : null,
            logoutInHours: clock ? clock.inHours : null,
            withoutFix: consequence(ownQueued, gate, clock),
        });
    };
    return true;
};

module.exports = { InstallPreventedStallVerdict };
