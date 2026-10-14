const { expect } = require('chai');
const { evaluateInPage } = require('../evaluateBoundary');
const { fakePage, settle, nowS } = require('./fakePage');
const {
    InstallOwnListDiag,
    ReportOwnList,
} = require('../../../src/util/Injected/AdvDiag/ownList');

const OWN = 'ADV_OWN_DEVICES';

const ownList = (devices) => ({
    id: '972500001111',
    rawId: 322931195,
    timestamp: nowS() - 60,
    currentIndex: 17,
    devices: devices,
});

const installed = () => {
    const page = fakePage();
    page.modules.WAWebUserPrefsMeUser.getMaybeMeDeviceId = () => 27;
    page.state.own = ownList([
        { id: 0, keyIndex: 0 },
        { id: 29, keyIndex: 17 },
        { id: 25, keyIndex: 13 },
        { id: 27, keyIndex: 15 },
    ]);
    expect(evaluateInPage(InstallOwnListDiag, OWN)).to.equal(true);
    return page;
};
const reports = (page) => page.emitted.filter((e) => e.event === OWN);

describe('AdvDiag: the own device list', function () {
    afterEach(function () {
        delete global.window;
    });

    it('reports the list once the app has synced', async function () {
        const page = installed();
        expect(await evaluateInPage(ReportOwnList)).to.equal(true);
        expect(reports(page)).to.deep.equal([
            {
                event: OWN,
                trigger: 'sync',
                user: '1111@c.us',
                me: 27,
                meKeyIndex: 15,
                rawId: 322931195,
                currentIndex: 17,
                signedAt: page.state.own.timestamp,
                companions: 3,
                devices: '25:13 27:15 29:17',
            },
        ]);
    });

    // WhatsApp's toLogString masks only behind a flag; without it, it returns
    // the whole number.
    it('masks the account itself, whatever toLogString does', async function () {
        const page = installed();
        page.modules.WAWebUserPrefsMeUser.getMaybeMePnUser = () => ({
            user: '972500001111',
            toLogString: () => '972500001111@c.us',
            toString: () => '972500001111@c.us',
        });
        await evaluateInPage(ReportOwnList);
        expect(reports(page)[0].user).to.equal('1111@c.us');
    });

    it('says nothing, and says so, before the account is registered', async function () {
        const page = installed();
        page.modules.WAWebUserPrefsMeUser.getMaybeMePnUser = () => null;
        page.modules.WAWebUserPrefsMeUser.getMaybeMeLidUser = () => null;
        expect(await evaluateInPage(ReportOwnList)).to.equal(false);
        expect(reports(page)).to.deep.equal([]);
    });

    it('reports again only when a write changed the own list', async function () {
        const page = installed();
        await evaluateInPage(ReportOwnList);
        const api = page.modules.WAWebApiDeviceList;

        await api.bulkCreateOrReplaceDeviceRecord([{ id: '972500000932' }]);
        await api.createOrReplaceDeviceRecord(page.state.own);
        await settle();
        expect(reports(page)).to.have.length(1);

        page.state.own = ownList([
            { id: 0, keyIndex: 0 },
            { id: 27, keyIndex: 15 },
        ]);
        await api.createOrReplaceDeviceRecord(page.state.own);
        await settle();
        expect(reports(page).map((r) => [r.trigger, r.devices])).to.deep.equal([
            ['sync', '25:13 27:15 29:17'],
            ['write', '27:15'],
        ]);
    });
});
