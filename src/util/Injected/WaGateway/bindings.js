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
 * member present, `handleKeyIndexResultSync.length === 9`. The socket,
 * stream, AuthStore and QR entries checked against build 2.3000.1054073855
 * (2026-11-11).
 */
const BINDINGS = [
    {
        module: 'WAWebApiDeviceList',
        why: 'device-list table: HostedDeviceFlag and AdvDiag wrap its two writers; AdvDiag and the repair read it',
        exports: {
            createOrReplaceDeviceRecord: { kind: 'function' },
            bulkCreateOrReplaceDeviceRecord: { kind: 'function' },
            getAllDeviceLists: { kind: 'function' },
            bulkGetDeviceRecord: { kind: 'function' },
        },
    },
    {
        module: 'WAWebHttpExtendedFetch',
        why: 'StreamedDownloadBytes wraps the fetch that streams media as text, and passes its arguments by position',
        exports: { extendedFetch: { kind: 'function', arity: 2 } },
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
        why: "the account's own phone and LID identities, and this device's id",
        exports: {
            getMaybeMePnUser: { kind: 'function' },
            getMaybeMeLidUser: { kind: 'function' },
            getMaybeMeDeviceLid: { kind: 'function' },
            getMaybeMeDevicePn: { kind: 'function' },
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
        why: 'inject waits on the socket state to tell a paired session from a QR; WaLoggerHook stamps each line with it',
        exports: {
            Socket: { kind: 'value', members: ['state', 'hasSynced', 'on'] },
        },
    },
    {
        module: 'WAWebSocketConstants',
        why: 'inject reads which socket states are still settling and which need a QR',
        exports: {
            SOCKET_STATE: {
                kind: 'value',
                members: [
                    'OPENING',
                    'UNLAUNCHED',
                    'PAIRING',
                    'UNPAIRED',
                    'UNPAIRED_IDLE',
                ],
            },
        },
    },
    {
        // The module is the function itself, so there is no export to name.
        module: 'WAWebEventsWaitForBbEvent',
        why: "inject waits for the socket to settle with WhatsApp's own event helper",
        exports: {},
    },
    {
        module: 'WAWebCmd',
        why: 'AuthStore.Cmd; inject listens on it for a logout',
        exports: { Cmd: { kind: 'value', members: ['on'] } },
    },
    {
        module: 'WAWebStreamModel',
        why: 'the QR reports a scan from the stream mode turning to SYNCING',
        exports: {
            Stream: { kind: 'value', members: ['mode', 'on', 'off'] },
            StreamMode: { kind: 'value', members: ['SYNCING'] },
        },
    },
    {
        module: 'WAWebUserPrefsMultiDevice',
        why: "the QR's ADV secret key",
        exports: { getADVSecretKey: { kind: 'function' } },
    },
    {
        module: 'WAWebConnModel',
        why: 'the QR: AuthStore.Conn.ref, and its change:ref event',
        exports: { Conn: { kind: 'value', members: ['ref', 'on', 'off'] } },
    },
    {
        module: 'WAWebOfflineHandler',
        why: 'AuthStore.OfflineMessageHandler: the offline delivery progress',
        exports: {
            OfflineMessageHandler: {
                kind: 'value',
                members: ['getOfflineDeliveryProgress'],
            },
        },
    },
    {
        module: 'WAWebAltDeviceLinkingApi',
        why: 'AuthStore.PairingCodeLinkUtils: pairing with a phone number',
        exports: {
            setPairingType: { kind: 'function' },
            initializeAltDeviceLinking: { kind: 'function' },
            startAltLinkingFlow: { kind: 'function' },
        },
    },
    {
        module: 'WABase64',
        why: 'AuthStore.Base64Tools: the QR keys',
        exports: { encodeB64: { kind: 'function' } },
    },
    {
        module: 'WAWebCompanionRegClientUtils',
        why: 'AuthStore.RegistrationUtils: the QR names the platform',
        exports: { DEVICE_PLATFORM: { kind: 'value' } },
    },
    {
        // Spread into AuthStore.RegistrationUtils whole; nothing here reads
        // an export of it by name.
        module: 'WAWebAdvSignatureApi',
        why: 'AuthStore.RegistrationUtils',
        exports: {},
    },
    {
        module: 'WAWebUserPrefsInfoStore',
        why: "AuthStore.RegistrationUtils: the QR's noise key",
        exports: { waNoiseInfo: { kind: 'value', members: ['get'] } },
    },
    {
        module: 'WAWebSignalStoreApi',
        why: "AuthStore.RegistrationUtils: the QR's identity key",
        exports: {
            waSignalStore: {
                kind: 'value',
                members: ['getRegistrationInfo'],
            },
        },
    },
    {
        module: 'WAWebDBMessageFindLocal',
        why: 'MediaRefs lists the media in each chat from the local index',
        exports: { msgFindMedia: { kind: 'function' } },
    },
    {
        module: 'WAWebDBMsgUtils',
        why: 'messageExists asks the message table whether it holds an id',
        exports: { getMsgsExistByMsgKey: { kind: 'function' } },
    },
    {
        module: 'WAWebMsgKey',
        why: 'messageExists parses an id to find its PN/LID alternate',
        exports: { fromString: { kind: 'function' } },
    },
    {
        module: 'WAWebLidMigrationUtils',
        why: 'messageExists also asks under the PN/LID alternate of an id',
        exports: { getAlternateMsgKey: { kind: 'function' } },
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
    {
        module: 'WAWebDualUploadsAssociationTypes',
        why: "HdCopies: WhatsApp's own test for a message's hidden HD copy",
        exports: { isDualUploadAssociationType: { kind: 'function' } },
    },
    {
        module: 'WAWebMessageAssociation.flow',
        why: 'HdCopies: tells an HD copy from a video in another encoding',
        exports: {
            MessageAssociationType: {
                kind: 'value',
                members: ['HEVC_VIDEO_DUAL_UPLOAD'],
            },
        },
    },
    {
        module: 'WAWebPairedMediaType.flow',
        why: 'HdCopies: what a copy that lost the link to its parent says it is',
        exports: {
            PAIRED_MEDIA_TYPE_BY_NAME: { kind: 'value', members: ['get'] },
        },
    },
];

module.exports = { BINDINGS };
