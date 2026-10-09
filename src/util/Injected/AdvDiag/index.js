'use strict';

const { InstallAdvDiagShared } = require('./shared');
const { InstallAdvFixedSet } = require('./fixedSet');
const { InstallPendingSyncDiag } = require('./pendingSync');
const { InstallPreventedStallVerdict } = require('./preventedStall');
const { InstallKeyIndexThrowDiag } = require('./keyIndexThrow');
const { InstallHostedWriteDiag } = require('./hostedWrite');
const { InstallDailyCheckDiag } = require('./dailyCheck');
const { HOSTED_DEVICE_ID } = require('../HostedDeviceFlag');

/** Event names, as they reach the host's socket-diag channel. */
const ADV_EVENTS = {
    INSTALLED: 'ADV_DIAG_INSTALLED',
    PENDING_SYNC: 'ADV_PENDING_SYNC',
    KEY_INDEX_THROW: 'ADV_KEY_INDEX_THROW',
    HOSTED_WRITE: 'ADV_HOSTED_WRITE_WITHOUT_FLAG',
    DAILY_CHECK: 'ADV_DAILY_CHECK',
    // What the HostedDeviceFlag fix prevented, in WhatsApp's own words.
    FIX_PREVENTED_THROW: 'ADV_FIX_PREVENTED_THROW',
    FIX_PREVENTED_STALL: 'ADV_FIX_PREVENTED_STALL',
};

const DAY_S = 86400;
/** The daily check's second clock: a newer own list announced, not received. */
const EXPECTED_TS_CLOCK_H = 25;
/** Where the contacts the fix flagged are remembered, and how many. */
const FIXED_KEY = '__p2dAdvFixed';
const FIXED_MAX = 500;

const HOOKS = [
    [
        'preventedStall',
        InstallPreventedStallVerdict,
        [ADV_EVENTS.FIX_PREVENTED_STALL, EXPECTED_TS_CLOCK_H],
    ],
    ['pendingSync', InstallPendingSyncDiag, [ADV_EVENTS.PENDING_SYNC]],
    [
        'keyIndexThrow',
        InstallKeyIndexThrowDiag,
        [ADV_EVENTS.KEY_INDEX_THROW, ADV_EVENTS.FIX_PREVENTED_THROW],
    ],
    ['hostedWrite', InstallHostedWriteDiag, [ADV_EVENTS.HOSTED_WRITE]],
    [
        'dailyCheck',
        InstallDailyCheckDiag,
        [ADV_EVENTS.DAILY_CHECK, EXPECTED_TS_CLOCK_H],
    ],
];

/**
 * Installs every hook that is not installed yet and reports which are live.
 *
 * Called twice per page - early in inject() and again once the app has synced
 * - because a module WhatsApp has not loaded yet cannot be wrapped, and a hook
 * that silently failed to install would make its silence read as a clean bill
 * of health. Each hook is idempotent, so the second call only fills gaps.
 */
async function installAdvDiag(page, phase, report) {
    const status = { phase: phase };
    try {
        await page.evaluate(InstallAdvDiagShared, HOSTED_DEVICE_ID, DAY_S);
        status.fixedSet = await page
            .evaluate(InstallAdvFixedSet, FIXED_KEY, FIXED_MAX)
            .catch(() => false);
        for (const [name, fn, args] of HOOKS) {
            status[name] = await page.evaluate(fn, ...args).catch(() => false);
        }
    } catch (e) {
        status.error = String((e && e.message) || e).slice(0, 200);
    }
    report(Object.assign({ event: ADV_EVENTS.INSTALLED }, status));
}

module.exports = { installAdvDiag, ADV_EVENTS };
