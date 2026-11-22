// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { KyroxExchange } from "../../src/KyroxExchange.sol";

/// @notice Malicious stock token used to prove the exchange's reentrancy guard.
/// @dev Only ever allowlisted inside tests. `transferFrom` re-enters `buy`.
contract ReentrantStock is ERC20 {
    KyroxExchange public exchange;
    bool public attack;
    bool public attackOnMint;

    constructor() ERC20("Reentrant Stock", "tRENT") { }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function setExchange(address exchange_) external {
        exchange = KyroxExchange(exchange_);
    }

    function setAttack(bool attack_) external {
        attack = attack_;
    }

    function setAttackOnMint(bool attack_) external {
        attackOnMint = attack_;
    }

    function mintByExchange(address to, uint256 amount) external {
        if (attackOnMint) {
            attackOnMint = false;
            exchange.sell(address(this), 1, 0, type(uint256).max);
        }
        _mint(to, amount);
    }

    function burnByExchange(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function mintForTest(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (attack) {
            attack = false;
            exchange.buy(address(this), 1, 0, type(uint256).max);
        }
        return super.transferFrom(from, to, value);
    }
}
