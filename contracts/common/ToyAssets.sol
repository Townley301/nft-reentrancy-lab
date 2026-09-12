// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal interfaces and toy assets for a local teaching lab.
/// They are deliberately small and MUST NOT be used in production.

interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

interface IERC1155Receiver {
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4);
}

contract ToyERC20 {
    string public constant name = "Local Toy Dollar";
    string public constant symbol = "TOY";

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "TOY: allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "TOY: balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract ToyERC721 {
    string public constant name = "Local Toy NFT";
    string public constant symbol = "TNFT";

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function mint(address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == address(0), "TNFT: exists");
        ownerOf[tokenId] = to;
        balanceOf[to] += 1;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(ownerOf[tokenId] == from, "TNFT: wrong owner");
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "TNFT: not approved");
        ownerOf[tokenId] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            bytes4 answer = IERC721Receiver(to).onERC721Received(
                msg.sender,
                from,
                tokenId,
                ""
            );
            require(answer == IERC721Receiver.onERC721Received.selector, "TNFT: rejected");
        }
    }
}

contract ToyERC1155 {
    mapping(uint256 => mapping(address => uint256)) private balances;
    mapping(uint256 => uint256) public totalSupply;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return balances[id][account];
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function mint(address to, uint256 id, uint256 amount, bytes calldata data) external {
        balances[id][to] += amount;
        totalSupply[id] += amount;

        if (to.code.length != 0) {
            bytes4 answer = IERC1155Receiver(to).onERC1155Received(
                msg.sender,
                address(0),
                id,
                amount,
                data
            );
            require(answer == IERC1155Receiver.onERC1155Received.selector, "T1155: rejected");
        }
    }

    function burn(address from, uint256 id, uint256 amount) external {
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "T1155: not approved");
        require(balances[id][from] >= amount, "T1155: balance");
        balances[id][from] -= amount;
        totalSupply[id] -= amount;
    }
}
