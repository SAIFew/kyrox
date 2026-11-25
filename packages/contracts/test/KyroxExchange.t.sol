// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { BaseTest } from "./BaseTest.sol";
import { FeeOnTransferStock } from "./mocks/FeeOnTransferStock.sol";
import { IncorrectMintStock } from "./mocks/IncorrectMintStock.sol";
import { ReentrantStock } from "./mocks/ReentrantStock.sol";
import { IKyroxPriceSource } from "../src/interfaces/IKyroxPriceSource.sol";
import { KyroxExchange } from "../src/KyroxExchange.sol";
import { TestStock } from "../src/TestStock.sol";

contract KyroxExchange_Test is BaseTest {
    event Trade(
        address indexed trader,
        address indexed stockToken,
        bool indexed isBuy,
        uint256 usdcAmount,
        uint256 stockAmount,
        uint256 priceUsdcPerWholeToken,
        uint256 sourceRoundId,
        uint256 sourceUpdatedAt
    );

    event PriceSet(
        address indexed stockToken,
        uint256 priceUsdcPerWholeToken,
        uint256 sourceRoundId,
        uint256 sourceUpdatedAt,
        uint256 sourceChainId,
        address indexed feedAddress,
        bool simulated,
        uint256 publishedAt
    );

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    function test_ConstructorConfiguration() public view {
        assertEq(address(exchange.usdc()), address(usdc));
        assertEq(exchange.USDC_DECIMALS(), 6);
        assertEq(address(usdc), address(exchange.usdc()));
    }

    function test_ConstructorRejectsNonSixDecimalSettlementToken() public {
        TestStock wrong = new TestStock("Wrong", "tWRONG", 18, admin);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.InvalidUsdcDecimals.selector, uint8(18))
        );
        new KyroxExchange(address(wrong), admin);
    }

    function test_ConstructorRejectsZeroAddresses() public {
        vm.expectRevert(KyroxExchange.ZeroAddress.selector);
        new KyroxExchange(address(0), admin);

        vm.expectRevert(KyroxExchange.ZeroAddress.selector);
        new KyroxExchange(address(usdc), address(0));
    }

    // ---------------------------------------------------------------------
    // Asset allowlisting
    // ---------------------------------------------------------------------

    function test_ListAssetReadsDecimalsFromToken() public {
        TestStock six = new TestStock("Six", "tSIX", 6, admin);
        TestStock eight = new TestStock("Eight", "tEIGHT", 8, admin);

        vm.startPrank(admin);
        exchange.listAsset(address(six), 900, 1, 1e30);
        exchange.listAsset(address(eight), 1_800, 1, 1e30);
        vm.stopPrank();

        KyroxExchange.AssetSettings memory sixSettings = exchange.assetSettings(address(six));
        KyroxExchange.AssetSettings memory eightSettings = exchange.assetSettings(address(eight));

        assertTrue(sixSettings.listed);
        assertEq(sixSettings.stockDecimals, 6);
        assertEq(sixSettings.maxSourceAgeSeconds, 900);
        assertEq(eightSettings.stockDecimals, 8);
        assertEq(exchange.maxSourceAgeSeconds(address(eight)), 1_800);
    }

    function test_ListAssetRejectsDuplicatesAndBadInput() public {
        vm.startPrank(admin);

        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.AssetAlreadyListed.selector, address(stock18))
        );
        exchange.listAsset(address(stock18), 60, 1, 1e30);

        vm.expectRevert(KyroxExchange.ZeroAddress.selector);
        exchange.listAsset(address(0), 60, 1, 1e30);

        vm.expectRevert(KyroxExchange.InvalidMaxSourceAge.selector);
        exchange.listAsset(address(new TestStock("X", "tX", 18, admin)), 0, 1, 1e30);

        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.SettlementTokenCannotBeStock.selector, address(usdc)
            )
        );
        exchange.listAsset(address(usdc), 60, 1, 1e30);

        vm.stopPrank();
    }

    function test_ListAssetRequiresAdmin() public {
        TestStock other = new TestStock("Other", "tOTHER", 18, admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                exchange.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        exchange.listAsset(address(other), 60, 1, 1e30);
    }

    function test_SetMaxSourceAge() public {
        vm.prank(admin);
        exchange.setMaxSourceAge(address(stock18), 120);
        assertEq(exchange.maxSourceAgeSeconds(address(stock18)), 120);

        uint32 tooLarge = exchange.MAX_SOURCE_AGE_SECONDS() + 1;
        vm.startPrank(admin);
        vm.expectRevert(KyroxExchange.InvalidMaxSourceAge.selector);
        exchange.setMaxSourceAge(address(stock18), tooLarge);
        vm.stopPrank();
    }

    function test_ZeroMaxSourceAgeFreezesTheAsset() public {
        _fundAndApprove(alice, type(uint256).max);

        vm.prank(admin);
        exchange.setMaxSourceAge(address(stock18), 0);

        vm.startPrank(updater);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.AssetFrozen.selector, address(stock18))
        );
        exchange.setPrice(address(stock18), 230e6, 2, block.timestamp - 1, 84532, address(0), true);
        vm.stopPrank();

        vm.startPrank(alice);
        vm.expectRevert();
        exchange.buy(address(stock18), 1e6, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_SetMaxSourceAgeRejectsUnlistedAsset() public {
        TestStock other = new TestStock("Other", "tOTHER", 18, admin);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.AssetNotListed.selector, address(other))
        );
        exchange.setMaxSourceAge(address(other), 60);
    }

    // ---------------------------------------------------------------------
    // Price publication and provenance
    // ---------------------------------------------------------------------

    function test_SetPriceStoresProvenanceWithoutRefreshingSourceTime() public {
        vm.warp(block.timestamp + 10);
        uint256 sourceTime = block.timestamp - 2;
        uint256 publicationTime = block.timestamp;

        vm.expectEmit(true, true, true, true, address(exchange));
        emit PriceSet(
            address(stock18), 111e6, 2, sourceTime, 8453, address(0), true, publicationTime
        );

        vm.prank(updater);
        exchange.setPrice(address(stock18), 111e6, 2, sourceTime, 8453, address(0), true);

        IKyroxPriceSource.Observation memory obs = exchange.observation(address(stock18));
        assertEq(obs.priceUsdcPerWholeToken, 111e6);
        assertEq(obs.sourceRoundId, 2);
        assertEq(obs.sourceUpdatedAt, sourceTime);
        assertEq(obs.publishedAt, publicationTime);
        assertEq(obs.sourceChainId, 8453);
        assertEq(obs.feedAddress, address(0));
        assertTrue(obs.simulated);
    }

    function test_SourceTimestampIsNotRewrittenByLaterBlocks() public {
        IKyroxPriceSource.Observation memory before = exchange.observation(address(stock18));
        uint256 originalSourceTime = before.sourceUpdatedAt;
        uint256 originalPublishedAt = before.publishedAt;

        vm.warp(block.timestamp + 300);

        IKyroxPriceSource.Observation memory afterWarp = exchange.observation(address(stock18));
        assertEq(afterWarp.sourceUpdatedAt, originalSourceTime);
        assertEq(afterWarp.publishedAt, originalPublishedAt);
    }

    function test_SetPriceRejectsZeroAndInvalidValues() public {
        vm.startPrank(updater);

        vm.expectRevert(KyroxExchange.InvalidPrice.selector);
        exchange.setPrice(address(stock18), 0, 2, block.timestamp - 1, 84532, address(0), true);

        vm.expectRevert(KyroxExchange.InvalidSourceTimestamp.selector);
        exchange.setPrice(address(stock18), 1e6, 2, 0, 84532, address(0), true);

        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.FutureSourceTimestamp.selector, block.timestamp + 1, block.timestamp
            )
        );
        exchange.setPrice(address(stock18), 1e6, 2, block.timestamp + 1, 84532, address(0), true);

        vm.expectRevert(KyroxExchange.InvalidSourceProvenance.selector);
        exchange.setPrice(address(stock18), 1e6, 2, block.timestamp - 1, 0, address(0), true);

        vm.expectRevert(KyroxExchange.InvalidSourceProvenance.selector);
        exchange.setPrice(
            address(stock18),
            1e6,
            2,
            block.timestamp - 1,
            uint256(type(uint64).max) + 1,
            address(0),
            true
        );

        vm.expectRevert(KyroxExchange.InvalidSourceProvenance.selector);
        exchange.setPrice(address(stock18), 1e6, 2, block.timestamp - 1, 8453, address(0), false);

        vm.stopPrank();
    }

    function test_SetPriceAcceptsNonSimulatedObservationWithFeed() public {
        address feed = makeAddr("feed");
        vm.prank(updater);
        exchange.setPrice(address(stock18), 111e6, 9, block.timestamp - 1, 8453, feed, false);

        IKyroxPriceSource.Observation memory obs = exchange.observation(address(stock18));
        assertEq(obs.feedAddress, feed);
        assertFalse(obs.simulated);
    }

    function test_SetPriceRejectsReplayedRounds() public {
        vm.startPrank(updater);
        vm.expectRevert(abi.encodeWithSelector(KyroxExchange.RoundNotIncreasing.selector, 1, 1));
        exchange.setPrice(address(stock18), 1e6, 1, block.timestamp - 1, 84532, address(0), true);

        vm.expectRevert(abi.encodeWithSelector(KyroxExchange.RoundNotIncreasing.selector, 0, 1));
        exchange.setPrice(address(stock18), 1e6, 0, block.timestamp - 1, 84532, address(0), true);
        vm.stopPrank();
    }

    function test_SetPriceRejectsBackwardsSourceTimestamp() public {
        vm.startPrank(updater);
        exchange.setPrice(address(stock18), 250e6, 2, block.timestamp, 84532, address(0), true);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.SourceTimestampWentBackwards.selector,
                block.timestamp - 1,
                block.timestamp
            )
        );
        exchange.setPrice(address(stock18), 250e6, 3, block.timestamp - 1, 84532, address(0), true);
        vm.stopPrank();
    }

    function test_SetPriceRequiresUpdaterRole() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                exchange.PRICE_UPDATER_ROLE()
            )
        );
        vm.prank(alice);
        exchange.setPrice(address(stock18), 1e6, 2, block.timestamp - 1, 84532, address(0), true);
    }

    function test_SetPriceRejectsUnlistedAsset() public {
        TestStock other = new TestStock("Other", "tOTHER", 18, admin);
        vm.prank(updater);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.AssetNotListed.selector, address(other))
        );
        exchange.setPrice(address(other), 1e6, 1, block.timestamp - 1, 84532, address(0), true);
    }

    // ---------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------

    function test_BuyMintsStockAndBurnsUsdc() public {
        _fundAndApprove(alice, type(uint256).max);
        uint256 supplyBefore = usdc.totalSupply();
        uint256 sourceUpdatedAt = exchange.observation(address(stock18)).sourceUpdatedAt;

        vm.expectEmit(true, true, true, true, address(exchange));
        emit Trade(alice, address(stock18), true, 230e6, 1e18, PRICE_230, 1, sourceUpdatedAt);

        vm.prank(alice);
        uint256 stockOut = exchange.buy(address(stock18), 230e6, 1e18, type(uint256).max);

        assertEq(stockOut, 1e18);
        assertEq(stock18.balanceOf(alice), 1e18);
        assertEq(usdc.balanceOf(alice), 770e6);
        assertEq(usdc.totalSupply(), supplyBefore - 230e6);
        assertEq(stock18.totalSupply(), 1e18);
    }

    function test_BuyRejectsIncorrectMintBalanceDelta() public {
        IncorrectMintStock token = new IncorrectMintStock();
        vm.startPrank(admin);
        exchange.listAsset(address(token), MAX_SOURCE_AGE, 1, 1e30);
        vm.stopPrank();
        _publishPrice(address(token), PRICE_230, 1);
        _fundAndApprove(alice, type(uint256).max);

        uint256 expected = exchange.quoteBuy(address(token), 230e6);
        uint256 usdcBefore = usdc.balanceOf(alice);

        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.UnexpectedMintAmount.selector, expected, expected - 1
            )
        );
        vm.prank(alice);
        exchange.buy(address(token), 230e6, 0, type(uint256).max);

        token.setOverMint(true);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.UnexpectedMintAmount.selector, expected, expected + 1
            )
        );
        vm.prank(alice);
        exchange.buy(address(token), 230e6, 0, type(uint256).max);

        assertEq(token.balanceOf(alice), 0, "failed mint must roll back");
        assertEq(token.totalSupply(), 0, "failed mint must roll back supply");
        assertEq(usdc.balanceOf(alice), usdcBefore, "failed mint must roll back settlement burn");
    }

    function test_BuyHonoursTokenDecimals() public {
        TestStock six = _newListedStock(6);
        TestStock eight = _newListedStock(8);
        _publishPrice(address(six), PRICE_230, 1);
        _publishPrice(address(eight), PRICE_230, 1);

        _fundAndApprove(alice, type(uint256).max);

        vm.startPrank(alice);
        assertEq(exchange.buy(address(six), 1e6, 0, type(uint256).max), 4_347);
        assertEq(exchange.buy(address(eight), 1e6, 0, type(uint256).max), 434_782);
        assertEq(exchange.buy(address(stock18), 1e6, 0, type(uint256).max), 4_347_826_086_956_521);
        vm.stopPrank();

        assertEq(six.balanceOf(alice), 4_347);
        assertEq(eight.balanceOf(alice), 434_782);
    }

    function test_BuyEnforcesMinimumOutput() public {
        _fundAndApprove(alice, type(uint256).max);
        uint256 expected = exchange.quoteBuy(address(stock18), 100e6);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.SlippageExceeded.selector, expected, expected + 1)
        );
        exchange.buy(address(stock18), 100e6, expected + 1, type(uint256).max);

        vm.prank(alice);
        assertEq(exchange.buy(address(stock18), 100e6, expected, type(uint256).max), expected);
    }

    function test_BuyRejectsZeroAmountAndUnlistedAsset() public {
        _fundAndApprove(alice, type(uint256).max);
        TestStock other = new TestStock("Other", "tOTHER", 18, admin);

        vm.startPrank(alice);
        vm.expectRevert(KyroxExchange.ZeroAmount.selector);
        exchange.buy(address(stock18), 0, 0, type(uint256).max);

        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.AssetNotListed.selector, address(other))
        );
        exchange.buy(address(other), 1e6, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_BuyRejectsZeroOutput() public {
        TestStock six = _newListedStock(6);
        _publishPrice(address(six), 1e18, 1);
        _fundAndApprove(alice, type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(KyroxExchange.ZeroOutput.selector);
        exchange.buy(address(six), 1, 0, type(uint256).max);
    }

    function test_SellBurnsStockAndMintsUsdc() public {
        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        exchange.buy(address(stock18), 230e6, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        vm.stopPrank();

        uint256 supplyBefore = usdc.totalSupply();
        uint256 sourceUpdatedAt = exchange.observation(address(stock18)).sourceUpdatedAt;

        vm.expectEmit(true, true, true, true, address(exchange));
        emit Trade(alice, address(stock18), false, 115e6, 5e17, PRICE_230, 1, sourceUpdatedAt);

        vm.prank(alice);
        uint256 usdcOut = exchange.sell(address(stock18), 5e17, 115e6, type(uint256).max);

        assertEq(usdcOut, 115e6);
        assertEq(stock18.balanceOf(alice), 5e17);
        assertEq(stock18.totalSupply(), 5e17);
        assertEq(usdc.balanceOf(alice), 885e6);
        assertEq(usdc.totalSupply(), supplyBefore + 115e6);
    }

    function test_SellHonoursTokenDecimals() public {
        TestStock six = _newListedStock(6);
        TestStock eight = _newListedStock(8);
        _publishPrice(address(six), PRICE_230, 1);
        _publishPrice(address(eight), PRICE_230, 1);

        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        six.approve(address(exchange), type(uint256).max);
        eight.approve(address(exchange), type(uint256).max);

        uint256 sixStock = exchange.buy(address(six), 230e6, 0, type(uint256).max);
        uint256 eightStock = exchange.buy(address(eight), 230e6, 0, type(uint256).max);
        assertEq(sixStock, 1e6);
        assertEq(eightStock, 1e8);

        assertEq(exchange.sell(address(six), sixStock, 230e6, type(uint256).max), 230e6);
        assertEq(exchange.sell(address(eight), eightStock, 230e6, type(uint256).max), 230e6);
        vm.stopPrank();
    }

    function test_ExchangeHoldsNoResidualBalances() public {
        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        uint256 stockOut = exchange.buy(address(stock18), 230e6, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        exchange.sell(address(stock18), stockOut / 2, 0, type(uint256).max);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(exchange)), 0);
        assertEq(stock18.balanceOf(address(exchange)), 0);
    }

    function test_TradingRechecksStoredPriceAgainstCurrentBounds() public {
        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        exchange.buy(address(stock18), 230e6, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        vm.stopPrank();

        vm.prank(admin);
        exchange.setPriceBounds(address(stock18), 240e6, 300e6, 0);

        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.PriceOutsideBounds.selector, PRICE_230, 240e6, 300e6
            )
        );
        exchange.buy(address(stock18), 1e6, 0, type(uint256).max);

        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.PriceOutsideBounds.selector, PRICE_230, 240e6, 300e6
            )
        );
        exchange.sell(address(stock18), 1e18, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_SetPriceAcceptsNewRoundWithEqualSourceTimestamp() public {
        uint64 sourceTime = exchange.observation(address(stock18)).sourceUpdatedAt;

        vm.prank(updater);
        exchange.setPrice(address(stock18), 240e6, 2, sourceTime, 84532, address(0), true);

        IKyroxPriceSource.Observation memory obs = exchange.observation(address(stock18));
        assertEq(obs.sourceRoundId, 2);
        assertEq(obs.sourceUpdatedAt, sourceTime);
        assertEq(obs.priceUsdcPerWholeToken, 240e6);
    }

    function test_SellEnforcesMinimumOutput() public {
        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        exchange.buy(address(stock18), 230e6, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        vm.stopPrank();

        uint256 expected = exchange.quoteSell(address(stock18), 1e17);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.SlippageExceeded.selector, expected, expected + 1)
        );
        exchange.sell(address(stock18), 1e17, expected + 1, type(uint256).max);

        vm.prank(alice);
        assertEq(exchange.sell(address(stock18), 1e17, expected, type(uint256).max), expected);
    }

    function test_SellRejectsZeroAmountAndZeroOutput() public {
        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        exchange.buy(address(stock18), 230e6, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(alice);
        vm.expectRevert(KyroxExchange.ZeroAmount.selector);
        exchange.sell(address(stock18), 0, 0, type(uint256).max);

        vm.expectRevert(KyroxExchange.ZeroOutput.selector);
        exchange.sell(address(stock18), 1, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_RoundTripCostsOnlyRoundingDust() public {
        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        uint256 stockOut = exchange.buy(address(stock18), 1_000_000, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        uint256 usdcBack = exchange.sell(address(stock18), stockOut, 0, type(uint256).max);
        vm.stopPrank();

        assertLe(usdcBack, 1_000_000);
        assertGe(usdcBack, 1_000_000 - 1);
    }

    // ---------------------------------------------------------------------
    // Freshness
    // ---------------------------------------------------------------------

    function test_BuyRejectsStalePrice() public {
        _fundAndApprove(alice, type(uint256).max);
        vm.warp(block.timestamp + MAX_SOURCE_AGE + 1);

        uint64 sourceUpdatedAt = exchange.observation(address(stock18)).sourceUpdatedAt;

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.StalePrice.selector, sourceUpdatedAt, MAX_SOURCE_AGE
            )
        );
        exchange.buy(address(stock18), 1e6, 0, type(uint256).max);
    }

    function test_SellRejectsStalePrice() public {
        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        exchange.buy(address(stock18), 230e6, 0, type(uint256).max);
        stock18.approve(address(exchange), type(uint256).max);
        vm.stopPrank();

        vm.warp(block.timestamp + MAX_SOURCE_AGE + 1);
        uint64 sourceUpdatedAt = exchange.observation(address(stock18)).sourceUpdatedAt;

        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.StalePrice.selector, sourceUpdatedAt, MAX_SOURCE_AGE
            )
        );
        vm.prank(alice);
        exchange.sell(address(stock18), 1e17, 0, type(uint256).max);
    }

    function test_PerAssetFreshnessBoundsAreIndependent() public {
        TestStock six = _newListedStock(6);
        vm.prank(updater);
        exchange.setPrice(
            address(six), PRICE_230, 1, uint64(block.timestamp) - 1, 84532, address(0), true
        );

        vm.prank(admin);
        exchange.setMaxSourceAge(address(six), 60);

        vm.warp(block.timestamp + 61);

        _fundAndApprove(alice, type(uint256).max);
        vm.startPrank(alice);
        vm.expectRevert();
        exchange.buy(address(six), 1e6, 0, type(uint256).max);

        // The 18-decimal asset keeps its 3,600s bound.
        assertGt(exchange.buy(address(stock18), 1e6, 0, type(uint256).max), 0);
        vm.stopPrank();
    }

    function test_TradingRejectsAssetWithoutPrice() public {
        TestStock unlistedPrice = _newListedStock(18);
        _fundAndApprove(alice, type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.PriceNotSet.selector, address(unlistedPrice))
        );
        exchange.buy(address(unlistedPrice), 1e6, 0, type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Pause and access control
    // ---------------------------------------------------------------------

    function test_PauseBlocksTrading() public {
        _fundAndApprove(alice, type(uint256).max);

        vm.prank(pauser);
        exchange.pause();

        vm.startPrank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        exchange.buy(address(stock18), 1e6, 0, type(uint256).max);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        exchange.sell(address(stock18), 1e18, 0, type(uint256).max);
        vm.stopPrank();

        vm.prank(pauser);
        exchange.unpause();

        vm.prank(alice);
        assertEq(exchange.buy(address(stock18), 230e6, 0, type(uint256).max), 1e18);
    }

    function test_RevokedUpdaterCannotPublish() public {
        bytes32 updaterRole = exchange.PRICE_UPDATER_ROLE();
        vm.prank(admin);
        exchange.revokeRole(updaterRole, updater);

        vm.expectRevert();
        vm.prank(updater);
        exchange.setPrice(address(stock18), 230e6, 2, block.timestamp - 1, 84532, address(0), true);
    }

    function test_RevokedPauserCannotPause() public {
        bytes32 pauserRole = exchange.PAUSER_ROLE();
        vm.prank(admin);
        exchange.revokeRole(pauserRole, pauser);

        vm.startPrank(pauser);
        vm.expectRevert();
        exchange.pause();
        vm.stopPrank();
    }

    function test_OnlyPauserCanPause() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                exchange.PAUSER_ROLE()
            )
        );
        vm.prank(alice);
        exchange.pause();
    }

    // ---------------------------------------------------------------------
    // Reentrancy
    // ---------------------------------------------------------------------

    function test_SellIsReentrancyGuarded() public {
        ReentrantStock reentrant = new ReentrantStock();
        reentrant.setExchange(address(exchange));

        vm.startPrank(admin);
        exchange.listAsset(address(reentrant), MAX_SOURCE_AGE, 1, 1e30);
        vm.stopPrank();

        vm.prank(updater);
        exchange.setPrice(
            address(reentrant), 230e6, 1, uint64(block.timestamp) - 1, 84532, address(0), true
        );

        reentrant.mintForTest(alice, 1e18);
        _fundAndApprove(alice, type(uint256).max);

        vm.prank(alice);
        reentrant.approve(address(exchange), type(uint256).max);

        reentrant.setAttack(true);

        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        exchange.sell(address(reentrant), 1e18, 0, type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function test_QuotesMatchExpectedMath() public view {
        assertEq(exchange.quoteBuy(address(stock18), 1e6), 4_347_826_086_956_521);
        assertEq(exchange.quoteBuy(address(stock18), 230e6), 1e18);
        assertEq(exchange.quoteSell(address(stock18), 1e18), PRICE_230);
        assertEq(exchange.quoteSell(address(stock18), 5e17), 115e6);
    }

    function test_QuotesRevertForUnlistedOrUnpricedAssets() public {
        TestStock unlisted = new TestStock("Unlisted", "tUNL", 18, admin);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.AssetNotListed.selector, address(unlisted))
        );
        exchange.quoteBuy(address(unlisted), 1e6);

        TestStock unpriced = _newListedStock(18);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.PriceNotSet.selector, address(unpriced))
        );
        exchange.quoteSell(address(unpriced), 1e18);
    }

    // ---------------------------------------------------------------------
    // Plausibility bounds, deviation, and recovery
    // ---------------------------------------------------------------------

    function test_SetPriceRejectsPriceOutsideBand() public {
        TestStock bounded = new TestStock("Bounded", "tBND", 18, admin);
        vm.prank(admin);
        exchange.listAsset(address(bounded), MAX_SOURCE_AGE, 100e6, 300e6);

        vm.prank(updater);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.PriceOutsideBounds.selector, 400e6, 100e6, 300e6)
        );
        exchange.setPrice(address(bounded), 400e6, 1, block.timestamp - 1, 84532, address(0), true);

        vm.prank(updater);
        exchange.setPrice(address(bounded), 300e6, 2, block.timestamp - 1, 84532, address(0), true);
        assertEq(exchange.observation(address(bounded)).priceUsdcPerWholeToken, 300e6);
    }

    function test_ListAssetRejectsInvalidPriceBounds() public {
        TestStock token = new TestStock("Bounds", "tBNDS", 18, admin);
        vm.startPrank(admin);
        vm.expectRevert(KyroxExchange.InvalidPriceBounds.selector);
        exchange.listAsset(address(token), MAX_SOURCE_AGE, 0, 1e30);
        vm.expectRevert(KyroxExchange.InvalidPriceBounds.selector);
        exchange.listAsset(address(token), MAX_SOURCE_AGE, 300e6, 100e6);
        vm.stopPrank();
    }

    function test_DeviationGuardBlocksImplausibleJumps() public {
        TestStock guarded = new TestStock("Guarded", "tGRD", 18, admin);
        vm.prank(admin);
        exchange.listAsset(address(guarded), MAX_SOURCE_AGE, 1, 1e30);
        vm.prank(admin);
        exchange.setPriceBounds(address(guarded), 1, 1e30, 1_000); // 10%

        vm.startPrank(updater);
        exchange.setPrice(address(guarded), 230e6, 1, block.timestamp - 1, 84532, address(0), true);

        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.PriceDeviationExceeded.selector, 300e6, 230e6, 1_000
            )
        );
        exchange.setPrice(address(guarded), 300e6, 2, block.timestamp - 1, 84532, address(0), true);

        exchange.setPrice(address(guarded), 250e6, 2, block.timestamp - 1, 84532, address(0), true);
        assertEq(exchange.observation(address(guarded)).priceUsdcPerWholeToken, 250e6);
        vm.stopPrank();
    }

    function test_DeviationGuardUsesFullWidthRatioAtLargePrices() public {
        TestStock guarded = new TestStock("Wide Guarded", "tWIDE", 18, admin);
        vm.startPrank(admin);
        exchange.listAsset(address(guarded), MAX_SOURCE_AGE, 1, type(uint256).max);
        exchange.setPriceBounds(address(guarded), 1, type(uint256).max, 5_000);
        vm.stopPrank();

        uint256 previousPrice = type(uint256).max / 20_000;
        uint256 rejectedPrice = previousPrice * 2;
        vm.startPrank(updater);
        exchange.setPrice(
            address(guarded), previousPrice, 1, block.timestamp - 1, 84532, address(0), true
        );

        // The former difference * 10_000 comparison overflowed here.
        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.PriceDeviationExceeded.selector, rejectedPrice, previousPrice, 5_000
            )
        );
        exchange.setPrice(
            address(guarded), rejectedPrice, 2, block.timestamp - 1, 84532, address(0), true
        );

        uint256 boundaryPrice = previousPrice + (previousPrice * 5_000) / 10_000;
        exchange.setPrice(
            address(guarded), boundaryPrice, 2, block.timestamp - 1, 84532, address(0), true
        );
        assertEq(exchange.observation(address(guarded)).priceUsdcPerWholeToken, boundaryPrice);
        vm.stopPrank();
    }

    function test_SetPriceRejectsAlreadyStaleObservation() public {
        vm.prank(updater);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyroxExchange.StalePublication.selector,
                block.timestamp - MAX_SOURCE_AGE - 1,
                MAX_SOURCE_AGE
            )
        );
        exchange.setPrice(
            address(stock18),
            230e6,
            2,
            block.timestamp - MAX_SOURCE_AGE - 1,
            84532,
            address(0),
            true
        );
    }

    function test_ResetObservationIsPausedOnlyAndAllowsRecovery() public {
        vm.expectRevert();
        vm.prank(admin);
        exchange.resetObservation(address(stock18));

        vm.prank(pauser);
        exchange.pause();

        vm.prank(admin);
        exchange.resetObservation(address(stock18));
        assertEq(exchange.observation(address(stock18)).sourceRoundId, 0);

        vm.prank(updater);
        exchange.setPrice(address(stock18), 230e6, 1, block.timestamp - 1, 84532, address(0), true);

        vm.prank(pauser);
        exchange.unpause();

        _fundAndApprove(alice, type(uint256).max);
        vm.prank(alice);
        assertEq(exchange.buy(address(stock18), 230e6, 0, type(uint256).max), 1e18);
    }

    function test_DeadlineIsEnforced() public {
        _fundAndApprove(alice, type(uint256).max);
        uint256 deadline = block.timestamp - 1;

        vm.expectRevert(abi.encodeWithSelector(KyroxExchange.DeadlineExpired.selector, deadline));
        vm.prank(alice);
        exchange.buy(address(stock18), 1e6, 0, deadline);

        vm.expectRevert(abi.encodeWithSelector(KyroxExchange.DeadlineExpired.selector, deadline));
        vm.prank(alice);
        exchange.sell(address(stock18), 1e18, 0, deadline);
    }

    function test_SellRejectsShortDeliveryFromFeeOnTransferToken() public {
        FeeOnTransferStock feeToken = new FeeOnTransferStock(18);
        vm.prank(admin);
        exchange.listAsset(address(feeToken), MAX_SOURCE_AGE, 1, 1e30);
        vm.prank(updater);
        exchange.setPrice(address(feeToken), 230e6, 1, block.timestamp - 1, 84532, address(0), true);

        feeToken.mintForTest(alice, 1e18);
        vm.prank(alice);
        feeToken.approve(address(exchange), type(uint256).max);

        uint256 received = 1e18 - (1e18 / 100);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.UnexpectedTransferAmount.selector, 1e18, received)
        );
        vm.prank(alice);
        exchange.sell(address(feeToken), 1e18, 0, type(uint256).max);
    }

    function test_FreshnessBoundaryOfExactlyMaxAgeIsAccepted() public {
        vm.warp(block.timestamp + MAX_SOURCE_AGE);
        vm.prank(updater);
        exchange.setPrice(
            address(stock18), 230e6, 2, block.timestamp - MAX_SOURCE_AGE, 84532, address(0), true
        );

        _fundAndApprove(alice, type(uint256).max);
        vm.prank(alice);
        assertGt(exchange.buy(address(stock18), 1e6, 0, type(uint256).max), 0);
    }

    function test_BuyIsReentrancyGuarded() public {
        ReentrantStock reentrant = new ReentrantStock();
        reentrant.setExchange(address(exchange));

        vm.prank(admin);
        exchange.listAsset(address(reentrant), MAX_SOURCE_AGE, 1, 1e30);
        vm.prank(updater);
        exchange.setPrice(
            address(reentrant), 230e6, 1, uint64(block.timestamp) - 1, 84532, address(0), true
        );

        _fundAndApprove(alice, type(uint256).max);
        reentrant.setAttackOnMint(true);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(alice);
        exchange.buy(address(reentrant), 1e6, 0, type(uint256).max);
    }

    function test_ContractSupportsTwelveDecimalToken() public {
        TestStock twelve = new TestStock("Twelve", "tTWL", 12, admin);
        vm.startPrank(admin);
        twelve.grantRole(twelve.EXCHANGE_ROLE(), address(exchange));
        exchange.listAsset(address(twelve), MAX_SOURCE_AGE, 1, 1e30);
        vm.stopPrank();

        vm.prank(updater);
        exchange.setPrice(
            address(twelve), 230e6, 1, uint64(block.timestamp) - 1, 84532, address(0), true
        );

        assertEq(exchange.quoteBuy(address(twelve), 1e6), 4_347_826_086);
        assertEq(exchange.assetSettings(address(twelve)).stockDecimals, 12);
    }

    function test_ListingRejectsAddressWithoutDecimals() public {
        vm.expectRevert();
        vm.prank(admin);
        exchange.listAsset(address(0xBEEF), MAX_SOURCE_AGE, 1, 1e30);
    }

    function test_ListingRejectsZeroDecimalToken() public {
        FeeOnTransferStock zeroDecimals = new FeeOnTransferStock(0);
        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.InvalidStockDecimals.selector, uint8(0))
        );
        vm.prank(admin);
        exchange.listAsset(address(zeroDecimals), MAX_SOURCE_AGE, 1, 1e30);
    }
}
