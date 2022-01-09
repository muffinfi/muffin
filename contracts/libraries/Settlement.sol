// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./Ticks.sol";
import "./Positions.sol";

library Settlement {
    /// @notice             Info for settling limit orders that end at this tick
    /// @param liquidityD8  Amount of liquidity to remove
    /// @param tickSpacing  Tick spacing of the limit orders
    /// @param snapshotId   Id of the next data snapshot
    /// @param snapshots    Array of data snapshots
    struct Info {
        uint96 liquidityD8;
        uint8 tickSpacing;
        uint32 snapshotId;
        mapping(uint32 => Snapshot) snapshots;
    }

    /// @notice Data snapshot during settlement
    struct Snapshot {
        uint80 feeGrowthInside0;
        uint80 feeGrowthInside1;
        uint96 secondsPerLiquidityInside;
    }

    /// @notice                 Update the amount of liquidity to be settled, given a position's lower and upper tick boundary and position type
    /// @param lower            Lower tick boundary of the position
    /// @param upper            Upper tick boundary of the position
    /// @param positionType     Type of the limit order of the position (i.e. token0 or token1)
    /// @param liquidityDeltaD8 Change of the amount of liquidity to be settled
    /// @param isAdd            True if the change is positive
    /// @param poolTickSpacing  Default tick spacing of limit order
    /// @return snapshotId      Settlement's current snapshot id
    /// @return tickSpacing     Settlement's current tick spacing
    function update(
        Ticks.Tick storage lower,
        Ticks.Tick storage upper,
        uint8 positionType,
        uint96 liquidityDeltaD8,
        bool isAdd,
        uint8 poolTickSpacing
    ) internal returns (uint32 snapshotId, uint8 tickSpacing) {
        assert(positionType != Positions.NORMAL);
        Info storage settlement = positionType == Positions.TOKEN0_LIMIT ? lower.settlement0 : upper.settlement1;

        // update the amount of liquidity to settle (i.e. remove)
        settlement.liquidityD8 = isAdd
            ? settlement.liquidityD8 + liquidityDeltaD8
            : settlement.liquidityD8 - liquidityDeltaD8;

        // initialize settlement if it's the first limit order at this tick
        if (settlement.tickSpacing == 0) {
            settlement.tickSpacing = poolTickSpacing;
            settlement.snapshots[settlement.snapshotId] = Snapshot(0, 0, 1); // pre-fill to reduce SSTORE gas during swap
        }

        // if no need to settle, clear tick spacing so as to set a latest one next time
        bool emptied = settlement.liquidityD8 == 0;
        if (emptied) settlement.tickSpacing = 0;

        // update "needSettle" flag in tick state
        if (positionType == Positions.TOKEN0_LIMIT) {
            lower.needSettle0 = !emptied;
        } else {
            upper.needSettle1 = !emptied;
        }

        // return data useful for validating position
        snapshotId = settlement.snapshotId;
        tickSpacing = settlement.tickSpacing;
    }

    /// @dev Bridging function to sidestep "stack too deep" problem
    function update(
        Ticks.Tick storage lower,
        Ticks.Tick storage upper,
        uint8 positionType,
        int96 liquidityDeltaD8,
        uint8 poolTickSpacing
    ) internal returns (uint32 snapshotId) {
        unchecked {
            (snapshotId, ) = update(
                lower,
                upper,
                positionType,
                uint96(liquidityDeltaD8 < 0 ? -liquidityDeltaD8 : liquidityDeltaD8),
                liquidityDeltaD8 > 0,
                poolTickSpacing
            );
        }
    }

    /// @notice Get data snapshot if position is a setteld limit order
    function getSnapshotIfSettled(
        Positions.Position storage position,
        Ticks.Tick storage lower,
        Ticks.Tick storage upper
    ) internal view returns (bool settled, Settlement.Snapshot memory snapshot) {
        if (position.positionType != Positions.NORMAL) {
            Settlement.Info storage settlement = position.positionType == Positions.TOKEN0_LIMIT
                ? lower.settlement0
                : upper.settlement1;

            if (settlement.snapshotId > position.settlementSnapshotId) {
                settled = true;
                snapshot = settlement.snapshots[position.settlementSnapshotId];
            }
        }
    }
}
