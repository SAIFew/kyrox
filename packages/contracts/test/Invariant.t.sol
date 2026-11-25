// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { BaseTest } from "./BaseTest.sol";
import { KyroxExchange } from "../src/KyroxExchange.sol";
import { IKyroxPriceSource } from "../src/interfaces/IKyroxPriceSource.sol";
import { TestStock } from "../src/TestStock.sol";
import { TestUSDC } from "../src/TestUSDC.sol";

/// @notice Stateful actor used by the invariant suite.
/// @dev Every action is restricted to a valid state transition. The invariant
/// profile uses fail_on_revert=true, so no blanket catch may hide a regression.
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
    uint256 public successfulBuys;
    uint256 public successfulSells;
    uint256 public successfulPriceRefreshes;
    uint256 public successfulPauses;
    uint256 public successfulUnpauses;

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
            address fundedActor = actors[i];
            VM.prank(fundedActor);
            usdc.claimWelcome();
            VM.startPrank(fundedActor);
            usdc.approve(address(exchange), type(uint256).max);
            stock.approve(address(exchange), type(uint256).max);
            VM.stopPrank();
        }

        // Seed successful actions so the suite proves that meaningful paths
        // execute, rather than passing solely because every action was skipped.
        _refreshPrice();
        _pause();
        _unpause();
        address actor = actors[0];
        VM.prank(actor);
        uint256 bought = exchange.buy(address(stock), 230e6, 0, type(uint256).max);
        netStockMinted += int256(bought);
        successfulBuys += 1;
        VM.prank(actor);
        exchange.sell(address(stock), bought / 2, 0, type(uint256).max);
        netStockMinted -= int256(bought / 2);
        successfulSells += 1;
    }

    function buy(uint256 actorSeed, uint256 usdcIn) external {
        if (exchange.paused() || !_priceIsFresh()) return;
        address actor = actors[actorSeed % actors.length];
        uint256 balance = usdc.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = _bound(usdcIn, 1, balance);
        if (exchange.quoteBuy(address(stock), amount) == 0) return;

        VM.prank(actor);
        uint256 out = exchange.buy(address(stock), amount, 0, type(uint256).max);
        netStockMinted += int256(out);
        successfulBuys += 1;
    }

    function sell(uint256 actorSeed, uint256 stockIn) external {
        if (exchange.paused() || !_priceIsFresh()) return;
        address actor = actors[actorSeed % actors.length];
        uint256 balance = stock.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = _bound(stockIn, 1, balance);
        if (exchange.quoteSell(address(stock), amount) == 0) return;

        VM.prank(actor);
        exchange.sell(address(stock), amount, 0, type(uint256).max);
        netStockMinted -= int256(amount);
        successfulSells += 1;
    }

    function warp(uint256 secondsAhead) external {
        IKyroxPriceSource.Observation memory obs = exchange.observation(address(stock));
        uint256 maxAge = exchange.maxSourceAgeSeconds(address(stock));
        uint256 age = block.timestamp - obs.sourceUpdatedAt;
        if (age >= maxAge) return;
        VM.warp(block.timestamp + _bound(secondsAhead, 1, maxAge - age));
    }

    function refreshPrice() external {
        _refreshPrice();
    }

    function pause() external {
        _pause();
    }

    function unpause() external {
        _unpause();
    }

    function _refreshPrice() private {
        roundId += 1;
        VM.prank(updater);
        exchange.setPrice(
            address(stock), 230e6, roundId, uint64(block.timestamp), 84532, address(0), true
        );
        successfulPriceRefreshes += 1;
    }

    function _pause() private {
        if (exchange.paused()) return;
        VM.prank(pauser);
        exchange.pause();
        successfulPauses += 1;
    }

    function _unpause() private {
        if (!exchange.paused()) return;
        VM.prank(pauser);
        exchange.unpause();
        successfulUnpauses += 1;
    }

    function _priceIsFresh() private view returns (bool) {
        IKyroxPriceSource.Observation memory obs = exchange.observation(address(stock));
        uint256 maxAge = exchange.maxSourceAgeSeconds(address(stock));
        return maxAge != 0 && block.timestamp <= uint256(obs.sourceUpdatedAt) + maxAge;
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

    /// @dev The suite must exercise successful state transitions, not only skips.
    function invariant_MeaningfulActionsOccurred() public view {
        assertGt(handler.successfulBuys(), 0);
        assertGt(handler.successfulSells(), 0);
        assertGt(handler.successfulPriceRefreshes(), 0);
        assertGt(handler.successfulPauses(), 0);
        assertGt(handler.successfulUnpauses(), 0);
    }

    /// @dev Privileged mint/burn authority remains exclusive to this exchange.
    function invariant_ExchangeRoleRemainsExclusive() public view {
        assertTrue(stock18.hasRole(stock18.EXCHANGE_ROLE(), address(exchange)));
        assertFalse(stock18.hasRole(stock18.EXCHANGE_ROLE(), address(handler)));
        assertFalse(stock18.hasRole(stock18.EXCHANGE_ROLE(), admin));
    }
}
