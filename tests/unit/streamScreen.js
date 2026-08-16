const { expect } = require('chai');
const {
    ExposeStreamScreenWatcher,
} = require('../../src/util/Injected/StreamScreen');

// The watcher runs inside the WhatsApp page, so the test builds the page: a
// `window` with `require`, WhatsApp's two models as tiny event emitters, and
// the exposed bridge function recording what would reach Node.
const makeModel = (fields) => {
    const listeners = new Map();
    return Object.assign(
        {
            on(events, fn) {
                for (const ev of events.split(' ')) {
                    listeners.set(ev, (listeners.get(ev) || []).concat(fn));
                }
            },
            off(events, fn) {
                for (const ev of events.split(' ')) {
                    listeners.set(
                        ev,
                        (listeners.get(ev) || []).filter((f) => f !== fn),
                    );
                }
            },
            /** Test-only: change a field and fire its event, like Backbone. */
            set(field, value) {
                this[field] = value;
                for (const fn of listeners.get('change:' + field) || []) fn();
            },
            countFor(ev, fn) {
                return (listeners.get(ev) || []).filter((f) => f === fn).length;
            },
        },
        fields,
    );
};

const SOCKET_STATE = {
    UNPAIRED: 'UNPAIRED',
    OPENING: 'OPENING',
    PAIRING: 'PAIRING',
    CONNECTED: 'CONNECTED',
};
const StreamMode = {
    QR: 'QR',
    MAIN: 'MAIN',
    SYNCING: 'SYNCING',
    OFFLINE: 'OFFLINE',
};
const StreamInfo = {
    NORMAL: 'NORMAL',
    CONNECTING: 'CONNECTING',
    SYNCING: 'SYNCING',
    OFFLINE: 'OFFLINE',
};

const setupPage = ({ storeInjected = false, missingModules = false } = {}) => {
    const emitted = [];
    const Stream = makeModel({
        mode: StreamMode.SYNCING, // the model's own constructor default
        displayInfo: StreamInfo.CONNECTING,
    });
    const Socket = makeModel({ state: SOCKET_STATE.UNPAIRED });
    const modules = {
        WAWebStreamModel: { Stream, StreamMode, StreamInfo },
        WAWebSocketModel: { Socket },
        WAWebSocketConstants: { SOCKET_STATE },
    };
    global.window = {
        require(name) {
            if (missingModules) throw new Error('module not loaded yet');
            if (!modules[name]) throw new Error('unknown module ' + name);
            return modules[name];
        },
        onConnectionStateEvent: (screen, percent) =>
            emitted.push({ screen, percent }),
        WWebJS: storeInjected ? {} : undefined,
        AuthStore: {
            OfflineMessageHandler: { getOfflineDeliveryProgress: () => 42 },
        },
    };
    return { emitted, Stream, Socket };
};

describe('ExposeStreamScreenWatcher', function () {
    afterEach(function () {
        delete global.window;
    });

    it('says nothing while a QR waits, however the socket cycles', function () {
        const { emitted, Stream, Socket } = setupPage();
        ExposeStreamScreenWatcher();
        Stream.set('mode', StreamMode.QR);
        Socket.set('state', SOCKET_STATE.OPENING);
        Socket.set('state', SOCKET_STATE.PAIRING);
        Socket.set('state', SOCKET_STATE.UNPAIRED);
        Stream.set('displayInfo', StreamInfo.CONNECTING);
        expect(emitted).to.deep.equal([]);
    });

    it('reports the sync once the socket proves the phone paired', function () {
        const { emitted, Stream, Socket } = setupPage();
        ExposeStreamScreenWatcher();
        Stream.set('mode', StreamMode.QR);
        // The scan: the stream turns SYNCING first, the socket settles after.
        Stream.set('mode', StreamMode.SYNCING);
        expect(emitted, 'nothing until the socket settles').to.deep.equal([]);
        Socket.set('state', SOCKET_STATE.CONNECTED);
        expect(emitted).to.deep.equal([{ screen: 'LOADING', percent: 42 }]);
    });

    it('holds CONNECTED back until the Store exists, then reports it', function () {
        const { emitted, Stream, Socket } = setupPage();
        ExposeStreamScreenWatcher();
        Socket.set('state', SOCKET_STATE.CONNECTED);
        Stream.set('mode', StreamMode.MAIN);
        Stream.set('displayInfo', StreamInfo.NORMAL);
        expect(
            emitted.filter((e) => e.screen === 'CONNECTED'),
            'ready must not be surfaced before the Store',
        ).to.deep.equal([]);

        global.window.WWebJS = {};
        global.window.__wwjsMarkStoreReady();
        expect(emitted[emitted.length - 1].screen).to.equal('CONNECTED');
    });

    it('reports every screen once the Store is there', function () {
        const { emitted, Stream } = setupPage({ storeInjected: true });
        ExposeStreamScreenWatcher();
        Stream.set('mode', StreamMode.MAIN);
        Stream.set('displayInfo', StreamInfo.SYNCING);
        Stream.set('displayInfo', StreamInfo.NORMAL);
        Stream.set('mode', StreamMode.OFFLINE);
        expect(emitted.map((e) => e.screen)).to.deep.equal([
            'LOADING',
            'CONNECTED',
            'DISCONNECTED',
        ]);
    });

    it('does not report the same screen twice in a row', function () {
        const { emitted, Stream } = setupPage({ storeInjected: true });
        // Install reports the current screen once (the model starts SYNCING),
        // then only real changes follow: the second OFFLINE field resolves to
        // the same DISCONNECTED screen and adds nothing.
        ExposeStreamScreenWatcher();
        Stream.set('mode', StreamMode.OFFLINE);
        Stream.set('displayInfo', StreamInfo.OFFLINE);
        expect(emitted.map((e) => e.screen)).to.deep.equal([
            'LOADING',
            'DISCONNECTED',
        ]);
    });

    it('replaces its listeners on re-inject instead of stacking them', function () {
        const { emitted, Stream, Socket } = setupPage({ storeInjected: true });
        ExposeStreamScreenWatcher();
        ExposeStreamScreenWatcher();
        ExposeStreamScreenWatcher();
        const notify = global.window.__wwjsStreamWatcher;
        expect(Stream.countFor('change:mode', notify)).to.equal(1);
        expect(Stream.countFor('change:displayInfo', notify)).to.equal(1);
        expect(Socket.countFor('change:state', notify)).to.equal(1);

        emitted.length = 0;
        Stream.set('mode', StreamMode.OFFLINE);
        expect(emitted).to.have.lengthOf(1);
    });

    it('still lets ready through when the modules were not up yet', function () {
        const { emitted } = setupPage({ missingModules: true });
        ExposeStreamScreenWatcher();
        // Nothing could be installed, but ready is emitted through this hook,
        // so it has to exist or a healthy client never reaches Connected.
        expect(global.window.__wwjsMarkStoreReady).to.be.a('function');
        expect(global.window.__wwjsStreamWatcher).to.equal(undefined);

        global.window.requireWorks = true;
        expect(emitted).to.deep.equal([]);
    });

    it('recovers on the retry once the modules are there', function () {
        const failed = setupPage({ missingModules: true });
        ExposeStreamScreenWatcher();
        expect(global.window.__wwjsStreamWatcher).to.equal(undefined);
        expect(failed.emitted).to.deep.equal([]);

        // The page finishes loading its modules and inject runs again.
        const working = setupPage({ storeInjected: true });
        ExposeStreamScreenWatcher();
        working.Stream.set('mode', StreamMode.OFFLINE);
        expect(working.emitted.map((e) => e.screen)).to.deep.equal([
            'LOADING',
            'DISCONNECTED',
        ]);
    });
});
