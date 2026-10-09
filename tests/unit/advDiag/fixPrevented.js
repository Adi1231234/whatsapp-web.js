const { expect } = require('chai');
const { evaluateInPage } = require('../evaluateBoundary');
const {
    fakePage,
    fakeLocalStorage,
    settle,
    wid,
    nowS,
    DAY,
} = require('./fakePage');
const AdvDir = '../../../src/util/Injected/AdvDiag/';
const { InstallHostedWriteDiag } = require(AdvDir + 'hostedWrite');
const { InstallKeyIndexThrowDiag } = require(AdvDir + 'keyIndexThrow');
const { InstallPendingSyncDiag } = require(AdvDir + 'pendingSync');
const {
    InjectHostedDeviceFlag,
} = require('../../../src/util/Injected/HostedDeviceFlag/inject');

const WRITE = 'ADV_HOSTED_WRITE_WITHOUT_FLAG';
const THROW = 'ADV_KEY_INDEX_THROW';
const PREVENTED = 'ADV_FIX_PREVENTED_THROW';
const SYNC = 'ADV_PENDING_SYNC';
const STALL = 'ADV_FIX_PREVENTED_STALL';
const BAD = '972500000775@c.us';

/** The record as the fix leaves it in storage: device 99 flagged. */
const storedFlagged = () => ({
    timestamp: nowS() - 4 * DAY,
    advAccountType: 1,
    devices: [{ id: 99, keyIndex: 6, isHosted: true }, { id: 0 }],
});
const sync = (page, user, local, incoming) =>
    page.modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync(
        wid(user.split('@')[0]),
        incoming === undefined ? null : incoming,
        1,
        null,
        null,
        local,
    );

describe('AdvDiag: what the fix prevented, asked of WhatsApp itself', function () {
    afterEach(function () {
        delete global.window;
    });

    it('remembers a contact the fix flagged, across a page load', async function () {
        const store = fakeLocalStorage();
        const page = fakePage(store);
        evaluateInPage(InjectHostedDeviceFlag, 99);
        evaluateInPage(InstallHostedWriteDiag, WRITE);
        await page.modules.WAWebApiDeviceList.createOrReplaceDeviceRecord({
            id: BAD,
            devices: [{ id: 99, keyIndex: 6 }],
        });
        expect(page.state.writes[0].devices[0].isHosted).to.equal(true);
        const e = page.emitted.find((x) => x.event === WRITE);
        expect(e).to.include({ fixActive: true, source: 'whatsapp' });
        fakePage(store);
        expect(global.window.__p2dAdv.fixed.has(BAD)).to.equal(true);
    });

    it("re-runs WhatsApp's check without the fix, and reports the throw it prevented", function () {
        const page = fakePage();
        global.window.__p2dAdv.fixed.add(BAD);
        evaluateInPage(InstallKeyIndexThrowDiag, THROW, PREVENTED);
        expect(sync(page, BAD, storedFlagged())).to.deep.equal({ update: {} });
        const e = page.emitted.find((x) => x.event === PREVENTED);
        expect(e).to.include({ user: '0775@c.us', keyIndex: 6 });
        expect(e.wouldHaveThrown).to.contain('#76137');
        expect(global.window.__p2dAdv.prevented).to.equal(1);
        expect(page.emitted.find((x) => x.event === THROW)).to.equal(undefined);
    });

    it('re-runs nothing for a contact the fix never touched', function () {
        const page = fakePage();
        evaluateInPage(InstallKeyIndexThrowDiag, THROW, PREVENTED);
        sync(page, BAD, storedFlagged());
        expect(page.emitted).to.have.length(0);
    });

    it('re-runs nothing for a server-sent list, which the fix does not touch', function () {
        const page = fakePage();
        global.window.__p2dAdv.fixed.add(BAD);
        evaluateInPage(InstallKeyIndexThrowDiag, THROW, PREVENTED);
        sync(page, BAD, storedFlagged(), [{ id: 99, isHosted: true }]);
        expect(page.emitted).to.have.length(0);
    });

    it('says what a drain that only passed because of the fix would have meant', async function () {
        const page = fakePage();
        global.window.__p2dAdv.fixed.add(BAD);
        evaluateInPage(InstallKeyIndexThrowDiag, THROW, PREVENTED);
        evaluateInPage(InstallPendingSyncDiag, SYNC, STALL);
        page.state.own = Object.assign(page.state.own, {
            expectedTs: nowS(),
            expectedTsUpdateTs: nowS() - 2 * 3600,
        });
        page.state.pending = [{ id: BAD }, { id: '972500001111@c.us' }];
        page.state.duringSync = () => sync(page, BAD, storedFlagged());
        await page.modules.WAWebApiPendingDeviceSync.doPendingDeviceSync();
        await settle();
        await settle();
        expect(page.emitted.find((x) => x.event === SYNC)).to.include({
            drained: true,
            ownQueued: true,
            preventedThrows: 1,
        });
        expect(page.emitted.find((x) => x.event === STALL)).to.include({
            preventedThrows: 1,
            ownQueued: true,
            ownNewerAnnounced: true,
            logoutGate: true,
            withoutFix: 'own list stuck; logout once its 25h run out',
        });
    });

    it('claims nothing when the drain failed anyway', async function () {
        const page = fakePage();
        global.window.__p2dAdv.fixed.add(BAD);
        evaluateInPage(InstallKeyIndexThrowDiag, THROW, PREVENTED);
        evaluateInPage(InstallPendingSyncDiag, SYNC, STALL);
        page.state.pending = [{ id: BAD }];
        page.state.failSync = true;
        page.state.duringSync = () => sync(page, BAD, storedFlagged());
        await page.modules.WAWebApiPendingDeviceSync.doPendingDeviceSync();
        await settle();
        await settle();
        expect(page.emitted.find((x) => x.event === STALL)).to.equal(undefined);
    });
});
