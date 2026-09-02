'use strict';

/**
 * Forwards WhatsApp's own logger to the host.
 *
 * WhatsApp explains its terminal decisions in plain text through `WALogger`,
 * and that text is the only place some failures are ever named. Forwarding all
 * of it is not an option (it is thousands of lines a day per client), so ERROR
 * and WARN are matched by keyword and LOG is matched against exact prefixes.
 *
 * The storage vocabulary is in the keyword set on purpose. A logout carrying
 * `logout_reason=0` (CLIENT_FATAL) can only come from the storage layer, and
 * every line WhatsApp writes on that path talks about storage, schemas or
 * databases - so a keyword set without those words is guaranteed to drop the
 * explanation for exactly the failure that destroys a session.
 *
 * The pattern and the prefix list are passed in as evaluate() arguments rather
 * than read from module scope: evaluate serialises the function alone, so a
 * closure over a module constant arrives in the page as undefined.
 */

// ERROR/WARN. These levels are rare by construction, so keywords are safe here.
const WAL_KEYWORDS =
    /logout|socket|stream|sync|salt|integrity|session|deregister|conflict|ban|offline|resume|bootstrap|unpair|noise|companion|expire|adv|primary|identity|checkpoint|passkey|kicked|storage initialization|schema version|model storage|signal storage|worker storage|status storage|fts storage|jobs storage|offd storage|dexie|indexeddb|clearcredentials|clearalllocalstate/i;

// Terminal at ANY level. This is DiagHooks' set, moved here because this hook
// now installs first and its __p2dWrapped guard makes DiagHooks' copy a no-op -
// leaving it there would have silently dropped the coverage it already gives us,
// including the one line that names the storage decision.
const WAL_TERMINAL =
    /logging out|logged out|device removed|fatal error|failure stanza|dirty bit|identity changed|native logout failed|forced logout/i;

// LOG is high-volume, so it is matched against exact prefixes rather than
// keywords. Each of these fires at most a handful of times per page load, and
// each one is either a terminal decision or the schema table that explains it.
const WAL_LOG_PREFIXES = [
    'storage initialization error, logging out',
    '[storage] start load schema versions',
    '[storage] set schema versions: ',
    '[reload] reloadAfterLogout errorDuringStorageClear=',
];

/** True when a WALogger line at `level` should be forwarded. Pure, so testable. */
const shouldForwardWaLoggerLine = (level, message) =>
    WAL_TERMINAL.test(message) ||
    (level === 'LOG'
        ? WAL_LOG_PREFIXES.some((prefix) => message.startsWith(prefix))
        : WAL_KEYWORDS.test(message));

const InjectWaLoggerHook = (keywordSource, logPrefixes, terminalSource) => {
    const WAL = window.require('WALogger');
    if (!WAL) return;

    const keywords = new RegExp(keywordSource, 'i');
    const terminal = new RegExp(terminalSource, 'i');
    const socketState = () => {
        const model = window.require('WAWebSocketModel');
        return model ? String(model.Socket.state) : undefined;
    };

    // WALogger's first argument is a tagged-template array; the substitutions
    // arrive as the remaining arguments, and for `set schema versions` they are
    // the schema table itself, which is the whole reason to capture that line.
    const render = (args) => {
        const head = args[0];
        return Array.isArray(head) ? head.join('{}') : String(head);
    };
    const renderArgs = (args) => {
        const rest = Array.prototype.slice.call(args, 1, 3);
        if (!rest.length) return undefined;
        try {
            return JSON.stringify(rest).slice(0, 300);
        } catch (e) {
            return String(rest).slice(0, 300);
        }
    };

    ['ERROR', 'WARN', 'LOG'].forEach((lvl) => {
        const orig = WAL[lvl];
        if (typeof orig !== 'function' || orig.__p2dWrapped) return;
        const wrapped = function () {
            try {
                const msg = render(arguments);
                const isTerminal = terminal.test(msg);
                const hit =
                    isTerminal ||
                    (lvl === 'LOG'
                        ? logPrefixes.some((p) => msg.startsWith(p))
                        : keywords.test(msg));
                if (hit) {
                    window.onSocketDiagEvent({
                        event: 'WA_INTERNAL_' + lvl,
                        terminal: isTerminal,
                        msg: msg.slice(0, 300),
                        args: renderArgs(arguments),
                        state: socketState(),
                    });
                }
            } catch (e) {
                // best-effort diagnostic: never let it break the caller
            }
            return orig.apply(this, arguments);
        };
        wrapped.__p2dWrapped = true;
        WAL[lvl] = wrapped;
    });
};

module.exports = {
    InjectWaLoggerHook,
    WAL_KEYWORDS,
    WAL_TERMINAL,
    WAL_LOG_PREFIXES,
    shouldForwardWaLoggerLine,
};
