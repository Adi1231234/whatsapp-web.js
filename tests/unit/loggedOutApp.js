const { expect } = require('chai');
const { Events } = require('../../src/util/Constants');
const {
    APP,
    LOGIN,
    BUILD,
    appIn,
    loggedOutAppIn,
    loadPage,
    clientOn,
    injectError,
    closePage,
    qrOf,
} = require('./injectPage');

const QR = (ref) => [Events.QR_RECEIVED, qrOf(ref)];
const SCAN = [Events.LOADING_SCREEN, 0, 'WhatsApp'];

describe("inject on WhatsApp's logged-out app", function () {
    afterEach(closePage);

    describe('the QR', function () {
        it('is shown from what the page has, and the page is left where it is', async function () {
            const { modules } = loggedOutAppIn('UNPAIRED');
            const page = loadPage(modules, LOGIN);
            const { client, events, gotos } = clientOn(page);
            await client.inject();
            expect(events).to.deep.equal([QR('REF')]);
            expect(gotos).to.deep.equal([]);
            expect(page.asked).to.not.include.members([
                'WAWebSocketModel',
                'WAWebStreamModel',
            ]);
            expect(global.window.AuthStore).to.equal(undefined);
        });

        it('waits for the socket to settle, on the event bus', async function () {
            const { modules, bus } = loggedOutAppIn('UNLAUNCHED', [
                'OPENING',
                'PAIRING',
                'UNPAIRED',
            ]);
            const { client, events } = clientOn(loadPage(modules, LOGIN));
            await client.inject();
            expect(bus.socketState).to.equal('UNPAIRED');
            expect(events).to.deep.equal([QR('REF')]);
        });

        it('waits while the bus holds no state yet', async function () {
            const { modules, bus } = loggedOutAppIn(undefined, [
                'OPENING',
                'UNPAIRED',
            ]);
            const { client, events } = clientOn(loadPage(modules, LOGIN));
            await client.inject();
            expect(bus.socketState).to.equal('UNPAIRED');
            expect(events).to.deep.equal([QR('REF')]);
        });

        it('follows every new code WhatsApp draws', async function () {
            const { modules } = loggedOutAppIn('UNPAIRED');
            const { client, events } = clientOn(loadPage(modules, LOGIN));
            await client.inject();
            const { Conn } = modules.WAWebConnModel;
            Conn.ref = 'REF2';
            Conn.trigger('change:ref', Conn, 'REF2');
            expect(events).to.deep.equal([QR('REF'), QR('REF2')]);
        });

        it('is refreshed through the bus once its codes ran out', async function () {
            const { modules, bus, refreshes } = loggedOutAppIn('UNPAIRED');
            const { client } = clientOn(loadPage(modules, LOGIN));
            await client.inject();
            await Promise.all(bus.triggerSetSocketState('UNPAIRED_IDLE'));
            expect(refreshes).to.deep.equal(['triggerRefreshQR']);
        });

        it('is refreshed once, however often inject runs on the page', async function () {
            const { modules, bus, refreshes } = loggedOutAppIn('UNPAIRED');
            const { client } = clientOn(loadPage(modules, LOGIN));
            await client.inject();
            await client.inject();
            expect(bus.listenerCount('set_socket_state')).to.equal(1);
            await Promise.all(bus.triggerSetSocketState('UNPAIRED_IDLE'));
            expect(refreshes).to.deep.equal(['triggerRefreshQR']);
        });

        it('is not refreshed in any other state', async function () {
            const { modules, bus, refreshes } = loggedOutAppIn('UNPAIRED');
            const { client } = clientOn(loadPage(modules, LOGIN));
            await client.inject();
            for (const state of ['OPENING', 'PAIRING', 'UNPAIRED']) {
                await Promise.all(bus.triggerSetSocketState(state));
            }
            expect(refreshes).to.deep.equal([]);
        });
    });

    describe('what it cannot do', function () {
        it('names the bus module it waited for in vain', async function () {
            const { modules } = loggedOutAppIn('UNPAIRED');
            modules.WAWebBackendEventBus = null;
            const err = await injectError(
                clientOn(loadPage(modules, LOGIN)).client,
            );
            expect(err.message).to.equal(
                'WhatsApp app modules unavailable: WAWebBackendEventBus (not-loaded)' +
                    ` on ${LOGIN} (build ${BUILD})`,
            );
        });

        it('says where its socket settled when that is not a QR', async function () {
            const { modules } = loggedOutAppIn('CONNECTED');
            const { client, events } = clientOn(loadPage(modules, LOGIN));
            const err = await injectError(client);
            expect(err.message).to.equal(
                "WhatsApp's logged-out app shows no QR: its socket settled on" +
                    ` CONNECTED on ${LOGIN} (build ${BUILD})`,
            );
            expect(events).to.deep.equal([]);
        });

        it('does not pair by phone number, and says so before waiting', async function () {
            const { modules } = loggedOutAppIn('UNPAIRED');
            modules.WAWebBackendEventBus = null;
            const { client } = clientOn(loadPage(modules, LOGIN), {
                pairWithPhoneNumber: { phoneNumber: '15550100' },
            });
            const err = await injectError(client);
            expect(err.message).to.equal(
                "WhatsApp's logged-out app cannot pair by phone number" +
                    ` on ${LOGIN} (build ${BUILD})`,
            );
        });
    });

    describe("the client's own calls there", function () {
        /** A client past inject on the logged-out app, its page recording what it asks for. */
        async function onLoggedOutApp() {
            const { modules, bus, refreshes } = loggedOutAppIn('UNPAIRED');
            const page = loadPage(modules, LOGIN);
            const { client } = clientOn(page);
            await client.inject();
            page.asked.length = 0;
            return { client, bus, refreshes, asked: page.asked };
        }

        it('answer the socket state off the bus, never asking for the model', async function () {
            const { client, bus, asked } = await onLoggedOutApp();
            expect(await client.getState()).to.equal('UNPAIRED');
            bus.triggerSetSocketState('UNPAIRED_IDLE');
            expect(await client.getState()).to.equal('UNPAIRED_IDLE');
            expect(asked).to.not.include('WAWebSocketModel');
        });

        it('reset the connection with a new socket and QR, as its reload button does', async function () {
            const { client, refreshes, asked } = await onLoggedOutApp();
            await client.resetState();
            expect(refreshes).to.deep.equal(['triggerRefreshQR']);
            expect(asked).to.not.include('WAWebSocketModel');
        });

        it('log out with no session on the page to end', async function () {
            const { client, asked } = await onLoggedOutApp();
            await client.logout();
            expect(asked).to.not.include('WAWebSocketModel');
        });

        it('are unchanged on the app', async function () {
            const modules = appIn('CONNECTED');
            const { client } = clientOn(loadPage(modules));
            await client.inject();
            const { Socket } = modules.WAWebSocketModel;
            expect(await client.getState()).to.equal('CONNECTED');
            await client.resetState();
            await client.logout();
            expect(Socket.calls).to.deep.equal(['reconnect', 'logout']);
        });
    });

    describe('a scan there, which only the next page can report', function () {
        /** A client whose page showed a QR on the logged-out app. */
        async function scannedOnLoggedOutApp() {
            const { modules } = loggedOutAppIn('UNPAIRED');
            const run = clientOn(loadPage(modules, LOGIN));
            await run.client.inject();
            return run;
        }

        /** WhatsApp's own navigation to `/`, where inject runs again. */
        async function landOn(run, modules, url = APP) {
            run.navigate(loadPage(modules, url));
            await run.client.inject();
        }

        it('is reported once, by the page that holds the session', async function () {
            const run = await scannedOnLoggedOutApp();
            await landOn(run, appIn('CONNECTED'));
            expect(run.events).to.deep.equal([QR('REF'), SCAN]);
            await landOn(run, appIn('CONNECTED'));
            expect(run.events).to.deep.equal([QR('REF'), SCAN]);
        });

        it('is reported by the page after a logged-out app that asks again', async function () {
            const run = await scannedOnLoggedOutApp();
            await landOn(run, loggedOutAppIn('UNPAIRED').modules, LOGIN);
            expect(run.events).to.deep.equal([QR('REF'), QR('REF')]);
            await landOn(run, appIn('CONNECTED'));
            expect(run.events).to.deep.equal([QR('REF'), QR('REF'), SCAN]);
        });

        it('is not what a page reports after a QR the app showed itself', async function () {
            const run = clientOn(loadPage(appIn('UNPAIRED')));
            await run.client.inject();
            await landOn(run, appIn('CONNECTED'));
            expect(run.events).to.deep.equal([QR('REF')]);
        });

        it('is forgotten with the client it was shown on', async function () {
            const run = await scannedOnLoggedOutApp();
            await run.client.destroy();
            await landOn(run, appIn('CONNECTED'));
            expect(run.events).to.deep.equal([QR('REF')]);
        });
    });
});
