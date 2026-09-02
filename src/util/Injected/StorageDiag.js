'use strict';

/**
 * Makes WhatsApp's storage-initialisation failure observable.
 *
 * `BackendEventBus.triggerStorageInitializationError(e)` is the single gate in
 * front of `Socket.clearCredentialsAndStoredData(WebFailStorageInitialization)`,
 * which wipes the session's credentials and lands the page on
 * `?post_logout=1&logout_reason=0`. WhatsApp passes the underlying exception to
 * that trigger and then drops it; nothing downstream carries it, so the one
 * object that says WHY a session was destroyed is lost the moment it is thrown.
 * This captures it.
 *
 * That capture is the load-bearing part, and not for want of a log line.
 * WhatsApp DOES log the failure, and deliberately without its cause: the catch
 * in `WAWebModelStorageInitialize` collapses the exception to one of three
 * fixed strings, and since a Dexie `VersionError` is a `DexieError` the line it
 * writes is exactly `Failed to initialize model storage: Unknown DexieError`.
 * The version numbers survive only on the object it rethrows, which is the
 * object this wrapper reads.
 *
 * Alongside it, a one-shot snapshot of the schema state: the versions the
 * running build asks for, and the database versions actually on disk. Nothing
 * purges on a mismatch - `Storage.initialize()` replays `0..getMax()` and calls
 * Dexie's `indexedDB.open(name, verno * 10)`, and IndexedDB refuses to open a
 * database at a version below the one on disk. The two are normally equal, so
 * there is no margin, and the snapshot is what turns that refusal from an
 * unexplained event into a diff.
 *
 * Only scalars are emitted. WhatsApp Web is minified and its error objects
 * really do carry property names like `$1` and `getMessageModel(msg).id.$1`,
 * which NeDB rejects outright, so the error is flattened to three strings here
 * rather than passed through as an object.
 *
 * Every value the injected function needs is a PARAMETER. `pupPage.evaluate`
 * serialises the function alone, so a closure over a module constant arrives in
 * the page as `undefined` - and an event name that is `undefined` is an event
 * nobody can route.
 */

const STORAGE_INIT_ERROR = 'STORAGE_INIT_ERROR';
const STORAGE_SCHEMA_SNAPSHOT = 'STORAGE_SCHEMA_SNAPSHOT';

/** How long the snapshot waits for `indexedDB.databases()` before reporting. */
const SNAPSHOT_DB_TIMEOUT_MS = 10000;

/** The storage modules that expose a schema ceiling worth reading. */
const STORAGE_UTILS_MODULES = [
    'WAWebModelStorageUtils',
    'WAWebSignalStorageUtils',
];

/**
 * NOT async, and it never awaits. `pupPage.evaluate` awaits whatever the
 * injected function returns, and `indexedDB.databases()` talks to the very
 * storage layer this exists to report on - so awaiting it would hang inject()
 * exactly when storage is wedged, which is the one case that matters. The hook
 * is installed synchronously; the snapshot is best-effort and reports whenever
 * it can, or on the timeout, whichever comes first.
 */
const InjectStorageDiag = (
    initErrorEvent,
    snapshotEvent,
    utilsModules,
    dbTimeoutMs,
) => {
    const emit = (payload) => {
        try {
            window.onSocketDiagEvent(payload);
        } catch (e) {
            // best-effort diagnostic: never let it break the caller
        }
    };

    // 1. The exception WhatsApp is about to throw the session away over.
    try {
        const bus = window.require('WAWebBackendEventBus');
        const b = bus && bus.BackendEventBus;
        if (b && !b.__p2dStorageHooked) {
            b.__p2dStorageHooked = true;
            const orig = b.triggerStorageInitializationError;
            if (typeof orig === 'function') {
                b.triggerStorageInitializationError = function (err) {
                    try {
                        // WhatsApp has two callers. The launch chain passes the
                        // exception; the bridge forwarder passes NOTHING. A
                        // missing cause is therefore expected, and saying so
                        // beats emitting the string "undefined", which reads
                        // like a value somebody could go looking for.
                        const hasCause = err !== null && err !== undefined;
                        emit({
                            event: initErrorEvent,
                            causeReported: hasCause,
                            errName:
                                hasCause && err.name ? String(err.name) : null,
                            errMessage: hasCause
                                ? String(err.message || err).slice(0, 300)
                                : null,
                            errStack:
                                hasCause && err.stack
                                    ? String(err.stack).slice(0, 600)
                                    : null,
                        });
                    } catch (e) {
                        // best-effort diagnostic: never let it break the caller
                    }
                    return orig.apply(this, arguments);
                };
            }
        }
    } catch (e) {
        // best-effort diagnostic: never let it break the caller
    }

    // 2. What the build asks for, and what is on disk.
    if (window.__p2dStorageSnapDone) return;
    window.__p2dStorageSnapDone = true;

    const snapshot = { event: snapshotEvent };

    // Gathered at SEND time, never at inject time. Measured on a real client:
    // at inject `getSchemaVersions()` throws `Schema versions not initialized`
    // and `getStorage()` is not ready, so an inject-time read reports
    // `localMax: {}` - and a drift check against an empty ceiling can never
    // fire. WhatsApp populates them 1.77s later. Collecting late is the whole
    // difference between a working detector and one whose silence reads as a
    // clean bill of health.
    const collect = () => {
        try {
            const dbg = window.Debug;
            snapshot.waVersion =
                dbg && dbg.VERSION ? String(dbg.VERSION) : null;
        } catch (e) {
            // best-effort diagnostic: never let it break the caller
        }

        // Server-driven, one entry per database. getSchemaVersions() throws
        // while the rollout has not populated them, and that throw is itself
        // the answer once we have stopped asking too early.
        try {
            const sv = window.require('WAWebSchemaVersions');
            snapshot.knobs = sv
                ? Array.from(sv.getSchemaVersions().entries())
                : null;
            delete snapshot.knobsError;
        } catch (e) {
            snapshot.knobsError = String(e && e.message).slice(0, 200);
        }

        // The ceiling each storage's own schema table declares. Equal to the
        // knob in a healthy state; a build whose ceiling is lower than the
        // version on disk is the condition that purges.
        snapshot.localMax = {};
        utilsModules.forEach((name) => {
            try {
                const utils = window.require(name);
                if (!utils) return;
                const storage = utils.getStorage();
                snapshot.localMax[utils.DATABASE_NAME] =
                    storage.versions.getMax();
            } catch (e) {
                // best-effort diagnostic: never let it break the caller
            }
        });
    };

    // Reported from the callbacks rather than awaited, so neither a storage
    // layer that never answers nor a rollout that never lands can hang inject.
    let sent = false;
    const send = () => {
        if (sent) return;
        sent = true;
        collect();
        emit(snapshot);
    };

    // Both halves, or the timeout, whichever completes the picture first. The
    // disk read usually returns in milliseconds while the schema arrives
    // seconds later, so waiting on only one of them reports half a snapshot.
    let dbsReady = false;
    let schemaReady = false;
    const sendWhenBothReady = () => {
        if (dbsReady && schemaReady) send();
    };

    // A half that FAILS is finished, not a reason to report early. Sending on
    // the rejection would also set `sent`, so the other half could never join -
    // and the two halves fail in opposite situations. A wedged storage layer is
    // exactly when `databases()` rejects, and the schema ceiling is then the
    // only thing left worth having; a rollout that never lands is exactly when
    // the on-disk versions are the only evidence, and the purge erases them.
    const half = (mark) => (e) => {
        snapshot[mark] = String((e && e.message) || e).slice(0, 200);
        return e;
    };

    try {
        indexedDB.databases().then(function (dbs) {
            snapshot.dbs = dbs.map((d) => ({
                name: d.name,
                version: d.version,
            }));
            dbsReady = true;
            sendWhenBothReady();
        }, function (e) {
            half('dbsError')(e);
            dbsReady = true;
            sendWhenBothReady();
        });
    } catch (e) {
        half('dbsError')(e);
        dbsReady = true;
    }

    // WhatsApp's own primitive for "the schema table is populated", so this
    // waits on the event rather than sampling for it.
    try {
        const sv = window.require('WAWebSchemaVersions');
        if (sv && typeof sv.waitUntilSchemaVersionsReady === 'function') {
            sv.waitUntilSchemaVersionsReady().then(function () {
                schemaReady = true;
                sendWhenBothReady();
            }, function (e) {
                half('schemaWaitError')(e);
                schemaReady = true;
                sendWhenBothReady();
            });
        } else {
            schemaReady = true;
        }
    } catch (e) {
        schemaReady = true;
    }
    sendWhenBothReady();

    setTimeout(send, dbTimeoutMs);
};

module.exports = {
    InjectStorageDiag,
    STORAGE_INIT_ERROR,
    STORAGE_SCHEMA_SNAPSHOT,
    SNAPSHOT_DB_TIMEOUT_MS,
    STORAGE_UTILS_MODULES,
};
