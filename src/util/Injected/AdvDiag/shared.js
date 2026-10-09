'use strict';

/**
 * Helpers every AdvDiag hook shares, installed once on `window.__p2dAdv`.
 *
 * `pupPage.evaluate` serialises a function alone, so hooks evaluated one by one
 * cannot import from each other. Installing the shared part first, on the page,
 * is what lets each hook stay one small file without repeating this.
 *
 * Only scalars and short strings leave the page: WhatsApp's objects carry keys
 * like `$1` that the host's log queue rejects, and a customer's number never
 * leaves in full - users are written the way WhatsApp's own `toLogString` writes
 * them, the last four digits and the server.
 */
const InstallAdvDiagShared = (hostedDeviceId, dayS) => {
    if (window.__p2dAdv) return;
    const req = (name) => {
        try {
            return window.require(name) || null;
        } catch (e) {
            return null;
        }
    };

    const emit = (event, payload) => {
        try {
            window.onSocketDiagEvent(Object.assign({ event: event }, payload));
        } catch (e) {
            // best-effort diagnostic: never let it break the caller
        }
    };

    /** A wid, or a device-list key like "972500000000@c.us", masked. */
    const who = (id) => {
        try {
            if (id && typeof id.toLogString === 'function') {
                return id.toLogString();
            }
            return String(id).replace(/^[^@]*?(\d{1,4})(@\S+)$/, '$1$2');
        } catch (e) {
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
        const me = req('WAWebUserPrefsMeUser');
        if (!me) return [];
        const out = [];
        try {
            out.push(me.getMeUserOrThrow());
        } catch (e) {
            // not registered yet
        }
        try {
            const lid = me.getMaybeMeLidUser && me.getMaybeMeLidUser();
            if (lid) out.push(lid);
        } catch (e) {
            // no LID on this account
        }
        return out;
    };
    const isOwnId = (id) => {
        const user = String((id && id.user) || id).split(/[@:]/)[0];
        return ownUsers().some((u) => u.user === user);
    };

    /**
     * Where this account's own device list stands on WhatsApp's two expiry
     * clocks: days since the phone signed it (35d), and hours since WhatsApp
     * learned a newer one exists that has not arrived (25h).
     */
    const ownClocks = async (nowS) => {
        const api = req('WAWebApiDeviceList');
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

    /** Replaces `target[key]` once; the factory gets the original. */
    const wrap = (target, key, factory) => {
        if (!target || typeof target[key] !== 'function') return false;
        if (target[key].__p2dAdv) return true;
        const wrapped = factory(target[key]);
        wrapped.__p2dAdv = true;
        target[key] = wrapped;
        return true;
    };

    window.__p2dAdv = {
        req,
        emit,
        who,
        device99,
        isBad99,
        frames,
        isOwnId,
        ownClocks,
        wrap,
    };
};

module.exports = { InstallAdvDiagShared };
