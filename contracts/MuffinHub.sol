// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./interfaces/hub/IMuffinHub.sol";
import "./interfaces/IMuffinHubCallbacks.sol";
import "./libraries/utils/SafeTransferLib.sol";
import "./libraries/utils/PathLib.sol";
import "./libraries/math/Math.sol";
import "./libraries/Pools.sol";
import "./MuffinHubBase.sol";

contract MuffinHub is IMuffinHub, MuffinHubBase {
    using Math for uint256;
    using Pools for Pools.Pool;
    using Pools for mapping(bytes32 => Pools.Pool);
    using PathLib for bytes;

    error InvalidTokenOrder();
    error InvalidSwapPath();
    error NotEnoughIntermediateOutput();

    /// @dev To reduce bytecode size of this contract, we offload position-related codes and various view functions
    /// to a second contract (i.e. MuffinHubPositions.sol) and use delegatecall to call it.
    address internal immutable positionController;

    constructor(address _positionController) {
        positionController = _positionController;
        governance = msg.sender;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance);
        _;
    }

    /*===============================================================
     *                           ACCOUNTS
     *==============================================================*/

    /// @inheritdoc IMuffinHubActions
    function deposit(
        address recipient,
        uint256 recipientAccRefId,
        address token,
        uint256 amount,
        bytes calldata data
    ) external {
        uint256 balanceBefore = getBalanceAndLock(token);
        IMuffinHubCallbacks(msg.sender).depositCallback(token, amount, data);
        checkBalanceAndUnlock(token, balanceBefore + amount);

        accounts[token][getAccHash(recipient, recipientAccRefId)] += amount;
        emit Deposit(recipient, recipientAccRefId, token, amount);
    }

    /// @inheritdoc IMuffinHubActions
    function withdraw(
        address recipient,
        uint256 senderAccRefId,
        address token,
        uint256 amount
    ) external {
        accounts[token][getAccHash(msg.sender, senderAccRefId)] -= amount;
        SafeTransferLib.safeTransfer(token, recipient, amount);
        emit Withdraw(recipient, senderAccRefId, token, amount);
    }

    /*===============================================================
     *                      CREATE POOL / TIER
     *==============================================================*/

    /// @inheritdoc IMuffinHubActions
    function createPool(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint128 sqrtPrice,
        uint256 senderAccRefId
    ) external {
        if (token0 >= token1 || token0 == address(0)) revert InvalidTokenOrder();

        (Pools.Pool storage pool, bytes32 poolId) = pools.getPoolAndId(token0, token1);
        (uint256 amount0, uint256 amount1) = pool.initialize(sqrtGamma, sqrtPrice, defaultTickSpacing, defaultProtocolFee);
        accounts[token0][getAccHash(msg.sender, senderAccRefId)] -= amount0;
        accounts[token1][getAccHash(msg.sender, senderAccRefId)] -= amount1;

        emit PoolCreated(token0, token1);
        emit UpdateTier(poolId, 0, sqrtGamma, 0);
        pool.unlock();
        underlyings[poolId] = Pair(token0, token1);
    }

    /// @inheritdoc IMuffinHubGatedActions
    function addTier(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint256 senderAccRefId
    ) external onlyGovernance {
        (Pools.Pool storage pool, bytes32 poolId) = pools.getPoolAndId(token0, token1);
        (uint256 amount0, uint256 amount1, uint8 tierId) = pool.addTier(sqrtGamma);
        accounts[token0][getAccHash(msg.sender, senderAccRefId)] -= amount0;
        accounts[token1][getAccHash(msg.sender, senderAccRefId)] -= amount1;

        emit UpdateTier(poolId, tierId, sqrtGamma, 0);
        pool.unlock();
    }

    /*===============================================================
     *                            SWAP
     *==============================================================*/

    /// @inheritdoc IMuffinHubActions
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired,
        address recipient,
        uint256 recipientAccRefId,
        uint256 senderAccRefId,
        bytes calldata data
    ) external returns (uint256 amountIn, uint256 amountOut) {
        Pools.Pool storage pool;
        (pool, , amountIn, amountOut) = _computeSwap(tokenIn, tokenOut, tierChoices, amountDesired, recipient);
        _transferSwap(tokenIn, tokenOut, amountIn, amountOut, recipient, recipientAccRefId, senderAccRefId, data);
        pool.unlock();
    }

    /// @inheritdoc IMuffinHubActions
    function swapMultiHop(SwapMultiHopParams calldata p) external returns (uint256 amountIn, uint256 amountOut) {
        bytes memory path = p.path;
        if (path.invalid()) revert InvalidSwapPath();

        bool exactIn = p.amountDesired > 0;
        bytes32[] memory poolIds = new bytes32[](path.hopCount());
        unchecked {
            int256 amtDesired = p.amountDesired;
            for (uint256 i; i < poolIds.length; i++) {
                (address tokenIn, address tokenOut, uint256 tierChoices) = path.decodePool(i, exactIn);
                address recipient = (exactIn ? i == poolIds.length - 1 : i == 0) ? p.recipient : address(this);

                // For an "exact output" swap, it's possible to not receive the full desired output amount. therefore, in
                // the 2nd (and following) swaps, we request more token output so as to ensure we get enough tokens to pay
                // for the previous swap. The extra token is not refunded and thus results in a very small extra cost.
                uint256 amtIn;
                uint256 amtOut;
                (, poolIds[i], amtIn, amtOut) = _computeSwap(
                    tokenIn,
                    tokenOut,
                    tierChoices,
                    (exactIn || i == 0) ? amtDesired : amtDesired - Pools.SWAP_AMOUNT_TOLERANCE,
                    recipient
                );

                if (exactIn) {
                    if (i == 0) amountIn = amtIn;
                    amtDesired = int256(amtOut);
                } else {
                    if (i == 0) amountOut = amtOut;
                    else if (amtOut < uint256(-amtDesired)) revert NotEnoughIntermediateOutput();
                    amtDesired = -int256(amtIn);
                }
            }
            if (exactIn) {
                amountOut = uint256(amtDesired);
            } else {
                amountIn = uint256(-amtDesired);
            }
        }
        (address _tokenIn, address _tokenOut) = path.tokensInOut(exactIn);
        _transferSwap(_tokenIn, _tokenOut, amountIn, amountOut, p.recipient, p.recipientAccRefId, p.senderAccRefId, p.data);
        unchecked {
            for (uint256 i; i < poolIds.length; i++) pools[poolIds[i]].unlock();
        }
    }

    function _computeSwap(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired,
        address recipient
    )
        internal
        returns (
            Pools.Pool storage pool,
            bytes32 poolId,
            uint256 amountIn,
            uint256 amountOut
        )
    {
        (pool, poolId) = tokenIn < tokenOut ? pools.getPoolAndId(tokenIn, tokenOut) : pools.getPoolAndId(tokenOut, tokenIn);
        uint256 protocolFeeAmt;
        int256 amount0;
        int256 amount1;
        {
            uint256 amtInDistribution;
            uint256[] memory tierData;

            bool isToken0 = (amountDesired > 0) == (tokenIn < tokenOut); // i.e. isToken0In == isExactIn
            (amount0, amount1, protocolFeeAmt, amtInDistribution, tierData) = pool.swap(isToken0, amountDesired, tierChoices);
            if (!isToken0) (amount0, amount1) = (amount1, amount0);
            emit Swap(poolId, msg.sender, recipient, amount0, amount1, amtInDistribution, tierData);
        }
        unchecked {
            if (protocolFeeAmt != 0) tokens[tokenIn].protocolFeeAmt += uint248(protocolFeeAmt);
            (amountIn, amountOut) = tokenIn < tokenOut
                ? (uint256(amount0), uint256(-amount1))
                : (uint256(amount1), uint256(-amount0));
        }
    }

    function _transferSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient,
        uint256 recipientAccRefId,
        uint256 senderAccRefId,
        bytes memory data
    ) internal {
        if (tokenIn == tokenOut) {
            (amountIn, amountOut) = amountIn.subUntilZero(amountOut);
        }
        if (recipientAccRefId == 0) {
            SafeTransferLib.safeTransfer(tokenOut, recipient, amountOut);
        } else {
            accounts[tokenOut][getAccHash(recipient, recipientAccRefId)] += amountOut;
        }
        if (senderAccRefId != 0) {
            bytes32 accHash = getAccHash(msg.sender, senderAccRefId);
            (accounts[tokenIn][accHash], amountIn) = accounts[tokenIn][accHash].subUntilZero(amountIn);
        }
        if (amountIn > 0) {
            uint256 balanceBefore = getBalanceAndLock(tokenIn);
            IMuffinHubCallbacks(msg.sender).swapCallback(tokenIn, tokenOut, amountIn, amountOut, data);
            checkBalanceAndUnlock(tokenIn, balanceBefore + amountIn);
        }
    }

    /*===============================================================
     *                          GOVERNANCE
     *==============================================================*/

    /// @inheritdoc IMuffinHubGatedActions
    function setGovernance(address _governance) external onlyGovernance {
        governance = _governance;
        emit GovernanceUpdated(_governance);
    }

    /// @inheritdoc IMuffinHubGatedActions
    function setDefaultParameters(uint8 tickSpacing, uint8 protocolFee) external onlyGovernance {
        defaultTickSpacing = tickSpacing;
        defaultProtocolFee = protocolFee;
    }

    /// @inheritdoc IMuffinHubGatedActions
    function setPoolParameters(
        bytes32 poolId,
        uint8 tickSpacing,
        uint8 protocolFee
    ) external onlyGovernance {
        pools[poolId].setPoolParameters(tickSpacing, protocolFee);
        emit UpdatePool(poolId, tickSpacing, protocolFee);
    }

    /// @inheritdoc IMuffinHubGatedActions
    function setTierParameters(
        bytes32 poolId,
        uint8 tierId,
        uint24 sqrtGamma,
        uint8 limitOrderTickSpacingMultiplier
    ) external onlyGovernance {
        pools[poolId].setTierParameters(tierId, sqrtGamma, limitOrderTickSpacingMultiplier);
        emit UpdateTier(poolId, tierId, sqrtGamma, limitOrderTickSpacingMultiplier);
    }

    /// @inheritdoc IMuffinHubGatedActions
    function collectProtocolFee(address token, address recipient) external onlyGovernance {
        uint248 amount = tokens[token].protocolFeeAmt;
        tokens[token].protocolFeeAmt = 0;
        SafeTransferLib.safeTransfer(token, recipient, amount);
        emit CollectProtocol(recipient, token, amount);
    }

    /*===============================================================
     *                         VIEW FUNCTIONS
     *==============================================================*/

    function getDefaultParameters() external view returns (uint8 tickSpacing, uint8 protocolFee) {
        return (defaultTickSpacing, defaultProtocolFee);
    }

    function getPoolParameters(bytes32 poolId) external view returns (uint8 tickSpacing, uint8 protocolFee) {
        return (pools[poolId].tickSpacing, pools[poolId].protocolFee);
    }

    function getTier(bytes32 poolId, uint8 tierId) external view returns (Tiers.Tier memory) {
        return pools[poolId].tiers[tierId];
    }

    function getAllTiers(bytes32 poolId) external view returns (Tiers.Tier[] memory) {
        return pools[poolId].tiers;
    }

    function getTiersCount(bytes32 poolId) external view returns (uint256) {
        return pools[poolId].tiers.length;
    }

    function getTick(
        bytes32 poolId,
        uint8 tierId,
        int24 tick
    ) external view returns (Ticks.Tick memory) {
        return pools[poolId].ticks[tierId][tick];
    }

    function getTWAP(bytes32 poolId)
        external
        view
        returns (
            uint32 lastUpdate,
            int56 tickCumulative,
            int24 tickEma20,
            int24 tickEma40,
            uint96 secondsPerLiquidityCumulative
        )
    {
        Pools.Pool storage pool = pools[poolId];
        return (pool.tickLastUpdate, pool.tickCumulative, pool.tickEma20, pool.tickEma40, pool.secondsPerLiquidityCumulative);
    }

    function getLimitOrderTickSpacingMultipliers(bytes32 poolId) external view returns (uint8[6] memory) {
        return pools[poolId].limitOrderTickSpacingMultipliers;
    }

    /*===============================================================
     *                FALLBACK TO POSITION CONTROLLER
     *==============================================================*/

    /// @dev Adapted from openzepplin v4.4.1 proxy implementation
    fallback() external {
        address _positionController = positionController;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), _positionController, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
