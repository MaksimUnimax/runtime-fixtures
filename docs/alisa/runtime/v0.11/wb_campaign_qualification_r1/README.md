# WB campaign inventory qualification

Voice campaign-count requests were declined before API because the registered campaign inventory was not qualified in either transport configuration or the store dataset capability. A personal-class token was already connected. Class/expiry checks do not prove advertising access.

qualify.py performs one owner-authorized read-only request through the existing SourceMatrix HTTP builder and shared bounded HTTPS transport, without manufacturing a production qualification. It uses the accepted legacy store and current account scope, verifies token class through the source definition, requires HTTP200 and strict complete canonical decoding, independently checks global/group totals and unique IDs, and saves only a private redacted receipt. It performs no model calls and no retries. A denied or incomplete response creates no qualification.

activate.py admits the source only after that successful real receipt. It checks the actual installed source/recipe/catalog hashes, current config CAS, unchanged exact store scope, receipt freshness and script hash, and an idle worker. It atomically adds precisely one transport proof and one store capability, preserves file owner/mode and all other config fields, and keeps a private exact backup. Existing runtime lambdas read the updated config; service/release/Station/user prompts are not changed.

Private live values, identifiers and response hashes stay outside Git. The voice retest remains separate evidence and must repeat the original question. Earlier rejected cases remain in the acceptance records.
