'use strict';

const { InstallAdvDiagShared } = require('./shared');
const { InstallPendingSyncDiag } = require('./pendingSync');
const { InstallKeyIndexThrowDiag } = require('./keyIndexThrow');
const { InstallHostedWriteDiag } = require('./hostedWrite');
const { InstallDailyCheckDiag } = require('./dailyCheck');

/** Event names, as they reach the host's socket-diag channel. */
const ADV_EVENTS = {
    INSTALLED: 'ADV_DIAG_INSTALLED',
    PENDING_SYNC: 'ADV_PENDING_SYNC',
    KEY_INDEX_THROW: 'ADV_KEY_INDEX_THROW',
    HOSTED_WRITE: 'ADV_HOSTED_WRITE_WITHOUT_FLAG',
    DAILY_CHECK: 'ADV_DAILY_CHECK',
};

/** WhatsApp's id for a Cloud API business's hosted device. */
const HOSTED_DEVICE_ID = 99;
const DAY_S = 86400;
/** The daily check's second clock: a newer own list announced, not received. */
const EXPECTED_TS_CLOCK_H = 25;

const HOOKS = [
    ['pendingSync', InstallPendingSyncDiag, [ADV_EVENTS.PENDING_SYNC]],
    ['keyIndexThrow', InstallKeyIndexThrowDiag, [ADV_EVENTS.KEY_INDEX_THROW]],
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
        for (const [name, fn, args] of HOOKS) {
            status[name] = await page.evaluate(fn, ...args).catch(() => false);
        }
    } catch (e) {
        status.error = String((e && e.message) || e).slice(0, 200);
    }
    report(Object.assign({ event: ADV_EVENTS.INSTALLED }, status));
}

module.exports = { installAdvDiag, ADV_EVENTS, HOSTED_DEVICE_ID };
