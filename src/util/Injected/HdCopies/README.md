# HdCopies

A photo sent in HD reaches WhatsApp Web as two messages, each with its own id:

1. the parent, at standard quality (`pairedMediaType: SD_IMAGE_PARENT`);
2. later, a hidden copy (`associationType: HD_IMAGE_DUAL_UPLOAD`,
   `parentMsgKey` = the parent, `pairedMediaType: HD_IMAGE_CHILD`).

WhatsApp shows one bubble. Code that treats every image message as its own
photo sees the same photo twice. A video does the same (`SD_VIDEO_PARENT`,
`HD_VIDEO_DUAL_UPLOAD` / `HD_VIDEO_CHILD`), and so does a video sent in another
encoding (`HEVC_VIDEO_DUAL_UPLOAD` / `HEVC_VIDEO_CHILD`, `AV1_VIDEO_CHILD`,
`STREAMED_VIDEO_CHILD`), which is no higher in quality.

## What this adds

- `Message.hdCopyOf`: the parent's id when the message is a linked copy, by
  WhatsApp's own test (`isDualUploadHdChildMsg`), else null.
- `Message.hdCopyKind`: `hd` (the same media at a higher quality),
  `alternate` (the same video in another encoding), or null for a message of
  its own. Read from the link when there is one, else from `pairedMediaType`.
- `Message.fileHash`: the media's plaintext SHA-256 as WhatsApp records it
  (`filehash`), so a caller can tell two messages carrying the same file.

## Measured

- The copy is its own stanza, sent only after the parent's send succeeded. A
  copy that arrives before its parent is parked as an orphan and never becomes
  a message (build 2.3000.1052208262).
- WhatsApp does not download the copy by default, and shows it only when
  `wa_web_show_hd_photo` is on. Copies arrived while that switch was off.
- Deleting for everyone revokes each of the two messages separately: the
  sender's client sends a revoke for every child that is not deleted with its
  parent (`getAssociatedChildMessageRevokePromises`), and dual uploads are
  `Regular` children.
- A copy is not always one, and not always linked. One forwarded photo
  arrived as its parent plus 296 more messages of the same file within four
  minutes, each encrypted and uploaded on its own by the sender's phone (297
  media keys, 297 direct paths, one `filehash`): 261 hidden and linked, 35
  shown as messages of their own with `pairedMediaType: HD_IMAGE_CHILD` and no
  `parentMsgKey`. `hdCopyKind` names all of them; `fileHash` tells they are
  the same file.
