const { expect } = require('chai');
const {
    InjectWaLoggerHook,
    WAL_TERMINAL,
    WAL_LEVELS,
    WAL_SIGNAL_LEVELS,
    WAL_SIGNAL_PER_TEMPLATE,
    WAL_SIGNAL_WINDOW_MS,
    WAL_MAX_BUFFERED,
    WAL_CARRY_KEY,
    WAL_CARRY_MAX_BYTES,
    isWaLoggerSignal,
} = require('../../src/util/Injected/WaLoggerHook');
const { evaluateInPage } = require('./evaluateBoundary');

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

/**
 * The one store that survives a navigation. Deliberately created OUTSIDE
 * fakePage so a test can throw the window away and build a new one on top of
 * the same store, which is exactly what a page load does.
 */
function fakeLocalStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
        size: () => data.size,
    };
}

function fakePage(localStorage) {
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
    // runner hanging on a live handle, and count it so a leak is visible.
    const timers = [];
    global.setInterval = (fn) => {
        timers.push(fn);
        return timers.length;
    };
    const listenerCalls = [];
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: (info) => emitted.push(info),
        onWaLogBatch: (lines) => batches.push(lines),
        addEventListener: (name, fn) => {
            listenerCalls.push(name);
            listeners[name] = fn;
        },
        localStorage: localStorage || fakeLocalStorage(),
    };
    return {
        emitted,
        batches,
        calls,
        listeners,
        listenerCalls,
        timers,
        WALogger,
    };
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
        // Through the same boundary puppeteer puts it through: the body is
        // re-parsed in global scope, so any module constant read from inside
        // would arrive as undefined.
        const install = (batchSize, maxBuffered) =>
            evaluateInPage(
                InjectWaLoggerHook,
                WAL_TERMINAL.source,
                WAL_LEVELS,
                WAL_SIGNAL_LEVELS,
                batchSize === undefined ? 200 : batchSize,
                60000,
                WAL_SIGNAL_PER_TEMPLATE,
                WAL_SIGNAL_WINDOW_MS,
                maxBuffered === undefined ? WAL_MAX_BUFFERED : maxBuffered,
                WAL_CARRY_KEY,
                WAL_CARRY_MAX_BYTES,
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
            // Measured on the live page against a real location.reload():
            // pagehide fires, window.onWaLogBatch is still a function, the call
            // returns a thenable and throws nothing, and 0 of 4 lines reach the
            // host. So pagehide must PARK the tail somewhere that outlives the
            // document, and the next page has to pick it up.
            const store = fakeLocalStorage();
            const page = fakePage(store);
            install(200);
            page.WALogger.LOG(tagged('the last thing before the logout'));
            expect(page.batches).to.have.length(0);

            page.listeners.pagehide();
            // Not delivered here, on purpose: the binding cannot deliver during
            // an unload, so trying would only look like it worked.
            expect(allBatched(page)).to.have.length(0);
            expect(store.getItem(WAL_CARRY_KEY)).to.be.a('string');

            // The navigation. A brand new window over the SAME store, which is
            // what a same-origin page load is.
            const next = fakePage(store);
            install(200);
            next.timers[0]();
            expect(
                allBatched(next).map(function (l) {
                    return l.msg;
                }),
            ).to.contain('the last thing before the logout');
            // Read once and cleared, so it cannot be delivered twice.
            expect(store.getItem(WAL_CARRY_KEY)).to.equal(null);
        });

        it('takes the tail back when the page was not unloaded after all', function () {
            // A bfcache restore fires pageshow with the document intact. The
            // parked copy has to come back into the live buffer, or it sits in
            // localStorage until a page load that may be hours away.
            const store = fakeLocalStorage();
            const page = fakePage(store);
            install(200);
            page.WALogger.LOG(tagged('parked but the page came back'));
            page.listeners.pagehide();
            expect(store.getItem(WAL_CARRY_KEY)).to.be.a('string');

            page.listeners.pageshow();
            expect(store.getItem(WAL_CARRY_KEY)).to.equal(null);
            page.timers[0]();
            expect(
                allBatched(page).map(function (l) {
                    return l.msg;
                }),
            ).to.contain('parked but the page came back');
        });

        it('bounds what it parks, so it cannot crowd out WA keys', function () {
            const store = fakeLocalStorage();
            const page = fakePage(store);
            install(5000, 5000);
            delete global.window.onWaLogBatch;
            for (let i = 0; i < 2000; i++)
                page.WALogger.LOG(tagged('x'.repeat(400) + i));
            page.listeners.pagehide();
            const parked = store.getItem(WAL_CARRY_KEY);
            expect(parked.length).to.be.at.most(WAL_CARRY_MAX_BYTES);
            // The oldest are kept, matching the overflow rule: a buffer this
            // big filled from boot, and boot is what explains the failure.
            expect(JSON.parse(parked)[0].msg).to.contain('x'.repeat(50) + '0');
        });

        it('survives a page with no usable localStorage', function () {
            const page = fakePage();
            global.window.localStorage = {
                getItem: () => {
                    throw new Error('denied');
                },
                setItem: () => {
                    throw new Error('denied');
                },
                removeItem: () => {},
            };
            expect(() => install(200)).to.not.throw();
            page.WALogger.LOG(tagged('still logged'));
            expect(() => page.listeners.pagehide()).to.not.throw();
            page.timers[0]();
            expect(allBatched(page)).to.have.length(1);
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

        it('caps a repeating template on the GCP side but never in the file', function () {
            // The level rule carries every WARN, and one routine template is
            // most of them - ~148k rows/day fleet-wide for a line that says
            // nothing. The file still gets all 40.
            const page = fakePage();
            install(1);
            for (let i = 0; i < 40; i++) {
                page.WALogger.WARN(
                    tagged(
                        '[devices] missing side contact hash for {} updates',
                    ),
                );
            }
            expect(page.emitted).to.have.length(WAL_SIGNAL_PER_TEMPLATE);
            expect(allBatched(page)).to.have.length(40);
        });

        it('counts what it dropped, so a climbing rate is still visible', function () {
            const page = fakePage();
            const realNow = Date.now;
            try {
                let now = 1000;
                Date.now = () => now;
                install(1);
                for (let i = 0; i < 40; i++) {
                    page.WALogger.WARN(tagged('a repeating warning'));
                }
                expect(page.emitted).to.have.length(WAL_SIGNAL_PER_TEMPLATE);
                expect(
                    page.emitted.every((e) => e.suppressed === undefined),
                ).to.equal(true);

                // Next window: the first one out carries what the last window
                // swallowed, so the rate is recoverable from GCP alone.
                now += WAL_SIGNAL_WINDOW_MS;
                page.WALogger.WARN(tagged('a repeating warning'));
                const last = page.emitted[page.emitted.length - 1];
                expect(last.suppressed).to.equal(37);
            } finally {
                Date.now = realNow;
            }
        });

        it('does not grow its throttle map without bound', function () {
            // Keys are templates, so the set is small in practice - but
            // WALogger also takes a plain string, and a caller building one per
            // call would otherwise leak over a page that lives for days.
            const page = fakePage();
            install(1);
            for (let i = 0; i < 2000; i++) {
                page.WALogger.WARN(tagged('unique warning number ' + i));
            }
            expect(page.emitted).to.have.length(2000);
        });

        it('never suppresses a terminal line, however often it repeats', function () {
            const page = fakePage();
            install(1);
            for (let i = 0; i < 20; i++) {
                page.WALogger.LOG(
                    tagged('storage initialization error, logging out'),
                );
            }
            expect(page.emitted).to.have.length(20);
            expect(page.emitted.every((e) => e.terminal === true)).to.equal(
                true,
            );
        });

        it('caps each template separately, so a novel line is never hidden', function () {
            const page = fakePage();
            install(1);
            for (let i = 0; i < 20; i++) {
                page.WALogger.WARN(tagged('the noisy one'));
            }
            page.WALogger.ERROR(tagged('a failure nobody has seen yet'));
            const msgs = page.emitted.map((e) => e.msg);
            expect(msgs).to.contain('a failure nobody has seen yet');
        });

        it('installs one timer and one listener, however often inject runs', function () {
            // inject() runs more than once per document - initialize() and
            // framenavigated race, and the logs show `inject:CANCELLING
            // previous inject` on a single page. Every extra install would
            // otherwise leave a live interval and a pagehide listener behind.
            const page = fakePage();
            install(1);
            install(1);
            install(1);
            expect(page.timers).to.have.length(1);
            expect(page.listenerCalls).to.deep.equal(['pagehide', 'pageshow']);
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

        // The failure this whole file exists for arrives in the page's first
        // seconds, and `exposeFunction` resolving is not proof the binding
        // reached the main world - the OOPIF bug this repo patches puppeteer
        // for makes it resolve while `window.<name>` stays undefined. Measured
        // on the live page before this was fixed: 0 of 5 lines survived.
        describe('when the host binding is not there', function () {
            it('keeps the lines instead of destroying them', function () {
                const page = fakePage();
                install(1);
                delete global.window.onWaLogBatch;
                page.WALogger.ERROR(tagged('[storage] purge, logging out'));
                page.WALogger.ERROR(tagged('Failed to initialize model storage'));
                expect(allBatched(page)).to.have.length(0);

                global.window.onWaLogBatch = (lines) => page.batches.push(lines);
                page.timers[0]();
                expect(allBatched(page).map((l) => l.msg)).to.deep.equal([
                    '[storage] purge, logging out',
                    'Failed to initialize model storage',
                ]);
            });

            it('puts a batch back when the binding throws mid-dispatch', function () {
                const page = fakePage();
                install(1);
                global.window.onWaLogBatch = () => {
                    throw new Error('did not dispatch');
                };
                page.WALogger.ERROR(tagged('first'));
                global.window.onWaLogBatch = (lines) => page.batches.push(lines);
                page.WALogger.ERROR(tagged('second'));
                // Order survives: the retained batch goes in front.
                expect(allBatched(page).map((l) => l.msg)).to.deep.equal([
                    'first',
                    'second',
                ]);
            });

            it('caps the backlog and says how much it dropped', function () {
                const page = fakePage();
                install(1, 3);
                delete global.window.onWaLogBatch;
                for (let i = 0; i < 6; i++) page.WALogger.LOG(tagged('l' + i));

                global.window.onWaLogBatch = (lines) => page.batches.push(lines);
                page.timers[0]();
                const got = allBatched(page);
                // The OLDEST are kept: a storage failure happens at boot, so
                // the head of this buffer is the part that explains it.
                expect(got.map((l) => l.msg)).to.deep.equal(['l0', 'l1', 'l2']);
                expect(got[0].droppedWhileUnbound).to.equal(3);
            });

            it('does not report a gap that did not happen', function () {
                const page = fakePage();
                install(1);
                page.WALogger.LOG(tagged('fine'));
                expect(allBatched(page)[0]).to.not.have.property(
                    'droppedWhileUnbound',
                );
            });

            it('still writes the local line when only the diag binding is gone', function () {
                const page = fakePage();
                install(1);
                delete global.window.onSocketDiagEvent;
                expect(function () {
                    page.WALogger.ERROR(tagged('[storage] schema mismatch'));
                }).to.not.throw();
                expect(allBatched(page)).to.have.length(1);
            });
        });
    });
});
