const { expect } = require('chai');
const sinon = require('sinon');
const {
    InjectMediaStallWatchdog,
} = require('../../src/util/Injected/MediaStallWatchdog');
const { evaluateInPage } = require('./evaluateBoundary');

const KB = 1024;

/**
 * The options `WAWebMediaMmsV4Download.downloadMedia` is really called with,
 * copied from a live page rather than invented.
 *
 * This matters more than it looks. The watchdog first wrapped
 * `downloadManager.downloadAndMaybeDecrypt`, whose options are
 * `{directPath, encFilehash, filehash, signal, onProgress, ...}` and carry **no
 * media object at all** - so it returned early on every real download and was
 * inert in production. Every test passed, because the double invented a
 * `mediaObject` the real caller never passes. A double that does not match the
 * real shape hides exactly the bug it was written to catch.
 */
const realOpts = (mediaObject, extra) => ({
    mimetype: 'image/jpeg',
    mediaObject,
    downloadEvenIfExpensive: true,
    mediaType: 'image',
    rmrReason: 1,
    rmrData: undefined,
    downloadOrigin: null,
    isVcardOverMmsDocument: false,
    mode: 'manual',
    isAutoDownload: false,
    isViewOnce: false,
    chatWid: null,
    shouldSequenceDownload: false,
    shouldThrow: undefined,
    experienceIds: undefined,
    ...extra,
});

/**
 * The real shape of a media download.
 *
 * A stalled one never settles on its own - that is the whole defect - so the
 * double settles ONLY when WhatsApp's cancel path reaches it, and then in the
 * way WhatsApp really behaves at this layer: see `onCancel` below.
 */
function page() {
    const logs = [];
    const cancelled = [];
    let inFlight = null;
    // What an abort really does at this layer. `MmsV4.downloadMedia` catches
    // its own `AbortError` (`if (e.name === ABORT_ERROR) ... return`) and
    // RESOLVES with `undefined` - the very value it also resolves with on
    // success - leaving `downloadStage` wherever the failure left it. A double
    // that rejected here would hide the fact that the return value cannot tell
    // a cancelled download from a finished one.
    let onCancel = () => inFlight.resolve(undefined);

    // The module under test wraps this module's own `downloadMedia`, and takes
    // `cancelDownloadMedia` from the same object.
    const mms = {
        downloadMedia(opts) {
            return new Promise((resolve, reject) => {
                inFlight = { resolve, reject, opts };
            });
        },
        cancelDownloadMedia(mediaObject) {
            cancelled.push(mediaObject);
            onCancel();
        },
    };

    global.window = {
        require(name) {
            if (name === 'WAWebMediaMmsV4Download') return mms;
            if (name === 'WAWebMediaTypes')
                return {
                    DownloadStage: {
                        RESOLVED: 'RESOLVED',
                        NEED_POKE: 'NEED_POKE',
                        FETCHING: 'FETCHING',
                        INIT: 'INIT',
                    },
                };
            throw new Error(`unexpected module ${name}`);
        },
        __metrics: {
            safeDiagLog: (level, event, data) =>
                logs.push({ level, event, data }),
        },
    };

    return {
        mms,
        logs,
        cancelled,
        stalls: () => global.window.WWebJS.mediaStalls,
        inFlight: () => inFlight,
        setOnCancel: (fn) => {
            onCancel = fn;
        },
    };
}

/** What WhatsApp leaves behind when a download genuinely finishes. */
function succeed(world, mediaObject, value) {
    mediaObject.downloadStage = 'RESOLVED';
    world.inFlight().resolve(value);
}

/** A download that is progressing at `bytesPerSec`, driven by the fake clock. */
function progressing(mediaObject, bytesPerSec) {
    return setInterval(() => {
        mediaObject.loadedSize = (mediaObject.loadedSize || 0) + bytesPerSec;
    }, 1000);
}

describe('media stall watchdog', function () {
    let clock;

    beforeEach(function () {
        clock = sinon.useFakeTimers({
            toFake: [
                'setInterval',
                'clearInterval',
                'setTimeout',
                'clearTimeout',
                'Date',
            ],
        });
    });

    afterEach(function () {
        clock.restore();
        delete global.window;
    });

    it('wraps the layer that actually carries the media object', function () {
        const world = page();
        const before = world.mms.downloadMedia;
        evaluateInPage(InjectMediaStallWatchdog);
        // The bug this replaces: wrapping a layer whose options have no media
        // object, where the watchdog can neither measure nor cancel.
        expect(world.mms.downloadMedia).to.not.equal(before);
        expect(world.mms.__mediaStallWatchdogInstalled).to.equal(true);
        expect(world.stalls()).to.not.equal(undefined);
    });

    it('passes a download that completes through untouched', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 0, size: 200 * KB };

        const result = world.mms.downloadMedia(realOpts(mo));
        succeed(world, mo, 'bytes');

        expect(await result).to.equal('bytes');
        expect(world.cancelled).to.be.empty;
        expect(clock.countTimers()).to.equal(0);
    });

    it('cancels a download that never delivers a byte', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 0, size: 200 * KB, filehash: 'abc123def456' };

        const result = world.mms.downloadMedia(realOpts(mo));
        const settled = result.catch((err) => err);

        await clock.tickAsync(20000);
        const err = await settled;

        expect(world.cancelled).to.deep.equal([mo]);
        expect(err.name).to.equal('AbortError');
        expect(world.stalls().stalled(mo)).to.equal(true);
        expect(clock.countTimers()).to.equal(0);

        const [log] = world.logs;
        expect(log.level).to.equal('info');
        expect(log.event).to.equal('MEDIA_DOWNLOAD_STALLED');
        expect(log.data.loadedSize).to.equal(0);
        expect(log.data.type).to.equal('image');
    });

    it('leaves a slow but progressing download alone', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        // 11 KB/s: the slowest download measured fleet-wide that still finished.
        const mo = { loadedSize: 0, size: 2048 * KB };
        const feed = progressing(mo, 11 * KB);

        const result = world.mms.downloadMedia(realOpts(mo));
        const settled = result.then(
            (v) => v,
            (e) => e,
        );

        await clock.tickAsync(120000);
        clearInterval(feed);

        expect(world.cancelled).to.be.empty;
        succeed(world, mo, 'bytes');
        expect(await settled).to.equal('bytes');
    });

    it('cancels a download that delivers a trickle below the floor', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 0, size: 2048 * KB };
        const feed = progressing(mo, 200);

        const result = world.mms.downloadMedia(realOpts(mo));
        const settled = result.catch((err) => err);

        await clock.tickAsync(20000);
        clearInterval(feed);

        expect(world.cancelled).to.deep.equal([mo]);
        expect((await settled).name).to.equal('AbortError');
    });

    it('keeps the bytes of a download that beat the abort', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 0, size: 200 * KB };
        // It finished in the instant the cancel was landing, so WhatsApp's own
        // state says RESOLVED - the only thing that distinguishes this from a
        // swallowed abort.
        world.setOnCancel(() => succeed(world, mo, 'bytes'));

        const result = world.mms.downloadMedia(realOpts(mo));
        await clock.tickAsync(20000);

        expect(await result).to.equal('bytes');
        // Nothing failed, so nothing may be reported as a stall - neither the
        // mark the host reads, nor the metric anyone counts.
        expect(world.stalls().stalled(mo)).to.equal(false);
        expect(world.logs).to.be.empty;
    });

    it('sees a stall on a media object that already downloaded once', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        // WhatsApp never resets `loadedSize`, so a re-download after a cache
        // eviction starts with the previous attempt's full byte count.
        const mo = { loadedSize: 200 * KB, size: 200 * KB };

        const result = world.mms.downloadMedia(realOpts(mo));
        const settled = result.catch((err) => err);
        await clock.tickAsync(20000);

        expect(world.cancelled).to.deep.equal([mo]);
        expect((await settled).name).to.equal('AbortError');
    });

    it('follows the counter down when a fresh transfer restarts it', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 200 * KB, size: 2048 * KB };

        const result = world.mms.downloadMedia(realOpts(mo));
        const settled = result.then(
            (v) => v,
            (e) => e,
        );
        await clock.tickAsync(1000);
        mo.loadedSize = 0;
        const feed = progressing(mo, 11 * KB);
        await clock.tickAsync(60000);
        clearInterval(feed);

        expect(world.cancelled).to.be.empty;
        succeed(world, mo, 'bytes');
        expect(await settled).to.equal('bytes');
    });

    it('gives up on an abort that never lands, rather than waiting on it', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 0, size: 200 * KB };
        world.setOnCancel(() => {});

        const result = world.mms.downloadMedia(realOpts(mo));
        const settled = result.catch((err) => err);
        await clock.tickAsync(20000 + 6000);
        const err = await settled;

        expect(err.name).to.equal('AbortError');
        expect(world.stalls().stalled(mo)).to.equal(true);
        expect(clock.countTimers()).to.equal(0);
    });

    it('still ends as an abort when the cancel itself throws', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 0, size: 200 * KB };
        // Letting this escape would hand WhatsApp a non-abort failure, which it
        // routes to NEED_POKE - and NEED_POKE is answered by the re-upload
        // request, the unbounded wait this whole file exists to stay clear of.
        world.setOnCancel(() => {
            throw new Error('cancelDownloadMedia blew up');
        });

        const result = world.mms.downloadMedia(realOpts(mo));
        const settled = result.catch((err) => err);
        await clock.tickAsync(20000 + 6000);
        const err = await settled;

        expect(err.name).to.equal('AbortError');
        expect(world.stalls().stalled(mo)).to.equal(true);
        expect(clock.countTimers()).to.equal(0);
        expect(world.logs.map((l) => l.event)).to.include(
            'MEDIA_DOWNLOAD_CANCEL_FAILED',
        );
    });

    it('never attributes an earlier stall to a download that succeeded', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        // The media object is shared by filehash, and one of WhatsApp's own
        // auto-downloads can stall on it with nobody to read the verdict.
        const mo = { loadedSize: 0, size: 200 * KB };
        const first = world.mms.downloadMedia(realOpts(mo));
        const ignored = first.catch(() => {});
        await clock.tickAsync(20000);
        await ignored;

        const second = world.mms.downloadMedia(realOpts(mo));
        succeed(world, mo, 'bytes');

        expect(await second).to.equal('bytes');
        expect(world.stalls().stalled(mo)).to.equal(false);
    });

    it('republishes its reader after a re-sync wipes window.WWebJS', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const wrapped = world.mms.downloadMedia;

        // What a re-sync does: `LoadUtils` runs again and assigns
        // `window.WWebJS = {}`, then the watchdog is injected again.
        global.window.WWebJS = {};
        evaluateInPage(InjectMediaStallWatchdog);

        expect(world.mms.downloadMedia).to.equal(wrapped);
        expect(world.stalls()).to.not.equal(undefined);

        const mo = { loadedSize: 0, size: 200 * KB };
        const settled = world.mms.downloadMedia(realOpts(mo)).catch((e) => e);
        await clock.tickAsync(20000);
        await settled;

        expect(world.stalls().stalled(mo)).to.equal(true);
    });

    it('does not arm for a sequenced download, which waits in a queue', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 0, size: 200 * KB };

        const result = world.mms.downloadMedia(
            realOpts(mo, { shouldSequenceDownload: true }),
        );
        expect(clock.countTimers()).to.equal(0);
        await clock.tickAsync(60000);

        expect(world.cancelled).to.be.empty;
        succeed(world, mo, 'bytes');
        expect(await result).to.equal('bytes');
    });

    it('does not arm for a caller that brings no media object', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);

        const result = world.mms.downloadMedia({ mediaType: 'image' });
        expect(clock.countTimers()).to.equal(0);
        world.inFlight().resolve('bytes');
        expect(await result).to.equal('bytes');
    });

    it('answers every reader of one shared media object, not just the first', async function () {
        // WhatsApp shares a single mediaObject across every message with the
        // same filehash, and pic2desk resolves messages in parallel, so two
        // copies of one photo read this for the same stall. A destructive read
        // gave the verdict to whichever asked first; the loser fell through to
        // the NEED_POKE branch, which the host does not retry, and that picture
        // was lost. Reproduced on a live page before this test existed.
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const shared = {
            loadedSize: 0,
            size: 200 * KB,
            filehash: 'shared01hash',
        };

        const result = world.mms.downloadMedia(realOpts(shared));
        const settled = result.catch((err) => err);
        await clock.tickAsync(20000);
        await settled;

        expect(world.stalls().stalled(shared)).to.equal(true);
        expect(world.stalls().stalled(shared)).to.equal(true);
        expect(world.stalls().stalled(shared)).to.equal(true);
    });

    it('lets the next attempt clear what the last one marked', async function () {
        // The reason not clearing on read is safe: the wrapper clears at the
        // START of every attempt, so a mark can only describe the most recent
        // one and a success has already removed it before anyone reads.
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mo = { loadedSize: 0, size: 200 * KB, filehash: 'abc123def456' };

        const stalledRun = world.mms.downloadMedia(realOpts(mo));
        const firstSettled = stalledRun.catch((err) => err);
        await clock.tickAsync(20000);
        await firstSettled;
        expect(world.stalls().stalled(mo)).to.equal(true);

        const healthy = world.mms.downloadMedia(realOpts(mo));
        // Cleared the moment the new attempt begins, not when it finishes.
        expect(world.stalls().stalled(mo)).to.equal(false);
        succeed(world, mo, 'bytes');
        expect(await healthy).to.equal('bytes');
        expect(world.stalls().stalled(mo)).to.equal(false);
    });

    it('wraps once however often it is re-injected', function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const wrapped = world.mms.downloadMedia;
        evaluateInPage(InjectMediaStallWatchdog);
        evaluateInPage(InjectMediaStallWatchdog);

        expect(world.mms.downloadMedia).to.equal(wrapped);
    });
});
