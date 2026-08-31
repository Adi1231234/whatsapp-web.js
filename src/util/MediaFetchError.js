'use strict';

/**
 * A media fetch that produced no bytes, with WhatsApp's own `MediaDataStage`
 * still attached (`null` when there is no message left to have one).
 *
 * Constructed on the NODE side on purpose: an error thrown inside the WA page
 * loses every custom property at the puppeteer boundary, so the page returns
 * the stage as data and this puts it back into the error channel, where
 * consumers can branch on it without parsing prose.
 */
class MediaFetchError extends Error {
    /**
     * @param {string|null} stage one of WhatsApp's MediaDataStage values
     * @param {ErrorOptions} [options] `cause` when this wraps a lower error
     */
    constructor(stage, options) {
        const label =
            stage === undefined ? 'unreported' : (stage ?? 'message gone');
        super(`media fetch failed: ${label}`, options);
        this.name = 'MediaFetchError';
        this.stage = stage;
    }
}

module.exports = { MediaFetchError };
