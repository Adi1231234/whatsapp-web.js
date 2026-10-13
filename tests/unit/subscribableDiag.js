const { expect } = require('chai');
const EventEmitter = require('events');
const Client = require('../../src/Client');
const { subscribableDiagLevel } = require('../../src/util/SubscribableDiag');
const {
    STORAGE_INIT_ERROR,
    STORAGE_SCHEMA_SNAPSHOT,
} = require('../../src/util/Injected/StorageDiag');
const { WA_GATEWAY_CHECK } = require('../../src/util/Injected/WaGateway');

// Seen in the field 5.4s before WhatsApp logged an account out, exactly as the
// socket-diag binding delivers it.
const REFUSED_401 = {
    event: 'WA_INTERNAL_LOG',
    terminal: true,
    msg: 'received failure stanza, reason: {}, logging out',
    args: '[401]',
    state: 'CONNECTED',
};

const ROUTINE_WARN = {
    event: 'WA_INTERNAL_WARN',
    terminal: false,
    msg: '[app] _pingForOtherLocalSession mutex timeout after {}ms',
    args: '[5000]',
    state: 'CONNECTED',
};

/** Runs the real handler; returns its `diag` emissions and console lines. */
function route(info) {
    const client = new EventEmitter();
    const diag = [];
    client.on('diag', (...args) => diag.push(args));
    const lines = [];
    const realLog = console.log;
    console.log = (...args) => lines.push(args);
    try {
        Client.prototype._onSocketDiagEvent.call(client, info);
    } finally {
        console.log = realLog;
    }
    return { diag, lines };
}

describe('subscribable socket-diag events', function () {
    it('puts a terminal WhatsApp line on diag at info, as the same JSON', function () {
        const { diag } = route(REFUSED_401);
        expect(diag).to.deep.equal([
            ['info', 'WA_INTERNAL_LOG', JSON.stringify(REFUSED_401)],
        ]);
        expect(JSON.parse(diag[0][2])).to.deep.equal(REFUSED_401);
    });

    it('still writes the console line for it, once', function () {
        expect(route(REFUSED_401).lines).to.deep.equal([
            ['[wwjs-diag] SOCKET_DIAG', REFUSED_401],
        ]);
    });

    it('routes a terminal line whatever its WhatsApp level', function () {
        const info = Object.assign({}, REFUSED_401, {
            event: 'WA_INTERNAL_ERROR',
        });
        expect(route(info).diag).to.deep.equal([
            ['info', 'WA_INTERNAL_ERROR', JSON.stringify(info)],
        ]);
    });

    it('leaves a non-terminal WhatsApp line a console line', function () {
        const { diag, lines } = route(ROUTINE_WARN);
        expect(diag).to.have.length(0);
        expect(lines).to.have.length(1);
    });

    it('counts only a terminal flag that is exactly true', function () {
        ['true', 1, undefined].forEach((terminal) => {
            const info = Object.assign({}, REFUSED_401, { terminal });
            expect(subscribableDiagLevel(info), String(terminal)).to.equal(
                null,
            );
        });
    });

    it('keeps the existing events at their levels', function () {
        [
            [STORAGE_INIT_ERROR, 'error'],
            [STORAGE_SCHEMA_SNAPSHOT, 'info'],
            [WA_GATEWAY_CHECK, 'info'],
        ].forEach(([event, level]) => {
            const info = { event, problems: [] };
            expect(route(info).diag, event).to.deep.equal([
                [level, event, JSON.stringify(info)],
            ]);
        });
    });

    it('leaves an unrelated event a console line, terminal flag or not', function () {
        [
            { event: 'change:stream', stream: 'CONNECTED', state: 'CONNECTED' },
            { event: 'HOSTED_DEVICE_FLAG_REPAIR', terminal: true },
            { event: 'toString' },
        ].forEach((info) => {
            expect(route(info).diag, info.event).to.have.length(0);
        });
    });

    it('does not throw on a missing or malformed event', function () {
        expect(subscribableDiagLevel(null)).to.equal(null);
        expect(subscribableDiagLevel(undefined)).to.equal(null);
        expect(subscribableDiagLevel({})).to.equal(null);
        expect(subscribableDiagLevel({ event: 42, terminal: true })).to.equal(
            null,
        );
        expect(route(null).diag).to.have.length(0);
    });
});
