# CTO notes

You do not have to write this code. You have to be able to do three things with it:

1. **Explain it** to an interviewer, a partner or a customer.
2. **Find a bug** in it when a number looks wrong.
3. **Know what to ask for** when you want it changed.

Read sections 1 and 2 once (about 15 minutes). Keep section 4 for the day something breaks. Do section 5 with your own hands, because that is where it sticks.

## 1. The whole app in one picture

```
   you type          the brain                  the screen
 ┌───────────┐     ┌──────────────┐          ┌──────────────┐
 │ form,     │ ──> │ buildHolding │ ──> DB ──│ summarize()  │ ──> hero, list,
 │ spot form │     │ buildSpot    │          │ (melt.ts)    │     sheet, bar
 └───────────┘     └──────────────┘          └──────────────┘
        main.ts reads the form        main.ts reads the DB and paints
```

There is no server. The data is in IndexedDB, a database the browser keeps for this site. The page is a handful of files that GitHub hands to the phone, and then the phone does all the work.

- **The brain** (`src/core/`) only knows numbers, text and the database. It has never heard of a button.
- **The screen** (`index.html`, `src/ui/`, `src/styles/`) only knows how to look.
- **The wiring** (`src/main.ts`) carries data between them.

Keeping those apart is the most important design choice in the repo. It is why a wrong number can only come from a small number of places, and why the brain is tested without opening a browser.

## 2. Seven ideas this repo teaches

### Local-first software (the new one)

The data lives in a real database inside the browser, changes shape through numbered migrations, and leaves only as a file you save. That file can be locked with a passphrase. There is no sync and no account, and so no one else holds your data. The cost is that backups are yours to keep.

- **See it:** [`src/core/db.ts`](../src/core/db.ts), and the whole of [THE-DATABASE.md](THE-DATABASE.md).
- **Say it:** "The data never leaves the device unless the user exports a file. The price is no sync and user-owned backups, and the app tells them so."

### Migrations

A database has a version. When the app opens a database older than itself, it runs each missing migration in order, in one transaction. A database newer than the app is refused.

- **See it:** `MIGRATIONS` in `db.ts`, and the "migrations" tests in `db.test.ts`, which build a version 1 database by hand.
- **Say it:** "Every schema change is a numbered step that is tested against an old database with real rows in it."

### Money in integers

Cents are whole numbers. Weights are whole nanograms, held as bigints. Nothing a person sees is a floating-point number. Each holding's melt is computed exactly and rounded once, to the cent.

- **See it:** `meltCents()` in [`src/core/melt.ts`](../src/core/melt.ts).
- **Say it:** "Floating point cannot hold 0.1 exactly, so I store cents and nanograms as integers and round once, in one named place."

### Pure functions and a property test

A pure function gets values in and gives values out, and does nothing else. `summarize()` is one. A property test checks a rule for thousands of invented inputs instead of a few hand-picked ones. Here the rule is that melt value scales exactly with quantity.

- **See it:** the "scales linearly with quantity" test in [`src/core/melt.test.ts`](../src/core/melt.test.ts). Read the test names top to bottom; they are written as sentences, so the file doubles as a spec.
- **Run it:** `npm test`.

### Strict parsing

Anything typed or imported is parsed by rules that refuse to guess. "1,000" could be a thousand or one, so it is refused with a message. Imported files are rebuilt field by field, and unknown keys are dropped.

- **See it:** `parseDecimal()` in [`src/core/decimal.ts`](../src/core/decimal.ts) and `sanitizeHolding()` in [`src/core/schema.ts`](../src/core/schema.ts).
- **Say it:** "Text becomes a number in exactly one place, and that place has an opinion about every odd input."

### Encryption you can explain

Passphrase to key with PBKDF2, then AES-GCM, which both hides the data and notices tampering. The envelope's settings are bound into the tag.

- **See it:** [`src/core/lock.ts`](../src/core/lock.ts), 130 lines, commented.
- **Say it:** "A wrong passphrase and a tampered file look identical to AES-GCM, so the message says both. A forgotten passphrase cannot be recovered, and the page says that before you set one."

### Offline, and CI

A service worker saves the app on the first visit, so it opens with no signal. A GitHub Actions file runs the tests on every push to main and every pull request, and deploys only if they pass and the repo is public.

- **See it:** [`public/sw.js`](../public/sw.js), [`scripts/stamp-sw.mjs`](../scripts/stamp-sw.mjs), [`.github/workflows/ship.yml`](../.github/workflows/ship.yml).

## 3. Where things live

| You want to change... | Open this |
| --- | --- |
| How melt, premium or totals are worked out | `src/core/melt.ts` |
| How typed weights and fineness are read | `src/core/units.ts` |
| How typed text becomes a number, and which text is refused | `src/core/decimal.ts`, `src/core/money.ts` |
| What the add-a-coin form accepts | `src/core/form.ts` |
| What counts as a valid saved row | `src/core/schema.ts` |
| The database, or a new migration | `src/core/db.ts` |
| The backup file, merge rules | `src/core/vaultfile.ts` |
| Passphrase rules and the lock | `src/core/lock.ts` |
| Sentences that include a date or count | `src/ui/words.ts` |
| A label, a button or a form field | `index.html` |
| What happens on a click | `src/main.ts` |
| A brand colour or font name | `src/styles/brand.css` (the font files are in `src/styles/fonts.css`; the metal colours in `app.css`) |
| Layout, spacing, the printed sheet | `src/styles/app.css` |
| The invented demo rows | `src/core/sample.ts` |

## 4. When something breaks

| What you see | Likely cause | Where to look | How to check |
| --- | --- | --- | --- |
| A figure looks wrong | The maths, or the form feeding it | `meltCents()` in `melt.ts`, then `buildHolding()` in `form.ts` | Work it by hand: weight x quantity x fineness x spot. Then write the case as a test in `melt.test.ts`. If the test passes, the bug is in the form or the screen. |
| A figure shows a dash | No spot price for that metal | The **Spot prices** section | Type a price and press Save. The hero says which metals are missing. |
| "This vault was saved by a newer version" | The page you opened is older than the database on this device | `openVault()` in `db.ts` | Hard-refresh to get the newer page. Nothing was changed. |
| "N saved rows could not be read" | A row on disk fails validation | `sanitizeHolding()` in `schema.ts` | Open the browser's Application tab, then IndexedDB, then `coin-vault`, and look at the row. |
| "That passphrase does not open this file" | Wrong passphrase, or the file was edited | `unlockText()` in `lock.ts` | Try the passphrase again, typed slowly. If you changed the file by hand, undo it. There is no other way in. |
| The page shows but nothing saves | The browser blocks IndexedDB (private windows often do) | The red message at the top | Use a normal window. |
| The site still shows an old version after a deploy | GitHub Pages lets browsers reuse files for about 10 minutes | Nothing to fix | Wait, or hard-refresh. If it is still old, check the Actions tab. |
| Green check, but no website | The repo is private, so the deploy steps are skipped on purpose | `.github/workflows/ship.yml` | Make the repo public, set Pages to **GitHub Actions**, then run the workflow once. |
| Red X on a push | A test or the build failed | GitHub, **Actions**, click the red run | The log names the failing test. Nothing deployed, so the live site is the last good version. |

**The one debugging habit that matters:** reproduce it as a test first. A bug you can trigger with a test is a bug you can fix once and keep fixed.

## 5. Your turn

Five real changes, easiest first. Each one is a commit with your name on it. Run `npm test` after each.

1. **Add a size shortcut.** In `index.html`, copy the line for the `1 oz` button (`data-size="1"`), and add one next to it with `data-size="20"` and the label `20 oz`. *Done when:* pressing it fills 20 into the weight box and the box below reads "622.069536 g".
2. **Change the rule.** In `src/ui/words.ts` set `STALE_DAYS` to `3`. *Done when:* `npm test` goes red. Read the failure to see which test caught you, then decide: change it back, or update the test and the "seven days" in `README.md`. The backup reminder has its own constant, `BACKUP_NAG_DAYS`, because Safari's seven days is a different rule. That red X is the safety net doing its job.
3. **Write a test.** In `src/core/melt.test.ts`, inside the first `describe`, add a case: 10 grams of 0.9999 gold at an invented $6,000.00 an ounce. Build the holding with `weightNg: '10000000000'` and `finenessPpm: 999900`, and call `meltCents(gold({ weightNg: '10000000000' }), 600000)`. Work out the answer by hand first: 10 g x 0.9999 = 9.999 g, divided by 31.1034768 g per ounce, times 6000. *Done when:* the test passes with your hand-worked figure. If it fails, you have found either a bug or an arithmetic slip, and both are worth knowing about.
4. **Lengthen the passphrase rule.** In `src/core/lock.ts` set `MIN_PASSPHRASE_CHARS` to `12`. *Done when:* `npm test` says what breaks. A test in `lock.test.ts` that expects an eight-character passphrase to be accepted will fail. The type checker and the build still pass, which is a reminder that only tests catch a rule change. Update that test, the label text in `index.html` that says "at least 8 characters", and the same words in `docs/THE-DATABASE.md`.
5. **Add a field.** Add "Serial number" (optional text, up to 40 characters). It touches every layer, and the type checker is your checklist: `Holding` in `types.ts`; the `LIMITS` and the loop over `'mint' | 'location' | 'note'` in `schema.ts`, which drops any field it does not know, so skipping this step makes the value vanish on save; `HoldingInput`, `buildHolding()` and `holdingToInput()` in `form.ts`, plus the `HoldingInput` object in `form.test.ts`; a labelled box and an error line in `index.html`; and `FIELDS` and `BLANK` in `main.ts`. *Done when:* a serial number survives save, edit, export and import, and a test in `form.test.ts` proves it. This is the one to talk through with Claude. Ask it to explain each change before you accept it.

## 6. Questions you should be ready for

**Why no React?**
One page of forms and lists. The structure a framework gives you, logic separate from view, is here already, and the app's JavaScript is about 12 kB compressed.

**Why not a library for IndexedDB?**
Three small stores and a handful of operations fit in under 200 lines, comments included. The tests run against a stand-in database, so the wrapper is proven. A dependency would be one more thing to keep current.

**How do you know the maths is right?**
Three ways. Cases worked by hand (one ounce at 0.9999 at $6,000 melts for $5,999.40). The troy ounce definition checked against fractions and fine-metal weights. And a property test over thousands of random coins that melt scales exactly with quantity.

**What happens with no signal?**
The service worker saved every file on the first visit, and the data is already on the device. The page itself is fetched fresh when there is a connection, so updates arrive, and falls back to the saved copy when there is not.

**Where is the data stored, and what if I lose my phone?**
In IndexedDB on the device. If the device is lost and no backup file was saved, the data is gone. That is the cost of local-first, and the page shows the date of the last backup for that reason.

**Is the encryption good?**
It uses the browser's WebCrypto with standard choices: PBKDF2 at 600,000 rounds, AES-GCM, random salt and nonce, the header bound in. It protects the exported file. It does not protect an unlocked phone, and a weak passphrase is still weak.

**What did the AI do, and what did you do?**
Say it straight: Claude wrote most of the code as a pair programmer. You chose the problem, made the product decisions, reviewed the changes and can walk through any file. Then walk through one.

## 7. Words you'll hear

| Word | Plain meaning |
| --- | --- |
| Local-first | The data lives on your device first, and leaves only when you choose |
| IndexedDB | The database built into every browser |
| Migration | A numbered step that changes the database's shape without losing rows |
| Melt value | What the pure metal in a coin is worth at a spot price |
| Premium | What you paid above melt, as a percentage of melt |
| Spot price | The going price for one troy ounce of a metal. Here, one you type |
| Fineness | How pure the metal is. 0.9999 is "four nines" |
| Troy ounce | The ounce used for precious metals: exactly 31.1034768 grams |
| PBKDF2 | Turns a passphrase into a key by hashing it hundreds of thousands of times |
| AES-GCM | A cipher that hides data and detects any change to it |
| PWA | A website that can be installed and work offline like an app |
| Repo, commit, push, branch, CI | As in any project: the folder with history, one saved change, send it to GitHub, a parallel copy, the robot that runs tests |
