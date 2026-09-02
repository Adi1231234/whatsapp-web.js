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
 *   go and read the file, and it is chosen by LEVEL so an unseen failure is
 *   carried on its first occurrence without anyone having predicted its words.
 *   Rate-limited per template, because the level rule alone would also carry
 *   the routine ones.
 *
 * Measured on a busy shop over 6.2 minutes: 0 ERROR, 0 EXPECTED_ERROR, 32 WARN,
 * 1,773 LOG, 202 DEV_XMPP. LOG is excluded from the second rule because it is
 * the volume; DEV_XMPP is excluded from BOTH, because it is the raw XMPP wire
 * and it carries message bodies.
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

/**
 * How many lines to hold when the host binding is not there to take them.
 *
 * `exposeFunction` resolving is NOT proof that the binding reached the main
 * world: the OOPIF bug this repo already carries a puppeteer patch for makes it
 * resolve while `window.<name>` stays undefined, measured at a 31% failure rate
 * on the attach path. Emptying the buffer before the call therefore destroyed
 * every line in exactly that case - proven on the live page, 0 of 5 lines
 * survived a binding that was missing for one flush and then restored.
 *
 * So a failed flush keeps its lines and the next one retries. The cap is what
 * stops a binding that never arrives from growing the page's heap without
 * bound: about 5 megabytes at the 500-character ceiling per line, and ~17
 * minutes of a busy shop's volume, which is far longer than the re-inject that
 * would deliver the binding.
 *
 * When it does overflow the NEWEST lines are dropped, not the oldest. This
 * buffer only ever fills from the page's first moments, and the failure it
 * exists to explain destroys the session during exactly those moments.
 */
const WAL_MAX_BUFFERED = 5000;

/**
 * The GCP side is capped PER TEMPLATE, not by vocabulary.
 *
 * Choosing by level alone is what makes an unseen failure visible on its first
 * occurrence, but it also carries the routine ones: measured, WARN is 5/min per
 * machine and one template (`[devices] missing side contact hash`) is most of
 * it, which would be ~148k rows/day across the fleet for a message that says
 * nothing. Capping the first few of each distinct template keeps every novel
 * line and drops the repetition, and the local file still has all of it.
 *
 * The window rather than a once-per-page cap so a rate that suddenly climbs is
 * still visible, and the count of what was dropped rides on the next one out.
 */
const WAL_SIGNAL_PER_TEMPLATE = 3;
const WAL_SIGNAL_WINDOW_MS = 600000;

/** True when a line also deserves a GCP row. Pure, so testable. */
const isWaLoggerSignal = (level, message) =>
    WAL_SIGNAL_LEVELS.indexOf(level) !== -1 || WAL_TERMINAL.test(message);

const InjectWaLoggerHook = (
    terminalSource,
    levels,
    signalLevels,
    batchSize,
    flushMs,
    perTemplate,
    windowMs,
    maxBuffered,
) => {
    const WAL = window.require('WALogger');
    if (!WAL) return;

    // inject() runs more than once per document: initialize() and framenavigated
    // race, and the logs show `inject:CANCELLING previous inject` on a single
    // page. The per-function __p2dWrapped guard below stops the double-wrap but
    // not the timer and the listener, which would accumulate one of each per
    // inject and leave the later buffers orphaned.
    if (window.__p2dWaLogInstalled) return;
    window.__p2dWaLogInstalled = true;

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

    // Per-template rate limit for the GCP side only. Returns how many were
    // dropped since the last one went out, or null when this one is suppressed.
    let seen = Object.create(null);
    let seenCount = 0;
    const throttle = (msg) => {
        const now = Date.now();
        const key = msg.slice(0, 120);
        // Keys are TEMPLATES, so the set is naturally small - 4 distinct WARN
        // templates in the whole measurement. But WALogger also accepts a plain
        // string, and a caller building one per call would grow this without
        // bound over a page that lives for days. Start over rather than leak.
        if (seenCount > 500) {
            seen = Object.create(null);
            seenCount = 0;
        }
        const entry = seen[key];
        if (!entry) seenCount++;
        if (!entry || now - entry.since >= windowMs) {
            seen[key] = { since: now, sent: 1, dropped: 0 };
            return entry ? entry.dropped : 0;
        }
        if (entry.sent < perTemplate) {
            entry.sent++;
            const dropped = entry.dropped;
            entry.dropped = 0;
            return dropped;
        }
        entry.dropped++;
        return null;
    };

    var buffer = [];
    var droppedWhileUnbound = 0;
    // Keep the lines when the host cannot take them. Emptying first is what
    // made a missing binding a silent, permanent loss.
    const flush = () => {
        if (buffer.length === 0) return;
        if (typeof window.onWaLogBatch !== 'function') return;
        const batch = buffer;
        buffer = [];
        if (droppedWhileUnbound) {
            // Ride the gap out on the first line that gets through, so the
            // file says the history is incomplete instead of just being short.
            batch[0] = Object.assign({}, batch[0], {
                droppedWhileUnbound: droppedWhileUnbound,
            });
            droppedWhileUnbound = 0;
        }
        try {
            window.onWaLogBatch(batch);
        } catch (e) {
            // The binding exists but did not dispatch, so nothing was
            // delivered. Put them back in front of whatever arrived since.
            buffer = batch.concat(buffer);
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

                if (buffer.length >= maxBuffered) {
                    // Only reachable while the host binding is missing, since
                    // a working flush drains at batchSize. Keep the oldest.
                    droppedWhileUnbound++;
                } else {
                    buffer.push({
                        level: lvl,
                        msg: msg.slice(0, 500),
                        args: args,
                        state: state,
                        ts: Date.now(),
                    });
                }
                if (buffer.length >= batchSize) flush();

                if (signalLevels.indexOf(lvl) !== -1 || isTerminal) {
                    // A terminal line is never suppressed: it is rare by
                    // definition and it is the one we came for.
                    const dropped = isTerminal ? 0 : throttle(msg);
                    if (
                        dropped !== null &&
                        typeof window.onSocketDiagEvent === 'function'
                    ) {
                        window.onSocketDiagEvent({
                            event: 'WA_INTERNAL_' + lvl,
                            terminal: isTerminal,
                            msg: msg.slice(0, 300),
                            args: args,
                            state: state,
                            suppressed: dropped || undefined,
                        });
                    }
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
    WAL_SIGNAL_PER_TEMPLATE,
    WAL_SIGNAL_WINDOW_MS,
    WAL_LEVELS,
    WAL_SIGNAL_LEVELS,
    WAL_BATCH_SIZE,
    WAL_FLUSH_MS,
    WAL_MAX_BUFFERED,
    isWaLoggerSignal,
};
