const { expect } = require('chai');
const Client = require('../../src/Client');
const { WhatsWebURL } = require('../../src/util/Constants');
const {
    REQUIRED_TO_CONNECT,
    REQUIRED_FOR_QR,
    EXPOSED_WHEN_PRESENT,
    isLoginEntry,
} = require('../../src/util/AppModules');
const {
    ExposeAuthStore,
} = require('../../src/util/Injected/AuthStore/AuthStore');
const { evaluateInPage } = require('./evaluateBoundary');

const LOGIN = 'https://web.whatsapp.com/login/';
const APP = 'https://web.whatsapp.com/';
const PAST_THE_WAITS = 'past the module waits';
const ALL = [
    ...REQUIRED_TO_CONNECT,
    ...REQUIRED_FOR_QR,
    ...EXPOSED_WHEN_PRESENT,
];

/** Every module inject reads, with a socket that has settled in `state`. */
function whatsAppIn(state) {
    const modules = Object.fromEntries(ALL.map((name) => [name, {}]));
    modules.WAWebSocketModel = {
        Socket: { state, hasSynced: false, on() {}, off() {} },
    };
    modules.WAWebCmd = { Cmd: {} };
    return modules;
}

/**
 * A client on a page that runs every injected function the way puppeteer
 * does, against WhatsApp's two loader calls as measured: `require` answers
 * null for a module listed but not loaded and undefined for one never heard
 * of, and `requireLazy` calls back only once every named module is there.
 * `urls` is where each load lands: the page starts on the first, and each
 * goto moves to the next. Exposing the socket-state binding, which inject
 * does once every wait is behind it, stops the run there.
 */
function clientOn(modules, urls = [APP]) {
    let at = 0;
    const gotos = [];
    global.window = {
        Debug: { VERSION: '2.3000.9' },
        require: (name) => modules[name],
        requireLazy: (names, cb) => {
            if (names.every((n) => modules[n] != null)) cb();
        },
    };
    const evaluate = async (fn, ...args) =>
        typeof fn === 'string'
            ? new Function(`return (${fn})`)()
            : evaluateInPage(fn, ...args);
    const pupPage = {
        url: () => urls[at],
        evaluate,
        waitForFunction: async (fn) => {
            const value = await evaluate(fn);
            return { jsonValue: async () => value };
        },
        exposeFunction: async (name, fn) => {
            if (name === 'onAuthAppStateChangedEvent') {
                throw new Error(PAST_THE_WAITS);
            }
            global.window[name] = fn;
        },
        goto: async (url) => {
            gotos.push(url);
            at = Math.min(at + 1, urls.length - 1);
        },
    };
    const client = Object.create(Client.prototype);
    Object.assign(client, {
        pupPage,
        options: { authTimeoutMs: 20, pairWithPhoneNumber: {} },
        authStrategy: { onAuthenticationNeeded: async () => ({}) },
        on() {},
    });
    return { client, gotos };
}

async function injectError(client) {
    try {
        await client.inject();
    } catch (err) {
        return err;
    }
    throw new Error('inject() resolved');
}

/** A page where WhatsApp lists the socket model but never loads it. */
const socketNeverLoads = () =>
    Object.assign(whatsAppIn('CONNECTED'), { WAWebSocketModel: null });

describe('inject: the app modules WhatsApp loads', function () {
    afterEach(function () {
        delete global.window;
    });

    describe('waiting for them', function () {
        it('fails naming what never loaded, where and on which build', async function () {
            const { client } = clientOn(socketNeverLoads());
            const err = await injectError(client);
            expect(err.message).to.equal(
                'WhatsApp app modules unavailable: WAWebSocketModel (not-loaded)' +
                    ` on ${APP} (build 2.3000.9)`,
            );
            expect(global.window.AuthStore).to.equal(undefined);
        });

        it('connects with every module it only exposes missing', async function () {
            const modules = whatsAppIn('CONNECTED');
            EXPOSED_WHEN_PRESENT.forEach((m) => delete modules[m]);
            const err = await injectError(clientOn(modules).client);
            expect(err.message).to.equal(PAST_THE_WAITS);
            expect(global.window.AuthStore.AppState).to.equal(
                modules.WAWebSocketModel.Socket,
            );
            expect(global.window.AuthStore.OfflineMessageHandler).to.equal(
                undefined,
            );
        });

        it('connects a paired session without the modules of a QR', async function () {
            const modules = whatsAppIn('CONNECTED');
            REQUIRED_FOR_QR.forEach((m) => delete modules[m]);
            const err = await injectError(clientOn(modules).client);
            expect(err.message).to.equal(PAST_THE_WAITS);
        });

        it('names the QR module a pairing waited for in vain', async function () {
            const modules = whatsAppIn('UNPAIRED');
            delete modules.WABase64;
            const err = await injectError(clientOn(modules).client);
            expect(err.message).to.equal(
                'WhatsApp app modules unavailable: WABase64 (unknown)' +
                    ` on ${APP} (build 2.3000.9)`,
            );
        });

        it('leaves the login entry for the app, once', async function () {
            const { client, gotos } = clientOn(socketNeverLoads(), [
                LOGIN,
                APP,
            ]);
            const err = await injectError(client);
            expect(gotos).to.deep.equal([WhatsWebURL]);
            expect(err.message).to.contain(` on ${APP} `);
        });

        it('does not leave it twice when WhatsApp sends it back there', async function () {
            const { client, gotos } = clientOn(socketNeverLoads(), [
                LOGIN,
                LOGIN,
            ]);
            const err = await injectError(client);
            expect(gotos).to.deep.equal([WhatsWebURL]);
            expect(err.message).to.contain(` on ${LOGIN} `);
        });

        it('stays on the app page', async function () {
            const { client, gotos } = clientOn(socketNeverLoads());
            await injectError(client);
            expect(gotos).to.deep.equal([]);
        });
    });

    describe('the framenavigated handler while the client opens WhatsApp', function () {
        function clientWithHandler() {
            let handler = null;
            const injected = [];
            const frame = { parentFrame: () => null, url: () => APP };
            const client = Object.create(Client.prototype);
            Object.assign(client, {
                lastLoggedOut: false,
                inject: async () => injected.push(frame.url()),
                pupPage: {
                    on: (event, fn) => (handler = fn),
                    evaluate: async () => false,
                    goto: async () => handler(frame),
                },
            });
            Client.prototype._registerFramenavigatedHandler.call(client);
            return { client, injected, navigate: () => handler(frame) };
        }

        it('stands aside: the caller goes on with the page it opened', async function () {
            const { client, injected } = clientWithHandler();
            await client._openWhatsWeb();
            expect(injected).to.deep.equal([]);
        });

        it("injects again on WhatsApp's own navigation", async function () {
            const { client, injected, navigate } = clientWithHandler();
            await client._openWhatsWeb();
            await navigate();
            expect(injected).to.deep.equal([APP]);
        });
    });

    describe('the three lists', function () {
        it('never put a module in two', function () {
            expect(ALL).to.have.length(new Set(ALL).size);
        });

        it('place every module ExposeAuthStore reads', function () {
            const modules = whatsAppIn('CONNECTED');
            const asked = new Set();
            global.window = {
                require: (name) => {
                    asked.add(name);
                    return modules[name];
                },
            };
            evaluateInPage(ExposeAuthStore);
            const placed = new Set(ALL);
            expect([...asked].filter((m) => !placed.has(m))).to.deep.equal([]);
        });
    });

    describe("isLoginEntry: WhatsApp's own login path test", function () {
        it('knows the login entry in every form WAWebURLUtils accepts', function () {
            expect(
                [
                    LOGIN,
                    'https://web.whatsapp.com/login',
                    'https://web.whatsapp.com/login/?next=%2F',
                ].map(isLoginEntry),
            ).to.deep.equal([true, true, true]);
        });

        it('takes nothing else for it', function () {
            expect(
                [
                    APP,
                    'https://web.whatsapp.com/?post_logout=1&logout_reason=0',
                    'https://web.whatsapp.com/loginx',
                    'data:text/html,<p>blank</p>',
                    '',
                ].map(isLoginEntry),
            ).to.deep.equal([false, false, false, false, false]);
        });
    });
});
