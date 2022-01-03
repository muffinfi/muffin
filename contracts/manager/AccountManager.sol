// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "../interfaces/engine/IEngine.sol";
import "./base/ManagerBase.sol";

abstract contract AccountManager is ManagerBase {
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
    ) public {
        IEngine(engine).deposit(address(this), getAccId(recipient), token, amount, abi.encode(msg.sender));
    }

    function withdraw(
        address recipient,
        address token,
        uint256 amount
    ) public {
        IEngine(engine).withdraw(recipient, getAccId(msg.sender), token, amount);
    }
}
