'use strict';

/**
 * Recovers media whose keys were derived under the wrong media type.
 *
 * Keys are `HKDF(mediaKey, getMediaTypeInfo(type))`, so they are type-bound
 * while the upload cache is not, and a documentMessage can point at image
 * ciphertext. The HMAC and plaintext hash make trying another type safe.
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

    // One representative per distinct HKDF info string, derived from the tables
    // so it cannot drift. Types that cannot be keyed throw and drop out.
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
    // Image first: the common case, and each candidate costs a download.
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
