'use strict';

/**
 * Recovers media whose keys WhatsApp derived under the wrong media type.
 *
 * Keys are `HKDF(mediaKey, getMediaTypeInfo(type))`, so encryption is
 * type-bound while the sender's upload cache is not - `EncryptedMediaEntry`
 * stores no type - and a documentMessage can point at image ciphertext. The
 * declared type is therefore a hint; the HMAC and plaintext hash inside
 * `decryptMedia` are the authority, so trying another type is safe.
 */
exports.InjectMediaKeyRecovery = () => {
    const manager = window.require('WAWebDownloadManager').downloadManager;
    // Re-injected on every re-sync; a second wrapper would retry per layer.
    if (!manager || manager.__mediaKeyTypeRecoveryInstalled) return;
    manager.__mediaKeyTypeRecoveryInstalled = true;

    const { MediaDecryptionError, PLAINTEXT_HASH_MISMATCH_ERROR } =
        window.require('WAWebMediaFileErrors');
    const { MEDIA_TYPES, msgToMediaType } =
        window.require('WAWebMmsMediaTypes');
    const { getMediaTypeInfo } = window.require('WAWebCryptoMediaTypeInfo');
    const { MSG_TYPE } = window.require('WAWebMsgType');

    // The MAC is checked before decryption, so wrong keys can only fail as
    // HMAC. A plaintext hash mismatch means the keys were right.
    const isWrongKeys = (err) =>
        err instanceof MediaDecryptionError &&
        !String(err.message).includes(PLAINTEXT_HASH_MISMATCH_ERROR);

    // Derived from WhatsApp's own tables rather than listed here, so it cannot
    // drift: every message type mapped through `msgToMediaType`, then reduced to
    // one representative per distinct HKDF info string, since two types sharing
    // an info string derive identical keys and a second attempt would be waste.
    // Types WhatsApp refuses to key - profile pictures, newsletter media - throw
    // in `getMediaTypeInfo` and drop out here.
    const byInfo = new Map();
    for (const msgType of Object.values(MSG_TYPE)) {
        try {
            const mediaType = msgToMediaType({ type: msgType });
            const info = mediaType && getMediaTypeInfo(mediaType);
            if (info && !byInfo.has(info)) byInfo.set(info, mediaType);
        } catch {
            // Not encryptable, so never a candidate.
        }
    }
    // Image first: it is the common case, and each candidate costs a download.
    const CANDIDATES = [...new Set([MEDIA_TYPES.IMAGE, ...byInfo.values()])];

    const original = manager.downloadAndMaybeDecrypt;
    manager.downloadAndMaybeDecrypt = async function (opts) {
        try {
            return await original.call(this, opts);
        } catch (err) {
            if (!isWrongKeys(err)) throw err;
            for (const type of CANDIDATES) {
                if (type === opts.type) continue;
                try {
                    const bytes = await original.call(this, { ...opts, type });
                    window.__metrics?.safeDiagLog?.(
                        'info',
                        'MEDIA_KEY_TYPE_RECOVERED',
                        {
                            declaredType: opts.type,
                            recoveredAs: type,
                            byteLength: bytes?.byteLength,
                        },
                    );
                    return bytes;
                } catch {
                    // Wrong type too.
                }
            }
            window.__metrics?.safeDiagLog?.(
                'warn',
                'MEDIA_KEY_TYPE_UNRECOVERED',
                { declaredType: opts.type },
            );
            throw err;
        }
    };
};
