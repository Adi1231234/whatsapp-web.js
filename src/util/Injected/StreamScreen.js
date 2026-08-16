'use strict';

/**
 * Watches WhatsApp's own Stream model and maps it onto the client's connection
 * events, subscribed from inject() the way WhatsApp subscribes at app boot
 * (WAWebStartup.react). Subscribing after the app-state sync, as this used to,
 * cannot observe the loading window at all: it closes in the same millisecond
 * that handler runs.
 *
 * Two things are deliberate:
 * - Mode-first resolution, unlike WhatsApp's displayInfo-first switch. A
 *   waiting QR carries displayInfo CONNECTING the whole time, and `qr` is a
 *   separate event with its own path, so QR mode has to win.
 * - Nothing is reported before the first sync except a LOADING backed by a
 *   CONNECTED socket. The model is constructed at SYNCING and a waiting QR
 *   cycles OPENING/PAIRING, so the socket is the only proof a phone paired.
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
        const { Socket } = req('WAWebSocketModel') || {};
        const { SOCKET_STATE } = req('WAWebSocketConstants') || {};
        if (!streamMod || !Socket || !SOCKET_STATE) return false;
        const { Stream, StreamMode: M, StreamInfo: I } = streamMod;

        // inject() runs again on framenavigated; Backbone would stack a second
        // listener on top of the first.
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

        // READY means the Store is injected and ClientInfo exists, so CONNECTED
        // waits for the sync handler to unblock it. Suppressed screens leave
        // lastScreen alone, so they still report once allowed.
        let storeReady = typeof window.WWebJS !== 'undefined';
        let lastScreen = null;

        const notify = () => {
            const screen = resolveScreen();
            if (screen === lastScreen) return;
            const paired = Socket.state === SOCKET_STATE.CONNECTED;
            if (!storeReady && !(screen === 'LOADING' && paired)) return;
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
        // The socket settles last: on a real scan the stream turned SYNCING
        // 1.1s before it reached CONNECTED, and nothing on the stream moved for
        // another 10s. Watching only the stream would drop that LOADING.
        Socket.on('change:state', notify);
        notify();
        return true;
    };

    if (install()) return;

    // Modules not up yet. READY is emitted through __wwjsMarkStoreReady, so it
    // has to exist regardless or a healthy client never reaches Connected.
    window.__wwjsMarkStoreReady = () => {
        if (install()) window.__wwjsMarkStoreReady();
    };
};
