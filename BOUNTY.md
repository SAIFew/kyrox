# KYROX — Contribution Rewards, Bug Bounty & Early Builder Programme

- **Programme Stage:** Chapter 1, Day 13 (November 20, 2026) — Early Tester Onboarding & Bug Reporting
- **Scope (`v0.1`):** KYROX (`kyrox-mcp`) Non-Custodial Model Context Protocol Server · **Base Sepolia Testnet (`chainId: 84532`)** & Local Mock Stock Fixtures (`data/stocks.json`)
- **Security Policy:** See [SECURITY.md](SECURITY.md) for mandatory non-custodial boundaries and private vulnerability disclosure rules.

---

## 1. Programme Overview

KYROX is opening early access to five external builders developing AI agents, MCP integrations, and applications on Base. To reward genuine technical testing, reproducible bug reports, and verified agent integrations, KYROX follows the official reward structure defined in the original KYRO Build-in-Public playbook.

> **Important Distinction — Testnet Mock Tokens vs. Contribution Rewards:**
> All KYROX `v0.1` functional testing takes place exclusively on **Base Sepolia testnet (`chainId: 84532`)** using mock ERC-20 stock tokens (`tAAPL`, `tTSLA`, `tNVDA` from [contracts/MockStock.sol](contracts/MockStock.sol)). **Testnet mock stock tokens have zero monetary value** and are completely separate from the USDC contribution rewards described in this document. Testnet mock assets are never proof of real reward funding.

---

## 2. Programme Honesty & Status Summary

To maintain complete transparency with external contributors, the table below distinguishes active rewards, future rewards, funding verification status, and badge implementation status as of **Day 13 (November 20, 2026)**:

| Category | Schedule / Amount | Current Status (Day 13) | Verification & Funding Notes |
|---|---|---|---|
| **Bug Bounty** | **$10–$50 USDC** per confirmed, reproducible bug (severity-dependent) | **ACTIVE (Day 13)** | Maintainer determines final severity and award within the $10–$50 range with a clear explanation. Precise category sub-allocation is not specified in the playbook. |
| **First Integrations** | **$25 USDC** for each of the first **6** qualifying integrations (**$150 USDC** max planned allocation) | **ACTIVE (Day 13)** | Requires connecting contributor's own AI agent to KYROX, a genuine screen recording, and independent verification. |
| **Feature Idea That Ships** | **$50 USDC** + attribution in the relevant Feature Drop | **FUTURE (Starts Day 14 — Nov 21, 2026)** | Not active on Day 13. The proposed feature must actually be implemented and shipped by KYROX. |
| **Community Challenge** | **$150 USDC** split across the top 3 contributions | **FUTURE (Starts Chapter 2, Week 2)** | Not an active Day 13 or Chapter 1 reward. |
| **Suggested Programme Pool** | **$400 USDC** suggested total across Chapter 1 and early Chapter 2 | **UNCONFIRMED FUNDING** | Suggested playbook budget only; **not** verified as escrowed or pre-funded on-chain. No unlimited payout obligation. |
| **USDC Payout Network & Treasury** | Not specified in the original playbook | **UNCONFIRMED / PENDING OWNER** | Do **not** assume Base Sepolia is the payout network. No payout wallet or treasury address is published until confirmed by the project owner. |
| **Legal & Tax Review** | Required prior to any actual USDC distribution | **PENDING OWNER REVIEW** | Actual USDC payouts require appropriate tax, eligibility, and legal review before distribution. |
| **Early Builder Badge** | Free, non-transferable onchain badge on Base for testers, bug reporters & integrators | **PLANNED / PENDING DEPLOYMENT** | No badge smart contract exists in `contracts/` (`contracts/MockStock.sol` is the only contract in the repo). Zero badges have been deployed or minted. |

---

## 3. Official Reward Schedule

### 3.1 Bug Bounty (Active — Day 13)

- **Reward Range:** **$10–$50 USDC** for each confirmed, reproducible bug.
- **Determination of Award:** Payout within the **$10–$50 USDC** range depends on severity and technical impact. The KYROX maintainer determines the final severity assessment and exact award amount within the official $10–$50 range and will provide a clear written explanation of the determination.
- **No Invented Sub-Tiers:** Because the original playbook does not define fixed dollar figures for individual severity labels, KYROX does not publish arbitrary fixed sub-tier dollar brackets. Factors considered include whether the issue impacts non-custodial safety boundaries (`tools/policy.py`, `tools/tx.py`), secret redaction and fail-closed audit logging (`tools/log.py`, `tools/errors.py`), decimal financial arithmetic (`tools/wallet.py`), or MCP `stdio` protocol framing (`server.py`).

### 3.2 First Integrations (Active — Day 13)

- **Reward Amount:** **$25 USDC** for each of the first **six (6)** qualifying integrations.
- **Maximum Planned Integration Allocation:** **$150 USDC** total (`6 × $25 USDC`).
- **Qualification Requirements:**
  1. Connect your own AI agent or MCP workflow to KYROX (`kyrox-mcp`).
  2. Provide a **genuine screen recording** demonstrating the end-to-end integration invoking KYROX MCP tools.
  3. The integration must be **independently verifiable** by the KYROX maintainer.
- **How Integrators Submit Evidence:**
  - Open an issue or contact the maintainer with your integration submission containing:
    1. A description of your AI agent framework, MCP client configuration, and use case.
    2. A link or attachment to an unedited screen recording showing your AI agent discovering and calling KYROX tools (such as `list_stocks`, `get_stock_info`, `get_wallet_balances`, `get_portfolio`, `prepare_transaction`, or `simulate_transaction`).
    3. Reproducible verification evidence (such as a public code repository, configuration snippet, or step-by-step reproduction instructions) so the maintainer can independently verify the integration.
    4. **Redaction Requirement:** Ensure that no private keys, recovery phrases, `.env` secrets, or live API keys appear anywhere in your recording, terminal output, or configuration files.

### 3.3 Feature Idea That Ships (Future — Starts Day 14)

- **Reward Amount:** **$50 USDC**.
- **Activation Date:** **Starts Day 14 (November 21, 2026)** — *not active on Day 13*.
- **Qualification Requirements:**
  - The proposed feature idea must actually be selected, implemented, tested, and shipped by KYROX.
  - When the feature ships, the contributing builder receives attribution in the corresponding KYROX Feature Drop.

### 3.4 Community Challenge (Future — Starts Chapter 2, Week 2)

- **Reward Amount:** **$150 USDC** split across the top three (3) contributions.
- **Activation Date:** **Starts in Chapter 2, Week 2** — *not an active Day 13 or Chapter 1 reward*.

---

## 4. Programme Pool, Funding & Payment Conditions

Please review the following financial disclosures carefully before participating:

1. **Suggested Programme Budget vs. Confirmed Funds:** The original KYRO build playbook suggests a **$400 USDC** total reward pool across Chapter 1 and the first weeks of Chapter 2. However, the playbook does not specify a fixed budget sub-allocation for the bug-bounty category, nor does it establish that $400 USDC is currently funded, escrowed, or held in a treasury contract.
2. **No Unverified Funding Claims or Unlimited Obligations:** KYROX does not claim that reward funds are currently escrowed and does not assume an unlimited payout obligation. All rewards are bounded by confirmed programme funding and owner approval.
3. **Payout Network & Treasury Status:** The USDC payout network is **not specified** in the playbook. Do **not** assume Base Sepolia (`chainId: 84532`) is the USDC payment network, as Base Sepolia is strictly a test network with no real monetary value. No payout wallet or treasury address is published in this repository.
4. **Conditions Precedent to Payment:** This document outlines the official playbook reward rules and does not constitute an unconditional guarantee of payment prior to:
   - Independent technical verification of the submission by the maintainer;
   - Confirmation of available reward funding and the designated USDC payout network by the project owner; and
   - Completion of appropriate **tax, eligibility, and legal review** before actual USDC distribution.

---

## 5. Submission Eligibility & Scope Rules

To qualify for evaluation under the Bug Bounty or First Integrations programme, a submission must satisfy all five criteria:

1. **Reproducible:** Must include exact, numbered reproduction steps, KYROX version or Git commit hash, environment details (`Local installation`, `Base Sepolia`, or explained `Other`), and expected vs. actual behaviour using [.github/ISSUE_TEMPLATE/bug_report.yml](.github/ISSUE_TEMPLATE/bug_report.yml).
2. **Relevant to KYROX:** Must pertain directly to the KYROX repository (`server.py`, `tools/`, `data/`, `contracts/MockStock.sol`, packaging, or documentation).
3. **Independently Verified:** Must be reproduced and confirmed by the KYROX maintainer in a clean environment.
4. **Not a Duplicate:** Must not duplicate an existing GitHub Issue, a previously disclosed report, or an explicitly documented `v0.1` architectural limitation (for example, the intentionally blank `token_address: ""` fields in packaged [data/stocks.json](data/stocks.json) or the absence of transaction signing/broadcasting in KYROX).
5. **Within Stated Scope:** Must fall within KYROX `v0.1` scope (non-custodial MCP server operating on Base Sepolia `chainId: 84532` and labelled mock fixtures). Issues in third-party dependencies, external RPC provider downtime, or out-of-scope mainnet features do not qualify.

---

## 6. Responsible Disclosure & Mandatory Security Rules

All testers, bug reporters, and integrators must follow the security rules in [SECURITY.md](SECURITY.md):

- **Private Disclosure for Security Vulnerabilities:** If you discover a security vulnerability (such as a policy-gate bypass, secret-redaction leak, or validation boundary flaw), **do not post public exploit details in a public GitHub Issue or discussion thread**. Disclose it privately via **GitHub Private Vulnerability Reporting** (**Security $\rightarrow$ Advisories $\rightarrow$ Report a vulnerability** on the repository).
- **Zero Tolerance for Public Exploit or Key Exposure:** Never upload, paste, or transmit:
  - Private keys or keystore files
  - Recovery phrases / seed phrases / mnemonics
  - `.env` files
  - Wallet passwords, API secrets, or bearer tokens
  - Unnecessary personal information

---

## 7. Planned Early Builder Badge (Non-Financial Recognition)

The KYRO campaign roadmap includes a planned **Early Builder Badge** initiative to recognize early technical contributors:

- **Core Properties:**
  - **Free:** No purchase price or mint fee.
  - **Non-Transferable:** Designed as a non-transferable (soulbound) recognition credential.
  - **Onchain on Base:** Planned for deployment on Base.
  - **Intended Recipients:** Verified early testers, reproducible-bug reporters, and qualifying AI agent integrators.
- **Strict Non-Financial & No-Airdrop Boundary:**
  - The Early Builder Badge is **not** a financial token, security, investment product, or payment instrument, and carries **zero monetary value**.
  - KYROX has **no project token**. Participation in testing, bug reporting, integrations, or the planned Early Builder Badge carries **no promise, hint, or expectation of future token conversion, financial yield, or airdrops**.
- **Current Implementation & Deployment Status (`PLANNED / PENDING DEPLOYMENT`):**
  - As of Day 13, the repository contains only [contracts/MockStock.sol](contracts/MockStock.sol). **No Early Builder Badge smart contract has been implemented or deployed**, and **no contributor has received a badge yet**. The badge remains planned/pending implementation and verification.
