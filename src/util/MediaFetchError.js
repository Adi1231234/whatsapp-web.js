'use strict';

/**
 * A media fetch that produced no bytes, with the reason still attached.
 *
 * Constructed on the NODE side on purpose: an error thrown inside the WA page
 * loses every custom property at the puppeteer boundary, so the page returns a
 * {@link MediaFailReason} code as data and this puts it back into the error
 * channel, where consumers can branch on it without parsing prose.
 */
class MediaFetchError extends Error {
    /**
     * @param {string} reason one of MediaFailReason
     * @param {ErrorOptions} [options] `cause` when this wraps a lower error
     */
    constructor(reason, options) {
        super(`media fetch failed: ${reason}`, options);
        this.name = 'MediaFetchError';
        this.reason = reason;
    }
}

module.exports = { MediaFetchError };
