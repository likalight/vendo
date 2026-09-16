// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVenue} from "../src/IVenue.sol";

contract MockStable {
    string public name = "Mock USDT0";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function approve(address s, uint256 amt) external returns (bool) { allowance[msg.sender][s] = amt; return true; }
    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt, "bal"); balanceOf[msg.sender] -= amt; balanceOf[to] += amt; return true;
    }
    function transferFrom(address f, address to, uint256 amt) external returns (bool) {
        require(allowance[f][msg.sender] >= amt, "allow"); require(balanceOf[f] >= amt, "bal");
        allowance[f][msg.sender] -= amt; balanceOf[f] -= amt; balanceOf[to] += amt; return true;
    }
}

/// @notice Test venue that accrues simple yield on demand.
contract MockVenue is IVenue {
    MockStable public immutable token;
    mapping(address => uint256) public held;
    constructor(MockStable t) { token = t; }
    function deposit(uint256 amount) external { token.transferFrom(msg.sender, address(this), amount); held[msg.sender] += amount; }
    function withdraw(uint256 amount) external { require(held[msg.sender] >= amount, "venue bal"); held[msg.sender] -= amount; token.transfer(msg.sender, amount); }
    function balanceOf(address a) external view returns (uint256) { return held[a]; }
    function accrue(address a, uint256 amt) external { token.mint(address(this), amt); held[a] += amt; }
}
