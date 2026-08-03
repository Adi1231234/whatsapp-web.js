const { expect } = require('chai');
const {
    rafStarvationRescue,
    MIN_WAIT_MS,
} = require('../../src/util/RafStarvation');

// The shape inject()'s Socket.state evaluate returns, in the starved case.
const starved = (over = {}) =>
    Object.assign(
        {
            need: false,
            state: 'CONNECTED',
            hasSynced: true,
            awaited: true,
            rafTicks: 0,
            waitMs: 6000,
            stateAtStart: 'UNLAUNCHED',
            visibilityAtStart: 'hidden',
            visibilityAtEnd: 'hidden',
        },
        over,
    );

describe('rafStarvationRescue', function () {
    it('reports a wait that awaited, saw zero frames, and outlived the floor', function () {
        const payload = rafStarvationRescue(starved());
        expect(payload).to.not.equal(null);
        expect(payload.waitMs).to.equal(6000);
        expect(payload.rafTicks).to.equal(0);
        expect(payload.stateAtStart).to.equal('UNLAUNCHED');
        expect(payload.stateAtEnd).to.equal('CONNECTED');
        expect(payload.visibilityAtStart).to.equal('hidden');
        expect(payload.minWaitMs).to.equal(MIN_WAIT_MS);
    });

    it('stays silent when the state had already settled', function () {
        // The old code's one immediate evaluation would have returned true, so
        // there was nothing to rescue no matter how few frames fired.
        expect(rafStarvationRescue(starved({ awaited: false }))).to.equal(null);
    });

    it('stays silent when even one frame fired', function () {
        // One frame means the old rAF poller did re-evaluate the predicate.
        expect(rafStarvationRescue(starved({ rafTicks: 1 }))).to.equal(null);
    });

    it('stays silent for a wait shorter than one frame interval', function () {
        // Zero frames across 8ms is not evidence: a healthy document simply had
        // no frame due yet, and the old poller would have resolved at the next.
        expect(rafStarvationRescue(starved({ waitMs: 8 }))).to.equal(null);
    });

    it('stays silent just below the floor and reports exactly at it', function () {
        expect(
            rafStarvationRescue(starved({ waitMs: MIN_WAIT_MS - 1 })),
        ).to.equal(null);
        expect(
            rafStarvationRescue(starved({ waitMs: MIN_WAIT_MS })),
        ).to.not.equal(null);
    });

    it('reports a visible document that still produced no frames', function () {
        // Hidden is the known cause, not a condition of the report - the claim
        // is about frames, so a visible document starved of them still counts.
        const payload = rafStarvationRescue(
            starved({
                visibilityAtStart: 'visible',
                visibilityAtEnd: 'visible',
            }),
        );
        expect(payload).to.not.equal(null);
        expect(payload.visibilityAtStart).to.equal('visible');
    });

    it('does not throw on a missing or malformed result', function () {
        expect(rafStarvationRescue(null)).to.equal(null);
        expect(rafStarvationRescue(undefined)).to.equal(null);
        expect(rafStarvationRescue({})).to.equal(null);
        // waitMs absent must not pass the floor via an undefined comparison
        expect(rafStarvationRescue({ awaited: true, rafTicks: 0 })).to.equal(
            null,
        );
    });
});
