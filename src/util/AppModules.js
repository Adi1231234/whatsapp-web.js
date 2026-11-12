'use strict';

/**
 * What inject() needs from WhatsApp before it can touch the page.
 *
 * WhatsApp Web is two apps, and the server decides which one a page gets.
 * The app (WAWebAppBootstrap) runs a session. The logged-out app
 * (WAWebLoggedOutBootstrap, at `/login/`) only links a device: it draws the
 * same QR from the same modules and keeps the socket state on WhatsApp's event
 * bus, but never loads the socket or stream model. Measured on build
 * 2.3000.1054073855: `require` answers null for both there, and `requireLazy`
 * on them never calls back. The server sends a logged-out browser to it by a
 * cookie it keeps for 90 days, answering `/` with a redirect to `/login/`
 * every time, so a page cannot leave it: inject works with what it has.
 *
 * - A scan there says nothing on that page. The stanza handler stores the
 *   session, stops the socket on the server's 515 and navigates to `/`
 *   (WAWebLoginHandleStanza); nothing on the way sets the socket state. The
 *   framenavigated handler injects again where the page lands, and that
 *   inject reports the scan when it finds the session the last page waited
 *   for.
 * - What a registered profile gets there is WhatsApp's to decide
 *   (WAWebLoggedOutBootstrap): its databases are deleted when the page names
 *   no logged-in user, as both measured pages do, and otherwise it is sent to
 *   `/`, at most twice a tab. A page that settles on anything but a QR stops
 *   inject with the state it settled on.
 *
 * `window.Debug` is set before these are all ready, on either app. Only what
 * a connection cannot do without is waited for, and a module that never
 * arrives stops inject. Anything else is exposed when present: if WhatsApp
 * renamed it, a hard wait would keep every account from connecting.
 *
 * Known, and left as it is: nobody awaits an inject started by the
 * framenavigated handler, so its failure is an unhandled rejection, and a
 * navigation WhatsApp makes by itself can leave the page unready until the
 * caller's own timeouts act. The first inject is not affected; the page a
 * scan on the logged-out app lands on is. Revisit if a page stays unready
 * after such a navigation.
 */

/** The socket and the lifecycle: waited for on every app page. */
const REQUIRED_TO_CONNECT = [
    'WAWebSocketModel',
    'WAWebCmd',
    'WAWebStreamModel',
];

/** The socket state on the bus, and its wait: on every logged-out page. */
const REQUIRED_ON_LOGGED_OUT_APP = [
    'WAWebBackendEventBus',
    'WAWebSocketConstants',
    'WAWebEventsWaitForBbEvent',
];

/** What a QR is made of, on either app: waited for only when one is shown. */
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

/**
 * In the page: whether it runs the logged-out app, told by the bootstrap
 * that loaded, since each app sets window.Debug from its own. The app's is
 * asked first, so a page of the app never asks for a module it does not
 * have. A page with neither is taken for the app, whose wait then names
 * what is missing.
 */
const IsLoggedOutApp = () =>
    window.require('WAWebAppBootstrap') == null &&
    window.require('WAWebLoggedOutBootstrap') != null;

/** The one error inject() raises when required modules never arrived. */
const modulesUnavailable = (missing, url, build) =>
    new Error(
        'WhatsApp app modules unavailable: ' +
            missing.map((m) => `${m.module} (${m.state})`).join(', ') +
            ` on ${url} (build ${build})`,
    );

/** The one error inject() raises for what the logged-out app cannot do. */
const notOnLoggedOutApp = (what, url, build) =>
    new Error(`WhatsApp's logged-out app ${what} on ${url} (build ${build})`);

module.exports = {
    REQUIRED_TO_CONNECT,
    REQUIRED_ON_LOGGED_OUT_APP,
    REQUIRED_FOR_QR,
    EXPOSED_WHEN_PRESENT,
    IsLoggedOutApp,
    modulesUnavailable,
    notOnLoggedOutApp,
};
