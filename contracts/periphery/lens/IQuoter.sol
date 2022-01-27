// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IQuoter {
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

    function quote(bytes memory path, int256 amountDesired)
        external
        view
        returns (
            uint256 amountIn,
            uint256 amountOut,
            uint256 gasUsed
        );
}
