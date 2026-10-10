'use strict';

/**
 * Lists the media WhatsApp holds in its local database since a moment, without
 * loading a single message.
 *
 * `Chat.fetchMediaSince` answers a different question - it hands back loaded
 * `Message` objects - and pays for it: every row becomes a model, and the
 * chat's history is paged into memory to prove the period is covered. A caller
 * that only wants to know WHICH media exist, to compare against its own record,
 * needs none of that. Measured on a busy account: 236 chats, 2,266 media in four
 * days, listed in 7.7 seconds this way.
 *
 * Reads `WAWebDBMessageFindLocal.msgFindMedia`, the same per-chat index
 * `fetchMediaSince` reads, and never the in-memory `Msg` collection: that
 * collection is what WhatsApp loaded to draw the screen, and it holds stand-ins
 * (a reply's quoted message) that are not stored messages at all.
 *
 * Only chats whose last activity is inside the period are read, each once and
 * in full. The per-chat answer is `{mediaCount, linkCount, docCount, messages}`;
 * the account-wide queries answer with a bare array, and the shape check tells
 * them apart.
 *
 * A chat whose read fails is reported by name with WhatsApp's reason rather
 * than skipped, so a caller can tell "nothing there" from "could not look".
 *
 * Runs in the page: everything it uses must be defined inside it.
 *
 * @param {number} since Unix SECONDS.
 * @returns {Promise<{refs: Array<object>, failures: Array<object>, chatsRead: number}>}
 */
exports.ListMediaRefsSince = async (since) => {
    const MEDIA_TYPES = [
        'image',
        'video',
        'document',
        'audio',
        'ptt',
        'sticker',
    ];
    // Found by export name if its module moves, as `fetchMediaSince` does.
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

    // In full, never in pages. The index is ordered by the chat's insertion id
    // (`["internalId", flag]`, read in reverse), not by send time, so a page
    // whose last row is older than `since` proves nothing about the rows after
    // it: an old message written late - history sync after a re-link - would
    // end the read and hide everything inserted before it.
    const readChat = async (chat) => {
        const answer = await findMedia({
            chat: chat.id,
            count: Infinity,
            direction: 'before',
        });
        if (
            Array.isArray(answer) ||
            !Array.isArray(answer?.messages) ||
            typeof answer.mediaCount !== 'number' ||
            typeof answer.docCount !== 'number'
        )
            throw new Error(
                `msgFindMedia did not answer for one chat on WhatsApp Web ${window.Debug?.VERSION}`,
            );
        return answer.messages;
    };

    const chats = window
        .require('WAWebCollections')
        .Chat.getModelsArray()
        .filter((chat) => chat.t >= since);

    const refs = [];
    const failures = [];
    for (const chat of chats) {
        try {
            for (const m of await readChat(chat)) {
                // `!(t < since)` keeps a row with no `t`, so the caller can
                // count it instead of never hearing of it.
                if (!MEDIA_TYPES.includes(m.type) || m.t < since) continue;
                refs.push({
                    id: m.id.toString(),
                    remote: m.id.remote.toString(),
                    fromMe: !!m.id.fromMe,
                    t: Number.isFinite(m.t) ? m.t : null,
                    type: m.type,
                    isGif: !!m.isGif,
                    disappearing: !!(
                        m.ephemeralDuration || m.afterReadDuration
                    ),
                });
            }
        } catch (error) {
            failures.push({
                chatId: chat.id._serialized,
                reason: String(error?.message ?? error)
                    .split('\n')[0]
                    .slice(0, 300),
            });
        }
    }
    return { refs, failures, chatsRead: chats.length };
};
