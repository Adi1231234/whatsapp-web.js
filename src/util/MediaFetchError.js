'use strict';

/**
 * A media fetch that produced no bytes, with the reason still attached.
 *
 * Constructed on the NODE side on purpose. An error thrown inside the WA page
 * loses every custom property at the puppeteer boundary, so the page returns a
 * {@link MediaFailReason} code as data and this class puts it back into the
 * error channel where consumers can branch on it without parsing prose.
 */
class MediaFetchError extends Error {
    /**
     * @param {string} reason one of MediaFailReason
     * @param {object} detail structured context for logs; never parsed
     */
    constructor(reason, detail) {
        super(`media fetch failed: ${reason}`);
        this.name = 'MediaFetchError';
        this.reason = reason;
        this.detail = detail;
    }
}

module.exports = { MediaFetchError };
