'use strict';

/**
 * A photo sent in HD reaches WhatsApp Web as two messages: the parent at
 * standard quality, then a hidden copy at full quality. WhatsApp shows one.
 * See README.md.
 *
 * A missing module answers "neither", which is the behaviour before this, and
 * the gateway's load check reports it.
 *
 * Runs in the page: everything it uses must be defined inside it.
 */
const InjectHdCopies = () => {
    // WhatsApp's own test, `isDualUploadHdChildMsg`.
    const isDualUpload = (type) => {
        const types = window.WaGateway.module(
            'WAWebDualUploadsAssociationTypes',
        );
        return !!types && types.isDualUploadAssociationType(type) === true;
    };
    const sdImageParent = () =>
        window.WaGateway.module(
            'WAWebPairedMediaType.flow',
        )?.PAIRED_MEDIA_TYPE_BY_NAME.get('SD_IMAGE_PARENT');

    window.WWebJS.hdVariantOf = (msg) => ({
        hdCopyOf:
            msg.parentMsgKey != null && isDualUpload(msg.associationType)
                ? msg.parentMsgKey.toString()
                : null,
        // Not `wa_web_show_hd_photo`: that only decides whether WhatsApp
        // shows the copy, and copies arrive while it is off.
        awaitsHd:
            msg.pairedMediaType != null &&
            msg.pairedMediaType === sdImageParent(),
    });

    // From the association table, so a copy that came first, or before a
    // reload, is found too.
    window.WWebJS.findHdCopyId = async (messageId) => {
        const rows = await window.WaGateway.module(
            'WAWebDBGetAssociatedMsgsByParentMsgKey',
        ).bulkGetMessagesByParentMsgKey([messageId]);
        const row = rows.find((r) => isDualUpload(r.associationType));
        return row ? String(row.msgKey) : null;
    };
};

module.exports = { InjectHdCopies };
