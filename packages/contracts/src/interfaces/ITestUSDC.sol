// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ITestUSDC
/// @notice Minimal settlement-token surface used by the exchange.
interface ITestUSDC is IERC20 {
    function decimals() external view returns (uint8);

    function mintByExchange(address to, uint256 amount) external;

    function burnByExchange(address from, uint256 amount) external;
}
