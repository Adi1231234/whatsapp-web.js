'use strict';

/**
 * Installs the key-type recovery around WhatsApp's own media download.
 * `src/util/MediaKeyTypeRecovery.js` holds the why and the policy.
 *
 * Wrapping point measured on a live page: `downloadAndMaybeDecrypt` is an own,
 * writable property with 14 call sites, so every consumer is covered including
 * WhatsApp's own UI, and the two functions one level deeper are FUNCTION
 * modules that `injectToFunction` cannot reach. It returns an ArrayBuffer, not
 * a Blob - the Blob is built one level up, which the minified source hides.
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
                // Say why. Rethrowing the decrypt error while dropping this one
                // would report a key problem for what was actually a network
                // one, and nothing else records this fetch.
                window.__metrics?.safeDiagLog?.(
                    'warn',
                    'MEDIA_KEY_REFETCH_FAILED',
                    {
                        declaredType: opts.type,
                        error: String(
                            (downloadErr && downloadErr.message) || downloadErr,
                        ),
                    },
                );
                throw err;
            }

            // The candidates that did NOT work. Named for what it holds: on a
            // first-try success it is empty, which would read as "nothing was
            // attempted" under any other name.
            const rejected = [];
            let recovered = null;
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
                    recovered = { candidate, plaintext };
                    break;
                } catch {
                    // The try covers only the two calls meant to fail here;
                    // reporting and returning stay outside it, so neither can
                    // be mistaken for a rejected candidate.
                    rejected.push(candidate);
                }
            }

            if (!recovered) {
                window.__metrics?.safeDiagLog?.(
                    'warn',
                    'MEDIA_KEY_TYPE_UNRECOVERED',
                    {
                        declaredType: opts.type,
                        rejected,
                        elapsed: Date.now() - started,
                    },
                );
                throw err;
            }

            const bytes =
                recovered.plaintext instanceof Uint8Array
                    ? recovered.plaintext
                    : new Uint8Array(recovered.plaintext);
            window.__metrics?.safeDiagLog?.(
                'info',
                'MEDIA_KEY_TYPE_RECOVERED',
                {
                    declaredType: opts.type,
                    recoveredAs: recovered.candidate,
                    rejected,
                    byteLength: bytes.byteLength,
                    elapsed: Date.now() - started,
                },
            );
            return bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            );
        }
    };
};
