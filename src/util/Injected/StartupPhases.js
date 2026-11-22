'use strict';

/** The binding the page reports startup phases through. */
const STARTUP_PHASE_BINDING = 'onStartupPhaseEvent';

/**
 * Reports WhatsApp's own startup progress, so a caller can tell a WhatsApp
 * that is still working from one that is stuck without a stopwatch.
 *
 * - `storage-opening` / `storage-ready`: whether WhatsApp's storage has its
 *   schema versions. Setting them is the step a long storage job holds up:
 *   on 2026-11-21 `[storage] start load schema versions` went unanswered for
 *   minutes while LevelDB wrote ~1 MB every 0.6 s, against 13-15 ms on the
 *   nights before. Read from `WAWebSchemaVersions`, the module WhatsApp sets
 *   them on, so the report does not depend on WhatsApp's log wording.
 * - `socket`: every socket state until it settles, with the state as detail.
 *
 * Installed once per document. Never throws, and never changes what
 * WhatsApp's functions return. Self-contained: `page.evaluate` sends this
 * function's source alone.
 */
function InstallStartupPhases(binding) {
    if (window.__wwebjsStartupPhases) return;
    window.__wwebjsStartupPhases = true;
    const report = (phase, detail) => {
        try {
            window[binding](phase, detail == null ? null : String(detail));
        } catch (ignoredError) {
            // a page going away takes its reports with it
        }
    };

    const versions = window.WaGateway.module('WAWebSchemaVersions');
    if (versions && typeof versions.hasSchemaVersions === 'function') {
        if (versions.hasSchemaVersions()) {
            report('storage-ready');
        } else {
            report('storage-opening');
            window.WaGateway.wrap(
                'startup-phases',
                versions,
                'setSchemaVersions',
                (original) =>
                    function (...args) {
                        const result = original.apply(this, args);
                        report('storage-ready');
                        return result;
                    },
            );
        }
    }

    const socketModule = window.WaGateway.module('WAWebSocketModel');
    const constants = window.WaGateway.module('WAWebSocketConstants');
    const Socket = socketModule && socketModule.Socket;
    const STATE = constants && constants.SOCKET_STATE;
    if (!Socket || !STATE || typeof Socket.on !== 'function') return;
    const transient = [STATE.OPENING, STATE.UNLAUNCHED, STATE.PAIRING];
    report('socket', Socket.state);
    if (Socket.state != null && !transient.includes(Socket.state)) return;
    const stop = () => Socket.off('change:state', onState);
    const onState = () => {
        report('socket', Socket.state);
        if (Socket.state != null && !transient.includes(Socket.state)) stop();
    };
    Socket.on('change:state', onState);
    // A caller that ended the startup (util/StartupWaits.js) ends this too.
    const startup = window.__wwebjsStartup;
    if (startup) {
        startup.controller.signal.addEventListener('abort', stop, {
            once: true,
        });
    }
}

module.exports = { InstallStartupPhases, STARTUP_PHASE_BINDING };
