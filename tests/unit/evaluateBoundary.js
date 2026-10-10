/**
 * Models what `pupPage.evaluate` actually does to an injected function.
 *
 * puppeteer sends `fn.toString()` and re-parses it in the PAGE's global scope,
 * so the function loses every binding from the module it was written in. A test
 * that calls an injected function directly keeps those bindings and therefore
 * cannot see the most likely bug in this whole directory: a module constant read
 * from inside the injected body, which arrives in the page as `undefined`.
 *
 * That is not hypothetical. `StorageDiag` shipped with its two event names read
 * from module scope; every unit test passed and the events would have reached
 * production with `event: undefined`, which nothing downstream can route.
 *
 * `new Function` is the accurate model: the body is compiled in global scope
 * with no access to anything lexically around the original definition.
 */
const evaluateInPage = (fn, ...args) => {
    // eslint-disable-next-line no-new-func
    const rebuilt = new Function(`return (${fn.toString()})`)();
    return rebuilt(...args);
};

module.exports = { evaluateInPage };
