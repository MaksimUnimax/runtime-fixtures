# Browser cards R19 — full-color browser icons and centered content

Date: 2026-09-29

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

## Owner correction

The browser catalogue on HOME now follows the approved 2×2 reference:

- Chrome, Opera, Yandex Browser and Firefox use recognizable full-color browser artwork instead of the previous one-color glyphs;
- the Octoport mark is rendered at exactly the same CSS box size as the browser icon;
- the icon pair, browser name, catalogue label and availability text are all centered inside each card;
- desktop/tablet catalogue is 2 columns; narrow mobile is 1 column;
- no browser-card text or availability wording changed.

## Assets

- Chrome: `assets/browser-icons/chrome.png`, 256×256, copied from the installed Google Chrome package;
- Opera: `assets/browser-icons/opera.png`, 256×256, copied from the installed Opera package;
- Yandex Browser: `assets/browser-icons/yandex.png`, 256×256, copied from the installed Yandex Browser package;
- Firefox: `assets/browser-icons/firefox-color.svg`, 512×512 Mozilla Firefox logo;
- Octoport: existing `assets/browser-icons/octoport.svg`.

Desktop browser and Octoport icon boxes are both 78×78 px. Mobile boxes are both 66×66 px.

## Source acceptance

- site regression suite: 41/41 PASS;
- Chrome approved-copy/public-page run: 15 states and 48 disclosure interactions PASS;
- 1440 screenshot: four equal 509×286 cards, 2×2 layout, centered content;
- measured every desktop browser icon and its adjacent Octoport mark at 78×78 px;
- 390 screenshot: one-column cards remain centered with equal 66×66 icon boxes and no horizontal overflow.
