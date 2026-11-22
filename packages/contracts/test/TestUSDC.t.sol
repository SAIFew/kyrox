// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { BaseTest } from "./BaseTest.sol";
import { TestUSDC } from "../src/TestUSDC.sol";

contract TestUSDC_Test is BaseTest {
    event WelcomeClaimed(address indexed account, uint256 amount);
    event DailyClaimed(address indexed account, uint256 amount, uint256 nextClaimAt);

    function test_Metadata() public view {
        assertEq(usdc.name(), "KYROX Test USD");
        assertEq(usdc.symbol(), "tUSDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.WELCOME_AMOUNT(), 1_000e6);
        assertEq(usdc.DAILY_AMOUNT(), 100e6);
        assertEq(usdc.DAILY_PERIOD(), 1 days);
    }

    function test_ConstructorRejectsZeroAdmin() public {
        vm.expectRevert(TestUSDC.ZeroAddress.selector);
        new TestUSDC(address(0));
    }

    function test_WelcomeFaucetPaysOnce() public {
        vm.expectEmit(true, true, true, true, address(usdc));
        emit WelcomeClaimed(alice, 1_000e6);

        vm.prank(alice);
        usdc.claimWelcome();

        assertEq(usdc.balanceOf(alice), 1_000e6);
        assertTrue(usdc.welcomeClaimed(alice));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.AlreadyClaimedWelcome.selector, alice));
        usdc.claimWelcome();
    }

    function test_DailyFaucetPaysAndEnforcesCooldown() public {
        vm.prank(alice);
        usdc.claimDaily();
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.lastDailyClaimAt(alice), block.timestamp);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                TestUSDC.DailyClaimTooSoon.selector, alice, block.timestamp + 1 days
            )
        );
        usdc.claimDaily();

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        usdc.claimDaily();
        assertEq(usdc.balanceOf(alice), 200e6);
    }

    function test_DailyFaucetIsPerAddress() public {
        vm.prank(alice);
        usdc.claimDaily();
        vm.prank(bob);
        usdc.claimDaily();
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(bob), 100e6);
    }

    function test_ExchangeMintAndBurnRequireRole() public {
        vm.prank(alice);
        vm.expectRevert();
        usdc.mintByExchange(alice, 1);

        vm.prank(alice);
        vm.expectRevert();
        usdc.burnByExchange(alice, 1);
    }

    function test_ExchangeCanMintAndBurn() public {
        vm.startPrank(address(exchange));
        usdc.mintByExchange(address(exchange), 250e6);
        assertEq(usdc.balanceOf(address(exchange)), 250e6);
        usdc.burnByExchange(address(exchange), 250e6);
        assertEq(usdc.balanceOf(address(exchange)), 0);
        vm.stopPrank();
    }

    function test_ExchangeCannotBurnAnotherHoldersBalance() public {
        vm.prank(alice);
        usdc.claimWelcome();

        vm.expectRevert(abi.encodeWithSelector(TestUSDC.BurnFromNotSelf.selector, alice));
        vm.prank(address(exchange));
        usdc.burnByExchange(alice, 1e6);
    }

    function test_MintAndBurnRejectZeroAmountAndZeroAddress() public {
        vm.startPrank(address(exchange));
        vm.expectRevert(TestUSDC.ZeroAmount.selector);
        usdc.mintByExchange(alice, 0);
        vm.expectRevert(TestUSDC.ZeroAddress.selector);
        usdc.mintByExchange(address(0), 1);
        vm.expectRevert(TestUSDC.ZeroAmount.selector);
        usdc.burnByExchange(address(exchange), 0);
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.BurnFromNotSelf.selector, alice));
        usdc.burnByExchange(alice, 1);
        vm.stopPrank();
    }

    function test_RevokingExchangeRoleStopsMintingAndAllowsMigration() public {
        address oldExchange = address(exchange);
        bytes32 exchangeRole = usdc.EXCHANGE_ROLE();
        vm.prank(admin);
        usdc.revokeRole(exchangeRole, oldExchange);

        vm.startPrank(oldExchange);
        vm.expectRevert();
        usdc.mintByExchange(oldExchange, 1);
        vm.stopPrank();

        address newExchange = address(0xBEEF);
        vm.prank(admin);
        usdc.grantRole(exchangeRole, newExchange);

        vm.prank(newExchange);
        usdc.mintByExchange(newExchange, 5e6);
        assertEq(usdc.balanceOf(newExchange), 5e6);
    }

    function test_BurnCannotExceedBalance() public {
        vm.expectRevert();
        vm.prank(address(exchange));
        usdc.burnByExchange(address(exchange), 1);
    }
}
