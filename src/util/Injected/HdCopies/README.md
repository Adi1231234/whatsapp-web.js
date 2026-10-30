# HdCopies

A photo sent in HD reaches WhatsApp Web as two messages, each with its own id:

1. the parent, at standard quality (`pairedMediaType: SD_IMAGE_PARENT`);
2. seconds later, a hidden copy at full quality (`associationType:
HD_IMAGE_DUAL_UPLOAD`, `parentMsgKey` = the parent).

WhatsApp shows one bubble. Code that treats every image message as its own
photo sees the same photo twice.

## What this adds

- `Message.hdCopyOf`: the parent's id when the message is a hidden copy, else
  null. WhatsApp's own test (`isDualUploadHdChildMsg`), so video copies
  (`HD_VIDEO_DUAL_UPLOAD`, `HEVC_VIDEO_DUAL_UPLOAD`) count too.
- `Message.awaitsHd`: the parent says an HD copy was sent after it. A copy can
  still fail to arrive, so this is not a promise.
- `Client.getHdCopy(messageId)`: the copy, if WhatsApp holds it, from its
  `message-association` table.

## Measured on build 2.3000.1052208262

- The copy is its own stanza, sent only after the parent's send succeeded. A
  copy that arrives before its parent is parked as an orphan and never becomes
  a message.
- WhatsApp does not download the copy by default, and shows it only when
  `wa_web_show_hd_photo` is on. Copies arrived while that switch was off.
- Deleting for everyone revokes each of the two messages separately.
