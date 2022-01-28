// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

import "../../libraries/Positions.sol";

interface ILens {
    function hub() external view returns (address);

    function manager() external view returns (address);

    struct PositionInfo {
        address owner;
        address token0;
        address token1;
        uint8 tierId;
        int24 tickLower;
        int24 tickUpper;
    }

    function getPosition(uint256 tokenId)
        external
        view
        returns (PositionInfo memory info, Positions.Position memory position);

    function getDerivedPosition(uint256 tokenId)
        external
        view
        returns (
            PositionInfo memory info,
            Positions.Position memory position,
            uint256 feeAmount0,
            uint256 feeAmount1,
            bool settled
        );

    function getFeeAmounts(PositionInfo memory info, Positions.Position memory position)
        external
        view
        returns (uint256 feeAmount0, uint256 feeAmount1);

    function isSettled(PositionInfo memory info, Positions.Position memory position)
        external
        view
        returns (bool settled);
}
