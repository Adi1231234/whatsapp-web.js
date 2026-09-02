const { expect } = require('chai');
const {
    InjectStorageDiag,
    STORAGE_INIT_ERROR,
    STORAGE_SCHEMA_SNAPSHOT,
    SNAPSHOT_DB_TIMEOUT_MS,
    STORAGE_UTILS_MODULES,
} = require('../../src/util/Injected/StorageDiag');
const { evaluateInPage } = require('./evaluateBoundary');

/**
 * The real shape: a minified WhatsApp error really does carry property names
 * like `$1`, which NeDB rejects outright - so the double carries them too. A
 * double with a clean error object would hide the very thing the flattening
 * exists to prevent.
 */
function minifiedWaError() {
    const err = new Error('VersionError: requested 2010 < existing 2020');
    err.name = 'DexieError';
    err.$1 = { 'msg.id': 'leaks into NeDB if spread' };
    err.$MsgImpl$p_1 = 'same';
    return err;
}

const realSetTimeout = global.setTimeout;

function fakePage({ withModules = true, databases } = {}) {
    const emitted = [];
    const triggered = [];
    const timeouts = [];
    const bus = {
        BackendEventBus: {
            triggerStorageInitializationError(err) {
                triggered.push(err);
            },
        },
    };
    const storage = (name, max) => ({
        DATABASE_NAME: name,
        getStorage: () => ({ versions: { getMax: () => max } }),
    });
    const modules = withModules
        ? {
              WAWebBackendEventBus: bus,
              WAWebSchemaVersions: {
                  getSchemaVersions: () =>
                      new Map([
                          ['model-storage', 201],
                          ['signal-storage', 6],
                      ]),
              },
              WAWebModelStorageUtils: storage('model-storage', 201),
              WAWebSignalStorageUtils: storage('signal-storage', 6),
          }
        : {};
    global.setTimeout = (fn, ms) => {
        timeouts.push({ fn, ms });
        return timeouts.length;
    };
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: (info) => emitted.push(info),
        Debug: { VERSION: '2.3000.1046259792' },
    };
    global.indexedDB = {
        databases:
            databases ||
            (async () => [
                { name: 'model-storage', version: 2020 },
                { name: 'signal-storage', version: 70 },
            ]),
    };
    return { emitted, triggered, timeouts, bus, modules };
}

/** Through the same boundary puppeteer puts it through. */
const inject = () =>
    evaluateInPage(
        InjectStorageDiag,
        STORAGE_INIT_ERROR,
        STORAGE_SCHEMA_SNAPSHOT,
        STORAGE_UTILS_MODULES,
        SNAPSHOT_DB_TIMEOUT_MS,
    );

const settle = () => new Promise((r) => realSetTimeout(r, 0));
const snapshotOf = (emitted) =>
    emitted.find((e) => e.event === STORAGE_SCHEMA_SNAPSHOT);

describe('InjectStorageDiag', function () {
    afterEach(function () {
        delete global.window;
        delete global.indexedDB;
        global.setTimeout = realSetTimeout;
    });

    it('names its events across the evaluate boundary', async function () {
        // The regression this file exists for: the event names used to be read
        // from module scope, so in the page they were `undefined` and nothing
        // downstream could route them.
        const page = fakePage();
        inject();
        page.bus.BackendEventBus.triggerStorageInitializationError(
            minifiedWaError(),
        );
        await settle();
        const events = page.emitted.map((e) => e.event);
        expect(events).to.contain(STORAGE_INIT_ERROR);
        expect(events).to.contain(STORAGE_SCHEMA_SNAPSHOT);
        events.forEach((e) => expect(e).to.be.a('string'));
    });

    it('returns synchronously, so a wedged storage layer cannot hang inject', function () {
        // evaluate() awaits whatever the injected function returns, and
        // indexedDB.databases() talks to the layer this reports on. A promise
        // here would hang inject() in exactly the failure it exists for.
        const page = fakePage({ databases: () => new Promise(() => {}) });
        const result = inject();
        expect(result).to.equal(undefined);
        expect(page.timeouts[0].ms).to.equal(SNAPSHOT_DB_TIMEOUT_MS);
    });

    it('still reports when the database read never answers', function () {
        const page = fakePage({ databases: () => new Promise(() => {}) });
        inject();
        expect(snapshotOf(page.emitted)).to.equal(undefined);
        page.timeouts[0].fn(); // the timeout fires
        const snap = snapshotOf(page.emitted);
        expect(snap).to.exist;
        expect(snap.knobs).to.deep.equal([
            ['model-storage', 201],
            ['signal-storage', 6],
        ]);
        expect(snap.dbs).to.equal(undefined);
    });

    it('reports once, whichever of the two paths gets there first', async function () {
        const page = fakePage();
        inject();
        await settle();
        page.timeouts[0].fn();
        expect(
            page.emitted.filter((e) => e.event === STORAGE_SCHEMA_SNAPSHOT),
        ).to.have.length(1);
    });

    it('captures the exception WhatsApp destroys the session over', function () {
        const page = fakePage();
        inject();
        page.bus.BackendEventBus.triggerStorageInitializationError(
            minifiedWaError(),
        );
        const captured = page.emitted.find(
            (e) => e.event === STORAGE_INIT_ERROR,
        );
        expect(captured).to.exist;
        expect(captured.errName).to.equal('DexieError');
        expect(captured.errMessage).to.contain('2010');
    });

    it('flattens the error to scalars, so no minified key reaches NeDB', function () {
        const page = fakePage();
        inject();
        page.bus.BackendEventBus.triggerStorageInitializationError(
            minifiedWaError(),
        );
        const captured = page.emitted.find(
            (e) => e.event === STORAGE_INIT_ERROR,
        );
        Object.keys(captured).forEach((k) => {
            expect(k).to.not.contain('$');
            expect(k).to.not.contain('.');
        });
        expect(JSON.stringify(captured)).to.not.contain('$MsgImpl');
    });

    it('still calls WhatsApp through, so the wrap changes no behaviour', function () {
        const page = fakePage();
        inject();
        const err = minifiedWaError();
        page.bus.BackendEventBus.triggerStorageInitializationError(err);
        expect(page.triggered).to.deep.equal([err]);
    });

    it('reports the versions asked for next to the versions on disk', async function () {
        const page = fakePage();
        inject();
        await settle();
        const snap = snapshotOf(page.emitted);
        expect(snap.waVersion).to.equal('2.3000.1046259792');
        expect(snap.localMax).to.deep.equal({
            'model-storage': 201,
            'signal-storage': 6,
        });
        expect(snap.dbs).to.deep.equal([
            { name: 'model-storage', version: 2020 },
            { name: 'signal-storage', version: 70 },
        ]);
    });

    it('records the throw when the schema rollout never populated', async function () {
        const page = fakePage();
        page.modules.WAWebSchemaVersions.getSchemaVersions = () => {
            throw new Error('Schema versions not initialized');
        };
        inject();
        await settle();
        expect(snapshotOf(page.emitted).knobsError).to.contain(
            'Schema versions not initialized',
        );
    });

    it('snapshots once per page and does not double-wrap the trigger', async function () {
        const page = fakePage();
        inject();
        inject();
        await settle();
        page.bus.BackendEventBus.triggerStorageInitializationError(
            minifiedWaError(),
        );
        expect(
            page.emitted.filter((e) => e.event === STORAGE_SCHEMA_SNAPSHOT),
        ).to.have.length(1);
        expect(
            page.emitted.filter((e) => e.event === STORAGE_INIT_ERROR),
        ).to.have.length(1);
    });

    it('still reports the disk when WhatsApp has not loaded its modules', async function () {
        // window.require of an unknown WA module returns undefined rather than
        // throwing, so every read is feature-detected. The snapshot must still
        // go out: what is on disk is exactly what matters when the build cannot
        // get far enough to say what it wanted.
        const page = fakePage({ withModules: false });
        inject();
        await settle();
        const snap = snapshotOf(page.emitted);
        expect(snap).to.exist;
        expect(snap.knobs).to.equal(null);
        expect(snap.localMax).to.deep.equal({});
        expect(snap.dbs).to.have.length(2);
    });
});
