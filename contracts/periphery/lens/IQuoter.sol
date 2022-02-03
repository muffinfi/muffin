// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IQuoter {
    function hub() external view returns (address);

    function quoteSingle(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired
    )
        external
        view
        returns (
            uint256 amountIn,
            uint256 amountOut,
            uint256 gasUsed
        );

    function quote(bytes calldata path, int256 amountDesired)
        external
        view
        returns (
            uint256 amountIn,
            uint256 amountOut,
            uint256 gasUsed
        );

    struct Hop {
        uint256 amountIn;
        uint256 amountOut;
        uint256 protocolFeeAmt;
        uint256[] tierAmountsIn;
        uint256[] tierData;
    }

    function simulateSingle(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired
    ) external view returns (Hop memory hop);

    function simulate(bytes calldata path, int256 amountDesired)
        external
        view
        returns (
            uint256 amountIn,
            uint256 amountOut,
            Hop[] memory hops
        );
}
