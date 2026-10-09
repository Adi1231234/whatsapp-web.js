const { expect } = require('chai');
const { evaluateInPage } = require('../evaluateBoundary');
const { fakePage, settle, wid } = require('./fakePage');
const {
    InstallPendingSyncDiag,
} = require('../../../src/util/Injected/AdvDiag/pendingSync');
const {
    InstallKeyIndexThrowDiag,
} = require('../../../src/util/Injected/AdvDiag/keyIndexThrow');

const SYNC = 'ADV_PENDING_SYNC';
const THROW = 'ADV_KEY_INDEX_THROW';

describe('AdvDiag: the stalled device-sync queue', function () {
    afterEach(function () {
        delete global.window;
    });

    it('says a failed attempt kept every row, and that our own number waits in it', async function () {
        const page = fakePage();
        evaluateInPage(InstallPendingSyncDiag, SYNC);
        page.state.pending = [
            { id: '972500002222@c.us' },
            { id: '972500001111@c.us' },
        ];
        page.state.failSync = true;
        await page.modules.WAWebApiPendingDeviceSync.doPendingDeviceSync();
        await settle();
        const e = page.emitted.find((x) => x.event === SYNC);
        expect(e).to.include({ before: 2, after: 2, drained: false });
        expect(e.ownQueued).to.equal(true);
    });

    it('says a successful attempt drained it', async function () {
        const page = fakePage();
        evaluateInPage(InstallPendingSyncDiag, SYNC);
        page.state.pending = [{ id: '972500002222@c.us' }];
        await page.modules.WAWebApiPendingDeviceSync.doPendingDeviceSync();
        await settle();
        const e = page.emitted.find((x) => x.event === SYNC);
        expect(e).to.include({ before: 1, after: 0, drained: true });
        expect(e.ownQueued).to.equal(false);
    });

    it('stays silent with nothing waiting, the healthy steady state', async function () {
        const page = fakePage();
        evaluateInPage(InstallPendingSyncDiag, SYNC);
        await page.modules.WAWebApiPendingDeviceSync.doPendingDeviceSync();
        await settle();
        expect(page.emitted).to.have.length(0);
    });

    it('names the contact the batch dies on, from what this computer stored', function () {
        const page = fakePage();
        evaluateInPage(InstallKeyIndexThrowDiag, THROW);
        const local = {
            timestamp: Math.floor(Date.now() / 1000) - 25 * 86400,
            advAccountType: 1,
            devices: [{ id: 0 }, { id: 99, keyIndex: 18 }],
        };
        expect(() =>
            page.modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync(
                wid('972500000775'),
                null,
                1,
                null,
                null,
                local,
            ),
        ).to.throw('Minified invariant #76137');
        const e = page.emitted.find((x) => x.event === THROW);
        expect(e).to.include({
            user: '0775@c.us',
            devicesFrom: 'stored',
            device99: 'keyIndex=18 isHosted=false',
            storedAccountType: 1,
        });
        expect(e.storedAgeDays).to.be.within(24.9, 25.1);
        expect(e.error).to.contain('Invariant Violation');
        expect(e.at).to.contain('handleKeyIndexResultSync');
    });

    it('tells a server-sent list apart from a stored one', function () {
        const page = fakePage();
        evaluateInPage(InstallKeyIndexThrowDiag, THROW);
        const call = () =>
            page.modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync(
                wid('972500000123'),
                [{ id: 99, keyIndex: 2 }],
                1,
                null,
                null,
                null,
            );
        expect(call).to.throw();
        expect(page.emitted[0].devicesFrom).to.equal('server');
    });

    it('changes nothing on the path that does not throw', function () {
        const page = fakePage();
        evaluateInPage(InstallKeyIndexThrowDiag, THROW);
        const out =
            page.modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync(
                wid('972500000123'),
                [{ id: 99, keyIndex: 2, isHosted: true }],
            );
        expect(out).to.deep.equal({ update: {} });
        expect(page.emitted).to.have.length(0);
    });

    it('wraps once however often it is installed', function () {
        const page = fakePage();
        evaluateInPage(InstallKeyIndexThrowDiag, THROW);
        evaluateInPage(InstallKeyIndexThrowDiag, THROW);
        expect(() =>
            page.modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync(
                wid('972500000123'),
                [{ id: 99 }],
            ),
        ).to.throw();
        expect(page.emitted).to.have.length(1);
    });
});
