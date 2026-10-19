# Contributing

Thanks for helping improve isGenAI's open-source pieces.

## What lives here

- `packages/file-evidence/`: a TypeScript library that reads saved generation records from PNG text chunks and EXIF UserComment.
- `extension/`: the isGenAI browser extension (Manifest V3) for Chrome, Edge and Opera.

## Development

```sh
cd packages/file-evidence
npm install
npm test          # node:test via tsx
npm run typecheck
npm run build     # emits dist/
```

To try the extension, open `chrome://extensions` (or `edge://extensions`, `opera://extensions`), turn on Developer mode, choose **Load unpacked** and select the `extension/` folder.

## Ground rules

- **Evidence, not guesses.** The library returns a record only when a file stores exactly one unambiguous generation record. When sources conflict, are truncated, fail a CRC check or exceed size limits, it returns nothing. Please keep that behaviour; a missing answer is better than an invented one.
- **No network in the library.** `file-evidence` must not fetch, phone home or add runtime dependencies.
- **Tests with every change.** Add a fixture-based test for any new format or edge case. Build fixtures by hand in `test/fixtures.ts`; do not commit images you do not have the rights to share.
- **Small pull requests.** One behaviour change per PR, with a short explanation of the file format detail it relies on.

## Reporting bugs

Open a GitHub issue with the generator and version that wrote the file, what you expected, and (if you can share it) a minimal sample file. For security problems, see [SECURITY.md](SECURITY.md) instead.

By contributing, you agree that your contributions are licensed under the MIT License.
