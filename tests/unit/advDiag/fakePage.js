'use strict';

const { evaluateInPage } = require('../evaluateBoundary');
const {
    InstallAdvDiagShared,
} = require('../../../src/util/Injected/AdvDiag/shared');
const {
    InstallAdvFixedSet,
} = require('../../../src/util/Injected/AdvDiag/fixedSet');

const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);

/** A wid the way WhatsApp's own `toLogString` masks it. */
const wid = (user, server) => ({
    user: user,
    server: server || 'c.us',
    toLogString: () => user.slice(-4) + '@' + (server || 'c.us'),
    toString: () => user + '@' + (server || 'c.us'),
});

const ME = wid('972500001111');
const ME_LID = wid('81381124227201', 'lid');

/** The invariant WhatsApp throws, with the stack shape measured live. */
const invariant = () => {
    const err = new Error('Minified invariant #76137; %s');
    err.name = 'Invariant Violation';
    err.stack =
        'Invariant Violation: Minified invariant #76137; %s\n' +
        '    at s (https://static.whatsapp.net/rsrc.php/v4/yp/r/NooljZMhLNn.js:80:367)\n' +
        '    at Object.d [as handleKeyIndexResultSync] (https://static.whatsapp.net/rsrc.php/v4/yn/r/F64V0lgHire.js:328:1405)';
    return err;
};

/**
 * The modules the hooks wrap, shaped like the live build: exports objects
 * called by property, so a wrapper placed on them is what WhatsApp calls.
 */
/** The one store that survives a page load, shared across fake pages. */
function fakeLocalStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
    };
}

function fakePage(localStorage) {
    const emitted = [];
    const state = {
        pending: [],
        failSync: false,
        writes: [],
        // Runs inside the drain, the way WhatsApp's batch reaches the check.
        duringSync: () => {},
        own: { timestamp: nowS() - 3 * DAY, devices: [{ id: 0 }] },
    };
    const has99Unflagged = (devices) =>
        (devices || []).some((d) => d.id === 99 && d.isHosted !== true);

    function Bridge() {}
    Bridge.prototype.getNumDaysKeyIndexListExpiration = () => 35;
    Bridge.prototype.getUsersForExpiration = async () => state.expiration;

    const modules = {
        WAWebUserPrefsMeUser: {
            getMeUserOrThrow: () => ME,
            getMaybeMeLidUser: () => ME_LID,
        },
        WAWebSchemaPendingDeviceSync: {
            getTable: () => ({ all: async () => state.pending.slice() }),
        },
        WAWebApiPendingDeviceSync: {
            doPendingDeviceSync: async () => {
                try {
                    state.duringSync();
                } catch (ignoredError) {
                    return; // swallowed, rows kept, like WhatsApp's own
                }
                if (!state.failSync) state.pending = [];
            },
        },
        WAWebWidFactory: {
            createUserWidFromDeviceListPk: (pk) => ({
                toString: () => String(pk),
            }),
        },
        WAWebHandleAdvKeyIndexResultApi: {
            handleKeyIndexResultSync: (w, devices, ts, bytes, x, local) => {
                const list = devices != null ? devices : local && local.devices;
                if (has99Unflagged(list)) throw invariant();
                return { update: {} };
            },
        },
        WAWebApiDeviceList: {
            createOrReplaceDeviceRecord: async (r) => state.writes.push(r),
            bulkCreateOrReplaceDeviceRecord: async (rs) =>
                rs.forEach((r) => state.writes.push(r)),
            bulkGetDeviceRecord: async () => [state.own, state.own],
        },
        WAWebAdvDeviceInfoCheckJob: { AdvToSystemBridgeImpl: Bridge },
        WAWebABProps: { getABPropConfigValue: () => true },
    };
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: (info) => emitted.push(info),
        localStorage: localStorage || fakeLocalStorage(),
    };
    evaluateInPage(InstallAdvDiagShared, 99, DAY);
    evaluateInPage(InstallAdvFixedSet, '__p2dAdvFixed', 500);
    return { emitted, state, modules, Bridge };
}

/** Lets the hooks' promise chains land. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

module.exports = {
    fakePage,
    fakeLocalStorage,
    settle,
    wid,
    ME,
    ME_LID,
    DAY,
    nowS,
    invariant,
};
