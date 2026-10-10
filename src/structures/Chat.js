'use strict';

const Base = require('./Base');
const Message = require('./Message');

/**
 * Represents a Chat on WhatsApp
 * @extends {Base}
 */
class Chat extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * ID that represents the chat
         * @type {object}
         */
        this.id = Base._normalizeId(data.id);

        /**
         * Title of the chat
         * @type {string}
         */
        this.name = data.formattedTitle;

        /**
         * Indicates if the Chat is a Group Chat
         * @type {boolean}
         */
        this.isGroup = data.isGroup;

        /**
         * Indicates if the Chat is readonly
         * @type {boolean}
         */
        this.isReadOnly = data.isReadOnly;

        /**
         * Amount of messages unread
         * @type {number}
         */
        this.unreadCount = data.unreadCount;

        /**
         * Unix timestamp for when the last activity occurred
         * @type {number}
         */
        this.timestamp = data.t;

        /**
         * Indicates if the Chat is archived
         * @type {boolean}
         */
        this.archived = data.archive;

        /**
         * Indicates if the Chat is pinned
         * @type {boolean}
         */
        this.pinned = !!data.pin;

        /**
         * Indicates if the Chat is locked
         * @type {boolean}
         */
        this.isLocked = data.isLocked;

        /**
         * Indicates if the chat is muted or not
         * @type {boolean}
         */
        this.isMuted = data.isMuted;

        /**
         * Unix timestamp for when the mute expires
         * @type {number}
         */
        this.muteExpiration = data.muteExpiration;

        /**
         * Last message fo chat
         * @type {Message}
         */
        this.lastMessage = data.lastMessage
            ? new Message(this.client, data.lastMessage)
            : undefined;

        return super._patch(data);
    }

    /**
     * Send a message to this chat
     * @param {string|MessageMedia|Location} content
     * @param {MessageSendOptions} [options]
     * @returns {Promise<Message>} Message that was just sent
     */
    async sendMessage(content, options) {
        return this.client.sendMessage(this.id._serialized, content, options);
    }

    /**
     * Sets the chat as seen
     * @returns {Promise<Boolean>} result
     */
    async sendSeen() {
        return this.client.sendSeen(this.id._serialized);
    }

    /**
     * Clears all messages from the chat
     * @returns {Promise<boolean>} result
     */
    async clearMessages() {
        return this.client.pupPage.evaluate((chatId) => {
            return window.WWebJS.sendClearChat(chatId);
        }, this.id._serialized);
    }

    /**
     * Deletes the chat
     * @returns {Promise<Boolean>} result
     */
    async delete() {
        return this.client.pupPage.evaluate((chatId) => {
            return window.WWebJS.sendDeleteChat(chatId);
        }, this.id._serialized);
    }

    /**
     * Archives this chat
     */
    async archive() {
        return this.client.archiveChat(this.id._serialized);
    }

    /**
     * un-archives this chat
     */
    async unarchive() {
        return this.client.unarchiveChat(this.id._serialized);
    }

    /**
     * Pins this chat
     * @returns {Promise<boolean>} New pin state. Could be false if the max number of pinned chats was reached.
     */
    async pin() {
        return this.client.pinChat(this.id._serialized);
    }

    /**
     * Unpins this chat
     * @returns {Promise<boolean>} New pin state
     */
    async unpin() {
        return this.client.unpinChat(this.id._serialized);
    }

    /**
     * Mutes this chat forever, unless a date is specified
     * @param {?Date} unmuteDate Date when the chat will be unmuted, don't provide a value to mute forever
     * @returns {Promise<{isMuted: boolean, muteExpiration: number}>}
     */
    async mute(unmuteDate) {
        const result = await this.client.muteChat(
            this.id._serialized,
            unmuteDate,
        );
        this.isMuted = result.isMuted;
        this.muteExpiration = result.muteExpiration;
        return result;
    }

    /**
     * Unmutes this chat
     * @returns {Promise<{isMuted: boolean, muteExpiration: number}>}
     */
    async unmute() {
        const result = await this.client.unmuteChat(this.id._serialized);
        this.isMuted = result.isMuted;
        this.muteExpiration = result.muteExpiration;
        return result;
    }

    /**
     * Mark this chat as unread
     */
    async markUnread() {
        return this.client.markChatUnread(this.id._serialized);
    }

    /**
     * Loads chat messages, sorted from earliest to latest.
     * @param {Object} searchOptions Options for searching messages. Right now only limit and fromMe is supported.
     * @param {Number} [searchOptions.limit] The amount of messages to return. If no limit is specified, the available messages will be returned. Note that the actual number of returned messages may be smaller if there aren't enough messages in the conversation. Set this to Infinity to load all messages.
     * @param {Boolean} [searchOptions.fromMe] Return only messages from the bot number or vise versa. To get all messages, leave the option undefined.
     * @returns {Promise<Array<Message>>}
     */
    async fetchMessages(searchOptions) {
        let messages = await this.client.pupPage.evaluate(
            async (chatId, searchOptions) => {
                const msgFilter = (m) => {
                    if (m.isNotification) {
                        return false; // dont include notification messages
                    }
                    if (
                        searchOptions &&
                        searchOptions.fromMe !== undefined &&
                        m.id.fromMe !== searchOptions.fromMe
                    ) {
                        return false;
                    }
                    return true;
                };

                const chat = await window.WWebJS.getChat(chatId, {
                    getAsModel: false,
                });
                let msgs = chat.msgs.getModelsArray().filter(msgFilter);

                if (searchOptions && searchOptions.limit > 0) {
                    while (msgs.length < searchOptions.limit) {
                        // `loadEarlierMsgs` takes ONE options object. Passing
                        // positional arguments leaves its `chat` undefined and
                        // throws on `waitForChatLoading`, so every paging call
                        // here used to fail.
                        const loadedMessages = await window
                            .require('WAWebChatLoadMessages')
                            .loadEarlierMsgs({
                                chat,
                                msgCollection: chat.msgs,
                            });
                        if (!loadedMessages || !loadedMessages.length) break;
                        msgs = [...loadedMessages.filter(msgFilter), ...msgs];
                    }

                    if (msgs.length > searchOptions.limit) {
                        msgs.sort((a, b) => (a.t > b.t ? 1 : -1));
                        msgs = msgs.splice(msgs.length - searchOptions.limit);
                    }
                }

                return msgs.map((m) => window.WWebJS.getMessageModel(m));
            },
            this.id._serialized,
            searchOptions,
        );

        return messages.map((m) => new Message(this.client, m));
    }

    /**
     * Loads this chat's media messages back to a point in time.
     *
     * `fetchMessages` spends its budget on message COUNT, so in a chatty chat
     * the limit is consumed by text long before it reaches a given moment, and
     * the caller has no way to tell whether it got that far. This reads the
     * chat's media from WhatsApp's local database instead, and reports whether
     * it reached back. It rejects, rather than returning nothing, when that
     * database query cannot be found, does not answer for this one chat, or
     * finds a message WhatsApp then will not load.
     *
     * @param {number} sinceTimestamp Unix seconds to reach back to.
     * @param {Object} [options]
     * @param {number} [options.maxPages] Paging attempts before giving up.
     * @returns {Promise<{messages: Array<Message>, reachedBack: boolean}>}
     * `messages` holds only the media of the period itself, oldest first.
     * `reachedBack` is true when a message older than `sinceTimestamp` was
     * seen, or the chat has no earlier messages at all - either way nothing in
     * the period can be missing.
     */
    async fetchMediaSince(sinceTimestamp, options = {}) {
        const result = await this.client.pupPage.evaluate(
            async (chatId, since, maxPages) => {
                const MEDIA_TYPES = [
                    'image',
                    'video',
                    'document',
                    'audio',
                    'ptt',
                    'sticker',
                ];
                const chat = await window.WWebJS.getChat(chatId, {
                    getAsModel: false,
                });
                if (!chat) return { messages: [], reachedBack: false };

                // `msgFindMedia` sits below the `queryMedia` wrapper, which
                // WhatsApp moved between modules; it has kept its name and
                // contract. If its module moves too, find it by its export.
                const findMedia = (() => {
                    const known = window.require('WAWebDBMessageFindLocal');
                    if (typeof known?.msgFindMedia === 'function')
                        return known.msgFindMedia;
                    const modules = window.require('__debug')?.modulesMap || {};
                    for (const id of Object.keys(modules)) {
                        const m = modules[id];
                        const found = [m?.exports, m?.defaultExport].find(
                            (e) => typeof e?.msgFindMedia === 'function',
                        );
                        if (found) return found.msgFindMedia;
                    }
                    return null;
                })();
                if (!findMedia)
                    throw new Error(
                        `msgFindMedia not found on WhatsApp Web ${window.Debug?.VERSION}`,
                    );
                // No mediaType: "allMedia" ignores `chat` and answers for
                // the whole account. Only the per-chat query answers with
                // counts beside the rows; the account-wide ones answer with
                // a bare array.
                const localMedia = async () => {
                    const answer = await findMedia({
                        chat: chat.id,
                        count: Infinity,
                        direction: 'before',
                    });
                    if (
                        Array.isArray(answer) ||
                        !Array.isArray(answer?.messages)
                    )
                        throw new Error(
                            `msgFindMedia did not answer for one chat on WhatsApp Web ${window.Debug?.VERSION}`,
                        );
                    return answer.messages;
                };

                const collected = new Map();
                let reachedBack = false;

                const absorb = (msgs) => {
                    for (const m of msgs || []) {
                        const key = m.id?.toString();
                        if (key && !collected.has(key)) collected.set(key, m);
                    }
                };

                // The question is whether the whole PERIOD is visible, not
                // whether it happens to contain old media. A chat with three
                // pictures, all recent, is fully covered: its loaded history
                // reaches past `since` and there is nothing older to find.
                // Answering on media alone called such a chat a gap - on a real
                // account, 31 chats out of 54 for a seven-day window.
                const historyReaches = () => {
                    const loaded = chat.msgs?.getModelsArray?.() ?? [];
                    return loaded.some((m) => m.t <= since);
                };

                // One read returns every media message the database holds for
                // the chat. When none is older than `since`, load earlier
                // messages into the chat until its history shows the period is
                // covered.
                absorb(await localMedia());
                const oldest = [...collected.values()].reduce(
                    (acc, m) => (acc === null || m.t < acc.t ? m : acc),
                    null,
                );
                for (let page = 0; page < maxPages; page++) {
                    if ((oldest && oldest.t <= since) || historyReaches()) {
                        reachedBack = true;
                        break;
                    }
                    if (chat.msgs?.msgLoadState?.noEarlierMsgs) {
                        // There is nothing older to find anywhere.
                        reachedBack = true;
                        break;
                    }
                    const pulled = await window
                        .require('WAWebChatLoadMessages')
                        .loadEarlierMsgs({
                            chat,
                            msgCollection: chat.msgs,
                        });
                    // Nothing came back for one of two opposite reasons.
                    // `loadEarlierMsgs` sets `noEarlierMsgs` itself the
                    // moment it establishes there is nothing older, and
                    // returns `[]` in the same breath - so the flag, not
                    // the empty array, is what says whether the period is
                    // covered. Reading the array alone reported "could not
                    // read back far enough" for every chat whose history
                    // simply ends.
                    if (!pulled || !pulled.length) {
                        reachedBack = !!chat.msgs?.msgLoadState?.noEarlierMsgs;
                        break;
                    }
                }
                // The last page loaded may be the one that reached.
                reachedBack = reachedBack || historyReaches();

                // Database rows are not models: hydrate the period's media
                // into the store, where the rest of the library can use them.
                // `!(m.t < since)` keeps a row WhatsApp gave no `t` for, so it
                // is reported below rather than skipped.
                const wanted = [...collected.values()]
                    .filter(
                        (m) => MEDIA_TYPES.includes(m.type) && !(m.t < since),
                    )
                    .sort((a, b) => a.t - b.t)
                    .map((m) => m.id.toString());
                const Msg = window.require('WAWebCollections').Msg;
                // A reply's quote stand-in counts as not loaded: the row is
                // read into it, so the caller gets the message and its `t`.
                const loadedMsg = window.WWebJS.getLoadedMsg;
                const missing = wanted.filter((id) => !loadedMsg(id));
                const loaded = missing.length
                    ? (await Msg.getMessagesById(missing)).messages
                    : [];
                const byId = new Map(loaded.map((m) => [m.id.toString(), m]));
                // A model with no `t` is not the stored message - a stand-in
                // the row was not merged into - so it counts as not loaded.
                const withTime = (m) => (m?.t != null ? m : undefined);
                const models = wanted.map((id) =>
                    withTime(loadedMsg(id) || byId.get(id)),
                );
                // An expired disappearing message stays in the database until
                // WhatsApp purges it, but WhatsApp will not load it: it is
                // gone, not lost.
                const disappearing = (id) => {
                    const row = collected.get(id);
                    return !!(row?.ephemeralDuration || row?.afterReadDuration);
                };
                // A message found but not loaded must not read as "nothing
                // there": the caller would move past it for good.
                const lost = wanted.filter(
                    (id, i) => !models[i] && !disappearing(id),
                ).length;
                if (lost)
                    throw new Error(
                        `${lost} of ${wanted.length} media message(s) could not be loaded`,
                    );
                const messages = models
                    .filter(Boolean)
                    .map((m) => window.WWebJS.getMessageModel(m));
                return { messages, reachedBack };
            },
            this.id._serialized,
            sinceTimestamp,
            options.maxPages ?? 10,
        );

        return {
            messages: result.messages.map((m) => new Message(this.client, m)),
            reachedBack: result.reachedBack,
        };
    }

    /**
     * Simulate typing in chat. This will last for 25 seconds.
     */
    async sendStateTyping() {
        return this.client.pupPage.evaluate((chatId) => {
            window.WWebJS.sendChatstate('typing', chatId);
            return true;
        }, this.id._serialized);
    }

    /**
     * Simulate recording audio in chat. This will last for 25 seconds.
     */
    async sendStateRecording() {
        return this.client.pupPage.evaluate((chatId) => {
            window.WWebJS.sendChatstate('recording', chatId);
            return true;
        }, this.id._serialized);
    }

    /**
     * Stops typing or recording in chat immediately.
     */
    async clearState() {
        return this.client.pupPage.evaluate((chatId) => {
            window.WWebJS.sendChatstate('stop', chatId);
            return true;
        }, this.id._serialized);
    }

    /**
     * Returns the Contact that corresponds to this Chat.
     * @returns {Promise<Contact>}
     */
    async getContact() {
        return await this.client.getContactById(this.id._serialized);
    }

    /**
     * Returns array of all Labels assigned to this Chat
     * @returns {Promise<Array<Label>>}
     */
    async getLabels() {
        return this.client.getChatLabels(this.id._serialized);
    }

    /**
     * Add or remove labels to this Chat
     * @param {Array<number|string>} labelIds
     * @returns {Promise<void>}
     */
    async changeLabels(labelIds) {
        return this.client.addOrRemoveLabels(labelIds, [this.id._serialized]);
    }

    /**
     * Gets instances of all pinned messages in a chat
     * @returns {Promise<Array<Message>>}
     */
    async getPinnedMessages() {
        return this.client.getPinnedMessages(this.id._serialized);
    }

    /**
     * Sync chat history conversation
     * @return {Promise<boolean>} True if operation completed successfully, false otherwise.
     */
    async syncHistory() {
        return this.client.syncHistory(this.id._serialized);
    }

    /**
     * Add or edit a customer note
     * @see https://faq.whatsapp.com/1433099287594476
     * @param {string} note The note to add
     * @returns {Promise<void>}
     */
    async addOrEditCustomerNote(note) {
        if (this.isGroup || this.isChannel) return;

        return this.client.addOrEditCustomerNote(this.id._serialized, note);
    }

    /**
     * Get a customer note
     * @see https://faq.whatsapp.com/1433099287594476
     * @returns {Promise<{
     *    chatId: string,
     *    content: string,
     *    createdAt: number,
     *    id: string,
     *    modifiedAt: number,
     *    type: string
     * }>}
     */
    async getCustomerNote() {
        if (this.isGroup || this.isChannel) return null;

        return this.client.getCustomerNote(this.id._serialized);
    }
}

module.exports = Chat;
