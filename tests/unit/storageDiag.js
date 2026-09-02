const { expect } = require('chai');
const {
    InjectStorageDiag,
    STORAGE_INIT_ERROR,
    STORAGE_SCHEMA_SNAPSHOT,
} = require('../../src/util/Injected/StorageDiag');

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

function fakePage({ withModules = true } = {}) {
    const emitted = [];
    const triggered = [];
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
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: (info) => emitted.push(info),
        Debug: { VERSION: '2.3000.1046259792' },
    };
    global.indexedDB = {
        databases: async () => [
            { name: 'model-storage', version: 2020 },
            { name: 'signal-storage', version: 70 },
        ],
    };
    return { emitted, triggered, bus, modules };
}

const snapshotOf = (emitted) =>
    emitted.find((e) => e.event === STORAGE_SCHEMA_SNAPSHOT);

describe('InjectStorageDiag', function () {
    afterEach(function () {
        delete global.window;
        delete global.indexedDB;
    });

    it('captures the exception WhatsApp destroys the session over', async function () {
        const page = fakePage();
        await InjectStorageDiag();
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

    it('flattens the error to scalars, so no minified key reaches NeDB', async function () {
        const page = fakePage();
        await InjectStorageDiag();
        page.bus.BackendEventBus.triggerStorageInitializationError(
            minifiedWaError(),
        );
        const captured = page.emitted.find(
            (e) => e.event === STORAGE_INIT_ERROR,
        );
        Object.keys(captured).forEach((k) => {
            expect(k).to.not.contain('$');
            expect(k).to.not.contain('.');
            expect(['string', 'object']).to.contain(typeof captured[k]);
        });
        expect(JSON.stringify(captured)).to.not.contain('$MsgImpl');
    });

    it('still calls WhatsApp through, so the wrap changes no behaviour', async function () {
        const page = fakePage();
        await InjectStorageDiag();
        const err = minifiedWaError();
        page.bus.BackendEventBus.triggerStorageInitializationError(err);
        expect(page.triggered).to.deep.equal([err]);
    });

    it('reports the versions asked for next to the versions on disk', async function () {
        const page = fakePage();
        await InjectStorageDiag();
        const snap = snapshotOf(page.emitted);
        expect(snap).to.exist;
        expect(snap.waVersion).to.equal('2.3000.1046259792');
        expect(snap.knobs).to.deep.equal([
            ['model-storage', 201],
            ['signal-storage', 6],
        ]);
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
        await InjectStorageDiag();
        const snap = snapshotOf(page.emitted);
        expect(snap.knobsError).to.contain('Schema versions not initialized');
    });

    it('snapshots once per page', async function () {
        const page = fakePage();
        await InjectStorageDiag();
        await InjectStorageDiag();
        expect(
            page.emitted.filter((e) => e.event === STORAGE_SCHEMA_SNAPSHOT),
        ).to.have.length(1);
    });

    it('does not double-wrap the trigger', async function () {
        const page = fakePage();
        await InjectStorageDiag();
        await InjectStorageDiag();
        page.bus.BackendEventBus.triggerStorageInitializationError(
            minifiedWaError(),
        );
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
        await InjectStorageDiag();
        const snap = snapshotOf(page.emitted);
        expect(snap).to.exist;
        expect(snap.knobs).to.equal(null);
        expect(snap.localMax).to.deep.equal({});
        expect(snap.dbs).to.have.length(2);
    });
});
