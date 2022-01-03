// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "../../interfaces/common/IWETH.sol";
import "../../interfaces/engine/IEngine.sol";
import "../../libraries/utils/SafeTransferLib.sol";

contract ManagerBase {
    address public immutable WETH9;
    address public immutable engine;
    bool private unlocked = true;

    constructor(address _engine, address _WETH9) {
        engine = _engine;
        WETH9 = _WETH9;
    }

    modifier locked() {
        require(unlocked);
        unlocked = false;
        _;
        unlocked = true;
    }

    modifier fromEngine() {
        require(msg.sender == engine);
        _;
    }

    function getAccId(address user) internal pure returns (uint256 accId) {
        accId = uint256(uint160(user));
    }

    /*===============================================================
     *                          ACCOUNTS
     *==============================================================*/

    function depositCallback(
        address token,
        uint256 amount,
        bytes calldata data
    ) external fromEngine {
        if (amount > 0) pay(token, abi.decode(data, (address)), amount);
    }

    function deposit(
        address recipient,
        address token,
        uint256 amount
    ) public payable {
        IEngine(engine).deposit(address(this), getAccId(recipient), token, amount, abi.encode(msg.sender));
    }

    function withdraw(
        address recipient,
        address token,
        uint256 amount
    ) public {
        IEngine(engine).withdraw(recipient, getAccId(msg.sender), token, amount);
    }

    /*===============================================================
     *                        PAYMENT UTILS
     *==============================================================*/

    function pay(
        address token,
        address payer,
        uint256 amount
    ) internal {
        if (token == WETH9 && address(this).balance >= amount) {
            // pay with WETH9
            IWETH(WETH9).deposit{value: amount}(); // wrap only what is needed to pay
            IWETH(WETH9).transfer(engine, amount);
        } else if (payer == address(this)) {
            // pay with tokens already in the contract (for the exact input multihop case)
            SafeTransferLib.safeTransfer(token, engine, amount);
        } else {
            // pull payment
            SafeTransferLib.safeTransferFrom(token, payer, engine, amount);
        }
    }

    /*===============================================================
     *                  ETH TRANSFER (FOR MULTICALL)
     *==============================================================*/

    /// @notice Unwraps the contract's WETH balance and sends it to recipient as ETH.
    /// @dev The amountMinimum parameter prevents malicious contracts from stealing WETH from users.
    function unwrapWETH(uint256 amountMinimum, address recipient) external {
        uint256 balanceWETH = IWETH(WETH9).balanceOf(address(this));
        require(balanceWETH >= amountMinimum, "Insufficient WETH");

        if (balanceWETH > 0) {
            IWETH(WETH9).withdraw(balanceWETH);
            SafeTransferLib.safeTransferETH(recipient, balanceWETH);
        }
    }

    /// @notice Refunds any ETH balance held by this contract to the `msg.sender`
    /// @dev Useful for bundling with mint or increase liquidity that uses ether, or exact output swaps
    /// that use ether for the input amount
    function refundETH() external payable {
        if (address(this).balance > 0) SafeTransferLib.safeTransferETH(msg.sender, address(this).balance);
    }

    receive() external payable {
        require(msg.sender == WETH9);
    }
}
