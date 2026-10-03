# QR reference vectors

`qrcode.json` pins the visible module grids independently of the SVG renderer. The reference is
the untouched Nayuki TypeScript at commit `3c6d0b3cefb4e049dc337e82237c9644399716a8`, SHA-256
`1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c`. It was compiled with the installed
plain TypeScript compiler (`target: ES2022`, `module: ESNext`, explicit root/output directories),
without importing the package's encoder wrapper or renderer. Each input used
`encodeSegments(QrSegment.makeSegments(text), Ecc.MEDIUM, 1, 40, -1, false)`.

The SHA-256 input is the row-major module grid: `1` for dark, `0` for light, LF between rows and
no trailing LF. Sizes exclude the quiet zone. SVG tests reconstruct the rendered grid and read
its format bits, then compare version, size, ECC, mask and hash with these values.

The long vector came from the installed SDK 0.11.0's real `startGrantAuthFlow` serialization in
a fresh Chromium context, using `/pub/example.com/:rw`, `clientId: "example.com"`,
`relay: "https://relay.example/" + "r".repeat(234)` and `xSource: "A".repeat(128)`.
Only the raw `secret` and `cpk` parameter values were replaced, in place, with the existing
43-character and 52-character synthetic e2e fixture values; no `URLSearchParams` reserialization
or manual field ordering/encoding was used. Random SDK payloads were never logged or saved.
The flow was freed without polling, approving or saving its state. External browser requests were
blocked. The resulting 591 bytes encode at version 19, size 93, mask 2, hash
`f38934752de0a40a6dd8771958123ab5133f2f71e3279ad93ad308b5088a839d`.

The 250-byte vector uses the existing fixed e2e request fixture. The maximum-size vector is
`pubkyauth://` plus lowercase ASCII to exactly 2,331 UTF-8 bytes, which forces byte-mode encoding.
Using uppercase or digits alone would produce a different capacity boundary. Multibyte input
and short ASCII cover the other required cases. Reference scripts and logs remain outside the
worktree under `/home/coder/passport-client-plan/work/qr-vectors/a24/`.

The measured version 19 replaces the design's unmeasured version-13 estimate under A24. Input
limits, exact SDK payload, ECC M and the 2,331-byte element cutoff are unchanged. A real Ring scan
of the 224px rendering is still required in the large-element milestone.
