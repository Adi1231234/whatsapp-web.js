const { expect } = require('chai');
const sinon = require('sinon');
const {
    InjectMediaStallWatchdog,
} = require('../../src/util/Injected/MediaStallWatchdog');
const { evaluateInPage } = require('./evaluateBoundary');

const KB = 1024;

/**
 * The real shape of a media download.
 *
 * A stalled one never resolves and never rejects on its own - that is the whole
 * defect - so the double must settle ONLY when WhatsApp's cancel path aborts it,
 * and must then reject with an `AbortError`, because it is that specific name
 * that makes WhatsApp unwind without setting NEED_POKE. A double that rejected
 * on its own, or with a plain Error, would pass while hiding both.
 */
function page() {
    const logs = [];
    const cancelled = [];
    let inFlight = null;
    // What WhatsApp's abort does to the in-flight request. Overridable, because
    // a download can also finish in the instant the cancel is landing.
    let onCancel = () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        inFlight.reject(err);
    };

    const manager = {
        downloadAndMaybeDecrypt(opts) {
            let reject;
            const promise = new Promise((res, rej) => {
                inFlight = { resolve: res, reject: rej, opts };
                reject = rej;
            });
            void reject;
            return promise;
        },
    };

    global.window = {
        require(name) {
            if (name === 'WAWebDownloadManager')
                return { downloadManager: manager };
            if (name === 'WAWebMediaCancelDownloadMsg')
                return {
                    cancelDownloadMedia(mediaObject) {
                        cancelled.push(mediaObject);
                        onCancel();
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
        manager,
        logs,
        cancelled,
        inFlight: () => inFlight,
        setOnCancel: (fn) => {
            onCancel = fn;
        },
    };
}

/** A download that is progressing at `bytesPerSec`, driven by the fake clock. */
function progressing(mediaObject, clock, bytesPerSec) {
    return setInterval(() => {
        mediaObject.loadedSize = (mediaObject.loadedSize || 0) + bytesPerSec;
    }, 1000);
}

describe('media stall watchdog', function () {
    let clock;

    beforeEach(function () {
        clock = sinon.useFakeTimers({
            toFake: ['setInterval', 'clearInterval', 'Date'],
        });
    });

    afterEach(function () {
        clock.restore();
        delete global.window;
    });

    it('passes a download that completes through untouched', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mediaObject = { loadedSize: 0, size: 200 * KB };

        const result = world.manager.downloadAndMaybeDecrypt({ mediaObject });
        world.inFlight().resolve('bytes');

        expect(await result).to.equal('bytes');
        expect(world.cancelled).to.be.empty;
        // The interval must not outlive the download.
        expect(clock.countTimers()).to.equal(0);
    });

    it('cancels a download that never delivers a byte', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mediaObject = { loadedSize: 0, size: 200 * KB };

        const result = world.manager.downloadAndMaybeDecrypt({
            mediaObject,
            type: 'image',
            directPath: '/v/t62/stalled.enc',
        });
        const settled = result.catch((err) => err);

        await clock.tickAsync(20000);
        const err = await settled;

        expect(world.cancelled).to.deep.equal([mediaObject]);
        // The AbortError must survive: WhatsApp routes on that name.
        expect(err.name).to.equal('AbortError');
        expect(mediaObject.__downloadStalled).to.equal(true);
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
        const mediaObject = { loadedSize: 0, size: 2 * 1024 * KB };
        const feed = progressing(mediaObject, clock, 11 * KB);

        const result = world.manager.downloadAndMaybeDecrypt({ mediaObject });
        const settled = result.then(
            (v) => v,
            (e) => e,
        );

        await clock.tickAsync(120000);
        clearInterval(feed);

        expect(world.cancelled).to.be.empty;
        world.inFlight().resolve('bytes');
        expect(await settled).to.equal('bytes');
    });

    it('cancels a download that delivers a trickle below the floor', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        // 200 B/s - an order of magnitude under anything ever measured.
        const mediaObject = { loadedSize: 0, size: 2 * 1024 * KB };
        const feed = progressing(mediaObject, clock, 200);

        const result = world.manager.downloadAndMaybeDecrypt({ mediaObject });
        const settled = result.catch((err) => err);

        await clock.tickAsync(20000);
        clearInterval(feed);

        expect(world.cancelled).to.deep.equal([mediaObject]);
        expect((await settled).name).to.equal('AbortError');
    });

    it('keeps the bytes of a download that beat the abort', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const mediaObject = { loadedSize: 0, size: 200 * KB };
        // The cancel lands, but this download had already finished.
        world.setOnCancel(() => world.inFlight().resolve('bytes'));

        const result = world.manager.downloadAndMaybeDecrypt({ mediaObject });
        await clock.tickAsync(20000);

        expect(await result).to.equal('bytes');
        // Nothing failed, so nothing may be reported as a stall.
        expect(mediaObject.__downloadStalled).to.equal(undefined);
    });

    it('does not arm for a caller that brings no media object', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);

        const result = world.manager.downloadAndMaybeDecrypt({});
        expect(clock.countTimers()).to.equal(0);
        world.inFlight().resolve('bytes');
        expect(await result).to.equal('bytes');
    });

    it('wraps once however often it is re-injected', async function () {
        const world = page();
        evaluateInPage(InjectMediaStallWatchdog);
        const wrapped = world.manager.downloadAndMaybeDecrypt;
        evaluateInPage(InjectMediaStallWatchdog);
        evaluateInPage(InjectMediaStallWatchdog);

        expect(world.manager.downloadAndMaybeDecrypt).to.equal(wrapped);
    });
});
