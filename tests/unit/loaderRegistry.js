'use strict';

/**
 * Gives `modules` the `__debug` module WhatsApp's loader has, read live: its
 * `modulesMap` holds a record per module the loader was told of, with
 * `exports` and `defaultExport` once the module ran and neither before. A
 * module the page never heard of (undefined) has no record; one listed but
 * not ready (null) has one.
 */
function withLoaderRegistry(modules) {
    modules.__debug = {
        get modulesMap() {
            const factory = () => {};
            const recordOf = (mod) =>
                mod === null
                    ? { factory }
                    : { factory, exports: mod, defaultExport: {} };
            return Object.fromEntries(
                Object.entries(modules)
                    .filter(([, mod]) => mod !== undefined)
                    .map(([name, mod]) => [name, recordOf(mod)]),
            );
        },
    };
    return modules;
}

module.exports = { withLoaderRegistry };
