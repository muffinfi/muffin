// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IEngineGatedActions {
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
    function setDefaults(uint8 tickSpacing, uint8 protocolFee) external;

    /// @notice Update a tier's swap fee
    function setSqrtGamma(
        bytes32 poolId,
        uint8 tierId,
        uint24 sqrtGamma
    ) external;

    /// @notice Update a pool's % protocol fee
    /// @param protocolFee Numerator of the % protocol fee (denominator is 255)
    function setProtocolFee(bytes32 poolId, uint8 protocolFee) external;

    /// @notice Update a pool's tick spacing
    /// @dev Initialized ticks that are not multiples of the new tick spacing will be unable to be added liquidity.
    /// To prevent this UX issue, the new tickSpacing should better be a divisor of the old tickSpacing.
    function setTickSpacing(bytes32 poolId, uint8 tickSpacing) external;

    /// @notice Collect the protocol fee accrued
    function collectProtocolFee(address token, address recipient) external;
}
