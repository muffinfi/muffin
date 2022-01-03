// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.10;

library PathLib {
    uint256 internal constant ADDR_BYTES = 20;
    uint256 internal constant ADDR_UINT8_BYTES = 21;
    uint256 internal constant PATH_MAX_BYTES = 5396; // 256 pools (i.e. 21 * 256 + 20 = 5396 bytes)

    function invalid(bytes memory path) internal pure returns (bool) {
        unchecked {
            return (path.length > PATH_MAX_BYTES || (path.length - ADDR_BYTES) % ADDR_UINT8_BYTES != 0);
        }
    }

    function hopCount(bytes memory path) internal pure returns (uint256) {
        unchecked {
            return (path.length - ADDR_BYTES) / ADDR_UINT8_BYTES;
        }
    }

    function decodePool(
        bytes memory path,
        uint256 poolIndex,
        bool exactIn
    )
        internal
        pure
        returns (
            address tokenIn,
            address tokenOut,
            uint256 tierChoices
        )
    {
        unchecked {
            uint256 offset = ADDR_UINT8_BYTES * poolIndex;
            tokenIn = _readAddressAt(path, offset);
            tokenOut = _readAddressAt(path, ADDR_UINT8_BYTES + offset);
            tierChoices = _readUint8At(path, ADDR_BYTES + offset);
            if (!exactIn) (tokenIn, tokenOut) = (tokenOut, tokenIn);
        }
    }

    function tokensInOut(bytes memory path, bool exactIn) internal pure returns (address tokenIn, address tokenOut) {
        unchecked {
            tokenIn = _readAddressAt(path, 0);
            tokenOut = _readAddressAt(path, path.length - ADDR_BYTES);
            if (!exactIn) (tokenIn, tokenOut) = (tokenOut, tokenIn);
        }
    }

    function _readAddressAt(bytes memory data, uint256 offset) internal pure returns (address addr) {
        assembly {
            addr := mload(add(add(data, 20), offset))
        }
    }

    function _readUint8At(bytes memory data, uint256 offset) internal pure returns (uint8 value) {
        assembly {
            value := mload(add(add(data, 1), offset))
        }
    }

    /**
    /// @dev The byte position of first token address in the path data
    uint256 private constant TOKEN_A_ADDR_POS = 0;
    /// @dev The byte position of tier choices in the path data
    uint256 private constant TIER_CHOICES_POS = 20;
    /// @dev The byte position of second token address in the path data
    uint256 private constant TOKEN_B_ADDR_POS = 21;

    /// @dev The number of bytes of (token address + tier choices)
    uint256 private constant TOKEN_TIER_CHOICES_SIZE = 21;
    /// @dev The minimum length of the path data that contains 2 or more pools
    uint256 private constant NEXT_HOP_MIN_LENGTH = 62;

    /// @dev Decode the i-th pool in the path
    /// @dev Assume path.length <= PATH_MAX_BYTES, so the arithmetic below won't overflow
    function decodePool(bytes memory path, uint256 index)
        internal
        pure
        returns (
            address tokenA,
            address tokenB,
            uint256 tierChoices
        )
    {
        unchecked {
            uint256 offset = TOKEN_TIER_CHOICES_SIZE * index;
            tokenA = _readAddressAt(path, TOKEN_A_ADDR_POS + offset);
            tierChoices = _readUint8At(path, TIER_CHOICES_POS + offset);
            tokenB = _readAddressAt(path, TOKEN_B_ADDR_POS + offset);
        }
    }

    /// @dev Returns true iff the path contains two or more pools
    /// @dev Assume path.length <= PATH_MAX_BYTES, so the arithmetic below won't overflow
    function hasNextHop(bytes memory path, uint256 index) internal pure returns (bool) {
        unchecked {
            return path.length >= NEXT_HOP_MIN_LENGTH + (TOKEN_TIER_CHOICES_SIZE * index);
        }
    }
     */
}