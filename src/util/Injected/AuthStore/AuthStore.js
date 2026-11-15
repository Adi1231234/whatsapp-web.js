'use strict';

/**
 * `window.AuthStore`, for whoever reads it. Runs once inject() has the
 * modules a connection needs (util/AppModules.js), so the socket and Cmd are
 * there; everything else is exposed as WhatsApp has it, possibly missing.
 * The QR is built from WhatsApp's modules after its own wait, not from here.
 */
exports.ExposeAuthStore = () => {
    window.AuthStore = {};
    window.AuthStore.AppState = window.require('WAWebSocketModel').Socket;
    window.AuthStore.Cmd = window.require('WAWebCmd').Cmd;
    window.AuthStore.Conn = window.require('WAWebConnModel')?.Conn;
    window.AuthStore.OfflineMessageHandler = window.require(
        'WAWebOfflineHandler',
    )?.OfflineMessageHandler;
    window.AuthStore.PairingCodeLinkUtils = window.require(
        'WAWebAltDeviceLinkingApi',
    );
    window.AuthStore.Base64Tools = window.require('WABase64');
    window.AuthStore.RegistrationUtils = {
        ...window.require('WAWebCompanionRegClientUtils'),
        ...window.require('WAWebAdvSignatureApi'),
        ...window.require('WAWebUserPrefsInfoStore'),
        ...window.require('WAWebSignalStoreApi'),
    };
};
