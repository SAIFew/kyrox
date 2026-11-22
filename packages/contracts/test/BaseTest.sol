// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { KyroxExchange } from "../src/KyroxExchange.sol";
import { TestStock } from "../src/TestStock.sol";
import { TestUSDC } from "../src/TestUSDC.sol";

/// @notice Shared fixture for KYROX contract tests.
/// @dev Named without `.t.sol` so Foundry does not treat it as a test suite.
abstract contract BaseTest is Test {
    uint64 internal constant START_TIME = 1_700_000_000;
    uint32 internal constant MAX_SOURCE_AGE = 3_600;
    uint256 internal constant PRICE_230 = 230e6;

    address internal admin = makeAddr("admin");
    address internal updater = makeAddr("updater");
    address internal pauser = makeAddr("pauser");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    TestUSDC internal usdc;
    KyroxExchange internal exchange;
    TestStock internal stock18;

    function setUp() public virtual {
        vm.warp(START_TIME);

        usdc = new TestUSDC(admin);
        exchange = new KyroxExchange(address(usdc), admin);
        stock18 = new TestStock("Test Apple", "tAAPL", 18, admin);

        vm.startPrank(admin);
        usdc.grantRole(usdc.EXCHANGE_ROLE(), address(exchange));
        stock18.grantRole(stock18.EXCHANGE_ROLE(), address(exchange));
        exchange.grantRole(exchange.PRICE_UPDATER_ROLE(), updater);
        exchange.grantRole(exchange.PAUSER_ROLE(), pauser);
        exchange.listAsset(address(stock18), MAX_SOURCE_AGE, 1, 1e30);
        vm.stopPrank();

        _publishPrice(address(stock18), PRICE_230, 1);
    }

    /// @notice Publish a simulated observation with a source timestamp 1s in the past.
    function _publishPrice(address token, uint256 price, uint256 roundId) internal {
        vm.prank(updater);
        exchange.setPrice(
            token, price, roundId, uint64(block.timestamp) - 1, 84532, address(0), true
        );
    }

    /// @notice Deploy, wire and list an additional stock token with given decimals.
    function _newListedStock(uint8 decimals) internal returns (TestStock token) {
        token = new TestStock("Test Asset", "tTEST", decimals, admin);
        vm.startPrank(admin);
        token.grantRole(token.EXCHANGE_ROLE(), address(exchange));
        exchange.listAsset(address(token), MAX_SOURCE_AGE, 1, 1e30);
        vm.stopPrank();
    }

    /// @notice Fund a user through the welcome faucet and approve the exchange.
    function _fundAndApprove(address user, uint256 approveUsdc) internal {
        vm.startPrank(user);
        usdc.claimWelcome();
        usdc.approve(address(exchange), approveUsdc);
        vm.stopPrank();
    }
}
