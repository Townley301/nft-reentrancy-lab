// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ToyERC721} from "../common/ToyAssets.sol";

/// @notice Negative control: all relevant state is finalized before the callback.
contract SafeCallbackControl {
    ToyERC721 public immutable nft;
    mapping(uint256 => bool) public finalized;

    event Delivered(uint256 tokenId);

    constructor(address nftAddress) {
        nft = ToyERC721(nftAddress);
    }

    function deliver(address receiver, uint256 tokenId) external {
        finalized[tokenId] = true;
        nft.safeTransferFrom(address(this), receiver, tokenId);
        emit Delivered(tokenId);
    }

    function resetForAnotherLesson(uint256 tokenId) external {
        finalized[tokenId] = false;
    }
}

/// @notice Negative control for a known static limitation: the apparent reentry writer is admin-only.
contract PermissionedCallbackControl {
    ToyERC721 public immutable nft;
    address public immutable admin;
    mapping(uint256 => bool) public finalized;

    event Delivered(uint256 tokenId);

    constructor(address nftAddress) {
        nft = ToyERC721(nftAddress);
        admin = msg.sender;
    }

    function deliver(address receiver, uint256 tokenId) external {
        nft.safeTransferFrom(address(this), receiver, tokenId);
        finalized[tokenId] = true;
        emit Delivered(tokenId);
    }

    function adminCancel(uint256 tokenId) external {
        require(msg.sender == admin, "admin only");
        finalized[tokenId] = false;
    }
}
