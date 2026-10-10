const { expect } = require('chai');
const { ListMediaRefsSince } = require('../../src/util/Injected/MediaRefs');
const { evaluateInPage } = require('./evaluateBoundary');
const { installGateway } = require('./waGateway/fakeWhatsApp');

const SINCE = 1_800_000_000;

/** A stored row as `msgFindMedia` returns it: the id is a MsgKey, not a string. */
const row = (remote, n, t, type = 'image', extra = {}) => ({
    id: {
        remote: { toString: () => remote },
        fromMe: false,
        toString: () => `false_${remote}_${n}`,
    },
    t,
    type,
    ...extra,
});

/**
 * `msgFindMedia` with the shape copied from a live page: each category in the
 * order of WhatsApp's index - the chat's INSERTION id, newest inserted first,
 * which is not send time - cut at `count`, concatenated as media, links,
 * documents, with the three counts beside them. Rows are held in that order.
 */
function page(chats, { shape } = {}) {
    const calls = [];
    // `chat` is the chat's Wid, as the page passes `chat.id`.
    const findMedia = ({ chat: wid, count, direction }) => {
        calls.push({ chat: wid._serialized, count, direction });
        if (shape) return Promise.resolve(shape);
        const held = chats.find((c) => c.id === wid).held;
        const cut = (list) => list.slice(0, count);
        const media = cut(held.media ?? []);
        const links = cut(held.links ?? []);
        const docs = cut(held.docs ?? []);
        return Promise.resolve({
            mediaCount: media.length,
            linkCount: links.length,
            docCount: docs.length,
            messages: [...media, ...links, ...docs],
        });
    };
    const models = chats.map((c) => ({ ...c, id: c.id }));
    global.window = {
        Debug: { VERSION: '2.3000.test' },
        require(name) {
            if (name === 'WAWebDBMessageFindLocal')
                return { msgFindMedia: findMedia };
            if (name === 'WAWebCollections')
                return { Chat: { getModelsArray: () => models } };
            if (name === '__debug') return { modulesMap: {} };
            return undefined;
        },
    };
    installGateway();
    return { calls };
}

const chat = (serialized, t, held) => ({
    id: { _serialized: serialized },
    t,
    held,
});

describe('ListMediaRefsSince', function () {
    afterEach(function () {
        delete global.window;
    });

    it('lists the media of the period from active chats, and nothing else', async function () {
        page([
            chat('a@lid', SINCE + 100, {
                media: [
                    row('a@lid', 'new', SINCE + 50),
                    row('a@lid', 'old', SINCE - 50),
                ],
                links: [row('a@lid', 'link', SINCE + 60, 'chat')],
                docs: [row('a@lid', 'doc', SINCE + 70, 'document')],
            }),
            chat('quiet@lid', SINCE - 1, {
                media: [row('quiet@lid', 'x', SINCE - 10)],
            }),
        ]);

        const { refs, failures, chatsRead } = await evaluateInPage(
            ListMediaRefsSince,
            SINCE,
        );

        expect(chatsRead).to.equal(1);
        expect(failures).to.deep.equal([]);
        expect(refs.map((r) => r.id).sort()).to.deep.equal([
            'false_a@lid_doc',
            'false_a@lid_new',
        ]);
        expect(refs.find((r) => r.id === 'false_a@lid_new')).to.deep.equal({
            id: 'false_a@lid_new',
            remote: 'a@lid',
            fromMe: false,
            t: SINCE + 50,
            type: 'image',
            isGif: false,
            disappearing: false,
        });
    });

    it('reads each active chat once, in full', async function () {
        const media = Array.from({ length: 300 }, (_, i) =>
            row('busy@lid', `m${i}`, SINCE + 1000 - i),
        );
        const { calls } = page([
            chat('busy@lid', SINCE + 1000, { media }),
            chat('small@lid', SINCE + 5, {
                media: [row('small@lid', 'm', SINCE + 5)],
            }),
        ]);

        const { refs } = await evaluateInPage(ListMediaRefsSince, SINCE);

        expect(refs).to.have.length(301);
        expect(calls).to.deep.equal([
            { chat: 'busy@lid', count: Infinity, direction: 'before' },
            { chat: 'small@lid', count: Infinity, direction: 'before' },
        ]);
    });

    // History sync after a re-link writes old messages AFTER newer ones, so the
    // most recently inserted row can be days older than rows behind it. A read
    // that stopped at the first row older than the period would lose these.
    it('lists the period behind an old message that was written late', async function () {
        // A full first page whose last row is the late one: exactly the shape
        // that ended a paged read with the rest of the period unread.
        const inserted = [
            ...Array.from({ length: 63 }, (_, i) =>
                row('late@lid', `recent${i}`, SINCE + 1000 - i),
            ),
            row('late@lid', 'old-written-late', SINCE - 9000),
            ...Array.from({ length: 10 }, (_, i) =>
                row('late@lid', `behind${i}`, SINCE + 10 + i),
            ),
        ];
        page([chat('late@lid', SINCE + 1000, { media: inserted })]);

        const { refs } = await evaluateInPage(ListMediaRefsSince, SINCE);

        expect(refs).to.have.length(73);
        expect(refs.some((r) => r.id === 'false_late@lid_behind0')).to.equal(
            true,
        );
    });

    it('reports a chat it could not read, by name, and still lists the others', async function () {
        page([
            chat('ok@lid', SINCE + 5, {
                media: [row('ok@lid', 'm', SINCE + 5)],
            }),
        ]);
        const good = global.window.require(
            'WAWebDBMessageFindLocal',
        ).msgFindMedia;
        const models = global.window
            .require('WAWebCollections')
            .Chat.getModelsArray();
        models.unshift({ id: { _serialized: 'bad@g.us' }, t: SINCE + 9 });
        global.window.require = (name) => {
            if (name === 'WAWebDBMessageFindLocal')
                return {
                    msgFindMedia: (q) =>
                        q.chat._serialized === 'bad@g.us'
                            ? Promise.resolve([])
                            : good(q),
                };
            if (name === 'WAWebCollections')
                return { Chat: { getModelsArray: () => models } };
            return undefined;
        };

        const { refs, failures } = await evaluateInPage(
            ListMediaRefsSince,
            SINCE,
        );

        expect(refs.map((r) => r.id)).to.deep.equal(['false_ok@lid_m']);
        expect(failures).to.deep.equal([
            {
                chatId: 'bad@g.us',
                reason: 'msgFindMedia did not answer for one chat on WhatsApp Web 2.3000.test',
            },
        ]);
    });

    it('keeps a stored row with no time, so the caller can count it', async function () {
        page([
            chat('n@lid', SINCE + 5, {
                media: [row('n@lid', 'undated', undefined)],
            }),
        ]);

        const { refs } = await evaluateInPage(ListMediaRefsSince, SINCE);

        expect(refs.map((r) => r.t)).to.deep.equal([null]);
    });

    it('marks a disappearing message and a gif', async function () {
        page([
            chat('e@lid', SINCE + 5, {
                media: [
                    row('e@lid', 'gone', SINCE + 2, 'image', {
                        ephemeralDuration: 86400,
                    }),
                    row('e@lid', 'gif', SINCE + 3, 'video', { isGif: true }),
                ],
            }),
        ]);

        const { refs } = await evaluateInPage(ListMediaRefsSince, SINCE);
        const byId = Object.fromEntries(refs.map((r) => [r.id, r]));

        expect(byId['false_e@lid_gone'].disappearing).to.equal(true);
        expect(byId['false_e@lid_gif'].isGif).to.equal(true);
    });

    it('rejects, naming the build, when WhatsApp no longer has the reader', async function () {
        global.window = {
            Debug: { VERSION: '2.3000.moved' },
            require: (name) =>
                name === '__debug' ? { modulesMap: {} } : undefined,
        };
        installGateway();

        let error = null;
        try {
            await evaluateInPage(ListMediaRefsSince, SINCE);
        } catch (e) {
            error = e;
        }

        expect(error?.message).to.equal(
            'msgFindMedia not found on WhatsApp Web 2.3000.moved',
        );
    });
});
