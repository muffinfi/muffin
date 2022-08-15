// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.10;

import "../../libraries/Ticks.sol";
import "./LensBase.sol";

import "hardhat/console.sol";

abstract contract TickLens is LensBase {
    using Bytes32ArrayLib for Bytes32ArrayLib.Bytes32Array;

    uint256 private constant CHUNK_SIZE = 100;

    /**
     * @notice  Get ticks of a tier.
     * @param poolId    Pool id
     * @param tierId    Tier id
     * @param tickStart First tick to get. This tick must be initialized.
     * @param tickEnd   Ticks beyond "tickEnd" is not included in the return data. Can be uninitialized.
     * @param maxCount  Max number of ticks to retrieve
     * @return count    Number of ticks retrieved
     * @return ticks    List of ticks concatenated into bytes.
     * Each tick consists of 256 bits:
     * - int24  tickIdx
     * - uint96 liquidityLowerD8
     * - uint96 liquidityUpperD8
     * - bool   needSettle0
     * - bool   needSettle1
     * To parse it in ether.js, see the example https://github.com/muffinfi/muffin/blob/master/test/lens/03_tick_lens.ts#L11
     *
     * @dev Estimated gas costs:
     *  - 1 tick:     13220 gas
     *  - 10 ticks:   94222 gas
     *  - 100 ticks:  889844 gas
     *  - 1000 ticks: 10361238 gas
     */
    function getTicks(
        bytes32 poolId,
        uint8 tierId,
        int24 tickStart,
        int24 tickEnd,
        uint24 maxCount
    ) external view returns (uint256 count, bytes memory ticks) {
        bool upwardDirection = tickEnd - tickStart >= 0;
        int24 tickIdx = tickStart;
        Bytes32ArrayLib.Bytes32Array memory arr;

        while (arr.length < maxCount) {
            Ticks.Tick memory tick = hub.getTick(poolId, tierId, tickIdx);

            // for the first tick, check if it is initialized
            if (arr.length == 0 && tick.liquidityLowerD8 == 0 && tick.liquidityUpperD8 == 0) break;

            bytes memory tickPacked = abi.encodePacked(
                tickIdx, //                 int24
                tick.liquidityLowerD8, //   uint96
                tick.liquidityUpperD8, //   uint96
                tick.needSettle0, //        bool
                tick.needSettle1 //         bool
            );
            arr.push(bytes32(tickPacked));

            int24 tickNext = upwardDirection ? tick.nextAbove : tick.nextBelow;

            if (tickIdx == tickNext) break; // it only happens when it reaches end tick
            if (upwardDirection ? tickNext > tickEnd : tickNext < tickEnd) break;
            tickIdx = tickNext;
        }

        arr.end();
        ticks = arr.data;
        count = arr.length;
    }
}

library Bytes32ArrayLib {
    uint256 internal constant CHUNK_SIZE = 3;

    struct Bytes32Array {
        bytes data;
        bytes32[CHUNK_SIZE] chunk;
        uint256 i;
        uint256 length;
    }

    function push(Bytes32Array memory self, bytes32 word) internal pure {
        self.chunk[self.i] = word;
        self.i++;
        self.length++;

        if (self.i == CHUNK_SIZE) {
            self.data = bytes.concat(self.data, abi.encodePacked(self.chunk));
            self.i = 0;
            delete self.chunk;
        }
    }

    function end(Bytes32Array memory self) internal pure {
        if (self.i != 0) {
            bytes32[] memory trimmed = new bytes32[](self.i);
            for (uint256 j; j < trimmed.length; j++) {
                trimmed[j] = self.chunk[j];
            }
            self.data = bytes.concat(self.data, abi.encodePacked(trimmed));
            self.i = 0;
            delete self.chunk;
        }
    }
}
