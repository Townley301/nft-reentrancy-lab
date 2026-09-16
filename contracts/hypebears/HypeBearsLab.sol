// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721Receiver} from "../common/ToyAssets.sol";

abstract contract HypeBearsToyBase {
    mapping(address => bool) public addressMinted;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public ownerOf;
    uint256 public nextTokenId = 1;

    event Step(string message, address actor, uint256 value);

    function mintNFT() external virtual;

    function _safeMint(address to) internal {
        uint256 tokenId = nextTokenId++;
        ownerOf[tokenId] = to;
        balanceOf[to] += 1;
        emit Step("NFT state written; receiver callback is next", to, tokenId);

        if (to.code.length != 0) {
            bytes4 answer = IERC721Receiver(to).onERC721Received(
                msg.sender,
                address(0),
                tokenId,
                ""
            );
            require(answer == IERC721Receiver.onERC721Received.selector, "receiver rejected NFT");
        }
    }
}

/// @notice Vulnerable ordering: the one-time mint flag is written after the callback.
contract HypeBearsVulnerable is HypeBearsToyBase {
    function mintNFT() external override {
        require(!addressMinted[msg.sender], "already minted");
        emit Step("eligibility check passed", msg.sender, balanceOf[msg.sender]);
        _safeMint(msg.sender);
        addressMinted[msg.sender] = true;
        emit Step("mint flag written too late", msg.sender, balanceOf[msg.sender]);
    }
}

/// @notice Fixed ordering: consume the eligibility before handing control to the receiver.
contract HypeBearsFixed is HypeBearsToyBase {
    function mintNFT() external override {
        require(!addressMinted[msg.sender], "already minted");
        addressMinted[msg.sender] = true;
        emit Step("mint flag written before callback", msg.sender, balanceOf[msg.sender]);
        _safeMint(msg.sender);
    }
}

interface IHypeBearsToy {
    function mintNFT() external;
    function addressMinted(address account) external view returns (bool);
}

/// @notice Lab demonstrator / teaching receiver. Reenters once only while armed.
/// @dev Not an exploit playbook — instrumentation for classroom assertions.
contract HypeBearsCallbackStudent is IERC721Receiver {
    IHypeBearsToy public immutable target;
    bool public armed;
    bool public reentrySucceeded;
    uint256 public callbacks;

    /// @dev Snapshot of app ledger during the first receiver hook (learning point a).
    bool public addressMintedDuringFirstCallback;
    bool public recordedFirstCallbackFlag;

    /// @dev msg.sender inside onERC721Received — must be the NFT contract (learning point b).
    address public msgSenderDuringCallback;

    /// @dev `operator` arg of onERC721Received — here, who called mintNFT / _safeMint.
    address public operatorDuringCallback;

    event CallbackObserved(uint256 callbackNumber, bool attemptedReentry);

    constructor(address targetAddress) {
        target = IHypeBearsToy(targetAddress);
    }

    function runLesson() external {
        armed = true;
        target.mintNFT();
        armed = false;
    }

    function onERC721Received(
        address operator,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        callbacks += 1;
        bool shouldTry = armed && callbacks == 1;
        emit CallbackObserved(callbacks, shouldTry);

        if (callbacks == 1 && !recordedFirstCallbackFlag) {
            // Token ledger is already updated; app flag may or may not be.
            addressMintedDuringFirstCallback = target.addressMinted(address(this));
            recordedFirstCallbackFlag = true;
            msgSenderDuringCallback = msg.sender;
            operatorDuringCallback = operator;
        }

        if (shouldTry) {
            try target.mintNFT() {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }

        return IERC721Receiver.onERC721Received.selector;
    }
}
