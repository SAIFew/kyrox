// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { BaseTest } from "./BaseTest.sol";
import { TestStock } from "../src/TestStock.sol";

/// @notice Fuzz properties for the arithmetic that moves value.
contract Fuzz_Test is BaseTest {
    uint256 private nextRound = 2;

    function _setFuzzPrice(address token, uint256 price) private {
        vm.prank(updater);
        exchange.setPrice(
            token, price, nextRound++, uint64(block.timestamp) - 1, 84532, address(0), true
        );
    }

    function testFuzz_BuyUsesFloorMulDiv(uint256 usdcIn, uint256 price) public {
        usdcIn = bound(usdcIn, 1, 1e24);
        price = bound(price, 1, 1e24);

        _setFuzzPrice(address(stock18), price);

        uint256 expected = Math.mulDiv(usdcIn, 1e18, price);
        assertEq(exchange.quoteBuy(address(stock18), usdcIn), expected);
    }

    function testFuzz_SellUsesFloorMulDiv(uint256 stockIn, uint256 price) public {
        stockIn = bound(stockIn, 1, 1e30);
        price = bound(price, 1, 1e24);

        _setFuzzPrice(address(stock18), price);

        uint256 expected = Math.mulDiv(stockIn, price, 1e18);
        assertEq(exchange.quoteSell(address(stock18), stockIn), expected);
    }

    function testFuzz_BuyIsMonotonicInInput(uint256 a, uint256 b) public {
        a = bound(a, 1, 1e24);
        b = bound(b, a, 1e24);

        assertLe(exchange.quoteBuy(address(stock18), a), exchange.quoteBuy(address(stock18), b));
    }

    function testFuzz_SellIsMonotonicInInput(uint256 a, uint256 b) public {
        a = bound(a, 1, 1e30);
        b = bound(b, a, 1e30);

        assertLe(exchange.quoteSell(address(stock18), a), exchange.quoteSell(address(stock18), b));
    }

    function testFuzz_BuyNeverOverpaysStock(uint128 usdcIn, uint64 price) public {
        usdcIn = uint128(bound(usdcIn, 1, 1e20));
        price = uint64(bound(price, 1e6, 1e18));

        _setFuzzPrice(address(stock18), price);

        uint256 stockOut = exchange.quoteBuy(address(stock18), usdcIn);
        // stockOut * price <= usdcIn * 1e18 must hold after flooring.
        assertLe(stockOut * price, uint256(usdcIn) * 1e18);
        // And it must be the largest such integer.
        assertGt((stockOut + 1) * price, uint256(usdcIn) * 1e18);
    }

    function testFuzz_DecimalsAreHonoured(uint96 usdcIn, uint64 price) public {
        usdcIn = uint96(bound(usdcIn, 1, 1e18));
        price = uint64(bound(price, 1e6, 1e18));

        TestStock six = _newListedStock(6);
        TestStock eight = _newListedStock(8);
        _setFuzzPrice(address(six), price);
        _setFuzzPrice(address(eight), price);
        _setFuzzPrice(address(stock18), price);

        assertEq(exchange.quoteBuy(address(six), usdcIn), Math.mulDiv(usdcIn, 1e6, price));
        assertEq(exchange.quoteBuy(address(eight), usdcIn), Math.mulDiv(usdcIn, 1e8, price));
        assertEq(exchange.quoteBuy(address(stock18), usdcIn), Math.mulDiv(usdcIn, 1e18, price));
    }

    function testFuzz_RoundTripNeverProfits(uint128 usdcIn, uint64 price) public {
        usdcIn = uint128(bound(usdcIn, 1, 900e6));
        price = uint64(bound(price, 1e6, 1e18));

        _setFuzzPrice(address(stock18), price);
        uint256 quotedStock = exchange.quoteBuy(address(stock18), usdcIn);
        // The smallest trades can round to zero on the way back out; the
        // exchange correctly refuses those, so exclude them from this property.
        vm.assume(quotedStock > 0);
        vm.assume(exchange.quoteSell(address(stock18), quotedStock) > 0);
        _fundAndApprove(alice, type(uint256).max);

        vm.startPrank(alice);
        uint256 stockOut = exchange.buy(address(stock18), usdcIn, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        uint256 usdcBack = exchange.sell(address(stock18), stockOut, 0, type(uint256).max);
        vm.stopPrank();

        assertLe(usdcBack, usdcIn, "round trip must not create value");
    }

    function testFuzz_LowPriceBuyStillFloors(uint96 usdcIn, uint32 price) public {
        usdcIn = uint96(bound(usdcIn, 1, 1e18));
        price = uint32(bound(price, 1, 1e6));

        _setFuzzPrice(address(stock18), price);
        assertEq(exchange.quoteBuy(address(stock18), usdcIn), Math.mulDiv(usdcIn, 1e18, price));
    }

    function testFuzz_LowPriceSellStillFloors(uint96 stockIn, uint32 price) public {
        stockIn = uint96(bound(stockIn, 1, 1e18));
        price = uint32(bound(price, 1, 1e6));

        _setFuzzPrice(address(stock18), price);
        assertEq(exchange.quoteSell(address(stock18), stockIn), Math.mulDiv(stockIn, price, 1e18));
    }

    function testFuzz_SellThenBuyNeverIncreasesStock(uint64 price) public {
        price = uint64(bound(price, 1e6, 1e18));
        _setFuzzPrice(address(stock18), price);
        _fundAndApprove(alice, type(uint256).max);

        vm.startPrank(alice);
        uint256 stockOut = exchange.buy(address(stock18), 100e6, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        uint256 usdcBack = exchange.sell(address(stock18), stockOut, 0, type(uint256).max);
        uint256 stockBack = exchange.buy(address(stock18), usdcBack, 0, type(uint256).max);
        vm.stopPrank();

        assertLe(stockBack, stockOut, "sell then buy must not create stock");
    }

    /// @notice The quote views must never exceed what the actual trade returns.
    function testFuzz_QuoteMatchesExecution(uint96 usdcIn, uint64 price) public {
        usdcIn = uint96(bound(usdcIn, 1e3, 900e6));
        price = uint64(bound(price, 1e6, 1e18));

        _setFuzzPrice(address(stock18), price);
        _fundAndApprove(alice, type(uint256).max);

        uint256 quoted = exchange.quoteBuy(address(stock18), usdcIn);
        vm.assume(quoted > 0);

        vm.prank(alice);
        uint256 received = exchange.buy(address(stock18), usdcIn, quoted, type(uint256).max);

        assertEq(received, quoted);
    }
}
