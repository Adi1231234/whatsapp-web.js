'use strict';

/**
 * Diagnostic hooks for monitoring WhatsApp Web internals.
 *
 * This file is meant to be injected via page.evaluate() AFTER both
 * DiagCommon (window.__diag) and Utils (window.WWebJS) have been loaded.
 *
 * It hooks into WAWeb modules to log encryption, decryption, media download,
 * signal session, receipt, identity change, and message pipeline events.
 *
 * All window.Store references from the original fork have been replaced
 * with direct window.require('WAWebXxx') calls matching the new upstream
 * structure.
 */
exports.InjectDiagHooks = () => {
    // Use shared helpers from DiagCommon (injected before this file)
    var safeDiagLog = window.__diag.safeDiagLog;
    var safeStr = window.__diag.safeStr;
    var wid = window.__diag.wid;
    var _isStatusOrGroup = window.__diag.isStatusOrGroup;
    var _isThumbnailType = window.__diag.isThumbnailType;
    var _shouldSkipDiag = window.__diag.shouldSkipMsg;
    var _shouldSkipReceipt = window.__diag.shouldSkipReceipt;

    /**
     * Hook a function inside a WAWeb module.
     * Signature: callback(originalFunction, ...args)
     */
    window.injectToFunction = (target, callback) => {
        var hookId = target.module + '.' + target.function;
        try {
            let module = window.require(target.module);
            if (!module) return;

            const path = target.function.split('.');
            const funcName = path.pop();

            for (const key of path) {
                if (!module[key]) {
                    safeDiagLog('warn', 'HOOK_FAIL', { hook: hookId, reason: 'path not found: ' + key });
                    return;
                }
                module = module[key];
            }

            const originalFunction = module[funcName];
            if (typeof originalFunction !== 'function') {
                safeDiagLog('warn', 'HOOK_FAIL', { hook: hookId, reason: 'not a function' });
                return;
            }

            module[funcName] = function(...args) {
                try {
                    return callback(originalFunction.bind(this), ...args);
                } catch {
                    return originalFunction.apply(this, args);
                }
            };

            safeDiagLog('debug', 'HOOK_OK', hookId);
        } catch(e) {
            safeDiagLog('warn', 'HOOK_FAIL', { hook: hookId, reason: e ? (e.message || String(e)) : 'unknown' });
            return;
        }
    };

    // --- Retry receipt monitoring ---
    window.injectToFunction({ module: 'WAWebSendRetryReceiptJob', function: 'sendRetryReceipt' }, function(func, ...args) {
        var params = args[0] || {};
        if (_isStatusOrGroup(params.to)) return func.apply(this, args);
        safeDiagLog('debug', 'RETRY_RECEIPT_SENT', {
            externalId: params.externalId,
            to: wid(params.to),
            retryCount: params.retryCount,
            retryReason: params.retryReason,
            isPeer: params.isPeer,
        });
        return func.apply(this, args);
    });

    // --- Decrypt receipt decision logging ---
    window.injectToFunction({ module: 'WAWebHandleMsgSendReceipt', function: 'sendReceipt' }, function(func, ...args) {
        var receipt = args[0] || {};
        var msgInfo = args[1];
        var decryptResult = args[2];
        var from = wid(receipt.senderPn) || wid(receipt.participant) || wid(receipt.senderLid) || wid(receipt.peerRecipientPn) || wid(receipt.peerRecipientLid) || wid(receipt.from);
        var isFromMe = !!(msgInfo && msgInfo.id && msgInfo.id.fromMe);
        // Unified receipt filter (groups, status, newsletters, stickers, non-media, fromMe)
        if (_shouldSkipReceipt({ from: from, to: wid(receipt.to), chatId: wid(receipt.chatId), type: receipt.type, msgType: msgInfo ? msgInfo.type : null, fromMe: isFromMe })) {
            return func.apply(this, args);
        }
        var participant = wid(receipt.participant);
        var resultStr = safeStr(decryptResult);
        var logData = {
            msgId: receipt.externalId,
            from: from,
            fromMe: isFromMe,
            participant: participant !== from ? participant : null,
            type: receipt.type,
            pushname: receipt.pushname,
            msgType: msgInfo ? msgInfo.type : null,
            result: resultStr,
        };
        if (resultStr && resultStr.indexOf('BACKFILL') !== -1) {
            logData.receiptKeys = Object.keys(receipt).sort().join(',');
            logData.receiptRaw = safeStr(receipt);
            logData.msgInfoRaw = safeStr(msgInfo);
            logData.decryptResultRaw = safeStr(decryptResult);
        }
        // For SUCCESS after a BACKFILL - check store state to understand if processMsgs worked
        if (resultStr && resultStr.indexOf('SUCCESS') !== -1 && receipt.externalId) {
            try {
                var _Msg = window.require('WAWebCollections').Msg;
                // Build the possible serialized IDs for this message
                var senderLid = wid(receipt.senderLid);
                var senderPn = wid(receipt.senderPn);
                var extId = receipt.externalId;
                var candidates = [];
                if (senderLid) candidates.push('false_' + senderLid + '_' + extId);
                if (senderPn) candidates.push('false_' + senderPn + '_' + extId);
                // Also try the msgInfo.id if available
                if (msgInfo && msgInfo.id && msgInfo.id._serialized) candidates.push(msgInfo.id._serialized);
                var storeHits = {};
                for (var ci = 0; ci < candidates.length; ci++) {
                    var cand = candidates[ci];
                    var found = _Msg.get(cand);
                    if (found) {
                        storeHits[cand] = { type: found.type, subtype: found.subtype || null };
                    }
                }
                logData.storeCheckAtReceipt = {
                    candidateIds: candidates,
                    hits: storeHits,
                    hitCount: Object.keys(storeHits).length,
                };
                if (msgInfo && msgInfo.id) {
                    logData.msgInfoId = msgInfo.id._serialized || null;
                    logData.msgInfoIdRemote = wid(msgInfo.id.remote) || null;
                }
            } catch(e) {
                logData.storeCheckError = String(e);
            }
        }
        safeDiagLog('debug', 'DECRYPT_RECEIPT_DECISION', logData);
        return func.apply(this, args);
    });

    // --- E2E identity change monitoring ---
    window.injectToFunction({ module: 'WAWebHandleIdentityChange', function: 'handleE2eIdentityChange' }, function(func, ...args) {
        var node = args[0] || {};
        var from = wid(node.senderPn) || wid(node.participant) || wid(node.from);
        var participant = null;
        var arg0Keys = [];
        try {
            arg0Keys = Object.keys(node).sort();
            if (!from && node.attrs) {
                from = wid(node.attrs.from) || wid(node.attrs.participant) || wid(node.attrs.sender_pn);
                participant = wid(node.attrs.participant) || wid(node.attrs.participant_lid);
            }
            if (!from && node.content && Array.isArray(node.content)) {
                for (var i = 0; i < node.content.length; i++) {
                    var child = node.content[i];
                    if (child && child.attrs) {
                        from = from || wid(child.attrs.from) || wid(child.attrs.jid);
                    }
                }
            }
            if (!from && args[1]) {
                from = wid(args[1].from) || wid(args[1].jid) || wid(args[1]);
            }
            if (!participant) {
                participant = wid(node.participantLid) || wid(node.participant);
            }
        } catch(e) {}
        // Filter group and status identity changes - not relevant for 1:1 diagnostics
        if (!_isStatusOrGroup(from)) {
            safeDiagLog('debug', 'IDENTITY_CHANGE', {
                from: from,
                participant: participant !== from ? participant : null,
                argCount: args.length,
                arg0Keys: arg0Keys.join(','),
                arg0Raw: safeStr(node),
            });
        }
        return func.apply(this, args);
    });

    // --- Encrypted message handling ---
    window.injectToFunction({ module: 'WAWebHandleEncMsg', function: 'handleEncMsg' }, function(func, ...args) {
        var stanza = args[0];
        var traceId = '';
        var encType = '';
        var senderJid = '';
        try {
            if (stanza && stanza.attrs) {
                traceId = stanza.attrs.id || '';
                senderJid = stanza.attrs.participant || stanza.attrs.from || '';
            }
            if (stanza && Array.isArray(stanza.content)) {
                for (var i = 0; i < stanza.content.length; i++) {
                    var child = stanza.content[i];
                    if (child && child.tag === 'enc') {
                        encType = child.attrs ? child.attrs.type || '' : '';
                        break;
                    }
                }
            }
        } catch(e) {}
        var skipDiag = _isStatusOrGroup(senderJid) || _isStatusOrGroup(stanza && stanza.attrs && stanza.attrs.from);
        var startTime = Date.now();
        var result = func.apply(this, args);
        if (result && typeof result.then === 'function') {
            return result.then(function(res) {
                if (!skipDiag) {
                    var resultInfo = {
                        traceId: traceId,
                        sender: senderJid,
                        encType: encType,
                        elapsed: Date.now() - startTime,
                    };
                    try {
                        if (res !== undefined && res !== null) {
                            resultInfo.resultType = typeof res;
                            if (typeof res === 'object') {
                                resultInfo.resultKeys = Object.keys(res).slice(0, 15).join(',');
                                if (res.type) resultInfo.msgType = res.type;
                                if (res.id) resultInfo.msgId = typeof res.id === 'object' ? res.id._serialized || res.id.id : String(res.id);
                                if (res.body !== undefined) resultInfo.hasBody = !!res.body;
                                if (res.isNewMsg !== undefined) resultInfo.isNewMsg = res.isNewMsg;
                            }
                        }
                    } catch(e2) {}
                    safeDiagLog('debug', 'ENC_MSG_RESULT', resultInfo);
                }
                return res;
            }).catch(function(err) {
                if (!skipDiag) {
                    safeDiagLog('warn', 'ENC_MSG_FAIL', {
                        traceId: traceId,
                        sender: senderJid,
                        encType: encType,
                        elapsed: Date.now() - startTime,
                        error: err ? (err.message || String(err)) : 'unknown',
                        errorName: err ? err.name : null,
                    });
                }
                throw err;
            });
        }
        return result;
    });

    // --- Peer message handling (PDO, history sync) ---
    window.injectToFunction({ module: 'WAWebHandlePeerMsg', function: 'handlePeerMsg' }, function(func, ...args) {
        var peerMsg = args[0];
        var msgType = 'unknown';
        var details = {};
        try {
            if (peerMsg) {
                if (peerMsg.peerDataOperationRequestMessage) {
                    msgType = 'PDO_REQUEST';
                    var req = peerMsg.peerDataOperationRequestMessage;
                    details.requestType = req.peerDataOperationRequestType;
                    if (req.placeholderMessageResendRequest && req.placeholderMessageResendRequest.length > 0) {
                        details.resendMsgIds = req.placeholderMessageResendRequest.map(function(r) {
                            return r.messageKey ? r.messageKey.id : null;
                        });
                    }
                }
                if (peerMsg.peerDataOperationRequestResponseMessage) {
                    msgType = 'PDO_RESPONSE';
                    var resp = peerMsg.peerDataOperationRequestResponseMessage;
                    details.requestType = resp.peerDataOperationRequestType;
                    details.resultCount = resp.peerDataOperationResult ? resp.peerDataOperationResult.length : 0;
                    if (resp.peerDataOperationResult) {
                        details.results = resp.peerDataOperationResult.map(function(r) {
                            return {
                                hasPlaceholder: !!r.placeholderMessageResendResponse,
                                hasMedia: !!r.mediaUploadResult,
                            };
                        });
                    }
                }
                if (peerMsg.historySyncNotification) {
                    msgType = 'HISTORY_SYNC';
                    details.syncType = peerMsg.historySyncNotification.syncType;
                    details.progress = peerMsg.historySyncNotification.progress;
                }
            }
        } catch(e) { details.parseError = String(e); }
        // Peer messages are self-to-self protocol messages (PDO, history sync) - skip to reduce noise (fromMe equivalent)
        // Only log errors for debugging protocol failures
        var result = func.apply(this, args);
        if (result && typeof result.then === 'function') {
            return result.catch(function(err) {
                safeDiagLog('debug', 'PEER_MSG_ERROR', {
                    msgType: msgType,
                    error: err ? (err.message || String(err)) : 'unknown',
                });
                throw err;
            });
        }
        return result;
    });

    // --- PDO request sending ---
    try {
        window.injectToFunction({ module: 'WAWebSendNonMessageDataRequest', function: 'sendPeerDataOperationRequest' }, function(func, ...args) {
            var requestType = args[0];
            safeDiagLog('debug', 'PDO_REQUEST_SENT', {
                requestType: requestType,
                params: safeStr(args[1]),
            });
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(res) {
                    safeDiagLog('debug', 'PDO_REQUEST_ACK', { requestType: requestType });
                    return res;
                }).catch(function(err) {
                    safeDiagLog('warn', 'PDO_REQUEST_FAIL', {
                        requestType: requestType,
                        error: err ? (err.message || String(err)) : 'unknown',
                    });
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    // --- Signal crypto hooks (decrypt/encrypt) ---
    // NOTE: Signal crypto hooks only have raw crypto args - cannot filter by message type/sender
    var signalFns = ['Cipher.decryptSignalProto', 'Cipher.decryptGroupSignalProto', 'Cipher.encryptSignalProto'];
    for (var si = 0; si < signalFns.length; si++) {
        try {
            (function(fnName) {
                window.injectToFunction({ module: 'WAWebSignal', function: fnName }, function(func, ...args) {
                    var result;
                    try { result = func.apply(this, args); } catch(err) {
                        safeDiagLog('warn', 'SIGNAL_DECRYPT_ERROR', {
                            op: fnName, error: err ? (err.message || String(err)) : 'unknown',
                        });
                        throw err;
                    }
                    if (result && typeof result.then === 'function') {
                        return result.catch(function(err) {
                            safeDiagLog('warn', 'SIGNAL_DECRYPT_ERROR', {
                                op: fnName, error: err ? (err.message || String(err)) : 'unknown',
                            });
                            throw err;
                        });
                    }
                    return result;
                });
            })(signalFns[si]);
        } catch(e) {}
    }

    // --- E2E session management ---
    var sessionFns = ['ensureE2ESessions'];
    for (var ei = 0; ei < sessionFns.length; ei++) {
        try {
            (function(fnName) {
                window.injectToFunction({ module: 'WAWebManageE2ESessionsJob', function: fnName }, function(func, ...args) {
                    var jid = '';
                    try {
                        if (typeof args[0] === 'string') jid = args[0];
                        else if (args[0] && args[0]._serialized) jid = args[0]._serialized;
                        else if (args[0] && args[0].jid) jid = args[0].jid;
                    } catch(e) {}
                    if (!_isStatusOrGroup(jid)) {
                        safeDiagLog('debug', 'E2E_SESSION_OP', { op: fnName, jid: jid });
                    }
                    var result = func.apply(this, args);
                    if (result && typeof result.then === 'function') {
                        return result.catch(function(err) {
                            if (!_isStatusOrGroup(jid)) {
                                safeDiagLog('debug', 'E2E_SESSION_ERROR', {
                                    op: fnName, jid: jid, error: err ? (err.message || String(err)) : 'unknown',
                                });
                            }
                            throw err;
                        });
                    }
                    return result;
                });
            })(sessionFns[ei]);
        } catch(e) {}
    }

    // --- Signal session lifecycle (create/delete) for debugging session corruption ---
    var signalSessionFns = ['createSignalSession', 'deleteRemoteSession', 'deleteRemoteInfo'];
    for (var ssi = 0; ssi < signalSessionFns.length; ssi++) {
        try {
            (function(fnName) {
                window.injectToFunction({ module: 'WAWebSignal', function: 'Session.' + fnName }, function(func, ...args) {
                    var jid = '';
                    try {
                        if (typeof args[0] === 'string') jid = args[0];
                        else if (args[0] && args[0]._serialized) jid = args[0]._serialized;
                        else if (args[0] && args[0].user) jid = args[0].user;
                    } catch(e) {}
                    if (!_isStatusOrGroup(jid)) {
                        safeDiagLog('debug', 'SIGNAL_SESSION_OP', { op: fnName, jid: wid(args[0]) || jid });
                    }
                    var result = func.apply(this, args);
                    if (result && typeof result.then === 'function') {
                        return result.catch(function(err) {
                            if (!_isStatusOrGroup(jid)) {
                                safeDiagLog('debug', 'SIGNAL_SESSION_ERROR', {
                                    op: fnName, jid: wid(args[0]) || jid, error: err ? (err.message || String(err)) : 'unknown',
                                });
                            }
                            throw err;
                        });
                    }
                    return result;
                });
            })(signalSessionFns[ssi]);
        } catch(e) {}
    }

    // --- Sender key message handling ---
    try {
        window.injectToFunction({ module: 'WAWebSenderKeyMsgHandler', function: 'handleSenderKeyMsg' }, function(func, ...args) {
            var stanza = args[0];
            var traceId = stanza && stanza.attrs ? stanza.attrs.id : '';
            var sender = stanza && stanza.attrs ? (stanza.attrs.participant || stanza.attrs.from || '') : '';
            // Sender keys are used exclusively for group encryption - filter group senders
            var fromJid = stanza && stanza.attrs ? (stanza.attrs.from || '') : '';
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.catch(function(err) {
                    if (!_isStatusOrGroup(fromJid)) {
                        safeDiagLog('warn', 'SENDER_KEY_FAIL', {
                            traceId: traceId, sender: sender,
                            error: err ? (err.message || String(err)) : 'unknown',
                        });
                    }
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    // --- Media download monitoring (downloadMediaBlob) ---
    // NOTE: WAWebMediaDownloadUtils was removed in WAWeb 2.3000+. downloadMediaBlob is inlined.
    //       The DL_DECRYPT hook on downloadAndMaybeDecrypt covers the main download path.
    //       Try WAWebMediaDownloadUtils first, fall back to WAWebMedia.downloadMsg if available.
    try {
        var _mediaDownloadMod = window.require('WAWebMediaDownloadUtils') ? 'WAWebMediaDownloadUtils' : null;
        if (_mediaDownloadMod) {
            window.injectToFunction({ module: _mediaDownloadMod, function: 'downloadMediaBlob' }, function(func, ...args) {
                var startTime = Date.now();
                var url = '';
                try { url = typeof args[0] === 'string' ? args[0].slice(0, 100) : (args[0] && args[0].directPath ? args[0].directPath.slice(0, 100) : ''); } catch(e) {}
                var result = func.apply(this, args);
                if (result && typeof result.then === 'function') {
                    return result.then(function(res) {
                        safeDiagLog('debug', 'MEDIA_DOWNLOAD_OK', {
                            elapsed: Date.now() - startTime,
                            url: url,
                            size: res ? (res.byteLength || res.size || res.length || 0) : 0,
                        });
                        return res;
                    }).catch(function(err) {
                        safeDiagLog('debug', 'MEDIA_DOWNLOAD_FAIL', {
                            elapsed: Date.now() - startTime,
                            url: url,
                            error: err ? (err.message || String(err)) : 'unknown',
                        });
                        throw err;
                    });
                }
                return result;
            });

            window.injectToFunction({ module: _mediaDownloadMod, function: 'downloadMedia' }, function(func, ...args) {
                var startTime = Date.now();
                var directPath = '';
                try { directPath = (args[0] && args[0].directPath) ? args[0].directPath.slice(0, 100) : ''; } catch(e) {}
                var result = func.apply(this, args);
                if (result && typeof result.then === 'function') {
                    return result.then(function(res) {
                        safeDiagLog('debug', 'MEDIA_DOWNLOAD2_OK', {
                            elapsed: Date.now() - startTime, directPath: directPath,
                        });
                        return res;
                    }).catch(function(err) {
                        safeDiagLog('debug', 'MEDIA_DOWNLOAD2_FAIL', {
                            elapsed: Date.now() - startTime, directPath: directPath,
                            error: err ? (err.message || String(err)) : 'unknown',
                        });
                        throw err;
                    });
                }
                return result;
            });
        } else {
            // WAWebMediaDownloadUtils removed in 2.3000+, covered by DL_DECRYPT
        }
    } catch(e) {}

    // --- PreKey get/upload ---
    // NOTE: WAWebPreKeyUtils was removed in WAWeb 2.3000+. getOrGenPreKeys is inlined.
    //       uploadPreKeys moved to WAWebUploadPreKeysJob.
    try {
        var _preKeyGetMod = window.require('WAWebPreKeyUtils') ? 'WAWebPreKeyUtils' : null;
        if (_preKeyGetMod) {
            window.injectToFunction({ module: _preKeyGetMod, function: 'getOrGenPreKeys' }, function(func, ...args) {
                var result = func.apply(this, args);
                if (result && typeof result.then === 'function') {
                    return result.then(function(res) {
                        var count = Array.isArray(res) ? res.length : (res ? 1 : 0);
                        safeDiagLog('debug', 'PREKEY_GET', { count: count });
                        return res;
                    }).catch(function(err) {
                        safeDiagLog('warn', 'PREKEY_GET_FAIL', {
                            error: err ? (err.message || String(err)) : 'unknown',
                        });
                        throw err;
                    });
                }
                return result;
            });
        } else {
            // WAWebPreKeyUtils.getOrGenPreKeys inlined in 2.3000+
        }
    } catch(e) {}

    // uploadPreKeys: try WAWebUploadPreKeysJob (2.3000+), fall back to WAWebPreKeyUtils
    try {
        var _preKeyUploadMod = window.require('WAWebUploadPreKeysJob') ? 'WAWebUploadPreKeysJob'
            : window.require('WAWebPreKeyUtils') ? 'WAWebPreKeyUtils' : null;
        if (_preKeyUploadMod) {
            window.injectToFunction({ module: _preKeyUploadMod, function: 'uploadPreKeys' }, function(func, ...args) {
                safeDiagLog('debug', 'PREKEY_UPLOAD', { count: Array.isArray(args[0]) ? args[0].length : 0 });
                var result = func.apply(this, args);
                if (result && typeof result.then === 'function') {
                    return result.catch(function(err) {
                        safeDiagLog('warn', 'PREKEY_UPLOAD_FAIL', {
                            error: err ? (err.message || String(err)) : 'unknown',
                        });
                        throw err;
                    });
                }
                return result;
            });
        } else {
            // uploadPreKeys module not available
        }
    } catch(e) {}

    // --- Session deletion ---
    // NOTE: WAWebDeleteSessionJob was removed in WAWeb 2.3000+.
    //       deleteRemoteSession is still available via WAWebSignal.Session (hooked above).
    //       Try WAWebDeleteSessionJob first, then fall back to WAWebSignal.Session hook.
    try {
        var _deleteSessionMod = window.require('WAWebDeleteSessionJob') ? 'WAWebDeleteSessionJob' : null;
        if (_deleteSessionMod) {
            window.injectToFunction({ module: _deleteSessionMod, function: 'deleteRemoteSession' }, function(func, ...args) {
                var jid = '';
                try { jid = wid(args[0]) || safeStr(args[0]); } catch(e) {}
                if (!_isStatusOrGroup(jid)) {
                    safeDiagLog('warn', 'SESSION_DELETE', { jid: jid });
                }
                return func.apply(this, args);
            });
        } else {
            // WAWebDeleteSessionJob removed in 2.3000+, covered by WAWebSignal.Session hooks
        }
    } catch(e) {}

    // --- Socket close monitoring ---
    // NOTE: WAWebSocketConnectModel and onSocketClose were removed in WAWeb 2.3000+.
    //       In newer versions, hook SocketBridgeApi.triggerSocketStreamDisconnectedFromBridge
    //       and also listen to Socket change:state events for disconnect detection.
    try {
        var _socketHooked = false;
        // Try legacy approach first
        var connMods = ['WAWebSocketConnectModel', 'WAWebSocketModel'];
        for (var ci = 0; ci < connMods.length; ci++) {
            try {
                var _connMod = window.require(connMods[ci]);
                if (_connMod && typeof _connMod.onSocketClose === 'function') {
                    window.injectToFunction({ module: connMods[ci], function: 'onSocketClose' }, function(func, ...args) {
                        var code = args[0];
                        var reason = args[1];
                        safeDiagLog('warn', 'SOCKET_CLOSE', {
                            code: code, reason: typeof reason === 'string' ? reason.slice(0, 200) : String(reason),
                        });
                        return func.apply(this, args);
                    });
                    _socketHooked = true;
                    break;
                }
            } catch(e) {}
        }
        // Fallback: hook SocketBridgeApi disconnect trigger (WAWeb 2.3000+)
        if (!_socketHooked) {
            try {
                window.injectToFunction({ module: 'WAWebSocketBridgeApi', function: 'SocketBridgeApi.triggerSocketStreamDisconnectedFromBridge' }, function(func, ...args) {
                    safeDiagLog('warn', 'SOCKET_CLOSE', { source: 'bridgeApi', args: safeStr(args[0]) });
                    return func.apply(this, args);
                });
            } catch(e) {
                // SOCKET_CLOSE: no hookable module found
            }
        }
    } catch(e) {}

    // --- History sync processing ---
    // NOTE: WAWebHistorySyncJobUtils.processHistorySyncData was removed in WAWeb 2.3000+.
    //       Replaced by WAWebHandleHistorySyncChunk.handleHistorySyncChunk.
    try {
        var _historySyncMod = window.require('WAWebHistorySyncJobUtils') ? 'WAWebHistorySyncJobUtils' : null;
        var _historySyncFn = _historySyncMod ? 'processHistorySyncData' : null;
        if (!_historySyncMod) {
            _historySyncMod = window.require('WAWebHandleHistorySyncChunk') ? 'WAWebHandleHistorySyncChunk' : null;
            _historySyncFn = _historySyncMod ? 'handleHistorySyncChunk' : null;
        }
        if (_historySyncMod && _historySyncFn) {
            window.injectToFunction({ module: _historySyncMod, function: _historySyncFn }, function(func, ...args) {
                var data = args[0];
                var msgCount = 0;
                try {
                    if (data && data.conversations) {
                        for (var hi = 0; hi < data.conversations.length; hi++) {
                            msgCount += (data.conversations[hi].messages || []).length;
                        }
                    }
                } catch(e) {}
                safeDiagLog('debug', 'HISTORY_SYNC_PROCESS', {
                    conversationCount: data && data.conversations ? data.conversations.length : 0,
                    msgCount: msgCount,
                    syncType: data ? data.syncType : null,
                    progress: data ? data.progress : null,
                });
                return func.apply(this, args);
            });
        } else {
            // HISTORY_SYNC_PROCESS: no module found
        }
    } catch(e) {}

    // --- [L13] downloadAndMaybeDecrypt hook for filehash mismatch root cause ---
    // NOTE: Limited filtering - only opts.type available (no from/fromMe). Can filter stickers.
    try {
        window.injectToFunction({ module: 'WAWebDownloadManager', function: 'downloadManager.downloadAndMaybeDecrypt' }, function(func, ...args) {
            var opts = args[0] || {};
            // Skip sticker and thumbnail downloads from diagnostics
            if (opts.type === 'sticker' || _isThumbnailType(opts.type)) return func.apply(this, args);
            var startTime = Date.now();
            var inputLog = {
                directPath: opts.directPath ? opts.directPath.slice(0, 80) : null,
                encFilehash: opts.encFilehash || null,
                filehash: opts.filehash || null,
                mediaKeyPrefix: null,
                mediaKeyTimestamp: opts.mediaKeyTimestamp,
                type: opts.type,
                hasSignal: !!opts.signal,
            };
            try {
                if (opts.mediaKey) {
                    var keyBytes = new Uint8Array(opts.mediaKey.slice(0, 8));
                    inputLog.mediaKeyPrefix = btoa(String.fromCharCode.apply(null, keyBytes));
                    inputLog.mediaKeyLength = opts.mediaKey.byteLength || opts.mediaKey.length;
                }
            } catch(e) {}

            safeDiagLog('debug', 'DL_DECRYPT_START', inputLog);

            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(decrypted) {
                    safeDiagLog('debug', 'DL_DECRYPT_OK', {
                        elapsed: Date.now() - startTime,
                        byteLength: decrypted ? (decrypted.byteLength || 0) : 0,
                        type: opts.type,
                    });
                    return decrypted;
                }).catch(function(err) {
                    var errorInfo = {
                        elapsed: Date.now() - startTime,
                        type: opts.type,
                        errorName: err ? err.name : null,
                        errorMessage: err ? (typeof err.message === 'object' ? JSON.stringify(err.message) : String(err.message || err)).substring(0, 500) : null,
                        errorStatus: err ? err.status : null,
                        errorCode: err ? err.code : null,
                        expectedEncFilehash: opts.encFilehash,
                        expectedFilehash: opts.filehash,
                        directPath: opts.directPath ? opts.directPath.slice(0, 80) : null,
                        mediaKeyTimestamp: opts.mediaKeyTimestamp,
                    };
                    try {
                        var allProps = {};
                        for (var k in err) {
                            if (err.hasOwnProperty(k) && !['message', 'stack', 'name'].includes(k)) {
                                var v = err[k];
                                allProps[k] = (typeof v === 'object' && v !== null)
                                    ? JSON.stringify(v).substring(0, 300)
                                    : String(v);
                            }
                        }
                        errorInfo.errorProps = allProps;
                        var proto = Object.getPrototypeOf(err);
                        if (proto && proto !== Error.prototype) {
                            var descriptors = Object.getOwnPropertyNames(proto);
                            var protoProps = {};
                            for (var pi = 0; pi < descriptors.length; pi++) {
                                var pn = descriptors[pi];
                                if (!['constructor', 'message', 'stack', 'name', 'toString'].includes(pn)) {
                                    try { protoProps[pn] = String(err[pn]).substring(0, 200); } catch(e2) {}
                                }
                            }
                            if (Object.keys(protoProps).length > 0) errorInfo.errorProtoProps = protoProps;
                        }
                    } catch(e2) {}
                    safeDiagLog('warn', 'DL_DECRYPT_FAIL', errorInfo);
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {
        safeDiagLog('warn', 'HOOK_FAIL_MANUAL', { hook: 'downloadAndMaybeDecrypt', error: String(e) });
    }

    // --- [L13] WAWebMmsClient.download hook - wraps ciphertextValidator to capture actual vs expected hash ---
    // NOTE: Limited filtering - only opts.type available. Can filter stickers.
    try {
        window.injectToFunction({ module: 'WAWebMmsClient', function: 'download' }, function(func, ...args) {
            var opts = args[0] || {};
            // Skip sticker and thumbnail downloads from diagnostics
            if (opts.type === 'sticker' || _isThumbnailType(opts.type)) return func.apply(this, args);
            var originalValidator = opts.ciphertextValidator;
            var expectedHash = opts.filehash || opts.encFilehash; // download() receives encFilehash as 'filehash' param

            if (originalValidator) {
                args[0] = Object.assign({}, opts, { ciphertextValidator: function(downloadedBytes) {
                    // Compute hash once and compare - avoids double SHA-256 computation
                    var size = downloadedBytes ? (downloadedBytes.byteLength || 0) : 0;
                    return window.require('WAMediaCalculateFilehash').calculateFilehash(downloadedBytes).then(function(computedHash) {
                        var isValid = computedHash === expectedHash;
                        if (!isValid) {
                            safeDiagLog('error', 'ENC_HASH_MISMATCH_DETAIL', {
                                computedEncHash: computedHash,
                                expectedEncHash: expectedHash,
                                downloadedSize: size,
                                directPath: opts.directPath ? opts.directPath.slice(0, 80) : null,
                                debugString: opts.debugString || null,
                            });
                        }
                        return isValid;
                    }).catch(function(e) {
                        safeDiagLog('debug', 'ENC_HASH_CALC_ERROR', {
                            error: String(e),
                            downloadedSize: size,
                        });
                        return originalValidator(downloadedBytes);
                    });
                } });
                opts = args[0];
            }

            safeDiagLog('debug', 'MMS_DOWNLOAD_START', {
                directPath: opts.directPath ? opts.directPath.slice(0, 80) : null,
                expectedHash: expectedHash,
                hasValidator: !!originalValidator,
                type: opts.type,
                mode: opts.mode,
                staticUrl: opts.staticUrl ? 'present' : null,
            });

            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(data) {
                    safeDiagLog('debug', 'MMS_DOWNLOAD_OK', {
                        directPath: opts.directPath ? opts.directPath.slice(0, 80) : null,
                        size: data ? (data.byteLength || 0) : 0,
                    });
                    return data;
                }).catch(function(err) {
                    safeDiagLog('warn', 'MMS_DOWNLOAD_FAIL', {
                        directPath: opts.directPath ? opts.directPath.slice(0, 80) : null,
                        errorName: err ? err.name : null,
                        errorMessage: err ? (typeof err.message === 'object' ? JSON.stringify(err.message) : String(err.message || err)).substring(0, 300) : null,
                    });
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {
        safeDiagLog('warn', 'HOOK_FAIL_MANUAL', { hook: 'WAWebMmsClient.download', error: String(e) });
    }

    // --- [L13] WAWebCryptoDecryptMedia hook - capture decryption details ---
    // NOTE: Cannot filter by message type here - only has crypto params, no message context
    // NOTE: In newer WAWeb (2.3000+), the module IS the default export function directly
    //       (typeof module === 'function', no .default property). We cannot replace it in
    //       Metro's registry, but the DL_DECRYPT hook on downloadAndMaybeDecrypt already
    //       covers the main decrypt path. We still try the .default hook for older versions.
    try {
        var _cryptoMod = window.require('WAWebCryptoDecryptMedia');
        if (typeof _cryptoMod === 'function' && !('default' in _cryptoMod)) {
            // WAWebCryptoDecryptMedia is module-level function in 2.3000+, covered by DL_DECRYPT
        } else {
            window.injectToFunction({ module: 'WAWebCryptoDecryptMedia', function: 'default' }, function(func, ...args) {
                var opts = args[0] || {};
                var startTime = Date.now();
                safeDiagLog('debug', 'DECRYPT_MEDIA_START', {
                    expectedPlaintextHash: opts.expectedPlaintextHash || null,
                    ciphertextSize: opts.ciphertextHmac ? (opts.ciphertextHmac.byteLength || 0) : 0,
                    hasMediaKeys: !!opts.mediaKeys,
                    debugString: opts.debugString || null,
                });

                var result = func.apply(this, args);
                if (result && typeof result.then === 'function') {
                    return result.then(function(plaintext) {
                        safeDiagLog('debug', 'DECRYPT_MEDIA_OK', {
                            elapsed: Date.now() - startTime,
                            plaintextSize: plaintext ? (plaintext.byteLength || 0) : 0,
                        });
                        return plaintext;
                    }).catch(function(err) {
                        safeDiagLog('warn', 'DECRYPT_MEDIA_FAIL', {
                            elapsed: Date.now() - startTime,
                            errorName: err ? err.name : null,
                            errorMessage: err ? (typeof err.message === 'object' ? JSON.stringify(err.message) : String(err.message || err)).substring(0, 500) : null,
                            expectedPlaintextHash: opts.expectedPlaintextHash,
                            ciphertextSize: opts.ciphertextHmac ? (opts.ciphertextHmac.byteLength || 0) : 0,
                        });
                        throw err;
                    });
                }
                return result;
            });
        }
    } catch(e) {
        safeDiagLog('warn', 'HOOK_FAIL_MANUAL', { hook: 'WAWebCryptoDecryptMedia', error: String(e) });
    }

    // --- [L13] WAWebValidateMediaFilehash hook - capture unencrypted media hash validation ---
    try {
        window.injectToFunction({ module: 'WAWebValidateMediaFilehash', function: 'validateFileash' }, function(func, ...args) {
            var data = args[0];
            var expectedHash = args[1];
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(isValid) {
                    if (!isValid) {
                        // Hash mismatch on unencrypted media - compute actual hash
                        return window.require('WAMediaCalculateFilehash').calculateFilehash(data).then(function(actual) {
                            safeDiagLog('error', 'PLAINTEXT_HASH_MISMATCH_DETAIL', {
                                computedHash: actual,
                                expectedHash: expectedHash,
                                dataSize: data ? (data.byteLength || 0) : 0,
                            });
                            return isValid;
                        }).catch(function() { return isValid; });
                    }
                    return isValid;
                });
            }
            return result;
        });
    } catch(e) {}

    // --- [L13] Detect BACKFILL/placeholder messages ---
    // NOTE: In newer WAWeb (2.3000+), isPlaceholder was removed from Msg prototype.
    //       We try Msg.prototype first (via WAWebMsgModel.Msg), then fall back to .default.
    try {
        var _msgModelMod = window.require('WAWebMsgModel');
        var _msgProto = (_msgModelMod && _msgModelMod.Msg && _msgModelMod.Msg.prototype)
            || (_msgModelMod && _msgModelMod.default && _msgModelMod.default.prototype);
        if (_msgProto && typeof _msgProto.isPlaceholder === 'function') {
            var _origIsPlaceholder = _msgProto.isPlaceholder;
            _msgProto.isPlaceholder = function() {
                var result = _origIsPlaceholder.apply(this, arguments);
                if (result && !_shouldSkipDiag(this)) {
                    safeDiagLog('debug', 'MSG_IS_PLACEHOLDER', {
                        id: this.id ? this.id._serialized : null,
                        type: this.type,
                        hasMedia: this.hasMedia,
                    });
                }
                return result;
            };
            safeDiagLog('debug', 'HOOK_OK', 'WAWebMsgModel.isPlaceholder');
        } else {
            // WAWebMsgModel.isPlaceholder removed in 2.3000+
        }
    } catch(e) {}

    // --- [SILENT_LOSS] Wrap Msg.add to trace ALL add attempts ---
    // window.Store.Msg -> window.require('WAWebCollections').Msg
    try {
        var MsgCollection = window.require('WAWebCollections').Msg;
        const origMsgAdd = MsgCollection.add.bind(MsgCollection);
        MsgCollection.add = function(...args) {
            try {
                const models = Array.isArray(args[0]) ? args[0] : [args[0]];
                const opts = args[1] || {};
                for (const m of models) {
                    if (!m) continue;
                    const id = m.id?._serialized || m.id?.id || '';
                    const from = m.from?._serialized || m.from?.user || '';
                    if (_shouldSkipDiag(m)) continue;
                    const alreadyExists = MsgCollection.get(id);
                    // Skip no-op re-adds (existing msg, not new) - these fire dozens of times/sec during sync
                    if (alreadyExists && !m.isNewMsg) continue;
                    safeDiagLog('debug', 'MSG_ADD_ATTEMPT', {
                        traceId: id,
                        from: from,
                        type: m.type,
                        isNewMsg: !!m.isNewMsg,
                        alreadyExists: !!alreadyExists,
                        mergeOption: !!opts.merge,
                        hasBody: !!(m.body || m.caption),
                    });
                }
            } catch(e) {}
            return origMsgAdd(...args);
        };
        safeDiagLog('debug', 'HOOK_OK', 'Msg.add-wrapper');
    } catch(e) {
        safeDiagLog('warn', 'HOOK_FAIL', { hook: 'Msg.add-wrapper', reason: String(e) });
    }

    // --- [SILENT_LOSS] Hook Msg.addAndGet if it exists ---
    // window.Store.Msg -> window.require('WAWebCollections').Msg
    try {
        var MsgCollection2 = window.require('WAWebCollections').Msg;
        if (typeof MsgCollection2.addAndGet === 'function') {
            var origAddAndGet = MsgCollection2.addAndGet.bind(MsgCollection2);
            MsgCollection2.addAndGet = function(...args) {
                try {
                    var m = args[0];
                    var id = m?.id?._serialized || m?.id?.id || '';
                    var from = m?.from?._serialized || m?.from?.user || '';
                    if (!_shouldSkipDiag(m)) {
                        safeDiagLog('debug', 'MSG_ADD_AND_GET', {
                            traceId: id, from: from, type: m?.type, isNewMsg: !!m?.isNewMsg,
                        });
                    }
                } catch(e) {}
                return origAddAndGet(...args);
            };
            safeDiagLog('debug', 'HOOK_OK', 'Msg.addAndGet-wrapper');
        }
    } catch(e) {}

    // --- [SILENT_LOSS] Discover message processing modules ---
    var msgProcessModules = [
        'WAWebHandleReceivedMsg',
        'WAWebMsgHandler',
        'WAWebProcessMsg',
        'WAWebChatMsgHandler',
        'WAWebAddMsgToChat',
        'WAWebMsgProcessing',
        'WAWebProcessReceivedMessages',
        'WAWebHandleIncomingMsg',
    ];

    for (var mi = 0; mi < msgProcessModules.length; mi++) {
        try {
            var modName = msgProcessModules[mi];
            var mod = window.require(modName);
            if (mod) {
                var fnNames = Object.keys(mod).filter(function(k) { return typeof mod[k] === 'function'; });
                safeDiagLog('debug', 'MSG_PROCESS_MODULE_FOUND', {
                    module: modName,
                    functions: fnNames.slice(0, 20).join(','),
                });
            }
        } catch(e) {}
    }

    // --- Message revoke monitoring ---
    // NOTE: WAWebMsgDeleteCollection was removed in WAWeb 2.3000+. Use WAWebRevokeMsgAction instead.
    try {
        var _revokeModule = window.require('WAWebRevokeMsgAction') ? 'WAWebRevokeMsgAction'
            : window.require('WAWebMsgDeleteCollection') ? 'WAWebMsgDeleteCollection' : null;
        if (!_revokeModule) throw 'no revoke module found';
        window.injectToFunction({ module: _revokeModule, function: 'sendRevoke' }, function(func, ...args) {
            var msg = args[0];
            if (!_shouldSkipDiag(msg)) {
                safeDiagLog('debug', 'MSG_REVOKE', {
                    id: msg && msg.id ? msg.id._serialized : '',
                    from: msg ? wid(msg.from) : null,
                    type: msg ? msg.type : null,
                });
            }
            return func.apply(this, args);
        });
    } catch(e) {}

    // =====================================================================
    // CIPHERTEXT_TIMEOUT deep-investigation hooks
    // =====================================================================

    // --- Hook processMultipleMessages to see what happens when messages are processed ---
    try {
        var _MsgCollection = window.require('WAWebCollections').Msg;
        if (_MsgCollection && _MsgCollection.processMultipleMessages) {
            var _origPMM = _MsgCollection.processMultipleMessages.bind(_MsgCollection);
            _MsgCollection.processMultipleMessages = function(chatId, msgs, overwriteOption, origin, extraOpts, sequential) {
                var msgSummaries = [];
                try {
                    if (msgs && msgs.length) {
                        for (var mi = 0; mi < msgs.length && mi < 10; mi++) {
                            var m = msgs[mi];
                            var mId = m && m.id ? (m.id._serialized || m.id.id || '') : '';
                            var existsInStore = mId ? !!_MsgCollection.get(mId) : false;
                            var existingType = existsInStore ? _MsgCollection.get(mId).type : null;
                            msgSummaries.push({
                                traceId: mId,
                                type: m ? m.type : null,
                                subtype: m ? m.subtype : null,
                                isNewMsg: m ? !!m.isNewMsg : null,
                                existsInStore: existsInStore,
                                existingType: existingType,
                                hasDirectPath: m ? !!m.directPath : false,
                                hasMediaKey: m ? !!m.mediaKey : false,
                                hasBody: m ? !!m.body : false,
                            });
                        }
                    }
                } catch(e) {}
                var hasCiphertext = msgSummaries.some(function(s) { return s.type === 'ciphertext' || s.existingType === 'ciphertext'; });
                if (hasCiphertext || (overwriteOption != null && overwriteOption !== 0)) {
                    safeDiagLog('info', 'PROCESS_MULTIPLE_MSGS', {
                        chatId: chatId ? String(chatId) : null,
                        msgCount: msgs ? msgs.length : 0,
                        overwriteOption: overwriteOption,
                        origin: origin,
                        sequential: sequential,
                        msgs: msgSummaries,
                    });
                }
                var result = _origPMM(chatId, msgs, overwriteOption, origin, extraOpts, sequential);
                if (result && typeof result.then === 'function') {
                    return result.then(function(res) {
                        if (hasCiphertext) {
                            var afterState = [];
                            try {
                                for (var ai = 0; ai < msgSummaries.length; ai++) {
                                    var tid = msgSummaries[ai].traceId;
                                    if (!tid) continue;
                                    var afterMsg = _MsgCollection.get(tid);
                                    afterState.push({
                                        traceId: tid,
                                        existsAfter: !!afterMsg,
                                        typeAfter: afterMsg ? afterMsg.type : null,
                                        subtypeAfter: afterMsg ? afterMsg.subtype : null,
                                    });
                                }
                            } catch(e) {}
                            safeDiagLog('info', 'PROCESS_MULTIPLE_MSGS_DONE', {
                                chatId: chatId ? String(chatId) : null,
                                overwriteOption: overwriteOption,
                                origin: origin,
                                afterState: afterState,
                            });
                        }
                        return res;
                    }).catch(function(err) {
                        safeDiagLog('error', 'PROCESS_MULTIPLE_MSGS_ERROR', {
                            chatId: chatId ? String(chatId) : null,
                            overwriteOption: overwriteOption,
                            origin: origin,
                            error: err ? (err.message || String(err)) : 'unknown',
                            msgs: msgSummaries,
                        });
                        throw err;
                    });
                }
                return result;
            };
            safeDiagLog('debug', 'HOOK_OK', 'WAWebCollections.Msg.processMultipleMessages');
        }
    } catch(e) {
        safeDiagLog('warn', 'HOOK_FAIL', { hook: 'Msg.processMultipleMessages', reason: e ? (e.message || String(e)) : 'unknown' });
    }

    // --- Hook handlePlaceholderResendOperationRequestResponse for PDO response details ---
    try {
        window.injectToFunction({
            module: 'WAWebNonMessageDataRequestHandlerPlaceholderResend',
            function: 'handlePlaceholderResendOperationRequestResponse'
        }, function(func, ...args) {
            var results = args[0];
            var requestMsgKeys = args[1];
            var logData = {
                resultCount: results ? results.length : 0,
                requestMsgKeyCount: requestMsgKeys ? requestMsgKeys.length : 0,
            };
            try {
                if (requestMsgKeys && requestMsgKeys.length) {
                    logData.requestMsgIds = requestMsgKeys.slice(0, 10).map(function(k) {
                        return k ? (k.id || k._serialized || String(k)) : null;
                    });
                }
                if (results && results.length) {
                    logData.results = results.slice(0, 10).map(function(r, idx) {
                        var info = {
                            index: idx,
                            hasPlaceholderResponse: !!(r && r.placeholderMessageResendResponse),
                            hasMediaUploadResult: !!(r && r.mediaUploadResult),
                        };
                        if (r && r.placeholderMessageResendResponse) {
                            var pr = r.placeholderMessageResendResponse;
                            info.hasWebMessageInfoBytes = !!(pr.webMessageInfoBytes && pr.webMessageInfoBytes.length > 0);
                            info.webMessageInfoBytesLength = pr.webMessageInfoBytes ? pr.webMessageInfoBytes.length : 0;
                        }
                        return info;
                    });
                }
            } catch(e) { logData.parseError = String(e); }
            safeDiagLog('info', 'PDO_RESEND_RESPONSE', logData);
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(res) {
                    safeDiagLog('debug', 'PDO_RESEND_RESPONSE_DONE', {
                        requestMsgIds: logData.requestMsgIds,
                        success: true,
                    });
                    return res;
                }).catch(function(err) {
                    safeDiagLog('error', 'PDO_RESEND_RESPONSE_ERROR', {
                        requestMsgIds: logData.requestMsgIds,
                        error: err ? (err.message || String(err)) : 'unknown',
                    });
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    // NOTE: WAWebHandlePeerMsg does not exist in current WAWeb versions.
    // PDO responses are captured via handlePlaceholderResendOperationRequestResponse hook above.

    // --- Track ciphertext placeholder removal from Store.Msg ---
    try {
        var _MsgForRemove = window.require('WAWebCollections').Msg;
        if (_MsgForRemove) {
            _MsgForRemove.on('remove', function(msg) {
                try {
                    if (msg && (msg.type === 'ciphertext' || msg.subtype === 'fanout' || msg.subtype === 'hosted_unavailable_fanout' || msg.subtype === 'bot_unavailable_fanout')) {
                        var removeStack = '';
                        try { removeStack = new Error().stack.split('\n').slice(1, 8).join(' | '); } catch(_e) {}
                        safeDiagLog('warn', 'CIPHERTEXT_STORE_REMOVE', {
                            traceId: msg.id ? msg.id._serialized : '',
                            type: msg.type,
                            subtype: msg.subtype,
                            from: wid(msg.from),
                            to: wid(msg.to),
                            isNewMsg: !!msg.isNewMsg,
                            timestamp: msg.t,
                            stack: removeStack,
                        });
                    }
                } catch(e) {}
            });
            safeDiagLog('debug', 'HOOK_OK', 'Store.Msg.remove (ciphertext tracking)');
        }
    } catch(e) {}

    // --- Track ciphertext add events with full detail ---
    try {
        var _MsgForAdd = window.require('WAWebCollections').Msg;
        if (_MsgForAdd) {
            _MsgForAdd.on('add', function(msg) {
                try {
                    if (!msg || msg.type !== 'ciphertext') return;
                    if (window.__diag?.shouldSkipMsg?.(msg)) return;
                    safeDiagLog('info', 'CIPHERTEXT_STORE_ADD', {
                        traceId: msg.id ? msg.id._serialized : '',
                        from: wid(msg.from),
                        to: wid(msg.to),
                        subtype: msg.subtype || null,
                        isNewMsg: !!msg.isNewMsg,
                        timestamp: msg.t,
                        isPlaceholder: typeof msg.isPlaceholder === 'function' ? msg.isPlaceholder() : null,
                    });
                } catch(e) {}
            });
            safeDiagLog('debug', 'HOOK_OK', 'Store.Msg.add (ciphertext add tracking)');
        }
    } catch(e) {}

    // --- Hook generatePlaceholder to see exactly when placeholders are created ---
    try {
        window.injectToFunction({
            module: 'WAWebMsgProcessingApiUtils',
            function: 'generatePlaceholder'
        }, function(func, ...args) {
            var opts = args[0] || {};
            var msgInfo = opts.msgInfo;
            var placeholderType = opts.placeholderType;
            var placeholderAddReason = opts.placeholderAddReason;
            var msgMeta = opts.msgMeta || {};
            safeDiagLog('info', 'GENERATE_PLACEHOLDER', {
                traceId: msgInfo && msgInfo.id ? (msgInfo.id._serialized || msgInfo.id.id || '') : '',
                from: msgInfo ? wid(msgInfo.from || msgInfo.id?.remote) : null,
                type: msgInfo ? msgInfo.type : null,
                placeholderType: placeholderType,
                placeholderAddReason: placeholderAddReason,
                isUnavailable: !!msgMeta.isUnavailable,
                isHostedMsgUnavailable: !!msgMeta.isHostedMsgUnavailable,
                isViewOnceUnavailable: !!msgMeta.isViewOnceUnavailable,
            });
            return func.apply(this, args);
        });
    } catch(e) {}

    // --- Hook handlePlaceholderMsgsSeen to see what messages are sent for resend ---
    try {
        window.injectToFunction({
            module: 'WAWebNonMessageDataRequestPlaceholderMessageResendUtils',
            function: 'handlePlaceholderMsgsSeen'
        }, function(func, ...args) {
            var msgs = args[0];
            var flag = args[1];
            var eligible = [];
            try {
                if (msgs && msgs.length) {
                    for (var hi = 0; hi < msgs.length && hi < 20; hi++) {
                        var hm = msgs[hi];
                        eligible.push({
                            traceId: hm && hm.id ? (hm.id._serialized || '') : '',
                            type: hm ? hm.type : null,
                            subtype: hm ? hm.subtype : null,
                            timestamp: hm ? hm.t : null,
                        });
                    }
                }
            } catch(e) {}
            safeDiagLog('info', 'PLACEHOLDER_MSGS_SEEN', {
                totalCount: msgs ? msgs.length : 0,
                flag: flag,
                msgs: eligible,
            });
            return func.apply(this, args);
        });
    } catch(e) {}
};
