// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./math/Math.sol";
import "./Constants.sol";

library Positions {
    struct Position {
        uint80 feeGrowthInside0Last; // UQ16.64
        uint80 feeGrowthInside1Last; // UQ16.64
        uint128 liquidity;
    }

    /**
     * @param positions The mapping of positions
     * @param owner     The position owner's address
     * @param accId     The position owner's account id
     * @param tierId    The tier index of the position
     * @param tickLower The lower tick boundary of the position
     * @param tickUpper The upper tick boundary of the position
     * @return position The position object
     */
    function get(
        mapping(bytes32 => Position) storage positions,
        address owner,
        uint256 accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) internal view returns (Position storage position) {
        position = positions[keccak256(abi.encodePacked(owner, accId, tierId, tickLower, tickUpper))];
    }

    /**
     * @notice Update position's liquidity and accrue fees
     * @dev When adding liquidity, feeGrowthInside{0,1} are updated so as to accrue fees without the need to transfer
     * them to owner's account. When removing partial liquidity, feeGrowthInside{0,1} are unchanged and partial fees are
     * transferred to owner's account proportionally to amount of liquidity removed.
     *
     * @param liquidityDelta    Amount of liquidity change in the position
     * @param feeGrowthInside0  Pool's current accumulated fee0 per unit of liquidity inside the position's price range
     * @param feeGrowthInside1  Pool's current accumulated fee1 per unit of liquidity inside the position's price range
     * @param collectAllFees    True to collect the position's all accrued fees
     * @return feeAmtOut0       Amount of fee0 to transfer to owner account (≤ 2^(128+80))
     * @return feeAmtOut1       Amount of fee1 to transfer to owner account (≤ 2^(128+80))
     */
    function update2(
        Position storage self,
        int128 liquidityDelta,
        uint80 feeGrowthInside0,
        uint80 feeGrowthInside1,
        bool collectAllFees
    ) internal returns (uint256 feeAmtOut0, uint256 feeAmtOut1) {
        // TODO: need test cases

        unchecked {
            uint128 liquidity = self.liquidity;
            uint128 liquidityNew = Math.addInt128(liquidity, liquidityDelta);
            uint80 feeGrowthDelta0 = feeGrowthInside0 - self.feeGrowthInside0Last;
            uint80 feeGrowthDelta1 = feeGrowthInside1 - self.feeGrowthInside1Last;

            if (collectAllFees) {
                feeAmtOut0 = (uint256(liquidity) * feeGrowthDelta0) / Constants.FEE_GROWTH_PRECISION;
                feeAmtOut1 = (uint256(liquidity) * feeGrowthDelta1) / Constants.FEE_GROWTH_PRECISION;
                self.feeGrowthInside0Last = feeGrowthInside0;
                self.feeGrowthInside1Last = feeGrowthInside1;
                self.liquidity = liquidityNew;
                //
            } else if (liquidityDelta > 0) {
                feeGrowthInside0 -= uint80((uint256(liquidity) * feeGrowthDelta0) / liquidityNew);
                feeGrowthInside1 -= uint80((uint256(liquidity) * feeGrowthDelta1) / liquidityNew);
                self.feeGrowthInside0Last = feeGrowthInside0;
                self.feeGrowthInside1Last = feeGrowthInside1;
                self.liquidity = liquidityNew;
                //
            } else if (liquidityDelta < 0) {
                feeAmtOut0 = (uint256(uint128(-liquidityDelta)) * feeGrowthDelta0) / Constants.FEE_GROWTH_PRECISION;
                feeAmtOut1 = (uint256(uint128(-liquidityDelta)) * feeGrowthDelta1) / Constants.FEE_GROWTH_PRECISION;
                self.liquidity = liquidityNew;
            }
        }
    }
}
