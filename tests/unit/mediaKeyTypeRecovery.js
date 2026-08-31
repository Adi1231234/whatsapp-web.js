const { expect } = require('chai');
const {
    RECOVERABLE_ERROR_NAME,
    RECOVERABLE_MESSAGE_FRAGMENT,
    CANDIDATE_MEDIA_TYPES,
} = require('../../src/util/MediaKeyTypeRecovery');
const {
    InjectMediaKeyRecovery,
} = require('../../src/util/Injected/MediaKeyRecovery');
const { MediaFailReason } = require('../../src/util/MediaFailReasons');

const POLICY = {
    recoverableErrorName: RECOVERABLE_ERROR_NAME,
    recoverableMessageFragment: RECOVERABLE_MESSAGE_FRAGMENT,
    candidateMediaTypes: CANDIDATE_MEDIA_TYPES,
};

const hmacMismatch = () => {
    const err = new Error('decryptMedia: hmac mismatch');
    err.name = 'MediaDecryptionError';
    return err;
};

/**
 * A stand-in for the WhatsApp page.
 *
 * The recovery is exercised through the module that actually ships rather than
 * through a parallel copy of its rules, so the candidate order, the predicate
 * and the rethrow are all covered as written.
 *
 * @param {object} opts
 * @param {string|null} opts.decryptsAs the media type whose keys work, if any
 * @param {Error} opts.downloadError thrown by the ciphertext re-fetch
 */
function fakeWindow({ decryptsAs = null, downloadError = null } = {}) {
    const calls = { derived: [], downloads: 0, logs: [] };
    const modules = {
        WAWebDownloadManager: { downloadManager: {} },
        WAWebCryptoCreateMediaKeys: async (type) => {
            calls.derived.push(type);
            return { type };
        },
        WAWebCryptoDecryptMedia: async ({ mediaKeys }) => {
            if (mediaKeys.type !== decryptsAs) throw hmacMismatch();
            return new Uint8Array([1, 2, 3]);
        },
        WAWebMmsClient: {
            download: async () => {
                calls.downloads++;
                if (downloadError) throw downloadError;
                return new ArrayBuffer(8);
            },
        },
    };
    const win = {
        require: (name) => modules[name],
        __metrics: {
            safeDiagLog: (level, tag, data) =>
                calls.logs.push({ level, tag, data }),
        },
        AbortController,
        Uint8Array,
    };
    return {
        win,
        calls,
        manager: modules.WAWebDownloadManager.downloadManager,
    };
}

/** Installs the recovery with `window` bound, the way page.evaluate runs it. */
function install(win) {
    const previous = global.window;
    global.window = win;
    try {
        InjectMediaKeyRecovery(POLICY);
    } finally {
        global.window = previous;
    }
}

/** Runs the wrapped download with `window` bound, as a real call would be. */
async function run(win, manager, opts) {
    const previous = global.window;
    global.window = win;
    try {
        return await manager.downloadAndMaybeDecrypt(opts);
    } finally {
        global.window = previous;
    }
}

const OPTS = {
    type: 'document',
    mediaKey: 'a-media-key',
    encFilehash: 'enc',
    filehash: 'plain',
    directPath: '/o1/x',
};

describe('InjectMediaKeyRecovery', function () {
    it('recovers a document that was encrypted as an image', async function () {
        const { win, calls, manager } = fakeWindow({ decryptsAs: 'image' });
        manager.downloadAndMaybeDecrypt = async () => {
            throw hmacMismatch();
        };
        install(win);

        const out = await run(win, manager, OPTS);

        expect(out).to.be.an('ArrayBuffer');
        expect(out.byteLength).to.equal(3);
        expect(calls.downloads).to.equal(1);
        // Image first, and the declared type is never re-tried.
        expect(calls.derived).to.deep.equal(['image']);
        expect(calls.logs[0].tag).to.equal('MEDIA_KEY_TYPE_RECOVERED');
        expect(calls.logs[0].data.recoveredAs).to.equal('image');
    });

    it('rethrows the original error when no candidate works', async function () {
        const { win, calls, manager } = fakeWindow({ decryptsAs: null });
        const original = hmacMismatch();
        manager.downloadAndMaybeDecrypt = async () => {
            throw original;
        };
        install(win);

        let thrown;
        try {
            await run(win, manager, OPTS);
        } catch (err) {
            thrown = err;
        }

        expect(thrown).to.equal(original);
        // Every candidate except the declared one, and nothing accepted.
        expect(calls.derived).to.deep.equal(['image', 'video', 'audio']);
        expect(calls.logs[0].tag).to.equal('MEDIA_KEY_TYPE_UNRECOVERED');
    });

    it('leaves a successful download completely alone', async function () {
        const { win, calls, manager } = fakeWindow({ decryptsAs: 'image' });
        const payload = new ArrayBuffer(4);
        manager.downloadAndMaybeDecrypt = async () => payload;
        install(win);

        expect(await run(win, manager, OPTS)).to.equal(payload);
        expect(calls.downloads).to.equal(0);
        expect(calls.logs).to.have.length(0);
    });

    it('does not touch a failure that is not a key-type mismatch', async function () {
        const { win, calls, manager } = fakeWindow({ decryptsAs: 'image' });
        const notFound = new Error('mmsDownload: 404');
        notFound.name = 'MediaNotFoundError';
        manager.downloadAndMaybeDecrypt = async () => {
            throw notFound;
        };
        install(win);

        let thrown;
        try {
            await run(win, manager, OPTS);
        } catch (err) {
            thrown = err;
        }

        // 404s are 92% of decrypt failures fleet-wide; recovery must be inert.
        expect(thrown).to.equal(notFound);
        expect(calls.downloads).to.equal(0);
        expect(calls.derived).to.deep.equal([]);
    });

    it('gives up quietly when the ciphertext cannot be re-fetched', async function () {
        const original = hmacMismatch();
        const { win, calls, manager } = fakeWindow({
            decryptsAs: 'image',
            downloadError: new Error('offline'),
        });
        manager.downloadAndMaybeDecrypt = async () => {
            throw original;
        };
        install(win);

        let thrown;
        try {
            await run(win, manager, OPTS);
        } catch (err) {
            thrown = err;
        }

        expect(thrown).to.equal(original);
        expect(calls.derived).to.deep.equal([]);
    });

    it('never wraps twice, because the injection re-runs on every re-sync', function () {
        const { win, manager } = fakeWindow({});
        manager.downloadAndMaybeDecrypt = async () => null;
        install(win);
        const wrappedOnce = manager.downloadAndMaybeDecrypt;
        install(win);
        expect(manager.downloadAndMaybeDecrypt).to.equal(wrappedOnce);
    });
});

describe('MediaFailReason', function () {
    it('is its own key, so a code never drifts from its name', function () {
        for (const key of Object.keys(MediaFailReason)) {
            expect(MediaFailReason[key]).to.equal(key);
        }
    });
});
