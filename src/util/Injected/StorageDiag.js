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
 */

const STORAGE_INIT_ERROR = 'STORAGE_INIT_ERROR';
const STORAGE_SCHEMA_SNAPSHOT = 'STORAGE_SCHEMA_SNAPSHOT';

const InjectStorageDiag = async () => {
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
                        emit({
                            event: STORAGE_INIT_ERROR,
                            errName: err && err.name ? String(err.name) : null,
                            errMessage:
                                err && err.message
                                    ? String(err.message).slice(0, 300)
                                    : String(err).slice(0, 300),
                            errStack:
                                err && err.stack
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

    const snapshot = { event: STORAGE_SCHEMA_SNAPSHOT };

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
    ['WAWebModelStorageUtils', 'WAWebSignalStorageUtils'].forEach((name) => {
        try {
            const utils = window.require(name);
            if (!utils) return;
            const storage = utils.getStorage();
            snapshot.localMax[utils.DATABASE_NAME] = storage.versions.getMax();
        } catch (e) {
            // best-effort diagnostic: never let it break the caller
        }
    });

    try {
        const dbs = await indexedDB.databases();
        snapshot.dbs = dbs.map((d) => ({ name: d.name, version: d.version }));
    } catch (e) {
        // best-effort diagnostic: never let it break the caller
    }

    emit(snapshot);
};

module.exports = {
    InjectStorageDiag,
    STORAGE_INIT_ERROR,
    STORAGE_SCHEMA_SNAPSHOT,
};
