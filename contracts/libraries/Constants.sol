// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

/// @notice Constants shared accross contracts and libraries
/// @author Deliswap
library Constants {
    /// @dev Minimum tick spacing allowed. cannot never be larger than uint8
    int24 internal constant MIN_TICK_SPACING = 1;
    /// @dev Minimum tick, given min_tick_spacing = 1
    int24 internal constant MIN_TICK = -776363;
    /// @dev Maximum tick, given min_tick_spacing = 1
    int24 internal constant MAX_TICK = 776363;
    /// @dev Minimum sqrt price, i.e. TickMath.tickToSqrtPrice(MIN_TICK)
    uint128 internal constant MIN_SQRT_P = 65539;
    /// @dev Maximum sqrt price, i.e. TickMath.tickToSqrtPrice(MAX_TICK)
    uint128 internal constant MAX_SQRT_P = 340271175397327323250730767849398346765;

    /// @dev Base liquidity of a tier, scaled down 2^8. User pays it when adding a new tier.
    uint96 internal constant BASE_LIQUIDITY_D8 = 100;
}
