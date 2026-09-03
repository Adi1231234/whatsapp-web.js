'use strict';

/**
 * Ends media downloads that have stopped delivering bytes.
 *
 * Nothing between the download manager and the socket has a deadline: the media
 * fetch is an `XMLHttpRequest` whose `timeout` is never set, so a half-open
 * connection hangs until the OS gives up. Measured in production: a
 * 198,950-byte image sat for **8h36m**, was reset, and then completed 311ms
 * later - the bytes had been retrievable the whole time.
 *
 * WhatsApp cannot end it on its own. Its backoff (`{minTimeout: 1000,
 * retries: 3}`) and host rotation only advance when an attempt *fails*, and a
 * stall never fails; its one stall detector is gated to `DOCUMENT` above 50 MB
 * and waits 5 minutes before the first check, so an image is never covered.
 * Cancelling is therefore not impatience - it is the only way to turn a stall
 * into the error that unlocks WhatsApp's own retry.
 *
 * Wraps `downloadAndMaybeDecrypt` rather than the caller so that WhatsApp's own
 * auto-downloads are covered too: they are ~70% of images, they share one
 * promise per filehash, and a stalled one hangs every message waiting on it.
 */
exports.InjectMediaStallWatchdog = () => {
    const manager = window.require('WAWebDownloadManager').downloadManager;
    // Re-injected on every re-sync; a second wrapper would double every timer.
    if (!manager || manager.__mediaStallWatchdogInstalled) return;
    manager.__mediaStallWatchdogInstalled = true;

    const { cancelDownloadMedia } = window.require(
        'WAWebMediaCancelDownloadMsg',
    );

    /**
     * Below this a download is not slow, it is stopped.
     *
     * Measured fleet-wide over 30 days: the slowest download that still
     * completed ran at 11.37 KB/s, and the 8h36m stall at 0.0063 KB/s. This
     * floor sits 5.6x under the first and 325x over the second - the two
     * populations are three orders of magnitude apart, so its exact value is
     * not delicate.
     */
    const FLOOR_BYTES_PER_SEC = 2048;

    /**
     * How long before throughput is judged at all.
     *
     * A download has no meaningful rate in its first moments. The median image
     * finishes in 251ms, far inside this, so the common case never reaches a
     * single evaluation; the slowest completing download would by now have
     * delivered ~170 KB, 85x the floor.
     */
    const GRACE_MS = 15000;

    /** Evaluation interval. The verdict must be timely, not precise. */
    const SAMPLE_MS = 5000;

    const hasStalled = (bytes, elapsedMs) =>
        elapsedMs >= GRACE_MS &&
        bytes / (elapsedMs / 1000) < FLOOR_BYTES_PER_SEC;

    /**
     * Resolves only if the download stops delivering bytes, never otherwise.
     *
     * `loadedSize` is WhatsApp's own progress, written from `xhr.onprogress`
     * through a 100ms throttle. Sampled rather than driven by
     * `change:loadedSize` because the condition is the *absence* of progress:
     * an event-driven version needs this same timer, and would additionally
     * bind a listener to a model this layer does not otherwise touch.
     */
    const whenStalled = (mediaObject) => {
        const startedAt = Date.now();
        let timer = null;
        const promise = new Promise((resolve) => {
            timer = setInterval(() => {
                const loadedSize = mediaObject.loadedSize || 0;
                const elapsedMs = Date.now() - startedAt;
                if (hasStalled(loadedSize, elapsedMs))
                    resolve({ loadedSize, elapsedMs });
            }, SAMPLE_MS);
        });
        return { promise, stop: () => clearInterval(timer) };
    };

    const original = manager.downloadAndMaybeDecrypt;
    manager.downloadAndMaybeDecrypt = async function (opts) {
        const mediaObject = opts && opts.mediaObject;
        // A caller that brings no media object offers nothing to measure.
        if (!mediaObject) return original.call(this, opts);

        const download = original.call(this, opts);
        const watchdog = whenStalled(mediaObject);
        try {
            const stall = await Promise.race([
                download.then(() => null),
                watchdog.promise,
            ]);
            if (!stall) return await download;

            window.__metrics?.safeDiagLog?.('info', 'MEDIA_DOWNLOAD_STALLED', {
                type: opts.type,
                loadedSize: stall.loadedSize,
                expectedSize: mediaObject.size ?? null,
                elapsedMs: stall.elapsedMs,
                directPath: opts.directPath
                    ? opts.directPath.slice(0, 80)
                    : null,
            });

            // Aborts the request WhatsApp is already listening on, which also
            // releases the one promise every message with this filehash awaits.
            cancelDownloadMedia(mediaObject);
            try {
                // A download that beat the abort by a hair still has its bytes,
                // and bytes always win: the stall is only real if it failed.
                return await download;
            } catch (aborted) {
                // Read by resolveMediaBlob, so a stall is reported as itself
                // rather than as the FETCHING it would otherwise look like.
                mediaObject.__downloadStalled = true;
                // Rethrown untouched: it is WhatsApp's own AbortError, and that
                // name is what makes WhatsApp unwind without setting NEED_POKE
                // - which is what keeps a stall clear of the re-upload request,
                // itself a wait with no timeout.
                throw aborted;
            }
        } finally {
            watchdog.stop();
        }
    };
};
