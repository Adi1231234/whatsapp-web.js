'use strict';

const EventEmitter = require('events');
const Client = require('../../src/Client');
const {
    REQUIRED_TO_CONNECT,
    REQUIRED_ON_LOGGED_OUT_APP,
    REQUIRED_FOR_QR,
    EXPOSED_WHEN_PRESENT,
} = require('../../src/util/AppModules');
const { evaluateInPage } = require('./evaluateBoundary');

const APP = 'https://web.whatsapp.com/';
const LOGIN = 'https://web.whatsapp.com/login/';
const BUILD = '2.3000.9';

const SOCKET_STATE = {
    OPENING: 'OPENING',
    UNLAUNCHED: 'UNLAUNCHED',
    PAIRING: 'PAIRING',
    UNPAIRED: 'UNPAIRED',
    UNPAIRED_IDLE: 'UNPAIRED_IDLE',
    CONNECTED: 'CONNECTED',
};

/**
 * WhatsApp's event emitter as its models and event bus have it: handlers by
 * event name. `trigger` hands back what each handler returned, so a test can
 * await work a handler started.
 */
function emitter(fields = {}) {
    const handlers = new Map();
    const of = (event) => handlers.get(event) || [];
    return Object.assign(
        {
            on(event, handler) {
                handlers.set(event, [...of(event), handler]);
                return this;
            },
            off(event, handler) {
                handlers.set(
                    event,
                    of(event).filter((h) => h !== handler),
                );
                return this;
            },
            trigger(event, ...args) {
                return of(event).map((h) => h(...args));
            },
            listenerCount(event) {
                return of(event).length;
            },
        },
        fields,
    );
}

/** WAWebEventsWaitForBbEvent, as the build has it. */
function waitForBbEvent(target, event, predicate = () => true, signal) {
    if (signal?.aborted) return Promise.reject(new Error('AbortError'));
    return new Promise((resolve, reject) => {
        const onEvent = (...args) => {
            if (!predicate(...args)) return;
            done();
            resolve(args);
        };
        const onAbort = () => {
            done();
            reject(new Error('AbortError'));
        };
        const done = () => {
            target.off(event, onEvent);
            signal?.removeEventListener('abort', onAbort);
        };
        signal?.addEventListener('abort', onAbort);
        target.on(event, onEvent);
    });
}

/** The QR that the parts `withQrParts` puts in the page make. */
const qrOf = (ref) => `${ref},b64(NOISE),b64(IDENTITY),ADV,PLATFORM`;

/**
 * Every module inject reads, on either app, with what a QR is made of named
 * after where each part came from.
 */
function everyModule() {
    const names = [
        REQUIRED_TO_CONNECT,
        REQUIRED_ON_LOGGED_OUT_APP,
        REQUIRED_FOR_QR,
        EXPOSED_WHEN_PRESENT,
    ].flat();
    const modules = Object.fromEntries(names.map((name) => [name, {}]));
    modules.WAWebConnModel.Conn = emitter({ ref: 'REF' });
    modules.WAWebSignalStoreApi.waSignalStore = {
        getRegistrationInfo: async () => ({
            identityKeyPair: { pubKey: 'IDENTITY' },
        }),
    };
    modules.WAWebUserPrefsInfoStore.waNoiseInfo = {
        get: async () => ({ staticKeyPair: { pubKey: 'NOISE' } }),
    };
    modules.WABase64.encodeB64 = (key) => `b64(${key})`;
    modules.WAWebUserPrefsMultiDevice.getADVSecretKey = () => 'ADV';
    modules.WAWebCompanionRegClientUtils.DEVICE_PLATFORM = 'PLATFORM';
    modules.WAWebSocketConstants.SOCKET_STATE = SOCKET_STATE;
    modules.WAWebEventsWaitForBbEvent = waitForBbEvent;
    return modules;
}

/**
 * WhatsApp's event bus, as both apps have it: it holds the socket state and
 * announces each one as `set_socket_state`. Once something listens for that,
 * it moves through `script`, the way the socket would.
 */
function eventBus(state, script = []) {
    const refreshes = [];
    const bus = emitter({
        socketState: state,
        triggerSetSocketState(next) {
            this.socketState = next;
            return this.trigger('set_socket_state', next);
        },
        triggerRefreshQR: () => refreshes.push('triggerRefreshQR'),
    });
    const on = bus.on;
    let played = false;
    bus.on = function (event, handler) {
        on.call(this, event, handler);
        if (event === 'set_socket_state' && !played) {
            played = true;
            queueMicrotask(() =>
                script.forEach((next) => bus.triggerSetSocketState(next)),
            );
        }
        return this;
    };
    return { bus, refreshes };
}

/** The app: a socket model settled in `state`, its stream on a QR. */
function appIn(state) {
    const modules = everyModule();
    modules.WAWebAppBootstrap = {};
    modules.WAWebSocketModel.Socket = emitter({ state, hasSynced: false });
    modules.WAWebStreamModel.Stream = emitter({ mode: 'QR' });
    modules.WAWebStreamModel.StreamMode = { SYNCING: 'SYNCING' };
    modules.WAWebCmd.Cmd = emitter();
    modules.WAWebBackendEventBus.BackendEventBus = eventBus(state).bus;
    return modules;
}

/**
 * The logged-out app as measured: the socket and stream models listed but
 * never loaded, the app's bootstrap unknown, and the socket state on the
 * event bus, starting at `state` and moving through `script`.
 */
function loggedOutAppIn(state, script = []) {
    const modules = everyModule();
    const { bus, refreshes } = eventBus(state, script);
    modules.WAWebLoggedOutBootstrap = {};
    modules.WAWebBackendEventBus.BackendEventBus = bus;
    modules.WAWebSocketModel = null;
    modules.WAWebStreamModel = null;
    return { modules, bus, refreshes };
}

/**
 * Puts `modules` behind a fresh page at `url`, as a navigation would: a new
 * window with WhatsApp's two loader calls as measured. `require` answers null
 * for a module listed but not loaded and undefined for one never heard of,
 * and `requireLazy` calls back only once every named module is there. Every
 * module asked for is recorded in `asked`.
 */
function loadPage(modules, url = APP) {
    const asked = [];
    global.window = {
        Debug: { VERSION: BUILD },
        require: (name) => {
            asked.push(name);
            return modules[name];
        },
        requireLazy: (names, cb) => {
            if (names.every((n) => modules[n] != null)) cb();
        },
    };
    return { url, asked };
}

/**
 * A client whose page runs every injected function the way puppeteer does,
 * on whatever page `loadPage` put up last; `waitForFunction` asks once, which
 * is all a settled page needs. Every public event it emits is in `events`,
 * and every navigation it asks for in `gotos`.
 */
function clientOn(page, options = {}) {
    const events = [];
    const gotos = [];
    const client = Object.create(Client.prototype);
    EventEmitter.call(client);
    const emit = client.emit;
    client.emit = function (...args) {
        events.push(args);
        return emit.apply(this, args);
    };
    const evaluate = async (fn, ...args) =>
        typeof fn === 'string'
            ? new Function(`return (${fn})`)()
            : evaluateInPage(fn, ...args);
    Object.assign(client, {
        pupPage: {
            url: () => page.url,
            evaluate,
            waitForFunction: async (fn) => {
                const value = await evaluate(fn);
                return { jsonValue: async () => value };
            },
            exposeFunction: async (name, fn) => {
                global.window[name] = fn;
            },
            goto: async (url) => gotos.push(url),
        },
        options: {
            authTimeoutMs: 20,
            qrMaxRetries: 0,
            pairWithPhoneNumber: {},
            ...options,
        },
        authStrategy: {
            onAuthenticationNeeded: async () => ({}),
            destroy: async () => {},
        },
    });
    return {
        client,
        events,
        gotos,
        /** Moves the client's page on, as a navigation does. */
        navigate: (next) => (page = next),
    };
}

/** What `inject()` threw. */
async function injectError(client) {
    try {
        await client.inject();
    } catch (err) {
        return err;
    }
    throw new Error('inject() resolved');
}

/** Leaves no page behind, as an `afterEach`. */
function closePage() {
    delete global.window;
}

module.exports = {
    APP,
    LOGIN,
    BUILD,
    appIn,
    loggedOutAppIn,
    loadPage,
    clientOn,
    injectError,
    closePage,
    qrOf,
};
