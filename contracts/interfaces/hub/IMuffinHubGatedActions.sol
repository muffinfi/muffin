// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IMuffinHubGatedActions {
    /// @notice                 Add a new tier to a pool
    /// @param token0           Address of token0 of the pool
    /// @param token1           Address of token1 of the pool
    /// @param sqrtGamma        Sqrt (1 - percentage swap fee) (precision: 1e5)
    /// @param senderAccRefId   Sender's account id, for paying the base liquidity
    function addTier(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint256 senderAccRefId
    ) external;

    /// @notice Update the governance address
    function setGovernance(address _governance) external;

    /// @notice Update pool's default tick spacing and protocol fee
    /// @param protocolFee Numerator of the % protocol fee (denominator is 255)
    function setDefaultParameters(uint8 tickSpacing, uint8 protocolFee) external;

    /// @notice Update pool's tick spacing and protocol fee
    /// @dev If setting a new tick spacing, the already initialized ticks that are not multiples of the new tick spacing
    /// will become unable to be added liquidity. To prevent this UX issue, the new tick spacing should better be a
    /// divisor of the old tick spacing.
    function setPoolParameters(
        bytes32 poolId,
        uint8 tickSpacing,
        uint8 protocolFee
    ) external;

    /// @notice Update a tier's swap fee and its tick spacing multiplier for limt orders
    function setTierParameters(
        bytes32 poolId,
        uint8 tierId,
        uint24 sqrtGamma,
        uint8 limitOrderTickSpacingMultiplier
    ) external;

    /// @notice Collect the protocol fee accrued
    function collectProtocolFee(address token, address recipient) external;
}
