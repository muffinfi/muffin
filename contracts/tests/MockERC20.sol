// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

contract MockERC20 is ERC20, ERC20Permit {
    uint8 internal _decimals = 18;

    address public owner;
    uint256 public maxMintAmount;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) ERC20Permit(name) {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY OWNER");
        _;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function setDecimals(uint8 __decimals) public onlyOwner {
        _decimals = __decimals;
    }

    modifier checkMintAmount(uint256 amount) {
        require(msg.sender == owner || maxMintAmount == 0 || amount <= maxMintAmount, "MINT AMOUNT");
        _;
    }

    function mint(uint256 amount) public checkMintAmount(amount) {
        _mint(msg.sender, amount);
    }

    function mintTo(address to, uint256 amount) public checkMintAmount(amount) {
        _mint(to, amount);
    }

    function setBalance(address account, uint256 amount) public onlyOwner {
        _burn(account, balanceOf(account));
        _mint(account, amount);
    }
}
