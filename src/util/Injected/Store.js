'use strict';

exports.ExposeStore = () => {
    /**
     * Helper function that compares between two WWeb versions. Its purpose is to help the developer to choose the correct code implementation depending on the comparison value and the WWeb version.
     * @param {string} lOperand The left operand for the WWeb version string to compare with
     * @param {string} operator The comparison operator
     * @param {string} rOperand The right operand for the WWeb version string to compare with
     * @returns {boolean} Boolean value that indicates the result of the comparison
     */
    window.compareWwebVersions = (lOperand, operator, rOperand) => {
        if (!['>', '>=', '<', '<=', '='].includes(operator)) {
            throw new class _ extends Error {
                constructor(m) { super(m); this.name = 'CompareWwebVersionsError'; }
            }('Invalid comparison operator is provided');

        }
        if (typeof lOperand !== 'string' || typeof rOperand !== 'string') {
            throw new class _ extends Error {
                constructor(m) { super(m); this.name = 'CompareWwebVersionsError'; }
            }('A non-string WWeb version type is provided');
        }

        lOperand = lOperand.replace(/-beta$/, '');
        rOperand = rOperand.replace(/-beta$/, '');

        while (lOperand.length !== rOperand.length) {
            lOperand.length > rOperand.length
                ? rOperand = rOperand.concat('0')
                : lOperand = lOperand.concat('0');
        }

        lOperand = Number(lOperand.replace(/\./g, ''));
        rOperand = Number(rOperand.replace(/\./g, ''));

        return (
            operator === '>' ? lOperand > rOperand :
                operator === '>=' ? lOperand >= rOperand :
                    operator === '<' ? lOperand < rOperand :
                        operator === '<=' ? lOperand <= rOperand :
                            operator === '=' ? lOperand === rOperand :
                                false
        );
    };

    window.Store = Object.assign({}, window.require('WAWebCollections'));
    window.Store.AppState = window.require('WAWebSocketModel').Socket;
    window.Store.BlockContact = window.require('WAWebBlockContactAction');
    window.Store.Conn = window.require('WAWebConnModel').Conn;
    window.Store.Cmd = window.require('WAWebCmd').Cmd;
    window.Store.DownloadManager = window.require('WAWebDownloadManager').downloadManager;
    window.Store.GroupQueryAndUpdate = window.require('WAWebGroupQueryJob').queryAndUpdateGroupMetadataById;
    window.Store.MediaPrep = window.require('WAWebPrepRawMedia');
    window.Store.MediaObject = window.require('WAWebMediaStorage');
    window.Store.MediaTypes = window.require('WAWebMmsMediaTypes');
    window.Store.MediaUpload = {
        ...window.require('WAWebMediaMmsV4Upload'),
        ...window.require('WAWebStartMediaUploadQpl')
    };
    window.Store.MediaUpdate = window.require('WAWebMediaUpdateMsg');
    window.Store.MsgKey = window.require('WAWebMsgKey');
    window.Store.OpaqueData = window.require('WAWebMediaOpaqueData');
    window.Store.QueryProduct = window.require('WAWebBizProductCatalogBridge');
    window.Store.QueryOrder = window.require('WAWebBizOrderBridge');
    window.Store.SendClear = window.require('WAWebChatClearBridge');
    window.Store.SendDelete = window.require('WAWebDeleteChatAction');
    window.Store.SendMessage = window.require('WAWebSendMsgChatAction');
    window.Store.EditMessage = window.require('WAWebSendMessageEditAction');
    window.Store.MediaDataUtils = window.require('WAWebMediaDataUtils');
    window.Store.BlobCache = window.require('WAWebMediaInMemoryBlobCache');
    window.Store.SendSeen = window.require('WAWebUpdateUnreadChatAction');
    window.Store.User = window.require('WAWebUserPrefsMeUser');
    window.Store.ContactMethods = {
        ...window.require('WAWebContactGetters'),
        ...window.require('WAWebFrontendContactGetters')
    };
    window.Store.UserConstructor = window.require('WAWebWid');
    window.Store.Validators = window.require('WALinkify');
    window.Store.WidFactory = window.require('WAWebWidFactory');
    window.Store.ProfilePic = window.require('WAWebContactProfilePicThumbBridge');
    window.Store.PresenceUtils = window.require('WAWebPresenceChatAction');
    window.Store.ChatState = window.require('WAWebChatStateBridge');
    window.Store.findCommonGroups = window.require('WAWebFindCommonGroupsContactAction').findCommonGroups;
    window.Store.ConversationMsgs = window.require('WAWebChatLoadMessages');
    window.Store.sendReactionToMsg = window.require('WAWebSendReactionMsgAction').sendReactionToMsg;
    window.Store.createOrUpdateReactionsModule = window.require('WAWebDBCreateOrUpdateReactions');
    window.Store.EphemeralFields = window.require('WAWebGetEphemeralFieldsMsgActionsUtils');
    window.Store.MsgActionChecks = window.require('WAWebMsgActionCapability');
    window.Store.QuotedMsg = window.require('WAWebQuotedMsgModelUtils');
    window.Store.LinkPreview = window.require('WAWebLinkPreviewChatAction');
    window.Store.Socket = window.require('WADeprecatedSendIq');
    window.Store.SocketWap = window.require('WAWap');
    window.Store.SearchContext = window.require('WAWebChatMessageSearch');
    window.Store.DrawerManager = window.require('WAWebDrawerManager').DrawerManager;
    window.Store.LidUtils = window.require('WAWebApiContact');
    window.Store.WidToJid = window.require('WAWebWidToJid');
    window.Store.JidToWid = window.require('WAWebJidToWid');
    window.Store.getMsgInfo = window.require('WAWebApiMessageInfoStore').queryMsgInfo;
    window.Store.QueryExist = window.require('WAWebQueryExistsJob').queryWidExists;
    window.Store.ReplyUtils = window.require('WAWebMsgReply');
    window.Store.BotSecret = window.require('WAWebBotMessageSecret');
    window.Store.BotProfiles = window.require('WAWebBotProfileCollection');
    window.Store.ContactCollection = window.require('WAWebContactCollection').ContactCollection;
    window.Store.DeviceList = window.require('WAWebApiDeviceList');
    window.Store.HistorySync = window.require('WAWebSendNonMessageDataRequest');
    window.Store.AddonReactionTable = window.require('WAWebAddonReactionTableMode').reactionTableMode;
    window.Store.AddonPollVoteTable = window.require('WAWebAddonPollVoteTableMode').pollVoteTableMode;
    window.Store.ChatGetters = window.require('WAWebChatGetters');
    window.Store.UploadUtils = window.require('WAWebUploadManager');
    window.Store.WAWebStreamModel = window.require('WAWebStreamModel');
    window.Store.FindOrCreateChat = window.require('WAWebFindChatAction');
    window.Store.CustomerNoteUtils = window.require('WAWebNoteAction');
    window.Store.BusinessGatingUtils = window.require('WAWebBizGatingUtils');
    window.Store.PollsVotesSchema = window.require('WAWebPollsVotesSchema');
    window.Store.PollsSendVote = window.require('WAWebPollsSendVoteMsgAction');

    window.Store.Settings = {
        ...window.require('WAWebUserPrefsGeneral'),
        ...window.require('WAWebUserPrefsNotifications'),
        setPushname: window.require('WAWebSetPushnameConnAction').setPushname
    };
    window.Store.NumberInfo = {
        ...window.require('WAPhoneUtils'),
        ...window.require('WAPhoneFindCC'),
        ...window.require('WAWebPhoneUtils')
    };
    window.Store.ForwardUtils = {
        ...window.require('WAWebChatForwardMessage')
    };
    window.Store.PinnedMsgUtils = {
        ...window.require('WAWebPinInChatSchema'),
        ...window.require('WAWebSendPinMessageAction')
    };
    window.Store.ScheduledEventMsgUtils = {
        ...window.require('WAWebGenerateEventCallLink'),
        ...window.require('WAWebSendEventEditMsgAction'),
        ...window.require('WAWebSendEventResponseMsgAction')
    };
    window.Store.VCard = {
        ...window.require('WAWebFrontendVcardUtils'),
        ...window.require('WAWebVcardParsingUtils'),
        ...window.require('WAWebVcardGetNameFromParsed')
    };
    window.Store.StickerTools = {
        ...window.require('WAWebImageUtils'),
        ...window.require('WAWebAddWebpMetadata')
    };
    window.Store.GroupUtils = {
        ...window.require('WAWebGroupCreateJob'),
        ...window.require('WAWebGroupModifyInfoJob'),
        ...window.require('WAWebExitGroupAction'),
        ...window.require('WAWebContactProfilePicThumbBridge'),
        ...window.require('WAWebSetPropertyGroupAction')
    };
    window.Store.GroupParticipants = {
        ...window.require('WAWebModifyParticipantsGroupAction'),
        ...window.require('WASmaxGroupsAddParticipantsRPC')
    };
    window.Store.GroupInvite = {
        ...window.require('WAWebGroupInviteJob'),
        ...window.require('WAWebGroupQueryJob'),
        ...window.require('WAWebMexFetchGroupInviteCodeJob')
    };
    window.Store.GroupInviteV4 = {
        ...window.require('WAWebGroupInviteV4Job'),
        ...window.require('WAWebChatSendMessages')
    };
    window.Store.MembershipRequestUtils = {
        ...window.require('WAWebApiMembershipApprovalRequestStore'),
        ...window.require('WASmaxGroupsMembershipRequestsActionRPC')
    };
    window.Store.ChannelUtils = {
        ...window.require('WAWebLoadNewsletterPreviewChatAction'),
        ...window.require('WAWebNewsletterMetadataQueryJob'),
        ...window.require('WAWebNewsletterCreateQueryJob'),
        ...window.require('WAWebEditNewsletterMetadataAction'),
        ...window.require('WAWebNewsletterDeleteAction'),
        ...window.require('WAWebNewsletterSubscribeAction'),
        ...window.require('WAWebNewsletterUnsubscribeAction'),
        ...window.require('WAWebNewsletterDirectorySearchAction'),
        ...window.require('WAWebNewsletterGatingUtils'),
        ...window.require('WAWebNewsletterModelUtils'),
        ...window.require('WAWebMexAcceptNewsletterAdminInviteJob'),
        ...window.require('WAWebMexRevokeNewsletterAdminInviteJob'),
        ...window.require('WAWebChangeNewsletterOwnerAction'),
        ...window.require('WAWebDemoteNewsletterAdminAction'),
        ...window.require('WAWebNewsletterDemoteAdminJob'),
        countryCodesIso: window.require('WAWebCountriesNativeCountryNames'),
        currentRegion: window.require('WAWebL10N').getRegion(),
    };
    window.Store.SendChannelMessage = {
        ...window.require('WAWebNewsletterUpdateMsgsRecordsJob'),
        ...window.require('WAWebMsgDataFromModel'),
        ...window.require('WAWebNewsletterSendMessageJob'),
        ...window.require('WAWebNewsletterSendMsgAction'),
        ...window.require('WAMediaCalculateFilehash')
    };
    window.Store.ChannelSubscribers = {
        ...window.require('WAWebMexFetchNewsletterSubscribersJob'),
        ...window.require('WAWebNewsletterSubscriberListAction')
    };
    window.Store.AddressbookContactUtils = {
        ...window.require('WAWebSaveContactAction'),
        ...window.require('WAWebDeleteContactAction')
    };
    window.Store.StatusUtils = {
        ...window.require('WAWebContactStatusBridge'),
        ...window.require('WAWebSendStatusMsgAction'),
        ...window.require('WAWebRevokeStatusAction'),
        ...window.require('WAWebStatusGatingUtils')
    };

    if (!window.Store.Chat._find || !window.Store.Chat.findImpl) {
        window.Store.Chat._find = e => {
            const target = window.Store.Chat.get(e);
            return target ? Promise.resolve(target) : Promise.resolve({
                id: e
            });
        };
        window.Store.Chat.findImpl = window.Store.Chat._find;
    }

    /**
     * Target options object description
     * @typedef {Object} TargetOptions
     * @property {string|number} module The target module
     * @property {string} function The function name to get from a module
     */
    /**
     * Function to modify functions
     * @param {TargetOptions} target Options specifying the target function to search for modifying
     * @param {Function} callback Modified function
     */
    window.injectToFunction = (target, callback) => {
        try {
            let module = window.require(target.module);
            if (!module) return; 

            const path = target.function.split('.');
            const funcName = path.pop();

            for (const key of path) {
                if (!module[key]) return;
                module = module[key];
            }

            const originalFunction = module[funcName];
            if (typeof originalFunction !== 'function') return;

            module[funcName] = function(...args) {
                try {
                    return callback(originalFunction.bind(this), ...args);
                } catch {
                    return originalFunction.apply(this, args);
                }
            };

        } catch {
            return;
        }
    };

    window.injectToFunction({ module: 'WAWebBackendJobsCommon', function: 'mediaTypeFromProtobuf' }, (func, ...args) => { const [proto] = args; return proto.locationMessage ? null : func(...args); });

    window.injectToFunction({ module: 'WAWebE2EProtoUtils', function: 'typeAttributeFromProtobuf' }, (func, ...args) => { const [proto] = args; return proto.locationMessage || proto.groupInviteMessage ? 'text' : func(...args); });

    function wid(v) {
        if (v == null) return null;
        if (typeof v === 'string') return v;
        return v._serialized || v.user || null;
    }

    function safeStr(v) {
        if (v == null) return String(v);
        if (typeof v !== 'object') return String(v);
        try {
            var s = JSON.stringify(v);
            return s.length > 500 ? s.slice(0, 500) + '...' : s;
        } catch (e) { return String(v); }
    }

    window.injectToFunction({ module: 'WAWebSendRetryReceiptJob', function: 'sendRetryReceipt' }, function(func, ...args) {
        var params = args[0] || {};
        window.onDiagLog('debug', 'RETRY_RECEIPT_SENT', JSON.stringify({
            externalId: params.externalId,
            to: wid(params.to),
            retryCount: params.retryCount,
            retryReason: params.retryReason,
            isPeer: params.isPeer,
        }));
        return func.apply(this, args);
    });

    window.injectToFunction({ module: 'WAWebHandleMsgSendReceipt', function: 'sendReceipt' }, function(func, ...args) {
        var receipt = args[0] || {};
        var msgInfo = args[1];
        var decryptResult = args[2];
        var from = wid(receipt.senderPn) || wid(receipt.participant) || wid(receipt.senderLid) || wid(receipt.peerRecipientPn) || wid(receipt.peerRecipientLid) || wid(receipt.from);
        var participant = wid(receipt.participant);
        var resultStr = safeStr(decryptResult);
        var logData = {
            msgId: receipt.externalId,
            from: from,
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
        window.onDiagLog('debug', 'DECRYPT_RECEIPT_DECISION', JSON.stringify(logData));
        return func.apply(this, args);
    });

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
        window.onDiagLog('debug', 'IDENTITY_CHANGE', JSON.stringify({
            from: from,
            participant: participant !== from ? participant : null,
            argCount: args.length,
            arg0Keys: arg0Keys.join(','),
            arg0Raw: safeStr(node),
        }));
        return func.apply(this, args);
    });

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
        var startTime = Date.now();
        var result = func.apply(this, args);
        if (result && typeof result.then === 'function') {
            return result.then(function(res) {
                window.onDiagLog('debug', 'ENC_MSG_RESULT', JSON.stringify({
                    traceId: traceId,
                    sender: senderJid,
                    encType: encType,
                    elapsed: Date.now() - startTime,
                }));
                return res;
            }).catch(function(err) {
                window.onDiagLog('error', 'ENC_MSG_FAIL', JSON.stringify({
                    traceId: traceId,
                    sender: senderJid,
                    encType: encType,
                    elapsed: Date.now() - startTime,
                    error: err ? (err.message || String(err)) : 'unknown',
                    errorName: err ? err.name : null,
                }));
                throw err;
            });
        }
        return result;
    });

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
        window.onDiagLog('debug', 'PEER_MSG', JSON.stringify({ msgType: msgType, details: details }));
        var result = func.apply(this, args);
        if (result && typeof result.then === 'function') {
            return result.catch(function(err) {
                window.onDiagLog('error', 'PEER_MSG_ERROR', JSON.stringify({
                    msgType: msgType,
                    error: err ? (err.message || String(err)) : 'unknown',
                }));
                throw err;
            });
        }
        return result;
    });

    try {
        window.injectToFunction({ module: 'WAWebSendNonMessageDataRequest', function: 'sendPeerDataOperationRequest' }, function(func, ...args) {
            var requestType = args[0];
            window.onDiagLog('debug', 'PDO_REQUEST_SENT', JSON.stringify({
                requestType: requestType,
                params: safeStr(args[1]),
            }));
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(res) {
                    window.onDiagLog('debug', 'PDO_REQUEST_ACK', JSON.stringify({ requestType: requestType }));
                    return res;
                }).catch(function(err) {
                    window.onDiagLog('error', 'PDO_REQUEST_FAIL', JSON.stringify({
                        requestType: requestType,
                        error: err ? (err.message || String(err)) : 'unknown',
                    }));
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    var signalFns = ['decryptSignalProto', 'decrypt', 'decryptWithSession'];
    for (var si = 0; si < signalFns.length; si++) {
        try {
            (function(fnName) {
                window.injectToFunction({ module: 'WAWebSignal', function: fnName }, function(func, ...args) {
                    var result;
                    try { result = func.apply(this, args); } catch(err) {
                        window.onDiagLog('error', 'SIGNAL_DECRYPT_ERROR', JSON.stringify({
                            op: fnName, error: err ? (err.message || String(err)) : 'unknown',
                        }));
                        throw err;
                    }
                    if (result && typeof result.then === 'function') {
                        return result.catch(function(err) {
                            window.onDiagLog('error', 'SIGNAL_DECRYPT_ERROR', JSON.stringify({
                                op: fnName, error: err ? (err.message || String(err)) : 'unknown',
                            }));
                            throw err;
                        });
                    }
                    return result;
                });
            })(signalFns[si]);
        } catch(e) {}
    }

    var sessionFns = ['manageE2ESessions', 'ensureE2ESession', 'getOrCreateSession', 'createSession'];
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
                    window.onDiagLog('debug', 'E2E_SESSION_OP', JSON.stringify({ op: fnName, jid: jid }));
                    var result = func.apply(this, args);
                    if (result && typeof result.then === 'function') {
                        return result.catch(function(err) {
                            window.onDiagLog('error', 'E2E_SESSION_ERROR', JSON.stringify({
                                op: fnName, jid: jid, error: err ? (err.message || String(err)) : 'unknown',
                            }));
                            throw err;
                        });
                    }
                    return result;
                });
            })(sessionFns[ei]);
        } catch(e) {}
    }

    try {
        window.injectToFunction({ module: 'WAWebSenderKeyMsgHandler', function: 'handleSenderKeyMsg' }, function(func, ...args) {
            var stanza = args[0];
            var traceId = stanza && stanza.attrs ? stanza.attrs.id : '';
            var sender = stanza && stanza.attrs ? (stanza.attrs.participant || stanza.attrs.from || '') : '';
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.catch(function(err) {
                    window.onDiagLog('error', 'SENDER_KEY_FAIL', JSON.stringify({
                        traceId: traceId, sender: sender,
                        error: err ? (err.message || String(err)) : 'unknown',
                    }));
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    try {
        window.injectToFunction({ module: 'WAWebMediaDownloadUtils', function: 'downloadMediaBlob' }, function(func, ...args) {
            var startTime = Date.now();
            var url = '';
            try { url = typeof args[0] === 'string' ? args[0].slice(0, 100) : (args[0] && args[0].directPath ? args[0].directPath.slice(0, 100) : ''); } catch(e) {}
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(res) {
                    window.onDiagLog('debug', 'MEDIA_DOWNLOAD_OK', JSON.stringify({
                        elapsed: Date.now() - startTime,
                        url: url,
                        size: res ? (res.byteLength || res.size || res.length || 0) : 0,
                    }));
                    return res;
                }).catch(function(err) {
                    window.onDiagLog('error', 'MEDIA_DOWNLOAD_FAIL', JSON.stringify({
                        elapsed: Date.now() - startTime,
                        url: url,
                        error: err ? (err.message || String(err)) : 'unknown',
                    }));
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    try {
        window.injectToFunction({ module: 'WAWebMediaDownloadUtils', function: 'downloadMedia' }, function(func, ...args) {
            var startTime = Date.now();
            var directPath = '';
            try { directPath = (args[0] && args[0].directPath) ? args[0].directPath.slice(0, 100) : ''; } catch(e) {}
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(res) {
                    window.onDiagLog('debug', 'MEDIA_DOWNLOAD2_OK', JSON.stringify({
                        elapsed: Date.now() - startTime, directPath: directPath,
                    }));
                    return res;
                }).catch(function(err) {
                    window.onDiagLog('error', 'MEDIA_DOWNLOAD2_FAIL', JSON.stringify({
                        elapsed: Date.now() - startTime, directPath: directPath,
                        error: err ? (err.message || String(err)) : 'unknown',
                    }));
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    try {
        window.injectToFunction({ module: 'WAWebPreKeyUtils', function: 'getOrGenPreKeys' }, function(func, ...args) {
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then(function(res) {
                    var count = Array.isArray(res) ? res.length : (res ? 1 : 0);
                    window.onDiagLog('debug', 'PREKEY_GET', JSON.stringify({ count: count }));
                    return res;
                }).catch(function(err) {
                    window.onDiagLog('error', 'PREKEY_GET_FAIL', JSON.stringify({
                        error: err ? (err.message || String(err)) : 'unknown',
                    }));
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    try {
        window.injectToFunction({ module: 'WAWebPreKeyUtils', function: 'uploadPreKeys' }, function(func, ...args) {
            window.onDiagLog('debug', 'PREKEY_UPLOAD', JSON.stringify({ count: Array.isArray(args[0]) ? args[0].length : 0 }));
            var result = func.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.catch(function(err) {
                    window.onDiagLog('error', 'PREKEY_UPLOAD_FAIL', JSON.stringify({
                        error: err ? (err.message || String(err)) : 'unknown',
                    }));
                    throw err;
                });
            }
            return result;
        });
    } catch(e) {}

    try {
        window.injectToFunction({ module: 'WAWebDeleteSessionJob', function: 'deleteRemoteSession' }, function(func, ...args) {
            var jid = '';
            try { jid = wid(args[0]) || safeStr(args[0]); } catch(e) {}
            window.onDiagLog('warn', 'SESSION_DELETE', JSON.stringify({ jid: jid }));
            return func.apply(this, args);
        });
    } catch(e) {}

    try {
        window.injectToFunction({ module: 'WAWebSocket', function: 'sendData' }, function(func, ...args) {
            return func.apply(this, args);
        });
    } catch(e) {}

    try {
        var connMods = ['WAWebSocketConnectModel', 'WAWebSocketModel'];
        for (var ci = 0; ci < connMods.length; ci++) {
            try {
                window.injectToFunction({ module: connMods[ci], function: 'onSocketClose' }, function(func, ...args) {
                    var code = args[0];
                    var reason = args[1];
                    window.onDiagLog('warn', 'SOCKET_CLOSE', JSON.stringify({
                        code: code, reason: typeof reason === 'string' ? reason.slice(0, 200) : String(reason),
                    }));
                    return func.apply(this, args);
                });
            } catch(e) {}
        }
    } catch(e) {}

    try {
        window.injectToFunction({ module: 'WAWebHistorySyncJobUtils', function: 'processHistorySyncData' }, function(func, ...args) {
            var data = args[0];
            var msgCount = 0;
            try {
                if (data && data.conversations) {
                    for (var hi = 0; hi < data.conversations.length; hi++) {
                        msgCount += (data.conversations[hi].messages || []).length;
                    }
                }
            } catch(e) {}
            window.onDiagLog('debug', 'HISTORY_SYNC_PROCESS', JSON.stringify({
                conversationCount: data && data.conversations ? data.conversations.length : 0,
                msgCount: msgCount,
                syncType: data ? data.syncType : null,
                progress: data ? data.progress : null,
            }));
            return func.apply(this, args);
        });
    } catch(e) {}

    try {
        window.injectToFunction({ module: 'WAWebMsgDeleteCollection', function: 'sendRevoke' }, function(func, ...args) {
            var msg = args[0];
            window.onDiagLog('debug', 'MSG_REVOKE', JSON.stringify({
                id: msg && msg.id ? msg.id._serialized : '',
                from: msg ? wid(msg.from) : null,
                type: msg ? msg.type : null,
            }));
            return func.apply(this, args);
        });
    } catch(e) {}
};
