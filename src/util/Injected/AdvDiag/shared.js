'use strict';

/**
 * Helpers every AdvDiag hook shares, installed once on `window.__p2dAdv`.
 *
 * `pupPage.evaluate` serialises a function alone, so hooks cannot import from
 * each other; installing this first, on the page, keeps each hook one file.
 *
 * Only scalars and short strings leave the page, and a customer's number never
 * leaves in full: users are masked the way WhatsApp's `toLogString` masks them.
 */
const InstallAdvDiagShared = (hostedDeviceId, dayS) => {
    if (window.__p2dAdv) return;

    const emit = (event, payload) => {
        try {
            window.onSocketDiagEvent(Object.assign({ event: event }, payload));
        } catch (ignoredError) {
            // best-effort diagnostic: never let it break the caller
        }
    };

    /**
     * A wid, or a device-list key, masked to the last four digits of each
     * number in it. A phone number's key is the bare number, with no `@`.
     */
    const who = (id) => {
        try {
            if (id && typeof id.toLogString === 'function') {
                return id.toLogString();
            }
            return String(id).replace(/\d+(?=\d{4})/g, '');
        } catch (ignoredError) {
            return '?';
        }
    };

    /** Device 99 is the hosted device; WhatsApp asserts it carries isHosted. */
    const device99 = (devices) => {
        const list = Array.isArray(devices) ? devices : [];
        return list.find((d) => d && d.id === hostedDeviceId) || null;
    };
    const isBad99 = (devices) => {
        const d = device99(devices);
        return !!d && d.isHosted !== true;
    };

    /** Top frames, hosts cut to the file, so they fit a log field. */
    const frames = (stack, from, count) =>
        String(stack || '')
            .split('\n')
            .slice(from, from + count)
            .map((l) =>
                l
                    .trim()
                    .replace(/^at /, '')
                    .replace(/https?:\/\/\S*\/([^/\s]+:\d+:\d+)/g, '$1')
                    .replace(/pptr:[^\s)]+/g, 'pptr'),
            )
            .join(' | ')
            .slice(0, 400);

    const ownUsers = () => {
        const me = window.WaGateway.module('WAWebUserPrefsMeUser');
        if (!me) return [];
        const out = [];
        try {
            out.push(me.getMeUserOrThrow());
        } catch (ignoredError) {
            // not registered yet
        }
        try {
            const lid = me.getMaybeMeLidUser && me.getMaybeMeLidUser();
            if (lid) out.push(lid);
        } catch (ignoredError) {
            // no LID on this account
        }
        return out;
    };
    /** Tests ids against the own users read once, for a whole batch. */
    const ownIdMatcher = () => {
        const users = ownUsers().map((u) => u.user);
        return (id) =>
            users.includes(String((id && id.user) || id).split(/[@:]/)[0]);
    };
    const isOwnId = (id) => ownIdMatcher()(id);

    /**
     * Where this account's own device list stands on WhatsApp's two expiry
     * clocks: days since the phone signed it (35d), and hours since WhatsApp
     * learned a newer one exists that has not arrived (25h).
     */
    const ownClocks = async (nowS) => {
        const api = window.WaGateway.module('WAWebApiDeviceList');
        const users = ownUsers();
        if (!api || !users.length) return { ownKnown: false };
        const recs = await api.bulkGetDeviceRecord(users);
        const r = recs.find((x) => x && !x.deleted);
        if (!r) return { ownKnown: false };
        const pending = r.expectedTs != null && r.expectedTs > r.timestamp;
        return {
            ownKnown: true,
            ownAgeDays: +((nowS - r.timestamp) / dayS).toFixed(2),
            ownNewerAnnounced: pending,
            ownHoursSinceAnnounced:
                r.expectedTsUpdateTs != null
                    ? +((nowS - r.expectedTsUpdateTs) / 3600).toFixed(2)
                    : null,
        };
    };

    /** Whether this account is logged out when its own list expires. */
    const logoutGate = () => {
        const ab = window.WaGateway.module('WAWebABProps');
        return ab
            ? ab.getABPropConfigValue(
                  'web_adv_logout_on_self_device_list_expired',
              )
            : null;
    };

    /** Replaces `target[key]` once per page; the factory gets the original. */
    const wrap = (target, key, factory) =>
        window.WaGateway.wrap('AdvDiag', target, key, factory);

    window.__p2dAdv = {
        emit,
        who,
        device99,
        isBad99,
        frames,
        ownUsers,
        ownIdMatcher,
        isOwnId,
        ownClocks,
        logoutGate,
        wrap,
    };
};

module.exports = { InstallAdvDiagShared };
