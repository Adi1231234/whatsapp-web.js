'use strict';

/**
 * Connection-lifecycle watcher, subscribed to WhatsApp's own Stream model.
 *
 * WhatsApp renders its loading screen from `Stream` and subscribes to it at app
 * boot: WAWebStartup.react mounts a `change:displayInfo` listener and shows the
 * loading screen while displayInfo is SYNCING/CONNECTING. Subscribing any later
 * cannot observe that window at all. Measured on a real QR scan: the moment the
 * phone pairs, Stream goes SYNCING/CONNECTING and stays there 11.5s, then flips
 * to MAIN/NORMAL in the very same millisecond that the app-state-synced handler
 * runs - so a subscription installed in that handler only ever sees CONNECTED,
 * and `loading_screen` was never emitted for a scan.
 *
 * Screen resolution stays mode-first, which is a deliberate divergence from
 * WhatsApp's displayInfo-first switch: `qr` is a separate event with its own
 * path here, so QR mode has to win over the CONNECTING displayInfo that a
 * waiting QR carries the whole time (measured: mode QR / displayInfo
 * CONNECTING / info OPENING).
 */
exports.ExposeStreamScreenWatcher = () => {
    const req = (name) => {
        try {
            return window.require(name);
        } catch (e) {
            return null;
        }
    };

    const install = () => {
        const streamMod = req('WAWebStreamModel');
        const socketMod = req('WAWebSocketModel');
        const socketConsts = req('WAWebSocketConstants');
        if (!streamMod || !socketMod?.Socket || !socketConsts?.SOCKET_STATE) {
            return false;
        }
        const { Stream, StreamMode: M, StreamInfo: I } = streamMod;
        const { Socket } = socketMod;
        const { SOCKET_STATE } = socketConsts;

        // inject() can run several times on the same page (framenavigated), and
        // Backbone would happily stack a second listener on top of the first.
        if (window.__wwjsStreamWatcher) {
            Stream.off(
                'change:mode change:displayInfo',
                window.__wwjsStreamWatcher,
            );
            Socket.off('change:state', window.__wwjsStreamWatcher);
        }

        const resolveScreen = () => {
            switch (Stream.mode) {
                case M.MAIN:
                    return Stream.displayInfo === I.NORMAL
                        ? 'CONNECTED'
                        : 'LOADING';
                case M.QR:
                    return 'QR';
                case M.OFFLINE:
                    return 'DISCONNECTED';
                case M.SYNCING:
                    return 'LOADING';
                default:
                    return 'ERROR';
            }
        };

        // READY is a contract: the Store is injected and ClientInfo exists. The
        // stream can reach MAIN/NORMAL before that (it does on every reconnect
        // of an already-authenticated session), so CONNECTED stays bottled up
        // until the sync handler calls __wwjsMarkStoreReady. Deliberately
        // without updating lastScreen, so the same screen still reports once
        // unblocked.
        let storeReady = typeof window.WWebJS !== 'undefined';
        let lastScreen = null;

        // Before the first sync the stream says almost nothing trustworthy: it
        // is constructed at SYNCING and only becomes QR inside its own
        // initialize(), and a waiting QR keeps cycling OPENING/PAIRING on every
        // socket attempt. Reporting those as loading_screen walks a client off
        // its QR state every few seconds - measured live, the consumer re-fired
        // its "QR shown" alert on every refresh. The one pre-sync screen that
        // is real is the sync that follows a successful pairing, and the socket
        // is what proves it: it only reaches CONNECTED once the phone paired.
        const preSyncScanOnly = (screen) =>
            screen === 'LOADING' && Socket.state === SOCKET_STATE.CONNECTED;

        const notify = () => {
            const screen = resolveScreen();
            if (screen === lastScreen) return;
            if (!storeReady && !preSyncScanOnly(screen)) return;
            lastScreen = screen;
            window.onConnectionStateEvent(
                screen,
                window.AuthStore?.OfflineMessageHandler?.getOfflineDeliveryProgress?.() ??
                    0,
            );
        };

        window.__wwjsStreamWatcher = notify;
        window.__wwjsMarkStoreReady = () => {
            storeReady = true;
            notify();
        };

        Stream.on('change:mode change:displayInfo', notify);
        // The socket is an input to the gate above, and it settles LAST:
        // measured on a real scan, the stream turned SYNCING 1.1s BEFORE the
        // socket reached CONNECTED and then nothing on the stream moved for
        // another 10s. Watching the stream alone would suppress that LOADING
        // and never revisit it - dropping the one event this exists for.
        Socket.on('change:state', notify);
        // Backbone only fires on real changes, so report the current state once.
        notify();
        return true;
    };

    if (install()) return;

    // The modules were not up yet. READY is emitted through
    // __wwjsMarkStoreReady, so it must exist either way: leaving it undefined
    // would leave a healthy client stuck short of ready. Retry the install when
    // the sync handler calls it, by which point the app has certainly finished
    // loading, and hand over to the real one.
    window.__wwjsMarkStoreReady = () => {
        if (install()) window.__wwjsMarkStoreReady();
    };
};
