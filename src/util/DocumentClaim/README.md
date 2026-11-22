# DocumentClaim

Prepares each document of the page once.

- puppeteer emits `framenavigated` for a same-document navigation (History
  API, fragment) as well as for a new document. WhatsApp makes one right after
  it syncs, and rewrites its logout address inside the logout document, so a
  handler that injects on every `framenavigated` injects twice.
- Asking the page whether `window.WWebJS` exists does not tell the two apart:
  it is set only at the end of the preparation, after sync.
- `claimDocument(page)` marks the document at the start instead, in one
  synchronous step (JavaScript runs it to completion). A new document gets a
  new global object (HTML, "create and initialize a Document object"), so the
  mark is gone; a same-document navigation keeps it.
- It returns the address the document was loaded from (its navigation entry),
  which a later History API call does not change, so the logout check reads
  the logout address whichever navigation event claimed the document.
