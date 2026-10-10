const { expect } = require('chai');
const { BINDINGS } = require('../../../src/util/Injected/WaGateway/bindings');
const { healthyModules, installGateway } = require('./fakeWhatsApp');

/** A page whose `window.require` serves `modules`, with the gateway on it. */
function page(modules, bindings) {
    const reports = [];
    global.window = {
        require: (name) => modules[name],
        onSocketDiagEvent: (info) => reports.push(info),
        Debug: { VERSION: '2.3000.1' },
    };
    installGateway(bindings);
    return { gateway: global.window.WaGateway, reports };
}

const only = (problems) =>
    problems.map((p) =>
        [p.module, p.export, p.problem, p.member].filter(Boolean).join(' '),
    );

describe('WaGateway: what this library depends on inside WhatsApp', function () {
    afterEach(function () {
        delete global.window;
    });

    it('finds nothing wrong on a build that has everything', function () {
        const { gateway } = page(healthyModules());
        const result = gateway.check();
        expect(result.problems).to.deep.equal([]);
        expect(result.checked).to.equal(BINDINGS.length);
        expect(result.build).to.equal('2.3000.1');
    });

    it('hands back exactly what WhatsApp returns', function () {
        const modules = healthyModules();
        const { gateway } = page(modules);
        expect(gateway.module('WAWebApiDeviceList')).to.equal(
            modules.WAWebApiDeviceList,
        );
    });

    it('names a module that is gone', function () {
        const modules = healthyModules();
        delete modules.WAWebABProps;
        expect(only(page(modules).gateway.check().problems)).to.deep.equal([
            'WAWebABProps module-missing',
        ]);
    });

    it('names an export that moved away', function () {
        const modules = healthyModules();
        delete modules.WAWebApiDeviceList.getAllDeviceLists;
        expect(only(page(modules).gateway.check().problems)).to.deep.equal([
            'WAWebApiDeviceList getAllDeviceLists export-missing',
        ]);
    });

    it('names a function that is no longer one', function () {
        const modules = healthyModules();
        modules.WAWebABProps.getABPropConfigValue = {};
        const [p] = page(modules).gateway.check().problems;
        expect(p).to.include({ problem: 'not-a-function', actual: 'object' });
    });

    it('names a changed argument count where the code reads by position', function () {
        const modules = healthyModules();
        modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync =
            function (a, b) {}; // eslint-disable-line no-unused-vars
        const [p] = page(modules).gateway.check().problems;
        expect(p).to.include({ problem: 'arity', expected: 9, actual: 2 });
    });

    it("names a member gone from a model and from a class's prototype", function () {
        const modules = healthyModules();
        delete modules.WAWebSocketModel.Socket.state;
        delete modules.WAWebAdvDeviceInfoCheckJob.AdvToSystemBridgeImpl
            .prototype.getUsersForExpiration;
        expect(only(page(modules).gateway.check().problems)).to.deep.equal([
            'WAWebAdvDeviceInfoCheckJob AdvToSystemBridgeImpl member-missing getUsersForExpiration',
            'WAWebSocketModel Socket member-missing state',
        ]);
    });

    it('reports a module whose factory throws, and never throws itself', function () {
        const modules = healthyModules();
        const { gateway } = page(
            new Proxy(modules, {
                get: (t, name) => {
                    if (name === 'WAWebWidFactory') throw new Error('boom');
                    return t[name];
                },
            }),
        );
        expect(gateway.module('WAWebWidFactory')).to.equal(undefined);
        const [p] = gateway.check().problems;
        expect(p).to.include({ problem: 'module-throws', error: 'boom' });
    });

    it('lets an optional module be absent', function () {
        const bindings = [
            { module: 'WAWebMaybe', optional: true, exports: {} },
        ];
        expect(page({}, bindings).gateway.check().problems).to.deep.equal([]);
    });

    it('reports a module nobody declared, once', function () {
        const { gateway, reports } = page(healthyModules());
        gateway.module('WAWebSomethingNew');
        gateway.module('WAWebSomethingNew');
        expect(reports).to.have.length(1);
        expect(reports[0]).to.include({
            event: 'WA_GATEWAY_CHECK',
            phase: 'use',
        });
        expect(only(reports[0].problems)).to.deep.equal([
            'WAWebSomethingNew undeclared',
        ]);
    });

    it('checks a lazy module on first use, not on page load', function () {
        const bindings = [
            {
                module: 'WAWebOnDemand',
                lazy: true,
                exports: { go: { kind: 'function' } },
            },
        ];
        const { gateway, reports } = page({ WAWebOnDemand: {} }, bindings);
        expect(gateway.check()).to.include({ checked: 0 });
        gateway.module('WAWebOnDemand');
        gateway.module('WAWebOnDemand');
        expect(reports).to.have.length(1);
        expect(only(reports[0].problems)).to.deep.equal([
            'WAWebOnDemand go export-missing',
        ]);
    });

    it('installs once, however often inject runs', function () {
        const { gateway } = page(healthyModules());
        installGateway();
        expect(global.window.WaGateway).to.equal(gateway);
    });

    it('stays quiet and safe without a way to report', function () {
        global.window = { require: () => undefined };
        installGateway();
        expect(() =>
            global.window.WaGateway.module('WAWebNope'),
        ).to.not.throw();
    });
});
