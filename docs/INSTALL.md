# Install Roost

There is no ready-made download yet. You build Roost from source. It takes a few minutes.

## Requirements

| Need | Why |
| --- | --- |
| macOS 12 or newer on Apple Silicon (M1 or later) | The build is arm64. |
| Node.js 20 or newer | Roost uses Electron 45. |
| Xcode Command Line Tools | Needed for `clang`, which builds `native/mic-watch.c`. |
| Google Chrome (optional) | Needed for Keep, Drive and Docs. Edge and Brave also work. |

Install the Xcode tools:

```bash
xcode-select --install
```

Check Node.js:

```bash
node --version
```

### Intel Mac?

The scripts build for arm64 only. On an Intel Mac, open `package.json` and change `arm64` to `x64` in the `build:native`, `dist` and `pack` scripts. This is not tested.

## Run from source (development)

```bash
git clone https://github.com/sylphdesign/roost.git
cd roost
npm install
npm start
```

## Build the app

```bash
npm run pack
```

Result: `dist/mac-arm64/Roost.app`.

Copy it to Applications:

```bash
cp -R dist/mac-arm64/Roost.app /Applications/
```

To make a disk image instead:

```bash
npm run dist
```

Result: `dist/Roost-<version>-arm64.dmg`. Open it and drag Roost to Applications.

## First run

macOS will ask you to approve a few things. The full list is in [PERMISSIONS.md](PERMISSIONS.md). The two you will see first:

1. **"Roost can't be opened" (Gatekeeper).** Roost is ad-hoc signed and not notarized. Right-click `Roost.app`, click **Open**, then click **Open**.
2. **Keychain prompt.** Enter your Mac password and click **Always Allow**.

Then connect Gmail: [GOOGLE_SETUP.md](GOOGLE_SETUP.md).

## Update Roost

```bash
cd roost
git pull
npm install
npm run pack
```

Copy the new `Roost.app` to `/Applications`. The Keychain prompt will appear again (see PERMISSIONS.md).

## Open at login

Open the **Roost** menu in the menu bar and tick **Open at Login**. This works in the packaged app only, not with `npm start`.

## Where Roost keeps data

`~/Library/Application Support/Roost/`

| Item | What it is |
| --- | --- |
| `config.json` | Your apps and settings |
| `gmail-accounts.json` | Gmail and Calendar sign-ins (tokens are encrypted) |
| `icons/` | Pictures you chose for tiles |
| `chrome-profiles/` | Private Chrome profiles for Keep, Drive, Docs |
| `Partitions/` | Private storage for each app (cookies, sessions) |

## Remove Roost and all data

1. Quit Roost (⌘Q).
2. Move `/Applications/Roost.app` to the Trash.
3. Move the data folder `~/Library/Application Support/Roost` to the Trash.
4. Open **Keychain Access**, search for `Roost Safe Storage`, and delete it.
5. Go to <https://myaccount.google.com/permissions> and remove access for your Roost app.

## Troubleshooting

- **`clang: command not found`**: run `xcode-select --install`.
- **Keep, Drive or Docs does not open**: install Google Chrome.
- **Gmail says setup is needed**: see [GOOGLE_SETUP.md](GOOGLE_SETUP.md).
