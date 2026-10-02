# Security Reporting

Do not post vulnerabilities, private keys, seed phrases, signatures or personal wallet data in a public issue.

Use **Security > Report a vulnerability** on this repository when private reporting is enabled. A separate reporting email has not been designated. If no private option is available, open an issue asking for a private maintainer contact and leave the technical details out.

Include the affected files, a minimal reproduction with mocks or an unfunded wallet, the expected impact and any suggested fix. Do not test against other people's wallets, production funds, the Privacy Cash relay or third-party systems without their authorization.

There is no promised response time, bug bounty, external audit or blanket authorization for penetration testing.

## Areas that matter most

- Buy calldata: anything that lets the server's call differ from what the browser re-encodes, or lets `simulate` run a call that was not quoted
- Pinned contract hashes and V4 pool key verification in `server/terminal.js`
- Privacy payload guards in `src/privacy-checks.ts`: amount, recipient, approval scope, relay fee and chain
- Signature handling in the privacy workspace: the fixed message, memory-only storage, clearing on lock or account change
- Vault format and key derivation in `src/vault-crypto.js`

## Before operating a deployment

- Keep any future secret in server-side environment settings, never in `VITE_` variables
- Recheck contract addresses and code hashes against the chain before enabling buys
- Treat market index data and token metadata as untrusted input
- Review dependency updates, especially `privacycash-evm` and `viem`, and keep the pinned circuit hashes in sync with a reviewed SDK version
- Preserve third-party notices

Publishing this code is not a security certification, and $OGATE has no contract yet.
