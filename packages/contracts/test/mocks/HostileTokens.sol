// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC-20 whose transferFrom always returns false.
/// @dev SafeERC20 must turn this into a revert, never a silent shortfall.
contract FalseReturnStock is ERC20 {
    constructor() ERC20("False Return", "tFALSE") { }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mintForTest(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function mintByExchange(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burnByExchange(address from, uint256 amount) external {
        require(from == msg.sender, "not self");
        _burn(from, amount);
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @notice ERC-20 that claims success but moves nothing.
/// @dev Proves the exchange verifies the delivered balance, not the return value.
contract LyingTransferStock is ERC20 {
    constructor() ERC20("Lying Transfer", "tLIE") { }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mintForTest(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function mintByExchange(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burnByExchange(address from, uint256 amount) external {
        require(from == msg.sender, "not self");
        _burn(from, amount);
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return true;
    }
}
