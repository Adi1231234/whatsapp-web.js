'use strict';

const {
    STORAGE_INIT_ERROR,
    STORAGE_SCHEMA_SNAPSHOT,
} = require('./Injected/StorageDiag');
const { WA_GATEWAY_CHECK } = require('./Injected/WaGateway');
const { WAL_EVENT_PREFIX } = require('./Injected/WaLoggerHook');

/**
 * Decides which socket-diag events also get their own `diag` channel entry,
 * and at what level. Everything else stays a console line (`SOCKET_DIAG`),
 * which nothing can subscribe to.
 *
 * The socket-diag binding is exposed at inject, before auth, which is why these
 * ride it rather than the general `diag` bridge: that one is exposed in
 * attachEventListeners, and in the failures below initialize() can reject or
 * the session can end before it ever runs.
 *
 * - The storage failure mode rejects initialize().
 * - The gateway check is what a consumer acts on when WhatsApp changes
 *   underneath this library.
 * - A terminal line of WhatsApp's own logger is where WhatsApp says why it is
 *   ending the session ("received failure stanza, reason: {}, logging out"),
 *   often before the app has synced. Terminal lines are rare by definition and
 *   WaLoggerHook never throttles them, so forwarding all of them costs nothing.
 *   The rest of the logger's signal stays a console line: it is the volume.
 */
const LEVEL_BY_EVENT = new Map([
    [STORAGE_INIT_ERROR, 'error'],
    [STORAGE_SCHEMA_SNAPSHOT, 'info'],
    [WA_GATEWAY_CHECK, 'info'],
]);

const TERMINAL_WA_LOG_LEVEL = 'info';

/**
 * @param {object} info - a socket-diag event, as the page reported it
 * @returns {string|null} the `diag` level to emit it at, or null to leave it
 * a console line
 */
function subscribableDiagLevel(info) {
    if (!info) return null;
    const level = LEVEL_BY_EVENT.get(info.event);
    if (level) return level;
    const isTerminalWaLog =
        typeof info.event === 'string' &&
        info.event.startsWith(WAL_EVENT_PREFIX) &&
        info.terminal === true;
    return isTerminalWaLog ? TERMINAL_WA_LOG_LEVEL : null;
}

module.exports = { subscribableDiagLevel };
