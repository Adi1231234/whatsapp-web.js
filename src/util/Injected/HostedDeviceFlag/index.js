'use strict';

const { InjectHostedDeviceFlag, RepairHostedDeviceFlag } = require('./inject');

/** WhatsApp's id for a Cloud API business's hosted device. */
const HOSTED_DEVICE_ID = 99;

/**
 * Wraps the device-list writers. Called at inject(), before the first sync can
 * write, and again once synced in case the module was not loaded yet; it is
 * idempotent. Resolves to whether both writers are wrapped.
 */
const installHostedDeviceFlag = (page) =>
    page.evaluate(InjectHostedDeviceFlag, HOSTED_DEVICE_ID).catch(() => false);

/**
 * Corrects what was stored before the wrapper existed. Once synced, when
 * storage is up; the caller does not need to await it.
 */
const repairHostedDeviceFlag = (page) =>
    page.evaluate(RepairHostedDeviceFlag).catch((e) => ({
        found: null,
        error: String((e && e.message) || e).slice(0, 200),
    }));

module.exports = {
    installHostedDeviceFlag,
    repairHostedDeviceFlag,
    HOSTED_DEVICE_ID,
};
