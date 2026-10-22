'use strict';

/**
 * Keeps a streamed download's bytes intact when the body starts with a byte
 * order mark.
 *
 * With `onData` set, `WAWebHttpExtendedFetch.extendedFetch` reads the body as
 * text (`charset=x-user-defined`) and builds `arrayBuffer()` from
 * `responseText`. XHR decoding sniffs a BOM before it honours that charset, so
 * a body starting `FE FF` or `FF FE` is decoded as UTF-16: (N-2)/2 bytes come
 * back and the download fails its hash check, on every attempt. Encrypted
 * media starts that way about once in 32,768 files.
 *
 * Text decoded byte-for-byte is exactly as long as the body, so a length that
 * differs from `content-length` means the decoding changed it. Only then is
 * the body read again as an ArrayBuffer, which the HTTP cache usually serves.
 */
const InjectStreamedDownloadBytes = () => {
    const http = window.require('WAWebHttpExtendedFetch');
    if (!http || typeof http.extendedFetch !== 'function') return false;
    if (http.extendedFetch.__streamedBytesFixed) return true;

    const orig = http.extendedFetch;
    const reread = async (self, url, options, declared) => {
        const again = await orig.call(self, url, {
            method: options.method,
            headers: options.headers,
            credentials: options.credentials,
            timeout: options.timeout,
            signal: options.signal,
        });
        if (!again.ok) return null;
        const bytes = await again.arrayBuffer();
        return bytes && bytes.byteLength === declared ? bytes : null;
    };

    const wrapped = async function (url, options) {
        const response = await orig.apply(this, arguments);
        if (!options || !options.onData || !response || !response.ok) {
            return response;
        }
        const declared = Number(
            response.headers && response.headers.get('content-length'),
        );
        if (!(declared > 0)) return response;
        if ((await response.text()).length === declared) return response;
        const bytes = await reread(this, url, options, declared);
        if (!bytes) return response;
        return Object.assign({}, response, {
            arrayBuffer: () => Promise.resolve(bytes),
        });
    };
    Object.defineProperty(wrapped, 'length', { value: orig.length });
    wrapped.__streamedBytesFixed = true;
    http.extendedFetch = wrapped;
    return true;
};

module.exports = { InjectStreamedDownloadBytes };
