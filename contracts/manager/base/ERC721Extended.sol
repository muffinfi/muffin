// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./ERC721.sol";
import "../../interfaces/common/IERC1271.sol";
import "../../interfaces/common/IERC721Descriptor.sol";

abstract contract ERC721Extended is ERC721 {
    bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)"); // prettier-ignore
    bytes32 private immutable nameHash;
    mapping(uint256 => uint256) public nonces;

    uint80 internal minted;
    uint80 internal burned;
    uint80 internal nextTokenId;
    mapping(address => mapping(uint256 => uint256)) internal _ownedTokens; // user => tokenId[]

    address public tokenDescriptor;
    address public tokenDescriptorSetter;

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {
        nameHash = keccak256(bytes(name_));
    }

    /*=====================================================================
     *                              PERMIT
     *====================================================================*/

    function DOMAIN_SEPARATOR() public view returns (bytes32 domainSeperator) {
        domainSeperator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                nameHash,
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function permit(
        address spender,
        uint256 tokenId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable {
        require(deadline >= block.timestamp, "Permit Expired");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, spender, tokenId, nonces[tokenId]++, deadline))
            )
        );
        address owner = ownerOf(tokenId);
        if (Address.isContract(owner)) {
            require(IERC1271(owner).isValidSignature(digest, abi.encodePacked(r, s, v)) == 0x1626ba7e, "Unauthorized");
        } else {
            address recoveredAddress = ecrecover(digest, v, r, s);
            require(recoveredAddress != address(0), "Invalid signature");
            require(recoveredAddress == owner, "Unauthorized");
        }
        _approve(spender, tokenId);
    }

    /*=====================================================================
     *                           ENUMERABILITY
     *====================================================================*/

    /**
     * Adapted from OpenZeppelin 4.3.1's ERC721Enumerable.
     * Removed the `allTokens` array and use counters to keep track of total supply.
     * Also removed the `_ownedTokensIndex` mapping and added setter and getter functions for it.
     */

    function totalSupply() public view virtual returns (uint256) {
        return minted - burned;
    }

    function tokenOfOwnerByIndex(address owner, uint256 index) public view virtual returns (uint256 tokenId) {
        require(index < ERC721.balanceOf(owner), "Index out of bound");
        tokenId = _ownedTokens[owner][index];
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, tokenId);

        if (from == address(0)) {
            minted++;
        } else if (from != to) {
            _removeTokenFromOwnerEnumeration(from, tokenId);
        }

        if (to == address(0)) {
            burned++;
        } else if (to != from) {
            _addTokenToOwnerEnumeration(to, tokenId);
        }
    }

    function _addTokenToOwnerEnumeration(address to, uint256 tokenId) private {
        uint256 length = ERC721.balanceOf(to);
        _ownedTokens[to][length] = tokenId;
        _setOwnedTokenIndex(tokenId, length);
    }

    function _removeTokenFromOwnerEnumeration(address from, uint256 tokenId) private {
        uint256 lastTokenIndex = ERC721.balanceOf(from) - 1;
        uint256 tokenIndex = _getOwnedTokenIndex(tokenId);

        if (tokenIndex != lastTokenIndex) {
            uint256 lastTokenId = _ownedTokens[from][lastTokenIndex];
            _ownedTokens[from][tokenIndex] = lastTokenId;
            _setOwnedTokenIndex(lastTokenId, tokenIndex);
        }

        _setOwnedTokenIndex(tokenId, 0);
        delete _ownedTokens[from][lastTokenIndex];
    }

    function _getOwnedTokenIndex(uint256 tokenId) internal view virtual returns (uint256 index);

    function _setOwnedTokenIndex(uint256 tokenId, uint256 index) internal virtual;

    /*=====================================================================
     *                             TOKEN URI
     *====================================================================*/

    function tokenURI(uint256 tokenId) public view override(ERC721) returns (string memory) {
        require(_exists(tokenId), "token not exist");
        return tokenDescriptor != address(0) ? IERC721Descriptor(tokenDescriptor).tokenURI(address(this), tokenId) : "";
    }

    function setTokenDescriptor(address descriptor) external {
        require(msg.sender == tokenDescriptorSetter);
        tokenDescriptor = descriptor;
    }

    function setTokenDescriptorSetter(address setter) external {
        require(msg.sender == tokenDescriptorSetter);
        tokenDescriptorSetter = setter;
    }
}
