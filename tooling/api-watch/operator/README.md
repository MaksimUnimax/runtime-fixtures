# Wildberries single-file operator handoff

1. Open `https://dev.wildberries.ru/` in the normal visible browser.
2. Complete the normal Wildberries challenge if it is shown.
3. Run `wb-official-bundle-browser.js` once in that page's console.
4. Confirm that the browser downloads exactly one
   `wildberries-openapi-bundle-....json` file.
5. Send that one file with the Telegram caption
   `/swagger_upload <request_id>`.

The helper performs sequential same-origin requests for the fixed thirteen
official documents and downloads nothing unless all thirteen pass its bounded
checks. It does not open additional tabs or export browser state.
