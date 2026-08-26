'use strict';

/**
 * Reports WhatsApp's connection screen to the Node side, from WA's own Stream.
 * Injected with page.evaluate(), so it has to stay self-contained.
 *
 * WA >= 2.3000.1046055909 deleted the derived `Stream.displayInfo` and moved the
 * same computation into `WAWebStreamGetters.getDisplayInfo`. Reading the old
 * attribute there yields `undefined`, which never equals `StreamInfo.NORMAL`, so
 * a connected account resolved to 'LOADING' forever and READY - whose only emit
 * site is 'CONNECTED' - became unreachable. Ask for whichever of the two the
 * page has; `window.require` returns `undefined` for an unknown module instead
 * of throwing, so `?.` is the whole feature detection.
 *
 * `change:displayInfo` cannot fire where the attribute is gone, so the
 * subscription is the three WA's own loading screen listens to, plus
 * `change:mode` for the branch below.
 */
exports.InstallConnectionScreenWatcher = function () {
    const {
        Stream,
        StreamMode: M,
        StreamInfo: I,
    } = window.require('WAWebStreamModel');

    const displayInfo = () =>
        window.require('WAWebStreamGetters')?.getDisplayInfo?.(Stream) ??
        Stream.displayInfo;

    const resolveScreen = () => {
        switch (Stream.mode) {
            case M.MAIN:
                return displayInfo() === I.NORMAL ? 'CONNECTED' : 'LOADING';
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

    let lastScreen = null;
    const notify = () => {
        try {
            const screen = resolveScreen();
            if (screen === lastScreen) return;
            window.onConnectionStateEvent(
                screen,
                window.AuthStore?.OfflineMessageHandler?.getOfflineDeliveryProgress?.() ??
                    0,
            );
            // Latched only once the report is out, so a binding that is not
            // there yet cannot suppress that screen for the life of the page.
            lastScreen = screen;
        } catch (e) {
            // Throwing here would abort the rest of WhatsApp's own dispatch for
            // the event, so it is reported instead.
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
