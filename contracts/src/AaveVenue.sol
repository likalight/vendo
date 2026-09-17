// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVenue} from "./IVenue.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @notice Aave V3 lending pool, the subset this adapter uses.
interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// @title AaveVenue
/// @notice Supplies a VendoVault's idle stablecoin to Aave V3 and gives it back on demand.
///
/// Aave went live on X Layer on 30 March 2026 and accepts USDT0 supply, which makes it the first
/// real venue a business treasury can use without leaving the chain it already earns on.
///
/// Accounting is share based, not balance based. Aave's aTokens are held by this adapter, not by
/// the depositor, so a single balance would not say whose money earned what. Shares apportion both
/// principal and accrued interest across depositors, which also lets several vaults share one
/// deployed adapter rather than each needing its own.
///
/// The adapter holds no privileges over a vault. It can only move what a vault has approved and
/// pushed to it, and `withdraw` always returns funds to the caller, never to a third party.
///
/// UNAUDITED. This is hackathon code. The Aave pool and aToken addresses for X Layer must be
/// confirmed against Aave's own deployment registry before this is pointed at real money.
contract AaveVenue is IVenue {
    IERC20Min public immutable asset;  // USDT0 on X Layer
    IERC20Min public immutable aToken; // the Aave receipt token for that asset
    IAavePool public immutable pool;

    mapping(address => uint256) public shares;
    uint256 public totalShares;

    /// @dev A first deposit small enough to round to zero shares would let a later depositor be
    ///      diluted by donating directly to the adapter. Requiring a meaningful first deposit
    ///      removes the cheap version of that attack.
    uint256 public constant MIN_FIRST_DEPOSIT = 1e6; // 1 unit of a 6 decimal stablecoin

    uint256 private locked = 1;

    event Deposited(address indexed vault, uint256 assets, uint256 sharesMinted);
    event Withdrawn(address indexed vault, uint256 assets, uint256 sharesBurned);

    error TransferFailed();
    error ApproveFailed();
    error NothingSupplied();
    error FirstDepositTooSmall();
    error InsufficientShares();
    error ShortWithdrawal();
    error Reentrancy();

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address asset_, address aToken_, address pool_) {
        asset = IERC20Min(asset_);
        aToken = IERC20Min(aToken_);
        pool = IAavePool(pool_);
    }

    /// @notice Everything this adapter holds in Aave, principal plus accrued interest.
    /// @dev Aave V3 aTokens rebase, so the balance itself grows as interest accrues.
    function totalAssets() public view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /// @inheritdoc IVenue
    /// @dev The vault approves this adapter and then calls deposit, so funds are pulled rather
    ///      than pushed. Shares are minted against the aTokens actually received, not against the
    ///      amount requested, because Aave may credit a different figure.
    function deposit(uint256 amount) external nonReentrant {
        uint256 before = totalAssets();

        if (!asset.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (!asset.approve(address(pool), amount)) revert ApproveFailed();
        pool.supply(address(asset), amount, address(this), 0);
        asset.approve(address(pool), 0);

        uint256 added = totalAssets() - before;
        if (added == 0) revert NothingSupplied();

        uint256 minted;
        if (totalShares == 0 || before == 0) {
            // First money in, or the pool was fully drained: shares start one to one.
            if (added < MIN_FIRST_DEPOSIT) revert FirstDepositTooSmall();
            minted = added;
        } else {
            minted = (added * totalShares) / before;
            if (minted == 0) revert NothingSupplied();
        }

        shares[msg.sender] += minted;
        totalShares += minted;
        emit Deposited(msg.sender, added, minted);
    }

    /// @inheritdoc IVenue
    /// @dev Burns the caller's shares and returns the asset to the caller. Shares are rounded up
    ///      so a withdrawal can never leave the adapter short at another depositor's expense.
    function withdraw(uint256 amount) external nonReentrant {
        uint256 assets = totalAssets();
        if (assets == 0 || totalShares == 0) revert InsufficientShares();

        uint256 burned = (amount * totalShares + assets - 1) / assets; // round up
        if (burned > shares[msg.sender]) revert InsufficientShares();

        shares[msg.sender] -= burned;
        totalShares -= burned;

        uint256 got = pool.withdraw(address(asset), amount, msg.sender);
        if (got < amount) revert ShortWithdrawal();

        emit Withdrawn(msg.sender, amount, burned);
    }

    /// @inheritdoc IVenue
    /// @dev What this depositor's shares are currently worth, so a vault's invested() reports
    ///      principal plus its portion of the interest.
    function balanceOf(address account) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares[account] * totalAssets()) / totalShares;
    }
}
