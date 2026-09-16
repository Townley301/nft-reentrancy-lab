// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Sepolia demo: Fixed CEI mint only (addressMinted before _safeMint).
/// @dev Local teaching Vulnerable lives in HypeBearsLab.sol — do NOT deploy Vulnerable publicly.
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

contract HypeBearsFixedMinter {
    mapping(address => bool) public addressMinted;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public ownerOf;
    uint256 public nextTokenId = 1;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function mintNFT() external {
        require(!addressMinted[msg.sender], "already minted");
        addressMinted[msg.sender] = true;
        _safeMint(msg.sender);
    }

    function _safeMint(address to) internal {
        uint256 tokenId = nextTokenId++;
        ownerOf[tokenId] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);

        if (to.code.length != 0) {
            bytes4 answer = IERC721Receiver(to).onERC721Received(
                msg.sender,
                address(0),
                tokenId,
                ""
            );
            require(
                answer == IERC721Receiver.onERC721Received.selector,
                "receiver rejected NFT"
            );
        }
    }
}
