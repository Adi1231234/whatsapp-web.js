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
     * @param {object|null} detail structured context for logs; never parsed
     * @param {ErrorOptions} [options] `cause` when this wraps a lower error,
     * so the chain stays intact instead of being flattened into `detail`
     */
    constructor(reason, detail, options) {
        super(`media fetch failed: ${reason}`, options);
        this.name = 'MediaFetchError';
        this.reason = reason;
        this.detail = detail;
    }
}

module.exports = { MediaFetchError };
