// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IKyroxPriceSource } from "./interfaces/IKyroxPriceSource.sol";
import { ITestUSDC } from "./interfaces/ITestUSDC.sol";
import { ITestStock } from "./interfaces/ITestStock.sol";

/// @title KyroxExchange
/// @notice Fixed-reference-price mint/burn venue for the KYROX Base Sepolia MVP.
/// @dev No AMM, no routing, no fee. Prices are published with full provenance:
/// the original source timestamp and round id are stored unchanged, while
/// `publishedAt` records the Sepolia publication time. Freshness is enforced per
/// asset, so a 24/5 feed and a 24/7 feed can coexist without a shared assumption.
/// Each asset also has a mandatory price band and an optional deviation guard,
/// so a unit error or a compromised publisher cannot turn the venue into an
/// unlimited mint.
contract KyroxExchange is AccessControl, Pausable, ReentrancyGuard, IKyroxPriceSource {
    using SafeERC20 for IERC20;

    /// @notice Role allowed to publish price observations.
    bytes32 public constant PRICE_UPDATER_ROLE = keccak256("KYROX_PRICE_UPDATER_ROLE");
    /// @notice Role allowed to pause and unpause trading.
    bytes32 public constant PAUSER_ROLE = keccak256("KYROX_PAUSER_ROLE");

    /// @notice tUSDC is always 6-decimal. Verified at construction.
    uint8 public constant USDC_DECIMALS = 6;
    /// @notice Upper bound for a per-asset freshness window (7 days).
    uint32 public constant MAX_SOURCE_AGE_SECONDS = 7 days;
    /// @notice Maximum accepted price deviation between consecutive rounds (100%).
    uint16 public constant MAX_DEVIATION_BPS = 10_000;

    ITestUSDC public immutable usdc;

    struct AssetSettings {
        bool listed;
        uint8 stockDecimals;
        uint32 maxSourceAgeSeconds;
        uint16 maxPriceDeviationBps;
        uint256 minPriceUsdcPerWholeToken;
        uint256 maxPriceUsdcPerWholeToken;
    }

    mapping(address stockToken => AssetSettings settings) private _settings;
    mapping(address stockToken => Observation observation) private _observations;

    event AssetListed(
        address indexed stockToken,
        uint8 stockDecimals,
        uint32 maxSourceAgeSeconds,
        uint256 minPriceUsdcPerWholeToken,
        uint256 maxPriceUsdcPerWholeToken
    );
    event AssetFreshnessUpdated(address indexed stockToken, uint32 maxSourceAgeSeconds);
    event AssetPriceBoundsUpdated(
        address indexed stockToken,
        uint256 minPriceUsdcPerWholeToken,
        uint256 maxPriceUsdcPerWholeToken,
        uint16 maxPriceDeviationBps
    );
    event ObservationReset(address indexed stockToken, address indexed admin);
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

    error ZeroAddress();
    error ZeroAmount();
    error InvalidUsdcDecimals(uint8 actual);
    error AssetAlreadyListed(address stockToken);
    error AssetNotListed(address stockToken);
    error SettlementTokenCannotBeStock(address stockToken);
    error InvalidStockDecimals(uint8 decimals);
    error InvalidMaxSourceAge();
    error InvalidPrice();
    error InvalidPriceBounds();
    error PriceNotSet(address stockToken);
    error PriceOutsideBounds(uint256 price, uint256 minPrice, uint256 maxPrice);
    error PriceDeviationExceeded(uint256 price, uint256 previousPrice, uint16 maxDeviationBps);
    error InvalidSourceTimestamp();
    error FutureSourceTimestamp(uint256 sourceUpdatedAt, uint256 currentTime);
    error StalePublication(uint256 sourceUpdatedAt, uint32 maxSourceAgeSeconds);
    error AssetFrozen(address stockToken);
    error StalePrice(uint256 sourceUpdatedAt, uint32 maxSourceAgeSeconds);
    error RoundNotIncreasing(uint256 provided, uint256 previous);
    error SourceTimestampWentBackwards(uint256 provided, uint256 previous);
    error InvalidSourceProvenance();
    error UnexpectedTransferAmount(uint256 expected, uint256 received);
    error UnexpectedMintAmount(uint256 expected, uint256 received);
    error ZeroOutput();
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);
    error DeadlineExpired(uint256 deadline);

    constructor(address usdc_, address admin) {
        if (usdc_ == address(0) || admin == address(0)) revert ZeroAddress();
        uint8 actualDecimals = IERC20Metadata(usdc_).decimals();
        if (actualDecimals != USDC_DECIMALS) revert InvalidUsdcDecimals(actualDecimals);
        usdc = ITestUSDC(usdc_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /// @notice Allowlist a stock token, set its freshness bound and price band.
    /// @dev Decimals are read from the deployed token, never assumed.
    function listAsset(
        address stockToken,
        uint32 maxAgeSeconds,
        uint256 minPriceUsdcPerWholeToken,
        uint256 maxPriceUsdcPerWholeToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (stockToken == address(0)) revert ZeroAddress();
        if (stockToken == address(usdc)) revert SettlementTokenCannotBeStock(stockToken);
        if (_settings[stockToken].listed) revert AssetAlreadyListed(stockToken);
        if (maxAgeSeconds == 0 || maxAgeSeconds > MAX_SOURCE_AGE_SECONDS) {
            revert InvalidMaxSourceAge();
        }
        _validatePriceBounds(minPriceUsdcPerWholeToken, maxPriceUsdcPerWholeToken);

        uint8 tokenDecimals = IERC20Metadata(stockToken).decimals();
        if (tokenDecimals == 0 || tokenDecimals > 77) revert InvalidStockDecimals(tokenDecimals);

        _settings[stockToken] = AssetSettings({
            listed: true,
            stockDecimals: tokenDecimals,
            maxSourceAgeSeconds: maxAgeSeconds,
            maxPriceDeviationBps: 0,
            minPriceUsdcPerWholeToken: minPriceUsdcPerWholeToken,
            maxPriceUsdcPerWholeToken: maxPriceUsdcPerWholeToken
        });

        emit AssetListed(
            stockToken,
            tokenDecimals,
            maxAgeSeconds,
            minPriceUsdcPerWholeToken,
            maxPriceUsdcPerWholeToken
        );
    }

    /// @notice Update the freshness bound. Zero freezes the asset.
    function setMaxSourceAge(address stockToken, uint32 maxAgeSeconds)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        AssetSettings storage settings = _settings[stockToken];
        if (!settings.listed) revert AssetNotListed(stockToken);
        if (maxAgeSeconds > MAX_SOURCE_AGE_SECONDS) revert InvalidMaxSourceAge();
        settings.maxSourceAgeSeconds = maxAgeSeconds;
        emit AssetFreshnessUpdated(stockToken, maxAgeSeconds);
    }

    /// @notice Update the plausibility band and the optional round-to-round guard.
    /// @param maxDeviationBps 0 disables the deviation guard.
    function setPriceBounds(
        address stockToken,
        uint256 minPriceUsdcPerWholeToken,
        uint256 maxPriceUsdcPerWholeToken,
        uint16 maxDeviationBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AssetSettings storage settings = _settings[stockToken];
        if (!settings.listed) revert AssetNotListed(stockToken);
        _validatePriceBounds(minPriceUsdcPerWholeToken, maxPriceUsdcPerWholeToken);
        if (maxDeviationBps > MAX_DEVIATION_BPS) revert InvalidPriceBounds();

        settings.minPriceUsdcPerWholeToken = minPriceUsdcPerWholeToken;
        settings.maxPriceUsdcPerWholeToken = maxPriceUsdcPerWholeToken;
        settings.maxPriceDeviationBps = maxDeviationBps;

        emit AssetPriceBoundsUpdated(
            stockToken, minPriceUsdcPerWholeToken, maxPriceUsdcPerWholeToken, maxDeviationBps
        );
    }

    /// @notice Publish a validated observation to Sepolia.
    /// @dev `sourceUpdatedAt` is preserved exactly. It is NEVER replaced with
    /// `block.timestamp`; `publishedAt` is recorded separately. Already-stale
    /// observations are refused so a dead feed cannot overwrite a good price.
    function setPrice(
        address stockToken,
        uint256 priceUsdcPerWholeToken,
        uint256 sourceRoundId,
        uint256 sourceUpdatedAt,
        uint256 sourceChainId,
        address feedAddress,
        bool simulated
    ) external onlyRole(PRICE_UPDATER_ROLE) {
        AssetSettings memory settings = _settings[stockToken];
        if (!settings.listed) revert AssetNotListed(stockToken);
        if (settings.maxSourceAgeSeconds == 0) revert AssetFrozen(stockToken);
        if (priceUsdcPerWholeToken == 0) revert InvalidPrice();
        if (
            priceUsdcPerWholeToken < settings.minPriceUsdcPerWholeToken
                || priceUsdcPerWholeToken > settings.maxPriceUsdcPerWholeToken
        ) {
            revert PriceOutsideBounds(
                priceUsdcPerWholeToken,
                settings.minPriceUsdcPerWholeToken,
                settings.maxPriceUsdcPerWholeToken
            );
        }
        if (sourceUpdatedAt == 0) revert InvalidSourceTimestamp();
        if (sourceUpdatedAt > block.timestamp) {
            revert FutureSourceTimestamp(sourceUpdatedAt, block.timestamp);
        }
        if (block.timestamp > sourceUpdatedAt + settings.maxSourceAgeSeconds) {
            revert StalePublication(sourceUpdatedAt, settings.maxSourceAgeSeconds);
        }
        if (sourceChainId == 0 || sourceChainId > type(uint64).max) {
            revert InvalidSourceProvenance();
        }
        if (simulated && feedAddress != address(0)) revert InvalidSourceProvenance();
        if (!simulated && feedAddress == address(0)) revert InvalidSourceProvenance();

        Observation memory previous = _observations[stockToken];
        if (sourceRoundId <= previous.sourceRoundId) {
            revert RoundNotIncreasing(sourceRoundId, previous.sourceRoundId);
        }
        if (sourceUpdatedAt < previous.sourceUpdatedAt) {
            revert SourceTimestampWentBackwards(sourceUpdatedAt, previous.sourceUpdatedAt);
        }
        if (settings.maxPriceDeviationBps != 0 && previous.priceUsdcPerWholeToken != 0) {
            uint256 previousPrice = previous.priceUsdcPerWholeToken;
            uint256 difference = priceUsdcPerWholeToken > previousPrice
                ? priceUsdcPerWholeToken - previousPrice
                : previousPrice - priceUsdcPerWholeToken;
            // Compare the full-width ratio. Multiplying both sides by the BPS
            // denominator can overflow even when the configured band is valid.
            if (Math.mulDiv(difference, 10_000, previousPrice) > settings.maxPriceDeviationBps) {
                revert PriceDeviationExceeded(
                    priceUsdcPerWholeToken, previousPrice, settings.maxPriceDeviationBps
                );
            }
        }

        _observations[stockToken] = Observation({
            priceUsdcPerWholeToken: priceUsdcPerWholeToken,
            sourceRoundId: sourceRoundId,
            // Safe: checked above to be <= block.timestamp, which is far below 2^64.
            sourceUpdatedAt: uint64(sourceUpdatedAt),
            // Safe: block.timestamp is far below 2^64 for any realistic date.
            publishedAt: uint64(block.timestamp),
            // Safe: checked above to be <= type(uint64).max.
            sourceChainId: uint64(sourceChainId),
            feedAddress: feedAddress,
            simulated: simulated
        });

        emit PriceSet(
            stockToken,
            priceUsdcPerWholeToken,
            sourceRoundId,
            sourceUpdatedAt,
            sourceChainId,
            feedAddress,
            simulated,
            block.timestamp
        );
    }

    /// @notice Clear an unusable observation so a fresh round can be published.
    /// @dev Only while paused, so recovery is an explicit incident action.
    function resetObservation(address stockToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_settings[stockToken].listed) revert AssetNotListed(stockToken);
        require(paused(), "KyroxExchange: not paused");
        delete _observations[stockToken];
        emit ObservationReset(stockToken, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------

    /// @notice Buy stock with tUSDC at the published reference price.
    /// @param stockToken Allowlisted stock token.
    /// @param usdcIn tUSDC amount in 6-decimal units.
    /// @param minStockOut Minimum acceptable stock output in token base units.
    /// @param deadline Last block timestamp at which this trade may execute.
    function buy(address stockToken, uint256 usdcIn, uint256 minStockOut, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 stockOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (usdcIn == 0) revert ZeroAmount();
        AssetSettings memory settings = _requireListed(stockToken);
        Observation memory obs = _requireTradeObservation(stockToken, settings);

        stockOut = Math.mulDiv(
            usdcIn, 10 ** uint256(settings.stockDecimals), obs.priceUsdcPerWholeToken
        );
        if (stockOut == 0) revert ZeroOutput();
        if (stockOut < minStockOut) revert SlippageExceeded(stockOut, minStockOut);

        uint256 usdcBefore = usdc.balanceOf(address(this));
        IERC20(address(usdc)).safeTransferFrom(msg.sender, address(this), usdcIn);
        uint256 received = usdc.balanceOf(address(this)) - usdcBefore;
        if (received != usdcIn) revert UnexpectedTransferAmount(usdcIn, received);

        usdc.burnByExchange(address(this), usdcIn);
        uint256 stockBefore = IERC20(stockToken).balanceOf(msg.sender);
        ITestStock(stockToken).mintByExchange(msg.sender, stockOut);
        uint256 stockAfter = IERC20(stockToken).balanceOf(msg.sender);
        uint256 minted = stockAfter >= stockBefore ? stockAfter - stockBefore : 0;
        if (minted != stockOut) revert UnexpectedMintAmount(stockOut, minted);

        emit Trade(
            msg.sender,
            stockToken,
            true,
            usdcIn,
            stockOut,
            obs.priceUsdcPerWholeToken,
            obs.sourceRoundId,
            obs.sourceUpdatedAt
        );
    }

    /// @notice Sell stock for tUSDC at the published reference price.
    /// @param stockToken Allowlisted stock token.
    /// @param stockIn Stock amount in token base units.
    /// @param minUsdcOut Minimum acceptable tUSDC output in 6-decimal units.
    /// @param deadline Last block timestamp at which this trade may execute.
    function sell(address stockToken, uint256 stockIn, uint256 minUsdcOut, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 usdcOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (stockIn == 0) revert ZeroAmount();
        AssetSettings memory settings = _requireListed(stockToken);
        Observation memory obs = _requireTradeObservation(stockToken, settings);

        usdcOut = Math.mulDiv(
            stockIn, obs.priceUsdcPerWholeToken, 10 ** uint256(settings.stockDecimals)
        );
        if (usdcOut == 0) revert ZeroOutput();
        if (usdcOut < minUsdcOut) revert SlippageExceeded(usdcOut, minUsdcOut);

        IERC20 stock = IERC20(stockToken);
        uint256 stockBefore = stock.balanceOf(address(this));
        stock.safeTransferFrom(msg.sender, address(this), stockIn);
        uint256 received = stock.balanceOf(address(this)) - stockBefore;
        if (received != stockIn) revert UnexpectedTransferAmount(stockIn, received);

        ITestStock(stockToken).burnByExchange(address(this), stockIn);
        usdc.mintByExchange(msg.sender, usdcOut);

        emit Trade(
            msg.sender,
            stockToken,
            false,
            usdcOut,
            stockIn,
            obs.priceUsdcPerWholeToken,
            obs.sourceRoundId,
            obs.sourceUpdatedAt
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Indicative buy output. Does not check freshness; `buy` does.
    function quoteBuy(address stockToken, uint256 usdcIn) external view returns (uint256) {
        AssetSettings memory settings = _requireListed(stockToken);
        Observation memory obs = _requirePrice(stockToken);
        return
            Math.mulDiv(usdcIn, 10 ** uint256(settings.stockDecimals), obs.priceUsdcPerWholeToken);
    }

    /// @notice Indicative sell output. Does not check freshness; `sell` does.
    function quoteSell(address stockToken, uint256 stockIn) external view returns (uint256) {
        AssetSettings memory settings = _requireListed(stockToken);
        Observation memory obs = _requirePrice(stockToken);
        return
            Math.mulDiv(stockIn, obs.priceUsdcPerWholeToken, 10 ** uint256(settings.stockDecimals));
    }

    function assetSettings(address stockToken) external view returns (AssetSettings memory) {
        return _settings[stockToken];
    }

    /// @inheritdoc IKyroxPriceSource
    function observation(address stockToken) external view override returns (Observation memory) {
        return _observations[stockToken];
    }

    /// @inheritdoc IKyroxPriceSource
    function maxSourceAgeSeconds(address stockToken) external view override returns (uint32) {
        return _settings[stockToken].maxSourceAgeSeconds;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _validatePriceBounds(uint256 minPrice, uint256 maxPrice) private pure {
        if (minPrice == 0 || maxPrice < minPrice) revert InvalidPriceBounds();
    }

    function _requireListed(address stockToken) private view returns (AssetSettings memory) {
        AssetSettings memory settings = _settings[stockToken];
        if (!settings.listed) revert AssetNotListed(stockToken);
        return settings;
    }

    function _requirePrice(address stockToken) private view returns (Observation memory) {
        Observation memory obs = _observations[stockToken];
        if (obs.priceUsdcPerWholeToken == 0 || obs.sourceUpdatedAt == 0) {
            revert PriceNotSet(stockToken);
        }
        return obs;
    }

    function _requireFresh(address stockToken, AssetSettings memory settings)
        private
        view
        returns (Observation memory)
    {
        Observation memory obs = _requirePrice(stockToken);
        uint256 maxAge = settings.maxSourceAgeSeconds;
        if (maxAge == 0 || block.timestamp > uint256(obs.sourceUpdatedAt) + maxAge) {
            revert StalePrice(obs.sourceUpdatedAt, settings.maxSourceAgeSeconds);
        }
        return obs;
    }

    /// @dev An admin may tighten the plausibility band after publication. Trading
    /// must reject the stored observation immediately when it is outside the
    /// current bounds; freshness alone is not sufficient authorization to trade.
    function _requireTradeObservation(address stockToken, AssetSettings memory settings)
        private
        view
        returns (Observation memory)
    {
        Observation memory obs = _requireFresh(stockToken, settings);
        if (
            obs.priceUsdcPerWholeToken < settings.minPriceUsdcPerWholeToken
                || obs.priceUsdcPerWholeToken > settings.maxPriceUsdcPerWholeToken
        ) {
            revert PriceOutsideBounds(
                obs.priceUsdcPerWholeToken,
                settings.minPriceUsdcPerWholeToken,
                settings.maxPriceUsdcPerWholeToken
            );
        }
        return obs;
    }
}
