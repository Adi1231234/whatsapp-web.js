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

/**
 * Measured on a real client: at inject `getSchemaVersions()` throws and
 * `getStorage()` is not ready; WhatsApp populates them 1.77s later and
 * resolves `waitUntilSchemaVersionsReady`. A double that is ready immediately
 * hides the bug this shape exists to catch.
 */
function lateSchema() {
    let ready = false;
    let resolveReady;
    const promise = new Promise((r) => {
        resolveReady = r;
    });
    return {
        module: {
            getSchemaVersions: () => {
                if (!ready) throw new Error('Schema versions not initialized');
                return new Map([
                    ['model-storage', 201],
                    ['signal-storage', 6],
                ]);
            },
            waitUntilSchemaVersionsReady: () => promise,
        },
        arrive: () => {
            ready = true;
            resolveReady();
        },
        isReady: () => ready,
    };
}

function fakePage({ withModules = true, databases, schema } = {}) {
    const emitted = [];
    const triggered = [];
    const timeouts = [];
    const late = schema || lateSchema();
    const schemaVersions = late.module;
    const bus = {
        BackendEventBus: {
            triggerStorageInitializationError(err) {
                triggered.push(err);
            },
        },
    };
    const storage = (name, max) => ({
        DATABASE_NAME: name,
        getStorage: () => {
            if (!late.isReady()) throw new Error('not initialized');
            return { versions: { getMax: () => max } };
        },
    });
    const modules = withModules
        ? {
              WAWebBackendEventBus: bus,
              WAWebSchemaVersions: schemaVersions,
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
    return { emitted, triggered, timeouts, bus, modules, late };
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
        page.late.arrive();
        await settle();
        const events = page.emitted.map((e) => e.event);
        expect(events).to.contain(STORAGE_INIT_ERROR);
        expect(events).to.contain(STORAGE_SCHEMA_SNAPSHOT);
        events.forEach((e) => expect(e).to.be.a('string'));
    });

    it('waits for the schema before reporting, or localMax is always empty', async function () {
        // THE regression this timing exists for. On a real client the snapshot
        // used to be collected at inject, where getSchemaVersions() throws and
        // getStorage() is not ready - so it reported `localMax: {}` every time
        // and findSchemaDrift could never fire. A detector whose silence reads
        // as a clean bill of health is worse than no detector.
        const page = fakePage();
        inject();
        await settle();
        expect(
            snapshotOf(page.emitted),
            'must not report before WhatsApp has populated the schema',
        ).to.equal(undefined);

        page.late.arrive();
        await settle();
        const snap = snapshotOf(page.emitted);
        expect(snap).to.exist;
        expect(snap.localMax).to.deep.equal({
            'model-storage': 201,
            'signal-storage': 6,
        });
        expect(snap.knobsError).to.equal(undefined);
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

    it('still reports when the database read never answers', async function () {
        const page = fakePage({ databases: () => new Promise(() => {}) });
        inject();
        page.late.arrive();
        await settle();
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

    // The two halves fail in OPPOSITE situations, so a rejection in one must
    // not foreclose the other: sending on it also sets `sent`, and the half
    // that would have arrived seconds later is then unreportable forever.
    it('still reports the schema when the disk read is refused', async function () {
        const page = fakePage({
            databases: () => Promise.reject(new Error('storage wedged')),
        });
        inject();
        await settle();
        // Refused is not a reason to report before the schema lands.
        expect(snapshotOf(page.emitted)).to.equal(undefined);
        page.late.arrive();
        await settle();
        const snap = snapshotOf(page.emitted);
        expect(snap).to.exist;
        expect(snap.dbsError).to.contain('storage wedged');
        expect(snap.knobs).to.deep.equal([
            ['model-storage', 201],
            ['signal-storage', 6],
        ]);
    });

    it('still reports the disk when the schema never lands', async function () {
        // The on-disk versions are the only evidence a purge ever happened,
        // and the purge is what erases them.
        const schema = lateSchema();
        let reject;
        schema.module.waitUntilSchemaVersionsReady = () =>
            new Promise((_, r) => {
                reject = r;
            });
        const page = fakePage({ schema });
        inject();
        await settle();
        reject(new Error('rollout never arrived'));
        await settle();
        const snap = snapshotOf(page.emitted);
        expect(snap).to.exist;
        expect(snap.schemaWaitError).to.contain('rollout never arrived');
        expect(snap.dbs).to.deep.equal([
            { name: 'model-storage', version: 2020 },
            { name: 'signal-storage', version: 70 },
        ]);
    });

    it('reports once, whichever of the two paths gets there first', async function () {
        const page = fakePage();
        inject();
        page.late.arrive();
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

    it('says the cause was missing rather than emitting the string undefined', function () {
        // WhatsApp has two callers for this trigger and the bridge forwarder
        // passes no argument at all, so this is an expected path, not a bug.
        const page = fakePage();
        inject();
        page.bus.BackendEventBus.triggerStorageInitializationError();
        const captured = page.emitted.find(
            (e) => e.event === STORAGE_INIT_ERROR,
        );
        expect(captured).to.exist;
        expect(captured.causeReported).to.equal(false);
        expect(captured.errMessage).to.equal(null);
        expect(JSON.stringify(captured)).to.not.contain('undefined');
    });

    it('marks a reported cause as reported', function () {
        const page = fakePage();
        inject();
        page.bus.BackendEventBus.triggerStorageInitializationError(
            minifiedWaError(),
        );
        expect(
            page.emitted.find((e) => e.event === STORAGE_INIT_ERROR)
                .causeReported,
        ).to.equal(true);
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
        page.late.arrive();
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
        // The rollout never lands. The timeout is the backstop and the throw is
        // reported, rather than the snapshot being lost entirely.
        const page = fakePage();
        inject();
        await settle();
        expect(snapshotOf(page.emitted)).to.equal(undefined);
        page.timeouts[0].fn();
        expect(snapshotOf(page.emitted).knobsError).to.contain(
            'Schema versions not initialized',
        );
    });

    it('snapshots once per page and does not double-wrap the trigger', async function () {
        const page = fakePage();
        inject();
        inject();
        page.late.arrive();
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
