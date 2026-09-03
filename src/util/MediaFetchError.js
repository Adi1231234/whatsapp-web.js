'use strict';

/**
 * A media fetch that produced no bytes, carrying WhatsApp's own
 * `MediaDataStage` (`null` when the message is gone, `undefined` when the
 * failure never reached the page). Built on the Node side because an in-page
 * throw loses every custom property at the puppeteer boundary.
 *
 * One stage is ours rather than WhatsApp's: `STALLED`, for a download the stall
 * watchdog cancelled because it had stopped delivering bytes. WhatsApp has no
 * stage for that - it would otherwise be left reading as `FETCHING` - and the
 * distinction matters because a stall is the one failure worth retrying at once.
 */
class MediaFetchError extends Error {
    constructor(stage, options) {
        const label =
            stage === undefined ? 'unreported' : (stage ?? 'message gone');
        super(`media fetch failed: ${label}`, options);
        this.name = 'MediaFetchError';
        this.stage = stage;
    }
}

module.exports = { MediaFetchError };
