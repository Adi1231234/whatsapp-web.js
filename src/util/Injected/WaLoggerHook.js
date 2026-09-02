'use strict';

/**
 * Forwards WhatsApp's own logger out of the page, to two places.
 *
 * WhatsApp explains its terminal decisions in plain text through `WALogger`,
 * and that text is the only place some failures are ever named. It used to be
 * filtered by a keyword set, which is how a shop was destroyed without an
 * explanation: `logout_reason=0` can only come from the storage layer, every
 * line WhatsApp writes on that path talks about storage, schemas or databases,
 * and not one of those words was in the set.
 *
 * So the filtering is gone. There are two destinations with two rules, and
 * neither requires guessing vocabulary in advance:
 *
 * - EVERY line is batched to `onWaLogBatch`, which the host appends to a local
 *   per-account file. Nothing is dropped and nothing leaves the machine.
 * - ERROR, WARN and EXPECTED_ERROR, plus any line the terminal set recognises
 *   at any level, ALSO go to `onSocketDiagEvent`. That is the signal that says
 *   go and read the file. Measured on a busy shop over 6.2 minutes: 0 ERROR,
 *   0 EXPECTED_ERROR, 32 WARN. It costs nothing.
 *
 * LOG is excluded from the second rule because it is the volume: 1,773 calls
 * in that same window. DEV_XMPP is excluded from BOTH, because it is the raw
 * XMPP wire and it carries message bodies.
 */

// Terminal at ANY level, including LOG. Not a vocabulary guess: these are the
// phrases WhatsApp uses when it is throwing a session away.
const WAL_TERMINAL =
    /logging out|logged out|device removed|fatal error|failure stanza|dirty bit|identity changed|native logout failed|forced logout/i;

// Wrapped, in WALogger's own naming. DEV_XMPP, COUNT and DEV are deliberately
// absent: DEV_XMPP is the wire, and the other two never fired in any measurement.
const WAL_LEVELS = ['ERROR', 'WARN', 'EXPECTED_ERROR', 'LOG'];

/** Levels quiet enough to forward whole. LOG is not one of them. */
const WAL_SIGNAL_LEVELS = ['ERROR', 'WARN', 'EXPECTED_ERROR'];

const WAL_BATCH_SIZE = 200;
const WAL_FLUSH_MS = 2000;

/** True when a line also deserves a GCP row. Pure, so testable. */
const isWaLoggerSignal = (level, message) =>
    WAL_SIGNAL_LEVELS.indexOf(level) !== -1 || WAL_TERMINAL.test(message);

const InjectWaLoggerHook = (
    terminalSource,
    levels,
    signalLevels,
    batchSize,
    flushMs,
) => {
    const WAL = window.require('WALogger');
    if (!WAL) return;

    const terminal = new RegExp(terminalSource, 'i');
    const socketState = () => {
        const model = window.require('WAWebSocketModel');
        return model ? String(model.Socket.state) : undefined;
    };

    // WALogger's first argument is a tagged-template array; the substitutions
    // arrive as the remaining arguments, and for `set schema versions` they are
    // the schema table itself, which is the whole reason to capture that line.
    const render = (args) => {
        const head = args[0];
        return Array.isArray(head) ? head.join('{}') : String(head);
    };
    const renderArgs = (args) => {
        const rest = Array.prototype.slice.call(args, 1, 4);
        if (!rest.length) return undefined;
        try {
            return JSON.stringify(rest).slice(0, 400);
        } catch (e) {
            return String(rest).slice(0, 400);
        }
    };

    var buffer = [];
    const flush = () => {
        if (buffer.length === 0) return;
        const batch = buffer;
        buffer = [];
        try {
            window.onWaLogBatch(batch);
        } catch (e) {
            // best-effort diagnostic: never let it break the caller
        }
    };
    setInterval(flush, flushMs);
    // The lines that matter most are the last ones before WhatsApp navigates
    // itself to a logout, so do not let a navigation take the tail with it.
    window.addEventListener('pagehide', flush);

    levels.forEach((lvl) => {
        const orig = WAL[lvl];
        if (typeof orig !== 'function' || orig.__p2dWrapped) return;
        const wrapped = function () {
            try {
                const msg = render(arguments);
                const isTerminal = terminal.test(msg);
                const args = renderArgs(arguments);
                const state = socketState();

                buffer.push({
                    level: lvl,
                    msg: msg.slice(0, 500),
                    args: args,
                    state: state,
                    ts: Date.now(),
                });
                if (buffer.length >= batchSize) flush();

                if (signalLevels.indexOf(lvl) !== -1 || isTerminal) {
                    window.onSocketDiagEvent({
                        event: 'WA_INTERNAL_' + lvl,
                        terminal: isTerminal,
                        msg: msg.slice(0, 300),
                        args: args,
                        state: state,
                    });
                }
            } catch (e) {
                // best-effort diagnostic: never let it break the caller
            }
            return orig.apply(this, arguments);
        };
        wrapped.__p2dWrapped = true;
        WAL[lvl] = wrapped;
    });
};

module.exports = {
    InjectWaLoggerHook,
    WAL_TERMINAL,
    WAL_LEVELS,
    WAL_SIGNAL_LEVELS,
    WAL_BATCH_SIZE,
    WAL_FLUSH_MS,
    isWaLoggerSignal,
};
