// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./interfaces/hub/IMuffinHubBase.sol";
import "./interfaces/common/IERC20.sol";
import "./libraries/Pools.sol";

abstract contract MuffinHubBase is IMuffinHubBase {
    error FailedBalanceOf();
    error NotEnoughTokenInput();

    struct TokenData {
        uint8 locked;
        uint248 protocolFeeAmt;
    }

    struct Pair {
        address token0;
        address token1;
    }

    /// @inheritdoc IMuffinHubBase
    address public governance;
    /// @dev Default tick spacing of new pool
    uint8 internal defaultTickSpacing = 200;
    /// @dev Default protocl fee of new pool (base 255)
    uint8 internal defaultProtocolFee = 0;

    /// @dev Mapping of poolId to pool state
    mapping(bytes32 => Pools.Pool) internal pools;
    /// @inheritdoc IMuffinHubBase
    mapping(address => mapping(bytes32 => uint256)) public accounts;
    /// @inheritdoc IMuffinHubBase
    mapping(address => TokenData) public tokens;
    /// @inheritdoc IMuffinHubBase
    mapping(bytes32 => Pair) public underlyings;

    /// @dev Get token balance of this contract
    function getBalance(address token) private view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
        if (!success || data.length < 32) revert FailedBalanceOf();
        return abi.decode(data, (uint256));
    }

    /// @dev "Lock" the token so the token cannot be used as input token again until unlocked
    function getBalanceAndLock(address token) internal returns (uint256) {
        require(tokens[token].locked != 1); // 1 means locked
        tokens[token].locked = 1;
        return getBalance(token);
    }

    /// @dev "Unlock" the token after ensuring the contract reaches an expected token balance
    function checkBalanceAndUnlock(address token, uint256 balanceMinimum) internal {
        if (getBalance(token) < balanceMinimum) revert NotEnoughTokenInput();
        tokens[token].locked = 2;
    }

    /// @dev Hash (owner, accRefId) as the key for the internal account
    function getAccHash(address owner, uint256 accRefId) internal pure returns (bytes32) {
        require(accRefId != 0);
        return keccak256(abi.encode(owner, accRefId));
    }
}
