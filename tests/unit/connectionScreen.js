const { expect } = require('chai');
const {
    InstallConnectionScreenWatcher,
} = require('../../src/util/Injected/ConnectionScreen');

// `displayInfo` is the attribute WA deleted; `getter` is the module it moved to.
// WhatsApp's require returns undefined for an unknown module rather than
// throwing, which is what the code feature-detects on.
function install({ displayInfo, getter } = {}) {
    const emitted = [];
    let subscribed;
    const Stream = {
        mode: 'MAIN',
        displayInfo,
        on: (events) => (subscribed = events.split(' ')),
    };
    global.window = {
        require: (name) =>
            ({
                WAWebStreamModel: {
                    Stream,
                    StreamMode: { MAIN: 'MAIN' },
                    StreamInfo: { NORMAL: 'NORMAL' },
                },
                WAWebStreamGetters: getter && { getDisplayInfo: getter },
            })[name],
        onConnectionStateEvent: (screen) => emitted.push(screen),
    };
    InstallConnectionScreenWatcher();
    return { emitted, subscribed };
}

describe('InstallConnectionScreenWatcher', function () {
    it('resolves through the getter once WA deletes the attribute', function () {
        const { emitted } = install({ getter: () => 'NORMAL' });
        expect(emitted).to.deep.equal(['CONNECTED']);
    });

    it('still reads the attribute on builds that have it', function () {
        const { emitted } = install({ displayInfo: 'NORMAL' });
        expect(emitted).to.deep.equal(['CONNECTED']);
    });

    it('says LOADING rather than guessing when neither answers', function () {
        expect(install().emitted).to.deep.equal(['LOADING']);
    });

    it('subscribes to the live events, never to change:displayInfo', function () {
        expect(install({ getter: () => 'NORMAL' }).subscribed)
            .to.have.members([
                'change:mode',
                'change:info',
                'change:obscurity',
                'change:hasSynced',
            ])
            .and.not.include('change:displayInfo');
    });

    it('cannot throw, because that would abort the WhatsApp dispatch', function () {
        const boom = () => {
            throw new Error('WA moved it again');
        };
        expect(() => install({ getter: boom })).to.not.throw();
        expect(install({ getter: boom }).emitted).to.be.empty;
    });
});
