'use strict';

/**
 * Every WhatsApp Web internal reached through `window.WaGateway`, declared
 * once. This list is the whole answer to "what does this library depend on
 * inside WhatsApp": the gateway checks it against each build a page loads, and
 * a static test fails when code asks the gateway for a module it lacks.
 *
 * One entry per module:
 * - `exports`: each export the code uses, with `kind` ('function' or
 *   'value'), `arity` only where the code reads arguments by position, and
 *   `members` the code reads off it (looked up on the value, then on a class's
 *   prototype).
 * - `optional`: the module may be absent and the code copes.
 * - `lazy`: WhatsApp loads it on demand, so it is checked on first use instead
 *   of on page load.
 * - `why`: who depends on it.
 *
 * Checked against build 2.3000.1049833609 (2026-10-09/10): every export and
 * member present, `handleKeyIndexResultSync.length === 9`.
 */
const BINDINGS = [
    {
        module: 'WAWebApiDeviceList',
        why: 'device-list table: HostedDeviceFlag wraps its two writers; AdvDiag and the repair read it',
        exports: {
            createOrReplaceDeviceRecord: { kind: 'function' },
            bulkCreateOrReplaceDeviceRecord: { kind: 'function' },
            getAllDeviceLists: { kind: 'function' },
            bulkGetDeviceRecord: { kind: 'function' },
        },
    },
    {
        module: 'WAWebHandleAdvKeyIndexResultApi',
        why: 'throws invariant #76137 on an unflagged device 99; AdvDiag reads its arguments by position',
        exports: { handleKeyIndexResultSync: { kind: 'function', arity: 9 } },
    },
    {
        module: 'WAWebApiPendingDeviceSync',
        why: 'AdvDiag wraps the pending device-sync drain',
        exports: { doPendingDeviceSync: { kind: 'function' } },
    },
    {
        module: 'WAWebSchemaPendingDeviceSync',
        why: 'AdvDiag counts the pending device-sync queue',
        exports: { getTable: { kind: 'function' } },
    },
    {
        module: 'WAWebAdvDeviceInfoCheckJob',
        why: 'the daily device check that logs out on an expired own list; AdvDiag wraps it',
        exports: {
            AdvToSystemBridgeImpl: {
                kind: 'function',
                members: [
                    'getUsersForExpiration',
                    'getNumDaysKeyIndexListExpiration',
                ],
            },
        },
    },
    {
        module: 'WAWebUserPrefsMeUser',
        why: "the account's own phone and LID identities",
        exports: {
            getMeUserOrThrow: { kind: 'function' },
            getMaybeMeLidUser: { kind: 'function' },
        },
    },
    {
        module: 'WAWebWidFactory',
        why: 'AdvDiag names the user a device-list write is for',
        exports: { createUserWidFromDeviceListPk: { kind: 'function' } },
    },
    {
        module: 'WAWebABProps',
        why: 'AdvDiag reads whether an expired own list logs this account out',
        exports: { getABPropConfigValue: { kind: 'function' } },
    },
    {
        module: 'WALogger',
        why: "WaLoggerHook wraps WhatsApp's logger",
        exports: {
            ERROR: { kind: 'function' },
            WARN: { kind: 'function' },
            LOG: { kind: 'function' },
            EXPECTED_ERROR: { kind: 'function' },
        },
    },
    {
        module: 'WAWebSocketModel',
        why: 'WaLoggerHook stamps each line with the socket state',
        exports: { Socket: { kind: 'value', members: ['state'] } },
    },
    {
        module: 'WAWebDBMessageFindLocal',
        why: 'MediaRefs lists the media in each chat from the local index',
        exports: { msgFindMedia: { kind: 'function' } },
    },
    {
        // Only read when msgFindMedia has left WAWebDBMessageFindLocal, to find
        // it again by export name; the caller copes without it.
        module: '__debug',
        optional: true,
        why: 'MediaRefs finds msgFindMedia by name if its module moves',
        exports: { modulesMap: { kind: 'value' } },
    },
    {
        module: 'WAWebCollections',
        why: 'MediaRefs walks the chat list; getLoadedMsg reads a loaded message',
        exports: {
            Chat: { kind: 'value', members: ['getModelsArray'] },
            Msg: { kind: 'value', members: ['get'] },
        },
    },
];

module.exports = { BINDINGS };
