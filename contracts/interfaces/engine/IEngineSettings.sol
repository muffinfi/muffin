// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IEngineSettings {
    function addTier(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint256 senderAccId
    ) external;

    function setSqrtGamma(
        bytes32 poolId,
        uint8 tierId,
        uint24 sqrtGamma
    ) external;

    function setProtocolFee(bytes32 poolId, uint8 protocolFee) external;

    function setTickSpacing(bytes32 poolId, uint8 tickSpacing) external;

    function collectProtocolFee(address token, address recipient) external;
}
