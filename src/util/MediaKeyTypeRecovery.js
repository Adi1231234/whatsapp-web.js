'use strict';

/**
 * Recovering media whose keys were derived under the wrong media type.
 *
 * WhatsApp derives the media keys with
 * `HKDF(mediaKey, getMediaTypeInfo(type), 112)` -> iv|encKey|macKey|refKey, so
 * the INFO STRING is chosen by the media type: "WhatsApp Image Keys" vs
 * "WhatsApp Document Keys". Encryption is therefore type-bound.
 *
 * The sender's storage is not. `entries.getUploadEntry()` returns the first
 * ENCRYPTED entry for a file, keyed by encFilehash alone with no type filter,
 * and `EncryptedMediaEntry.canReuseMediaKey()` is only
 * `directPath != null && isMediaKeyReusable(mediaKeyTimestamp)` - also no type
 * check. So WhatsApp Web's upload fast-forward can point a documentMessage at a
 * blob that was encrypted as an image, and every recipient then derives
 * "WhatsApp Document Keys" against image ciphertext and fails the HMAC.
 *
 * Measured on this fleet: 91 events in 30 days, ALL of them `type: document`,
 * 0 images, and the same blob that failed as a document decrypted as an image.
 *
 * The remedy is to stop treating the declared type as authoritative:
 *
 *   the declared media type is a HINT; the HMAC and the plaintext hash are the
 *   AUTHORITY.
 *
 * Trying another info string is safe because a candidate has to pass two
 * independent checks before its bytes are accepted:
 *   1. HMAC-SHA256 over `iv || ciphertext`, truncated to 10 bytes (80 bits);
 *   2. `expectedPlaintextHash`, the SHA-256 the message itself declares, which
 *      `decryptMedia` verifies and rejects with "plaintext hash mismatch".
 * All 91 production failures carried that hash, so the second gate is live in
 * every real case.
 */

/** Only a decryption HMAC failure is recoverable this way. */
const RECOVERABLE_ERROR_NAME = 'MediaDecryptionError';
const RECOVERABLE_MESSAGE_FRAGMENT = 'hmac mismatch';

/**
 * Candidate media types, in the order worth trying.
 *
 * These are the four distinct HKDF info strings that real chat media uses
 * ("WhatsApp Image/Video/Audio/Document Keys"). Image comes first because every
 * observed occurrence was an image-encrypted blob referenced as a document.
 * Thumbnail and newsletter types are deliberately absent: a thumbnail is a
 * different object with a different length, and newsletter media is not
 * encrypted at all.
 */
const CANDIDATE_MEDIA_TYPES = ['image', 'video', 'audio', 'document'];

/**
 * @param {string} declaredType the type WhatsApp says the message is
 * @returns {string[]} the types to try, excluding the one that already failed
 */
function candidateTypesFor(declaredType) {
    return CANDIDATE_MEDIA_TYPES.filter((type) => type !== declaredType);
}

/**
 * @param {string|null|undefined} errorName
 * @param {string|null|undefined} errorMessage
 * @returns {boolean} whether this failure is a key-type mismatch worth retrying
 */
function isKeyTypeMismatch(errorName, errorMessage) {
    return (
        errorName === RECOVERABLE_ERROR_NAME &&
        typeof errorMessage === 'string' &&
        errorMessage.includes(RECOVERABLE_MESSAGE_FRAGMENT)
    );
}

module.exports = {
    RECOVERABLE_ERROR_NAME,
    RECOVERABLE_MESSAGE_FRAGMENT,
    CANDIDATE_MEDIA_TYPES,
    candidateTypesFor,
    isKeyTypeMismatch,
};
