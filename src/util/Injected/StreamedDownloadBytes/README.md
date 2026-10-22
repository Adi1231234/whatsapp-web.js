# StreamedDownloadBytes

Keeps a streamed media download intact when the encrypted file happens to
start with a byte order mark.

## The bug, in WhatsApp Web's own code

For a progressive JPEG, `WAWebDownloadManager` passes an `onData` callback, and
`WAWebHttpExtendedFetch.extendedFetch` then reads the body as text
(`overrideMimeType("text/plain; charset=x-user-defined")`) and builds
`arrayBuffer()` from `responseText`.

XHR decodes text with the Encoding Standard's `decode`, whose first step is a
BOM sniff that overrides the given charset. A body starting `FE FF` or `FF FE`
is therefore decoded as UTF-16, and `arrayBuffer()` returns (N-2)/2 bytes of
garbage:

    download hash mismatch error. downloaded size: <(N-2)/2>
    ImageStreamer: Chunk 0 does not match sidecar

The download fails its hash check, a re-upload request returns the same file,
and the media ends as `NEED_POKE` or `ERROR_MISSING`, on every client and every
attempt. Encrypted bytes start with one of those two pairs in about 1 in 32,768
files.

Measured on build 2.3000.1051351692: a 26,250-byte file starting `FE FF` comes
back as 13,124 bytes through the streaming path, byte-identical to decoding it
as UTF-16BE; the same file with its first byte changed comes back whole; the
plain (non-streaming) path returns it whole.

## The fix

`extendedFetch` is wrapped. When `onData` was set and the decoded text is not
as long as `content-length`, the body is read again with
`responseType = 'arraybuffer'` (normally from the HTTP cache) and that is what
`arrayBuffer()` returns. Bytes decoded with `x-user-defined` are one character
each, so the lengths differ only when the decoding changed the body.

The progressive preview of that one file still fails; the full download, the
hash check and the decryption succeed.
