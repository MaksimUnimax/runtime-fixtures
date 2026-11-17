# Installed R15 selector protocol fixture

`template_protocol.py` is a read-only capture of the installed native source at
`alisa-coefficient-station-native-485a2034ac0dc36f`. Its SHA-256 is
`260c5ef0f761f2755cdf50fc5b8cb1ea2cb77b5541403c40a4cc777ae2cdfbf0`.
The pinned R15 builder previously produced
`f5a59b25cd8b405eb3c0f4de4593d381b649680db9b47d34cb65a7bbbecee228`.

The installed variant retains the existing selector instruction for exact
distinct counts from preserved dataset fields. It preserves the same protocol
functions, closed actions and server authority checks. It also retains the
already installed parameter-selection instruction. This fixture contains only
source code and generic policy text, no owner data or credentials.

AL-S13 composes its test core from the pinned R15 source and this exact existing
protocol. The helper checks both input and output hashes. It does not modify
the installed selector to make it match an older test fixture.
