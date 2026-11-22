'use strict';

/** Set on a document's global object by the first preparation of it. */
const CLAIM_MARK = '__wwebjsDocumentClaimed';

/**
 * In the page: claims the document for one preparation. Check and mark are
 * one synchronous step, so of two callers on one document only the first gets
 * the address back. Self-contained: `page.evaluate` sends its source alone.
 */
function ClaimDocumentInPage(mark) {
    if (window[mark]) return null;
    window[mark] = true;
    const entry = window.performance.getEntriesByType('navigation')[0];
    return entry ? entry.name : window.location.href;
}

/**
 * The address the page's current document was loaded from, or null when a
 * preparation has already claimed this document (README.md).
 */
function claimDocument(page) {
    return page.evaluate(ClaimDocumentInPage, CLAIM_MARK);
}

module.exports = { claimDocument };
