// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stock token that deliberately mints one base unit too little or too much.
/// @dev Used to prove that a successful mint return does not replace balance-delta verification.
contract IncorrectMintStock is ERC20 {
    bool public overMint;

    constructor() ERC20("Incorrect Mint", "tMINT") { }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function setOverMint(bool value) external {
        overMint = value;
    }

    function mintByExchange(address to, uint256 amount) external {
        _mint(to, overMint ? amount + 1 : amount - 1);
    }

    function burnByExchange(address from, uint256 amount) external {
        require(from == msg.sender, "not self");
        _burn(from, amount);
    }
}
