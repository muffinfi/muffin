// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

contract MockERC20 is ERC20, ERC20Permit {
    uint8 internal _decimals = 18;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) ERC20Permit(name) {}

    function setDecimals(uint8 __decimals) public {
        _decimals = __decimals;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(uint256 amount) public {
        _mint(msg.sender, amount);
    }

    function mintTo(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function setBalance(address owner, uint256 amount) public {
        _burn(owner, balanceOf(owner));
        _mint(owner, amount);
    }
}
