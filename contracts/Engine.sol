// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./interfaces/engine/IEngine.sol";
import "./interfaces/IEngineCallbacks.sol";
import "./interfaces/common/IERC20.sol";
import "./libraries/utils/SafeTransferLib.sol";
import "./libraries/utils/PathLib.sol";
import "./libraries/math/Math.sol";
import "./libraries/Positions.sol";
import "./libraries/Pools.sol";

contract Engine is IEngine {
    using Math for uint96;
    using Math for uint256;
    using Pools for Pools.Pool;
    using Pools for mapping(bytes32 => Pools.Pool);
    using PathLib for bytes;

    struct TokenData {
        uint8 locked;
        uint248 protocolFeeAmt;
    }

    struct Pair {
        address token0;
        address token1;
    }

    address public governance;
    uint8 internal defaultTickSpacing = 200;
    uint8 internal defaultProtocolFee = 0;

    /// @dev Mapping of pools (keccak256(token0, token1) => Pool)
    mapping(bytes32 => Pools.Pool) internal pools;
    /// @dev Token balance in an user's account (token => keccak256(account owner, account id) => token balance)
    mapping(address => mapping(bytes32 => uint256)) public accounts;
    /// @dev Reentrancy lock for tokens and protocol accrued fees (token => TokenData)
    mapping(address => TokenData) public tokens;
    /// @dev Mapping of poolId to the pool's underlying tokens (for data lookup only)
    mapping(bytes32 => Pair) public underlyings;

    error InvalidTokenOrder();
    error InvalidSwapPath();
    error FailedBalanceOf();
    error NotEnoughToken();
    error NotEnoughIntermediateOutput();

    constructor() {
        governance = msg.sender;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance);
        _;
    }

    /// @dev Get token balance of this contract
    function getBalance(address token) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
        if (!success || data.length < 32) revert FailedBalanceOf();
        return abi.decode(data, (uint256));
    }

    /// @dev "Lock" the token so the token cannot be used again until unlock
    function getBalanceAndLock(address token) internal returns (uint256) {
        require(tokens[token].locked != 1); // 1 means locked
        tokens[token].locked = 1;
        return getBalance(token);
    }

    /// @dev "Unlock" the token after ensuring the contract reaches an expected balance
    function checkBalanceAndUnlock(address token, uint256 balanceMinimum) internal {
        if (getBalance(token) < balanceMinimum) revert NotEnoughToken();
        tokens[token].locked = 2;
    }

    /*===============================================================
     *                           ACCOUNT
     *==============================================================*/

    /// @dev Hash [owner, accRefId] as the key for the `accounts` mapping
    function getAccHash(address owner, uint256 accRefId) internal pure returns (bytes32) {
        require(accRefId != 0);
        return keccak256(abi.encode(owner, accRefId));
    }

    /// @inheritdoc IEngineActions
    function deposit(
        address recipient,
        uint256 recipientAccRefId,
        address token,
        uint256 amount,
        bytes calldata data
    ) external {
        uint256 balanceBefore = getBalanceAndLock(token);
        IEngineCallbacks(msg.sender).depositCallback(token, amount, data);
        checkBalanceAndUnlock(token, balanceBefore + amount);

        accounts[token][getAccHash(recipient, recipientAccRefId)] += amount;
        emit Deposit(recipient, recipientAccRefId, token, amount);
    }

    /// @inheritdoc IEngineActions
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
     *                        POOL SETTINGS
     *==============================================================*/

    /// @inheritdoc IEngineActions
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
        emit UpdateTier(poolId, 0, sqrtGamma);
        pool.unlock();
        underlyings[poolId] = Pair(token0, token1);
    }

    /// @inheritdoc IEngineSettings
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

        emit UpdateTier(poolId, tierId, sqrtGamma);
        pool.unlock();
    }

    /// @inheritdoc IEngineSettings
    function setSqrtGamma(
        bytes32 poolId,
        uint8 tierId,
        uint24 sqrtGamma
    ) external onlyGovernance {
        pools[poolId].setSqrtGamma(tierId, sqrtGamma);
        emit UpdateTier(poolId, tierId, sqrtGamma);
    }

    /// @inheritdoc IEngineSettings
    function setTickSpacing(bytes32 poolId, uint8 tickSpacing) external onlyGovernance {
        pools[poolId].setTickSpacing(tickSpacing);
        emit UpdateTickSpacing(poolId, tickSpacing);
    }

    /// @inheritdoc IEngineSettings
    function setProtocolFee(bytes32 poolId, uint8 protocolFee) external onlyGovernance {
        pools[poolId].setProtocolFee(protocolFee);
        emit UpdateProtocolFee(poolId, protocolFee);
    }

    /*===============================================================
     *                          POSITIONS
     *==============================================================*/

    /// @inheritdoc IEngineActions
    function mint(MintParams calldata p) external returns (uint256 amount0, uint256 amount1) {
        (Pools.Pool storage pool, bytes32 poolId) = pools.getPoolAndId(p.token0, p.token1);
        (amount0, amount1, , ) = pool.updateLiquidity(
            p.recipient,
            p.positionRefId,
            p.tierId,
            p.tickLower,
            p.tickUpper,
            p.liquidityD8.toInt96(),
            false
        );
        uint256 _amt0 = amount0;
        uint256 _amt1 = amount1;
        if (p.senderAccRefId != 0) {
            bytes32 accHash = getAccHash(msg.sender, p.senderAccRefId);
            (accounts[p.token0][accHash], _amt0) = accounts[p.token0][accHash].subUntilZero(_amt0);
            (accounts[p.token1][accHash], _amt1) = accounts[p.token1][accHash].subUntilZero(_amt1);
        }
        if (_amt0 != 0 || _amt1 != 0) {
            uint256 balance0Before = getBalanceAndLock(p.token0);
            uint256 balance1Before = getBalanceAndLock(p.token1);
            IEngineCallbacks(msg.sender).mintCallback(p.token0, p.token1, _amt0, _amt1, p.data);
            checkBalanceAndUnlock(p.token0, balance0Before + _amt0);
            checkBalanceAndUnlock(p.token1, balance1Before + _amt1);
        }
        emit Mint(poolId, p.recipient, p.positionRefId, p.tierId, p.tickLower, p.tickUpper, p.liquidityD8, amount0, amount1);
        pool.unlock();
    }

    /// @inheritdoc IEngineActions
    function burn(BurnParams calldata p)
        external
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 feeAmount0,
            uint256 feeAmount1
        )
    {
        (Pools.Pool storage pool, bytes32 poolId) = pools.getPoolAndId(p.token0, p.token1);
        (amount0, amount1, feeAmount0, feeAmount1) = pool.updateLiquidity(
            msg.sender,
            p.positionRefId,
            p.tierId,
            p.tickLower,
            p.tickUpper,
            -p.liquidityD8.toInt96(),
            p.collectAllFees
        );
        bytes32 accHash = getAccHash(msg.sender, p.accRefId);
        accounts[p.token0][accHash] += amount0 + feeAmount0;
        accounts[p.token1][accHash] += amount1 + feeAmount1;
        emit Burn(
            poolId,
            msg.sender,
            p.positionRefId,
            p.tierId,
            p.tickLower,
            p.tickUpper,
            p.liquidityD8,
            amount0,
            amount1,
            feeAmount0,
            feeAmount1
        );
        pool.unlock();
    }

    /*===============================================================
     *                            SWAP
     *==============================================================*/

    /// @inheritdoc IEngineActions
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

    /// @inheritdoc IEngineActions
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
            IEngineCallbacks(msg.sender).swapCallback(tokenIn, tokenOut, amountIn, amountOut, data);
            checkBalanceAndUnlock(tokenIn, balanceBefore + amountIn);
        }
    }

    /*===============================================================
     *                          GOVERNANCE
     *==============================================================*/

    /// @inheritdoc IEngineSettings
    function collectProtocolFee(address token, address recipient) external onlyGovernance {
        uint248 amount = tokens[token].protocolFeeAmt;
        tokens[token].protocolFeeAmt = 0;
        SafeTransferLib.safeTransfer(token, recipient, amount);
        emit CollectProtocol(recipient, token, amount);
    }

    /// @inheritdoc IEngineSettings
    function setGovernance(address _governance) external onlyGovernance {
        governance = _governance;
        emit GovernanceUpdated(_governance);
    }

    /// @inheritdoc IEngineSettings
    function setDefaults(uint8 tickSpacing, uint8 protocolFee) external onlyGovernance {
        defaultTickSpacing = tickSpacing;
        defaultProtocolFee = protocolFee;
    }

    /*===============================================================
     *                         VIEW FUNCTIONS
     *==============================================================*/

    function getDefaults() external view returns (uint8 tickSpacing, uint8 protocolFee) {
        return (defaultTickSpacing, defaultProtocolFee);
    }

    function getPoolBasics(bytes32 poolId) external view returns (uint8 tickSpacing, uint8 protocolFee) {
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

    function getPosition(
        bytes32 poolId,
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    )
        external
        view
        returns (
            uint96 liquidityD8,
            uint80 feeGrowthInside0Last,
            uint80 feeGrowthInside1Last
        )
    {
        Positions.Position storage pos = Positions.get(
            pools[poolId].positions,
            owner,
            positionRefId,
            tierId,
            tickLower,
            tickUpper
        );
        return (pos.liquidityD8, pos.feeGrowthInside0Last, pos.feeGrowthInside1Last);
    }

    function getTickMapBlockMap(bytes32 poolId, uint8 tierId) external view returns (uint256) {
        return pools[poolId].tickMaps[tierId].blockmap;
    }

    function getTickMapBlock(
        bytes32 poolId,
        uint8 tierId,
        uint256 blockIdx
    ) external view returns (uint256) {
        return pools[poolId].tickMaps[tierId].blocks[blockIdx];
    }

    function getTickMapWord(
        bytes32 poolId,
        uint8 tierId,
        uint256 wordIdx
    ) external view returns (uint256) {
        return pools[poolId].tickMaps[tierId].words[wordIdx];
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

    function getFeeGrowthInside(
        bytes32 poolId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint80 feeGrowthInside0, uint80 feeGrowthInside1) {
        return pools[poolId].getFeeGrowthInside(tierId, tickLower, tickUpper);
    }

    function getSecondsPerLiquidityInside(
        bytes32 poolId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint96 secondsPerLiquidityInside) {
        return pools[poolId].getSecondsPerLiquidityInside(tierId, tickLower, tickUpper);
    }
}
