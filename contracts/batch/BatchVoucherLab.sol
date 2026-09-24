// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal ERC-1155 batch receiver interface for the local teaching fixture.
interface IToyERC1155BatchReceiver {
    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external returns (bytes4);
}

/// @notice Deliberately small batch token used only on the ephemeral Hardhat chain.
contract ToyBatchERC1155 {
    mapping(uint256 => mapping(address => uint256)) private balances;

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return balances[id][account];
    }

    /// @dev Local fixture seeding/bonus helper. It intentionally performs no receiver callback.
    function issueUnchecked(address to, uint256 id, uint256 amount) external {
        balances[id][to] += amount;
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts
    ) external {
        require(msg.sender == from, "T1155B: only holder");
        require(ids.length == amounts.length, "T1155B: length");

        for (uint256 index = 0; index < ids.length; index++) {
            require(balances[ids[index]][from] >= amounts[index], "T1155B: balance");
            balances[ids[index]][from] -= amounts[index];
            balances[ids[index]][to] += amounts[index];
        }

        if (to.code.length != 0) {
            bytes4 answer = IToyERC1155BatchReceiver(to).onERC1155BatchReceived(
                msg.sender,
                from,
                ids,
                amounts,
                ""
            );
            require(
                answer == IToyERC1155BatchReceiver.onERC1155BatchReceived.selector,
                "T1155B: rejected"
            );
        }
    }
}

interface IBatchVoucherToy {
    function distributePair(uint256 amount) external;
    function claimBonus(uint256 amount) external;
}

abstract contract BatchVoucherBase is IBatchVoucherToy {
    ToyBatchERC1155 public immutable token;
    mapping(address => uint256) public credits;

    event PairDistributed(address receiver, uint256 amount);
    event BonusClaimed(address receiver, uint256 amount);

    constructor(address tokenAddress) {
        token = ToyBatchERC1155(tokenAddress);
    }

    function distributePair(uint256 amount) external virtual;

    function claimBonus(uint256 amount) external {
        require(credits[msg.sender] == 0, "credit already assigned");
        credits[msg.sender] = amount;
        token.issueUnchecked(msg.sender, 3, amount);
        emit BonusClaimed(msg.sender, amount);
    }

    function pairData(uint256 amount)
        internal
        pure
        returns (uint256[] memory ids, uint256[] memory amounts)
    {
        ids = new uint256[](2);
        amounts = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        amounts[0] = amount;
        amounts[1] = amount;
    }
}

/// @notice Holdout: the credit assignment occurs after the ERC-1155 batch callback.
contract BatchVoucherVulnerable is BatchVoucherBase {
    constructor(address tokenAddress) BatchVoucherBase(tokenAddress) {}

    function distributePair(uint256 amount) external override {
        require(credits[msg.sender] == 0, "credit already assigned");
        (uint256[] memory ids, uint256[] memory amounts) = pairData(amount);

        token.safeBatchTransferFrom(address(this), msg.sender, ids, amounts);

        // The callback can claim a bonus while credit is still zero; this overwrites it.
        credits[msg.sender] = amount * 2;
        emit PairDistributed(msg.sender, amount);
    }
}

/// @notice Fix: assign the complete credit before transferring the batch.
contract BatchVoucherFixed is BatchVoucherBase {
    constructor(address tokenAddress) BatchVoucherBase(tokenAddress) {}

    function distributePair(uint256 amount) external override {
        require(credits[msg.sender] == 0, "credit already assigned");
        credits[msg.sender] = amount * 2;
        (uint256[] memory ids, uint256[] memory amounts) = pairData(amount);

        token.safeBatchTransferFrom(address(this), msg.sender, ids, amounts);
        emit PairDistributed(msg.sender, amount);
    }
}

contract BatchVoucherCallbackStudent is IToyERC1155BatchReceiver {
    IBatchVoucherToy public immutable vault;
    bool public armed;
    bool public reentrySucceeded;
    uint256 public callbacks;

    event BatchCallbackObserved(uint256 amount, bool attemptedBonus);

    constructor(address vaultAddress) {
        vault = IBatchVoucherToy(vaultAddress);
    }

    function runLesson(uint256 amount) external {
        armed = true;
        vault.distributePair(amount);
        armed = false;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata amounts,
        bytes calldata
    ) external returns (bytes4) {
        callbacks += 1;
        emit BatchCallbackObserved(amounts[0], armed);
        if (armed) {
            try vault.claimBonus(amounts[0]) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
        return IToyERC1155BatchReceiver.onERC1155BatchReceived.selector;
    }
}
