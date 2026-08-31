'use strict';

exports.LoadUtils = () => {
    window.WWebJS = {};

    /**
     * Helper function that compares between two WWeb versions. Its purpose is to help the developer to choose the correct code implementation depending on the comparison value and the WWeb version.
     * @param {string} lOperand The left operand for the WWeb version string to compare with
     * @param {string} operator The comparison operator
     * @param {string} rOperand The right operand for the WWeb version string to compare with
     * @returns {boolean} Boolean value that indicates the result of the comparison
     */
    window.WWebJS.compareWwebVersions = (lOperand, operator, rOperand) => {
        if (!['>', '>=', '<', '<=', '='].includes(operator)) {
            throw new (class _ extends Error {
                constructor(m) {
                    super(m);
                    this.name = 'CompareWwebVersionsError';
                }
            })('Invalid comparison operator is provided');
        }
        if (typeof lOperand !== 'string' || typeof rOperand !== 'string') {
            throw new (class _ extends Error {
                constructor(m) {
                    super(m);
                    this.name = 'CompareWwebVersionsError';
                }
            })('A non-string WWeb version type is provided');
        }

        lOperand = lOperand.replace(/-beta$/, '');
        rOperand = rOperand.replace(/-beta$/, '');

        while (lOperand.length !== rOperand.length) {
            lOperand.length > rOperand.length
                ? (rOperand = rOperand.concat('0'))
                : (lOperand = lOperand.concat('0'));
        }

        lOperand = Number(lOperand.replace(/\./g, ''));
        rOperand = Number(rOperand.replace(/\./g, ''));

        return operator === '>'
            ? lOperand > rOperand
            : operator === '>='
              ? lOperand >= rOperand
              : operator === '<'
                ? lOperand < rOperand
                : operator === '<='
                  ? lOperand <= rOperand
                  : operator === '='
                    ? lOperand === rOperand
                    : false;
    };

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
    window.WWebJS.injectToFunction = (target, callback) => {
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

            module[funcName] = ((...args) => {
                try {
                    return callback(module, originalFunction, ...args);
                } catch {
                    return originalFunction.apply(module, args);
                }
            }).bind(module);
        } catch {
            return;
        }
    };

    window.WWebJS.injectToFunction(
        { module: 'WAWebBackendJobsCommon', function: 'mediaTypeFromProtobuf' },
        (module, func, ...args) => {
            const [proto] = args;
            return proto.locationMessage ? null : func(...args);
        },
    );

    window.WWebJS.injectToFunction(
        { module: 'WAWebE2EProtoUtils', function: 'typeAttributeFromProtobuf' },
        (module, func, ...args) => {
            const [proto] = args;
            return proto.locationMessage || proto.groupInviteMessage
                ? 'text'
                : func(...args);
        },
    );

    window.WWebJS.forwardMessage = async (chatId, msgId) => {
        const msg =
            window.require('WAWebCollections').Msg.get(msgId) ||
            (
                await window
                    .require('WAWebCollections')
                    .Msg.getMessagesById([msgId])
            )?.messages?.[0];
        const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        return await window.require('WAWebChatForwardMessage').forwardMessages({
            chat: chat,
            msgs: [msg],
            multicast: true,
            includeCaption: true,
            appendedText: undefined,
        });
    };

    window.WWebJS.sendSeen = async (chatId) => {
        const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        if (chat) {
            window.require('WAWebStreamModel').Stream.markAvailable();
            await window.require('WAWebUpdateUnreadChatAction').sendSeen({
                chat: chat,
                threadId: undefined,
            });
            window.require('WAWebStreamModel').Stream.markUnavailable();
            return true;
        }
        return false;
    };

    window.WWebJS.sendMessage = async (chat, content, options = {}) => {
        const { getIsNewsletter, getIsBroadcast } =
            window.require('WAWebChatGetters');
        const isChannel = getIsNewsletter(chat);
        const isStatus = getIsBroadcast(chat);

        const { findLink } = window.require('WALinkify');

        let mediaOptions = {};
        if (options.media) {
            mediaOptions =
                options.sendMediaAsSticker && !isChannel && !isStatus
                    ? await window.WWebJS.processStickerData(options.media)
                    : await window.WWebJS.processMediaData(options.media, {
                          forceSticker: options.sendMediaAsSticker,
                          forceGif: options.sendVideoAsGif,
                          forceVoice: options.sendAudioAsVoice,
                          forceDocument: options.sendMediaAsDocument,
                          forceMediaHd: options.sendMediaAsHd,
                          sendToChannel: isChannel,
                          sendToStatus: isStatus,
                      });
            mediaOptions.caption = options.caption;
            content = options.sendMediaAsSticker
                ? undefined
                : mediaOptions.preview;
            mediaOptions.isViewOnce = options.isViewOnce;
            delete options.media;
            delete options.sendMediaAsSticker;
        }

        let quotedMsgOptions = {};
        if (options.quotedMessageId) {
            let quotedMessage = window
                .require('WAWebCollections')
                .Msg.get(options.quotedMessageId);
            !quotedMessage &&
                (quotedMessage = (
                    await window
                        .require('WAWebCollections')
                        .Msg.getMessagesById([options.quotedMessageId])
                )?.messages?.[0]);
            if (quotedMessage) {
                const ReplyUtils = window.require('WAWebMsgReply');
                const canReply = ReplyUtils
                    ? ReplyUtils.canReplyMsg(quotedMessage.unsafe())
                    : quotedMessage.canReply();

                if (canReply) {
                    quotedMsgOptions = quotedMessage.msgContextInfo(chat);
                }
            } else {
                if (!options.ignoreQuoteErrors) {
                    throw new Error('Could not get the quoted message.');
                }
            }

            delete options.ignoreQuoteErrors;
            delete options.quotedMessageId;
        }

        if (options.mentionedJidList) {
            options.mentionedJidList = options.mentionedJidList.map((id) =>
                window.require('WAWebWidFactory').createWid(id),
            );
            options.mentionedJidList = options.mentionedJidList.filter(Boolean);
        }

        if (options.groupMentions) {
            options.groupMentions = options.groupMentions.map((e) => ({
                groupSubject: e.subject,
                groupJid: window.require('WAWebWidFactory').createWid(e.id),
            }));
        }

        let locationOptions = {};
        if (options.location) {
            let { latitude, longitude, description, url } = options.location;
            url = findLink(url)?.href;
            url && !description && (description = url);
            locationOptions = {
                type: 'location',
                loc: description,
                lat: latitude,
                lng: longitude,
                clientUrl: url,
            };
            delete options.location;
        }

        let pollOptions = {};
        if (options.poll) {
            const { pollName, pollOptions: _pollOptions } = options.poll;
            const { allowMultipleAnswers, messageSecret } =
                options.poll.options;
            pollOptions = {
                kind: 'pollCreation',
                type: 'poll_creation',
                pollName: pollName,
                pollOptions: _pollOptions,
                pollSelectableOptionsCount: allowMultipleAnswers ? 0 : 1,
                messageSecret:
                    Array.isArray(messageSecret) && messageSecret.length === 32
                        ? new Uint8Array(messageSecret)
                        : window.crypto.getRandomValues(new Uint8Array(32)),
            };
            delete options.poll;
        }

        let eventOptions = {};
        if (options.event) {
            const { name, startTimeTs, eventSendOptions } = options.event;
            const { messageSecret } = eventSendOptions;
            eventOptions = {
                type: 'event_creation',
                eventName: name,
                eventDescription: eventSendOptions.description,
                eventStartTime: startTimeTs,
                eventEndTime: eventSendOptions.endTimeTs,
                eventLocation: eventSendOptions.location && {
                    degreesLatitude: 0,
                    degreesLongitude: 0,
                    name: eventSendOptions.location,
                },
                eventJoinLink:
                    eventSendOptions.callType === 'none'
                        ? null
                        : await window
                              .require('WAWebGenerateEventCallLink')
                              .createEventCallLink(
                                  startTimeTs,
                                  eventSendOptions.callType,
                              ),
                isEventCanceled: eventSendOptions.isEventCanceled,
                messageSecret:
                    Array.isArray(messageSecret) && messageSecret.length === 32
                        ? new Uint8Array(messageSecret)
                        : window.crypto.getRandomValues(new Uint8Array(32)),
            };
            delete options.event;
        }

        let vcardOptions = {};
        if (options.contactCard) {
            let contact = await window
                .require('WAWebCollections')
                .Contact.find(options.contactCard);
            vcardOptions = {
                body: window
                    .require('WAWebFrontendVcardUtils')
                    .vcardFromContactModel(contact).vcard,
                type: 'vcard',
                vcardFormattedName: contact.formattedName,
            };
            delete options.contactCard;
        } else if (options.contactCardList) {
            let contacts = await Promise.all(
                options.contactCardList.map((c) =>
                    window.require('WAWebCollections').Contact.find(c),
                ),
            );
            let vcards = contacts.map((c) =>
                window
                    .require('WAWebFrontendVcardUtils')
                    .vcardFromContactModel(c),
            );
            vcardOptions = {
                type: 'multi_vcard',
                vcardList: vcards,
                body: null,
            };
            delete options.contactCardList;
        } else if (
            options.parseVCards &&
            typeof content === 'string' &&
            content.startsWith('BEGIN:VCARD')
        ) {
            delete options.parseVCards;
            delete options.linkPreview;
            try {
                const parsed = window
                    .require('WAWebVcardParsingUtils')
                    .parseVcard(content);
                if (parsed) {
                    vcardOptions = {
                        type: 'vcard',
                        vcardFormattedName: window
                            .require('WAWebVcardGetNameFromParsed')
                            .vcardGetNameFromParsed(parsed),
                    };
                }
            } catch (_) {
                // not a vcard
            }
        }

        if (options.linkPreview) {
            delete options.linkPreview;
            const link = findLink(content);
            if (link) {
                let preview = await window
                    .require('WAWebLinkPreviewChatAction')
                    .getLinkPreview(link);
                if (preview && preview.data) {
                    preview = preview.data;
                    preview.preview = true;
                    preview.subtype = 'url';
                    options = { ...options, ...preview };
                }
            }
        }

        let buttonOptions = {};
        if (options.buttons) {
            let caption;
            if (options.buttons.type === 'chat') {
                content = options.buttons.body;
                caption = content;
            } else {
                caption = options.caption ? options.caption : ' '; //Caption can't be empty
            }
            buttonOptions = {
                productHeaderImageRejected: false,
                isFromTemplate: false,
                isDynamicReplyButtonsMsg: true,
                title: options.buttons.title
                    ? options.buttons.title
                    : undefined,
                footer: options.buttons.footer
                    ? options.buttons.footer
                    : undefined,
                dynamicReplyButtons: options.buttons.buttons,
                replyButtons: options.buttons.buttons,
                caption: caption,
            };
            delete options.buttons;
        }

        let listOptions = {};
        if (options.list) {
            if (
                window.require('WAWebConnModel').Conn.platform === 'smba' ||
                window.require('WAWebConnModel').Conn.platform === 'smbi'
            ) {
                throw "[LT01] Whatsapp business can't send this yet";
            }
            listOptions = {
                type: 'list',
                footer: options.list.footer,
                list: {
                    ...options.list,
                    listType: 1,
                },
                body: options.list.description,
            };
            delete options.list;
            delete listOptions.list.footer;
        }

        const botOptions = {};
        if (options.invokedBotWid) {
            botOptions.messageSecret = window.crypto.getRandomValues(
                new Uint8Array(32),
            );
            botOptions.botMessageSecret = await window
                .require('WAWebBotMessageSecret')
                .genBotMsgSecretFromMsgSecret(botOptions.messageSecret);
            botOptions.invokedBotWid = window
                .require('WAWebWidFactory')
                .createWid(options.invokedBotWid);
            botOptions.botPersonaId = window
                .require('WAWebBotProfileCollection')
                .BotProfileCollection.get(options.invokedBotWid).personaId;
            delete options.invokedBotWid;
        }
        const { getMaybeMeLidUser, getMaybeMePnUser } = window.require(
            'WAWebUserPrefsMeUser',
        );
        const lidUser = getMaybeMeLidUser();
        const meUser = getMaybeMePnUser();
        const newId = await window.require('WAWebMsgKey').newId();
        let from = chat.id.isLid() ? lidUser : meUser;
        let participant;

        if (typeof chat.id?.isGroup === 'function' && chat.id.isGroup()) {
            from =
                chat.groupMetadata && chat.groupMetadata.isLidAddressingMode
                    ? lidUser
                    : meUser;
            participant = window
                .require('WAWebWidFactory')
                .asUserWidOrThrow(from);
        }

        if (typeof chat.id?.isStatus === 'function' && chat.id.isStatus()) {
            participant = window
                .require('WAWebWidFactory')
                .asUserWidOrThrow(from);
        }

        const newMsgKey = new (window.require('WAWebMsgKey'))({
            from: from,
            to: chat.id,
            id: newId,
            participant: participant,
            selfDir: 'out',
        });

        const extraOptions = options.extraOptions || {};
        delete options.extraOptions;

        const ephemeralFields = window
            .require('WAWebGetEphemeralFieldsMsgActionsUtils')
            .getEphemeralFields(chat);

        const message = {
            ...options,
            id: newMsgKey,
            ack: 0,
            body: content,
            from: from,
            to: chat.id,
            local: true,
            self: 'out',
            t: parseInt(new Date().getTime() / 1000),
            isNewMsg: true,
            type: 'chat',
            ...ephemeralFields,
            ...mediaOptions,
            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),
            ...quotedMsgOptions,
            ...locationOptions,
            ...pollOptions,
            ...eventOptions,
            ...vcardOptions,
            ...buttonOptions,
            ...listOptions,
            ...botOptions,
            ...extraOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)
        if (botOptions) {
            delete message.canonicalUrl;
        }

        if (isChannel) {
            const msg = new (window.require('WAWebCollections').Msg.modelClass)(
                message,
            );
            const msgDataFromMsgModel = window
                .require('WAWebMsgDataFromModel')
                .msgDataFromMsgModel(msg);
            const isMedia = Object.keys(mediaOptions).length > 0;
            await window
                .require('WAWebNewsletterUpdateMsgsRecordsJob')
                .addNewsletterMsgsRecords([msgDataFromMsgModel]);
            chat.msgs.add(msg);
            chat.t = msg.t;

            const sendChannelMsgResponse = await window
                .require('WAWebNewsletterSendMessageJob')
                .sendNewsletterMessageJob({
                    msg: msg,
                    type:
                        message.type === 'chat'
                            ? 'text'
                            : isMedia
                              ? 'media'
                              : 'pollCreation',
                    newsletterJid: chat.id.toJid(),
                    ...(isMedia
                        ? {
                              mediaMetadata: msg.avParams(),
                              mediaHandle: isMedia
                                  ? mediaOptions.mediaHandle
                                  : null,
                          }
                        : {}),
                });

            if (sendChannelMsgResponse.success) {
                msg.t = sendChannelMsgResponse.ack.t;
                msg.serverId = sendChannelMsgResponse.serverId;
            }
            msg.updateAck(1, true);
            await window
                .require('WAWebNewsletterUpdateMsgsRecordsJob')
                .updateNewsletterMsgRecord(msg);
            return msg;
        }

        if (isStatus) {
            const { backgroundColor, fontStyle } = extraOptions;
            const isMedia = Object.keys(mediaOptions).length > 0;
            const mediaUpdate = (data) =>
                window.require('WAWebMediaUpdateMsg')(data, mediaOptions);
            const msg = new (window.require('WAWebCollections').Msg.modelClass)(
                {
                    ...message,
                    author: participant ? participant : null,
                    messageSecret: window.crypto.getRandomValues(
                        new Uint8Array(32),
                    ),
                    cannotBeRanked: window
                        .require('WAWebStatusGatingUtils')
                        .canCheckStatusRankingPosterGating(),
                },
            );

            // for text only
            const statusOptions = {
                color:
                    (backgroundColor &&
                        window.WWebJS.assertColor(backgroundColor)) ||
                    0xff7acca5,
                font: (fontStyle >= 0 && fontStyle <= 7 && fontStyle) || 0,
                text: msg.body,
            };

            await window
                .require('WAWebSendStatusMsgAction')
                [
                    isMedia
                        ? 'sendStatusMediaMsgAction'
                        : 'sendStatusTextMsgAction'
                ](...(isMedia ? [msg, mediaUpdate] : [statusOptions]));

            return msg;
        }

        const [msgPromise, sendMsgResultPromise] = window
            .require('WAWebSendMsgChatAction')
            .addAndSendMsgToChat(chat, message);
        await msgPromise;

        if (options.waitUntilMsgSent) await sendMsgResultPromise;

        return window
            .require('WAWebCollections')
            .Msg.get(newMsgKey._serialized || newMsgKey.$1);
    };

    window.WWebJS.editMessage = async (msg, content, options = {}) => {
        const extraOptions = options.extraOptions || {};
        delete options.extraOptions;

        if (options.mentionedJidList) {
            options.mentionedJidList = options.mentionedJidList.map((id) =>
                window.require('WAWebWidFactory').createWid(id),
            );
            options.mentionedJidList = options.mentionedJidList.filter(Boolean);
        }

        if (options.groupMentions) {
            options.groupMentions = options.groupMentions.map((e) => ({
                groupSubject: e.subject,
                groupJid: window.require('WAWebWidFactory').createWid(e.id),
            }));
        }

        if (options.linkPreview) {
            const { findLink } = window.require('WALinkify');
            delete options.linkPreview;
            const link = findLink(content);
            if (link) {
                const preview = await window
                    .require('WAWebLinkPreviewChatAction')
                    .getLinkPreview(link);
                preview.preview = true;
                preview.subtype = 'url';
                options = { ...options, ...preview };
            }
        }

        const internalOptions = {
            ...options,
            ...extraOptions,
        };

        await window
            .require('WAWebSendMessageEditAction')
            .sendMessageEdit(msg, content, internalOptions);
        return window
            .require('WAWebCollections')
            .Msg.get(msg.id._serialized || msg.id.$1);
    };

    window.WWebJS.toStickerData = async (mediaInfo) => {
        if (mediaInfo.mimetype == 'image/webp') return mediaInfo;

        const file = window.WWebJS.mediaInfoToFile(mediaInfo);
        const webpSticker = await window
            .require('WAWebImageUtils')
            .toWebpSticker(file);
        const webpBuffer = await webpSticker.arrayBuffer();
        const data = window.WWebJS.arrayBufferToBase64(webpBuffer);

        return {
            mimetype: 'image/webp',
            data,
        };
    };

    window.WWebJS.processStickerData = async (mediaInfo) => {
        if (mediaInfo.mimetype !== 'image/webp')
            throw new Error('Invalid media type');

        const file = window.WWebJS.mediaInfoToFile(mediaInfo);
        let filehash = await window.WWebJS.getFileHash(file);
        let mediaKey = await window.WWebJS.generateHash(32);

        const controller = new AbortController();
        const uploadedInfo = await window
            .require('WAWebUploadManager')
            .encryptAndUpload({
                blob: file,
                type: 'sticker',
                signal: controller.signal,
                mediaKey,
                uploadQpl: window
                    .require('WAWebStartMediaUploadQpl')
                    .startMediaUploadQpl({
                        entryPoint: 'MediaUpload',
                    }),
            });

        const stickerInfo = {
            ...uploadedInfo,
            clientUrl: uploadedInfo.url,
            deprecatedMms3Url: uploadedInfo.url,
            uploadhash: uploadedInfo.encFilehash,
            size: file.size,
            type: 'sticker',
            filehash,
        };

        return stickerInfo;
    };

    window.WWebJS.processMediaData = async (
        mediaInfo,
        {
            forceSticker,
            forceGif,
            forceVoice,
            forceDocument,
            forceMediaHd,
            sendToChannel,
            sendToStatus,
        },
    ) => {
        const file = window.WWebJS.mediaInfoToFile(mediaInfo);
        const OpaqueData = window.require('WAWebMediaOpaqueData');
        const opaqueData = await OpaqueData.createFromData(
            file,
            mediaInfo.mimetype,
        );
        const mediaParams = {
            asSticker: forceSticker,
            asGif: forceGif,
            isPtt: forceVoice,
            asDocument: forceDocument,
        };

        if (forceMediaHd && file.type.indexOf('image/') === 0) {
            mediaParams.maxDimension = 2560;
        }

        const mediaPrep = window
            .require('WAWebPrepRawMedia')
            .prepRawMedia(opaqueData, mediaParams);
        const mediaData = await mediaPrep.waitForPrep();
        const mediaObject = window
            .require('WAWebMediaStorage')
            .getOrCreateMediaObject(mediaData.filehash);
        const mediaType = window.require('WAWebMmsMediaTypes').msgToMediaType({
            type: mediaData.type,
            isGif: mediaData.isGif,
            isNewsletter: sendToChannel,
        });

        if (!mediaData.filehash) {
            throw new Error('media-fault: sendToChat filehash undefined');
        }

        if (
            (forceVoice && mediaData.type === 'ptt') ||
            (sendToStatus && mediaData.type === 'audio')
        ) {
            const waveform = mediaObject.contentInfo.waveform;
            mediaData.waveform =
                waveform || (await window.WWebJS.generateWaveform(file));
        }

        if (!(mediaData.mediaBlob instanceof OpaqueData)) {
            mediaData.mediaBlob = await OpaqueData.createFromData(
                mediaData.mediaBlob,
                mediaData.mediaBlob.type,
            );
        }

        mediaData.renderableUrl = mediaData.mediaBlob.url();
        mediaObject.consolidate(mediaData.toJSON());

        mediaData.mediaBlob.autorelease();
        const shouldUseMediaCache = window
            .require('WAWebMediaDataUtils')
            .shouldUseMediaCache(
                window.require('WAWebMmsMediaTypes').castToV4(mediaObject.type),
            );
        if (shouldUseMediaCache && mediaData.mediaBlob instanceof OpaqueData) {
            const formData = mediaData.mediaBlob.formData();
            window
                .require('WAWebMediaInMemoryBlobCache')
                .InMemoryMediaBlobCache.put(mediaObject.filehash, formData);
        }

        const dataToUpload = {
            mimetype: mediaData.mimetype,
            mediaObject,
            mediaType,
            ...(sendToChannel
                ? {
                      calculateToken: window.require('WAMediaCalculateFilehash')
                          .getRandomFilehash,
                  }
                : {}),
        };

        const { uploadMedia, uploadUnencryptedMedia } = window.require(
            'WAWebMediaMmsV4Upload',
        );
        const uploadedMedia = !sendToChannel
            ? await uploadMedia(dataToUpload)
            : await uploadUnencryptedMedia(dataToUpload);

        const mediaEntry = uploadedMedia.mediaEntry;
        if (!mediaEntry) {
            throw new Error('upload failed: media entry was not created');
        }

        mediaData.set({
            clientUrl: mediaEntry.mmsUrl,
            deprecatedMms3Url: mediaEntry.deprecatedMms3Url,
            directPath: mediaEntry.directPath,
            mediaKey: mediaEntry.mediaKey,
            mediaKeyTimestamp: mediaEntry.mediaKeyTimestamp,
            filehash: mediaObject.filehash,
            encFilehash: mediaEntry.encFilehash,
            uploadhash: mediaEntry.uploadHash,
            size: mediaObject.size,
            streamingSidecar: mediaEntry.sidecar,
            firstFrameSidecar: mediaEntry.firstFrameSidecar,
            mediaHandle: sendToChannel ? mediaEntry.handle : null,
        });

        return mediaData;
    };

    window.WWebJS.getMessageModel = (message) => {
        let msg;
        try {
            msg = message.serialize();
        } catch (e) {
            if (window.onDiagLog)
                window.onDiagLog(
                    'error',
                    'getMessageModel serialize FAILED',
                    JSON.stringify({
                        id: message.id?._serialized,
                        type: message.type,
                        error: e?.message || String(e),
                    }),
                );
            throw e;
        }
        if (!msg) {
            if (window.onDiagLog)
                window.onDiagLog(
                    'error',
                    'getMessageModel serialize returned falsy',
                    JSON.stringify({
                        id: message.id?._serialized,
                        type: message.type,
                    }),
                );
            return null;
        }

        const { findLinks } = window.require('WALinkify');

        msg.isEphemeral = message.isEphemeral;
        msg.isStatusV3 = message.isStatusV3;
        msg.links = findLinks(
            message.mediaObject ? message.caption : message.body,
        ).map((link) => ({
            link: link.href,
            isSuspicious: Boolean(
                link.suspiciousCharacters && link.suspiciousCharacters.size,
            ),
        }));

        if (msg.buttons) {
            msg.buttons = msg.buttons.serialize();
        }
        if (msg.dynamicReplyButtons) {
            msg.dynamicReplyButtons = JSON.parse(
                JSON.stringify(msg.dynamicReplyButtons),
            );
        }
        if (msg.replyButtons) {
            msg.replyButtons = JSON.parse(JSON.stringify(msg.replyButtons));
        }

        if (typeof msg.id.remote === 'object') {
            msg.id = Object.assign({}, msg.id, {
                remote: msg.id.remote._serialized || msg.id.remote.$1,
            });
        }

        // WhatsApp Web changed _serialized to $1 in message IDs (2026-07 update).
        // Normalize here so all downstream Node.js code can keep using _serialized.
        if (msg.id && msg.id._serialized == null && msg.id.$1 != null) {
            msg.id = Object.assign({}, msg.id, { _serialized: msg.id.$1 });
        }

        delete msg.pendingAckUpdate;

        return msg;
    };

    window.WWebJS.getChat = async (chatId, { getAsModel = true } = {}) => {
        const _dl = window.__diag?.safeDiagLog;
        const isChannel = /@\w*newsletter\b/.test(chatId);
        const chatWid = window.require('WAWebWidFactory').createWid(chatId);
        let chat;

        if (isChannel) {
            try {
                chat = window
                    .require('WAWebCollections')
                    .WAWebNewsletterCollection.get(chatId);
                if (!chat) {
                    _dl?.('debug', 'getChat:newsletter:find', { chatId });
                    await window
                        .require('WAWebLoadNewsletterPreviewChatAction')
                        .loadNewsletterPreviewChat(chatId);
                    chat = await window
                        .require('WAWebCollections')
                        .WAWebNewsletterCollection.find(chatWid);
                }
            } catch (err) {
                chat = null;
            }
        } else {
            chat = window.require('WAWebCollections').Chat.get(chatWid);
            if (!chat) {
                _dl?.('debug', 'getChat:findOrCreate', { chatId });
                chat = (
                    await window
                        .require('WAWebFindChatAction')
                        .findOrCreateLatestChat(chatWid)
                )?.chat;
                _dl?.('debug', 'getChat:findOrCreate:done', {
                    chatId,
                    found: !!chat,
                });
            }
        }

        if (getAsModel && chat) {
            const isGroup = !!chat.groupMetadata;
            _dl?.('debug', 'getChat:model:start', { chatId, isGroup });
            const model = await window.WWebJS.getChatModel(chat, {
                isChannel: isChannel,
            });
            _dl?.('debug', 'getChat:model:done', { chatId });
            return model;
        }
        return chat;
    };

    window.WWebJS.getChannelMetadata = async (inviteCode) => {
        const role = window
            .require('WAWebNewsletterModelUtils')
            .getRoleByIdentifier(inviteCode);
        const response = await window
            .require('WAWebNewsletterMetadataQueryJob')
            .queryNewsletterMetadataByInviteCode(inviteCode, role);

        const picUrl =
            response.newsletterPictureMetadataMixin?.picture[0]
                ?.queryPictureDirectPathOrEmptyResponseMixinGroup.value
                .directPath;

        return {
            id: response.idJid,
            createdAtTs:
                response.newsletterCreationTimeMetadataMixin.creationTimeValue,
            titleMetadata: {
                title: response.newsletterNameMetadataMixin.nameElementValue,
                updatedAtTs:
                    response.newsletterNameMetadataMixin.nameUpdateTime,
            },
            descriptionMetadata: {
                description:
                    response.newsletterDescriptionMetadataMixin
                        .descriptionQueryDescriptionResponseMixin.elementValue,
                updatedAtTs:
                    response.newsletterDescriptionMetadataMixin
                        .descriptionQueryDescriptionResponseMixin.updateTime,
            },
            inviteLink: `https://whatsapp.com/channel/${response.newsletterInviteLinkMetadataMixin.inviteCode}`,
            membershipType: role,
            stateType: response.newsletterStateMetadataMixin.stateType,
            pictureUrl: picUrl ? `https://pps.whatsapp.net${picUrl}` : null,
            subscribersCount:
                response.newsletterSubscribersMetadataMixin.subscribersCount,
            isVerified:
                response.newsletterVerificationMetadataMixin
                    .verificationState === 'verified',
        };
    };

    window.WWebJS.getChats = async () => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        const chatPromises = chats.map((chat) =>
            window.WWebJS.getChatModel(chat),
        );
        return await Promise.all(chatPromises);
    };

    window.WWebJS.getChannels = async () => {
        const channels = window
            .require('WAWebCollections')
            .WAWebNewsletterCollection.getModelsArray();
        const channelPromises = channels?.map((channel) =>
            window.WWebJS.getChatModel(channel, { isChannel: true }),
        );
        return await Promise.all(channelPromises);
    };

    window.WWebJS.getChatModel = async (chat, { isChannel = false } = {}) => {
        if (!chat) return null;

        const model = chat.serialize();
        model.isGroup = false;
        model.isMuted = chat.mute?.expiration !== 0;
        if (isChannel) {
            model.isChannel = window
                .require('WAWebChatGetters')
                .getIsNewsletter(chat);
        } else {
            model.formattedTitle = chat.formattedTitle;
        }

        if (chat.groupMetadata) {
            model.isGroup = true;
            const chatWid = window
                .require('WAWebWidFactory')
                .createWid(chat.id._serialized || chat.id.$1);
            const groupMetadata =
                window.require('WAWebCollections').GroupMetadata ||
                window.require('WAWebCollections').WAWebGroupMetadataCollection;
            const _dl = window.__diag?.safeDiagLog;
            _dl?.('debug', 'getChatModel:groupMetadata.update:start', {
                chatId: chat.id?._serialized,
            });
            await groupMetadata.update(chatWid);
            _dl?.('debug', 'getChatModel:groupMetadata.update:done', {
                chatId: chat.id?._serialized,
            });
            const { toPn } = window.require('WAWebLidMigrationUtils');
            const serializedMetadata = chat.groupMetadata.serialize();
            for (const p of serializedMetadata.participants || []) {
                p.id = toPn(p.id) ?? p.id;
            }
            model.groupMetadata = serializedMetadata;
            model.isReadOnly = chat.groupMetadata.announce;
        }

        if (chat.newsletterMetadata) {
            const newsletterMetadata =
                window.require('WAWebCollections')
                    .NewsletterMetadataCollection ||
                window.require('WAWebCollections')
                    .WAWebNewsletterMetadataCollection;
            await newsletterMetadata.update(chat.id);
            model.channelMetadata = chat.newsletterMetadata.serialize();
            model.channelMetadata.createdAtTs =
                chat.newsletterMetadata.creationTime;
        }

        model.lastMessage = null;
        if (model.msgs && model.msgs.length) {
            const _lastReceivedKeyId = chat.lastReceivedKey
                ? chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1
                : null;
            const lastMessage = _lastReceivedKeyId
                ? window
                      .require('WAWebCollections')
                      .Msg.get(_lastReceivedKeyId) ||
                  (
                      await window
                          .require('WAWebCollections')
                          .Msg.getMessagesById([_lastReceivedKeyId])
                  )?.messages?.[0]
                : null;
            lastMessage &&
                (model.lastMessage =
                    window.WWebJS.getMessageModel(lastMessage));
        }

        delete model.msgs;
        delete model.msgUnsyncedButtonReplyMsgs;
        delete model.unsyncedButtonReplies;

        return model;
    };

    window.WWebJS.getContactModel = (contact) => {
        let res = contact.serialize();

        const wid = window
            .require('WAWebWidFactory')
            .createWidFromWidLike(contact.id);
        if (wid.isLid() && contact.phoneNumber) {
            res.id = contact.phoneNumber;
        }

        res.isBusiness =
            contact.isBusiness === undefined ? false : contact.isBusiness;

        if (contact.businessProfile) {
            res.businessProfile = contact.businessProfile.serialize();
        }

        res.isBlocked = contact.isContactBlocked;

        const ContactMethods = window.require('WAWebContactGetters');
        res.isMe = ContactMethods.getIsMe(contact);
        res.isUser = ContactMethods.getIsUser(contact);
        res.isGroup = ContactMethods.getIsGroup(contact);
        res.isWAContact = ContactMethods.getIsWAContact(contact);
        res.userid = ContactMethods.getUserid(contact);
        res.verifiedName = ContactMethods.getVerifiedName(contact);
        res.verifiedLevel = ContactMethods.getVerifiedLevel(contact);
        res.statusMute = ContactMethods.getStatusMute(contact);
        res.name = ContactMethods.getName(contact);
        res.shortName = ContactMethods.getShortName(contact);
        res.pushname = ContactMethods.getPushname(contact);

        const { getIsMyContact } = window.require(
            'WAWebFrontendContactGetters',
        );
        res.isMyContact = getIsMyContact(contact);
        res.isEnterprise = ContactMethods.getIsEnterprise(contact);

        return res;
    };

    // One-time interceptor that records the RAW server response of biz-profile
    // IQ queries. BusinessProfile.find() -> queryBusinessProfileJob wraps the
    // server rejection in ServerStatusCodeError, which keeps only the numeric
    // code and discards errorText/errorType/errorBackoff. By tapping
    // deprecatedSendIq (filtered to w:biz business_profile) we stash the full
    // response of the EXACT query that failed, at the real failure moment, so
    // the diagnostic can report it instead of a later re-query that may no
    // longer reproduce the transient. Pass-through and best-effort - never
    // disturbs the query.
    window.WWebJS.__installBizIqErrorCapture = () => {
        if (window.WWebJS.__bizIqCaptureInstalled) return;
        try {
            const mod = window.require('WADeprecatedSendIq');
            const orig = mod.deprecatedSendIq;
            // Guard against re-wrapping if LoadUtils re-runs in the same context
            // (e.g. re-inject on reconnect) - otherwise wrapper layers would
            // stack on every biz IQ.
            if (typeof orig !== 'function' || orig.__bizCaptureWrapper) {
                window.WWebJS.__bizIqCaptureInstalled = true;
                return;
            }
            const wrapped = function (iq) {
                let isBizProfile = false;
                try {
                    isBizProfile =
                        iq &&
                        iq.attrs &&
                        iq.attrs.xmlns === 'w:biz' &&
                        iq.content &&
                        iq.content[0] &&
                        iq.content[0].tag === 'business_profile';
                } catch (_) {
                    /* filter probe is best-effort */
                }
                const p = orig.apply(this, arguments);
                if (!isBizProfile) return p;
                return Promise.resolve(p).then((res) => {
                    try {
                        if (res && res.success === false) {
                            window.WWebJS.__lastBizIqError = {
                                ts: Date.now(),
                                errorCode: res.errorCode,
                                errorText: res.errorText,
                                errorType: res.errorType,
                                errorBackoff: res.errorBackoff,
                            };
                        }
                    } catch (_) {
                        /* capture must never disturb the query */
                    }
                    return res;
                });
            };
            wrapped.__bizCaptureWrapper = true;
            mod.deprecatedSendIq = wrapped;
            window.WWebJS.__bizIqCaptureInstalled = true;
        } catch (_) {
            /* interceptor install is best-effort */
        }
    };
    window.WWebJS.__installBizIqErrorCapture();

    // Deep diagnostic for the "[WhatsApp] getContact failed" bug. Fires ONLY
    // when BusinessProfile.find() throws (rare, in production). It captures the
    // exact server error and actively probes every open root-cause hypothesis:
    //   - retryImmediate / retryDelayed  -> is the failure transient?
    //   - byPhoneNumber                  -> does the PN identity work where LID fails?
    //   - knownGoodFresh                 -> is a *different* known-good business
    //                                       ALSO failing right now (server-wide
    //                                       throttle) or is it sender-specific?
    //   - lidResolve / afterResolveByPn  -> is the LID<->PN identity unresolved,
    //                                       and does resolving it fix the query?
    // Everything is wrapped so diagnostics never mask or alter the real error.
    window.WWebJS.__diagBizProfileFailure = async (
        contactId,
        contact,
        contactWid,
        isLid,
        wasCached,
        err,
        bizTook,
    ) => {
        if (!window.onDiagLog) return;
        // Rate-guard: the probes below fire several extra read-only server
        // queries and one ~1.5s delayed retry. A burst of failures (e.g. a
        // server-wide throttle hitting many messages at once) must NOT amplify
        // into a query storm or block many callers, so run the heavy probes at
        // most once per 60s and a bounded number of times per session. Skipped
        // failures are still surfaced by the getContact:error log, so the
        // occurrence count is never lost.
        const guard =
            window.WWebJS.__bizDiagGuard ||
            (window.WWebJS.__bizDiagGuard = { last: 0, count: 0 });
        const nowTs = Date.now();
        if (guard.count >= 20 || nowTs - guard.last < 60000) return;
        guard.last = nowTs;
        guard.count += 1;
        const now = () => Date.now();
        const safe = (fn, d) => {
            try {
                return fn();
            } catch (_) {
                return d;
            }
        };
        const R = (m) => window.require(m);
        const Coll = R('WAWebCollections');
        const Api = safe(() => R('WAWebApiContact'), null);
        const sid = (w) => safe(() => w && w._serialized, null);
        const errInfo = (e) => ({
            name: e && e.name,
            status: e && (e.status !== undefined ? e.status : e.statusCode),
            statusCode: e && e.statusCode,
            errorText: e && e.errorText,
            errorType: e && e.errorType,
            errorBackoff: e && e.errorBackoff,
            message: String((e && e.message) || e).substring(0, 140),
            ownProps: safe(() => Object.keys(e).slice(0, 15), null),
            stack0: safe(
                () =>
                    String(e.stack || '')
                        .split('\n')[0]
                        .substring(0, 100),
                null,
            ),
        });

        const diag = {
            contactId: String(contactId).substring(0, 40),
            isLid,
            wasCached,
            bizTook,
            ts: now(),
            // The actual server rejection (ServerStatusCodeError keeps the
            // numeric code on .status; the query job drops text/type/backoff -
            // the rawIq probe below re-fetches those directly from the server).
            err: errInfo(err),

            // The RAW server response of the exact query that just failed,
            // captured by the biz-IQ interceptor at the real failure moment.
            // This recovers the errorText/errorType/errorBackoff that
            // ServerStatusCodeError discarded - unlike the rawIq probe, this is
            // the ORIGINAL failure, not a re-query. Trusted only if very recent.
            originalRawError: (() => {
                const e = window.WWebJS.__lastBizIqError;
                if (e && Date.now() - e.ts < 5000) return e;
                return null;
            })(),

            // Full WID breakdown of the identity we queried.
            wid: {
                user: safe(() => contactWid.user, null),
                server: safe(() => contactWid.server, null),
                device: safe(() => contactWid.device, null),
                agent: safe(() => contactWid.agent, null),
                isLid: safe(() => contactWid.isLid(), null),
                isUser: safe(() => contactWid.isUser(), null),
                isGroup: safe(() => contactWid.isGroup(), null),
                isPSA: safe(() => contactWid.isPSA(), null),
                isUserNotPSA: safe(() => contactWid.isUserNotPSA(), null),
                isFbidBot: safe(() => contactWid.isFbidBot(), null),
            },

            // Contact model state - is this a synced, real business or a
            // freshly-seen placeholder?
            contact: {
                id: sid(safe(() => contact.id, null)),
                phoneNumber: sid(safe(() => contact.phoneNumber, null)),
                lid: sid(safe(() => contact.lid, null)),
                userid: safe(() => contact.userid, null),
                isBusiness: safe(() => !!contact.isBusiness, null),
                isEnterprise: safe(() => !!contact.isEnterprise, null),
                isSmb: safe(() => !!contact.isSmb, null),
                isContactSyncCompleted: safe(
                    () => contact.isContactSyncCompleted,
                    null,
                ),
                forcedBusinessUpdateFromServer: safe(
                    () => contact.forcedBusinessUpdateFromServer,
                    null,
                ),
                verifiedName: safe(() => contact.verifiedName, null),
                verifiedLevel: safe(() => contact.verifiedLevel, null),
                pushname: safe(() => contact.pushname, null),
                notifyName: safe(() => contact.notifyName, null),
                name: safe(() => contact.name, null),
                isMyContact: safe(() => contact.isMyContact, null),
                isWAContact: safe(() => contact.isWAContact, null),
                isContactBlocked: safe(() => contact.isContactBlocked, null),
                type: safe(() => contact.type, null),
                hasTextStatus: safe(() => !!contact.textStatus, null),
                stale: safe(() => contact.stale, null),
                hasBusinessProfile: safe(() => !!contact.businessProfile, null),
            },

            // The BusinessProfile model that gadd() created even though find()
            // threw - reveals whether it was a placeholder, its version tag,
            // and its data source.
            bizModel: safe(() => {
                const m = Coll.BusinessProfile.get(contact.id);
                if (!m) return null;
                return {
                    id: sid(m.id),
                    tag: m.tag,
                    dataSource: m.dataSource,
                    stale: m.stale,
                    isValid: safe(() => m.isValid(), null),
                    hasProfileOptions: !!m.profileOptions,
                    automatedType: m.automatedType,
                    welcomeMsgProtocolMode: m.welcomeMsgProtocolMode,
                };
            }, null),

            // Local LID<->PN mapping + migration view of this identity.
            mapping: {
                currentLid: sid(
                    safe(() => Api && Api.getCurrentLid(contactWid), null),
                ),
                phoneNumber: sid(
                    safe(() => Api && Api.getPhoneNumber(contactWid), null),
                ),
                migToPn: sid(
                    safe(
                        () => R('WAWebLidMigrationUtils').toPn(contact.id),
                        null,
                    ),
                ),
                migToLid: sid(
                    safe(
                        () => R('WAWebLidMigrationUtils').toLid(contact.id),
                        null,
                    ),
                ),
                isLidMigrated: safe(
                    () =>
                        R(
                            'WAWebLid1X1MigrationGating',
                        ).Lid1X1MigrationUtils.isLidMigrated(),
                    null,
                ),
            },

            // Connection / sync state at the instant of failure.
            conn: {
                isOfflineDeliveryEnd: safe(
                    () =>
                        R(
                            'WAWebEventsWaitForOfflineDeliveryEnd',
                        ).isOfflineDeliveryEnd(),
                    null,
                ),
                socketConnected: safe(
                    () => R('WAComms').isSocketConnected(),
                    null,
                ),
                socketState: safe(
                    () => R('WAWebSocketModel').Socket.state,
                    null,
                ),
                socketHasSynced: safe(
                    () => R('WAWebSocketModel').Socket.hasSynced,
                    null,
                ),
                launchGeneration: safe(
                    () => R('WAWebSocketModel').Socket.launchGeneration,
                    null,
                ),
                backoffGeneration: safe(
                    () => R('WAWebSocketModel').Socket.backoffGeneration,
                    null,
                ),
                retryTimestamp: safe(
                    () => R('WAWebSocketModel').Socket.retryTimestamp,
                    null,
                ),
                connModel: safe(() => {
                    const C = R('WAWebConnModel').Conn;
                    return {
                        connected: C.connected,
                        platform: C.platform,
                        is24h: C.is24h,
                        hasWid: !!C.wid,
                    };
                }, null),
            },

            tests: {},
        };

        // TEST 1 - immediate retry of the exact same query (transient?)
        try {
            const t = now();
            const r = await Coll.BusinessProfile.find(contact.id);
            diag.tests.retryImmediate = {
                ok: true,
                took: now() - t,
                hasProfile: !!(r && r.profileOptions),
            };
        } catch (e) {
            diag.tests.retryImmediate = { ok: false, ...errInfo(e) };
        }

        // TEST 2 - query by the phone-number identity instead of the LID
        try {
            if (contact.phoneNumber) {
                const ex = Coll.BusinessProfile.get(contact.phoneNumber);
                ex && ex.markStale && ex.markStale();
                const t = now();
                const r = await Coll.BusinessProfile.find(contact.phoneNumber);
                diag.tests.byPhoneNumber = {
                    ok: true,
                    took: now() - t,
                    hasProfile: !!(r && r.profileOptions),
                };
            } else {
                diag.tests.byPhoneNumber = { skipped: 'noLocalPhone' };
            }
        } catch (e) {
            diag.tests.byPhoneNumber = { ok: false, ...errInfo(e) };
        }

        // TEST 3 - a DIFFERENT, known-good business, forced fresh from server.
        // If this also fails now -> server-wide throttle. If it succeeds ->
        // the failure is specific to this sender.
        try {
            let known = null;
            const arr = Coll.Contact.getModelsArray();
            const failId = safe(() => contact.id._serialized, null);
            for (let i = 0; i < arr.length; i++) {
                const c = arr[i];
                if (
                    (c.isBusiness || c.isEnterprise) &&
                    safe(() => c.id._serialized, null) !== failId &&
                    Coll.BusinessProfile.get(c.id)
                ) {
                    known = c;
                    break;
                }
            }
            if (known) {
                const ex = Coll.BusinessProfile.get(known.id);
                ex && ex.markStale && ex.markStale();
                const t = now();
                const r = await Coll.BusinessProfile.find(known.id);
                diag.tests.knownGoodFresh = {
                    ok: true,
                    took: now() - t,
                    knownIsLid: safe(
                        () => known.id._serialized.endsWith('@lid'),
                        null,
                    ),
                    hasProfile: !!(r && r.profileOptions),
                };
            } else {
                diag.tests.knownGoodFresh = { skipped: 'noKnownGood' };
            }
        } catch (e) {
            diag.tests.knownGoodFresh = { ok: false, ...errInfo(e) };
        }

        // TEST 4 - resolve the LID<->PN identity via the server, then retry the
        // biz query by the resolved phone number.
        try {
            if (isLid && window.WWebJS.enforceLidAndPnRetrieval) {
                const t = now();
                const res =
                    await window.WWebJS.enforceLidAndPnRetrieval(contactId);
                diag.tests.lidResolve = {
                    took: now() - t,
                    lid: res && res.lid && res.lid._serialized,
                    pn: res && res.phone && res.phone._serialized,
                };
                if (res && res.phone) {
                    try {
                        const ex = Coll.BusinessProfile.get(res.phone);
                        ex && ex.markStale && ex.markStale();
                        const t2 = now();
                        const r = await Coll.BusinessProfile.find(res.phone);
                        diag.tests.afterResolveByPn = {
                            ok: true,
                            took: now() - t2,
                            hasProfile: !!(r && r.profileOptions),
                        };
                    } catch (e2) {
                        diag.tests.afterResolveByPn = {
                            ok: false,
                            ...errInfo(e2),
                        };
                    }
                }
            } else {
                diag.tests.lidResolve = {
                    skipped: isLid ? 'noResolver' : 'notLid',
                };
            }
        } catch (e) {
            diag.tests.lidResolve = { ok: false, ...errInfo(e) };
        }

        // TEST 5 - delayed retry: does the transient clear after ~1.5s?
        try {
            await new Promise((res) => setTimeout(res, 1500));
            const ex = Coll.BusinessProfile.get(contact.id);
            ex && ex.markStale && ex.markStale();
            const t = now();
            const r = await Coll.BusinessProfile.find(contact.id);
            diag.tests.retryDelayed = {
                ok: true,
                took: now() - t,
                hasProfile: !!(r && r.profileOptions),
            };
        } catch (e) {
            diag.tests.retryDelayed = { ok: false, ...errInfo(e) };
        }

        // TEST 6 - raw w:biz IQ, replicating exactly what the query job sends,
        // but reading the *raw* server response so we recover the errorText /
        // errorType / errorBackoff that ServerStatusCodeError discards. This is
        // the definitive record of what the server actually answered.
        try {
            const WAWap = R('WAWap');
            const USER_JID = R('WAWebCommsWapMd').USER_JID;
            const ver = R(
                'WAWebBusinessProfileVersioningBridge',
            ).getBusinessProfileQueryVersion();
            const iq = WAWap.wap(
                'iq',
                {
                    to: WAWap.S_WHATSAPP_NET,
                    xmlns: 'w:biz',
                    id: WAWap.generateId(),
                    type: 'get',
                },
                WAWap.wap('business_profile', { v: WAWap.INT(ver) }, [
                    WAWap.wap('profile', { jid: USER_JID(contact.id) }),
                ]),
            );
            const t = now();
            const raw = await R('WADeprecatedSendIq').deprecatedSendIq(
                iq,
                () => true,
            );
            diag.tests.rawIq = {
                took: now() - t,
                success: raw && raw.success,
                errorCode: raw && raw.errorCode,
                errorText: raw && raw.errorText,
                errorType: raw && raw.errorType,
                errorBackoff: raw && raw.errorBackoff,
            };
        } catch (e) {
            diag.tests.rawIq = { threw: true, ...errInfo(e) };
        }

        // TEST 7 - does the server itself know this identity, and does it flag
        // it as a business? Distinguishes "unknown/unresolved identity" from
        // "known business whose profile query was rejected".
        try {
            const t = now();
            const r = await R('WAWebQueryExistsJob').queryWidExists(contactWid);
            diag.tests.widExists = {
                took: now() - t,
                exists: !!(r && r.wid),
                wid: sid(r && r.wid),
                biz: r && r.biz,
            };
        } catch (e) {
            diag.tests.widExists = { threw: true, ...errInfo(e) };
        }

        window.onDiagLog(
            'error',
            'getContact:bizFailDeep',
            JSON.stringify(diag),
        );
    };

    window.WWebJS.getContact = async (contactId) => {
        const start = Date.now();
        const isLid =
            typeof contactId === 'string' && contactId.endsWith('@lid');
        const contactWid = window
            .require('WAWebWidFactory')
            .createWid(contactId);
        let findTook = -1;
        let bizTook = -1;
        try {
            const contact = await window
                .require('WAWebCollections')
                .Contact.find(contactWid);
            findTook = Date.now() - start;
            if (contact.isBusiness || contact.isEnterprise) {
                const bizStart = Date.now();
                let bizWasCached = false;
                try {
                    bizWasCached = !!window
                        .require('WAWebCollections')
                        .BusinessProfile.get(contact.id);
                } catch (_) {
                    /* cache probe is best-effort */
                }
                try {
                    const bizProfile = await window
                        .require('WAWebCollections')
                        .BusinessProfile.find(contact.id);
                    bizTook = Date.now() - bizStart;
                    bizProfile.profileOptions &&
                        (contact.businessProfile = bizProfile);
                } catch (bizErr) {
                    // DEEP DIAGNOSTIC: runs ONLY when the biz-profile fetch
                    // actually fails (the bug we are hunting). It records the
                    // real server error code and actively tests every
                    // root-cause hypothesis, then rethrows so behavior is
                    // unchanged. bizTook stays -1 so getContact:error still
                    // reports stage === 'bizProfile'.
                    try {
                        await window.WWebJS.__diagBizProfileFailure(
                            contactId,
                            contact,
                            contactWid,
                            isLid,
                            bizWasCached,
                            bizErr,
                            Date.now() - bizStart,
                        );
                    } catch (_) {
                        /* diagnostics must never mask the real error */
                    }
                    throw bizErr;
                }
            }
            const totalTook = Date.now() - start;
            if (totalTook > 200) {
                if (window.onDiagLog)
                    window.onDiagLog(
                        'warn',
                        'getContact:slow',
                        JSON.stringify({
                            contactId: contactId.substring(0, 20),
                            isLid,
                            findTook,
                            bizTook,
                            totalTook,
                        }),
                    );
            }
            return window.WWebJS.getContactModel(contact);
        } catch (e) {
            if (window.onDiagLog)
                window.onDiagLog(
                    'error',
                    'getContact:error',
                    JSON.stringify({
                        contactId: contactId.substring(0, 20),
                        isLid,
                        findTook,
                        bizTook,
                        totalTook: Date.now() - start,
                        error: String(e?.message || e).substring(0, 200),
                        stage:
                            findTook < 0
                                ? 'find'
                                : bizTook < 0
                                  ? 'bizProfile'
                                  : 'model',
                    }),
                );
            throw e;
        }
    };

    window.WWebJS.getContacts = () => {
        const contacts = window
            .require('WAWebCollections')
            .Contact.getModelsArray();
        return contacts.map((contact) =>
            window.WWebJS.getContactModel(contact),
        );
    };

    window.WWebJS.mediaInfoToFile = ({ data, mimetype, filename }) => {
        const binaryData = window.atob(data);

        const buffer = new ArrayBuffer(binaryData.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < binaryData.length; i++) {
            view[i] = binaryData.charCodeAt(i);
        }

        const blob = new Blob([buffer], { type: mimetype });
        return new File([blob], filename, {
            type: mimetype,
            lastModified: Date.now(),
        });
    };

    /**
     * Bounded registry of recently revoked message ids. Populated by the
     * revoke-for-everyone handler (Client.js) and read by resolveMediaBlob to
     * attribute a "media download returned null" to a preceding revoke that
     * removed the message from the Store before the (lazy) download ran.
     *
     * Fixed-capacity Map (insertion-ordered) so it can never grow without
     * bound: on overflow the oldest entry is evicted, and re-adding an id
     * refreshes its recency. A revoke that matters is always followed within
     * seconds by the download attempt, so a few hundred entries is ample.
     */
    window.__revokedMsgIds =
        window.__revokedMsgIds ||
        (() => {
            const MAX = 512;
            const map = new Map(); // serializedId -> revokeTimestamp|null
            return {
                add(id, ts) {
                    // Only accept real serialized msg ids (they always contain
                    // '_', e.g. "false_1234@lid_ABC..."). This rejects null,
                    // non-strings, and Object.prototype.toString junk.
                    if (typeof id !== 'string' || id.indexOf('_') === -1)
                        return;
                    if (map.has(id)) map.delete(id);
                    map.set(id, ts ?? null);
                    while (map.size > MAX) map.delete(map.keys().next().value);
                },
                get(id) {
                    if (!id || !map.has(id)) return null;
                    return { revokeTs: map.get(id) };
                },
            };
        })();

    /**
     * Resolves the media blob and metadata for a message.
     * Shared by downloadMedia and downloadMediaStream.
     *
     * Always returns an object: an in-page throw loses custom properties at the
     * puppeteer boundary, so the reason travels as data. It is WhatsApp's own
     * `MediaDataStage`, or `null` when no message is left to have one.
     *
     * @param {string} msgId
     * @returns {Promise<{blob: Blob|null, stage: string|null, mimetype: string, filename: string, filesize: number}>}
     */
    window.WWebJS.resolveMediaBlob = async (msgId) => {
        const fail = (stage) => ({ blob: null, stage });

        const { Msg } = window.require('WAWebCollections');
        let msg;
        try {
            msg =
                Msg.get(msgId) ||
                (await Msg.getMessagesById([msgId]))?.messages?.[0];
        } catch (lookupError) {
            // An unserialized id reaches IndexedDB as `undefined` and rejects.
            window.onDiagLog?.(
                'warn',
                'resolveMediaBlob: lookup threw',
                JSON.stringify({
                    id: String(msgId),
                    lookupError: String(lookupError?.message || lookupError),
                }),
            );
            return fail(null);
        }

        if (
            !msg ||
            !msg.mediaData ||
            msg.mediaData.mediaStage === 'REUPLOADING'
        ) {
            if (window.onDiagLog) {
                const revoked = window.__revokedMsgIds?.get(msgId);
                window.onDiagLog(
                    'warn',
                    'resolveMediaBlob: returning null',
                    JSON.stringify({
                        id: msgId,
                        hasMsg: !!msg,
                        hasMediaData: !!msg?.mediaData,
                        mediaStage: msg?.mediaData?.mediaStage,
                        // Deterministic cause: the message is gone because a
                        // revoke-for-everyone removed it before this download.
                        wasRevoked: !!revoked,
                        revokeTs: revoked?.revokeTs ?? null,
                    }),
                );
            }
            return fail(msg?.mediaData?.mediaStage ?? null);
        }

        // Always call internal downloadMedia - never skip based on
        // mediaStage, because cache eviction can leave stage=RESOLVED
        // with empty InMemoryMediaBlobCache.
        let resolveError = null;
        try {
            await msg.downloadMedia({
                downloadEvenIfExpensive: true,
                rmrReason: 1,
                isUserInitiated: true,
            });
        } catch (re) {
            resolveError = {
                message: String(re?.message || re),
                name: re?.name,
            };
        }

        // `notifyMsgsAsync()` is a debounce, so `mediaStage` reads stale right
        // after the await - measured REUPLOADING where the truth was
        // ERROR_MISSING. This is WhatsApp's own primitive for that wait.
        await msg.mediaObject?.resolveWhenConsolidated();

        // RMR recovery: if resolve failed (NEED_POKE), mark entry off-server to force RMR
        if (msg.mediaData.mediaStage === 'NEED_POKE') {
            var entry = msg.mediaObject?.entries?.getDownloadEntry?.(true);
            if (entry?.markWhetherOnServer) {
                entry.markWhetherOnServer(false);
                try {
                    await msg.downloadMedia({
                        downloadEvenIfExpensive: true,
                        rmrReason: 1,
                        isUserInitiated: true,
                    });
                } catch (re2) {
                    /* ignore */
                }
                // Same debounce again, or the stage reported below is the one
                // from before this retry.
                await msg.mediaObject?.resolveWhenConsolidated();
            }
        }

        if (
            msg.mediaData.mediaStage.includes('ERROR') ||
            msg.mediaData.mediaStage === 'FETCHING' ||
            msg.mediaData.mediaStage === 'NEED_POKE' ||
            msg.mediaData.mediaStage === 'REUPLOADING'
        ) {
            if (window.onDiagLog)
                window.onDiagLog(
                    'error',
                    'resolveMediaBlob: failed',
                    JSON.stringify({
                        id: msgId,
                        stageAfter: msg.mediaData.mediaStage,
                        resolveError,
                    }),
                );
            return fail(msg.mediaData.mediaStage);
        }

        const cached = window
            .require('WAWebMediaInMemoryBlobCache')
            .InMemoryMediaBlobCache.get(msg.mediaObject?.filehash);

        let blob;
        if (cached) {
            blob = cached;
        } else if (msg.mediaObject?.mediaBlob) {
            blob = msg.mediaObject.mediaBlob.forceToBlob();
        }

        if (!blob) {
            if (window.onDiagLog)
                window.onDiagLog(
                    'error',
                    'resolveMediaBlob: no blob found',
                    JSON.stringify({
                        id: msgId,
                        mediaStage: msg.mediaData.mediaStage,
                        hasFilehash: !!msg.mediaObject?.filehash,
                        hasMediaBlob: !!msg.mediaObject?.mediaBlob,
                        // Why the download gave up; used to be dropped.
                        resolveError,
                    }),
                );
            return fail(msg.mediaData.mediaStage);
        }

        if (window.onDiagLog)
            window.onDiagLog(
                'debug',
                'resolveMediaBlob: success',
                JSON.stringify({
                    id: msgId,
                    mediaStage: msg.mediaData.mediaStage,
                    blobSize: blob.size,
                    fromCache: !!cached,
                }),
            );

        return {
            blob,
            mimetype: msg.mimetype,
            filename: msg.filename,
            filesize: msg.size,
        };
    };

    window.WWebJS.arrayBufferToBase64 = (arrayBuffer) => {
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    };

    window.WWebJS.arrayBufferToBase64Async = (arrayBuffer) =>
        new Promise((resolve, reject) => {
            const blob = new Blob([arrayBuffer], {
                type: 'application/octet-stream',
            });
            const fileReader = new FileReader();
            fileReader.onload = () => {
                const [, data] = fileReader.result.split(',');
                resolve(data);
            };
            fileReader.onerror = (e) => reject(e);
            fileReader.readAsDataURL(blob);
        });

    window.WWebJS.getFileHash = async (data) => {
        let buffer = await data.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    };

    window.WWebJS.generateHash = async (length) => {
        var result = '';
        var characters =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for (var i = 0; i < length; i++) {
            result += characters.charAt(
                Math.floor(Math.random() * charactersLength),
            );
        }
        return result;
    };

    window.WWebJS.generateWaveform = async (audioFile) => {
        try {
            const audioData = await audioFile.arrayBuffer();
            const audioContext = new AudioContext();
            const audioBuffer = await audioContext.decodeAudioData(audioData);

            const rawData = audioBuffer.getChannelData(0);
            const samples = 64;
            const blockSize = Math.floor(rawData.length / samples);
            const filteredData = [];
            for (let i = 0; i < samples; i++) {
                const blockStart = blockSize * i;
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum = sum + Math.abs(rawData[blockStart + j]);
                }
                filteredData.push(sum / blockSize);
            }

            const multiplier = Math.pow(Math.max(...filteredData), -1);
            const normalizedData = filteredData.map((n) => n * multiplier);

            const waveform = new Uint8Array(
                normalizedData.map((n) => Math.floor(100 * n)),
            );

            return waveform;
        } catch (e) {
            return undefined;
        }
    };

    window.WWebJS.sendClearChat = async (chatId) => {
        let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        if (chat !== undefined) {
            await window.require('WAWebChatClearBridge').sendClear(chat, false);
            return true;
        }
        return false;
    };

    window.WWebJS.sendDeleteChat = async (chatId) => {
        let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        if (chat !== undefined) {
            await window.require('WAWebDeleteChatAction').sendDelete(chat);
            return true;
        }
        return false;
    };

    window.WWebJS.sendChatstate = async (state, chatId) => {
        chatId = window.require('WAWebWidFactory').createWid(chatId);

        const ChatState = window.require('WAWebChatStateBridge');
        switch (state) {
            case 'typing':
                await ChatState.sendChatStateComposing(chatId);
                break;
            case 'recording':
                await ChatState.sendChatStateRecording(chatId);
                break;
            case 'stop':
                await ChatState.sendChatStatePaused(chatId);
                break;
            default:
                throw 'Invalid chatstate';
        }

        return true;
    };

    window.WWebJS.getLabelModel = (label) => {
        let res = label.serialize();
        res.hexColor = label.hexColor;

        return res;
    };

    window.WWebJS.getLabels = () => {
        const labels = window
            .require('WAWebCollections')
            .Label.getModelsArray();
        return labels.map((label) => window.WWebJS.getLabelModel(label));
    };

    window.WWebJS.getLabel = (labelId) => {
        const label = window.require('WAWebCollections').Label.get(labelId);
        return window.WWebJS.getLabelModel(label);
    };

    window.WWebJS.getChatLabels = async (chatId) => {
        const chat = await window.WWebJS.getChat(chatId);
        return (chat.labels || []).map((id) => window.WWebJS.getLabel(id));
    };

    window.WWebJS.getOrderDetail = async (orderId, token, chatId) => {
        const chatWid = window.require('WAWebWidFactory').createWid(chatId);
        return window
            .require('WAWebBizOrderBridge')
            .queryOrder(chatWid, orderId, 80, 80, token);
    };

    window.WWebJS.getProductMetadata = async (productId) => {
        let sellerId = window.require('WAWebConnModel').Conn.wid;
        let product = await window
            .require('WAWebBizProductCatalogBridge')
            .queryProduct(sellerId, productId);
        if (product && product.data) {
            return product.data;
        }

        return undefined;
    };

    window.WWebJS.rejectCall = async (peerJid, id) => {
        const _meUser = window
            .require('WAWebUserPrefsMeUser')
            .getMaybeMePnUser();
        let userId = _meUser._serialized || _meUser.$1;

        const stanza = window.require('WAWap').wap(
            'call',
            {
                id: window.require('WAWap').generateId(),
                from: userId,
                to: peerJid,
            },
            [
                window.require('WAWap').wap('reject', {
                    'call-id': id,
                    'call-creator': peerJid,
                    count: '0',
                }),
            ],
        );
        await window.require('WADeprecatedSendIq').deprecatedCastStanza(stanza);
    };

    window.WWebJS.cropAndResizeImage = async (media, options = {}) => {
        if (!media.mimetype.includes('image'))
            throw new Error('Media is not an image');

        if (options.mimetype && !options.mimetype.includes('image'))
            delete options.mimetype;

        options = Object.assign(
            {
                size: 640,
                mimetype: media.mimetype,
                quality: 0.75,
                asDataUrl: false,
            },
            options,
        );

        const img = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = `data:${media.mimetype};base64,${media.data}`;
        });

        const sl = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - sl) / 2);
        const sy = Math.floor((img.height - sl) / 2);

        const canvas = document.createElement('canvas');
        canvas.width = options.size;
        canvas.height = options.size;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sl, sl, 0, 0, options.size, options.size);

        const dataUrl = canvas.toDataURL(options.mimetype, options.quality);

        if (options.asDataUrl) return dataUrl;

        return Object.assign(media, {
            mimetype: options.mimetype,
            data: dataUrl.replace(`data:${options.mimetype};base64,`, ''),
        });
    };

    window.WWebJS.setPicture = async (chatId, media) => {
        const thumbnail = await window.WWebJS.cropAndResizeImage(media, {
            asDataUrl: true,
            mimetype: 'image/jpeg',
            size: 96,
        });
        const profilePic = await window.WWebJS.cropAndResizeImage(media, {
            asDataUrl: true,
            mimetype: 'image/jpeg',
            size: 640,
        });

        const chatWid = window.require('WAWebWidFactory').createWid(chatId);
        try {
            const collection =
                window
                    .require('WAWebCollections')
                    .ProfilePicThumb.get(chatId) ||
                (await window
                    .require('WAWebCollections')
                    .ProfilePicThumb.find(chatId));
            if (!collection?.canSet()) return false;

            const res = await window
                .require('WAWebContactProfilePicThumbBridge')
                .sendSetPicture(chatWid, thumbnail, profilePic);
            return res ? res.status === 200 : false;
        } catch (err) {
            if (err.name === 'ServerStatusCodeError') return false;
            throw err;
        }
    };

    window.WWebJS.deletePicture = async (chatid) => {
        const chatWid = window.require('WAWebWidFactory').createWid(chatid);
        try {
            const collection = window
                .require('WAWebCollections')
                .ProfilePicThumb.get(chatid);
            if (!collection.canDelete()) return;

            const res = await window
                .require('WAWebContactProfilePicThumbBridge')
                .requestDeletePicture(chatWid);
            return res ? res.status === 200 : false;
        } catch (err) {
            if (err.name === 'ServerStatusCodeError') return false;
            throw err;
        }
    };

    window.WWebJS.getProfilePicThumbToBase64 = async (chatWid) => {
        const profilePicCollection = await window
            .require('WAWebCollections')
            .ProfilePicThumb.find(chatWid);

        const _readImageAsBase64 = (imageBlob) => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = function () {
                    const base64Image = reader.result;
                    if (base64Image == null) {
                        resolve(undefined);
                    } else {
                        const base64Data = base64Image.toString().split(',')[1];
                        resolve(base64Data);
                    }
                };
                reader.readAsDataURL(imageBlob);
            });
        };

        if (profilePicCollection?.img) {
            try {
                const response = await fetch(profilePicCollection.img);
                if (response.ok) {
                    const imageBlob = await response.blob();
                    if (imageBlob) {
                        const base64Image = await _readImageAsBase64(imageBlob);
                        return base64Image;
                    }
                }
            } catch (error) {
                /* empty */
            }
        }
        return undefined;
    };

    window.WWebJS.getAddParticipantsRpcResult = async (
        groupWid,
        participantWid,
    ) => {
        const iqTo = window.require('WAWebWidToJid').widToGroupJid(groupWid);

        const participantArgs = [
            {
                participantJid: window
                    .require('WAWebWidToJid')
                    .widToUserJid(participantWid),
            },
        ];

        let rpcResult, resultArgs;
        const data = {
            name: undefined,
            code: undefined,
            inviteV4Code: undefined,
            inviteV4CodeExp: undefined,
        };

        try {
            rpcResult = await window
                .require('WASmaxGroupsAddParticipantsRPC')
                .sendAddParticipantsRPC({ participantArgs, iqTo });
            resultArgs =
                rpcResult.value.addParticipant[0]
                    .addParticipantsParticipantAddedOrNonRegisteredWaUserParticipantErrorLidResponseMixinGroup
                    .value.addParticipantsParticipantMixins;
        } catch (err) {
            data.code = 400;
            return data;
        }

        if (rpcResult.name === 'AddParticipantsResponseSuccess') {
            const code = resultArgs?.value.error || '200';
            data.name = resultArgs?.name;
            data.code = +code;
            data.inviteV4Code = resultArgs?.value.addRequestCode;
            data.inviteV4CodeExp =
                resultArgs?.value.addRequestExpiration?.toString();
        } else if (rpcResult.name === 'AddParticipantsResponseClientError') {
            const { code: code } =
                rpcResult.value.errorAddParticipantsClientErrors.value;
            data.code = +code;
        } else if (rpcResult.name === 'AddParticipantsResponseServerError') {
            const { code: code } = rpcResult.value.errorServerErrors.value;
            data.code = +code;
        }

        return data;
    };

    window.WWebJS.membershipRequestAction = async (
        groupId,
        action,
        requesterIds,
        sleep,
    ) => {
        const groupWid = window.require('WAWebWidFactory').createWid(groupId);
        const group = await window
            .require('WAWebCollections')
            .Chat.find(groupWid);
        const toApprove = action === 'Approve';
        let membershipRequests;
        let response;
        let result = [];

        await window
            .require('WAWebGroupQueryJob')
            .queryAndUpdateGroupMetadataById({ id: groupId });

        if (!requesterIds?.length) {
            membershipRequests =
                group.groupMetadata.membershipApprovalRequests._models.map(
                    ({ id }) => id,
                );
        } else {
            !Array.isArray(requesterIds) && (requesterIds = [requesterIds]);
            membershipRequests = requesterIds.map((r) =>
                window.require('WAWebWidFactory').createWid(r),
            );
        }

        if (!membershipRequests.length) return [];

        const participantArgs = membershipRequests.map((m) => ({
            participantArgs: [
                {
                    participantJid: window
                        .require('WAWebWidToJid')
                        .widToUserJid(m),
                },
            ],
        }));

        const groupJid = window
            .require('WAWebWidToJid')
            .widToGroupJid(groupWid);

        const _getSleepTime = (sleep) => {
            if (
                !Array.isArray(sleep) ||
                (sleep.length === 2 && sleep[0] === sleep[1])
            ) {
                return sleep;
            }
            if (sleep.length === 1) {
                return sleep[0];
            }
            sleep[1] - sleep[0] < 100 &&
                (sleep[0] = sleep[1]) &&
                (sleep[1] += 100);
            return (
                Math.floor(Math.random() * (sleep[1] - sleep[0] + 1)) + sleep[0]
            );
        };

        const membReqResCodes = {
            default: `An unknown error occupied while ${toApprove ? 'approving' : 'rejecting'} the participant membership request`,
            400: 'ParticipantNotFoundError',
            401: 'ParticipantNotAuthorizedError',
            403: 'ParticipantForbiddenError',
            404: 'ParticipantRequestNotFoundError',
            408: 'ParticipantTemporarilyBlockedError',
            409: 'ParticipantConflictError',
            412: 'ParticipantParentLinkedGroupsResourceConstraintError',
            500: 'ParticipantResourceConstraintError',
        };

        try {
            for (const participant of participantArgs) {
                response = await window
                    .require('WASmaxGroupsMembershipRequestsActionRPC')
                    .sendMembershipRequestsActionRPC({
                        iqTo: groupJid,
                        [toApprove ? 'approveArgs' : 'rejectArgs']: participant,
                    });

                if (
                    response.name === 'MembershipRequestsActionResponseSuccess'
                ) {
                    const value = toApprove
                        ? response.value.membershipRequestsActionApprove
                        : response.value.membershipRequestsActionReject;
                    if (value?.participant) {
                        const [_] = value.participant.map((p) => {
                            const error = toApprove
                                ? value.participant[0]
                                      .membershipRequestsActionAcceptParticipantMixins
                                      ?.value.error
                                : value.participant[0]
                                      .membershipRequestsActionRejectParticipantMixins
                                      ?.value.error;
                            return {
                                requesterId: (() => {
                                    const _w = window
                                        .require('WAWebWidFactory')
                                        .createWid(p.jid);
                                    return _w._serialized || _w.$1;
                                })(),
                                ...(error
                                    ? {
                                          error: +error,
                                          message:
                                              membReqResCodes[error] ||
                                              membReqResCodes.default,
                                      }
                                    : {
                                          message: `${toApprove ? 'Approved' : 'Rejected'} successfully`,
                                      }),
                            };
                        });
                        _ && result.push(_);
                    }
                } else {
                    result.push({
                        requesterId: (() => {
                            const _w = window
                                .require('WAWebJidToWid')
                                .userJidToUserWid(
                                    participant.participantArgs[0]
                                        .participantJid,
                                );
                            return _w._serialized || _w.$1;
                        })(),
                        message: 'ServerStatusCodeError',
                    });
                }

                sleep &&
                    participantArgs.length > 1 &&
                    participantArgs.indexOf(participant) !==
                        participantArgs.length - 1 &&
                    (await new Promise((resolve) =>
                        setTimeout(resolve, _getSleepTime(sleep)),
                    ));
            }
            return result;
        } catch (err) {
            return [];
        }
    };

    window.WWebJS.subscribeToUnsubscribeFromChannel = async (
        channelId,
        action,
        options = {},
    ) => {
        const channel = await window.WWebJS.getChat(channelId, {
            getAsModel: false,
        });

        if (!channel || channel.newsletterMetadata.membershipType === 'owner')
            return false;
        options = {
            eventSurface: 3,
            deleteLocalModels: options.deleteLocalModels ?? true,
        };

        try {
            if (action === 'Subscribe') {
                await window
                    .require('WAWebNewsletterSubscribeAction')
                    .subscribeToNewsletterAction(channel, options);
            } else if (action === 'Unsubscribe') {
                await window
                    .require('WAWebNewsletterUnsubscribeAction')
                    .unsubscribeFromNewsletterAction(channel, options);
            } else return false;
            return true;
        } catch (err) {
            if (err.name === 'ServerStatusCodeError') return false;
            throw err;
        }
    };

    window.WWebJS.pinUnpinMsgAction = async (msgId, action, duration) => {
        const message =
            window.require('WAWebCollections').Msg.get(msgId) ||
            (
                await window
                    .require('WAWebCollections')
                    .Msg.getMessagesById([msgId])
            )?.messages?.[0];
        if (!message) return false;

        if (typeof duration !== 'number') return false;

        const originalFunction = window.require(
            'WAWebPinMsgConstants',
        ).getPinExpiryDuration;
        window.require('WAWebPinMsgConstants').getPinExpiryDuration = () =>
            duration;

        const response = await window
            .require('WAWebSendPinMessageAction')
            .sendPinInChatMsg(message, action, duration);

        window.require('WAWebPinMsgConstants').getPinExpiryDuration =
            originalFunction;

        return response.messageSendResult === 'OK';
    };

    window.WWebJS.getStatusModel = (status) => {
        const res = status.serialize();
        delete res._msgs;
        return res;
    };

    window.WWebJS.getAllStatuses = () => {
        const statuses = window
            .require('WAWebCollections')
            .Status.getModelsArray();
        return statuses.map((status) => window.WWebJS.getStatusModel(status));
    };

    window.WWebJS.enforceLidAndPnRetrieval = async (userId) => {
        const wid = window.require('WAWebWidFactory').createWid(userId);
        const isLid = wid.server === 'lid';

        let lid = isLid
            ? wid
            : window.require('WAWebApiContact').getCurrentLid(wid);
        let phone = isLid
            ? window.require('WAWebApiContact').getPhoneNumber(wid)
            : wid;

        if (!isLid && !lid) {
            const queryResult = await window
                .require('WAWebQueryExistsJob')
                .queryWidExists(wid);
            if (!queryResult?.wid) return {};
            lid = window.require('WAWebApiContact').getCurrentLid(wid);
        }

        if (isLid && !phone) {
            const queryResult = await window
                .require('WAWebQueryExistsJob')
                .queryWidExists(wid);
            if (!queryResult?.wid) return {};
            phone = window.require('WAWebApiContact').getPhoneNumber(wid);
        }

        return { lid, phone };
    };

    window.WWebJS.assertColor = (hex) => {
        let color;
        if (typeof hex === 'number') {
            color = hex > 0 ? hex : 0xffffffff + parseInt(hex) + 1;
        } else if (typeof hex === 'string') {
            let number = hex.trim().replace('#', '');
            if (number.length <= 6) {
                number = 'FF' + number.padStart(6, '0');
            }
            color = parseInt(number, 16);
        } else {
            throw 'Invalid hex color';
        }
        return color;
    };
};
