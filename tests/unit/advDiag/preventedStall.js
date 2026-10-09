const { expect } = require('chai');
const { evaluateInPage } = require('../evaluateBoundary');
const { fakePage, settle, nowS, DAY } = require('./fakePage');
const { BAD, storedFlagged, sync } = require('./fixedContact');
const AdvDir = '../../../src/util/Injected/AdvDiag/';
const { InstallKeyIndexThrowDiag } = require(AdvDir + 'keyIndexThrow');
const { InstallPendingSyncDiag } = require(AdvDir + 'pendingSync');
const { InstallPreventedStallVerdict } = require(AdvDir + 'preventedStall');

const SYNC = 'ADV_PENDING_SYNC';
const STALL = 'ADV_FIX_PREVENTED_STALL';
const HOUR = 3600;
const OWN = '972500001111@c.us';

/**
 * One drain of a queue holding the flagged contact and our own number, with
 * WhatsApp's check reaching the contact - so it passes only because of the
 * fix. `own` sets the own record's age and announcement; `tweak` changes the
 * page before the drain.
 */
async function drainOnce(own, tweak) {
    const page = fakePage();
    global.window.__p2dAdv.fixed.add(BAD);
    evaluateInPage(
        InstallKeyIndexThrowDiag,
        'ADV_KEY_INDEX_THROW',
        'ADV_FIX_PREVENTED_THROW',
    );
    evaluateInPage(InstallPreventedStallVerdict, STALL, 25);
    evaluateInPage(InstallPendingSyncDiag, SYNC);
    Object.assign(page.state.own, own);
    if (tweak) tweak(page);
    page.state.pending = [{ id: BAD }, { id: OWN }];
    page.state.duringSync = () => sync(page, BAD, storedFlagged());
    await page.modules.WAWebApiPendingDeviceSync.doPendingDeviceSync();
    await settle();
    await settle();
    const find = (name) => page.emitted.find((x) => x.event === name);
    return { sync: find(SYNC), stall: find(STALL) };
}

const announced = (ageDays, hoursAgo) => ({
    timestamp: nowS() - ageDays * DAY,
    expectedTs: nowS(),
    expectedTsUpdateTs: nowS() - hoursAgo * HOUR,
});

describe('AdvDiag: when a prevented stall would have logged out', function () {
    afterEach(function () {
        delete global.window;
    });

    it('names the 25h clock once a newer own list was announced', async function () {
        const { sync: s, stall } = await drainOnce(announced(3, 2));
        expect(s).to.include({
            drained: true,
            ownQueued: true,
            preventedThrows: 1,
        });
        expect(stall).to.include({
            preventedThrows: 1,
            ownQueued: true,
            ownAgeDays: 3,
            expiryDays: 35,
            ownNewerAnnounced: true,
            ownHoursSinceAnnounced: 2,
            logoutGate: true,
            logoutClock: '25h',
            logoutInHours: 23,
            withoutFix: 'own list stuck; logout once its 25h clock runs out',
        });
    });

    it('names the 35-day clock when nothing was announced, as on the stalled shop', async function () {
        const { stall } = await drainOnce({ timestamp: nowS() - 3 * DAY });
        expect(stall).to.include({
            ownNewerAnnounced: false,
            ownHoursSinceAnnounced: null,
            logoutClock: '35d',
            logoutInHours: 768,
            withoutFix: 'own list stuck; logout once its 35d clock runs out',
        });
    });

    it('names the 35-day clock when it runs out before the 25h one', async function () {
        const { stall } = await drainOnce(announced(34.5, 2));
        expect(stall).to.include({ logoutClock: '35d', logoutInHours: 12 });
    });

    it('claims no logout on an account WhatsApp does not log out', async function () {
        const { stall } = await drainOnce(announced(3, 2), (page) => {
            page.modules.WAWebABProps.getABPropConfigValue = () => false;
        });
        expect(stall).to.include({
            logoutGate: false,
            logoutClock: null,
            logoutInHours: null,
            withoutFix: 'own list stuck; no logout on this account',
        });
    });

    it('says the clocks are unknown when the own record cannot be read', async function () {
        const { stall } = await drainOnce({}, (page) => {
            page.modules.WAWebApiDeviceList.bulkGetDeviceRecord =
                async () => [];
        });
        expect(stall).to.include({
            ownAgeDays: null,
            logoutClock: null,
            withoutFix: 'own list stuck; own clocks unreadable',
        });
    });

    it('claims nothing when the drain failed anyway', async function () {
        const { stall } = await drainOnce(announced(3, 2), (page) => {
            page.state.failSync = true;
        });
        expect(stall).to.equal(undefined);
    });
});
