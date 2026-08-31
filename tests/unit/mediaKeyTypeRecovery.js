const { expect } = require('chai');
const {
    CANDIDATE_MEDIA_TYPES,
    candidateTypesFor,
    isKeyTypeMismatch,
} = require('../../src/util/MediaKeyTypeRecovery');
const {
    MediaFailReason,
    ALL_MEDIA_FAIL_REASONS,
    isMediaFailReason,
} = require('../../src/util/MediaFailReasons');

describe('MediaKeyTypeRecovery', function () {
    describe('candidateTypesFor', function () {
        it('never re-tries the type that already failed', function () {
            for (const declared of CANDIDATE_MEDIA_TYPES) {
                expect(candidateTypesFor(declared)).to.not.include(declared);
            }
        });

        it('tries image first for a document, the only case seen in production', function () {
            expect(candidateTypesFor('document')[0]).to.equal('image');
        });

        it('covers every other candidate, so a new confusion pair is still found', function () {
            expect(candidateTypesFor('document')).to.have.members([
                'image',
                'video',
                'audio',
            ]);
        });

        it('leaves the list untouched for a type that is not a candidate', function () {
            expect(candidateTypesFor('sticker')).to.deep.equal(
                CANDIDATE_MEDIA_TYPES,
            );
        });
    });

    describe('isKeyTypeMismatch', function () {
        it('accepts the exact production failure', function () {
            expect(
                isKeyTypeMismatch(
                    'MediaDecryptionError',
                    'decryptMedia: hmac mismatch',
                ),
            ).to.equal(true);
        });

        it('rejects the 404 that is 92% of decrypt failures fleet-wide', function () {
            expect(
                isKeyTypeMismatch('MediaNotFoundError', 'mmsDownload: 404'),
            ).to.equal(false);
        });

        it('rejects a plaintext hash mismatch: the bytes are wrong, not the type', function () {
            expect(
                isKeyTypeMismatch(
                    'MediaDecryptionError',
                    'decryptMedia: plaintext hash mismatch',
                ),
            ).to.equal(false);
        });

        it('rejects the right message under the wrong error name', function () {
            expect(isKeyTypeMismatch('TypeError', 'hmac mismatch')).to.equal(
                false,
            );
        });

        it('survives a missing or non-string message', function () {
            expect(isKeyTypeMismatch('MediaDecryptionError', null)).to.equal(
                false,
            );
            expect(
                isKeyTypeMismatch('MediaDecryptionError', undefined),
            ).to.equal(false);
        });
    });

    describe('MediaFailReason', function () {
        it('is its own key, so a code never drifts from its name', function () {
            for (const key of ALL_MEDIA_FAIL_REASONS) {
                expect(MediaFailReason[key]).to.equal(key);
            }
        });

        it('recognises only its own codes', function () {
            expect(isMediaFailReason('NO_BLOB')).to.equal(true);
            expect(isMediaFailReason('nope')).to.equal(false);
            expect(isMediaFailReason(undefined)).to.equal(false);
        });
    });
});
