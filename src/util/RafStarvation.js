'use strict';

/**
 * Decides whether the Socket.state wait in inject() was one that the pre-#151
 * code could not have survived.
 *
 * Before PR #151 that wait was `waitForFunction`, which defaults to
 * `polling: 'raf'`. puppeteer's RAFPoller evaluates the predicate once
 * immediately and re-evaluates it only from `requestAnimationFrame`. A document
 * whose `visibilityState` is 'hidden' runs no animation frame callbacks at all
 * (HTML spec: they are suspended, not throttled), and a WebContentsView is born
 * hidden. So the old code could only end in TimeoutError whenever both of these
 * held:
 *
 *   1. the state had NOT already settled when the wait began, so the single
 *      immediate evaluation returned false; and
 *   2. no animation frame fired before the state settled, so nothing ever
 *      re-evaluated it.
 *
 * Those two facts are exactly what `inject()` now measures, and both together
 * are the only thing this reports. A wait that returned early, or one that saw
 * even a single frame, proves nothing and stays silent.
 *
 * The duration floor exists because "zero frames" is not evidence on its own:
 * a wait shorter than one frame interval trivially sees zero frames while the
 * document is perfectly healthy, and the old rAF poller would have re-evaluated
 * at the next frame and resolved. Over a full second a visible document at even
 * 5fps produces frames, so zero across that span means the document is
 * genuinely not producing them.
 */
const MIN_WAIT_MS = 1000;

/**
 * @param {object} result - the object returned by inject()'s Socket.state evaluate
 * @returns {object|null} the report payload, or null when there is nothing to report
 */
function rafStarvationRescue(result) {
    if (!result || !result.awaited) return null;
    if (result.rafTicks !== 0) return null;
    if (!(result.waitMs >= MIN_WAIT_MS)) return null;

    return {
        waitMs: result.waitMs,
        rafTicks: result.rafTicks,
        stateAtStart: result.stateAtStart,
        stateAtEnd: result.state,
        visibilityAtStart: result.visibilityAtStart,
        visibilityAtEnd: result.visibilityAtEnd,
        minWaitMs: MIN_WAIT_MS,
    };
}

module.exports = { rafStarvationRescue, MIN_WAIT_MS };
