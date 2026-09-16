// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVenue} from "./IVenue.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// @title VendoVault
/// @notice A business-owned vault for agent revenue on X Layer.
///  - The OWNER (the business) controls everything and can always withdraw.
///  - The OPERATOR (Vendo automation) can only: sweep idle cash above the buffer into approved venues,
///    recall it, pay approved payees within caps and a daily limit, pause, and tighten limits.
///  - The operator can never send funds to an address the owner did not approve, and can never loosen a limit.
contract VendoVault {
    IERC20Min public immutable token;
    address public owner;
    address public operator;

    uint256 public buffer;          // idle cash to keep available for bills
    uint256 public dailyLimit;      // max total bill payments per UTC day
    uint256 public spentToday;
    uint256 public spentDay;        // day index for spentToday
    bool public paused;

    mapping(address => bool) public isVenue;
    address[] public venues;
    mapping(address => uint256) public payeeCap; // 0 = not approved

    uint256 private locked = 1;

    event OperatorSet(address indexed operator);
    event BufferSet(uint256 buffer);
    event DailyLimitSet(uint256 limit);
    event VenueSet(address indexed venue, bool allowed);
    event PayeeSet(address indexed payee, uint256 cap);
    event Swept(address indexed venue, uint256 amount);
    event Recalled(address indexed venue, uint256 amount);
    event BillPaid(address indexed payee, uint256 amount, bytes32 indexed ref);
    event Withdrawn(address indexed to, uint256 amount);
    event Paused(address indexed by);
    event Unpaused();

    error NotOwner();
    error NotOperator();
    error IsPaused();
    error NotVenue();
    error NotPayee();
    error OverCap();
    error OverDailyLimit();
    error BelowBuffer();
    error OnlyTighten();
    error Insufficient();
    error TransferFailed();
    error Reentrancy();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyOperatorOrOwner() { if (msg.sender != operator && msg.sender != owner) revert NotOperator(); _; }
    modifier whenNotPaused() { if (paused) revert IsPaused(); _; }
    modifier nonReentrant() { if (locked != 1) revert Reentrancy(); locked = 2; _; locked = 1; }

    constructor(address token_, address owner_, address operator_, uint256 buffer_, uint256 dailyLimit_) {
        token = IERC20Min(token_);
        owner = owner_;
        operator = operator_;
        buffer = buffer_;
        dailyLimit = dailyLimit_;
        emit OperatorSet(operator_);
        emit BufferSet(buffer_);
        emit DailyLimitSet(dailyLimit_);
    }

    // ----------------------------------------------------------------- views
    function idle() public view returns (uint256) { return token.balanceOf(address(this)); }

    function invested() public view returns (uint256 total) {
        for (uint256 i; i < venues.length; i++) {
            if (isVenue[venues[i]]) total += IVenue(venues[i]).balanceOf(address(this));
        }
    }

    function totalAssets() external view returns (uint256) { return idle() + invested(); }

    // ------------------------------------------------------- owner controls
    function setOperator(address op) external onlyOwner { operator = op; emit OperatorSet(op); }
    function setBuffer(uint256 b) external onlyOwner { buffer = b; emit BufferSet(b); }
    function setDailyLimit(uint256 l) external onlyOwner { dailyLimit = l; emit DailyLimitSet(l); }

    function setVenue(address venue, bool allowed) external onlyOwner {
        if (allowed && !isVenue[venue]) {
            bool known;
            for (uint256 i; i < venues.length; i++) if (venues[i] == venue) { known = true; break; }
            if (!known) venues.push(venue);
        }
        isVenue[venue] = allowed;
        emit VenueSet(venue, allowed);
    }

    function setPayee(address payee, uint256 cap) external onlyOwner { payeeCap[payee] = cap; emit PayeeSet(payee, cap); }

    function unpause() external onlyOwner { paused = false; emit Unpaused(); }

    /// @notice The business can always take its money out, even while paused.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        _ensureIdle(amount);
        _transfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // --------------------------------------------------- operator controls
    /// @notice Move idle cash above the buffer into an approved venue.
    function sweep(address venue, uint256 amount) external onlyOperatorOrOwner whenNotPaused nonReentrant {
        if (!isVenue[venue]) revert NotVenue();
        uint256 cash = idle();
        if (cash < amount || cash - amount < buffer) revert BelowBuffer();
        if (!token.approve(venue, amount)) revert TransferFailed();
        IVenue(venue).deposit(amount);
        token.approve(venue, 0);
        emit Swept(venue, amount);
    }

    /// @notice Bring money back from a venue (e.g. before a bill is due).
    function recall(address venue, uint256 amount) external onlyOperatorOrOwner nonReentrant {
        if (!isVenue[venue]) revert NotVenue();
        IVenue(venue).withdraw(amount);
        emit Recalled(venue, amount);
    }

    /// @notice Pay an approved payee within its cap and the daily limit. Pulls from venues if cash is short.
    function payBill(address payee, uint256 amount, bytes32 ref) external onlyOperatorOrOwner whenNotPaused nonReentrant {
        uint256 cap = payeeCap[payee];
        if (cap == 0) revert NotPayee();
        if (amount > cap) revert OverCap();
        uint256 day = block.timestamp / 1 days;
        if (day != spentDay) { spentDay = day; spentToday = 0; }
        if (spentToday + amount > dailyLimit) revert OverDailyLimit();
        spentToday += amount;
        _ensureIdle(amount);
        _transfer(payee, amount);
        emit BillPaid(payee, amount, ref);
    }

    /// @notice Automation can only make things safer: pause, or lower limits.
    function pause() external onlyOperatorOrOwner { paused = true; emit Paused(msg.sender); }

    function tightenPayeeCap(address payee, uint256 newCap) external onlyOperatorOrOwner {
        if (newCap > payeeCap[payee]) revert OnlyTighten();
        payeeCap[payee] = newCap;
        emit PayeeSet(payee, newCap);
    }

    function tightenDailyLimit(uint256 newLimit) external onlyOperatorOrOwner {
        if (newLimit > dailyLimit) revert OnlyTighten();
        dailyLimit = newLimit;
        emit DailyLimitSet(newLimit);
    }

    // ------------------------------------------------------------- internal
    function _ensureIdle(uint256 amount) internal {
        uint256 cash = idle();
        if (cash >= amount) return;
        uint256 need = amount - cash;
        for (uint256 i; i < venues.length && need > 0; i++) {
            address v = venues[i];
            if (!isVenue[v]) continue;
            uint256 bal = IVenue(v).balanceOf(address(this));
            uint256 take = bal < need ? bal : need;
            if (take > 0) {
                IVenue(v).withdraw(take);
                emit Recalled(v, take);
                need -= take;
            }
        }
        if (idle() < amount) revert Insufficient();
    }

    function _transfer(address to, uint256 amount) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeWithSelector(IERC20Min.transfer.selector, to, amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
