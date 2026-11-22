const { expect } = require('chai');
const EventEmitter = require('events');
const Client = require('../../src/Client');
const { classifyEvaluateFailure } = require('../../src/util/EvaluateFailure');

const DESTROYED =
    'Execution context was destroyed, most likely because of a navigation.';
const COLLECTED =
    'Protocol error (Runtime.callFunctionOn): Promise was collected';

/**
 * A client through initialize() on a page whose calls answer until `fail`
 * is set, and then reject with it, the way puppeteer rejects them.
 */
async function wrappedClient() {
    const state = { fail: null };
    const answer = async () => {
        if (state.fail) throw new Error(state.fail);
        return 'https://web.whatsapp.com/';
    };
    const page = {
        goto: async () => {},
        evaluate: answer,
        evaluateHandle: answer,
        target: () => {
            throw new Error('no CDP session in this test');
        },
    };
    const client = Object.create(Client.prototype);
    EventEmitter.call(client);
    Object.assign(client, {
        options: {
            puppeteer: { browser: { isConnected: () => true }, page },
            userAgent: false,
        },
        authStrategy: {
            beforeBrowserInitialized: async () => {},
            afterBrowserInitialized: async () => {},
        },
        initWebVersionCache: async () => {},
        _registerFramenavigatedHandler: () => {},
        inject: async () => {},
    });
    const diag = [];
    client.on('diag', (level, tag, data) =>
        diag.push({ level, tag, data: JSON.parse(data) }),
    );
    await client.initialize();
    return { client, state, diag };
}

describe('EvaluateFailure', function () {
    it('a destroyed context is a warning, a collected promise an error', function () {
        expect(classifyEvaluateFailure(new Error(DESTROYED)).level).to.equal(
            'warn',
        );
        expect(classifyEvaluateFailure(new Error(COLLECTED)).level).to.equal(
            'error',
        );
        expect(classifyEvaluateFailure(new Error('t'))).to.equal(null);
        expect(classifyEvaluateFailure(undefined)).to.equal(null);
    });

    it('evaluate reports a replaced document at warn, and still rejects', async function () {
        const { client, state, diag } = await wrappedClient();
        state.fail = DESTROYED;
        const err = await client.pupPage.evaluate(() => 1).catch((e) => e);
        expect(err.message).to.equal(DESTROYED);
        const report = diag.find((d) => d.tag === 'EVALUATE_CDP_ERROR');
        expect(report.level).to.equal('warn');
        expect(report.data.isContextDestroyed).to.equal(true);
        expect(report.data.isPromiseCollected).to.equal(false);
        expect(report.data).to.not.have.property('source');
    });

    it('evaluateHandle reports a collected promise at error', async function () {
        const { client, state, diag } = await wrappedClient();
        state.fail = COLLECTED;
        await client.pupPage.evaluateHandle(() => 1).catch(() => {});
        const report = diag.find((d) => d.tag === 'EVALUATE_CDP_ERROR');
        expect(report.level).to.equal('error');
        expect(report.data.source).to.equal('evaluateHandle');
    });

    it('reports nothing for any other failure', async function () {
        const { client, state, diag } = await wrappedClient();
        state.fail = 'Evaluation failed: t';
        await client.pupPage.evaluate(() => 1).catch(() => {});
        expect(diag.filter((d) => d.tag === 'EVALUATE_CDP_ERROR')).to.be.empty;
    });
});
