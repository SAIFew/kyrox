// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { BaseTest } from "./BaseTest.sol";
import { TestStock } from "../src/TestStock.sol";

contract TestStock_Test is BaseTest {
    function test_MetadataAndDecimals() public view {
        assertEq(stock18.name(), "Test Apple");
        assertEq(stock18.symbol(), "tAAPL");
        assertEq(stock18.decimals(), 18);
    }

    function test_SupportsSixAndEightDecimals() public {
        TestStock six = new TestStock("Six", "tSIX", 6, admin);
        TestStock eight = new TestStock("Eight", "tEIGHT", 8, admin);
        assertEq(six.decimals(), 6);
        assertEq(eight.decimals(), 8);
    }

    function test_ConstructorValidation() public {
        vm.expectRevert(TestStock.ZeroAddress.selector);
        new TestStock("X", "tX", 18, address(0));

        vm.expectRevert(abi.encodeWithSelector(TestStock.InvalidDecimals.selector, uint8(0)));
        new TestStock("X", "tX", 0, admin);

        vm.expectRevert(abi.encodeWithSelector(TestStock.InvalidDecimals.selector, uint8(78)));
        new TestStock("X", "tX", 78, admin);
    }

    function test_ExchangeCanMintAndBurn() public {
        vm.startPrank(address(exchange));
        stock18.mintByExchange(address(exchange), 5e18);
        assertEq(stock18.balanceOf(address(exchange)), 5e18);
        stock18.burnByExchange(address(exchange), 5e18);
        assertEq(stock18.balanceOf(address(exchange)), 0);
        vm.stopPrank();
    }

    function test_ExchangeCannotBurnAnotherHoldersBalance() public {
        vm.prank(address(exchange));
        stock18.mintByExchange(alice, 1e18);

        vm.expectRevert(abi.encodeWithSelector(TestStock.BurnFromNotSelf.selector, alice));
        vm.prank(address(exchange));
        stock18.burnByExchange(alice, 1e18);
    }

    function test_UnauthorizedMintReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        stock18.mintByExchange(alice, 1);
    }

    function test_UnauthorizedBurnReverts() public {
        vm.prank(address(exchange));
        stock18.mintByExchange(alice, 1e18);

        vm.expectRevert();
        vm.prank(alice);
        stock18.burnByExchange(alice, 1e18);
    }

    function test_AdminCannotMintWithoutExchangeRole() public {
        vm.prank(admin);
        vm.expectRevert();
        stock18.mintByExchange(admin, 1);
    }

    function test_MintAndBurnRejectZeroAmountAndZeroAddress() public {
        vm.startPrank(address(exchange));
        vm.expectRevert(TestStock.ZeroAmount.selector);
        stock18.mintByExchange(alice, 0);
        vm.expectRevert(TestStock.ZeroAddress.selector);
        stock18.mintByExchange(address(0), 1);
        vm.expectRevert(TestStock.ZeroAmount.selector);
        stock18.burnByExchange(address(exchange), 0);
        vm.expectRevert(abi.encodeWithSelector(TestStock.BurnFromNotSelf.selector, alice));
        stock18.burnByExchange(alice, 1);
        vm.stopPrank();
    }

    function test_RevokingExchangeRoleStopsMintingAndAllowsMigration() public {
        address oldExchange = address(exchange);
        bytes32 exchangeRole = stock18.EXCHANGE_ROLE();
        vm.prank(admin);
        stock18.revokeRole(exchangeRole, oldExchange);

        vm.startPrank(oldExchange);
        vm.expectRevert();
        stock18.mintByExchange(oldExchange, 1);
        vm.stopPrank();

        address newExchange = address(0xBEEF);
        vm.prank(admin);
        stock18.grantRole(exchangeRole, newExchange);

        vm.prank(newExchange);
        stock18.mintByExchange(newExchange, 5e18);
        assertEq(stock18.balanceOf(newExchange), 5e18);
    }

    function test_BurnCannotExceedBalance() public {
        vm.expectRevert();
        vm.prank(address(exchange));
        stock18.burnByExchange(address(exchange), 1);
    }

    function test_NoUnrestrictedMintSelector() public {
        // The contract exposes no mint(address,uint256) entry point; only the role-gated path.
        (bool ok,) =
            address(stock18).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1e18));
        assertFalse(ok);
    }
}
