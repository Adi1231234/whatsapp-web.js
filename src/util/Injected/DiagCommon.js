'use strict';

/**
 * Diagnostic filter helpers.
 *
 * Browser: InjectDiagCommon is passed to page.evaluate() — the function body
 *          must be self-contained (no outer-scope references).
 * Node:    exports.shouldSkipMsg / shouldSkipReceipt / isStatusOrGroup are
 *          plain requires for Client.js.
 *
 * To keep one source of truth the helpers are written as a string template
 * that both paths evaluate.
 */

/* ---------- shared source (runs in both contexts) ---------- */

const HELPERS_SOURCE = `
function isStatusOrGroup(jid) {
    if (!jid) return false;
    var s = typeof jid === 'string' ? jid : (jid._serialized || jid.user || '');
    return s.indexOf('@g.us') !== -1 || s.indexOf('status@broadcast') !== -1 || s.indexOf('@newsletter') !== -1;
}

function isThumbnailType(type) {
    return typeof type === 'string' && type.indexOf('thumbnail-') === 0;
}

function wid(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    return v._serialized || v.user || (v.$1 && (v.$1._serialized || v.$1.user)) || null;
}

function safeStr(v) {
    if (v == null) return String(v);
    if (typeof v !== 'object') return String(v);
    try {
        var s = JSON.stringify(v);
        return s.length > 500 ? s.slice(0, 500) + '...' : s;
    } catch (e) { return String(v); }
}

function shouldSkipMsg(msg) {
    if (!msg) return false;
    if (msg.fromMe || (msg.id && msg.id.fromMe)) return true;
    if (msg.type === 'sticker') return true;
    if (isThumbnailType(msg.type)) return true;
    if (msg.isStatusV3) return true;
    var from = msg.from ? (typeof msg.from === 'string' ? msg.from : (msg.from._serialized || '')) : '';
    var to = msg.to ? (typeof msg.to === 'string' ? msg.to : (msg.to._serialized || '')) : '';
    var idRemote = (msg.id && msg.id.remote) ? (typeof msg.id.remote === 'string' ? msg.id.remote : (msg.id.remote._serialized || '')) : '';
    if (isStatusOrGroup(from) || isStatusOrGroup(to) || isStatusOrGroup(idRemote)) return true;
    if (!msg.hasMedia && !msg.directPath && !msg.mediaKey) return true;
    return false;
}

function shouldSkipReceipt(receipt) {
    if (!receipt) return false;
    if (receipt.fromMe) return true;
    var from = String(receipt.from || '');
    var to = String(receipt.to || '');
    var chatId = String(receipt.chatId || '');
    if (isStatusOrGroup(from) || isStatusOrGroup(to) || isStatusOrGroup(chatId)) return true;
    if (receipt.type === 'status' || receipt.type === 'other_status') return true;
    if (receipt.msgType === 'sticker') return true;
    var nonMedia = ['text', 'e2e_notification', 'notification_template', 'chat', 'protocol', 'revoked', 'reaction', 'album'];
    if (receipt.msgType && nonMedia.indexOf(receipt.msgType) !== -1) return true;
    return false;
}
`;

/* ---------- Node-side: eval once to get real functions ---------- */

const _node = new Function(HELPERS_SOURCE + `
return { isStatusOrGroup, isThumbnailType, wid, safeStr, shouldSkipMsg, shouldSkipReceipt };
`)();

/* ---------- Browser-side: self-contained function for page.evaluate ---------- */

exports.InjectDiagCommon = new Function(`
${HELPERS_SOURCE}
window.__diag = {
    safeDiagLog: function(level, tag, data) {
        try { window.onDiagLog(level, tag, typeof data === 'string' ? data : JSON.stringify(data)); } catch(e) {}
    },
    safeStr: safeStr,
    wid: wid,
    isStatusOrGroup: isStatusOrGroup,
    isThumbnailType: isThumbnailType,
    shouldSkipMsg: shouldSkipMsg,
    shouldSkipReceipt: shouldSkipReceipt
};
`);

/* ---------- Node exports ---------- */

exports.shouldSkipMsg = _node.shouldSkipMsg;
exports.shouldSkipReceipt = _node.shouldSkipReceipt;
exports.isStatusOrGroup = _node.isStatusOrGroup;
