const { expect } = require('chai');
const { evaluateInPage } = require('../evaluateBoundary');
const { fakePage, settle, wid, ME, DAY, nowS } = require('./fakePage');
const {
    InstallHostedWriteDiag,
} = require('../../../src/util/Injected/AdvDiag/hostedWrite');
const {
    InstallDailyCheckDiag,
} = require('../../../src/util/Injected/AdvDiag/dailyCheck');

const WRITE = 'ADV_HOSTED_WRITE_WITHOUT_FLAG';
const DAILY = 'ADV_DAILY_CHECK';

const bad = (id) => ({
    id: id,
    timestamp: nowS() - 34 * DAY,
    advAccountType: 1,
    devices: [{ id: 0 }, { id: 99, keyIndex: 6 }],
});

describe('AdvDiag: where the bad record comes from, and how a stall ends', function () {
    afterEach(function () {
        delete global.window;
    });

    it('catches device 99 stored without its flag, and still stores it', async function () {
        const page = fakePage();
        evaluateInPage(InstallHostedWriteDiag, WRITE);
        await page.modules.WAWebApiDeviceList.bulkCreateOrReplaceDeviceRecord([
            bad('972500000932@c.us'),
            { id: '972500000001@c.us', devices: [{ id: 99, isHosted: true }] },
        ]);
        expect(page.state.writes).to.have.length(2);
        const writes = page.emitted.filter((e) => e.event === WRITE);
        expect(writes).to.have.length(1);
        expect(writes[0]).to.include({
            user: '0932@c.us',
            keyIndex: 6,
            accountType: 1,
        });
        expect(writes[0].by).to.be.a('string');
    });

    it('reports a contact once per page, however often it is rewritten', async function () {
        const page = fakePage();
        evaluateInPage(InstallHostedWriteDiag, WRITE);
        const api = page.modules.WAWebApiDeviceList;
        await api.createOrReplaceDeviceRecord(bad('972500000932@c.us'));
        await api.createOrReplaceDeviceRecord(bad('972500000932@c.us'));
        expect(page.emitted.filter((e) => e.event === WRITE)).to.have.length(1);
    });

    it('reports the own clocks on every daily check', async function () {
        const page = fakePage();
        evaluateInPage(InstallDailyCheckDiag, DAILY, 25);
        page.state.own = {
            timestamp: nowS() - 10 * DAY,
            expectedTs: nowS() - DAY,
            expectedTsUpdateTs: nowS() - 7 * 3600,
            devices: [{ id: 0 }, { id: 42 }],
        };
        page.state.expiration = {
            usersExpired: new Map(),
            usersCloseToExpiration: new Map([[ME, page.state.own]]),
        };
        await new page.Bridge().getUsersForExpiration(nowS());
        await settle();
        const e = page.emitted.find((x) => x.event === DAILY);
        expect(e).to.include({
            ownExpired: null,
            ownKnown: true,
            ownNewerAnnounced: true,
            closeToExpiry: 1,
            logoutGate: true,
        });
        expect(e.ownAgeDays).to.be.within(9.9, 10.1);
        expect(e.ownHoursSinceAnnounced).to.be.within(6.9, 7.1);
    });

    it('says which clock expired the own list: 25h when it is younger than 35 days', async function () {
        const page = fakePage();
        evaluateInPage(InstallDailyCheckDiag, DAILY, 25);
        const own = { timestamp: nowS() - 20 * DAY, devices: [] };
        page.state.expiration = {
            usersExpired: new Map([[ME, own]]),
            usersCloseToExpiration: new Map(),
        };
        await new page.Bridge().getUsersForExpiration(nowS());
        await settle();
        expect(page.emitted.find((x) => x.event === DAILY).ownExpired).to.equal(
            '25h',
        );
    });

    it('names expired contacts with an unflagged device 99, which is how a stall ends', async function () {
        const page = fakePage();
        evaluateInPage(InstallDailyCheckDiag, DAILY, 25);
        page.state.expiration = {
            usersExpired: new Map([
                [wid('972500000775'), bad('972500000775@c.us')],
                [wid('972500000888'), { timestamp: 1, devices: [{ id: 0 }] }],
            ]),
            usersCloseToExpiration: new Map(),
        };
        await new page.Bridge().getUsersForExpiration(nowS());
        await settle();
        const e = page.emitted.find((x) => x.event === DAILY);
        expect(e).to.include({
            expired: 2,
            expiredBad99Count: 1,
            expiredBad99: '0775@c.us',
            ownExpired: null,
        });
    });

    it('hands WhatsApp its own result untouched', async function () {
        const page = fakePage();
        evaluateInPage(InstallDailyCheckDiag, DAILY, 25);
        const result = {
            usersExpired: new Map(),
            usersCloseToExpiration: new Map(),
        };
        page.state.expiration = result;
        expect(await new page.Bridge().getUsersForExpiration(nowS())).to.equal(
            result,
        );
    });
});
