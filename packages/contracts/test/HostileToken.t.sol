// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { BaseTest } from "./BaseTest.sol";
import { KyroxExchange } from "../src/KyroxExchange.sol";
import { FalseReturnStock, LyingTransferStock } from "./mocks/HostileTokens.sol";

/// @notice Hostile-token behaviour the exchange must reject.
contract HostileToken_Test is BaseTest {
    function _listAndPrice(address token) private {
        vm.prank(admin);
        exchange.listAsset(token, MAX_SOURCE_AGE, 1, 1e30);
        vm.prank(updater);
        exchange.setPrice(token, PRICE_230, 1, uint64(block.timestamp) - 1, 84532, address(0), true);
    }

    function test_SellRejectsFalseReturnToken() public {
        FalseReturnStock token = new FalseReturnStock();
        _listAndPrice(address(token));

        token.mintForTest(alice, 1e18);
        vm.prank(alice);
        token.approve(address(exchange), type(uint256).max);

        vm.expectRevert();
        vm.prank(alice);
        exchange.sell(address(token), 1e18, 0, type(uint256).max);
    }

    function test_SellRejectsTokenThatClaimsSuccessWithoutDelivering() public {
        LyingTransferStock token = new LyingTransferStock();
        _listAndPrice(address(token));

        token.mintForTest(alice, 1e18);
        vm.prank(alice);
        token.approve(address(exchange), type(uint256).max);

        vm.expectRevert(
            abi.encodeWithSelector(KyroxExchange.UnexpectedTransferAmount.selector, 1e18, 0)
        );
        vm.prank(alice);
        exchange.sell(address(token), 1e18, 0, type(uint256).max);
    }
}
