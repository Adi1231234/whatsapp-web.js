'use strict';

/**
 * Remembers which contacts the HostedDeviceFlag fix had to flag, across page
 * loads, so a later sync can be checked against what WhatsApp would have done
 * without it.
 *
 * A record is flagged days before the sync that would have died on it (the
 * stalled shops' bad records were 4 to 25 days old), and the page reloads every
 * night, so memory alone would forget most of them. Kept in `localStorage`,
 * bounded, on this machine only; the ids never leave it in full.
 */
const InstallAdvFixedSet = (storageKey, max) => {
    const a = window.__p2dAdv;
    if (!a || a.fixed) return !!(a && a.fixed);
    let ids = [];
    try {
        ids = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
        if (!Array.isArray(ids)) ids = [];
    } catch (e) {
        ids = [];
    }
    const set = new Set(ids);
    const save = () => {
        try {
            window.localStorage.setItem(
                storageKey,
                JSON.stringify(Array.from(set).slice(-max)),
            );
        } catch (e) {
            // a full or blocked localStorage only costs the memory
        }
    };
    a.fixed = {
        has: (id) => set.has(String(id)),
        add: (id) => {
            const key = String(id);
            if (set.has(key)) return;
            set.add(key);
            if (set.size > max) set.delete(set.values().next().value);
            save();
        },
    };
    // Throws the fix prevented during the current drain attempt.
    a.prevented = 0;
    return true;
};

module.exports = { InstallAdvFixedSet };
