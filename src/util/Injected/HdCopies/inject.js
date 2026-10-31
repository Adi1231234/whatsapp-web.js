'use strict';

/**
 * A photo or video sent in HD reaches WhatsApp Web as more than one message:
 * the parent, and a copy of the same media that WhatsApp does not show as a
 * picture of its own. See README.md.
 *
 * A missing module answers "not a copy", which is the behaviour before this.
 *
 * Runs in the page: everything it uses must be defined inside it.
 */
const InjectHdCopies = () => {
    // WhatsApp's own test, `isDualUploadHdChildMsg`.
    const isDualUpload = (type) => {
        const types = window.require('WAWebDualUploadsAssociationTypes');
        return !!types && types.isDualUploadAssociationType(type) === true;
    };
    const association = (name) =>
        window.require('WAWebMessageAssociation.flow')?.MessageAssociationType[
            name
        ];
    const paired = (name) =>
        window
            .require('WAWebPairedMediaType.flow')
            ?.PAIRED_MEDIA_TYPE_BY_NAME.get(name);

    // `hd`: the same media at a higher quality. `alternate`: the same video in
    // another encoding (HEVC, AV1, streamed), at no higher quality.
    const HD_CHILDREN = ['HD_IMAGE_CHILD', 'HD_VIDEO_CHILD'];
    const ALTERNATE_CHILDREN = [
        'HEVC_VIDEO_CHILD',
        'AV1_VIDEO_CHILD',
        'STREAMED_VIDEO_CHILD',
    ];
    const isOneOf = (type, names) =>
        type != null && names.some((name) => type === paired(name));
    const kindOfAssociation = (type) =>
        type === association('HEVC_VIDEO_DUAL_UPLOAD') ? 'alternate' : 'hd';
    const kindOfPaired = (type) => {
        if (isOneOf(type, HD_CHILDREN)) return 'hd';
        return isOneOf(type, ALTERNATE_CHILDREN) ? 'alternate' : null;
    };

    window.WWebJS.hdVariantOf = (msg) => {
        const linked =
            msg.parentMsgKey != null && isDualUpload(msg.associationType);
        return {
            hdCopyOf: linked ? msg.parentMsgKey.toString() : null,
            // A copy can arrive without the link to its parent, shown as a
            // message of its own; it still says it is a copy.
            hdCopyKind: linked
                ? kindOfAssociation(msg.associationType)
                : kindOfPaired(msg.pairedMediaType),
        };
    };
};

module.exports = { InjectHdCopies };
