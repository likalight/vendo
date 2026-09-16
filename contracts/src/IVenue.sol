// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Adapter for an approved yield venue (e.g. a USDG position on X Layer).
/// The vault only ever calls these three functions; each real venue gets its own audited adapter.
interface IVenue {
    /// @dev Pulls `amount` of the vault's stablecoin (already approved) into the venue.
    function deposit(uint256 amount) external;
    /// @dev Returns `amount` of stablecoin to msg.sender (the vault).
    function withdraw(uint256 amount) external;
    /// @dev Stablecoin value currently held for `account`, including earned yield.
    function balanceOf(address account) external view returns (uint256);
}
