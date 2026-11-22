const { expect } = require('chai');
const EventEmitter = require('events');
const Client = require('../../src/Client');
const { claimDocument } = require('../../src/util/DocumentClaim');
const { evaluateInPage } = require('./evaluateBoundary');

const APP = 'https://web.whatsapp.com/';
const LOGOUT = 'https://web.whatsapp.com/?post_logout=1&logout_reason=2';

/**
 * A page as a browser keeps it: `load` puts up a new document with a new
 * global object, `move` changes the address of the same one (History API).
 * Both run the `framenavigated` handlers, as puppeteer does.
 */
function browserPage() {
    const handlers = [];
    const frame = {
        parentFrame: () => null,
        url: () => global.window.location.href,
    };
    const page = {
        evaluate: async (fn, ...args) => evaluateInPage(fn, ...args),
        on: (event, handler) =>
            event === 'framenavigated' && handlers.push(handler),
        navigated: () => Promise.all(handlers.map((h) => h(frame))),
        load(url) {
            global.window = {
                location: { href: url },
                performance: {
                    getEntriesByType: (type) =>
                        type === 'navigation' ? [{ name: url }] : [],
                },
            };
            return page.navigated();
        },
        move(url) {
            global.window.location.href = url;
            return page.navigated();
        },
    };
    return page;
}

/** A client on `page` whose inject() and logout steps are only counted. */
function clientOn(page) {
    const client = Object.create(Client.prototype);
    EventEmitter.call(client);
    const seen = { injects: 0, logouts: 0, disconnected: [] };
    client.on('disconnected', (reason) => seen.disconnected.push(reason));
    Object.assign(client, {
        pupPage: page,
        lastLoggedOut: false,
        authStrategy: {
            logout: async () => seen.logouts++,
            beforeBrowserInitialized: async () => {},
            afterBrowserInitialized: async () => {},
        },
        inject: async () => seen.injects++,
    });
    client._registerFramenavigatedHandler();
    return seen;
}

describe('DocumentClaim', function () {
    let log;

    beforeEach(function () {
        log = console.log;
        console.log = () => {};
    });

    afterEach(function () {
        console.log = log;
        delete global.window;
    });

    it('claims a document once, and the next document again', async function () {
        const page = browserPage();
        await page.load(APP);
        expect(await claimDocument(page)).to.equal(APP);
        expect(await claimDocument(page)).to.equal(null);
        await page.move(`${APP}?x=1`);
        expect(await claimDocument(page)).to.equal(null);
        await page.load(APP);
        expect(await claimDocument(page)).to.equal(APP);
    });

    it('answers the address the document was loaded from', async function () {
        const page = browserPage();
        await page.load(LOGOUT);
        await page.move(APP);
        expect(await claimDocument(page)).to.equal(LOGOUT);
    });

    it('prepares each document once, however often it moves', async function () {
        const page = browserPage();
        const seen = clientOn(page);
        await page.load(APP);
        await page.move(APP);
        await page.move(`${APP}#chat`);
        expect(seen.injects).to.equal(1);
        await page.load(APP);
        expect(seen.injects).to.equal(2);
    });

    it('reports a logout once, through its echo and its move to /', async function () {
        const page = browserPage();
        const seen = clientOn(page);
        await page.load(LOGOUT);
        await page.move(LOGOUT);
        await page.move(APP);
        expect(seen.disconnected).to.deep.equal(['LOGOUT']);
        expect(seen.logouts).to.equal(1);
        expect(seen.injects).to.equal(1);
    });

    it('leaves a document the first inject claimed to that inject', async function () {
        const page = browserPage();
        await page.load(APP);
        expect(await claimDocument(page)).to.equal(APP);
        const seen = clientOn(page);
        await page.move(APP);
        expect(seen.injects).to.equal(0);
    });
});
