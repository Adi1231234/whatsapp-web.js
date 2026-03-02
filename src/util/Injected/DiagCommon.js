'use strict';

/**
 * Common diagnostic utilities injected into the browser context.
 * Must be evaluated BEFORE Store.js diagnostics and Client.js listeners.
 * Exposes helpers on window.__diag for use by other injected code.
 */
exports.InjectDiagCommon = () => {
    window.__diag = {
        safeDiagLog(level, tag, data) {
            try { window.onDiagLog(level, tag, typeof data === 'string' ? data : JSON.stringify(data)); } catch(e) {}
        },

        safeStr(v) {
            if (v == null) return String(v);
            if (typeof v !== 'object') return String(v);
            try {
                var s = JSON.stringify(v);
                return s.length > 500 ? s.slice(0, 500) + '...' : s;
            } catch (e) { return String(v); }
        },

        wid(v) {
            if (v == null) return null;
            if (typeof v === 'string') return v;
            return v._serialized || v.user || (v.$1 && (v.$1._serialized || v.$1.user)) || null;
        },

        isStatusOrGroup(jid) {
            if (!jid) return false;
            var s = typeof jid === 'string' ? jid : (jid._serialized || jid.user || '');
            return s.indexOf('@g.us') !== -1 || s.indexOf('status@broadcast') !== -1 || s.indexOf('@newsletter') !== -1;
        },

        isThumbnailType(type) {
            return typeof type === 'string' && type.indexOf('thumbnail-') === 0;
        }
    };
};
