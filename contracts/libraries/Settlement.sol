// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./Tiers.sol";
import "./Ticks.sol";
import "./TickMaps.sol";
import "./Positions.sol";

library Settlement {
    using TickMaps for TickMaps.TickMap;

    /**
     * @notice              Data for settling single-sided positions (i.e. filled limit orders)
     * @param liquidityD8   Amount of liquidity to remove
     * @param tickSpacing   Tick spacing of the limit orders
     * @param snapshotId    Next data snapshot id
     * @param snapshots     Array of data snapshots
     */
    struct Info {
        uint96 liquidityD8;
        uint8 tickSpacing;
        uint32 nextSnapshotId;
        mapping(uint32 => Snapshot) snapshots;
    }

    /// @notice Snapshot of the data inside the tick range of the settling positions
    struct Snapshot {
        uint80 feeGrowthInside0;
        uint80 feeGrowthInside1;
        uint96 secondsPerLiquidityInside;
    }

    /**
     * @notice Update the amount of liquidity pending to be settled on a tick, given the lower and upper tick
     * boundaries of a limit-order position.
     * @param ticks             Mapping of ticks of the tier which the position is in
     * @param tickLower         Lower tick boundary of the position
     * @param tickUpper         Upper tick boundary of the position
     * @param limitOrderType    Direction of the limit order (i.e. token0 or token1)
     * @param liquidityDeltaD8  Change of the amount of liquidity to be settled
     * @param isAdd             True if the change is additive
     * @param poolTickSpacing   Default tick spacing of limit orders
     * @return nextSnapshotId   Settlement's next snapshot id
     * @return tickSpacing      Tick spacing of the limit orders pending to be settled
     */
    function update(
        mapping(int24 => Ticks.Tick) storage ticks,
        int24 tickLower,
        int24 tickUpper,
        uint8 limitOrderType,
        uint96 liquidityDeltaD8,
        bool isAdd,
        uint8 poolTickSpacing
    ) internal returns (uint32 nextSnapshotId, uint8 tickSpacing) {
        assert(limitOrderType != Positions.NOT_LIMIT_ORDER);

        Info storage settlement = limitOrderType == Positions.ZERO_FOR_ONE
            ? ticks[tickUpper].settlement1
            : ticks[tickLower].settlement0;

        // update the amount of liquidity to settle
        settlement.liquidityD8 = isAdd
            ? settlement.liquidityD8 + liquidityDeltaD8
            : settlement.liquidityD8 - liquidityDeltaD8;

        // initialize settlement if it's the first limit order at this tick
        if (settlement.tickSpacing == 0) {
            settlement.tickSpacing = poolTickSpacing;
            settlement.snapshots[settlement.nextSnapshotId] = Snapshot(0, 0, 1); // pre-fill to reduce SSTORE gas during swap
        }

        // if no liqudity to settle, clear tick spacing so as to set a latest one next time
        bool isEmpty = settlement.liquidityD8 == 0;
        if (isEmpty) settlement.tickSpacing = 0;

        // update "needSettle" flag in tick state
        if (limitOrderType == Positions.ONE_FOR_ZERO) {
            ticks[tickLower].needSettle0 = !isEmpty;
        } else {
            ticks[tickUpper].needSettle1 = !isEmpty;
        }

        // return data for validating position's settling status
        nextSnapshotId = settlement.nextSnapshotId;
        tickSpacing = settlement.tickSpacing;
    }

    /// @dev Bridging function to sidestep "stack too deep" problem
    function update(
        mapping(int24 => Ticks.Tick) storage ticks,
        int24 tickLower,
        int24 tickUpper,
        uint8 limitOrderType,
        int96 liquidityDeltaD8,
        uint8 poolTickSpacing
    ) internal returns (uint32 nextSnapshotId) {
        unchecked {
            (nextSnapshotId, ) = update(
                ticks,
                tickLower,
                tickUpper,
                limitOrderType,
                uint96(liquidityDeltaD8 < 0 ? -liquidityDeltaD8 : liquidityDeltaD8),
                liquidityDeltaD8 > 0,
                poolTickSpacing
            );
        }
    }

    /**
     * @notice Settle single-sided positions (i.e. filled limit order) that ends at this tick `tickEnd` which is just
     * being crossed during a swap. This'll update the settlement state and a tick state, and possibly tickmap.
     * @param ticks         Mapping of ticks of a tier
     * @param tickMap       Tick bitmap of a tier
     * @param tier          Latest tier data (in memory) currently used in the swap
     * @param tickEnd       Ending tick of the limit orders, i.e. the tick just being crossed in the swap
     * @param zeroForOne    The direction of the ongoing swap
     */
    function settle(
        mapping(int24 => Ticks.Tick) storage ticks,
        TickMaps.TickMap storage tickMap,
        Tiers.Tier memory tier,
        int24 tickEnd,
        bool zeroForOne
    ) internal {
        Info storage settlement;
        int24 tickStart; // i.e. the starting tick of the limit orders
        Ticks.Tick storage start;
        Ticks.Tick storage end = ticks[tickEnd];

        unchecked {
            if (zeroForOne) {
                settlement = end.settlement0;
                tickStart = tickEnd + int24(uint24(settlement.tickSpacing));
                start = ticks[tickStart];

                // remove liquidity changes on ticks (effect)
                start.liquidityUpperD8 -= settlement.liquidityD8;
                end.liquidityLowerD8 -= settlement.liquidityD8;
                end.needSettle0 = false;
            } else {
                settlement = end.settlement1;
                tickStart = tickEnd - int24(uint24(settlement.tickSpacing));
                start = ticks[tickStart];

                // remove liquidity changes on ticks (effect)
                start.liquidityLowerD8 -= settlement.liquidityD8;
                end.liquidityUpperD8 -= settlement.liquidityD8;
                end.needSettle1 = false;
            }

            // snapshot data inside the tick range (effect)
            settlement.snapshots[settlement.nextSnapshotId] = Settlement.Snapshot(
                end.feeGrowthOutside0 - start.feeGrowthOutside0,
                end.feeGrowthOutside1 - start.feeGrowthOutside1,
                end.secondsPerLiquidityOutside - start.secondsPerLiquidityOutside
            );
        }

        // reset settlement state since it's finished (effect)
        settlement.nextSnapshotId++;
        settlement.tickSpacing = 0;
        settlement.liquidityD8 = 0;

        // delete the starting tick if empty (effect)
        if (start.liquidityLowerD8 == 0 && start.liquidityUpperD8 == 0) {
            int24 below = start.nextBelow;
            int24 above = start.nextAbove;
            ticks[below].nextAbove = above;
            ticks[above].nextBelow = below;
            delete ticks[tickStart];
            tickMap.unset(tickStart);
        }

        // delete the ending tick if empty (effect), and update tier's next ticks (locally)
        if (end.liquidityLowerD8 == 0 && end.liquidityUpperD8 == 0) {
            int24 below = end.nextBelow;
            int24 above = end.nextAbove;
            ticks[below].nextAbove = above;
            ticks[above].nextBelow = below;
            delete ticks[tickEnd];
            tickMap.unset(tickEnd);

            tier.nextTickBelow = below;
            tier.nextTickAbove = above;
        }
    }

    /// @notice Get data snapshot if the position is a settled limit order
    function getSnapshotIfSettled(
        Positions.Position storage position,
        Ticks.Tick storage lower,
        Ticks.Tick storage upper
    ) internal view returns (bool settled, Settlement.Snapshot memory snapshot) {
        if (position.limitOrderType != Positions.NOT_LIMIT_ORDER) {
            Info storage settlement = position.limitOrderType == Positions.ZERO_FOR_ONE
                ? upper.settlement1
                : lower.settlement0;

            if (position.settlementSnapshotId < settlement.nextSnapshotId) {
                settled = true;
                snapshot = settlement.snapshots[position.settlementSnapshotId];
            }
        }
    }
}
