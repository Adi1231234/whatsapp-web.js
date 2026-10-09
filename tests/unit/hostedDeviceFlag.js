const { expect } = require('chai');
const { evaluateInPage } = require('./evaluateBoundary');
const {
    InjectHostedDeviceFlag,
    RepairHostedDeviceFlag,
} = require('../../src/util/Injected/HostedDeviceFlag/inject');

// Shapes from the live build: the writers are exports called by property, and
// the record that stalled a real queue was `[99:1, 0:0]` with no flag.
const unflagged = (id) => ({
    id: id,
    advAccountType: 1,
    devices: [
        { id: 99, keyIndex: 1 },
        { id: 0, keyIndex: 0 },
    ],
});

function fakePage(stored) {
    const table = new Map((stored || []).map((r) => [r.id, r]));
    const writes = [];
    const api = {
        createOrReplaceDeviceRecord: async (r, extra) => {
            writes.push({ r: r, extra: extra });
            table.set(r.id, r);
        },
        bulkCreateOrReplaceDeviceRecord: async (rs) =>
            rs.forEach((r) => {
                writes.push({ r: r });
                table.set(r.id, r);
            }),
        getAllDeviceLists: async () => Array.from(table.values()),
    };
    global.window = {
        require: (n) => (n === 'WAWebApiDeviceList' ? api : null),
    };
    return { api, table, writes };
}

/** WhatsApp's assertion, as `handleKeyIndexResultSync` makes it. */
const syncThrows = (record) =>
    record.devices.some((d) => d.id === 99 && d.isHosted !== true);

describe('HostedDeviceFlag', function () {
    afterEach(function () {
        delete global.window;
    });

    it('stores device 99 flagged, on a copy of the caller record', async function () {
        const page = fakePage();
        evaluateInPage(InjectHostedDeviceFlag, 99);
        const record = unflagged('1@c.us');
        await page.api.createOrReplaceDeviceRecord(record);
        const stored = page.table.get('1@c.us');
        expect(stored.devices[0]).to.deep.equal({
            id: 99,
            keyIndex: 1,
            isHosted: true,
        });
        expect(record.devices[0]).to.not.have.property('isHosted');
        expect(stored.advAccountType).to.equal(1);
    });

    it('passes every other record through untouched, and the extra arguments', async function () {
        const page = fakePage();
        evaluateInPage(InjectHostedDeviceFlag, 99);
        const plain = { id: '2@c.us', devices: [{ id: 0, keyIndex: 0 }] };
        await page.api.createOrReplaceDeviceRecord(plain, 'extra');
        expect(page.writes[0].r).to.equal(plain);
        expect(page.writes[0].extra).to.equal('extra');
    });

    it('flags inside a bulk write too', async function () {
        const page = fakePage();
        evaluateInPage(InjectHostedDeviceFlag, 99);
        await page.api.bulkCreateOrReplaceDeviceRecord([
            unflagged('1@c.us'),
            unflagged('2@c.us'),
        ]);
        expect(Array.from(page.table.values()).some(syncThrows)).to.equal(
            false,
        );
    });

    it('wraps once however often it is installed', async function () {
        const page = fakePage();
        evaluateInPage(InjectHostedDeviceFlag, 99);
        const first = page.api.createOrReplaceDeviceRecord;
        evaluateInPage(InjectHostedDeviceFlag, 99);
        expect(page.api.createOrReplaceDeviceRecord).to.equal(first);
    });

    it('never lets the correction break the write', async function () {
        const page = fakePage();
        evaluateInPage(InjectHostedDeviceFlag, 99);
        const odd = { id: '3@c.us', devices: 'not a list' };
        await page.api.createOrReplaceDeviceRecord(odd);
        expect(page.table.get('3@c.us')).to.equal(odd);
    });

    it('repairs what was stored earlier, and reports what is left', async function () {
        const page = fakePage([
            unflagged('1@c.us'),
            unflagged('2@c.us'),
            {
                id: '3@c.us',
                devices: [{ id: 99, keyIndex: 4, isHosted: true }],
            },
            Object.assign(unflagged('4@c.us'), { deleted: true }),
        ]);
        evaluateInPage(InjectHostedDeviceFlag, 99);
        expect(
            Array.from(page.table.values()).filter(syncThrows),
        ).to.have.length(3);
        const report = await evaluateInPage(RepairHostedDeviceFlag);
        expect(report).to.deep.equal({ found: 2, remaining: 0 });
        // The deleted row is not WhatsApp's to sync, and not ours to rewrite.
        expect(page.table.get('4@c.us').devices[0]).to.not.have.property(
            'isHosted',
        );
    });

    it('does not pretend to repair without the wrapper', async function () {
        fakePage([unflagged('1@c.us')]);
        expect(await evaluateInPage(RepairHostedDeviceFlag)).to.deep.equal({
            found: null,
        });
    });
});
