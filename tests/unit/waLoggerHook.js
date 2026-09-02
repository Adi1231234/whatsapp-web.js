const { expect } = require('chai');
const {
    InjectWaLoggerHook,
    WAL_TERMINAL,
    WAL_LEVELS,
    WAL_SIGNAL_LEVELS,
    isWaLoggerSignal,
} = require('../../src/util/Injected/WaLoggerHook');

// Verbatim from WhatsApp Web, on the path that ends in
// `clearCredentialsAndStoredData(WebFailStorageInitialization)` and a
// navigation to `?post_logout=1&logout_reason=0`.
//
// Split by DESTINATION, not by importance. Everything here reaches the local
// file; only some of it earns a GCP row, and the rule is the level plus the
// terminal set, never a guess about which words matter.
const SIGNAL_LINES = [
    ['ERROR', 'Failed to initialize model storage: {}'],
    ['ERROR', '[storage] Schema versions not initialized'],
    ['ERROR', 'clearCredentials: dirty bit is still set'],
    ['LOG', 'storage initialization error, logging out'],
    ['LOG', 'stream error due to device removed, logging out'],
    ['WARN', '[app] _pingForOtherLocalSession mutex timeout after {}ms'],
    ['EXPECTED_ERROR', 'anything at this level is quiet enough to forward'],
];

const FILE_ONLY_LINES = [
    ['LOG', '[storage] start load schema versions'],
    ['LOG', '[storage] set schema versions: {}. is worker? {}'],
    ['LOG', '[reload] reloadAfterLogout errorDuringStorageClear={}'],
    ['LOG', 'updated contact text status'],
    ['LOG', '[short-name] unable to get short name for contact'],
];

/** WALogger's real shape: a tagged-template array plus substitutions. */
const tagged = (text) => Object.assign([text], { raw: [text] });

const realSetInterval = global.setInterval;

function fakePage() {
    const emitted = [];
    const batches = [];
    const calls = [];
    const listeners = {};
    const WALogger = {};
    WAL_LEVELS.concat(['DEV_XMPP']).forEach((lvl) => {
        WALogger[lvl] = function () {
            calls.push([lvl, arguments]);
            return { catching: () => ({ sendLogs: () => {} }) };
        };
    });
    const modules = {
        WALogger,
        WAWebSocketModel: { Socket: { state: 'UNLAUNCHED' } },
    };
    // The hook installs a flush timer. Stub it so a unit test cannot leave the
    // runner hanging on a live handle.
    global.setInterval = () => 0;
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: (info) => emitted.push(info),
        onWaLogBatch: (lines) => batches.push(lines),
        addEventListener: (name, fn) => {
            listeners[name] = fn;
        },
    };
    return { emitted, batches, calls, listeners, WALogger };
}

const allBatched = (page) => page.batches.reduce((acc, b) => acc.concat(b), []);

describe('WaLoggerHook', function () {
    afterEach(function () {
        delete global.window;
        global.setInterval = realSetInterval;
    });

    describe('isWaLoggerSignal', function () {
        it('forwards every line that earns a GCP row', function () {
            SIGNAL_LINES.forEach(function (row) {
                expect(
                    isWaLoggerSignal(row[0], row[1]),
                    row[0] + ': ' + row[1],
                ).to.equal(true);
            });
        });

        it('keeps routine LOG out of GCP, that is the volume', function () {
            FILE_ONLY_LINES.forEach(function (row) {
                expect(
                    isWaLoggerSignal(row[0], row[1]),
                    row[0] + ': ' + row[1],
                ).to.equal(false);
            });
        });

        it('needs no vocabulary: an unseen ERROR is a signal by level alone', function () {
            expect(
                isWaLoggerSignal('ERROR', 'a failure nobody has seen yet'),
            ).to.equal(true);
        });
    });

    describe('InjectWaLoggerHook', function () {
        const install = (batchSize) =>
            InjectWaLoggerHook(
                WAL_TERMINAL.source,
                WAL_LEVELS,
                WAL_SIGNAL_LEVELS,
                batchSize === undefined ? 200 : batchSize,
                60000,
            );

        const emitAll = (page) =>
            SIGNAL_LINES.concat(FILE_ONLY_LINES).forEach(function (row) {
                page.WALogger[row[0]](tagged(row[1]));
            });

        it('batches EVERY line for the local file, signal or not', function () {
            const page = fakePage();
            install(1);
            emitAll(page);
            const kept = allBatched(page).map(function (l) {
                return l.msg;
            });
            SIGNAL_LINES.concat(FILE_ONLY_LINES).forEach(function (row) {
                expect(kept, row[1]).to.contain(row[1]);
            });
        });

        it('sends only the signal lines to GCP', function () {
            const page = fakePage();
            install(1);
            emitAll(page);
            expect(page.emitted).to.have.length(SIGNAL_LINES.length);
        });

        it('never touches DEV_XMPP, which carries message bodies', function () {
            const page = fakePage();
            install(1);
            page.WALogger.DEV_XMPP(tagged('--- Receiving ---'), 'a message');
            expect(allBatched(page)).to.have.length(0);
            expect(page.emitted).to.have.length(0);
        });

        it('holds lines until the batch fills', function () {
            const page = fakePage();
            install(3);
            page.WALogger.LOG(tagged('one'));
            page.WALogger.LOG(tagged('two'));
            expect(page.batches).to.have.length(0);
            page.WALogger.LOG(tagged('three'));
            expect(page.batches).to.have.length(1);
            expect(page.batches[0]).to.have.length(3);
        });

        it('flushes on pagehide, so a logout navigation cannot take the tail', function () {
            const page = fakePage();
            install(200);
            page.WALogger.LOG(tagged('the last thing before the logout'));
            expect(page.batches).to.have.length(0);
            page.listeners.pagehide();
            expect(
                allBatched(page).map(function (l) {
                    return l.msg;
                }),
            ).to.contain('the last thing before the logout');
        });

        it('carries the substitutions, which is why the schema line is worth keeping', function () {
            const page = fakePage();
            install(1);
            page.WALogger.LOG(
                tagged('[storage] set schema versions: {}. is worker? {}'),
                [['model-storage', 201]],
                false,
            );
            const line = allBatched(page)[0];
            expect(line.args).to.contain('model-storage');
            expect(line.state).to.equal('UNLAUNCHED');
            expect(line.ts).to.be.a('number');
        });

        it('always calls the original, forwarded or not', function () {
            const page = fakePage();
            install(1);
            page.WALogger.ERROR(tagged('Failed to initialize model storage'));
            page.WALogger.LOG(tagged('updated contact text status'));
            expect(page.calls).to.have.length(2);
        });

        it('does not double-wrap when injected twice', function () {
            const page = fakePage();
            install(1);
            install(1);
            page.WALogger.LOG(
                tagged('storage initialization error, logging out'),
            );
            expect(allBatched(page)).to.have.length(1);
            expect(page.emitted).to.have.length(1);
        });

        it('survives a page where WALogger is not loaded yet', function () {
            global.setInterval = () => 0;
            global.window = { require: () => undefined };
            expect(() => install()).to.not.throw();
        });

        it('never lets a broken bridge break WhatsApp', function () {
            const page = fakePage();
            install(1);
            global.window.onWaLogBatch = () => {
                throw new Error('bridge gone');
            };
            global.window.onSocketDiagEvent = () => {
                throw new Error('bridge gone');
            };
            expect(function () {
                page.WALogger.ERROR(
                    tagged('Failed to initialize model storage'),
                );
            }).to.not.throw();
            expect(page.calls).to.have.length(1);
        });
    });
});
