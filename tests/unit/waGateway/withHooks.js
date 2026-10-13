const { expect } = require('chai');
const { evaluateInPage } = require('../evaluateBoundary');
const { installWaGateway } = require('../../../src/util/Injected/WaGateway');
const { installAdvDiag } = require('../../../src/util/Injected/AdvDiag');
const {
    installHostedDeviceFlag,
} = require('../../../src/util/Injected/HostedDeviceFlag');
const WaLoggerHook = require('../../../src/util/Injected/WaLoggerHook');
const { healthyModules } = require('./fakeWhatsApp');

// The real installers, against a page that evaluates in this process.
const page = { evaluate: async (fn, ...args) => evaluateInPage(fn, ...args) };

const realSetInterval = global.setInterval;

function freshPage(modules) {
    const emitted = [];
    global.setInterval = () => 0;
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: (info) => emitted.push(info),
        onWaLogBatch: () => {},
        addEventListener: () => {},
        localStorage: { getItem: () => null, setItem: () => {} },
        Debug: { VERSION: '2.3000.1' },
    };
    return emitted;
}

/** What inject() installs, then the synced phase - the order in Client.js. */
async function injectPhase() {
    await installWaGateway(page);
    evaluateInPage(
        WaLoggerHook.InjectWaLoggerHook,
        WaLoggerHook.WAL_TERMINAL.source,
        WaLoggerHook.WAL_LEVELS,
        WaLoggerHook.WAL_SIGNAL_LEVELS,
        WaLoggerHook.WAL_BATCH_SIZE,
        WaLoggerHook.WAL_FLUSH_MS,
        WaLoggerHook.WAL_SIGNAL_PER_TEMPLATE,
        WaLoggerHook.WAL_SIGNAL_WINDOW_MS,
        WaLoggerHook.WAL_MAX_BUFFERED,
        WaLoggerHook.WAL_CARRY_KEY,
        WaLoggerHook.WAL_CARRY_MAX_BYTES,
        WaLoggerHook.WAL_EVENT_PREFIX,
    );
    await installHostedDeviceFlag(page);
    await installAdvDiag(page, 'inject', () => {});
}
async function syncedPhase() {
    await installHostedDeviceFlag(page);
    const installed = [];
    await installAdvDiag(page, 'synced', (s) => installed.push(s));
    return installed[0];
}

const unflagged = () => ({
    id: '972500000932',
    devices: [{ id: 0 }, { id: 99, keyIndex: 6 }],
});

describe('WaGateway: the check sees WhatsApp through our own wrappers', function () {
    afterEach(function () {
        global.setInterval = realSetInterval;
        delete global.window;
    });

    // Found in review: AdvDiag wraps handleKeyIndexResultSync before the check
    // runs, and a wrapper's `length` is 0 - a false arity problem on every load.
    it('finds nothing wrong once every hook is installed', async function () {
        freshPage(healthyModules());
        await injectPhase();
        const status = await syncedPhase();
        expect(status, 'the hooks really are installed').to.include({
            keyIndexThrow: true,
            hostedWrite: true,
        });
        expect(global.window.WaGateway.check().problems).to.deep.equal([]);
    });

    it('still sees a real change to the argument count through the wrapper', async function () {
        const modules = healthyModules();
        modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync =
            function (a, b, c, d, e, f, g, h, i, j) {}; // eslint-disable-line no-unused-vars
        freshPage(modules);
        await injectPhase();
        await syncedPhase();
        const { problems } = global.window.WaGateway.check();
        expect(problems).to.have.length(1);
        expect(problems[0]).to.include({
            problem: 'arity',
            expected: 9,
            actual: 10,
        });
    });

    // Found in the field (4.3.60): the fix and the diagnostic each looked for
    // their own marker on the outermost function, so every install wrapped the
    // other's wrapper again.
    it('wraps each writer once, however often inject and synced run', async function () {
        const modules = healthyModules();
        freshPage(modules);
        const api = modules.WAWebApiDeviceList;
        await injectPhase();
        const one = api.createOrReplaceDeviceRecord;
        const bulk = api.bulkCreateOrReplaceDeviceRecord;
        await syncedPhase();
        await injectPhase();
        await syncedPhase();
        expect(api.createOrReplaceDeviceRecord).to.equal(one);
        expect(api.bulkCreateOrReplaceDeviceRecord).to.equal(bulk);
    });

    it('lets the diagnostic see a bad write before the fix corrects it', async function () {
        const modules = healthyModules();
        const stored = [];
        modules.WAWebApiDeviceList.createOrReplaceDeviceRecord = async (r) =>
            stored.push(r);
        const emitted = freshPage(modules);
        await injectPhase();
        // A write between the synced phase's two installs, where the fix used
        // to end up outermost and the diagnostic never saw the record.
        await installHostedDeviceFlag(page);
        await modules.WAWebApiDeviceList.createOrReplaceDeviceRecord(
            unflagged(),
        );
        const seen = emitted.filter(
            (e) => e.event === 'ADV_HOSTED_WRITE_WITHOUT_FLAG',
        );
        expect(seen).to.have.length(1);
        expect(seen[0].user, 'a bare phone number goes out masked').to.equal(
            '0932',
        );
        expect(stored[0].devices[1].isHosted).to.equal(true);
    });
});
