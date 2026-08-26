'use strict';

/**
 * Reports WhatsApp's connection screen to the Node side. Injected, so it has to
 * be self-contained.
 *
 * WA >= 2.3000.1046055909 moved `Stream.displayInfo` into
 * `WAWebStreamGetters.getDisplayInfo`. Whichever of the two a build has is the
 * one that answers; `window.require` returns undefined for an unknown module
 * rather than throwing, so `?.` is the whole feature detection. Do not try to
 * derive it instead - no combination of info/obscurity/hasSynced is equivalent.
 *
 * `change:displayInfo` cannot fire where the attribute is gone, hence the three
 * events WA's own loading screen uses, plus `change:mode`.
 */
exports.InstallConnectionScreenWatcher = function () {
    const { Stream, StreamMode, StreamInfo } =
        window.require('WAWebStreamModel');

    const displayInfo = () =>
        window.require('WAWebStreamGetters')?.getDisplayInfo?.(Stream) ??
        Stream.displayInfo;

    const screenNow = () => {
        switch (Stream.mode) {
            case StreamMode.MAIN:
                return displayInfo() === StreamInfo.NORMAL
                    ? 'CONNECTED'
                    : 'LOADING';
            case StreamMode.QR:
                return 'QR';
            case StreamMode.OFFLINE:
                return 'DISCONNECTED';
            case StreamMode.SYNCING:
                return 'LOADING';
            default:
                return 'ERROR';
        }
    };

    let reported = null;
    const notify = () => {
        try {
            const screen = screenNow();
            if (screen === reported) return;
            window.onConnectionStateEvent(
                screen,
                window.AuthStore?.OfflineMessageHandler?.getOfflineDeliveryProgress?.() ??
                    0,
            );
            reported = screen; // only once it is out, so a late binding recovers
        } catch (e) {
            // Throwing would abort the rest of WhatsApp's dispatch for the event.
            window.__diag?.safeDiagLog?.('info', 'CONNECTION_SCREEN_FAILED', {
                error: String((e && e.message) || e),
            });
        }
    };

    Stream.on(
        'change:mode change:info change:obscurity change:hasSynced',
        notify,
    );
    notify();
};
