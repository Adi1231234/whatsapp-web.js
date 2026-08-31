'use strict';

/**
 * Why a media fetch did not produce bytes.
 *
 * This is the ONE vocabulary that crosses the page boundary. It has to be data
 * rather than an exception because puppeteer's `createEvaluationError` rebuilds
 * an in-page throw as `new Error(message)` and copies only `name`, `message`
 * and `stack` - every custom property is dropped. Anything thrown inside the WA
 * page therefore reaches Node as prose, which is exactly why the consumer used
 * to ask `error.message.includes('media not available')`.
 *
 * So `resolveMediaBlob` RETURNS one of these codes and Node turns it back into a
 * typed error (`MediaFetchError`) on the far side, where properties survive.
 *
 * Keep the codes stable: they are persisted by consumers (pic2desk writes them
 * into its message ledger) and queried in log aggregation.
 */
const MediaFailReason = {
    /** The message or its mediaData is gone - usually a revoke that raced us. */
    MESSAGE_GONE: 'MESSAGE_GONE',
    /** WhatsApp is re-uploading the media; nothing to fetch yet. */
    REUPLOADING: 'REUPLOADING',
    /** The message never carried a media pointer, so it has not synced yet. */
    NOT_SYNCED: 'NOT_SYNCED',
    /** WhatsApp settled on a terminal media stage (ERROR, FETCHING, NEED_POKE). */
    MEDIA_UNAVAILABLE: 'MEDIA_UNAVAILABLE',
    /** Download and decrypt finished without leaving a blob behind. */
    NO_BLOB: 'NO_BLOB',
};

/**
 * @param {unknown} value
 * @returns {boolean} whether `value` is one of the codes above
 */
function isMediaFailReason(value) {
    return (
        typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(MediaFailReason, value)
    );
}

module.exports = { MediaFailReason, isMediaFailReason };
