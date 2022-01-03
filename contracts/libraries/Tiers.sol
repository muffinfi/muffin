// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

library Tiers {
    struct Tier {
        uint128 liquidity;
        uint128 sqrtPrice; //   UQ56.72
        uint24 sqrtGamma; //    can do uint16 for storing 1 - sqrtGamma
        int24 tick;
        int24 nextTickBelow;
        int24 nextTickAbove;
        uint80 feeGrowthGlobal0;
        uint80 feeGrowthGlobal1;
    }

    /// @dev Update tier's next tick if the given tick is more adjacent to the current tick
    function updateNextTick(Tier storage self, int24 tickNew) internal {
        if (tickNew <= self.tick) {
            if (tickNew > self.nextTickBelow) self.nextTickBelow = tickNew;
        } else {
            if (tickNew < self.nextTickAbove) self.nextTickAbove = tickNew;
        }
    }
}
