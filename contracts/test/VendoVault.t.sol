// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {VendoVault} from "../src/VendoVault.sol";
import {MockStable, MockVenue} from "./Mocks.sol";

contract VendoVaultTest is Test {
    MockStable usdt;
    MockVenue venue;
    VendoVault vault;
    address owner = address(0xB0B);
    address operator = address(0x0A7);
    address hosting = address(0x4057);
    address stranger = address(0xBAD);
    uint256 constant U = 1e6;

    function setUp() public {
        usdt = new MockStable();
        venue = new MockVenue(usdt);
        vault = new VendoVault(address(usdt), owner, operator, 100 * U, 500 * U);
        vm.startPrank(owner);
        vault.setVenue(address(venue), true);
        vault.setPayee(hosting, 200 * U);
        vm.stopPrank();
        usdt.mint(address(vault), 1_000 * U); // agent revenue arrives
    }

    function test_SweepKeepsBuffer() public {
        vm.prank(operator);
        vault.sweep(address(venue), 900 * U);
        assertEq(vault.idle(), 100 * U);
        assertEq(vault.invested(), 900 * U);

        vm.prank(operator);
        vm.expectRevert(VendoVault.BelowBuffer.selector);
        vault.sweep(address(venue), 1 * U);
    }

    function test_SweepOnlyToApprovedVenue() public {
        MockVenue rogue = new MockVenue(usdt);
        vm.prank(operator);
        vm.expectRevert(VendoVault.NotVenue.selector);
        vault.sweep(address(rogue), 10 * U);
    }

    function test_PayBillPullsFromYieldWhenCashShort() public {
        vm.prank(operator);
        vault.sweep(address(venue), 900 * U);
        venue.accrue(address(vault), 3 * U); // yield
        vm.prank(operator);
        vault.payBill(hosting, 150 * U, "hosting-sep");
        assertEq(usdt.balanceOf(hosting), 150 * U);
        assertEq(vault.idle(), 0);
        assertEq(vault.invested(), 853 * U); // 903 invested, 50 pulled to cover the shortfall
    }

    function test_OperatorCannotPayUnapproved() public {
        vm.prank(operator);
        vm.expectRevert(VendoVault.NotPayee.selector);
        vault.payBill(stranger, 1 * U, "x");
    }

    function test_CapAndDailyLimit() public {
        vm.prank(operator);
        vm.expectRevert(VendoVault.OverCap.selector);
        vault.payBill(hosting, 201 * U, "x");

        vm.prank(owner);
        vault.setPayee(stranger, 500 * U);
        vm.startPrank(operator);
        vault.payBill(hosting, 200 * U, "a");
        vault.payBill(stranger, 300 * U, "b");
        vm.expectRevert(VendoVault.OverDailyLimit.selector);
        vault.payBill(hosting, 1 * U, "c");
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        vm.prank(operator);
        vault.payBill(hosting, 1 * U, "next-day");
    }

    function test_OperatorCanOnlyTighten() public {
        vm.startPrank(operator);
        vault.tightenPayeeCap(hosting, 50 * U);
        vm.expectRevert(VendoVault.OnlyTighten.selector);
        vault.tightenPayeeCap(hosting, 60 * U);
        vm.expectRevert(VendoVault.OnlyTighten.selector);
        vault.tightenDailyLimit(600 * U);
        vm.expectRevert(VendoVault.NotOwner.selector);
        vault.setPayee(stranger, 1_000 * U);
        vm.expectRevert(VendoVault.NotOwner.selector);
        vault.withdraw(operator, 1 * U);
        vm.stopPrank();
    }

    function test_PauseBlocksAutomationButOwnerCanWithdraw() public {
        vm.prank(operator);
        vault.sweep(address(venue), 500 * U);
        vm.prank(operator);
        vault.pause();

        vm.prank(operator);
        vm.expectRevert(VendoVault.IsPaused.selector);
        vault.payBill(hosting, 1 * U, "x");

        vm.prank(operator);
        vm.expectRevert(VendoVault.NotOwner.selector);
        vault.unpause();

        vm.prank(owner);
        vault.withdraw(owner, 1_000 * U); // recalls from venue automatically
        assertEq(usdt.balanceOf(owner), 1_000 * U);
        assertEq(vault.totalAssets(), 0);
    }

    function testFuzz_SweepNeverBreaksBuffer(uint256 amount) public {
        amount = bound(amount, 0, 2_000 * U);
        vm.prank(operator);
        try vault.sweep(address(venue), amount) {
            assertGe(vault.idle(), vault.buffer());
        } catch {}
    }
}
