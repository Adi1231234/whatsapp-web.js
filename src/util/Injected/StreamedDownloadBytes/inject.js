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
    const http = window.WaGateway.module('WAWebHttpExtendedFetch');
    if (!http) return false;

    const reread = async (fetchFn, self, url, options, declared) => {
        const again = await fetchFn.call(self, url, {
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

    return window.WaGateway.wrap(
        'StreamedDownloadBytes',
        http,
        'extendedFetch',
        (orig) =>
            async function (url, options) {
                const response = await orig.apply(this, arguments);
                if (!options || !options.onData || !response || !response.ok) {
                    return response;
                }
                const declared = Number(
                    response.headers && response.headers.get('content-length'),
                );
                const decoded = (await response.text()).length;
                if (!(declared > 0) || decoded === declared) return response;
                const bytes = await reread(orig, this, url, options, declared);
                window.__metrics?.safeDiagLog('info', 'STREAMED_BYTES_REREAD', {
                    declared: declared,
                    decoded: decoded,
                    recovered: !!bytes,
                });
                if (!bytes) return response;
                return Object.assign({}, response, {
                    arrayBuffer: () => Promise.resolve(bytes),
                });
            },
    );
};

module.exports = { InjectStreamedDownloadBytes };
