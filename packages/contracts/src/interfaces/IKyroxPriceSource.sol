// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// @title IKyroxPriceSource
/// @notice Feed-independent observation interface consumed by the KYROX exchange.
/// @dev Implementations publish an already-validated price observation. The
/// interface makes no assumption about Chainlink, feed schedules, or 24/5
/// behaviour: freshness is configured per asset by the implementation.
interface IKyroxPriceSource {
    /// @notice One published observation, with full provenance.
    /// @param priceUsdcPerWholeToken Price of ONE WHOLE stock token in 6-decimal USDC units.
    /// @param sourceRoundId Round identifier reported by the original source.
    /// @param sourceUpdatedAt ORIGINAL source timestamp. Never rewritten at publication.
    /// @param publishedAt Base Sepolia block timestamp when this observation was stored.
    /// @param sourceChainId Chain id the observation was read from (e.g. 8453 mainnet, 84532 Sepolia).
    /// @param feedAddress Source feed address, or zero for a labelled simulation.
    /// @param simulated True when the value is a simulation and must not be presented as a feed price.
    struct Observation {
        uint256 priceUsdcPerWholeToken;
        uint256 sourceRoundId;
        uint64 sourceUpdatedAt;
        uint64 publishedAt;
        uint64 sourceChainId;
        address feedAddress;
        bool simulated;
    }

    /// @notice Latest published observation for a stock token.
    function observation(address stockToken) external view returns (Observation memory);

    /// @notice Maximum accepted age of `sourceUpdatedAt` for a stock token, in seconds.
    function maxSourceAgeSeconds(address stockToken) external view returns (uint32);
}
