// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

library Ticks {
    struct Tick {
        uint96 liquidityLowerD8;
        uint96 liquidityUpperD8;
        int24 nextBelow;
        int24 nextAbove;
        // bool logFeeGrowth0;
        // bool logFeeGrowth1;
        uint80 feeGrowthOutside0;
        uint80 feeGrowthOutside1;
        uint96 secondsPerLiquidityOutside;
    }

    /// @dev Flip the direction of "outside". Called when the tick is being crossed.
    function flip(
        Tick storage self,
        uint80 feeGrowthGlobal0,
        uint80 feeGrowthGlobal1,
        uint96 secondsPerLiquidityCumulative
    ) internal {
        unchecked {
            self.feeGrowthOutside0 = feeGrowthGlobal0 - self.feeGrowthOutside0;
            self.feeGrowthOutside1 = feeGrowthGlobal1 - self.feeGrowthOutside1;
            self.secondsPerLiquidityOutside = secondsPerLiquidityCumulative - self.secondsPerLiquidityOutside;
        }
    }
}
