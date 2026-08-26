const { expect } = require('chai');
const {
    InstallConnectionScreenWatcher,
} = require('../../src/util/Injected/ConnectionScreen');

const NORMAL = 'NORMAL';
const MODE = {
    QR: 'QR',
    MAIN: 'MAIN',
    SYNCING: 'SYNCING',
    OFFLINE: 'OFFLINE',
    CONFLICT: 'CONFLICT',
};

/**
 * @param opts.displayInfo   value of the deleted attribute, or undefined for a
 *                           build where WA removed it
 * @param opts.getter        WAWebStreamGetters.getDisplayInfo, or undefined for
 *                           a build that predates the module
 */
function install(opts = {}) {
    const subscriptions = [];
    const stream = {
        mode: opts.mode ?? MODE.MAIN,
        displayInfo: opts.displayInfo,
        on: (events, fn) => subscriptions.push({ events, fn }),
    };
    const modules = {
        WAWebStreamModel: {
            Stream: stream,
            StreamMode: MODE,
            StreamInfo: { NORMAL },
        },
        // WhatsApp's require RETURNS undefined for an unknown module rather than
        // throwing, which is what the fix feature-detects on.
        WAWebStreamGetters: opts.getter && { getDisplayInfo: opts.getter },
    };
    const emitted = [];
    const pageWindow = {
        require: (name) => modules[name],
        onConnectionStateEvent: opts.noBinding
            ? undefined
            : (screen, percent) => emitted.push({ screen, percent }),
    };
    const inPage = (fn) => {
        const previous = global.window;
        global.window = pageWindow;
        try {
            return fn();
        } finally {
            global.window = previous;
        }
    };
    inPage(InstallConnectionScreenWatcher);
    return {
        emitted,
        stream,
        pageWindow,
        notify: () => inPage(subscriptions[0].fn),
        events: subscriptions[0].events.split(' '),
    };
}

const screens = (r) => r.emitted.map((e) => e.screen);

describe('InstallConnectionScreenWatcher', function () {
    it('reads displayInfo from the getter module when WA has moved it', function () {
        // The regression: the attribute is gone, so only the getter can answer.
        const r = install({ displayInfo: undefined, getter: () => NORMAL });
        expect(screens(r)).to.deep.equal(['CONNECTED']);
    });

    it('reads the attribute on builds that still carry it', function () {
        const r = install({ displayInfo: NORMAL, getter: undefined });
        expect(screens(r)).to.deep.equal(['CONNECTED']);
    });

    it('reports LOADING rather than guessing when neither can answer', function () {
        const r = install({ displayInfo: undefined, getter: undefined });
        expect(screens(r)).to.deep.equal(['LOADING']);
    });

    it('maps the non-MAIN stream modes by mode alone', function () {
        for (const [mode, screen] of Object.entries({
            QR: 'QR',
            OFFLINE: 'DISCONNECTED',
            SYNCING: 'LOADING',
            CONFLICT: 'ERROR',
        })) {
            expect(
                screens(install({ mode, getter: () => NORMAL })),
                mode,
            ).to.deep.equal([screen]);
        }
    });

    it('subscribes to the events that still fire, and not to the dead one', function () {
        const r = install({ getter: () => NORMAL });
        expect(r.events).to.have.members([
            'change:mode',
            'change:info',
            'change:obscurity',
            'change:hasSynced',
        ]);
        expect(r.events).to.not.include('change:displayInfo');
    });

    it('re-reports only on a real screen change', function () {
        let displayInfo = NORMAL;
        const r = install({ getter: () => displayInfo });
        r.notify();
        displayInfo = 'CONNECTING';
        r.notify();
        expect(screens(r)).to.deep.equal(['CONNECTED', 'LOADING']);
    });

    // The watcher runs inside a Stream change handler, and a listener that
    // throws aborts the rest of WhatsApp's dispatch for that event.
    it('swallows a throwing getter', function () {
        const r = install({
            getter: () => {
                throw new Error('WA moved it again');
            },
        });
        expect(screens(r)).to.have.lengthOf(0);
    });

    it('swallows a missing binding and reports once it appears', function () {
        const r = install({ getter: () => NORMAL, noBinding: true });
        expect(screens(r)).to.have.lengthOf(0);
        r.pageWindow.onConnectionStateEvent = (screen, percent) =>
            r.emitted.push({ screen, percent });
        r.notify();
        expect(screens(r)).to.deep.equal(['CONNECTED']);
    });
});
