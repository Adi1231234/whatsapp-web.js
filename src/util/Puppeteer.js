/**
 * Expose a function to the page if it does not exist
 *
 * NOTE:
 * Rewrite it to 'upsertFunction' after updating Puppeteer to 20.6 or higher
 * using page.removeExposedFunction
 * https://pptr.dev/api/puppeteer.page.removeexposedfunction
 *
 * @param {object} page - Puppeteer Page instance
 * @param {string} name
 * @param {Function} fn
 */
async function exposeFunctionIfAbsent(page, name, fn) {
    const exist = await page.evaluate((name) => {
        return !!window[name];
    }, name);
    if (exist) {
        console.warn('[wwjs-diag] exposeFunctionIfAbsent SKIPPED', name);
        return;
    }
    await page.exposeFunction(name, fn);
}

/**
 * Run page.evaluate() with a custom protocol timeout.
 * 
 * Puppeteer-core v24 does not support per-call protocol timeouts for evaluate().
 * This wrapper temporarily intercepts CDPSession.send() to inject a timeout override
 * only for Runtime.callFunctionOn / Runtime.evaluate (the two CDP commands that
 * page.evaluate uses internally), then restores the original send.
 * 
 * Behavior is 100% identical to page.evaluate() — same call chain, same error
 * handling, same return values — only the protocol timeout differs.
 *
 * @param {import('puppeteer').Page} page
 * @param {number} timeoutMs - Protocol timeout in milliseconds
 * @param {Function|string} pageFunction - Function or expression to evaluate
 * @param {...*} args - Arguments to pass to the function
 * @returns {Promise<*>} - Result of the evaluation
 */
async function evaluateWithProtocolTimeout(page, timeoutMs, pageFunction, ...args) {
    const client = page._client();
    const origSend = client.send;
    const wrapper = function (method, params, options) {
        if (method === 'Runtime.callFunctionOn' || method === 'Runtime.evaluate') {
            options = { ...options, timeout: timeoutMs };
        }
        return origSend.call(this, method, params, options);
    };
    client.send = wrapper;
    try {
        return await page.evaluate(pageFunction, ...args);
    } finally {
        if (client.send === wrapper) {
            client.send = origSend;
        }
    }
}

module.exports = { exposeFunctionIfAbsent, evaluateWithProtocolTimeout };
