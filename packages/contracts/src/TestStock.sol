// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestStock
/// @notice Testnet stock token with exchange-only supply changes.
/// @dev Decimals are fixed at construction so the engine can exercise 6, 8 and
/// 18 decimal assets without changing code. Only the allowlisted exchange can
/// mint or burn; there is no unrestricted mint function.
contract TestStock is ERC20, AccessControl {
    /// @notice Role allowed to mint and burn on behalf of the exchange.
    bytes32 public constant EXCHANGE_ROLE = keccak256("KYROX_EXCHANGE_ROLE");

    uint8 private immutable _decimals;

    event ExchangeMint(address indexed to, uint256 amount);
    event ExchangeBurn(address indexed from, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error BurnFromNotSelf(address from);
    error InvalidDecimals(uint8 decimals);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address admin)
        ERC20(name_, symbol_)
    {
        if (admin == address(0)) revert ZeroAddress();
        if (decimals_ == 0 || decimals_ > 77) revert InvalidDecimals(decimals_);
        _decimals = decimals_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Exchange-only mint. Used when a user buys stock with tUSDC.
    function mintByExchange(address to, uint256 amount) external onlyRole(EXCHANGE_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
        emit ExchangeMint(to, amount);
    }

    /// @notice Exchange-only burn. Used when a user sells stock for tUSDC.
    function burnByExchange(address from, uint256 amount) external onlyRole(EXCHANGE_ROLE) {
        if (from != msg.sender) revert BurnFromNotSelf(from);
        if (amount == 0) revert ZeroAmount();
        _burn(from, amount);
        emit ExchangeBurn(from, amount);
    }
}
