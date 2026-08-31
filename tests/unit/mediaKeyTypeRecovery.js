const { expect } = require('chai');
const {
    InjectMediaKeyRecovery,
} = require('../../src/util/Injected/MediaKeyRecovery');

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
 * @param {Error|null} opts.failWith thrown instead of an HMAC failure
 */
function fakeWindow({ decryptsAs = null, failWith = null } = {}) {
    const calls = { types: [], logs: [] };
    const manager = {
        downloadAndMaybeDecrypt: async (opts) => {
            calls.types.push(opts.type);
            if (failWith) throw failWith;
            if (opts.type !== decryptsAs) throw hmacMismatch();
            return new Uint8Array([1, 2, 3]).buffer;
        },
    };
    return {
        calls,
        manager,
        window: {
            require: (name) =>
                name === 'WAWebDownloadManager' ? { downloadManager: manager } : null,
            __metrics: {
                safeDiagLog: (level, event, data) =>
                    calls.logs.push({ level, event, data }),
            },
        },
    };
}

const install = (fake) => {
    const previous = global.window;
    global.window = fake.window;
    try {
        InjectMediaKeyRecovery();
    } finally {
        global.window = previous;
    }
};

const download = async (fake, type) => {
    const previous = global.window;
    global.window = fake.window;
    try {
        return await fake.manager.downloadAndMaybeDecrypt({ type, mediaKey: 'k' });
    } finally {
        global.window = previous;
    }
};

describe('media key type recovery', function () {
    it('re-downloads under another type when the HMAC fails', async function () {
        const fake = fakeWindow({ decryptsAs: 'image' });
        install(fake);

        const bytes = await download(fake, 'document');

        expect(new Uint8Array(bytes)).to.deep.equal(new Uint8Array([1, 2, 3]));
        // declared type first, then the candidate that worked
        expect(fake.calls.types).to.deep.equal(['document', 'image']);
        expect(fake.calls.logs[0]).to.deep.include({
            level: 'info',
            event: 'MEDIA_KEY_TYPE_RECOVERED',
        });
        expect(fake.calls.logs[0].data).to.include({
            declaredType: 'document',
            recoveredAs: 'image',
        });
    });

    it('never retries the declared type', async function () {
        const fake = fakeWindow({ decryptsAs: 'audio' });
        install(fake);

        await download(fake, 'image');

        expect(fake.calls.types).to.deep.equal(['image', 'video', 'audio']);
    });

    it('rethrows the original error when no type works', async function () {
        const fake = fakeWindow({ decryptsAs: null });
        install(fake);

        const err = await download(fake, 'document').catch((e) => e);

        expect(err.name).to.equal('MediaDecryptionError');
        expect(fake.calls.types).to.deep.equal([
            'document',
            'image',
            'video',
            'audio',
        ]);
        expect(fake.calls.logs.at(-1)).to.deep.include({
            level: 'warn',
            event: 'MEDIA_KEY_TYPE_UNRECOVERED',
        });
    });

    it('leaves any other failure untouched, with no retry', async function () {
        const fake = fakeWindow({ failWith: new Error('MediaNotFoundError') });
        install(fake);

        const err = await download(fake, 'document').catch((e) => e);

        expect(err.message).to.equal('MediaNotFoundError');
        expect(fake.calls.types).to.deep.equal(['document']);
        expect(fake.calls.logs).to.be.empty;
    });

    it('leaves a successful download untouched', async function () {
        const fake = fakeWindow({ decryptsAs: 'image' });
        install(fake);

        await download(fake, 'image');

        expect(fake.calls.types).to.deep.equal(['image']);
        expect(fake.calls.logs).to.be.empty;
    });

    it('does not wrap twice across re-syncs', async function () {
        const fake = fakeWindow({ decryptsAs: 'image' });
        install(fake);
        install(fake);

        await download(fake, 'document');

        // one wrapper only: a second would retry the candidate list per layer
        expect(fake.calls.types).to.deep.equal(['document', 'image']);
    });
});
