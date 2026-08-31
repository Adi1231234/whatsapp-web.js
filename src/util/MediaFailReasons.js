'use strict';

/**
 * Why a media fetch did not produce bytes.
 *
 * The ONE vocabulary that crosses the page boundary, and it has to be data
 * rather than an exception: puppeteer copies only `name`, `message` and `stack`
 * off an in-page throw, so a reason thrown there reaches Node as prose - which
 * is why the consumer used to ask `message.includes('media not available')`.
 *
 * Keep the codes stable: consumers persist them (pic2desk writes them into its
 * message ledger) and query them in log aggregation.
 */
const MediaFailReason = {
    /** The message or its mediaData is gone - usually a revoke that raced us. */
    MESSAGE_GONE: 'MESSAGE_GONE',
    /** WhatsApp is re-uploading the media; nothing to fetch yet. */
    REUPLOADING: 'REUPLOADING',
    /** The message never carried a media pointer, so it has not synced yet. */
    NOT_SYNCED: 'NOT_SYNCED',
    /** WhatsApp settled on a terminal stage (ERROR, FETCHING, NEED_POKE). */
    MEDIA_UNAVAILABLE: 'MEDIA_UNAVAILABLE',
    /** Download and decrypt finished without leaving a blob behind. */
    NO_BLOB: 'NO_BLOB',
    /** Unclassifiable. Lives here so no consumer has to widen the type. */
    UNKNOWN: 'UNKNOWN',
};

/** @returns {boolean} whether `value` is one of the codes above */
function isMediaFailReason(value) {
    return (
        typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(MediaFailReason, value)
    );
}

module.exports = { MediaFailReason, isMediaFailReason };
