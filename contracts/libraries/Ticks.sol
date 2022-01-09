// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

library Ticks {
    /**
     * @param liquidityLowerD8  Liquidity from positions with a lower tick boundary at this tick
     * @param liquidityUpperD8  Liquidity from positions with a upper tick boundary at this tick
     * @param nextBelow         Next initialized tick below this tick
     * @param nextAbove         Next initialized tick above this tick
     * @param feeGrowthOutside0 Fee0 growth per unit liquidity from this tick outwards (UQ16.64)
     * @param feeGrowthOutside1 Fee1 growth per unit liquidity from this tick outwards (UQ16.64)
     * @param secondsPerLiquidityOutside Seconds per unit liquidity from this tick outwards (UQ8.80)
     */
    struct Tick {
        uint96 liquidityLowerD8;
        uint96 liquidityUpperD8;
        int24 nextBelow;
        int24 nextAbove;
        uint80 feeGrowthOutside0; // UQ16.64
        uint80 feeGrowthOutside1; // UQ16.64
        uint96 secondsPerLiquidityOutside; // UQ8.88
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
