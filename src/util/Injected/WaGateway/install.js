'use strict';

/**
 * Installs `window.WaGateway`, the one place this library calls
 * `window.require`. Injected code asks it for a WhatsApp module by name, and it
 * can only be sure of what it was told about: `bindings.js`.
 *
 * - `module(name)`: the module, exactly as `window.require` returns it. A name
 *   missing from the bindings is reported once; a lazy binding is checked on
 *   its first use.
 * - `check()`: every eager binding against the build this page loaded, as
 *   `{ build, checked, problems }`.
 *
 * Reports go through `window.onSocketDiagEvent` as `WA_GATEWAY_CHECK`. It never
 * throws and never changes what WhatsApp returns: a broken binding is the
 * caller's to handle, as it was before the gateway.
 *
 * `pupPage.evaluate` serialises this function alone, so the bindings arrive
 * as an argument.
 */
const InstallWaGateway = (bindings) => {
    if (window.WaGateway) return true;
    const declared = new Map(bindings.map((b) => [b.module, b]));
    const reported = new Set();
    const build = () => (window.Debug ? window.Debug.VERSION : undefined);

    const has = (value, member) =>
        (value !== null && value !== undefined && member in Object(value)) ||
        (typeof value === 'function' &&
            !!value.prototype &&
            member in value.prototype);

    // A module whose factory throws reads as missing to the caller, and as
    // `module-throws` to the check, with the reason.
    const load = (name) => {
        try {
            return { mod: window.require(name) };
        } catch (error) {
            return { error: String((error && error.message) || error) };
        }
    };

    /** What is wrong with one binding on this build; empty when nothing is. */
    const inspect = (binding) => {
        const { mod, error } = load(binding.module);
        if (error !== undefined) {
            return [
                {
                    module: binding.module,
                    problem: 'module-throws',
                    error: error.slice(0, 200),
                },
            ];
        }
        if (!mod) {
            return binding.optional
                ? []
                : [{ module: binding.module, problem: 'module-missing' }];
        }
        const found = [];
        for (const [name, spec] of Object.entries(binding.exports)) {
            const at = { module: binding.module, export: name };
            const value = mod[name];
            if (value === undefined) {
                found.push(Object.assign({ problem: 'export-missing' }, at));
                continue;
            }
            if (spec.kind === 'function' && typeof value !== 'function') {
                found.push(
                    Object.assign(
                        { problem: 'not-a-function', actual: typeof value },
                        at,
                    ),
                );
                continue;
            }
            if (spec.arity !== undefined && value.length !== spec.arity) {
                found.push(
                    Object.assign(
                        {
                            problem: 'arity',
                            expected: spec.arity,
                            actual: value.length,
                        },
                        at,
                    ),
                );
            }
            for (const member of spec.members || []) {
                if (!has(value, member)) {
                    found.push(
                        Object.assign(
                            { problem: 'member-missing', member: member },
                            at,
                        ),
                    );
                }
            }
        }
        return found;
    };

    const report = (problems) => {
        try {
            if (problems.length && window.onSocketDiagEvent) {
                window.onSocketDiagEvent({
                    event: 'WA_GATEWAY_CHECK',
                    phase: 'use',
                    build: build(),
                    checked: 1,
                    problems: problems,
                });
            }
        } catch (ignoredError) {
            // a report must never break the caller
        }
    };

    const moduleOf = (name) => {
        if (!reported.has(name)) {
            const binding = declared.get(name);
            if (!binding) {
                reported.add(name);
                report([{ module: name, problem: 'undeclared' }]);
            } else if (binding.lazy) {
                reported.add(name);
                report(inspect(binding));
            }
        }
        return load(name).mod;
    };

    const check = () => {
        const eager = bindings.filter((b) => !b.lazy);
        const problems = [];
        for (const b of eager) problems.push(...inspect(b));
        return { build: build(), checked: eager.length, problems: problems };
    };

    window.WaGateway = { module: moduleOf, check: check };
    return true;
};

module.exports = { InstallWaGateway };
