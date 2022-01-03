// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./Constants.sol";

/// @notice TickMap stores which ticks are initialized.
/// @author Deliswap
library TickMaps {
    struct TickMap {
        uint256 blockmap; //                    stores which blocks are initialized
        mapping(uint256 => uint256) blocks; //  stores which words are initialized
        mapping(uint256 => uint256) words; //   stores which ticks are initialized
    }

    /// @dev Convert tick into an unsigned integer. Assume tick >= Constants.MIN_TICK
    function _compress(int24 tick) internal pure returns (uint256 compressed) {
        unchecked {
            compressed = uint256(int256((tick - Constants.MIN_TICK) / Constants.MIN_TICK_SPACING));
        }
    }

    /// @dev Convert the unsigned integer back to a tick
    function _decompress(uint256 compressed) internal pure returns (int24 tick) {
        unchecked {
            tick = int24(int256(compressed)) * Constants.MIN_TICK_SPACING + Constants.MIN_TICK;
        }
    }

    /// @dev Return the indices of the block and word that the compressed tick uses
    function _indices(uint256 compressed) internal pure returns (uint256 blockIdx, uint256 wordIdx) {
        blockIdx = compressed >> 16;
        wordIdx = compressed >> 8;
        assert(blockIdx < 256);
    }

    function set(TickMap storage self, int24 tick) internal {
        uint256 compressed = _compress(tick);
        (uint256 blockIdx, uint256 wordIdx) = _indices(compressed);

        self.words[wordIdx] |= 1 << (compressed & 0xFF);
        self.blocks[blockIdx] |= 1 << (wordIdx & 0xFF);
        self.blockmap |= 1 << blockIdx;
    }

    function unset(TickMap storage self, int24 tick) internal {
        uint256 compressed = _compress(tick);
        (uint256 blockIdx, uint256 wordIdx) = _indices(compressed);

        self.words[wordIdx] &= ~(1 << (compressed & 0xFF));
        if (self.words[wordIdx] == 0) {
            self.blocks[blockIdx] &= ~(1 << (wordIdx & 0xFF));
            if (self.blocks[blockIdx] == 0) {
                self.blockmap &= ~(1 << blockIdx);
            }
        }
    }

    /// @dev Find the next initialized tick below the given tick. Assume tick >= Constants.MIN_TICK
    // How to find the next initialized bit below the i-th bit inside a word (e.g. i = 8)?
    // 1)  Mask _off_ the word from the 8th bit to the 255th bit (zero-indexed)
    // 2)  Find the most significant bit of the masked word
    //                  8th bit
    //                     ↓
    //     word:   0001 1101 0010 1100
    //     mask:   0000 0000 1111 1111      i.e. (1 << i) - 1
    //     masked: 0000 0000 0010 1100
    //                         ↑
    //                  msb(masked) = 5
    function nextBelow(TickMap storage self, int24 tick) internal view returns (int24 tickBelow) {
        unchecked {
            uint256 compressed = _compress(tick);
            (uint256 blockIdx, uint256 wordIdx) = _indices(compressed);

            uint256 word = self.words[wordIdx] & ((1 << (compressed & 0xFF)) - 1);
            if (word == 0) {
                uint256 block_ = self.blocks[blockIdx] & ((1 << (wordIdx & 0xFF)) - 1);
                if (block_ == 0) {
                    uint256 blockmap = self.blockmap & ((1 << blockIdx) - 1);
                    assert(blockmap != 0);

                    blockIdx = _msb(blockmap);
                    block_ = self.blocks[blockIdx];
                }
                wordIdx = (blockIdx << 8) | _msb(block_);
                word = self.words[wordIdx];
            }

            tickBelow = _decompress((wordIdx << 8) | _msb(word));
        }
    }

    /// @notice Returns the index of the most significant bit of the number, where the least significant bit is at index 0
    /// and the most significant bit is at index 255
    /// @dev The function satisfies the property: x >= 2**mostSignificantBit(x) and x < 2**(mostSignificantBit(x)+1)
    /// @param x the value for which to compute the most significant bit, must be greater than 0
    /// @return r the index of the most significant bit
    function _msb(uint256 x) internal pure returns (uint8 r) {
        unchecked {
            assert(x > 0);
            if (x >= 0x100000000000000000000000000000000) {
                x >>= 128;
                r += 128;
            }
            if (x >= 0x10000000000000000) {
                x >>= 64;
                r += 64;
            }
            if (x >= 0x100000000) {
                x >>= 32;
                r += 32;
            }
            if (x >= 0x10000) {
                x >>= 16;
                r += 16;
            }
            if (x >= 0x100) {
                x >>= 8;
                r += 8;
            }
            if (x >= 0x10) {
                x >>= 4;
                r += 4;
            }
            if (x >= 0x4) {
                x >>= 2;
                r += 2;
            }
            if (x >= 0x2) r += 1;
        }
    }
}
