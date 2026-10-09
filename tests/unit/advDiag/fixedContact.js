'use strict';

const { wid, nowS, DAY } = require('./fakePage');

/** A hosted contact the fix flagged. */
const BAD = '972500000775@c.us';

/** The record as the fix leaves it in storage: device 99 flagged. */
const storedFlagged = () => ({
    timestamp: nowS() - 4 * DAY,
    advAccountType: 1,
    devices: [{ id: 99, keyIndex: 6, isHosted: true }, { id: 0 }],
});

/** WhatsApp's check on `user`: no list from the server unless one is given. */
const sync = (page, user, local, incoming) =>
    page.modules.WAWebHandleAdvKeyIndexResultApi.handleKeyIndexResultSync(
        wid(user.split('@')[0]),
        incoming === undefined ? null : incoming,
        1,
        null,
        null,
        local,
    );

module.exports = { BAD, storedFlagged, sync };
