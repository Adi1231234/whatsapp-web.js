const { expect } = require('chai');
const { healthyModules, installGateway } = require('./fakeWhatsApp');

/**
 * A page whose `window.require` serves `modules`, with the gateway on it.
 * Every module required is in `asked`.
 */
function page(modules) {
    const asked = [];
    const reports = [];
    global.window = {
        require: (name) => {
            asked.push(name);
            return modules[name];
        },
        onSocketDiagEvent: (info) => reports.push(info),
    };
    installGateway();
    return { gateway: global.window.WaGateway, asked, reports };
}

describe('WaGateway.registered: whether the loader has a module', function () {
    afterEach(function () {
        delete global.window;
    });

    it('answers from the registry, requiring nothing but it', function () {
        const modules = healthyModules();
        modules.WAWebSocketModel = null;
        delete modules.WAWebAppBootstrap;
        const { gateway, asked } = page(modules);
        expect(gateway.registered('WAWebLoggedOutBootstrap')).to.equal(true);
        expect(gateway.registered('WAWebSocketModel')).to.equal(true);
        expect(gateway.registered('WAWebAppBootstrap')).to.equal(false);
        expect([...new Set(asked)]).to.deep.equal(['__debug']);
    });

    it('reports a module nobody declared, once, as module() does', function () {
        const { gateway, reports } = page(healthyModules());
        expect(gateway.registered('WAWebNobodyDeclared')).to.equal(false);
        gateway.registered('WAWebNobodyDeclared');
        gateway.module('WAWebNobodyDeclared');
        expect(reports.map((r) => r.problems)).to.deep.equal([
            [{ module: 'WAWebNobodyDeclared', problem: 'undeclared' }],
        ]);
    });

    it('answers no, and never throws, where the loader has no registry', function () {
        const modules = healthyModules();
        delete modules.__debug;
        expect(page(modules).gateway.registered('WAWebAppBootstrap')).to.equal(
            false,
        );
    });
});
