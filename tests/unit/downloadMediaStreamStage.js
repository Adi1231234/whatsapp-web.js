const { expect } = require('chai');
const Message = require('../../src/structures/Message');
const { MediaFetchError } = require('../../src/util/MediaFetchError');

/**
 * The one link between the page and the host.
 *
 * `resolveMediaBlob` reports why a fetch produced nothing by RETURNING a stage,
 * because an in-page throw loses its properties at the puppeteer boundary. This
 * is where that stage becomes the typed error the host switches on - and until
 * this test it was the only step in the stall path never actually executed:
 * the page side was verified live, the host side by unit test, and the join
 * between them only by reading.
 */
function messageWith(pageResult) {
    const handle = {
        async evaluate(fn, msgId) {
            // puppeteer runs this in the page against the resolved value.
            return fn(pageResult, msgId);
        },
        async getProperty() {
            return { async evaluate() {}, async dispose() {} };
        },
        async dispose() {},
    };
    return {
        hasMedia: true,
        id: { _serialized: 'false_1@c.us_ABC' },
        client: {
            pupPage: {
                async evaluateHandle() {
                    return handle;
                },
            },
            emit() {},
        },
        downloadMediaStream: Message.prototype.downloadMediaStream,
    };
}

describe('downloadMediaStream: the stage reaches the host', function () {
    it('turns a stalled page result into MediaFetchError("STALLED")', async function () {
        // Exactly what resolveMediaBlob returns after the watchdog cancels.
        const msg = messageWith({ blob: null, stage: 'STALLED' });

        let thrown = null;
        try {
            await msg.downloadMediaStream();
        } catch (err) {
            thrown = err;
        }

        expect(thrown).to.be.instanceOf(MediaFetchError);
        // The host retries on this exact value; `FETCHING` it is not.
        expect(thrown.stage).to.equal('STALLED');
        expect(thrown.name).to.equal('MediaFetchError');
    });

    it('carries every other stage through unchanged', async function () {
        for (const stage of ['NEED_POKE', 'ERROR_MISSING', null]) {
            const msg = messageWith({ blob: null, stage });
            let thrown = null;
            try {
                await msg.downloadMediaStream();
            } catch (err) {
                thrown = err;
            }
            expect(thrown, String(stage)).to.be.instanceOf(MediaFetchError);
            expect(thrown.stage, String(stage)).to.equal(stage);
        }
    });

    it('reports INIT when the message has no media at all', async function () {
        const msg = messageWith({ blob: null, stage: 'STALLED' });
        msg.hasMedia = false;

        let thrown = null;
        try {
            await msg.downloadMediaStream();
        } catch (err) {
            thrown = err;
        }
        expect(thrown).to.be.instanceOf(MediaFetchError);
        expect(thrown.stage).to.equal('INIT');
    });
});
