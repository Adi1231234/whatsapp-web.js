const { expect } = require('chai');
const { Events } = require('../../src/util/Constants');
const {
    REQUIRED_TO_CONNECT,
    REQUIRED_ON_LOGGED_OUT_APP,
    REQUIRED_FOR_QR,
    EXPOSED_WHEN_PRESENT,
    IsLoggedOutApp,
} = require('../../src/util/AppModules');
const {
    ExposeAuthStore,
} = require('../../src/util/Injected/AuthStore/AuthStore');
const { BINDINGS } = require('../../src/util/Injected/WaGateway/bindings');
const { evaluateInPage } = require('./evaluateBoundary');
const { healthyModules, installGateway } = require('./waGateway/fakeWhatsApp');
const {
    APP,
    LOGIN,
    BUILD,
    appIn,
    loggedOutAppIn,
    loadPage,
    clientOn,
    injectError,
    quietPage,
    closePage,
    qrOf,
} = require('./injectPage');

/** A page of the app where WhatsApp lists the socket model but never loads it. */
const socketNeverLoads = () =>
    Object.assign(appIn('CONNECTED'), { WAWebSocketModel: null });

describe('inject: the app modules WhatsApp loads', function () {
    beforeEach(quietPage);

    afterEach(closePage);

    describe('waiting for them', function () {
        it('fails naming what never loaded, where and on which build', async function () {
            const { client } = clientOn(loadPage(socketNeverLoads()));
            const err = await injectError(client);
            expect(err.message).to.equal(
                'WhatsApp app modules unavailable: WAWebSocketModel (not-loaded)' +
                    ` on ${APP} (build ${BUILD})`,
            );
            expect(global.window.AuthStore).to.equal(undefined);
        });

        it('connects with every module it only exposes missing', async function () {
            const modules = appIn('CONNECTED');
            EXPOSED_WHEN_PRESENT.forEach((m) => delete modules[m]);
            await clientOn(loadPage(modules)).client.inject();
            expect(global.window.AuthStore.AppState).to.equal(
                modules.WAWebSocketModel.Socket,
            );
            expect(global.window.AuthStore.OfflineMessageHandler).to.equal(
                undefined,
            );
        });

        it('connects a paired session without the modules of a QR', async function () {
            const modules = appIn('CONNECTED');
            REQUIRED_FOR_QR.forEach((m) => delete modules[m]);
            await clientOn(loadPage(modules)).client.inject();
            expect(global.window._wwjsListeners).to.have.length(5);
        });

        it('names the QR module a pairing waited for in vain', async function () {
            const modules = appIn('UNPAIRED');
            delete modules.WABase64;
            const err = await injectError(clientOn(loadPage(modules)).client);
            expect(err.message).to.equal(
                'WhatsApp app modules unavailable: WABase64 (unknown)' +
                    ` on ${APP} (build ${BUILD})`,
            );
        });
    });

    describe('the QR on the app', function () {
        it('is shown, and a scan is reported from the stream turning to SYNCING', async function () {
            const modules = appIn('UNPAIRED');
            const { client, events, gotos } = clientOn(loadPage(modules));
            await client.inject();
            const { Stream } = modules.WAWebStreamModel;
            Stream.mode = 'SYNCING';
            Stream.trigger('change:mode');
            expect(events).to.deep.equal([
                [Events.QR_RECEIVED, qrOf('REF')],
                [Events.LOADING_SCREEN, 0, 'WhatsApp'],
            ]);
            expect(gotos).to.deep.equal([]);
        });

        it('listens on the socket model, never on the event bus', async function () {
            const modules = appIn('UNPAIRED');
            const bus = modules.WAWebBackendEventBus.BackendEventBus;
            bus.on = () => {
                throw new Error('the app reads its socket model');
            };
            await clientOn(loadPage(modules)).client.inject();
            const { Socket } = modules.WAWebSocketModel;
            expect(Socket.listenerCount('change:state')).to.equal(1);
        });
    });

    describe('which app a page runs', function () {
        /** Asks, the way inject does, with only `present` there. */
        function ask(present) {
            const modules = healthyModules();
            const asked = [];
            delete modules.WAWebAppBootstrap;
            delete modules.WAWebLoggedOutBootstrap;
            Object.assign(modules, present);
            global.window = {
                require: (name) => {
                    asked.push(name);
                    return modules[name];
                },
            };
            installGateway();
            return { loggedOut: evaluateInPage(IsLoggedOutApp), asked };
        }

        it('is the app where its bootstrap loaded, asking for nothing else', function () {
            expect(ask({ WAWebAppBootstrap: {} })).to.deep.equal({
                loggedOut: false,
                asked: ['WAWebAppBootstrap'],
            });
        });

        it('is the logged-out app where only that bootstrap loaded', function () {
            expect(ask({ WAWebLoggedOutBootstrap: {} }).loggedOut).to.equal(
                true,
            );
        });

        it('is the app where neither loaded, so its wait names what is missing', function () {
            expect(ask({}).loggedOut).to.equal(false);
            expect(ask({ WAWebLoggedOutBootstrap: null }).loggedOut).to.equal(
                false,
            );
        });

        it('is told by the modules, not by the address', async function () {
            const app = clientOn(loadPage(appIn('UNPAIRED'), LOGIN));
            await app.client.inject();
            expect(global.window.AuthStore).to.not.equal(undefined);

            const { modules } = loggedOutAppIn('UNPAIRED');
            const loggedOut = clientOn(loadPage(modules, APP));
            await loggedOut.client.inject();
            expect(global.window.AuthStore).to.equal(undefined);
            expect(loggedOut.events).to.deep.equal([
                [Events.QR_RECEIVED, qrOf('REF')],
            ]);
        });
    });

    describe('the lists', function () {
        it('are all declared in the gateway bindings', function () {
            const declared = new Set(BINDINGS.map((b) => b.module));
            const all = [
                REQUIRED_TO_CONNECT,
                REQUIRED_ON_LOGGED_OUT_APP,
                REQUIRED_FOR_QR,
                EXPOSED_WHEN_PRESENT,
            ].flat();
            expect(all.filter((m) => !declared.has(m))).to.deep.equal([]);
        });

        it('never put a module in two on one app', function () {
            const app = [
                REQUIRED_TO_CONNECT,
                REQUIRED_FOR_QR,
                EXPOSED_WHEN_PRESENT,
            ].flat();
            const loggedOut = [
                REQUIRED_ON_LOGGED_OUT_APP,
                REQUIRED_FOR_QR,
            ].flat();
            expect(app).to.have.length(new Set(app).size);
            expect(loggedOut).to.have.length(new Set(loggedOut).size);
        });

        it('wait on the logged-out app for nothing it never loads', function () {
            const neverLoaded = ['WAWebSocketModel', 'WAWebStreamModel'];
            const waited = [REQUIRED_ON_LOGGED_OUT_APP, REQUIRED_FOR_QR].flat();
            expect(waited.filter((m) => neverLoaded.includes(m))).to.deep.equal(
                [],
            );
        });

        it('place every module ExposeAuthStore reads', function () {
            const modules = healthyModules();
            const asked = new Set();
            global.window = {
                require: (name) => {
                    asked.add(name);
                    return modules[name];
                },
            };
            installGateway();
            evaluateInPage(ExposeAuthStore);
            const placed = new Set(
                [
                    REQUIRED_TO_CONNECT,
                    REQUIRED_FOR_QR,
                    EXPOSED_WHEN_PRESENT,
                ].flat(),
            );
            expect([...asked].filter((m) => !placed.has(m))).to.deep.equal([]);
        });
    });
});
