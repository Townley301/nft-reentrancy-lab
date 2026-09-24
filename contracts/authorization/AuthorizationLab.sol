// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721Receiver, ToyERC721} from "../common/ToyAssets.sol";

interface IAuthorizationVaultToy {
    function claimPrimary(uint256 tokenId) external;
    function claimAdditional(uint256 tokenId) external;
}

abstract contract AuthorizationVaultBase is IAuthorizationVaultToy {
    ToyERC721 public immutable nft;
    mapping(address => bool) public approvedClaimer;

    event ClaimerAuthorized(address claimer);
    event ToyClaimed(address claimer, uint256 tokenId, string path);

    constructor(address nftAddress) {
        nft = ToyERC721(nftAddress);
    }

    function authorize(address claimer) external {
        approvedClaimer[claimer] = true;
        emit ClaimerAuthorized(claimer);
    }

    function claimPrimary(uint256 tokenId) external virtual;

    function claimAdditional(uint256 tokenId) external {
        require(approvedClaimer[msg.sender], "temporary approval unavailable");
        nft.transferFrom(address(this), msg.sender, tokenId);
        approvedClaimer[msg.sender] = false;
        emit ToyClaimed(msg.sender, tokenId, "callback path");
    }
}

/// @notice Holdout: temporary authorization remains active during the receiver callback.
contract AuthorizationVaultVulnerable is AuthorizationVaultBase {
    constructor(address nftAddress) AuthorizationVaultBase(nftAddress) {}

    function claimPrimary(uint256 tokenId) external override {
        require(approvedClaimer[msg.sender], "temporary approval unavailable");

        nft.safeTransferFrom(address(this), msg.sender, tokenId);

        approvedClaimer[msg.sender] = false;
        emit ToyClaimed(msg.sender, tokenId, "primary path");
    }
}

/// @notice Fix: consume the temporary authorization before the ERC-721 callback.
contract AuthorizationVaultFixed is AuthorizationVaultBase {
    constructor(address nftAddress) AuthorizationVaultBase(nftAddress) {}

    function claimPrimary(uint256 tokenId) external override {
        require(approvedClaimer[msg.sender], "temporary approval unavailable");
        approvedClaimer[msg.sender] = false;

        nft.safeTransferFrom(address(this), msg.sender, tokenId);
        emit ToyClaimed(msg.sender, tokenId, "primary path");
    }
}

contract AuthorizationCallbackStudent is IERC721Receiver {
    IAuthorizationVaultToy public immutable vault;
    bool public armed;
    bool public reentrySucceeded;
    uint256 public callbacks;
    uint256 public additionalTokenId;

    event AuthorizationCallbackObserved(uint256 tokenId, bool attemptedAdditionalClaim);

    constructor(address vaultAddress) {
        vault = IAuthorizationVaultToy(vaultAddress);
    }

    function runLesson(uint256 primaryTokenId, uint256 secondTokenId) external {
        additionalTokenId = secondTokenId;
        armed = true;
        vault.claimPrimary(primaryTokenId);
        armed = false;
    }

    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external returns (bytes4) {
        callbacks += 1;
        emit AuthorizationCallbackObserved(tokenId, armed);
        if (armed) {
            try vault.claimAdditional(additionalTokenId) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
