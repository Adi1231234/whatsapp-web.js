'use strict';

const { exposeFunctionIfAbsent } = require('./Puppeteer');

/** The binding a page settles a startup wait through. */
const SETTLE_BINDING = 'onStartupWaitSettled';

/**
 * Raised by every startup wait the caller ended with `Client.abortStartup`.
 * Its name is how a caller tells its own decision from a failure.
 */
class StartupAbortedError extends Error {
    constructor(reason) {
        super(`startup aborted: ${reason}`);
        this.name = 'StartupAbortedError';
        this.reason = String(reason);
    }
}

/**
 * In the page, once per document: one AbortController for every startup wait
 * the page holds, and what the waits need. A wait takes `signal(deadlineMs)`,
 * which ends with the caller's abort and, only when `deadlineMs > 0`, after
 * that long; it hands its work to `settle`, which reports the outcome through
 * the binding rather than as the evaluate's value. Self-contained:
 * `page.evaluate` sends this function's source alone.
 */
function InstallStartupWaitsInPage(binding) {
    const held = window.__wwebjsStartup;
    if (held && !held.controller.signal.aborted) return;
    const controller = new AbortController();
    window.__wwebjsStartup = {
        controller,
        signal: (deadlineMs) =>
            deadlineMs > 0
                ? AbortSignal.any([
                      controller.signal,
                      AbortSignal.timeout(deadlineMs),
                  ])
                : controller.signal,
        abortedByCaller: () => controller.signal.aborted,
        settle: (id, work) => {
            Promise.resolve()
                .then(work)
                .then(
                    (value) => window[binding](id, true, value),
                    (err) =>
                        window[binding](
                            id,
                            false,
                            String((err && err.message) || err),
                        ),
                );
        },
        abort: (reason) => controller.abort(new Error(String(reason))),
    };
}

/**
 * The waits `inject()` makes before WhatsApp is up, owned by the caller.
 *
 * - **Deadline:** each wait takes `deadlineMs`; 0 means none. A fixed budget
 *   cannot tell a WhatsApp still working from a stuck one: a build of
 *   2026-11-20 held its storage for minutes on its first start, and a 30 s
 *   budget tried, failed and tore down a working page, three times.
 * - **Abort:** `abort(page, reason)` ends every wait at once, in the page
 *   too, so its listeners are detached with it.
 * - **Transport:** a wait never rides one `page.evaluate`. The connection's
 *   `protocolTimeout` cuts any single call, so the evaluate returns at once
 *   and the page settles the wait through `SETTLE_BINDING`.
 */
class StartupWaits {
    constructor() {
        this._pending = new Map();
        this._next = 0;
        this._caller = new AbortController();
    }

    /** Before an inject's first wait. Ends the waits of the inject it replaces. */
    async begin(page) {
        this._caller.abort(new StartupAbortedError('superseded'));
        this._caller = new AbortController();
        await exposeFunctionIfAbsent(page, SETTLE_BINDING, async (id, ok, v) =>
            this._settle(id, ok, v),
        );
        await page.evaluate(InstallStartupWaitsInPage, SETTLE_BINDING);
    }

    /**
     * Runs `pageWait(id, deadlineMs, ...args)` in the page and resolves with
     * what the page settles. `pageWait` must hand its work to
     * `window.__wwebjsStartup.settle(id, work)` and return at once.
     */
    async run(page, pageWait, deadlineMs, ...args) {
        const id = ++this._next;
        const caller = this._caller.signal;
        const settled = new Promise((resolve, reject) =>
            this._pending.set(id, { resolve, reject }),
        );
        const aborted = new Promise((_, reject) => {
            if (caller.aborted) reject(caller.reason);
            else
                caller.addEventListener('abort', () => reject(caller.reason), {
                    once: true,
                });
        });
        // A hung page answers the evaluate that starts the wait only at the
        // connection's protocolTimeout, so an abort must win that race too.
        const started = page.evaluate(pageWait, id, deadlineMs, ...args);
        // Whichever loses a race below must not surface on its own.
        settled.catch(() => {});
        aborted.catch(() => {});
        started.catch(() => {});
        try {
            await Promise.race([started, aborted]);
            return await Promise.race([settled, aborted]);
        } finally {
            this._pending.delete(id);
        }
    }

    _settle(id, ok, value) {
        const waiter = this._pending.get(id);
        if (!waiter) return;
        if (ok) waiter.resolve(value);
        else waiter.reject(new Error(value));
    }

    /**
     * Ends every wait now, with `reason`, and asks the page to detach them.
     *
     * Synchronous on purpose: the caller is usually about to close a page
     * that may be crashed or hung, and an evaluate on such a page answers
     * only at the connection's `protocolTimeout` (600 s). The waits end here,
     * on this side; the page's part is best effort, and a page that is gone
     * has ended its waits with it.
     */
    abort(page, reason) {
        this._caller.abort(new StartupAbortedError(reason));
        if (!page) return;
        page.evaluate(
            (r) => window.__wwebjsStartup && window.__wwebjsStartup.abort(r),
            String(reason),
        ).catch(() => {});
    }
}

module.exports = {
    StartupWaits,
    StartupAbortedError,
    InstallStartupWaitsInPage,
    SETTLE_BINDING,
};
