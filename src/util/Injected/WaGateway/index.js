'use strict';

const { BINDINGS } = require('./bindings');
const { InstallWaGateway } = require('./install');

/** The event every gateway report carries on the socket-diag channel. */
const WA_GATEWAY_CHECK = 'WA_GATEWAY_CHECK';

/**
 * Installs `window.WaGateway`. Runs first in inject(), before any injected
 * code that reaches WhatsApp, and again on every new document.
 */
async function installWaGateway(page) {
    return page.evaluate(InstallWaGateway, BINDINGS);
}

/**
 * Checks every eager binding against the build the page loaded, once the app
 * has synced and WhatsApp's modules are registered. Reports the result even
 * when nothing is wrong: a check that stays silent cannot be told from one
 * that never ran.
 */
async function checkWaGateway(page, report) {
    const result = await page
        .evaluate(() => (window.WaGateway ? window.WaGateway.check() : null))
        .catch(() => null);
    if (!result) return;
    try {
        report(
            Object.assign({ event: WA_GATEWAY_CHECK, phase: 'load' }, result),
        );
    } catch (ignoredError) {
        // The report is emitted synchronously, from inside the synced phase:
        // a consumer's listener that throws must not abort what follows it.
    }
}

module.exports = { installWaGateway, checkWaGateway, WA_GATEWAY_CHECK };
