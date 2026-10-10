const { expect } = require('chai');
const { evaluateInPage } = require('../evaluateBoundary');
const { installWaGateway } = require('../../../src/util/Injected/WaGateway');
const { installAdvDiag } = require('../../../src/util/Injected/AdvDiag');
const {
    installHostedDeviceFlag,
} = require('../../../src/util/Injected/HostedDeviceFlag');
const WaLoggerHook = require('../../../src/util/Injected/WaLoggerHook');
const { healthyModules } = require('./fakeWhatsApp');

// The real installers, against a page that evaluates in this process - the
// same order inject() and the synced phase run them in.
const page = { evaluate: async (fn, ...args) => evaluateInPage(fn, ...args) };

const realSetInterval = global.setInterval;

async function installEverything(modules) {
    global.setInterval = () => 0;
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: () => {},
        onWaLogBatch: () => {},
        addEventListener: () => {},
        localStorage: { getItem: () => null, setItem: () => {} },
        Debug: { VERSION: '2.3000.1' },
    };
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
    );
    await installHostedDeviceFlag(page);
    await installAdvDiag(page, 'inject', () => {});
    await installAdvDiag(page, 'synced', () => {});
    return global.window.WaGateway.check();
}

describe('WaGateway: the check sees WhatsApp through our own wrappers', function () {
    afterEach(function () {
        global.setInterval = realSetInterval;
        delete global.window;
    });

    // Found in review: AdvDiag wraps handleKeyIndexResultSync before the check
    // runs, and a wrapper's `length` is 0 - a false arity problem on every load.
    it('finds nothing wrong once every hook is installed', async function () {
        const modules = healthyModules();
        const { problems } = await installEverything(modules);
        expect(problems).to.deep.equal([]);
        const wrapped =
            modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync;
        expect(wrapped.__p2dAdv, 'the hook really is installed').to.equal(true);
    });

    it('still sees a real change to the argument count through the wrapper', async function () {
        const modules = healthyModules();
        modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync =
            function (a, b, c, d, e, f, g, h, i, j) {}; // eslint-disable-line no-unused-vars
        const { problems } = await installEverything(modules);
        expect(problems).to.have.length(1);
        expect(problems[0]).to.include({
            problem: 'arity',
            expected: 9,
            actual: 10,
        });
    });
});
