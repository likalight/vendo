// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AaveVenue} from "../src/AaveVenue.sol";
import {VendoVault} from "../src/VendoVault.sol";
import {MockStable} from "./Mocks.sol";

/// @notice Enough of Aave V3 to exercise the adapter: supply mints a rebasing receipt token,
///         withdraw burns it, and interest is simulated by minting more receipt tokens.
contract MockAToken {
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    address public pool;

    constructor(address pool_) { pool = pool_; }

    function mint(address to, uint256 amount) external {
        require(msg.sender == pool, "only pool");
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == pool, "only pool");
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }

    /// @dev Interest accrual. Aave rebases the receipt balance upward as interest is earned.
    function accrue(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
}

contract MockAavePool {
    MockStable public immutable asset;
    MockAToken public aToken;

    constructor(MockStable a) {
        asset = a;
        aToken = new MockAToken(address(this));
    }

    function supply(address, uint256 amount, address onBehalfOf, uint16) external {
        asset.transferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, amount);
    }

    function withdraw(address, uint256 amount, address to) external returns (uint256) {
        aToken.burn(msg.sender, amount);
        asset.transfer(to, amount);
        return amount;
    }
}

contract AaveVenueTest is Test {
    MockStable token;
    MockAavePool pool;
    AaveVenue venue;
    VendoVault vault;

    address owner = address(0xB0B);
    address operator = address(0x0FF1CE);
    address payee = address(0xFEE);

    function setUp() public {
        token = new MockStable();
        pool = new MockAavePool(token);
        venue = new AaveVenue(address(token), address(pool.aToken()), address(pool));
        vault = new VendoVault(address(token), owner, operator, 50e6, 500e6);

        vm.prank(owner);
        vault.setVenue(address(venue), true);

        token.mint(address(vault), 1000e6);
    }

    function test_SweepSuppliesToAaveAndCountsAsInvested() public {
        vm.prank(operator);
        vault.sweep(address(venue), 400e6);

        assertEq(vault.idle(), 600e6, "idle drops by the swept amount");
        assertEq(vault.invested(), 400e6, "invested reflects the Aave position");
        assertEq(vault.totalAssets(), 1000e6, "nothing is lost in the move");
        assertEq(pool.aToken().balanceOf(address(venue)), 400e6, "the adapter holds the receipt token");
    }

    function test_InterestAccruesToTheVault() public {
        vm.prank(operator);
        vault.sweep(address(venue), 400e6);

        // Aave pays 10 units of interest into the adapter's position.
        pool.aToken().accrue(address(venue), 10e6);
        token.mint(address(pool), 10e6); // the pool holds the underlying for that interest

        assertEq(vault.invested(), 410e6, "the vault sees principal plus interest");
        assertEq(vault.totalAssets(), 1010e6, "the business is richer by the interest");
    }

    function test_RecallReturnsPrincipalAndInterest() public {
        vm.prank(operator);
        vault.sweep(address(venue), 400e6);
        pool.aToken().accrue(address(venue), 10e6);
        token.mint(address(pool), 10e6);

        vm.prank(operator);
        vault.recall(address(venue), 410e6);

        assertEq(vault.idle(), 1010e6, "everything came back, interest included");
        assertEq(vault.invested(), 0, "the position is closed");
        assertEq(venue.totalShares(), 0, "shares are fully burned");
    }

    function test_InterestIsSplitByShareNotByArrivalOrder() public {
        // Two vaults sharing one adapter is the case share accounting exists for.
        VendoVault second = new VendoVault(address(token), owner, operator, 0, 500e6);
        vm.prank(owner);
        second.setVenue(address(venue), true);
        token.mint(address(second), 1000e6);

        vm.prank(operator);
        vault.sweep(address(venue), 100e6); // first in

        pool.aToken().accrue(address(venue), 100e6); // doubles, all of it earned by the first vault
        token.mint(address(pool), 100e6);

        vm.prank(operator);
        second.sweep(address(venue), 200e6); // arrives after the interest

        assertEq(venue.balanceOf(address(vault)), 200e6, "first vault keeps the interest it earned");
        assertEq(venue.balanceOf(address(second)), 200e6, "late arrival gets principal only");
    }

    function test_PayBillPullsBackFromAaveWhenCashIsShort() public {
        vm.prank(owner);
        vault.setPayee(payee, 300e6);

        vm.prank(operator);
        vault.sweep(address(venue), 900e6); // leaves only the 100 buffer as cash

        vm.prank(operator);
        vault.payBill(payee, 250e6, bytes32("hosting"));

        assertEq(token.balanceOf(payee), 250e6, "the bill was paid");
        assertLt(vault.invested(), 900e6, "the shortfall was recalled from Aave");
    }

    function test_FirstDepositMustBeMeaningful() public {
        // A dust first deposit is how share inflation attacks start.
        VendoVault tiny = new VendoVault(address(token), owner, operator, 0, 500e6);
        vm.prank(owner);
        tiny.setVenue(address(venue), true);
        token.mint(address(tiny), 1e6);

        vm.prank(operator);
        vm.expectRevert(AaveVenue.FirstDepositTooSmall.selector);
        tiny.sweep(address(venue), 1); // 0.000001 units
    }

    function test_CannotWithdrawMoreThanYourShare() public {
        VendoVault second = new VendoVault(address(token), owner, operator, 0, 500e6);
        vm.prank(owner);
        second.setVenue(address(venue), true);
        token.mint(address(second), 1000e6);

        vm.prank(operator);
        vault.sweep(address(venue), 100e6);
        vm.prank(operator);
        second.sweep(address(venue), 100e6);

        // One vault must not be able to take the other's deposit.
        vm.prank(operator);
        vm.expectRevert(AaveVenue.InsufficientShares.selector);
        vault.recall(address(venue), 150e6);
    }
}
