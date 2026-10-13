# Robin Trade

Non-official browser wallet tool for Robinhood Chain (4663).

Site: https://orange1246496719.github.io/robin-trade/

Public RPC reads with bounded transport failover. Wallet-only transaction confirmation. No private keys, seeds, approval automation or backend signing. Exact approvals and sell are independent confirmations. Not audited, not a universal DEX. Simulations are not guarantees. Public selector-compatible layout is not verified official ABI.

Before switching from the localhost version, reconcile every local pending transaction there. Online storage is separate and cannot see local pending records. Use one page only. Sell native ETH arrival requires independent explorer internal transfer verification.

Built frontend is at repository root. Reviewable frontend source is in source/. Build source with npm ci then npm run build -- --base=./. 67 offline TS tests passed before initial publish. No real transactions sent.

No credentials, private configs or personal transaction ledgers are included.
