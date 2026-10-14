# The database

Coin Vault has no server, so the database is in your browser. This page explains what is stored, how the shape of it changes between versions without losing rows, how a backup file is built and locked, and what you give up by keeping data this way.

The code is in [`src/core/db.ts`](../src/core/db.ts), [`src/core/schema.ts`](../src/core/schema.ts), [`src/core/vaultfile.ts`](../src/core/vaultfile.ts) and [`src/core/lock.ts`](../src/core/lock.ts).

## 1. What local-first means here

The data lives on the device that typed it. The app is a handful of files; once they are saved, nothing needs a network. There is no account, because there is nowhere to log in to.

That buys three things: nobody else holds a copy, it works with no signal, and it costs nothing to run. It costs three things too.

- **No sync.** A phone and a laptop each have their own vault. To move data between them you export a file and import it.
- **Backups are your job.** Nothing is copied anywhere. Clear the site's data, lose the phone, or let the browser evict the site, and the vault is gone.
- **Browsers can evict.** Safari deletes script-writable storage, IndexedDB included, for a site you have not interacted with in seven days of Safari use ([WebKit's post](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)). A site added to the home screen has its own counter. The page shows the date of your last backup and says so when it is older than seven days.

## 2. What is stored

One database called `coin-vault`, currently at version 2, with three stores:

| Store | Key | Holds |
| --- | --- | --- |
| `holdings` | `id` | One row per kind of coin or bar |
| `spots` | `metal` | At most one typed spot price per metal |
| `meta` | `key` | Small facts about the vault. Today only `lastBackup` |

A holding, as stored:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | text, `a-z 0-9 -`, up to 64 | Random, made with `crypto.randomUUID()` |
| `name` | text, up to 120 | What you call it |
| `metal` | `gold`, `silver`, `platinum`, `palladium` | |
| `finenessPpm` | integer, 100,000 to 1,000,000 | Parts per million. 0.9999 is 999,900 |
| `weightNg` | decimal string | Weight of **one piece** in whole nanograms. A string because it is a bigint |
| `enteredUnit` | `g` or `ozt` | How you typed it, so the form shows it back the same way |
| `quantity` | integer, 1 to 1,000,000 | |
| `paidPerUnitCents` | integer, 0 to 10^12 | Canadian cents for **one piece** |
| `paidOn`, `mint`, `year`, `location`, `note` | optional | `note` is up to 2,000 characters |
| `sample` | `true`, optional | Only on the invented demo rows |

A spot price is `{ metal, centsPerOzt, enteredOn }`: Canadian cents per troy ounce and the day you typed it for, as `2026-10-14`.

Why these types:

- **Integers, not decimals.** `0.1 + 0.2` is not `0.3` in a computer. Cents and nanograms are whole numbers, so sums are exact.
- **Weight as a string.** A troy ounce is 31,103,476,800 ng. Multiply by a quantity, a fineness in parts per million and a price in cents and the number passes 2^53, where ordinary JavaScript numbers start to lose digits. Bigints do not.
- **Nanograms.** Typed weights have up to nine decimal places in grams and six in troy ounces. A weight typed in ounces is rounded to the nearest nanogram once, on the way in. The error is below a billionth of a gram.

## 3. The rounding rule

Decided first, because everything else depends on it.

```
melt = round_half_up( weight_ng x quantity x fineness_ppm x spot_cents_per_ozt
                      / (31,103,476,800 x 1,000,000) )
```

Everything inside the brackets is an integer, so the division is the only place a fraction appears, and it is rounded once, to a whole cent. A total is the sum of the rounded lines.

One consequence: 10 coins on one line can differ from 10 times one coin by up to half a cent per coin, because the rounding happens once instead of ten times. That is the price of a page that adds up. The property test compares the **unrounded** value, where melt scales exactly with quantity, and checks the rounded values stay within that gap (half a cent per coin, plus one cent of slack).

Premium is `(paid - melt) / melt`, in basis points (hundredths of a percent), halves rounded away from zero. When melt is zero it is `n/a`, never 0 and never infinity.

## 4. Migrations

A database has a version number. When the app opens it, the browser compares the version on disk with the version the app asks for. If the disk is older, the browser runs the migrations in order, inside one transaction. Either all of them land or none do.

```
MIGRATIONS[0]   v1   create the holdings store
MIGRATIONS[1]   v2   create the spots and meta stores;
                     give any holding without a weight unit the unit "g"
```

Version 1 was the shape of the database before the spot and backup features existed. It never shipped as a release. It is kept as a migration so the machinery is exercised and tested: [`db.test.ts`](../src/core/db.test.ts) builds a version 1 database by hand, opens it with the current code and checks every row survived.

Rules for the next person:

1. Never edit a migration that has shipped. Add the next one.
2. Raise `DB_VERSION` and add one entry to `MIGRATIONS`. The loop in `openVault` runs every missing step.
3. A migration may read and rewrite rows, but must not need the network.

**A database newer than the app is refused.** If you open an old copy of the app (a stale cached page, say) against a database saved by a newer one, the browser throws `VersionError`. The app turns that into one message, "This vault was saved by a newer version of Coin Vault", and changes nothing. An old app writing into a new shape is how data gets damaged.

**Rows are checked on the way out.** Every row read back goes through the same checks as an imported file. A row that fails is left out and the page says how many.

## 5. The backup file

Plain export, one JSON object:

```json
{
  "format": "coin-vault",
  "schema": 1,
  "exportedAt": "2026-10-14T12:00:00.000Z",
  "holdings": [ ... ],
  "spots": [ ... ]
}
```

`schema` is the file format's own version, separate from the database version. A file with a higher `schema` than the app knows is refused with a message saying so.

On import, every row is rebuilt from known fields only (`sanitizeHolding`, `sanitizeSpot`). Unknown keys are dropped, so a file cannot carry anything else in. Duplicate ids, two prices for one metal, wrong types, out-of-range numbers and files over 10 MB are refused with a message that names the problem. You then choose to **add** to what is there (the imported row wins on the same id; the newer spot date wins per metal) or **replace** everything.

## 6. Locking a file

If you tick the box, the JSON above is the plaintext inside this envelope:

```json
{
  "format": "coin-vault-enc",
  "v": 1,
  "kdf":    { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64, 16 bytes>" },
  "cipher": { "name": "AES-GCM", "iv": "<base64, 12 bytes>" },
  "data":   "<base64 ciphertext with its 16-byte tag at the end>"
}
```

- **Key.** PBKDF2 with HMAC-SHA256 stretches the passphrase into a 256-bit key. Each guess costs an attacker 600,000 hash rounds, which is the figure the [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) gives for this setup. The salt is random per file, so two files with the same passphrase get different keys.
- **Cipher.** AES-GCM hides the contents and detects any change to them. The nonce is random per file.
- **The header is bound in.** The settings in the envelope (format, rounds, salt, nonce) are fed to AES-GCM as additional authenticated data. Edit the salt, the nonce or the round count and the tag no longer matches, the same as editing the ciphertext.
- **One message for two causes.** A wrong passphrase and a tampered file fail the same way in AES-GCM, so the page says "That passphrase does not open this file, or the file was changed after it was saved." A file that is not an envelope at all says it is not a Coin Vault file.
- **Round counts are clamped.** Before any key is derived, a round count outside 100,000 to 2,000,000 is refused. Otherwise a hostile file could set it to a billion and freeze the tab.
- **Passphrases are normalised** to Unicode NFC, so an accented letter typed on two keyboards is the same passphrase. New passphrases need at least 8 characters.
- **A forgotten passphrase cannot be recovered.** There is no copy of the key anywhere, and no reset. The page says this before you set one.

What locking does not do: it protects the exported file, not the live vault in your browser. Anyone with your unlocked phone can open the app. And a short passphrase is still a short passphrase.

## 7. Where the data is, and how to wipe it

It is in the browser's IndexedDB for this site's address. "Erase everything" on the page empties both stores. Clearing the site's data in the browser settings removes the database too.
