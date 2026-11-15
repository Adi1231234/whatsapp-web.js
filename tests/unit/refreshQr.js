const { expect } = require('chai');
const Client = require('../../src/Client');
const { evaluateInPage } = require('./evaluateBoundary');

/**
 * A client whose page runs injected code the way puppeteer does, against
 * WhatsApp's event bus, counting refreshes.
 */
function clientOn(pairWithPhoneNumber) {
    const refreshes = [];
    const modules = {
        WAWebBackendEventBus: {
            BackendEventBus: {
                triggerRefreshQR: () => refreshes.push('triggerRefreshQR'),
            },
        },
    };
    global.window = { require: (name) => modules[name] };
    const client = Object.create(Client.prototype);
    Object.assign(client, {
        options: { pairWithPhoneNumber },
        pupPage: {
            evaluate: async (fn, ...args) => evaluateInPage(fn, ...args),
        },
    });
    return { client, refreshes };
}

describe('an expired QR', function () {
    afterEach(function () {
        delete global.window;
    });

    it("is refreshed the way WhatsApp's own reload button does it", async function () {
        const { client, refreshes } = clientOn({ phoneNumber: '' });
        await client._onAuthAppStateChanged('UNPAIRED_IDLE');
        expect(refreshes).to.deep.equal(['triggerRefreshQR']);
    });

    it('is left alone in any other state', async function () {
        const { client, refreshes } = clientOn({ phoneNumber: '' });
        for (const state of ['UNPAIRED', 'OPENING', 'PAIRING', 'CONNECTED']) {
            await client._onAuthAppStateChanged(state);
        }
        expect(refreshes).to.deep.equal([]);
    });

    it('is not what a pairing by phone number waits for', async function () {
        const { client, refreshes } = clientOn({ phoneNumber: '972500000000' });
        await client._onAuthAppStateChanged('UNPAIRED_IDLE');
        expect(refreshes).to.deep.equal([]);
    });
});
