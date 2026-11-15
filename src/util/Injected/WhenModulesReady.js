'use strict';

/**
 * `{ ready: true }` once WhatsApp's loader has every named module ready, or
 * `{ ready: false, missing }` when the time runs out first.
 *
 * The loader calls back through `requireLazy` once every named module is
 * ready, so nothing asks `require` again until it answers. `require` answers
 * null for a module listed but not ready (its code not loaded, or it threw)
 * and undefined for one the page never heard of. The loader can defer that
 * callback to its scheduler, so when the time runs out the modules themselves
 * are asked: all of them there is still ready.
 */
exports.WhenModulesReady = (names, timeoutMs) =>
    new Promise((resolve) => {
        const load = (name) => {
            try {
                return window.require(name);
            } catch (ignoredError) {
                return undefined;
            }
        };
        const timeout = AbortSignal.timeout(timeoutMs);
        const onTimeout = () => {
            const missing = names
                .map((name) => ({ name, mod: load(name) }))
                .filter(({ mod }) => mod == null)
                .map(({ name, mod }) => ({
                    module: name,
                    state: mod === null ? 'not-loaded' : 'unknown',
                }));
            resolve({ ready: missing.length === 0, missing });
        };
        timeout.addEventListener('abort', onTimeout, { once: true });
        window.requireLazy(names, () => {
            timeout.removeEventListener('abort', onTimeout);
            resolve({ ready: true, missing: [] });
        });
    });
