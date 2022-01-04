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

import "hardhat/console.sol";

contract Engine is IEngine {
    using Math for uint128;
    using Pools for Pools.Pool;
    using Pools for mapping(bytes32 => Pools.Pool);
    using PathLib for bytes;

    address public governance;
    uint8 internal defaultTickSpacing = 200;
    uint8 internal defaultProtocolFee = 0;

    mapping(bytes32 => Pools.Pool) internal pools;
    mapping(address => mapping(bytes32 => uint256)) public accounts;
    mapping(address => uint256) public protocolFeeAmts;

    struct Tokens {
        address token0;
        address token1;
    }
    mapping(bytes32 => Tokens) public tokens;

    error InvalidTokenOrder();
    error InvalidSwapPath();
    error FailedBalanceOf();
    error NotEnoughToken();

    event GovernanceUpdated(address governance);

    constructor() {
        governance = msg.sender;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance);
        _;
    }

    /*===============================================================
     *                            UTILS
     *==============================================================*/

    function getBalance(address token) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
        if (!success || data.length < 32) revert FailedBalanceOf();
        return abi.decode(data, (uint256));
    }

    function getAccHash(address owner, uint256 accId) internal pure returns (bytes32) {
        require(accId != 0);
        return keccak256(abi.encode(owner, accId));
    }

    /*===============================================================
     *                           ACCOUNT
     *==============================================================*/

    /// @dev No reentrancy lock needed, since the contract collects tokens before adding into account
    function deposit(
        address recipient,
        uint256 recipientAccId,
        address token,
        uint256 amount,
        bytes calldata data
    ) external {
        uint256 balance0Before = getBalance(token);
        IEngineCallbacks(msg.sender).depositCallback(token, amount, data);
        if (getBalance(token) < balance0Before + amount) revert NotEnoughToken();

        accounts[token][getAccHash(recipient, recipientAccId)] += amount;
        emit Deposit(recipient, recipientAccId, token, amount);
    }

    /// @dev No reentrancy lock needed, since the contract updates account before sending out tokens
    function withdraw(
        address recipient,
        uint256 senderAccId,
        address token,
        uint256 amount
    ) external {
        accounts[token][getAccHash(msg.sender, senderAccId)] -= amount;
        SafeTransferLib.safeTransfer(token, recipient, amount);
        emit Withdraw(recipient, senderAccId, token, amount);
    }

    /*===============================================================
     *                        POOL SETTINGS
     *==============================================================*/

    // TODO: add callback but reentrancy problem???
    function createPool(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint128 sqrtPrice,
        uint256 senderAccId
    ) external {
        if (token0 >= token1 || token0 == address(0)) revert InvalidTokenOrder();

        (Pools.Pool storage pool, bytes32 poolId) = pools.getPoolAndId(token0, token1);
        (uint256 amount0, uint256 amount1) = pool.initialize(sqrtGamma, sqrtPrice, defaultTickSpacing, defaultProtocolFee);
        accounts[token0][getAccHash(msg.sender, senderAccId)] -= amount0;
        accounts[token1][getAccHash(msg.sender, senderAccId)] -= amount1;

        emit PoolCreated(token0, token1);
        emit UpdateTier(poolId, 0, sqrtGamma);
        pool.unlock();
        tokens[poolId] = Tokens(token0, token1);
    }

    function addTier(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint256 senderAccId
    ) external onlyGovernance {
        (Pools.Pool storage pool, bytes32 poolId) = pools.getPoolAndId(token0, token1);
        (uint256 amount0, uint256 amount1, uint8 tierId) = pool.addTier(sqrtGamma);
        accounts[token0][getAccHash(msg.sender, senderAccId)] -= amount0;
        accounts[token1][getAccHash(msg.sender, senderAccId)] -= amount1;

        emit UpdateTier(poolId, tierId, sqrtGamma);
        pool.unlock();
    }

    function setSqrtGamma(
        bytes32 poolId,
        uint8 tierId,
        uint24 sqrtGamma
    ) external onlyGovernance {
        pools[poolId].setSqrtGamma(tierId, sqrtGamma);
        emit UpdateTier(poolId, tierId, sqrtGamma);
    }

    function setTickSpacing(bytes32 poolId, uint8 tickSpacing) external onlyGovernance {
        pools[poolId].setTickSpacing(tickSpacing);
        emit UpdateTickSpacing(poolId, tickSpacing);
    }

    function setProtocolFee(bytes32 poolId, uint8 protocolFee) external onlyGovernance {
        pools[poolId].setProtocolFee(protocolFee);
        emit UpdateProtocolFee(poolId, protocolFee);
    }

    /*===============================================================
     *                          POSITIONS
     *==============================================================*/

    function mint(MintParams calldata p) external returns (uint256 amount0, uint256 amount1) {
        (Pools.Pool storage pool, bytes32 poolId) = pools.getPoolAndId(p.token0, p.token1);
        (amount0, amount1, , ) = pool.updateLiquidity(
            p.recipient,
            p.recipientAccId,
            p.tierId,
            p.tickLower,
            p.tickUpper,
            p.liquidity.toInt128(),
            false
        );

        if (p.senderAccId != 0) {
            bytes32 accHash = getAccHash(msg.sender, p.senderAccId);
            (accounts[p.token0][accHash], amount0) = Math.subUntilZero(accounts[p.token0][accHash], amount0);
            (accounts[p.token1][accHash], amount1) = Math.subUntilZero(accounts[p.token1][accHash], amount1);
        }
        if (amount0 != 0 || amount1 != 0) {
            uint256 balance0Before = getBalance(p.token0);
            uint256 balance1Before = getBalance(p.token1);
            IEngineCallbacks(msg.sender).mintCallback(p.token0, p.token1, amount0, amount1, p.data);
            if (getBalance(p.token0) < balance0Before + amount0) revert NotEnoughToken();
            if (getBalance(p.token1) < balance1Before + amount1) revert NotEnoughToken();
        }

        emit Mint(poolId, p.recipient, p.recipientAccId, p.tierId, p.tickLower, p.tickUpper, p.liquidity, amount0, amount1);
        pool.unlock();
    }

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
            p.accId,
            p.tierId,
            p.tickLower,
            p.tickUpper,
            -p.liquidity.toInt128(),
            p.collectAllFees
        );

        bytes32 accHash = getAccHash(msg.sender, p.accId);
        if (amount0 > 0) accounts[p.token0][accHash] += amount0 + feeAmount0;
        if (amount1 > 0) accounts[p.token1][accHash] += amount1 + feeAmount1;

        emit Burn(poolId, msg.sender, p.accId, p.tierId, p.tickLower, p.tickUpper, p.liquidity, amount0, amount1, feeAmount0, feeAmount1); // prettier-ignore
        pool.unlock();
    }

    /*===============================================================
     *                            SWAP
     *==============================================================*/

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired,
        address recipient,
        uint256 recipientAccId,
        uint256 senderAccId,
        bytes calldata data
    ) external returns (uint256 amountIn, uint256 amountOut) {
        Pools.Pool storage pool;
        (pool, , amountIn, amountOut) = _computeSwap(tokenIn, tokenOut, tierChoices, amountDesired, recipient);
        _transferSwap(tokenIn, tokenOut, amountIn, amountOut, recipient, recipientAccId, senderAccId, data);
        pool.unlock();
    }

    function swapHop(SwapHopParams calldata p) external returns (uint256 amountIn, uint256 amountOut) {
        bytes memory path = p.path;
        if (path.invalid()) revert InvalidSwapPath();

        bool exactIn = p.amountDesired > 0;
        bytes32[] memory poolIds = new bytes32[](path.hopCount());
        unchecked {
            int256 amtNext = p.amountDesired;
            for (uint256 i; i < poolIds.length; i++) {
                (address tokenIn, address tokenOut, uint256 tierChoices) = path.decodePool(i, exactIn);
                address recipient = (exactIn ? i == poolIds.length - 1 : i == 0) ? p.recipient : address(this);
                uint256 amtIn;
                uint256 amtOut;
                (, poolIds[i], amtIn, amtOut) = _computeSwap(tokenIn, tokenOut, tierChoices, amtNext, recipient);
                if (exactIn) {
                    if (i == 0) amountIn = amtIn;
                    amtNext = int256(amtOut);
                } else {
                    if (i == 0) amountOut = amtOut;
                    amtNext = -int256(amtIn);
                }
            }
            if (exactIn) {
                amountOut = uint256(amtNext);
            } else {
                amountIn = uint256(-amtNext);
            }
        }
        (address _tokenIn, address _tokenOut) = path.tokensInOut(exactIn);
        _transferSwap(_tokenIn, _tokenOut, amountIn, amountOut, p.recipient, p.recipientAccId, p.senderAccId, p.data);
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
            if (protocolFeeAmt != 0) protocolFeeAmts[tokenIn] += protocolFeeAmt;
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
        uint256 recipientAccId,
        uint256 senderAccId,
        bytes memory data
    ) internal {
        if (recipientAccId == 0) {
            SafeTransferLib.safeTransfer(tokenOut, recipient, amountOut);
        } else {
            accounts[tokenOut][getAccHash(recipient, recipientAccId)] += amountOut;
        }
        if (senderAccId != 0) {
            bytes32 accHash = getAccHash(msg.sender, senderAccId);
            (accounts[tokenIn][accHash], amountIn) = Math.subUntilZero(accounts[tokenIn][accHash], amountIn);
        }
        if (amountIn > 0) {
            uint256 balanceBefore = getBalance(tokenIn);
            IEngineCallbacks(msg.sender).swapCallback(tokenIn, tokenOut, amountIn, amountOut, data);
            if (getBalance(tokenIn) < balanceBefore + amountIn) revert NotEnoughToken();
        }
    }

    /*===============================================================
     *                          GOVERNANCE
     *==============================================================*/

    function collectProtocolFee(address token, address recipient) external onlyGovernance {
        uint256 amount = protocolFeeAmts[token] - 1;
        protocolFeeAmts[token] = 1;
        SafeTransferLib.safeTransfer(token, recipient, amount);
        emit CollectProtocol(recipient, token, amount);
    }

    function setGovernance(address _governance) external onlyGovernance {
        governance = _governance;
        emit GovernanceUpdated(_governance);
    }

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
        uint256 accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    )
        external
        view
        returns (
            uint80 feeGrowthInside0Last,
            uint80 feeGrowthInside1Last,
            uint128 liquidity
        )
    {
        Positions.Position memory pos = Positions.get(pools[poolId].positions, owner, accId, tierId, tickLower, tickUpper);
        return (pos.feeGrowthInside0Last, pos.feeGrowthInside1Last, pos.liquidity);
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
