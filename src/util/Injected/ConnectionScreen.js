'use strict';

/**
 * Reports WhatsApp's connection screen to the Node side, from WA's own Stream.
 *
 * Injected with page.evaluate(), so it must stay self-contained: it may only
 * reach the page through `window`, never through a sibling module.
 *
 * WA >= 2.3000.1046055909 DELETED the derived `Stream.displayInfo` attribute
 * and moved the identical computation into a memoized getter module,
 * `WAWebStreamGetters.getDisplayInfo`. Reading the old attribute on such a
 * build yields `undefined`, which never equals `StreamInfo.NORMAL`, so
 * `Stream.mode === MAIN` resolved to 'LOADING' forever. READY has exactly one
 * emit site in this library - the 'CONNECTED' screen - so it became
 * unreachable, the consumer's watchdog restarted the client every ~2 minutes,
 * and the cycle repeated. Measured on three shops on 2026-08-26.
 *
 * Two things follow, and both are load-bearing:
 *
 * 1. `displayInfo` has to be resolved through the getter when it is there, with
 *    a local copy of WA's formula for builds that still carry the attribute.
 *    The two are equivalent: WA moved the code without changing it, down to the
 *    same "Stream:unknown obscure level:" fallthrough. The only substitution is
 *    where `hasSynced` comes from - the old attribute read `Socket.hasSynced`
 *    inside the HIDE branch, the getter takes `Stream.hasSynced` - and WA's own
 *    `$StreamImpl$p_1` mirrors the Socket onto the Stream on BOTH builds, so
 *    they carry the same value.
 *
 * 2. `change:displayInfo` can never fire where the attribute is gone. The
 *    subscription is the three events WA's own loading screen listens to
 *    (`change:info change:obscurity change:hasSynced`), plus `change:mode` for
 *    the branch below. Measured on a live 2.3000.1046055909 page: zero
 *    `change:displayInfo` against 572 `change:info` and 155 `change:mode`.
 *
 * `window.require()` of an unknown WA module RETURNS `undefined` here, it does
 * not throw - it only logs "Requiring unknown module" to the console - so both
 * module lookups below are plain feature detection.
 */
exports.InstallConnectionScreenWatcher = function () {
    const {
        Stream,
        StreamMode: M,
        StreamInfo: I,
    } = window.require('WAWebStreamModel');

    const getters = window.require('WAWebStreamGetters');
    const types = window.require('WAWebStreamTypes');

    const displayInfoOf = () => {
        if (getters && getters.getDisplayInfo)
            return getters.getDisplayInfo(Stream);
        if (Stream.displayInfo !== undefined) return Stream.displayInfo;
        if (!types) return undefined;
        const SI = types.StreamInfo;
        const OB = types.Obscurity;
        switch (Stream.obscurity) {
            case OB.SHOW:
                return Stream.info;
            case OB.HIDE:
                return Stream.hasSynced === true ? SI.NORMAL : SI.CONNECTING;
            case OB.OBSCURE:
                switch (Stream.info) {
                    case SI.OPENING:
                    case SI.PAIRING:
                    case SI.SYNCING:
                    case SI.RESUMING:
                        return SI.CONNECTING;
                    default:
                        return Stream.info;
                }
            default:
                return Stream.info;
        }
    };

    const resolveScreen = () => {
        switch (Stream.mode) {
            case M.MAIN:
                return displayInfoOf() === I.NORMAL ? 'CONNECTED' : 'LOADING';
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
        const screen = resolveScreen();
        if (screen === lastScreen) return;
        lastScreen = screen;
        window.onConnectionStateEvent(
            screen,
            window.AuthStore?.OfflineMessageHandler?.getOfflineDeliveryProgress?.() ??
                0,
        );
    };

    Stream.on(
        'change:mode change:info change:obscurity change:hasSynced',
        notify,
    );
    notify();
};
