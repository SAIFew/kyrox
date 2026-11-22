// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { BaseTest } from "./BaseTest.sol";
import { KyroxExchange } from "../src/KyroxExchange.sol";
import { TestStock } from "../src/TestStock.sol";
import { TestUSDC } from "../src/TestUSDC.sol";

/// @notice Stateful actor used by the invariant suite.
/// @dev Deliberately plain (not a Test) so the fuzzer only targets trade actions.
contract ExchangeHandler {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    KyroxExchange public immutable exchange;
    TestUSDC public immutable usdc;
    TestStock public immutable stock;
    address public immutable pauser;
    address public immutable updater;

    address[3] public actors;
    int256 public netStockMinted;
    uint256 private roundId = 1;

    constructor(
        KyroxExchange exchange_,
        TestUSDC usdc_,
        TestStock stock_,
        address pauser_,
        address updater_
    ) {
        exchange = exchange_;
        usdc = usdc_;
        stock = stock_;
        pauser = pauser_;
        updater = updater_;

        actors = [address(0x10001), address(0x10002), address(0x10003)];

        for (uint256 i = 0; i < actors.length; i++) {
            address actor = actors[i];
            VM.prank(actor);
            usdc.claimWelcome();
            VM.startPrank(actor);
            usdc.approve(address(exchange), type(uint256).max);
            stock.approve(address(exchange), type(uint256).max);
            VM.stopPrank();
        }
    }

    function buy(uint256 actorSeed, uint256 usdcIn) external {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = usdc.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = _bound(usdcIn, 1, balance);

        VM.prank(actor);
        try exchange.buy(address(stock), amount, 0, block.timestamp) returns (uint256 out) {
            netStockMinted += int256(out);
        } catch { }
    }

    function sell(uint256 actorSeed, uint256 stockIn) external {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = stock.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = _bound(stockIn, 1, balance);

        VM.prank(actor);
        try exchange.sell(address(stock), amount, 0, block.timestamp) returns (uint256) {
            netStockMinted -= int256(amount);
        } catch { }
    }

    function warp(uint256 secondsAhead) external {
        VM.warp(block.timestamp + _bound(secondsAhead, 1, 7_200));
    }

    function refreshPrice() external {
        roundId += 1;
        VM.prank(updater);
        try exchange.setPrice(
            address(stock), 230e6, roundId, uint64(block.timestamp) - 1, 84532, address(0), true
        ) { }
            catch { }
    }

    function pause() external {
        VM.prank(pauser);
        try exchange.pause() { } catch { }
    }

    function unpause() external {
        VM.prank(pauser);
        try exchange.unpause() { } catch { }
    }

    function _bound(uint256 x, uint256 min, uint256 max) private pure returns (uint256) {
        if (max <= min) return min;
        return min + (x % (max - min + 1));
    }
}

/// @notice Invariants derived from the exchange implementation and ADR-0008.
contract Invariant_Test is BaseTest {
    ExchangeHandler private handler;

    function setUp() public override {
        super.setUp();
        handler = new ExchangeHandler(exchange, usdc, stock18, pauser, updater);
        targetContract(address(handler));
    }

    /// @dev Trades are atomic; the venue must never retain USDC or stock.
    function invariant_ExchangeHoldsNoResidualBalances() public view {
        assertEq(usdc.balanceOf(address(exchange)), 0);
        assertEq(stock18.balanceOf(address(exchange)), 0);
    }

    /// @dev Stock supply changes only through priced buys and sells.
    function invariant_StockSupplyEqualsNetTrades() public view {
        assertEq(stock18.totalSupply(), uint256(handler.netStockMinted()));
    }

    /// @dev Net minted stock can never be negative.
    function invariant_NetStockNeverNegative() public view {
        assertGe(handler.netStockMinted(), 0);
    }
}
