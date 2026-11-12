'use strict';

/**
 * What inject() needs from WhatsApp before it can touch the page.
 *
 * `window.Debug` is set before these are all ready, and WhatsApp's login entry
 * (`/login/`) sets it too while never loading them at all: measured on build
 * 2.3000.1054073855, a logged-out page there draws its own QR with
 * WAWebSocketModel and WAWebStreamModel listed but not loaded (`require`
 * answers null), and `requireLazy` on them had not called back after 120s.
 * `/` on the same browser profile loads them at once.
 *
 * Only what a connection cannot do without is waited for, and a module that
 * never arrives stops inject. Anything else is exposed when present: if
 * WhatsApp renamed it, a hard wait would keep every account from connecting,
 * so the gateway's load check names it instead and nobody is stopped.
 */

/** The socket, its wait, and the lifecycle: waited for on every page. */
const REQUIRED_TO_CONNECT = [
    'WAWebSocketModel',
    'WAWebSocketConstants',
    'WAWebEventsWaitForBbEvent',
    'WAWebCmd',
    'WAWebStreamModel',
];

/** What a QR is made of: waited for only when one is shown. */
const REQUIRED_FOR_QR = [
    'WAWebConnModel',
    'WABase64',
    'WAWebCompanionRegClientUtils',
    'WAWebUserPrefsInfoStore',
    'WAWebSignalStoreApi',
    'WAWebUserPrefsMultiDevice',
];

/** In AuthStore for its readers, never waited for. */
const EXPOSED_WHEN_PRESENT = [
    'WAWebOfflineHandler',
    'WAWebAltDeviceLinkingApi',
    'WAWebAdvSignatureApi',
];

/** WhatsApp's own test for its login entry, from WAWebURLUtils. */
const isLoginEntry = (url) => {
    let pathname;
    try {
        pathname = new URL(url).pathname;
    } catch (ignoredError) {
        return false;
    }
    return pathname === '/login' || pathname.startsWith('/login/');
};

/** The one error inject() raises when required modules never arrived. */
const modulesUnavailable = (missing, url, build) =>
    new Error(
        'WhatsApp app modules unavailable: ' +
            missing.map((m) => `${m.module} (${m.state})`).join(', ') +
            ` on ${url} (build ${build})`,
    );

module.exports = {
    REQUIRED_TO_CONNECT,
    REQUIRED_FOR_QR,
    EXPOSED_WHEN_PRESENT,
    isLoginEntry,
    modulesUnavailable,
};
