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
 * Alongside it, a one-shot snapshot of the schema state: the versions the
 * running build asks for, and the database versions actually on disk. WhatsApp
 * purges any database whose stored version its schema table does not cover
 * (`doesLocalSchemaIncludeVersion` is `existing <= versions.getMax()`), and the
 * two are normally equal - there is no margin - so the snapshot is what turns a
 * purge from an unexplained event into a diff.
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

    try {
        const dbg = window.Debug;
        snapshot.waVersion = dbg && dbg.VERSION ? String(dbg.VERSION) : null;
    } catch (e) {
        // best-effort diagnostic: never let it break the caller
    }

    // Server-driven, one entry per database. getSchemaVersions() throws when
    // the rollout has not populated them, and that throw is itself the answer.
    try {
        const sv = window.require('WAWebSchemaVersions');
        snapshot.knobs = sv
            ? Array.from(sv.getSchemaVersions().entries())
            : null;
    } catch (e) {
        snapshot.knobsError = String(e && e.message).slice(0, 200);
    }

    // The ceiling each storage's own schema table declares. Equal to the knob
    // in a healthy state; a build whose ceiling is lower than the version on
    // disk is the condition that purges.
    snapshot.localMax = {};
    utilsModules.forEach((name) => {
        try {
            const utils = window.require(name);
            if (!utils) return;
            const storage = utils.getStorage();
            snapshot.localMax[utils.DATABASE_NAME] = storage.versions.getMax();
        } catch (e) {
            // best-effort diagnostic: never let it break the caller
        }
    });

    // Reported from the callback rather than awaited, so a storage layer that
    // never answers costs this one field and nothing else.
    let sent = false;
    const send = () => {
        if (sent) return;
        sent = true;
        emit(snapshot);
    };
    try {
        indexedDB.databases().then(function (dbs) {
            snapshot.dbs = dbs.map((d) => ({
                name: d.name,
                version: d.version,
            }));
            send();
        }, send);
    } catch (e) {
        send();
    }
    setTimeout(send, dbTimeoutMs);
};

module.exports = {
    InjectStorageDiag,
    STORAGE_INIT_ERROR,
    STORAGE_SCHEMA_SNAPSHOT,
    SNAPSHOT_DB_TIMEOUT_MS,
    STORAGE_UTILS_MODULES,
};
