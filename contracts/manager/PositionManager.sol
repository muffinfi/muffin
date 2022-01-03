// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "../interfaces/engine/IEngine.sol";
import "../libraries/math/PoolMath.sol";
import "../libraries/math/TickMath.sol";
import "../libraries/math/Math.sol";
import "../libraries/Constants.sol";
import "./base/ManagerBase.sol";
import "./base/ERC721Extended.sol";
import "./AccountManager.sol";

abstract contract PositionManager is ManagerBase, AccountManager, ERC721Extended {
    struct Pair {
        address token0;
        address token1;
    }

    struct PositionInfo {
        address owner;
        uint24 poolNum;
        uint8 tierId;
        int24 tickLower;
        int24 tickUpper;
        uint16 _ownedTokenIndex; // for token enumerability if info is tokenized
    }

    uint24 internal nextPoolNum = 1;
    mapping(bytes32 => uint24) internal poolNums;
    mapping(uint24 => Pair) internal pairs;
    mapping(uint256 => PositionInfo) public positions;

    constructor() ERC721Extended("Deliswap Position", "DELI-POS") {}

    modifier checkApproved(uint256 tokenId) {
        _checkApproved(tokenId);
        _;
    }

    function _checkApproved(uint256 tokenId) internal view {
        require(
            msg.sender == positions[tokenId].owner || (_exists(tokenId) && msg.sender == getApproved(tokenId)),
            "NOT_APPROVED"
        );
    }

    function getPoolNum(address token0, address token1) internal returns (uint24 poolNum) {
        bytes32 poolId = keccak256(abi.encode(token0, token1));
        poolNum = poolNums[poolId];
        if (poolNum == 0) {
            poolNums[poolId] = (poolNum = nextPoolNum++);
            pairs[poolNum] = Pair(token0, token1);
        }
    }

    /*===============================================================
     *                         CREATE POOL
     *==============================================================*/

    function createPool(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint128 sqrtPrice
    ) external {
        (uint8 tickSpacing, ) = IEngine(engine).getPoolBasics(keccak256(abi.encode(token0, token1)));
        if (tickSpacing == 0) {
            deposit(msg.sender, token0, UnsafeMath.ceilDiv(uint256(Constants.BASE_LIQUIDITY) << 72, sqrtPrice));
            deposit(msg.sender, token1, UnsafeMath.ceilDiv(uint256(Constants.BASE_LIQUIDITY) * sqrtPrice, 1 << 72));
            IEngine(engine).createPool(token0, token1, sqrtGamma, sqrtPrice, getAccId(msg.sender));
        }
        getPoolNum(token0, token1);
    }

    /*===============================================================
     *                        ADD LIQUIDITY
     *==============================================================*/

    struct MintParams {
        address token0;
        address token1;
        uint8 tierId;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        bool useAccount;
        bool tokenized;
    }

    function mint(MintParams calldata params)
        external
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        tokenId = nextTokenId++;
        if (params.tokenized) _mint(params.recipient, tokenId);
        positions[tokenId] = PositionInfo({
            owner: params.recipient,
            poolNum: getPoolNum(params.token0, params.token1),
            tierId: params.tierId,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            _ownedTokenIndex: 0
        });

        (liquidity, amount0, amount1) = _addLiquidity(
            params.token0,
            params.token1,
            params.tierId,
            params.tickLower,
            params.tickUpper,
            params.recipient,
            params.amount0Desired,
            params.amount1Desired,
            params.useAccount
        );
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "Price slippage");
    }

    struct AddLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        bool useAccount;
    }

    function addLiquidity(AddLiquidityParams calldata params)
        external
        checkApproved(params.tokenId)
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        PositionInfo memory info = positions[params.tokenId];
        Pair memory pair = pairs[info.poolNum];
        (liquidity, amount0, amount1) = _addLiquidity(
            pair.token0,
            pair.token1,
            info.tierId,
            info.tickLower,
            info.tickUpper,
            info.owner,
            params.amount0Desired,
            params.amount1Desired,
            params.useAccount
        );
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "Price slippage");
    }

    function _addLiquidity(
        address token0,
        address token1,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        address recipient,
        uint256 amount0Desired,
        uint256 amount1Desired,
        bool useAccount
    )
        public
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        liquidity = PoolMath.calcLiquidityForAmts(
            IEngine(engine).getTier(keccak256(abi.encode(token0, token1)), tierId).sqrtPrice,
            TickMath.tickToSqrtP(tickLower),
            TickMath.tickToSqrtP(tickUpper),
            amount0Desired,
            amount1Desired
        );
        (amount0, amount1) = IEngine(engine).mint(
            IEngineActions.MintParams({
                token0: token0,
                token1: token1,
                tierId: tierId,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidity: liquidity,
                recipient: address(this),
                recipientAccId: getAccId(recipient),
                senderAccId: useAccount ? getAccId(msg.sender) : 0,
                data: useAccount ? new bytes(0) : abi.encode(msg.sender)
            })
        );
    }

    /*===============================================================
     *                       REMOVE LIQUIDITY
     *==============================================================*/

    struct RemoveLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        address withdrawTo;
        bool collectAllFees;
    }

    function removeLiquidity(RemoveLiquidityParams calldata params)
        external
        checkApproved(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        PositionInfo memory info = positions[params.tokenId];
        Pair memory pair = pairs[info.poolNum];
        (amount0, amount1) = IEngine(engine).burn(
            IEngineActions.BurnParams({
                token0: pair.token0,
                token1: pair.token1,
                tierId: info.tierId,
                tickLower: info.tickLower,
                tickUpper: info.tickUpper,
                liquidity: params.liquidity,
                accId: getAccId(msg.sender),
                collectAllFees: params.collectAllFees
            })
        );
        if (params.withdrawTo != address(0)) {
            if (amount0 > 0) withdraw(params.withdrawTo, pair.token0, amount0);
            if (amount1 > 0) withdraw(params.withdrawTo, pair.token1, amount1);
        }
    }

    /*===============================================================
     *                          BURN NFT
     *==============================================================*/

    function burn(uint256 tokenId) external {
        require(msg.sender == positions[tokenId].owner, "NOT_OWNER");
        require(_exists(tokenId), "NOT_TOKENIZED");

        PositionInfo memory info = positions[tokenId];
        Pair memory pair = pairs[info.poolNum];
        bytes32 poolId = keccak256(abi.encode(pair.token0, pair.token1));
        uint128 liquidity = IEngine(engine)
            .getPosition(poolId, info.owner, getAccId(msg.sender), info.tierId, info.tickLower, info.tickUpper)
            .liquidity;

        require(liquidity == 0, "NOT_EMPTY");
        delete positions[tokenId];
        _burn(tokenId);
    }

    /*===============================================================
     *                       VIEW FUNCTIONS
     *==============================================================*/

    function getPosition(uint256 tokenId) external view returns (Positions.Position memory) {
        // TODO:
    }

    /*===============================================================
     *            OVERRIDE FOR ERC721 and ERC721Extended
     *==============================================================*/

    function _getOwner(uint256 tokenId) internal view override returns (address owner) {
        owner = positions[tokenId].owner;
    }

    function _setOwner(uint256 tokenId, address owner) internal override {
        positions[tokenId].owner = owner;
    }

    function _getOwnedTokenIndex(uint256 tokenId) internal view override returns (uint256 index) {
        index = uint256(positions[tokenId]._ownedTokenIndex);
    }

    function _setOwnedTokenIndex(uint256 tokenId, uint256 index) internal override {
        require(index <= type(uint16).max);
        positions[tokenId]._ownedTokenIndex = uint16(index);
    }
}
