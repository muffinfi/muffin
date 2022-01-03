// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.10;

/// @notice Constants shared accross contracts and libraries
/// @author Deliswap
library Constants {
    // Fixed-point precisions
    uint256 internal constant FEE_GROWTH_PRECISION = 0x10000000000000000;
    uint256 internal constant FEE_GROWTH_RESOLUTION = 64;
    uint256 internal constant SECONDS_PER_LIQUIDITY_RESOLUTION = 80;

    /// @dev Minimum tick spacing allowed. cannot never be larger than uint8
    int24 internal constant MIN_TICK_SPACING = 1;
    /// @dev Minimum tick, given min_tick_spacing = 1
    int24 internal constant MIN_TICK = -776363;
    /// @dev Maximum tick, given min_tick_spacing = 1
    int24 internal constant MAX_TICK = 776363;
    /// @dev Minimum sqrt price, i.e. TickMath.tickToSqrtP(MIN_TICK)
    uint128 internal constant MIN_SQRT_P = 65539;
    /// @dev Maximum sqrt price, i.e. TickMath.tickToSqrtP(MAX_TICK)
    uint128 internal constant MAX_SQRT_P = 340271175397327323250730767849398346765;
    /// @dev Maximum liquidityNet of a tick, i.e. type(uint128).max / ((MAX_TICK - MIN_TICK) / MIN_TICK_SPACING)
    int128 internal constant MAX_LIQUIDITY_NET = 219151586900031598275146167084062;

    /// @dev Base liquidity of a tier. User pays it when adding a new tier.
    uint128 internal constant BASE_LIQUIDITY = 10000;
    /// @dev Maxmium number of tiers per pool
    uint256 internal constant MAX_TIERS = 6;
}
