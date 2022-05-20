// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

library PathLib {
    uint256 internal constant ADDR_BYTES = 20;
    uint256 internal constant ADDR_UINT8_BYTES = ADDR_BYTES + 1;
    uint256 internal constant PATH_MAX_BYTES = ADDR_UINT8_BYTES * 256 + ADDR_BYTES;  // 256 pools (i.e. 5396 bytes)

    function invalid(bytes calldata path) internal pure returns (bool) {
        unchecked {
            return (path.length > PATH_MAX_BYTES || (path.length - ADDR_BYTES) % ADDR_UINT8_BYTES != 0);
        }
    }

    /// @dev Assume the path is valid
    function hopCount(bytes calldata path) internal pure returns (uint256) {
        unchecked {
            return path.length / ADDR_UINT8_BYTES;
        }
    }

    /// @dev Assume the path is valid
    function decodePool(
        bytes calldata path,
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

    /// @dev Assume the path is valid
    function tokensInOut(bytes calldata path, bool exactIn) internal pure returns (address tokenIn, address tokenOut) {
        unchecked {
            tokenIn = _readAddressAt(path, 0);
            tokenOut = _readAddressAt(path, path.length - ADDR_BYTES);
            if (!exactIn) (tokenIn, tokenOut) = (tokenOut, tokenIn);
        }
    }

    function _readAddressAt(bytes calldata data, uint256 offset) internal pure returns (address addr) {
        assembly {
            addr := shr(96, calldataload(add(data.offset, offset)))
        }
    }

    function _readUint8At(bytes calldata data, uint256 offset) internal pure returns (uint8 value) {
        assembly {
            value := shr(248, calldataload(add(data.offset, offset)))
        }
    }
}
