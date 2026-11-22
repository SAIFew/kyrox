// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { stdJson } from "forge-std/StdJson.sol";

import { BaseTest } from "./BaseTest.sol";
import { TestStock } from "../src/TestStock.sol";

/// @notice Proves the TypeScript engine and the Solidity exchange agree on the
/// same golden vectors, computed once and stored in `packages/core/fixtures`.
contract GoldenVectors_Test is BaseTest {
    using stdJson for string;

    string private json;

    TestStock private stock6;
    TestStock private stock8;
    mapping(uint256 decimals => uint256 roundId) private rounds;

    function setUp() public override {
        super.setUp();
        json = vm.readFile("../core/fixtures/golden-quotes.json");

        stock6 = _newListedStock(6);
        stock8 = _newListedStock(8);
        rounds[18] = 1; // BaseTest published round 1 for the 18-decimal asset.
    }

    function test_GoldenQuoteParity() public {
        string[] memory keys = vm.parseJsonKeys(json, ".cases");
        assertEq(keys.length, 14, "golden vector count");

        for (uint256 i = 0; i < keys.length; i++) {
            string memory base = string.concat(".cases.", keys[i]);
            string memory side = json.readString(string.concat(base, ".side"));
            uint256 decimals = json.readUint(string.concat(base, ".stockDecimals"));
            uint256 price =
                vm.parseUint(json.readString(string.concat(base, ".priceUsdcPerWholeToken")));
            uint256 amountIn = vm.parseUint(json.readString(string.concat(base, ".amountIn")));
            uint256 expected =
                vm.parseUint(json.readString(string.concat(base, ".expectedAmountOut")));

            TestStock token = _tokenFor(decimals);
            rounds[decimals] += 1;
            vm.prank(updater);
            exchange.setPrice(
                address(token),
                price,
                rounds[decimals],
                uint64(block.timestamp) - 1,
                84532,
                address(0),
                true
            );

            if (keccak256(bytes(side)) == keccak256(bytes("buy"))) {
                assertEq(
                    exchange.quoteBuy(address(token), amountIn),
                    expected,
                    string.concat("buy parity: ", keys[i])
                );
            } else {
                assertEq(
                    exchange.quoteSell(address(token), amountIn),
                    expected,
                    string.concat("sell parity: ", keys[i])
                );
            }
        }
    }

    function test_GoldenMinimumOutputParity() public {
        string[] memory keys = vm.parseJsonKeys(json, ".minOutputCases");
        assertEq(keys.length, 4, "min output vector count");

        for (uint256 i = 0; i < keys.length; i++) {
            string memory base = string.concat(".minOutputCases.", keys[i]);
            uint256 quoted = vm.parseUint(json.readString(string.concat(base, ".quoted")));
            uint256 bps = json.readUint(string.concat(base, ".bps"));
            uint256 expected = vm.parseUint(json.readString(string.concat(base, ".expected")));

            assertEq(
                (quoted * (10_000 - bps)) / 10_000,
                expected,
                string.concat("min output parity: ", keys[i])
            );
        }
    }

    function test_ContractAcceptsGoldenMinimumOutput() public {
        uint256 quoted = usdcQuoted();
        uint256 bps = 50;
        uint256 minOut = (quoted * (10_000 - bps)) / 10_000;

        _fundAndApprove(alice, type(uint256).max);

        vm.prank(alice);
        uint256 received = exchange.buy(address(stock18), 1e6, minOut, type(uint256).max);

        assertEq(received, quoted);
        assertGe(received, minOut);
    }

    function usdcQuoted() private view returns (uint256) {
        return exchange.quoteBuy(address(stock18), 1e6);
    }

    function _tokenFor(uint256 decimals) private view returns (TestStock) {
        if (decimals == 6) return stock6;
        if (decimals == 8) return stock8;
        if (decimals == 18) return stock18;
        revert("unsupported golden-vector decimals");
    }
}
