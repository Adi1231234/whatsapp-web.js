'use strict';

const { evaluateInPage } = require('../evaluateBoundary');
const { BINDINGS } = require('../../../src/util/Injected/WaGateway/bindings');
const {
    InstallWaGateway,
} = require('../../../src/util/Injected/WaGateway/install');

/** A function with exactly `arity` declared parameters. */
const fnOf = (arity) =>
    new Function(...Array.from({ length: arity }, (_, i) => `a${i}`), '');

/** A module shaped the way `binding` says the build should have it. */
function moduleFor(binding) {
    const mod = {};
    for (const [name, spec] of Object.entries(binding.exports)) {
        const members = spec.members || [];
        if (spec.kind === 'function') {
            const fn = fnOf(spec.arity || 0);
            members.forEach((m) => (fn.prototype[m] = () => {}));
            mod[name] = fn;
        } else {
            mod[name] = Object.fromEntries(members.map((m) => [m, 'x']));
        }
    }
    return mod;
}

/** Every declared module, healthy, keyed by name. */
const healthyModules = (bindings = BINDINGS) =>
    Object.fromEntries(bindings.map((b) => [b.module, moduleFor(b)]));

/**
 * Installs the real gateway on whatever `global.window` the test built, so
 * injected code under test reaches its fake modules the way it reaches
 * WhatsApp's.
 */
const installGateway = (bindings = BINDINGS) =>
    evaluateInPage(InstallWaGateway, bindings);

module.exports = { healthyModules, installGateway, moduleFor };
