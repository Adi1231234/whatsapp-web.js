const { expect } = require('chai');
const {
    appIn,
    loadPage,
    clientOn,
    injectError,
    quietPage,
    closePage,
} = require('./injectPage');

// quietPage stubs the global timers; the tests below need real time to pass.
const realSetTimeout = setTimeout;
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
const until = async (test) => {
    for (let i = 0; i < 200 && !test(); i++) await sleep(1);
    expect(test(), 'condition never held').to.equal(true);
};

/** The app with its socket not launched yet, as it sits behind a long storage job. */
function slowApp() {
    const modules = appIn('UNLAUNCHED');
    const { Socket } = modules.WAWebSocketModel;
    const moveTo = (state) => {
        Socket.state = state;
        Socket.trigger('change:state');
    };
    return { modules, Socket, moveTo };
}

/** Records every evaluate still running, to see what rides one call. */
function trackEvaluates(client) {
    const evaluate = client.pupPage.evaluate;
    const running = new Set();
    client.pupPage.evaluate = (...args) => {
        const call = evaluate(...args);
        running.add(call);
        call.finally(() => running.delete(call)).catch(() => {});
        return call;
    };
    return running;
}

describe('inject: startup waits owned by the caller', function () {
    beforeEach(quietPage);

    afterEach(closePage);

    it('waits for WhatsApp with no deadline when authTimeoutMs is 0', async function () {
        const { modules, Socket, moveTo } = slowApp();
        const { client } = clientOn(loadPage(modules), { authTimeoutMs: 0 });
        let done = false;
        const injecting = client.inject().then(() => (done = true));
        await until(() => Socket.listenerCount('change:state') > 0);
        // Far past the 20 ms the other tests give it, and still waiting.
        await sleep(80);
        expect(done).to.equal(false);
        moveTo('CONNECTED');
        await injecting;
        expect(done).to.equal(true);
    });

    it('still ends a wait at authTimeoutMs when one is set', async function () {
        const { modules } = slowApp();
        const { client } = clientOn(loadPage(modules), { authTimeoutMs: 20 });
        const err = await injectError(client);
        expect(err.message).to.equal('AbortError');
    });

    it('ends the wait at once on abortStartup, with the reason', async function () {
        const { modules, Socket } = slowApp();
        const { client } = clientOn(loadPage(modules), { authTimeoutMs: 0 });
        const failing = injectError(client);
        await until(() => Socket.listenerCount('change:state') > 0);
        await client.abortStartup('storage still busy');
        const err = await failing;
        expect(err.name).to.equal('StartupAbortedError');
        expect(err.reason).to.equal('storage still busy');
        // The page's listeners went with it: the wait's and the phases'.
        await until(() => Socket.listenerCount('change:state') === 0);
    });

    it('ends the wait without waiting on a page that no longer answers', async function () {
        const { modules, Socket } = slowApp();
        const { client } = clientOn(loadPage(modules), { authTimeoutMs: 0 });
        const failing = injectError(client);
        await until(() => Socket.listenerCount('change:state') > 0);
        // A hung renderer: every evaluate from here on never answers.
        client.pupPage.evaluate = () => new Promise(() => {});
        await client.abortStartup('page is hung');
        const err = await failing;
        expect(err.name).to.equal('StartupAbortedError');
        expect(err.reason).to.equal('page is hung');
    });

    it('ends a wait whose page hung before the wait could start', async function () {
        // The evaluate that starts a wait is the one call that still rides
        // the page; on a hung one it answers only at the protocolTimeout.
        const { modules, Socket } = slowApp();
        const { client } = clientOn(loadPage(modules), { authTimeoutMs: 0 });
        const evaluate = client.pupPage.evaluate;
        client.pupPage.evaluate = (fn, ...args) =>
            String(fn).includes('__wwebjsStartup.settle')
                ? new Promise(() => {})
                : evaluate(fn, ...args);
        const phases = [];
        client.on('startup_phase', (phase) => phases.push(phase));
        const failing = injectError(client);
        // At the socket wait: its phases are reported, its evaluate hangs.
        await until(() => phases.includes('socket'));
        await sleep(5);
        expect(Socket.listenerCount('change:state')).to.equal(1);
        await client.abortStartup('page hung');
        const err = await Promise.race([
            failing,
            sleep(200).then(() => 'still waiting'),
        ]);
        expect(err.name).to.equal('StartupAbortedError');
        expect(err.reason).to.equal('page hung');
    });

    it('a close ends a wait that has no deadline', async function () {
        const { modules, Socket } = slowApp();
        const { client } = clientOn(loadPage(modules), { authTimeoutMs: 0 });
        const settled = client.inject().then(
            () => 'settled',
            () => 'settled',
        );
        await until(() => Socket.listenerCount('change:state') > 0);
        await client.destroy();
        const outcome = await Promise.race([
            settled,
            sleep(200).then(() => 'still waiting'),
        ]);
        expect(outcome).to.equal('settled');
    });

    it('holds no evaluate open while it waits', async function () {
        const { modules, Socket, moveTo } = slowApp();
        const { client } = clientOn(loadPage(modules), { authTimeoutMs: 0 });
        const running = trackEvaluates(client);
        const injecting = client.inject();
        await until(() => Socket.listenerCount('change:state') > 0);
        await sleep(5);
        expect(running.size, 'a wait riding one page.evaluate').to.equal(0);
        moveTo('CONNECTED');
        await injecting;
    });

    it("reports WhatsApp's storage and socket as they move", async function () {
        const { modules, moveTo } = slowApp();
        const versions = modules.WAWebSchemaVersions;
        let set = false;
        versions.hasSchemaVersions = () => set;
        versions.setSchemaVersions = () => (set = true);
        const { client } = clientOn(loadPage(modules), { authTimeoutMs: 0 });
        const phases = [];
        client.on('startup_phase', (phase, detail) =>
            phases.push(detail ? `${phase}:${detail}` : phase),
        );
        const injecting = client.inject();
        await until(() => phases.includes('socket:UNLAUNCHED'));
        versions.setSchemaVersions(new Map());
        moveTo('OPENING');
        moveTo('CONNECTED');
        await injecting;
        expect(phases).to.deep.equal([
            'modules',
            'storage-opening',
            'socket:UNLAUNCHED',
            'storage-ready',
            'socket:OPENING',
            'socket:CONNECTED',
        ]);
    });
});
