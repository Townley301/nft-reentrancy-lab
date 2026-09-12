// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721Receiver, ToyERC20, ToyERC721} from "../common/ToyAssets.sol";

interface IOmniToyPool {
    function supply(uint256 tokenId) external;
    function borrow(uint256 amount) external;
    function withdraw(uint256 tokenId, address to) external;
    function liquidate(address user, uint256 tokenId, address to) external;
}

abstract contract OmniToyPoolBase is IOmniToyPool {
    ToyERC721 public immutable nft;
    ToyERC20 public immutable loanToken;

    uint256 public constant CREDIT_PER_NFT = 10;
    uint256 public constant LIQUIDATION_REPAYMENT = 1;

    mapping(uint256 => address) public depositorOf;
    mapping(address => uint256) public collateralCount;
    mapping(address => uint256) public debt;
    mapping(address => bool) public usingAsCollateral;

    event Step(string message, address user, uint256 collateral, uint256 debtAmount);

    constructor(address nftAddress, address loanTokenAddress) {
        nft = ToyERC721(nftAddress);
        loanToken = ToyERC20(loanTokenAddress);
    }

    function supply(uint256 tokenId) external {
        nft.transferFrom(msg.sender, address(this), tokenId);
        depositorOf[tokenId] = msg.sender;
        collateralCount[msg.sender] += 1;
        usingAsCollateral[msg.sender] = true;
        emit Step("collateral supplied", msg.sender, collateralCount[msg.sender], debt[msg.sender]);
    }

    function borrow(uint256 amount) external {
        require(
            debt[msg.sender] + amount <= collateralCount[msg.sender] * CREDIT_PER_NFT,
            "borrow would be unhealthy"
        );
        debt[msg.sender] += amount;
        require(loanToken.transfer(msg.sender, amount), "loan transfer failed");
        emit Step("toy loan issued", msg.sender, collateralCount[msg.sender], debt[msg.sender]);
    }

    function _isHealthy(address user) internal view returns (bool) {
        return debt[user] <= collateralCount[user] * CREDIT_PER_NFT;
    }
}

/// @notice Minimal teaching model of OMNI's cross-function ordering problem.
contract OmniPoolVulnerable is OmniToyPoolBase {
    constructor(address nftAddress, address loanTokenAddress)
        OmniToyPoolBase(nftAddress, loanTokenAddress)
    {}

    function withdraw(uint256 tokenId, address to) external {
        require(depositorOf[tokenId] == msg.sender, "not your collateral");

        // The receipt balance is reduced, but the broader collateral flag and
        // final health decision are intentionally left unfinished.
        depositorOf[tokenId] = address(0);
        collateralCount[msg.sender] -= 1;
        emit Step("withdraw half-finished; callback is next", msg.sender, collateralCount[msg.sender], debt[msg.sender]);

        nft.safeTransferFrom(address(this), to, tokenId);

        // A reentrant liquidation can turn this flag off, causing the check to be skipped.
        if (usingAsCollateral[msg.sender]) {
            require(_isHealthy(msg.sender), "withdraw leaves unhealthy debt");
        }
        if (collateralCount[msg.sender] == 0) {
            usingAsCollateral[msg.sender] = false;
        }
        emit Step("withdraw finished", msg.sender, collateralCount[msg.sender], debt[msg.sender]);
    }

    function liquidate(address user, uint256 tokenId, address to) external {
        require(depositorOf[tokenId] == user, "not user's collateral");
        require(!_isHealthy(user), "position is healthy");
        require(
            loanToken.transferFrom(msg.sender, address(this), LIQUIDATION_REPAYMENT),
            "repayment failed"
        );

        debt[user] -= LIQUIDATION_REPAYMENT;
        depositorOf[tokenId] = address(0);
        collateralCount[user] -= 1;
        emit Step("liquidation half-finished; callback is next", user, collateralCount[user], debt[user]);

        nft.safeTransferFrom(address(this), to, tokenId);

        if (collateralCount[user] == 0) {
            usingAsCollateral[user] = false;
        }
        emit Step("liquidation finished", user, collateralCount[user], debt[user]);
    }
}

/// @notice Fixed model: shared lock plus checks/effects before NFT delivery.
contract OmniPoolFixed is OmniToyPoolBase {
    bool private entered;

    modifier nonReentrant() {
        require(!entered, "cross-function reentry blocked");
        entered = true;
        _;
        entered = false;
    }

    constructor(address nftAddress, address loanTokenAddress)
        OmniToyPoolBase(nftAddress, loanTokenAddress)
    {}

    function withdraw(uint256 tokenId, address to) external nonReentrant {
        require(depositorOf[tokenId] == msg.sender, "not your collateral");

        depositorOf[tokenId] = address(0);
        collateralCount[msg.sender] -= 1;
        if (collateralCount[msg.sender] == 0) {
            usingAsCollateral[msg.sender] = false;
        }
        require(_isHealthy(msg.sender), "withdraw leaves unhealthy debt");

        emit Step("state finalized before callback", msg.sender, collateralCount[msg.sender], debt[msg.sender]);
        nft.safeTransferFrom(address(this), to, tokenId);
    }

    function liquidate(address user, uint256 tokenId, address to) external nonReentrant {
        require(depositorOf[tokenId] == user, "not user's collateral");
        require(!_isHealthy(user), "position is healthy");
        require(
            loanToken.transferFrom(msg.sender, address(this), LIQUIDATION_REPAYMENT),
            "repayment failed"
        );

        debt[user] -= LIQUIDATION_REPAYMENT;
        depositorOf[tokenId] = address(0);
        collateralCount[user] -= 1;
        if (collateralCount[user] == 0) {
            usingAsCollateral[user] = false;
        }

        emit Step("liquidation state finalized before callback", user, collateralCount[user], debt[user]);
        nft.safeTransferFrom(address(this), to, tokenId);
    }
}

contract OmniBorrowerStudent {
    IOmniToyPool public immutable pool;
    ToyERC721 public immutable nft;

    constructor(address poolAddress, address nftAddress) {
        pool = IOmniToyPool(poolAddress);
        nft = ToyERC721(nftAddress);
    }

    function prepare(uint256 firstId, uint256 secondId, uint256 borrowAmount) external {
        nft.setApprovalForAll(address(pool), true);
        pool.supply(firstId);
        pool.supply(secondId);
        pool.borrow(borrowAmount);
    }

    function startWithdraw(uint256 firstId, address receiver) external {
        pool.withdraw(firstId, receiver);
    }
}

contract OmniLiquidatorCallbackStudent is IERC721Receiver {
    IOmniToyPool public immutable pool;
    ToyERC20 public immutable loanToken;

    address public borrower;
    uint256 public secondTokenId;
    bool public armed;
    bool public reentrySucceeded;
    uint256 public callbacks;

    event CallbackObserved(uint256 tokenId, bool attemptedLiquidation);

    constructor(address poolAddress, address loanTokenAddress) {
        pool = IOmniToyPool(poolAddress);
        loanToken = ToyERC20(loanTokenAddress);
    }

    function arm(address borrowerAddress, uint256 collateralTokenId) external {
        borrower = borrowerAddress;
        secondTokenId = collateralTokenId;
        armed = true;
        loanToken.approve(address(pool), type(uint256).max);
    }

    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external returns (bytes4) {
        callbacks += 1;
        bool shouldTry = armed;
        emit CallbackObserved(tokenId, shouldTry);

        if (shouldTry) {
            armed = false;
            try pool.liquidate(borrower, secondTokenId, address(this)) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }

        return IERC721Receiver.onERC721Received.selector;
    }
}
