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
     * the caller has no way to tell whether it got that far. This asks
     * WhatsApp's own media query instead, and reports whether it reached back.
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
                const { MsgCollection } = window.require('WAWebMsgCollection');
                const chat = await window.WWebJS.getChat(chatId, {
                    getAsModel: false,
                });
                if (!chat) return { messages: [], reachedBack: false };

                const collected = new Map();
                let cursor = undefined;
                let reachedBack = false;

                const absorb = (msgs) => {
                    let added = 0;
                    for (const m of msgs || []) {
                        const key = m.id?.id;
                        if (!key || collected.has(key)) continue;
                        collected.set(key, m);
                        added++;
                    }
                    return added;
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

                for (let page = 0; page < maxPages; page++) {
                    let batch = [];
                    try {
                        const answer = await MsgCollection.queryMedia(
                            chat.id,
                            Infinity,
                            'before',
                            cursor,
                        );
                        batch = Array.isArray(answer)
                            ? answer
                            : answer?.messages || [];
                    } catch (e) {
                        break;
                    }

                    const added = absorb(batch);
                    const all = [...collected.values()];
                    const oldest = all.reduce(
                        (acc, m) => (acc === null || m.t < acc.t ? m : acc),
                        null,
                    );
                    if ((oldest && oldest.t <= since) || historyReaches()) {
                        reachedBack = true;
                        break;
                    }

                    // Nothing new locally. Everything older lives on the phone,
                    // so pull one more page from it before deciding.
                    if (added === 0) {
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
                            reachedBack = !!chat.msgs?.msgLoadState
                                ?.noEarlierMsgs;
                            break;
                        }
                    }
                    cursor = oldest ? oldest.id : cursor;
                }

                const messages = [...collected.values()]
                    // Paging walks PAST `since` - it has to, because that is
                    // how it learns it got there - so the collection holds
                    // media from before the period as well. Only those are
                    // dropped: `!(m.t < since)` keeps a message WhatsApp gave
                    // no `t` for, which the caller can still place.
                    .filter(
                        (m) => MEDIA_TYPES.includes(m.type) && !(m.t < since),
                    )
                    .sort((a, b) => a.t - b.t)
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
