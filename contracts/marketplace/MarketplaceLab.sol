// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721Receiver, ToyERC20, ToyERC721} from "../common/ToyAssets.sol";

interface IMarketplaceToy {
    function list(uint256 tokenId, uint256 bond) external;
    function buy(uint256 tokenId) external;
    function refundListing(uint256 tokenId) external;
}

abstract contract MarketplaceToyBase is IMarketplaceToy {
    struct Listing {
        address seller;
        uint256 bond;
        bool active;
    }

    ToyERC721 public immutable nft;
    ToyERC20 public immutable bondToken;
    mapping(uint256 => Listing) public listings;

    event Step(string message, uint256 tokenId, address actor, uint256 bond);

    constructor(address nftAddress, address bondTokenAddress) {
        nft = ToyERC721(nftAddress);
        bondToken = ToyERC20(bondTokenAddress);
    }

    function list(uint256 tokenId, uint256 bond) external {
        require(!listings[tokenId].active, "listing active");
        nft.transferFrom(msg.sender, address(this), tokenId);
        require(bondToken.transferFrom(msg.sender, address(this), bond), "bond transfer failed");
        listings[tokenId] = Listing({seller: msg.sender, bond: bond, active: true});
        emit Step("listing funded", tokenId, msg.sender, bond);
    }

    function buy(uint256 tokenId) external virtual;

    function refundListing(uint256 tokenId) external virtual;
}

/// @notice Holdout case: the listing remains refundable during the NFT receiver callback.
contract MarketplaceVulnerable is MarketplaceToyBase {
    constructor(address nftAddress, address bondTokenAddress)
        MarketplaceToyBase(nftAddress, bondTokenAddress)
    {}

    function buy(uint256 tokenId) external override {
        require(listings[tokenId].active, "listing inactive");

        nft.safeTransferFrom(address(this), msg.sender, tokenId);

        // A seller that is also the receiver can refund during the callback.
        require(bondToken.transfer(msg.sender, listings[tokenId].bond), "bond return failed");
        listings[tokenId].active = false;
        emit Step("listing finalized after callback", tokenId, msg.sender, listings[tokenId].bond);
    }

    function refundListing(uint256 tokenId) external override {
        require(listings[tokenId].active, "listing inactive");
        require(listings[tokenId].seller == msg.sender, "not seller");
        listings[tokenId].active = false;
        require(bondToken.transfer(msg.sender, listings[tokenId].bond), "refund failed");
        emit Step("listing refunded", tokenId, msg.sender, listings[tokenId].bond);
    }
}

/// @notice Fix: finalize the listing and return its bond before transferring the NFT.
contract MarketplaceFixed is MarketplaceToyBase {
    constructor(address nftAddress, address bondTokenAddress)
        MarketplaceToyBase(nftAddress, bondTokenAddress)
    {}

    function buy(uint256 tokenId) external override {
        Listing storage listing = listings[tokenId];
        require(listing.active, "listing inactive");
        listing.active = false;
        uint256 bond = listing.bond;
        require(bondToken.transfer(msg.sender, bond), "bond return failed");
        emit Step("listing finalized before callback", tokenId, msg.sender, bond);

        nft.safeTransferFrom(address(this), msg.sender, tokenId);
    }

    function refundListing(uint256 tokenId) external override {
        require(listings[tokenId].active, "listing inactive");
        require(listings[tokenId].seller == msg.sender, "not seller");
        listings[tokenId].active = false;
        require(bondToken.transfer(msg.sender, listings[tokenId].bond), "refund failed");
        emit Step("listing refunded", tokenId, msg.sender, listings[tokenId].bond);
    }
}

contract MarketplaceCallbackStudent is IERC721Receiver {
    IMarketplaceToy public immutable market;
    ToyERC721 public immutable nft;
    ToyERC20 public immutable bondToken;

    bool public armed;
    bool public reentrySucceeded;
    uint256 public callbacks;
    uint256 public listedTokenId;

    event CallbackObserved(uint256 tokenId, bool attemptedRefund);

    constructor(address marketAddress, address nftAddress, address bondTokenAddress) {
        market = IMarketplaceToy(marketAddress);
        nft = ToyERC721(nftAddress);
        bondToken = ToyERC20(bondTokenAddress);
    }

    function prepareAndBuy(uint256 tokenId, uint256 bond) external {
        listedTokenId = tokenId;
        nft.setApprovalForAll(address(market), true);
        bondToken.approve(address(market), type(uint256).max);
        market.list(tokenId, bond);

        armed = true;
        market.buy(tokenId);
        armed = false;
    }

    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external returns (bytes4) {
        callbacks += 1;
        bool shouldTry = armed && tokenId == listedTokenId;
        emit CallbackObserved(tokenId, shouldTry);

        if (shouldTry) {
            try market.refundListing(tokenId) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }

        return IERC721Receiver.onERC721Received.selector;
    }
}
