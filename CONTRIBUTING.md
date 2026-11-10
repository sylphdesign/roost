# Contributing to Roost

Thank you for helping. Keep changes small and clear.

## Set up

You need macOS on Apple Silicon, Node.js 20+ and Xcode Command Line Tools. See [docs/INSTALL.md](docs/INSTALL.md).

```bash
git clone https://github.com/sylphdesign/roost.git
cd roost
npm install
npm start
```

## Tests

```bash
npm test          # unit tests (node --test)
npm run test:all  # unit tests plus every app test in test/*.e2e.js
```

The `.e2e.js` tests start the real Electron app against a fake Google server (`test/fake-gmail-server.js`). They need a display and take a few minutes. Run `npm test` often. Run `npm run test:all` before you open a pull request.

## Rules

- **No real accounts, tokens or keys** in code, tests, logs or screenshots. Use the fake server and fake data.
- Never commit `.env` files, Client secrets or Claude keys.
- The `ROOST_*` environment variables exist only for tests. Do not use them for features.
- Add or update a test for each change that you can test.
- Keep the code plain. Match the style around it. No big rewrites in a small fix.
- Do not add tracking, analytics or a Roost server.
- Do not add features that need Google to verify the app (for example a logo or extra restricted scopes) without talking to us first.

## Pull requests

1. Fork the repo and make a branch.
2. Make your change. Run the tests.
3. Open a pull request. Say what changed, why, and how you tested it.
4. Add a screenshot if the screen changed (hide private data).

## Bugs and ideas

Open an issue at <https://github.com/sylphdesign/roost/issues>. Say your macOS version, your Roost version, what you did and what happened. For a security problem, follow [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree your work is licensed under the [MIT License](LICENSE).
