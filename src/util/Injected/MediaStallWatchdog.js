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
 * Wraps `MmsV4.downloadMedia` rather than the caller so that WhatsApp's own
 * auto-downloads are covered too: they reach the same function with the same
 * media object, they are ~70% of images, they share one promise per filehash,
 * and a stalled one hangs every message waiting on it.
 *
 * One deliberate consequence of watching here. The re-upload request is inside
 * this function - `downloadManager.rmr({mediaObject, signal, ...})` - and it is
 * a wait with **no timeout and no reject of its own**; its promise is only ever
 * settled by an inbound notification that may never arrive. It takes the same
 * signal the cancel aborts and `WAMemoizeConcurrent` races that signal, so this
 * bounds that wait too. Media that genuinely needs a re-upload is therefore
 * reported as `STALLED` after the grace instead of waiting indefinitely, and the
 * retry re-issues the request - the abort frees the memo keyed on its filehash.
 * Bounded and retried is the point; the unbounded wait is what loses pictures.
 */
exports.InjectMediaStallWatchdog = () => {
    // `WAWebMediaMmsV4Download.downloadMedia`, NOT
    // `downloadManager.downloadAndMaybeDecrypt`. Verified against a live page:
    // the download manager is handed
    // `{directPath, encFilehash, filehash, signal, onProgress, ...}` and **no
    // media object at all**, so a watchdog there can measure nothing and cancel
    // nothing. This layer is handed `{mediaObject, mediaType,
    // downloadEvenIfExpensive, rmrReason, ...}`, sits above the fetch, and is
    // exactly what `cancelDownloadMedia` cancels.
    const mms = window.require('WAWebMediaMmsV4Download');
    if (!mms || typeof mms.downloadMedia !== 'function') return;

    /**
     * The one place that knows a download stalled.
     *
     * `resolveMediaBlob` has to report a stall as itself, and cannot learn it
     * any other way: WhatsApp swallows the `AbortError` rather than rethrowing
     * it, so the reason never reaches the caller. A `WeakSet` rather than a
     * property because the media object is WhatsApp's, and this must leave no
     * trace on it.
     *
     * **Reading does NOT clear the mark**, because one media object can have
     * more than one reader. WhatsApp shares a single `mediaObject` across every
     * message with the same filehash - verified on a live page, two messages,
     * `a.mediaObject === b.mediaObject` - so two copies of one photo can be
     * resolving at the same moment under an intake that runs them in parallel.
     * A destructive read gave the mark to whichever finished first: measured
     * live, one copy returned `STALLED` and the other fell through to the
     * NEED_POKE branch and returned `NEED_POKE`, which the host does not retry,
     * so that picture was lost. It also cost the loser a second 15s attempt
     * through the re-upload path - 30.0s against 15.0s for the same stall.
     *
     * Not clearing is safe because the wrapper clears at the START of every
     * attempt instead: the mark can only ever describe the most recent attempt
     * on this media object, and a successful attempt has already removed it
     * before anyone can read it. Verified live: stall -> `STALLED`, then a
     * recovering attempt -> success with the mark already gone.
     *
     * Kept on the manager and republished on EVERY injection, above the
     * install guard. `LoadUtils` re-runs on each re-sync and assigns
     * `window.WWebJS = {}`, so a reader published only once is destroyed by the
     * first re-sync - after which every stall would quietly read as the
     * FETCHING it was left in, which the host does not retry. The set itself
     * must outlive that, or the wrapper below would mark into one instance
     * while the reader consulted another.
     */
    const stalls = mms.__mediaStalls || (mms.__mediaStalls = new WeakSet());
    const markStalled = (mediaObject) => stalls.add(mediaObject);
    const forgetStall = (mediaObject) => stalls.delete(mediaObject);
    window.WWebJS = window.WWebJS || {};
    window.WWebJS.mediaStalls = {
        /** Whether the most recent attempt on this media object stalled. */
        stalled: (mediaObject) =>
            mediaObject ? stalls.has(mediaObject) : false,
    };

    // Re-injected on every re-sync; a second wrapper would double every timer.
    if (mms.__mediaStallWatchdogInstalled) return;
    mms.__mediaStallWatchdogInstalled = true;

    // The same module's own cancel: `WAWebMediaCancelDownloadMsg` only forwards
    // to it, so taking it here keeps the dependency to one module.
    const { cancelDownloadMedia } = mms;
    // The only trustworthy "it worked" signal at this layer - see cancelAndSettle.
    const { RESOLVED } = window.require('WAWebMediaTypes').DownloadStage;

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

    /**
     * How long the abort itself gets before this gives up on it too.
     *
     * The cancel reaches an `AbortController` that WhatsApp registers for this
     * media object, and normally settles the download at once - but if it was
     * never registered, or the fetch had already finished and a decrypt is
     * running, nothing settles. Waiting on the recovery without a bound would
     * reintroduce the very defect this file exists to remove.
     */
    const ABORT_SETTLE_MS = 5000;

    const hasStalled = (bytes, elapsedMs) =>
        elapsedMs >= GRACE_MS &&
        bytes / (elapsedMs / 1000) < FLOOR_BYTES_PER_SEC;

    /** An error WhatsApp routes as a cancellation rather than a failure. */
    const abortError = () => {
        const error = new Error('mediaDownload: stalled');
        error.name = 'AbortError';
        return error;
    };

    /** A bound that resolves with `fallback`, and never keeps a timer alive. */
    const deadline = (ms, fallback) => {
        let timer = null;
        const promise = new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallback), ms);
        });
        return { promise, stop: () => clearTimeout(timer) };
    };

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
        // `loadedSize` is never reset - not by `clearBlob`, not by the INIT
        // consolidate - so a media object that already completed a download
        // still carries its full byte count. Measure what THIS attempt
        // delivers, or a re-download after a cache eviction reads the old
        // total as healthy progress and the stall is never seen. A decrease
        // means WhatsApp's counter restarted, so follow it down.
        let baseline = mediaObject.loadedSize || 0;
        let timer = null;
        const promise = new Promise((resolve) => {
            timer = setInterval(() => {
                const current = mediaObject.loadedSize || 0;
                if (current < baseline) baseline = current;
                const loadedSize = current - baseline;
                const elapsedMs = Date.now() - startedAt;
                if (hasStalled(loadedSize, elapsedMs))
                    resolve({ loadedSize, elapsedMs });
            }, SAMPLE_MS);
        });
        return { promise, stop: () => clearInterval(timer) };
    };

    /**
     * Cancels the stalled download and settles on what actually happened.
     *
     * Bounded on purpose: the cancel reaches an `AbortController` WhatsApp
     * registers for this media object and normally settles it at once, but if
     * none was registered, or the fetch had finished and a decrypt is running,
     * nothing settles. Waiting on the recovery without a bound would reintroduce
     * the very defect this file exists to remove.
     */
    const cancelAndSettle = async (mediaObject, download) => {
        try {
            // Aborts the request WhatsApp is already listening on, which also
            // releases the one promise every message with this filehash awaits.
            cancelDownloadMedia(mediaObject);
        } catch (cancelFailed) {
            // Swallowed deliberately. Letting this escape would hand WhatsApp a
            // failure that is not an abort, which it routes to NEED_POKE - and
            // NEED_POKE is answered by the re-upload request, a wait with no
            // timeout of its own. The bound below still ends this download, and
            // the verdict below is still the honest one.
            window.__metrics?.safeDiagLog?.(
                'warn',
                'MEDIA_DOWNLOAD_CANCEL_FAILED',
                { message: String(cancelFailed?.message || cancelFailed) },
            );
        }
        const settled = deadline(ABORT_SETTLE_MS, null);
        try {
            const outcome = await Promise.race([
                download.then(
                    (bytes) => ({ bytes }),
                    (error) => ({ error }),
                ),
                settled.promise,
            ]);

            // Whether it worked is asked of WhatsApp's own state, never of the
            // return value. This function swallows its own `AbortError`
            // (`if (e.name === ABORT_ERROR) ... return`) and RESOLVES with
            // `undefined` - which is also what it resolves with on success - so
            // the settled value cannot tell a cancelled download from a
            // finished one. Verified on a live page: a cancelled attempt left
            // `downloadStage: NEED_POKE` and no blob.
            if (mediaObject.downloadStage === RESOLVED) return outcome?.bytes;

            markStalled(mediaObject);
            // WhatsApp's own AbortError when we have one, an equivalent when it
            // swallowed it or the abort never landed. That name is what makes
            // WhatsApp unwind without setting NEED_POKE, and so keeps a stall
            // clear of the re-upload request - itself a wait with no timeout.
            throw outcome?.error ?? abortError();
        } finally {
            settled.stop();
        }
    };

    const report = (opts, mediaObject, stall) =>
        window.__metrics?.safeDiagLog?.('info', 'MEDIA_DOWNLOAD_STALLED', {
            type: opts.mediaType ?? null,
            loadedSize: stall.loadedSize,
            expectedSize: mediaObject.size ?? null,
            elapsedMs: stall.elapsedMs,
            filehash: mediaObject.filehash?.slice(0, 24) ?? null,
        });

    const original = mms.downloadMedia;
    mms.downloadMedia = async function (opts) {
        const mediaObject = opts?.mediaObject;
        // A caller that brings no media object offers nothing to measure.
        if (!mediaObject) return original.call(this, opts);
        // Queued work is timed from the wrong instant. `preloader.enqueue` and
        // `loadSequence.enqueue` sit further down, inside the download manager,
        // so for these the clock would measure waiting for a slot - at zero
        // bytes, indistinguishable from a stall - rather than transferring. The
        // downloads this exists for do not take the flag.
        if (opts.shouldSequenceDownload === true)
            return original.call(this, opts);

        // Every attempt starts clean, so a verdict can only ever describe the
        // download it came from.
        forgetStall(mediaObject);
        const download = original.call(this, opts);
        const watchdog = whenStalled(mediaObject);
        try {
            const stall = await Promise.race([
                download.then(() => null),
                watchdog.promise,
            ]);
            if (!stall) return await download;
            try {
                return await cancelAndSettle(mediaObject, download);
            } catch (stalled) {
                // Reported only once the stall is confirmed. Logging on
                // detection would count the downloads that beat the abort and
                // returned their bytes, which are successes.
                report(opts, mediaObject, stall);
                throw stalled;
            }
        } finally {
            watchdog.stop();
        }
    };
};
