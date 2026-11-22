// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stock token that keeps a 1% fee on every transfer.
/// @dev Used to prove the exchange verifies delivered amounts instead of trusting
/// `transferFrom` to deliver the requested quantity.
contract FeeOnTransferStock is ERC20 {
    uint8 private immutable _decimals;

    constructor(uint8 decimals_) ERC20("Fee Stock", "tFEE") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mintByExchange(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burnByExchange(address from, uint256 amount) external {
        require(from == msg.sender, "not self");
        _burn(from, amount);
    }

    function mintForTest(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        uint256 fee = value / 100;
        _transfer(from, to, value - fee);
        _burn(from, fee);
        _spendAllowance(from, msg.sender, value);
        return true;
    }
}
