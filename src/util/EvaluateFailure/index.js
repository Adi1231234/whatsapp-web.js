'use strict';

/**
 * What a failed `evaluate` / `evaluateHandle` is, for the diag channel, or
 * null for a failure the evaluate wrappers do not report.
 *
 * - "Execution context was destroyed": the document the call ran in was
 *   replaced while it ran (a reload, a logout, a navigation by the page
 *   itself). Nothing is wrong with the page and the caller gets the error,
 *   so it is a warning.
 * - "Promise was collected": stays an error. It is a different failure, not
 *   a replaced document.
 */
function classifyEvaluateFailure(err) {
    const message = String((err && err.message) || '');
    const isPromiseCollected = message.includes('Promise was collected');
    const isContextDestroyed = message.includes(
        'Execution context was destroyed',
    );
    if (!isPromiseCollected && !isContextDestroyed) return null;
    return {
        level: isPromiseCollected ? 'error' : 'warn',
        isPromiseCollected,
        isContextDestroyed,
    };
}

module.exports = { classifyEvaluateFailure };
