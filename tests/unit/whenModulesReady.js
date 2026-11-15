const { expect } = require('chai');
const { evaluateInPage } = require('./evaluateBoundary');
const {
    WhenModulesReady,
} = require('../../src/util/Injected/WhenModulesReady');

/**
 * A page with WhatsApp's two loader calls, shaped as measured: `require`
 * answers null for a module that is listed but not loaded and undefined for
 * one the page never heard of, and `requireLazy` calls back once every named
 * module is ready - here, when the test says so.
 */
function page(modules) {
    const lazy = [];
    global.window = {
        require: (name) => modules[name],
        requireLazy: (names, cb) => lazy.push({ names, cb }),
    };
    return {
        whenReady: (names, ms) => evaluateInPage(WhenModulesReady, names, ms),
        lazy,
        loadAll: () => lazy.forEach((l) => l.cb()),
    };
}

describe("WhenModulesReady: waits on WhatsApp's loader", function () {
    afterEach(function () {
        delete global.window;
    });

    it("settles ready when WhatsApp's loader calls back", async function () {
        const { whenReady, lazy, loadAll } = page({});
        const waiting = whenReady(['WAWebSocketModel'], 1000);
        expect(lazy[0].names).to.deep.equal(['WAWebSocketModel']);
        loadAll();
        expect(await waiting).to.deep.equal({ ready: true, missing: [] });
    });

    it('names what never loaded once the time runs out', async function () {
        const { whenReady } = page({
            WAWebSocketModel: null,
            WABase64: { encodeB64() {} },
        });
        const result = await whenReady(
            ['WAWebSocketModel', 'WABase64', 'WAWebNeverHeardOf'],
            20,
        );
        expect(result).to.deep.equal({
            ready: false,
            missing: [
                { module: 'WAWebSocketModel', state: 'not-loaded' },
                { module: 'WAWebNeverHeardOf', state: 'unknown' },
            ],
        });
    });

    it('is ready when the modules are, though the callback was still queued', async function () {
        // The loader hands its callback to a scheduler; the time can run out
        // between the modules becoming ready and that callback running.
        const { whenReady } = page({ WAWebSocketModel: { Socket: {} } });
        expect(await whenReady(['WAWebSocketModel'], 20)).to.deep.equal({
            ready: true,
            missing: [],
        });
    });

    it('lets the time run out quietly once the loader has called back', async function () {
        const asked = [];
        const { whenReady, loadAll } = page({});
        global.window.require = (name) => asked.push(name);
        const waiting = whenReady(['WAWebSocketModel'], 20);
        loadAll();
        await new Promise((r) => setTimeout(r, 40));
        expect(await waiting).to.include({ ready: true });
        expect(asked).to.deep.equal([]);
    });
});
