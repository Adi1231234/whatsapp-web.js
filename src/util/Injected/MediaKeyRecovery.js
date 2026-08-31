'use strict';

/**
 * Recovers media whose keys WhatsApp Web derived under the wrong media type.
 *
 * Keys come from `HKDF(mediaKey, getMediaTypeInfo(type), 112)`, so encryption is
 * type-bound - while the sender's upload cache is not. `EncryptedMediaEntry`
 * exposes exactly `canReuseMediaKey`, `getMediaKey`, `getMediaKeyTimestamp`,
 * `getEncfilehash` and `url`: no type anywhere. That is the whole bug, and the
 * reason the type cannot simply be looked up - a documentMessage can point at a
 * blob encrypted as an image, and every recipient then fails the HMAC.
 *
 * So the declared type stops being authoritative and WhatsApp is asked to
 * download again under each other type. Guessing is safe because a candidate
 * must pass both the HMAC and the message's own plaintext hash inside
 * `decryptMedia` before its bytes are returned.
 */
exports.InjectMediaKeyRecovery = () => {
    const manager = window.require('WAWebDownloadManager').downloadManager;
    // InjectDiagHooks re-runs on every re-sync; wrapping twice would retry the
    // candidate list once per layer.
    if (!manager || manager.__p2dKeyRecoveryInstalled) return;
    manager.__p2dKeyRecoveryInstalled = true;

    const { MediaDecryptionError } = window.require('WAWebMediaFileErrors');
    const { MEDIA_TYPES } = window.require('WAWebMmsMediaTypes');

    // One entry per distinct key derivation, not per media type. Checked
    // against WhatsApp's own tables rather than assumed: mapping all 42
    // `MEDIA_TYPE_VALUES` through `WAWebCryptoMediaTypeInfo.getMediaTypeInfo`
    // yields 18 info strings, and every type a chat media message can be -
    // sticker and product fold into Image, ptt into Audio, gif and ptv into
    // Video - lands in exactly these four. Image first: every observed
    // occurrence was image ciphertext referenced as a document, and each
    // candidate costs one re-download.
    const CANDIDATES = [
        MEDIA_TYPES.IMAGE,
        MEDIA_TYPES.VIDEO,
        MEDIA_TYPES.AUDIO,
        MEDIA_TYPES.DOCUMENT,
    ];

    const original = manager.downloadAndMaybeDecrypt;
    manager.downloadAndMaybeDecrypt = async function (opts) {
        try {
            return await original.call(this, opts);
        } catch (err) {
            if (!(err instanceof MediaDecryptionError)) throw err;
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
                    // Wrong type as well; try the next one.
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
