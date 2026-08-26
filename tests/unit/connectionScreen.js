const { expect } = require('chai');
const {
    InstallConnectionScreenWatcher,
} = require('../../src/util/Injected/ConnectionScreen');

const SI = {
    OFFLINE: 'OFFLINE',
    OPENING: 'OPENING',
    PAIRING: 'PAIRING',
    SYNCING: 'SYNCING',
    RESUMING: 'RESUMING',
    CONNECTING: 'CONNECTING',
    NORMAL: 'NORMAL',
};
const OB = { SHOW: 'SHOW', OBSCURE: 'OBSCURE', HIDE: 'HIDE' };
const MODE = {
    QR: 'QR',
    MAIN: 'MAIN',
    SYNCING: 'SYNCING',
    OFFLINE: 'OFFLINE',
    CONFLICT: 'CONFLICT',
    PROXYBLOCK: 'PROXYBLOCK',
    TOS_BLOCK: 'TOS_BLOCK',
    SMB_TOS_BLOCK: 'SMB_TOS_BLOCK',
};

// WhatsApp's own getDisplayInfo, transcribed from the live 2.3000.1046055909
// bundle. It is also, line for line, the `S(info, obscurity)` that the deleted
// derived attribute used to call on 2.3000.1045986927 - the only substitution
// being where hasSynced is read from. Both sides of the fix must agree with it.
const waGetDisplayInfo = (S) => {
    switch (S.obscurity) {
        case OB.SHOW:
            return S.info;
        case OB.HIDE:
            return S.hasSynced === true ? SI.NORMAL : SI.CONNECTING;
        case OB.OBSCURE:
            switch (S.info) {
                case SI.OPENING:
                case SI.PAIRING:
                case SI.SYNCING:
                case SI.RESUMING:
                    return SI.CONNECTING;
                default:
                    return S.info;
            }
    }
    return S.info;
};

/**
 * @param build 'current'  WA >= 2.3000.1046055909: getter module, no attribute
 *              'legacy'   WA <= 2.3000.1045986927: attribute, no getter module
 *              'ancient'  attribute only, no WAWebStreamTypes either
 */
function install(build, state) {
    const subscriptions = [];
    const stream = Object.assign({}, state, {
        on: (events, fn) => subscriptions.push({ events, fn }),
    });
    if (build !== 'current') {
        Object.defineProperty(stream, 'displayInfo', {
            get: () => waGetDisplayInfo(stream),
        });
    }
    const modules = {
        WAWebStreamModel: { Stream: stream, StreamMode: MODE, StreamInfo: SI },
        WAWebStreamGetters:
            build === 'current'
                ? { getDisplayInfo: waGetDisplayInfo }
                : undefined,
        WAWebStreamTypes:
            build === 'ancient' ? undefined : { StreamInfo: SI, Obscurity: OB },
    };
    const emitted = [];
    // WhatsApp's require RETURNS undefined for an unknown module; it does not
    // throw. The fix feature-detects on that, so the stub must behave the same.
    const pageWindow = {
        require: (name) => modules[name],
        onConnectionStateEvent: (screen, percent) =>
            emitted.push({ screen, percent }),
    };
    // The watcher and its listener both run in the page, so anything the test
    // invokes later (a change handler) has to see the same window.
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
    return { emitted, subscriptions, stream, inPage };
}

const builds = ['current', 'legacy', 'ancient'];

describe('InstallConnectionScreenWatcher', function () {
    it('reports CONNECTED for a synced account on every build', function () {
        for (const build of builds) {
            const { emitted } = install(build, {
                mode: MODE.MAIN,
                info: SI.NORMAL,
                obscurity: OB.HIDE,
                hasSynced: true,
            });
            expect(emitted, build).to.deep.equal([
                { screen: 'CONNECTED', percent: 0 },
            ]);
        }
    });

    it('agrees with WhatsApp over every info/obscurity/hasSynced combination', function () {
        for (const build of builds) {
            for (const info of Object.values(SI)) {
                for (const obscurity of Object.values(OB)) {
                    for (const hasSynced of [true, false]) {
                        const state = {
                            mode: MODE.MAIN,
                            info,
                            obscurity,
                            hasSynced,
                        };
                        const expected =
                            waGetDisplayInfo(state) === SI.NORMAL
                                ? 'CONNECTED'
                                : 'LOADING';
                        const { emitted } = install(build, state);
                        expect(
                            emitted[0].screen,
                            `${build} ${info}/${obscurity}/${hasSynced}`,
                        ).to.equal(expected);
                    }
                }
            }
        }
    });

    it('maps the non-MAIN stream modes by mode alone', function () {
        const expectations = {
            QR: 'QR',
            OFFLINE: 'DISCONNECTED',
            SYNCING: 'LOADING',
            CONFLICT: 'ERROR',
            PROXYBLOCK: 'ERROR',
            TOS_BLOCK: 'ERROR',
            SMB_TOS_BLOCK: 'ERROR',
        };
        for (const [mode, expected] of Object.entries(expectations)) {
            const { emitted } = install('current', {
                mode,
                info: SI.NORMAL,
                obscurity: OB.HIDE,
                hasSynced: true,
            });
            expect(emitted[0].screen, mode).to.equal(expected);
        }
    });

    it('subscribes to the events that still fire, and not to the dead one', function () {
        const { subscriptions } = install('current', {
            mode: MODE.MAIN,
            info: SI.NORMAL,
            obscurity: OB.HIDE,
            hasSynced: true,
        });
        expect(subscriptions).to.have.lengthOf(1);
        const events = subscriptions[0].events.split(' ');
        expect(events).to.have.members([
            'change:mode',
            'change:info',
            'change:obscurity',
            'change:hasSynced',
        ]);
        // change:displayInfo can never fire where the attribute is gone.
        expect(events).to.not.include('change:displayInfo');
    });

    it('re-reports only on a real screen change', function () {
        const { emitted, subscriptions, stream, inPage } = install('current', {
            mode: MODE.MAIN,
            info: SI.NORMAL,
            obscurity: OB.HIDE,
            hasSynced: true,
        });
        const notify = subscriptions[0].fn;
        inPage(notify);
        expect(emitted, 'unchanged state must not re-report').to.have.lengthOf(
            1,
        );
        stream.hasSynced = false;
        inPage(notify);
        expect(emitted.map((e) => e.screen)).to.deep.equal([
            'CONNECTED',
            'LOADING',
        ]);
    });
});
