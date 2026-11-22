const { expect } = require('chai');
const EventEmitter = require('events');
const Client = require('../../src/Client');

/**
 * A client whose initialize() reaches inject() with nothing real behind it,
 * so a test can decide what happens while inject runs.
 */
function clientReachingInject(duringInject) {
    const client = Object.create(Client.prototype);
    EventEmitter.call(client);
    const page = {
        goto: async () => {},
        target: () => {
            throw new Error('set up on a closed page');
        },
    };
    Object.assign(client, {
        options: {
            puppeteer: { browser: { isConnected: () => false }, page },
            userAgent: false,
        },
        authStrategy: {
            beforeBrowserInitialized: async () => {},
            afterBrowserInitialized: async () => {},
            destroy: async () => {},
        },
        initWebVersionCache: async () => {},
        _registerFramenavigatedHandler: () => {},
        inject: async () => duringInject(client),
    });
    return client;
}

describe('initialize: a close while inject runs', function () {
    it('rejects instead of setting up on the page that is gone', async function () {
        const diag = [];
        const client = clientReachingInject((c) => c.destroy());
        client.on('diag', (...args) => diag.push(args[2]));
        const err = await client.initialize().then(
            () => null,
            (e) => e,
        );
        expect(err && err.name).to.equal('StartupAbortedError');
        expect(err.reason).to.equal('destroyed');
        expect(diag).to.not.include('CDP_MONITOR_SETUP_FAILED');
    });

    it('a later initialize on the same client is not refused', async function () {
        let closeIt = true;
        const client = clientReachingInject((c) => closeIt && c.destroy());
        await client.initialize().catch(() => {});
        closeIt = false;
        const err = await client.initialize().then(
            () => null,
            (e) => e,
        );
        // It goes past inject this time (and fails later on the stub page).
        expect(err && err.name).to.not.equal('StartupAbortedError');
    });
});
