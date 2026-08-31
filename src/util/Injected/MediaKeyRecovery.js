'use strict';

/**
 * Installs the key-type recovery around WhatsApp's own media download.
 *
 * See `src/util/MediaKeyTypeRecovery.js` for why this is needed and why trying
 * another info string cannot accept wrong bytes. The policy lives there and is
 * passed in, so the candidate order and the predicate have exactly one home.
 *
 * Wrapping point: `downloadManager.downloadAndMaybeDecrypt`. Measured on a live
 * page - it is an own, writable property with 14 call sites across the bundles,
 * so every consumer is covered, including WhatsApp's own UI. The two functions
 * one level deeper (`WAWebCryptoDecryptMedia`, `WAWebCryptoCreateMediaKeys`)
 * are FUNCTION modules, so `injectToFunction` cannot reach them.
 *
 * It returns an ArrayBuffer, not a Blob. Measured, and easy to get wrong by
 * reading the minified source, where the Blob is built one level up.
 *
 * @param {object} policy
 * @param {string} policy.recoverableErrorName
 * @param {string} policy.recoverableMessageFragment
 * @param {string[]} policy.candidateMediaTypes
 */
exports.InjectMediaKeyRecovery = (policy) => {
    const manager = window.require('WAWebDownloadManager').downloadManager;
    // InjectDiagHooks re-runs on every re-sync; wrapping twice would retry the
    // candidate list once per layer.
    if (!manager || manager.__p2dKeyRecoveryInstalled) return;
    manager.__p2dKeyRecoveryInstalled = true;

    const original = manager.downloadAndMaybeDecrypt;
    const createMediaKeys = window.require('WAWebCryptoCreateMediaKeys');
    const decryptMedia = window.require('WAWebCryptoDecryptMedia');
    const mmsClient = window.require('WAWebMmsClient');
    const noop = () => {};

    const isRecoverable = (err) =>
        err &&
        err.name === policy.recoverableErrorName &&
        String(err.message || '').includes(policy.recoverableMessageFragment);

    /** Re-fetch the ciphertext. MmsClient validates it against encFilehash. */
    const fetchCiphertext = (opts) =>
        mmsClient.download({
            directPath: opts.directPath,
            filehash: opts.encFilehash,
            staticUrl: opts.staticUrl == null ? null : opts.staticUrl,
            type: opts.type,
            signal: opts.signal || new AbortController().signal,
            mode: 'manual',
            byteRange: null,
            onData: null,
            onProgress: noop,
            onHeadersReceived: noop,
            onDownloadHostFound: noop,
            onDownloadAttemptSuccess: noop,
            onDownloadAttemptError: noop,
            debugString: 'media-key-recovery',
        });

    manager.downloadAndMaybeDecrypt = async function (opts) {
        try {
            return await original.call(this, opts);
        } catch (err) {
            if (!isRecoverable(err) || !opts || !opts.mediaKey) throw err;

            const started = Date.now();
            let ciphertext;
            try {
                ciphertext = new Uint8Array(await fetchCiphertext(opts));
            } catch (downloadErr) {
                throw err;
            }

            const attempted = [];
            for (const candidate of policy.candidateMediaTypes) {
                if (candidate === opts.type) continue;
                try {
                    const keys = await createMediaKeys(
                        candidate,
                        opts.mediaKey,
                    );
                    const plaintext = await decryptMedia({
                        ciphertextHmac: ciphertext,
                        debugString: 'media-key-recovery',
                        // The message's own SHA-256. decryptMedia rejects a
                        // wrong plaintext with "plaintext hash mismatch", so a
                        // candidate cannot smuggle bytes past this.
                        expectedPlaintextHash: opts.filehash,
                        mediaKeys: keys,
                    });
                    const bytes =
                        plaintext instanceof Uint8Array
                            ? plaintext
                            : new Uint8Array(plaintext);
                    window.__metrics?.safeDiagLog?.(
                        'info',
                        'MEDIA_KEY_TYPE_RECOVERED',
                        {
                            declaredType: opts.type,
                            recoveredAs: candidate,
                            attempted,
                            byteLength: bytes.byteLength,
                            elapsed: Date.now() - started,
                        },
                    );
                    return bytes.buffer.slice(
                        bytes.byteOffset,
                        bytes.byteOffset + bytes.byteLength,
                    );
                } catch (candidateErr) {
                    attempted.push(candidate);
                }
            }

            window.__metrics?.safeDiagLog?.(
                'warn',
                'MEDIA_KEY_TYPE_UNRECOVERED',
                {
                    declaredType: opts.type,
                    attempted,
                    elapsed: Date.now() - started,
                },
            );
            throw err;
        }
    };
};
