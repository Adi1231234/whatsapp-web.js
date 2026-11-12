'use strict';

/**
 * `window.AuthStore`, for whoever reads it. Runs once inject() has the
 * modules a connection needs (util/AppModules.js), so the socket and Cmd are
 * there; everything else is exposed as WhatsApp has it, possibly missing.
 * The QR is built from the gateway after its own wait, not from here.
 */
exports.ExposeAuthStore = () => {
    window.AuthStore = {};
    window.AuthStore.AppState =
        window.WaGateway.module('WAWebSocketModel').Socket;
    window.AuthStore.Cmd = window.WaGateway.module('WAWebCmd').Cmd;
    window.AuthStore.Conn = window.WaGateway.module('WAWebConnModel')?.Conn;
    window.AuthStore.OfflineMessageHandler = window.WaGateway.module(
        'WAWebOfflineHandler',
    )?.OfflineMessageHandler;
    window.AuthStore.PairingCodeLinkUtils = window.WaGateway.module(
        'WAWebAltDeviceLinkingApi',
    );
    window.AuthStore.Base64Tools = window.WaGateway.module('WABase64');
    window.AuthStore.RegistrationUtils = {
        ...window.WaGateway.module('WAWebCompanionRegClientUtils'),
        ...window.WaGateway.module('WAWebAdvSignatureApi'),
        ...window.WaGateway.module('WAWebUserPrefsInfoStore'),
        ...window.WaGateway.module('WAWebSignalStoreApi'),
    };
};
