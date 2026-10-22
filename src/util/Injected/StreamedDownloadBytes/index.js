'use strict';

const { InjectStreamedDownloadBytes } = require('./inject');

/**
 * Wraps WhatsApp's streaming fetch. Called at inject(), before the first media
 * download, and again once synced in case the module was not loaded yet; it is
 * idempotent. Resolves to whether the wrapper is in place.
 */
const installStreamedDownloadBytes = (page) =>
    page.evaluate(InjectStreamedDownloadBytes).catch(() => false);

module.exports = { installStreamedDownloadBytes };
