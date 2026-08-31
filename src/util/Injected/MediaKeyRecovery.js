'use strict';

/**
 * Recovers media whose keys WhatsApp Web derived under the wrong media type.
 *
 * Keys come from `HKDF(mediaKey, "WhatsApp <Type> Keys", 112)`, so encryption is
 * type-bound, while the sender's upload cache is not: `getUploadEntry()` is
 * keyed by encFilehash with no type filter, so a documentMessage can point at a
 * blob that was encrypted as an image and every recipient fails the HMAC.
 *
 * The remedy is to stop treating the declared type as authoritative and ask
 * WhatsApp to download again under each other type. Guessing is safe because a
 * candidate must pass both the HMAC and the message's own `expectedPlaintextHash`
 * inside `decryptMedia` before its bytes are returned.
 */
exports.InjectMediaKeyRecovery = () => {
    const manager = window.require('WAWebDownloadManager').downloadManager;
    // InjectDiagHooks re-runs on every re-sync; wrapping twice would retry the
    // candidate list once per layer.
    if (!manager || manager.__p2dKeyRecoveryInstalled) return;
    manager.__p2dKeyRecoveryInstalled = true;

    const original = manager.downloadAndMaybeDecrypt;
    manager.downloadAndMaybeDecrypt = async function (opts) {
        try {
            return await original.call(this, opts);
        } catch (err) {
            if (
                err?.name !== 'MediaDecryptionError' ||
                !String(err.message).includes('hmac mismatch')
            )
                throw err;
            // Image first: every observed occurrence was image ciphertext
            // referenced as a document.
            for (const type of ['image', 'video', 'audio', 'document']) {
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
            window.__metrics?.safeDiagLog?.('warn', 'MEDIA_KEY_TYPE_UNRECOVERED', {
                declaredType: opts.type,
            });
            throw err;
        }
    };
};
