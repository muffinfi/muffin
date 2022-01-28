// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.10;

import "../../interfaces/hub/positions/IMuffinHubPositions.sol";
import "./ILens.sol";

interface IPositionManager {
    function hub() external view returns (address);

    function getPosition(uint256 tokenId)
        external
        view
        returns (
            address owner,
            address token0,
            address token1,
            uint8 tierId,
            int24 tickLower,
            int24 tickUpper,
            Positions.Position memory position
        );
}

contract Lens is ILens {
    address public immutable hub;
    address public immutable manager;

    constructor(address _manager) {
        manager = _manager;
        hub = IPositionManager(_manager).hub();
    }

    function getPosition(uint256 tokenId)
        public
        view
        returns (PositionInfo memory info, Positions.Position memory position)
    {
        (
            info.owner,
            info.token0,
            info.token1,
            info.tierId,
            info.tickLower,
            info.tickUpper,
            position
        ) = IPositionManager(manager).getPosition(tokenId);
    }

    function getDerivedPosition(uint256 tokenId)
        external
        view
        returns (
            PositionInfo memory info,
            Positions.Position memory position,
            uint256 feeAmount0,
            uint256 feeAmount1,
            bool settled
        )
    {
        (info, position) = getPosition(tokenId);
        (feeAmount0, feeAmount1) = getFeeAmounts(info, position);
        settled = isSettled(info, position);
    }

    function getFeeAmounts(PositionInfo memory info, Positions.Position memory position)
        public
        view
        returns (uint256 feeAmount0, uint256 feeAmount1)
    {
        (uint80 feeGrowthInside0, uint80 feeGrowthInside1) = IMuffinHubPositions(hub).getPositionFeeGrowthInside(
            keccak256(abi.encode(info.token0, info.token1)),
            manager,
            uint256(uint160(info.owner)),
            info.tierId,
            info.tickLower,
            info.tickUpper
        );
        unchecked {
            feeAmount0 = (uint256(position.liquidityD8) * (feeGrowthInside0 - position.feeGrowthInside0Last)) >> 56;
            feeAmount1 = (uint256(position.liquidityD8) * (feeGrowthInside1 - position.feeGrowthInside1Last)) >> 56;
            position.feeGrowthInside0Last = feeGrowthInside0;
            position.feeGrowthInside1Last = feeGrowthInside1;
        }
    }

    function isSettled(PositionInfo memory info, Positions.Position memory position)
        public
        view
        returns (bool settled)
    {
        if (position.limitOrderType != Positions.NOT_LIMIT_ORDER) {
            bool zeroForOne = position.limitOrderType == Positions.ZERO_FOR_ONE;
            (, , uint32 nextSnapshotId) = IMuffinHubPositions(hub).getSettlement(
                keccak256(abi.encode(info.token0, info.token1)),
                info.tierId,
                zeroForOne ? info.tickUpper : info.tickLower,
                zeroForOne
            );
            settled = position.settlementSnapshotId < nextSnapshotId;
        }
    }
}
