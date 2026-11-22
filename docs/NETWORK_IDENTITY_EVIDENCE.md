# Base Sepolia network identity evidence

Date: 2026-11-21. This evidence is consumed by
`packages/protocol/src/chain-identity.ts` and every deployment/publication
verifier. A chain-id response alone is never accepted.

## Authoritative configuration

| Item                  | Value                                                   |
| --------------------- | ------------------------------------------------------- |
| Repository            | `https://github.com/base/base`                          |
| Commit                | `76fa46dd3f64bb8806c749ddc510217696104a15` (2026-11-20) |
| Genesis file          | `crates/common/chains/res/genesis/sepolia_base.json`    |
| chainId               | `84532`                                                 |
| Genesis timestamp     | `0x65135ee0` (`1695768288`, 2023-09-26)                 |
| Genesis gas limit     | `0x17d7840` (25,000,000)                                |
| Genesis alloc entries | 2,322                                                   |
| Genesis extraData     | `0x424544524f434b` (`BEDROCK`)                          |

The genesis file is the authoritative chain specification. Its header hash is
reproduced by the network's block zero.

## Pinned values

| Signal           | Value                                                                |
| ---------------- | -------------------------------------------------------------------- |
| Genesis block    | `0`                                                                  |
| Genesis hash     | `0x0dcc9e089e30b90ddfc55be9a37dd15bc551aeee999d2e2b51414c54eaf934e4` |
| Checkpoint block | `61,800,000`                                                         |
| Checkpoint hash  | `0x486d04900ac2e7f6de0d2960cf1aae9095a2a60756e2dcddeac9aca33e26d7ce` |

## Independent observations

Observed directly on 2026-11-21:

| Source                                                                                       | Genesis                       | Checkpoint      |
| -------------------------------------------------------------------------------------------- | ----------------------------- | --------------- |
| `https://base-sepolia.gateway.tenderly.co`                                                   | match                         | match           |
| `https://base-sepolia.api.onfinality.io/public`                                              | match                         | match           |
| `https://base-sepolia.drpc.org`                                                              | match (during audit)          | match           |
| `https://base-sepolia.publicnode.com`                                                        | pruned (cannot prove genesis) | match           |
| `https://sepolia-explorer.base.org` (Blockscout, redirects to `base-sepolia.blockscout.com`) | `0x0dcc9e…34e4`               | `0x486d04…d7ce` |

Two independent archive providers plus the official explorer are required.
Providers that prune block zero cannot satisfy the guard; they are rejected
rather than skipped.

## Method

1. Read the Base repository genesis file at the recorded commit.
2. Confirm chain id, timestamp, gas limit and alloc are the Base Sepolia
   specification.
3. Query block zero and the fixed checkpoint from independent archive RPCs.
4. Cross-check the same values in the official explorer.
5. Pin both hashes in source. The guard requires every configured provider to
   return the same values and fails closed on disagreement or unavailability.

A malicious RPC that merely reports chain id 84532 cannot pass: its genesis and
checkpoint hashes will differ unless it reproduces the canonical chain.

## Change control

Changing either hash requires repeating the evidence above, recording the new
commit/explorer links, and a code review. Do not copy a hash from another
network or from an unverified RPC response.
