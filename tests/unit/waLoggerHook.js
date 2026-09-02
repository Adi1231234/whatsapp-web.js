const { expect } = require('chai');
const {
    InjectWaLoggerHook,
    WAL_KEYWORDS,
    WAL_LOG_PREFIXES,
    WAL_TERMINAL,
    shouldForwardWaLoggerLine,
} = require('../../src/util/Injected/WaLoggerHook');

// Verbatim from WhatsApp Web. Every one of these is on the path that ends in
// `Socket.clearCredentialsAndStoredData(WebFailStorageInitialization)` and a
// navigation to `?post_logout=1&logout_reason=0`, which destroys the session.
const STORAGE_PATH = [
    ['ERROR', 'Failed to initialize model storage: {}'],
    ['ERROR', '[storage] Schema versions not initialized'],
    ['LOG', 'storage initialization error, logging out'],
    ['LOG', '[storage] start load schema versions'],
    ['LOG', '[storage] set schema versions: {}. is worker? {}'],
    ['LOG', '[reload] reloadAfterLogout errorDuringStorageClear={}'],
];

// DiagHooks' terminal set. This hook installs first and its __p2dWrapped guard
// makes DiagHooks' copy a no-op, so anything the old post-sync hook carried and
// this one does not is coverage silently LOST. These lock that in.
const TERMINAL_PATH = [
    ['LOG', 'stream error due to device removed, logging out'],
    ['ERROR', 'clearCredentials: dirty bit is still set'],
    ['LOG', 'user was logged out'],
    ['ERROR', 'primary identity changed'],
    ['WARN', 'received failure stanza'],
    ['ERROR', 'clearCredentials: native logout failed'],
];

// Lines the pre-existing keyword set already carried; they must keep working.
const SOCKET_PATH = [
    ['WARN', '[app] _pingForOtherLocalSession mutex timeout after {}ms'],
    ['ERROR', '[open socket stream] failed to open stream'],
];

/** WALogger's real shape: a tagged-template array plus substitutions. */
const tagged = (text) => Object.assign([text], { raw: [text] });

function fakePage() {
    const emitted = [];
    const calls = [];
    const WALogger = {};
    ['ERROR', 'WARN', 'LOG'].forEach((lvl) => {
        WALogger[lvl] = function (...args) {
            calls.push([lvl, args]);
            return { catching: () => ({ sendLogs: () => {} }) };
        };
    });
    const modules = {
        WALogger,
        WAWebSocketModel: { Socket: { state: 'UNLAUNCHED' } },
    };
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: (info) => emitted.push(info),
    };
    return { emitted, calls, WALogger };
}

describe('WaLoggerHook', function () {
    afterEach(function () {
        delete global.window;
    });

    describe('shouldForwardWaLoggerLine', function () {
        it('forwards every line on the session-destroying storage path', function () {
            STORAGE_PATH.forEach(([lvl, msg]) => {
                expect(
                    shouldForwardWaLoggerLine(lvl, msg),
                    `${lvl}: ${msg}`,
                ).to.equal(true);
            });
        });

        it('still forwards what the pre-existing keyword set carried', function () {
            SOCKET_PATH.forEach(([lvl, msg]) => {
                expect(
                    shouldForwardWaLoggerLine(lvl, msg),
                    `${lvl}: ${msg}`,
                ).to.equal(true);
            });
        });

        it('carries every terminal line the post-sync hook used to', function () {
            TERMINAL_PATH.forEach(([lvl, msg]) => {
                expect(
                    shouldForwardWaLoggerLine(lvl, msg),
                    `${lvl}: ${msg}`,
                ).to.equal(true);
            });
        });

        it('drops an unrelated LOG line, because LOG is high volume', function () {
            expect(
                shouldForwardWaLoggerLine('LOG', '[app] window focused'),
            ).to.equal(false);
            expect(
                shouldForwardWaLoggerLine('LOG', 'chat list rendered'),
            ).to.equal(false);
        });

        it('drops an unrelated ERROR line', function () {
            expect(
                shouldForwardWaLoggerLine('ERROR', 'image decode failed'),
            ).to.equal(false);
        });

        it('matches LOG by exact prefix only, never by keyword', function () {
            // Contains "storage" but is not one of the four terminal lines.
            expect(
                shouldForwardWaLoggerLine('LOG', 'lru media storage swept'),
            ).to.equal(false);
        });
    });

    describe('InjectWaLoggerHook', function () {
        const install = () =>
            InjectWaLoggerHook(
                WAL_KEYWORDS.source,
                WAL_LOG_PREFIXES,
                WAL_TERMINAL.source,
            );

        it('forwards a matching line with its substitutions', function () {
            const page = fakePage();
            install();
            page.WALogger.LOG(
                tagged('[storage] set schema versions: {}. is worker? {}'),
                [['model-storage', 201]],
                false,
            );
            expect(page.emitted).to.have.length(1);
            expect(page.emitted[0].event).to.equal('WA_INTERNAL_LOG');
            expect(page.emitted[0].msg).to.contain('set schema versions');
            expect(page.emitted[0].args).to.contain('model-storage');
            expect(page.emitted[0].state).to.equal('UNLAUNCHED');
        });

        it('stays silent on a line nothing asked for', function () {
            const page = fakePage();
            install();
            page.WALogger.LOG(tagged('[app] window focused'));
            expect(page.emitted).to.have.length(0);
        });

        it('always calls the original, forwarded or not', function () {
            const page = fakePage();
            install();
            page.WALogger.ERROR(
                tagged('Failed to initialize model storage: {}'),
            );
            page.WALogger.ERROR(tagged('image decode failed'));
            expect(page.calls).to.have.length(2);
            expect(page.emitted).to.have.length(1);
        });

        it('does not double-wrap when injected twice', function () {
            const page = fakePage();
            install();
            install();
            page.WALogger.LOG(
                tagged('storage initialization error, logging out'),
            );
            expect(page.emitted).to.have.length(1);
        });

        it('survives a page where WALogger is not loaded yet', function () {
            global.window = { require: () => undefined };
            expect(() => install()).to.not.throw();
        });

        it('never lets a broken bridge break WhatsApp', function () {
            const page = fakePage();
            install();
            global.window.onSocketDiagEvent = () => {
                throw new Error('bridge gone');
            };
            expect(() =>
                page.WALogger.LOG(
                    tagged('storage initialization error, logging out'),
                ),
            ).to.not.throw();
            expect(page.calls).to.have.length(1);
        });
    });
});
